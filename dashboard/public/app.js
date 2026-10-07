/* Amputee research dashboard - plain-JS single page front end. */
'use strict';

const SOURCE_LABELS = {
  reddit: 'Reddit',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  feeds: 'Feeds',
  pubmed: 'PubMed',
  websearch: 'Web search',
  literature: 'Research sweep',
};

const STATUSES = ['new', 'reviewed', 'used'];

/** The feed column is a question list: people asking things, nowhere else. */
const COMMUNITY_SOURCES = ['reddit', 'x', 'youtube', 'feeds', 'websearch'];
/** Literature belongs to the research column, not the question list. */
const LITERATURE_SOURCES = ['literature', 'pubmed'];
/** Community sources with a real thread but no API to reply through. */
const BY_HAND_SOURCES = new Set(['websearch', 'feeds']);

const state = {
  tab: 'feed',
  keywords: [],
  settings: {},
  feed: { source: '', keyword: '', status: '', q: '', limit: 50, offset: 0, total: 0, items: [] },
  // Left column: matched research for the selected question, or the sweep.
  researchView: 'match',
  researchViewChosen: false,
  health: null,
  editingKeyword: null,
  snippets: { opening: '', closing: '' },
  workbench: {
    itemId: null,
    match: null,
    draft: null,
    drafts: [],
    replyTarget: null,
    // Indexes into match.results that the draft may cite. Everything the
    // match returned starts ticked; unticking narrows what the model sees.
    picked: new Set(),
  },
};

/* ------------------------------------------------------------------ utils */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  if (Number.isNaN(then.getTime())) return iso;
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    if (Math.abs(seconds) >= size) {
      const n = Math.round(seconds / size);
      return `${n} ${name}${Math.abs(n) === 1 ? '' : 's'} ${seconds >= 0 ? 'ago' : 'from now'}`;
    }
  }
  return 'just now';
}

/* ------------------------------------------------------------------- feed */

/**
 * One question in the feed column. The whole card is a picker: clicking it
 * loads the question, its research and its draft into the other two columns.
 */
function itemCard(item, { pick = true } = {}) {
  const card = el('div', pick ? 'item is-pick' : 'item');
  card.dataset.status = item.status;
  card.dataset.itemId = String(item.id);
  if (pick) {
    if (item.id === state.workbench.itemId) card.classList.add('is-selected');
    card.addEventListener('click', (event) => {
      // Let the buttons and links inside the card do their own job.
      if (event.target.closest('button, a, input, select')) return;
      selectQuestion(item.id);
    });
  }

  const head = el('div', 'item-head');
  head.append(el('span', `badge source-${item.source}`, SOURCE_LABELS[item.source] || item.source));
  // The origin repeats the author on X and on YouTube videos; show it once.
  if (item.origin && item.origin !== item.author) {
    head.append(el('span', '', item.origin));
  }
  if (item.author) head.append(el('span', '', item.author));
  head.append(el('span', '', relativeTime(item.timestamp)));
  if (item.kind) head.append(el('span', 'badge', item.kind));
  card.append(head);

  // A picked question is shown in full in the middle column, so the card
  // itself only needs a taste of it. An article has nowhere else to go.
  const body = el('div', pick ? 'item-text tight' : 'item-text clamped', item.text);
  if (pick) {
    body.title = 'Click to open this question';
  } else {
    body.title = 'Click to expand';
    body.addEventListener('click', () => body.classList.toggle('clamped'));
  }
  card.append(body);

  const foot = el('div', 'item-foot');
  for (const term of item.keywords_matched.length
    ? item.keywords_matched
    : [item.keyword_matched].filter(Boolean)) {
    const chip = el('span', 'badge kw', term);
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => {
      $('#filter-keyword').value = term.toLowerCase();
      state.feed.keyword = term.toLowerCase();
      state.feed.offset = 0;
      loadFeed();
    });
    foot.append(chip);
  }

  const group = el('div', 'status-group');
  for (const status of STATUSES) {
    const btn = el('button', status === item.status ? 'active' : '', status);
    btn.addEventListener('click', async () => {
      try {
        const updated = await api(`/items/${item.id}`, {
          method: 'PATCH',
          body: { status },
        });
        card.dataset.status = updated.status;
        [...group.children].forEach((child) =>
          child.classList.toggle('active', child.textContent === updated.status)
        );
        refreshCounts();
      } catch (err) {
        toast(err.message, true);
      }
    });
    group.append(btn);
  }
  foot.append(group);

  if (item.url) {
    const link = el('a', '', 'Open ↗');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.append(link);
  }

  const del = el('button', 'tiny danger', 'Dismiss');
  del.title = 'Remove from the feed. It will not come back on the next poll.';
  del.addEventListener('click', async () => {
    try {
      await api(`/items/${item.id}`, { method: 'DELETE' });
      card.remove();
      refreshCounts();
    } catch (err) {
      toast(err.message, true);
    }
  });
  foot.append(del);

  card.append(foot);
  return card;
}

function renderItems(container, items, emptyMessage, options) {
  container.innerHTML = '';
  if (!items.length) {
    container.append(el('div', 'empty', emptyMessage));
    return;
  }
  for (const item of items) container.append(itemCard(item, options));
}

async function loadFeed() {
  const params = new URLSearchParams();
  const f = state.feed;
  params.set('source', f.source || COMMUNITY_SOURCES.join(','));
  if (f.keyword) params.set('keyword', f.keyword);
  if (f.status) params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  params.set('limit', String(f.limit));
  params.set('offset', String(f.offset));

  try {
    const data = await api(`/items?${params}`);
    state.feed.total = data.total;
    state.feed.items = data.items;
    renderItems($('#feed-list'), data.items, emptyFeedMessage());
    if (!data.items.length) $('#feed-list').append(pollEverythingButton());
    const from = data.total === 0 ? 0 : f.offset + 1;
    const to = Math.min(f.offset + f.limit, data.total);
    $('#feed-range').textContent = `${from}-${to} of ${data.total}`;
    $('#feed-prev').disabled = f.offset === 0;
    $('#feed-next').disabled = f.offset + f.limit >= data.total;

    // Open the first question by default so the console is never three
    // empty columns, and re-open the selected one after a refresh.
    if (!state.workbench.itemId && data.items.length) {
      selectQuestion(data.items[0].id);
    } else {
      markSelectedCard();
    }

    // With no questions captured yet there is nothing to match, so show what
    // the sweep has found instead - unless the view was chosen by hand.
    if (!data.items.length && !state.researchViewChosen && state.researchView === 'match') {
      showResearchView('sweep');
    }
  } catch (err) {
    toast(err.message, true);
  }
}

function markSelectedCard() {
  for (const card of $$('#feed-list .item')) {
    card.classList.toggle(
      'is-selected',
      Number(card.dataset.itemId) === state.workbench.itemId
    );
  }
}

/** Says why the question column is empty, naming what is not yet wired up. */
function emptyFeedMessage() {
  const health = state.health;
  if (!health) return 'No questions captured yet.';

  const community = health.sources.filter((s) => COMMUNITY_SOURCES.includes(s.id));
  const live = community.filter((s) => s.enabled && s.configured).map((s) => SOURCE_LABELS[s.id]);
  const missing = community.filter((s) => !s.configured).map((s) => SOURCE_LABELS[s.id]);

  if (!live.length) {
    return (
      'No question source is set up yet. Reddit, X, YouTube and web search ' +
      '(Quora, Inspire and any domain you add) feed this column — open the ' +
      'Sources tab to add credentials and switch one on.'
    );
  }
  return (
    `Nothing captured yet from ${live.join(', ')}. Poll one from the Sources tab.` +
    (missing.length ? ` Still needs credentials: ${missing.join(', ')}.` : '')
  );
}

/**
 * "Nothing is arriving" is the hardest state to debug from a dashboard, so
 * the empty column offers to run every source and say what each one did.
 */
function pollEverythingButton() {
  const wrap = el('div');
  const row = el('div', 'row');
  row.style.justifyContent = 'center';
  const button = el('button', '', 'Poll every source now');
  const report = el('div', 'poll-report');

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Polling…';
    report.innerHTML = '';
    try {
      const { results } = await api('/sources/poll-all?force=true', { method: 'POST' });
      for (const result of results) {
        const line = el('div', `poll-line${result.ok ? '' : ' bad'}`);
        line.append(el('b', '', result.label || result.source));
        line.append(
          document.createTextNode(
            result.ok
              ? `: ${result.added || 0} new from ${result.fetched || 0} fetched` +
                (result.fetched && !result.added && result.unmatched
                  ? ` — none of them matched your keywords`
                  : '') +
                (result.notes ? ` — ${result.notes}` : '')
              : `: ${result.error || result.message || result.skipped}`
          )
        );
        report.append(line);
      }
      await refreshHealth();
      refreshCounts();
      loadFeed();
    } catch (err) {
      report.append(el('div', 'error', err.message));
    } finally {
      button.disabled = false;
      button.textContent = 'Poll every source now';
    }
  });

  row.append(button);
  wrap.append(row, report);
  return wrap;
}

async function refreshCounts() {
  try {
    const summary = await api('/items/summary');
    const counts = $('#feed-counts');
    counts.innerHTML = '';

    // Only the community sources are questions; literature is counted in the
    // research column instead.
    const community = Object.entries(summary.bySource).filter(([source]) =>
      COMMUNITY_SOURCES.includes(source)
    );
    const total = community.reduce((sum, [, stats]) => sum + stats.total, 0);
    counts.append(el('span', '', `${total} question${total === 1 ? '' : 's'}`));
    for (const [source, stats] of community) {
      counts.append(
        el('span', '', `${SOURCE_LABELS[source] || source}: ${stats.total} (${stats.new || 0} new)`)
      );
    }

    const select = $('#filter-keyword');
    const current = select.value;
    select.innerHTML = '<option value="">All keywords</option>';
    for (const row of summary.keywords) {
      const option = el('option', '', `${row.term} (${row.n})`);
      option.value = row.term.toLowerCase();
      select.append(option);
    }
    select.value = current;
  } catch (err) {
    console.error(err);
  }
}

/* ----------------------------------------------------- keyword bar (global) */

/**
 * The keyword list every poll job reads, kept in view on every tab so adding
 * or dropping a term never means going hunting for it.
 */
async function loadKeywordBar() {
  try {
    const data = await api('/keywords');
    state.keywords = data.keywords;
    renderKeywordBar();
  } catch (err) {
    console.error(err);
  }
}

function renderKeywordBar() {
  const box = $('#keyword-bar-chips');
  box.innerHTML = '';

  if (!state.keywords.length) {
    box.append(
      el('span', 'empty-note', 'No keywords yet — nothing will be captured until you add one.')
    );
    return;
  }

  for (const keyword of state.keywords) {
    const chip = el('span', `keyword-chip${keyword.enabled ? '' : ' off'}`);

    const term = el('button', 'term', keyword.term);
    term.type = 'button';
    term.title = keyword.enabled
      ? `Show only ${keyword.term} in the feed${
          keyword.scope === 'specific' ? ` · ${keyword.sources.join(', ')} only` : ''
        }`
      : `${keyword.term} is disabled — enable it in the Keywords tab`;
    term.addEventListener('click', () => {
      state.feed.keyword = keyword.term.toLowerCase();
      state.feed.offset = 0;
      $('#filter-keyword').value = keyword.term.toLowerCase();
      // showTab only reloads on a change of tab, so refilter in place.
      if (state.tab === 'feed') loadFeed();
      else showTab('feed');
    });

    const drop = el('button', 'drop', '×');
    drop.type = 'button';
    drop.title = `Stop tracking ${keyword.term}`;
    drop.addEventListener('click', async () => {
      if (!confirm(`Stop tracking "${keyword.term}"? Items already captured stay in the feed.`)) {
        return;
      }
      try {
        await api(`/keywords/${keyword.id}`, { method: 'DELETE' });
        toast(`No longer tracking "${keyword.term}"`);
        await loadKeywordBar();
        if (state.tab === 'keywords') loadKeywords();
      } catch (err) {
        toast(err.message, true);
      }
    });

    chip.append(term, drop);
    box.append(chip);
  }
}

async function addKeywordFromBar(event) {
  event.preventDefault();
  const input = $('#keyword-bar-input');
  const term = input.value.trim();
  if (!term) return;
  try {
    // New terms apply everywhere by default; the Keywords tab narrows them.
    const created = await api('/keywords', { method: 'POST', body: { term, scope: 'all' } });
    input.value = '';
    toast(`Now tracking "${created.term}"`);
    await loadKeywordBar();
    if (state.tab === 'keywords') loadKeywords();
  } catch (err) {
    toast(err.message, true);
  }
}

/* --------------------------------------------------------------- keywords */

function keywordRow(keyword) {
  const row = el('div', `keyword-row${keyword.enabled ? '' : ' disabled'}`);

  const left = el('div', 'row');
  left.append(el('span', 'keyword-term', keyword.term));
  if (keyword.scope === 'all') {
    left.append(el('span', 'badge', 'all sources'));
  } else {
    for (const source of keyword.sources) {
      left.append(el('span', `badge source-${source}`, SOURCE_LABELS[source] || source));
    }
  }
  if (keyword.notes) left.append(el('span', 'subtle', keyword.notes));
  row.append(left);

  const right = el('div', 'row');

  const toggle = el('button', 'tiny ghost', keyword.enabled ? 'Disable' : 'Enable');
  toggle.addEventListener('click', async () => {
    try {
      await api(`/keywords/${keyword.id}`, {
        method: 'PUT',
        body: { enabled: !keyword.enabled },
      });
      loadKeywords();
    } catch (err) {
      toast(err.message, true);
    }
  });

  const edit = el('button', 'tiny ghost', 'Edit');
  edit.addEventListener('click', () => startEditKeyword(keyword));

  const del = el('button', 'tiny danger', 'Delete');
  del.addEventListener('click', async () => {
    if (!confirm(`Delete keyword "${keyword.term}"?`)) return;
    try {
      await api(`/keywords/${keyword.id}`, { method: 'DELETE' });
      toast(`Deleted "${keyword.term}"`);
      loadKeywords();
    } catch (err) {
      toast(err.message, true);
    }
  });

  right.append(toggle, edit, del);
  row.append(right);
  return row;
}

async function loadKeywords() {
  try {
    const data = await api('/keywords');
    state.keywords = data.keywords;
    renderKeywordBar();
    const list = $('#keyword-list');
    list.innerHTML = '';
    if (!data.keywords.length) {
      list.append(
        el('div', 'empty', 'No keywords yet. Add the first one above.')
      );
    }
    for (const keyword of data.keywords) list.append(keywordRow(keyword));
    $('#keyword-count').textContent = `${data.keywords.length} keyword${
      data.keywords.length === 1 ? '' : 's'
    }`;
  } catch (err) {
    toast(err.message, true);
  }
}

function selectedScope() {
  const checked = $$('input[name="scope"]').find((input) => input.checked);
  return checked ? checked.value : 'all';
}

function selectedSources() {
  return $$('#keyword-sources input:checked').map((input) => input.value);
}

function syncScopeVisibility() {
  $('#keyword-sources').hidden = selectedScope() !== 'specific';
}

function resetKeywordForm() {
  state.editingKeyword = null;
  $('#keyword-id').value = '';
  $('#keyword-term').value = '';
  $('#keyword-notes').value = '';
  $$('input[name="scope"]').forEach((input) => {
    input.checked = input.value === 'all';
  });
  $$('#keyword-sources input').forEach((input) => {
    input.checked = false;
  });
  $('#keyword-form-title').textContent = 'Add a keyword';
  $('#keyword-submit').textContent = 'Add keyword';
  $('#keyword-cancel').classList.add('hidden');
  $('#keyword-error').textContent = '';
  syncScopeVisibility();
}

function startEditKeyword(keyword) {
  state.editingKeyword = keyword;
  $('#keyword-id').value = keyword.id;
  $('#keyword-term').value = keyword.term;
  $('#keyword-notes').value = keyword.notes || '';
  $$('input[name="scope"]').forEach((input) => {
    input.checked = input.value === keyword.scope;
  });
  $$('#keyword-sources input').forEach((input) => {
    input.checked = keyword.scope === 'specific' && keyword.sources.includes(input.value);
  });
  $('#keyword-form-title').textContent = `Edit "${keyword.term}"`;
  $('#keyword-submit').textContent = 'Save changes';
  $('#keyword-cancel').classList.remove('hidden');
  syncScopeVisibility();
  $('#keyword-term').focus();
}

async function submitKeyword(event) {
  event.preventDefault();
  $('#keyword-error').textContent = '';
  const payload = {
    term: $('#keyword-term').value,
    scope: selectedScope(),
    sources: selectedSources(),
    notes: $('#keyword-notes').value,
  };
  const id = $('#keyword-id').value;
  try {
    if (id) {
      await api(`/keywords/${id}`, { method: 'PUT', body: payload });
      toast('Keyword updated');
    } else {
      await api('/keywords', { method: 'POST', body: payload });
      toast('Keyword added');
    }
    resetKeywordForm();
    loadKeywords();
    loadKeywordBar();
  } catch (err) {
    $('#keyword-error').textContent = err.message;
  }
}

/* ---------------------------------------------------------------- sources */

function chipList(entries, { onToggle, onRemove, labelFor }) {
  const wrap = el('div', 'chips');
  for (const entry of entries) {
    const chip = el('span', `chip${entry.enabled ? '' : ' off'}`);
    const label = el('button', '', labelFor(entry));
    label.title = entry.enabled ? 'Click to pause' : 'Click to resume';
    label.addEventListener('click', () => onToggle(entry));
    const remove = el('button', '', '×');
    remove.title = 'Remove';
    remove.addEventListener('click', () => onRemove(entry));
    chip.append(label, remove);
    wrap.append(chip);
  }
  if (!entries.length) wrap.append(el('span', 'subtle', 'None configured'));
  return wrap;
}

function sourceCard(source) {
  const card = el('div', 'card');

  const head = el('div', 'card-head');
  const title = el('div', 'row');
  const dot = el('span', 'status-dot');
  if (source.last_status === 'ok') dot.classList.add('ok');
  else if (source.last_status === 'error') dot.classList.add('error');
  else if (source.last_status) dot.classList.add('warn');
  title.append(dot, el('h2', '', source.label));
  if (!source.configured) title.append(el('span', 'badge', 'needs credentials'));
  head.append(title);

  const actions = el('div', 'row');
  const toggle = el('button', 'ghost', source.enabled ? 'Pause polling' : 'Enable polling');
  toggle.addEventListener('click', async () => {
    await saveSettings({ [`${source.id}.enabled`]: String(!source.enabled) });
    loadSources();
  });
  const pollNow = el('button', '', source.running ? 'Polling…' : 'Poll now');
  pollNow.disabled = source.running;
  pollNow.addEventListener('click', async () => {
    pollNow.disabled = true;
    pollNow.textContent = 'Polling…';
    try {
      const result = await api(`/sources/${source.id}/poll?force=true`, { method: 'POST' });
      if (result.ok) {
        toast(
          `${source.label}: ${result.added || 0} new item(s) from ${result.fetched || 0} fetched` +
            (result.fetched && !result.added && result.unmatched
              ? ' — none matched your keywords'
              : '')
        );
      } else {
        toast(`${source.label}: ${result.error || result.message || result.skipped}`, true);
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      loadSources();
      refreshCounts();
      if (state.tab === 'feed') loadFeed();
    }
  });
  actions.append(toggle, pollNow);
  head.append(actions);
  card.append(head);

  const meta = el('div', 'counts');
  meta.append(
    el(
      'span',
      '',
      source.effective_interval_minutes === source.interval_minutes
        ? `every ${source.interval_minutes} min`
        : `every ${source.effective_interval_minutes} min (raised from ${source.interval_minutes} by the tier limit)`
    )
  );
  if (source.last_run_at) meta.append(el('span', '', `last run ${relativeTime(source.last_run_at)}`));
  if (source.last_status) meta.append(el('span', '', `status: ${source.last_status}`));
  meta.append(el('span', '', `${source.total_added} items collected`));
  if (source.next_run_at) meta.append(el('span', '', `next ${relativeTime(source.next_run_at)}`));
  card.append(meta);

  if (source.last_error) {
    card.append(el('p', 'error', source.last_error));
  }

  if (source.next_allowed_at && new Date(source.next_allowed_at) > new Date()) {
    const row = el('div', 'row');
    row.append(el('span', 'error', `Backing off until ${new Date(source.next_allowed_at).toLocaleString()}`));
    const clear = el('button', 'tiny ghost', 'Clear backoff');
    clear.addEventListener('click', async () => {
      await api(`/sources/${source.id}/clear-backoff`, { method: 'POST' });
      loadSources();
    });
    row.append(clear);
    card.append(row);
  }

  for (const credential of source.credentials) {
    const line = el('div', 'subtle');
    line.textContent = `${credential.env}: ${
      credential.present ? 'set' : credential.required ? 'MISSING' : 'not set (optional)'
    }`;
    card.append(line);
  }

  const controls = el('div', 'grid-2');
  const intervalLabel = el('label', '', 'Poll interval (minutes)');
  const intervalInput = el('input');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.value = source.interval_minutes;
  intervalInput.addEventListener('change', async () => {
    await saveSettings({ [`${source.id}.interval_minutes`]: intervalInput.value });
    loadSources();
  });
  intervalLabel.append(intervalInput);
  controls.append(intervalLabel);
  card.append(controls);

  if (source.id === 'reddit') card.append(redditControls(source));
  if (source.id === 'x') card.append(xControls(source));
  if (source.id === 'youtube') card.append(youtubeControls(source));
  if (source.id === 'feeds') card.append(feedControls(source));
  if (source.id === 'websearch') {
    card.append(websearchControls(source));
    card.append(searchTestControls(source));
  }
  if (source.id === 'pubmed' || source.id === 'literature') {
    card.append(literatureControls(source));
  }

  return card;
}

/** Shows what the keywords at the top of the screen actually search for. */
function literatureControls(source) {
  const wrap = el('div');
  const details = source.details || {};
  if (details.databases) {
    const on = details.databases.filter((d) => d.enabled).map((d) => d.label || d.id);
    wrap.append(
      el(
        'p',
        'subtle',
        `${on.length} of ${details.databases.length} databases: ${on.join(', ')}. ` +
          `Keeps anything published in the last ${details.lookback_days} days.`
      )
    );
  }
  if (details.example_term) {
    wrap.append(el('h3', '', 'Example query'));
    wrap.append(el('pre', 'query', details.example_term));
  }
  return wrap;
}

function redditControls(source) {
  const wrap = el('div');
  // Which read path is in use, so a silent source is diagnosable.
  if (source.details.reads_via) {
    wrap.append(el('p', 'subtle', `Reading via ${source.details.reads_via}.`));
  }
  wrap.append(redditDiagnostics());
  wrap.append(el('h3', '', 'Subreddits'));
  wrap.append(
    chipList(source.details.subreddits, {
      labelFor: (entry) => `r/${entry.name}`,
      onToggle: async (entry) => {
        await api(`/sources/reddit/subreddits/${entry.id}`, {
          method: 'PATCH',
          body: { enabled: !entry.enabled },
        });
        loadSources();
      },
      onRemove: async (entry) => {
        await api(`/sources/reddit/subreddits/${entry.id}`, { method: 'DELETE' });
        loadSources();
      },
    })
  );

  const form = el('form', 'row');
  form.style.marginTop = '0.6rem';
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Add subreddit, e.g. amputee';
  const submit = el('button', 'tiny', 'Add');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/sources/reddit/subreddits', {
        method: 'POST',
        body: { name: input.value },
      });
      input.value = '';
      loadSources();
    } catch (err) {
      toast(err.message, true);
    }
  });
  wrap.append(form);

  const comments = el('label', 'inline');
  comments.style.marginTop = '0.6rem';
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.checked = source.details.include_comments;
  checkbox.addEventListener('change', async () => {
    await saveSettings({ 'reddit.include_comments': String(checkbox.checked) });
    loadSources();
  });
  comments.prepend(checkbox);
  comments.append(' Also pull new comments (not just posts)');
  wrap.append(comments);
  return wrap;
}

/**
 * Reddit can fail four different ways and they look identical from the feed.
 * This tries each address once and prints what it actually said.
 */
function redditDiagnostics() {
  const wrap = el('div');
  const row = el('div', 'row');
  const run = el('button', 'tiny ghost', 'Check Reddit');
  run.title = 'Try every public address once and report what each one answers';
  row.append(run);
  wrap.append(row);

  const output = el('div', 'poll-report');
  wrap.append(output);

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.textContent = 'Checking…';
    output.innerHTML = '';
    try {
      const report = await api('/sources/reddit/diagnose', { method: 'POST' });
      output.append(
        el(
          'div',
          'subtle',
          `r/${report.subreddit} · ${report.user_agent}` +
            (report.using_oauth ? ' · using app credentials' : '')
        )
      );
      // Reddit documents that the agent should name the account behind it,
      // and is readier to answer one that does.
      if (!/\(by \/u\//.test(report.user_agent)) {
        const hint = el('div', 'subtle');
        hint.append(
          document.createTextNode(
            'Reddit asks that the user agent name your account. Declare your ' +
              'Reddit username under Linked accounts below and it is added ' +
              'automatically — '
          )
        );
        const jump = el('button', 'tiny ghost', 'Add it');
        jump.addEventListener('click', () => {
          const card = [...$$('#source-cards .card')].find((c) =>
            c.textContent.includes('Linked accounts')
          );
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        hint.append(jump);
        output.append(hint);
      }
      for (const attempt of report.attempts) {
        const line = el('div', `poll-line${attempt.ok ? '' : ' bad'}`);
        line.append(el('b', '', attempt.label));
        line.append(
          document.createTextNode(
            attempt.ok
              ? `: answered with ${attempt.items} item(s) in ${attempt.ms}ms`
              : `: ${attempt.error} (${attempt.ms}ms)`
          )
        );
        if (attempt.sample) line.append(el('div', 'subtle', attempt.sample));
        output.append(line);
      }
      if (!report.attempts.some((a) => a.ok)) {
        output.append(
          el(
            'div',
            'subtle',
            'No public address answered. Register a Reddit app and set ' +
              'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET, or run the dashboard ' +
              'from a home connection.'
          )
        );
      }
    } catch (err) {
      output.append(el('div', 'error', err.message));
    } finally {
      run.disabled = false;
      run.textContent = 'Check Reddit';
    }
  });
  return wrap;
}

function xControls(source) {
  const wrap = el('div');
  wrap.append(el('h3', '', 'API tier'));
  const select = el('select');
  for (const tier of ['free', 'basic', 'pro']) {
    const option = el('option', '', tier);
    option.value = tier;
    if (source.details.tier === tier) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', async () => {
    await saveSettings({ 'x.tier': select.value });
    loadSources();
  });
  wrap.append(select);
  if (source.details.tier_note) {
    wrap.append(el('p', 'error', source.details.tier_note));
  }
  wrap.append(
    el(
      'p',
      'subtle',
      `Minimum interval for this tier: ${source.details.min_interval_minutes} min. ` +
        `Up to ${source.details.max_queries_per_poll} keyword batch(es) per poll, ` +
        `${source.details.max_results} results each.` +
        (source.details.since_id ? ` Resuming from tweet ${source.details.since_id}.` : '')
    )
  );
  return wrap;
}

function youtubeControls(source) {
  const wrap = el('div');
  const quota = source.details.quota;
  wrap.append(el('h3', '', 'Daily quota'));
  wrap.append(
    el(
      'p',
      'subtle',
      `${quota.used_today} of ${quota.daily} units used today across ${quota.calls_today} call(s); ` +
        `${quota.remaining} available after a ${quota.reserve}-unit reserve. Resets ${quota.resets}. ` +
        'A keyword video search costs 100 units; each channel comment pull costs 1.'
    )
  );

  wrap.append(el('h3', '', 'Channels watched for new comments'));
  wrap.append(
    chipList(source.details.channels, {
      labelFor: (entry) => entry.title || entry.channel_id,
      onToggle: async (entry) => {
        await api(`/sources/youtube/channels/${entry.id}`, {
          method: 'PATCH',
          body: { enabled: !entry.enabled },
        });
        loadSources();
      },
      onRemove: async (entry) => {
        await api(`/sources/youtube/channels/${entry.id}`, { method: 'DELETE' });
        loadSources();
      },
    })
  );

  const form = el('form', 'row');
  form.style.marginTop = '0.6rem';
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Channel ID (UC…), @handle or channel URL';
  input.style.minWidth = '260px';
  const submit = el('button', 'tiny', 'Add');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/sources/youtube/channels', {
        method: 'POST',
        body: { channel_id: input.value },
      });
      input.value = '';
      loadSources();
    } catch (err) {
      toast(err.message, true);
    }
  });
  wrap.append(form);

  for (const [key, label] of [
    ['youtube.channel_comments', 'Pull new comments from the channels above'],
    ['youtube.search_videos', 'Search for new videos matching keywords (100 units per poll)'],
  ]) {
    const line = el('label', 'inline');
    line.style.marginTop = '0.4rem';
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = String(state.settings[key]) === 'true';
    checkbox.addEventListener('change', async () => {
      await saveSettings({ [key]: String(checkbox.checked) });
      loadSources();
    });
    line.prepend(checkbox);
    line.append(` ${label}`);
    wrap.append(line);
  }
  return wrap;
}

/**
 * Any RSS or Atom address, which is how most forums publish their new posts.
 * No credentials, no quota — the one question source that needs nothing.
 */
function feedControls(source) {
  const wrap = el('div');
  wrap.append(el('h3', '', 'Feeds'));

  const list = el('div', 'feed-list');
  for (const feed of source.details.feeds) {
    const row = el('div', `feed-row${feed.enabled ? '' : ' disabled'}`);
    const who = el('div', 'who');
    who.append(el('strong', '', feed.label || feed.url));
    who.append(el('span', '', feed.url));
    if (feed.last_error) who.append(el('span', 'error', feed.last_error));
    else if (feed.last_fetched_at) {
      who.append(el('span', '', `read ${relativeTime(feed.last_fetched_at)}`));
    }
    row.append(who);

    const actions = el('div', 'row');
    const toggle = el('button', 'tiny ghost', feed.enabled ? 'Pause' : 'Resume');
    toggle.addEventListener('click', async () => {
      await api(`/sources/feeds/feeds/${feed.id}`, {
        method: 'PATCH',
        body: { enabled: !feed.enabled },
      });
      loadSources();
    });
    const drop = el('button', 'tiny danger', 'Remove');
    drop.addEventListener('click', async () => {
      if (!confirm(`Stop reading ${feed.label || feed.url}?`)) return;
      await api(`/sources/feeds/feeds/${feed.id}`, { method: 'DELETE' });
      loadSources();
    });
    actions.append(toggle, drop);
    row.append(actions);
    list.append(row);
  }
  if (!source.details.feeds.length) {
    list.append(
      el(
        'div',
        'subtle',
        'No feeds yet. Most forums publish one: paste the forum address and the feed is found automatically.'
      )
    );
  }
  wrap.append(list);

  const form = el('form', 'row');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'https://forum.example.org/latest.rss  (or the forum address)';
  input.className = 'grow';
  const submit = el('button', 'tiny', 'Add feed');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    submit.disabled = true;
    submit.textContent = 'Checking…';
    try {
      const added = await api('/sources/feeds/feeds', {
        method: 'POST',
        body: { url: input.value.trim() },
      });
      toast(`Added ${added.label} — ${added.items_seen} item(s) in the feed right now`);
      input.value = '';
      loadSources();
    } catch (err) {
      toast(err.message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Add feed';
    }
  });
  wrap.append(form);
  wrap.append(
    el(
      'p',
      'subtle',
      'Reddit, Discourse and most forum software publish a feed of new posts. ' +
        'A subreddit feed lives at reddit.com/r/<name>/new/.rss, a Discourse ' +
        'forum at /latest.rss. Items are keyword-matched like every other source.'
    )
  );
  return wrap;
}

function websearchControls(source) {
  const d = source.details;
  const wrap = el('div');

  wrap.append(el('h3', '', 'Search provider'));
  const select = el('select');
  for (const id of d.providers) {
    const option = el('option', '', id);
    option.value = id;
    if (d.provider === id) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', async () => {
    await saveSettings({ 'websearch.provider': select.value });
    loadSources();
  });
  wrap.append(select);

  wrap.append(
    el(
      'p',
      'subtle',
      `${d.quota.used} of ${d.quota.limit} queries used this ${d.quota.period} ` +
        `(${d.quota.window}); ${d.quota.remaining} left. Each poll runs up to ` +
        `${d.max_queries_per_poll} query(s), rotating through the keyword × site ` +
        'list so every keyword gets covered over successive polls. Only the ' +
        'search API\u2019s own titles, snippets and links are stored \u2014 the ' +
        'pages themselves are never fetched.'
    )
  );

  if (!source.configured) {
    const help = el('div', 'banner');
    help.append(
      el(
        'p',
        '',
        'Quora and Inspire have no API of their own, so they are reached ' +
          'through a licensed search index. That needs one key, and nothing ' +
          'from this source arrives until it is set:'
      )
    );
    const options = el('ul');
    const brave = el('li');
    brave.append(document.createTextNode('Brave Search API — 2,000 queries a month free. Set '));
    brave.append(el('code', '', 'BRAVE_SEARCH_API_KEY'));
    brave.append(document.createTextNode('.'));
    const google = el('li');
    google.append(
      document.createTextNode('Google Programmable Search — 100 queries a day free. Set ')
    );
    google.append(el('code', '', 'GOOGLE_SEARCH_API_KEY'));
    google.append(document.createTextNode(' and '));
    google.append(el('code', '', 'GOOGLE_SEARCH_CX'));
    google.append(document.createTextNode(', and switch the provider above.'));
    options.append(brave, google);
    help.append(options);
    help.append(el('p', 'subtle', 'Restart the dashboard after setting either one.'));
    wrap.append(help);
  }

  wrap.append(el('h3', '', 'Sites searched'));
  wrap.append(
    chipList(d.sites, {
      labelFor: (entry) => entry.label || entry.domain,
      onToggle: async (entry) => {
        await api(`/sources/websearch/sites/${entry.id}`, {
          method: 'PATCH',
          body: { enabled: !entry.enabled },
        });
        loadSources();
      },
      onRemove: async (entry) => {
        await api(`/sources/websearch/sites/${entry.id}`, { method: 'DELETE' });
        loadSources();
      },
    })
  );

  const form = el('form', 'row');
  form.style.marginTop = '0.6rem';
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Add a domain, e.g. quora.com';
  input.style.minWidth = '220px';
  const submit = el('button', 'tiny', 'Add');
  submit.type = 'submit';
  form.append(input, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/sources/websearch/sites', {
        method: 'POST',
        body: { domain: input.value },
      });
      input.value = '';
      loadSources();
    } catch (err) {
      toast(err.message, true);
    }
  });
  wrap.append(form);

  const controls = el('div', 'grid-2');
  for (const [key, label, min, max] of [
    ['websearch.results_per_query', 'Results per query', 1, 20],
    ['websearch.freshness_days', 'Look back (days)', 1, 365],
    ['websearch.max_queries_per_poll', 'Queries per poll', 1, 50],
  ]) {
    const line = el('label', '', label);
    const field = el('input');
    field.type = 'number';
    field.min = String(min);
    field.max = String(max);
    field.value = state.settings[key];
    field.addEventListener('change', async () => {
      await saveSettings({ [key]: field.value });
      loadSources();
    });
    line.append(field);
    controls.append(line);
  }
  wrap.append(controls);
  return wrap;
}

/**
 * Runs one real query and shows what came back, so a site can be checked
 * without waiting for the next poll.
 */
function searchTestControls(source) {
  const wrap = el('div');
  wrap.append(el('h3', '', 'Check a site'));

  const row = el('div', 'row');
  const site = el('select');
  for (const entry of source.details.sites) {
    const option = el('option', '', entry.label || entry.domain);
    option.value = entry.domain;
    site.append(option);
  }
  const term = el('select');
  for (const keyword of state.keywords) {
    if (!keyword.enabled) continue;
    const option = el('option', '', keyword.term);
    option.value = keyword.term;
    term.append(option);
  }
  const run = el('button', 'tiny', 'Test search');
  run.disabled = !source.configured || !source.details.sites.length;
  run.title = source.configured
    ? 'Runs one query now and shows the results'
    : 'Set a search API key first';
  row.append(site, term, run);
  wrap.append(row);

  const output = el('div');
  wrap.append(output);

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.textContent = 'Searching…';
    output.innerHTML = '';
    try {
      const result = await api('/sources/websearch/test', {
        method: 'POST',
        body: { domain: site.value, term: term.value },
      });
      output.append(el('pre', 'query', result.query));
      output.append(
        el(
          'div',
          'subtle',
          `${result.provider} returned ${result.count} result(s) · ${result.quota}`
        )
      );
      if (!result.count) {
        output.append(
          el(
            'div',
            'subtle',
            'Nothing matched. The site may simply have no recent posts using that term.'
          )
        );
      }
      for (const hit of result.results) {
        const line = el('div', 'cite');
        const link = el('a', '', hit.title || hit.url);
        link.href = hit.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        line.append(link);
        output.append(line);
      }
    } catch (err) {
      output.append(el('div', 'error', err.message));
    } finally {
      run.disabled = false;
      run.textContent = 'Test search';
    }
  });

  // A test costs one query from the same allowance the polls draw on.
  wrap.append(
    el(
      'p',
      'subtle',
      'One query, looking back a year rather than the freshness window above, ' +
        'so an empty result means the search itself found nothing. It counts ' +
        'against the same free-tier allowance as a poll.'
    )
  );
  return wrap;
}

function connectionsCard(info) {
  const card = el('div', 'card');
  const head = el('div', 'card-head');
  head.append(el('h2', '', 'Linked accounts'));
  head.append(
    el('span', 'subtle', `${info.replies.posted} reply(s) sent · ${info.replies.failed} failed`)
  );
  card.append(head);
  card.append(
    el(
      'p',
      'subtle',
      'Replies post as the account you link here. Nothing is ever sent automatically: you confirm each reply from the console.'
    )
  );

  for (const provider of info.providers) {
    const row = el('div', 'connection');
    const who = el('div', 'who');
    who.append(el('strong', '', provider.label));

    if (provider.connection) {
      who.append(el('span', '', `Connected as ${provider.connection.account_name} — posts for you`));
      if (provider.connection.last_error) {
        who.append(el('span', 'error', provider.connection.last_error));
      }
    } else if (provider.manual_account) {
      who.append(
        el('span', '', `${provider.manual_account.handle} — you paste and post the reply yourself`)
      );
    } else if (!provider.registered) {
      who.append(el('span', '', `Not set up yet — ${provider.registration}`));
      const uriRow = el('div', 'row');
      uriRow.append(el('span', 'redirect', provider.redirect_uri));
      const copyUri = el('button', 'tiny ghost', 'Copy');
      copyUri.title = 'Copy the redirect URI to paste into the platform';
      copyUri.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(provider.redirect_uri);
          toast('Redirect URI copied');
        } catch {
          toast('Copy failed — select the address and copy it manually', true);
        }
      });
      uriRow.append(copyUri);
      who.append(uriRow);
    } else {
      who.append(el('span', '', 'Not connected'));
    }
    row.append(who);

    const actions = el('div', 'row');
    if (provider.connection) {
      const reconnect = el('button', 'tiny ghost', 'Reconnect');
      reconnect.addEventListener('click', () => startConnect(provider));
      const remove = el('button', 'tiny danger', 'Disconnect');
      remove.addEventListener('click', async () => {
        if (!confirm(`Disconnect ${provider.connection.account_name}? Replies to ${provider.label} will stop working until you link it again.`)) {
          return;
        }
        try {
          await api(`/connections/${provider.id}`, { method: 'DELETE' });
          toast(`${provider.label} disconnected`);
          loadSources();
        } catch (err) {
          toast(err.message, true);
        }
      });
      actions.append(reconnect, remove);
    } else {
      const connect = el('button', 'tiny', `Connect ${provider.label}`);
      connect.disabled = !provider.registered;
      connect.title = provider.registered
        ? `Sign in and authorize ${provider.label}`
        : 'Add this platform\u2019s client credentials first';
      connect.addEventListener('click', () => startConnect(provider));
      actions.append(connect);
    }

    // Available whether or not an app was ever registered.
    const manualButton = el(
      'button',
      'tiny ghost',
      provider.manual_account ? 'Change account' : 'Add account by hand'
    );
    manualButton.title = `Record the ${provider.label} account you post from, without OAuth`;
    manualButton.addEventListener('click', () => setManualAccount(provider));
    actions.append(manualButton);

    if (provider.manual_account) {
      const forget = el('button', 'tiny danger', 'Forget');
      forget.addEventListener('click', async () => {
        try {
          await api(`/connections/${provider.id}/manual`, { method: 'DELETE' });
          toast(`${provider.label} account removed`);
          loadSources();
        } catch (err) {
          toast(err.message, true);
        }
      });
      actions.append(forget);
    }
    row.append(actions);
    card.append(row);
  }
  return card;
}

async function setManualAccount(provider) {
  const examples = {
    reddit: 'yourname, u/yourname or a profile link',
    x: 'drsmith, @drsmith or a profile link',
    youtube: '@YourChannel, a channel link, or the channel name',
  };
  const current = provider.manual_account ? provider.manual_account.handle : '';
  const entered = prompt(
    `Which ${provider.label} account do you post from?\n\n${examples[provider.id] || ''}`,
    current
  );
  if (entered === null || !entered.trim()) return;
  try {
    const saved = await api(`/connections/${provider.id}/manual`, {
      method: 'PUT',
      body: { handle: entered },
    });
    toast(`Replies will be posted as ${saved.handle}`);
    loadSources();
  } catch (err) {
    toast(err.message, true);
  }
}

function startConnect(provider) {
  // The consent screen belongs to the platform, so it opens in its own tab
  // and the dashboard picks up the result when you come back.
  window.open(`/api/connections/${provider.id}/start`, '_blank', 'noopener');
  toast(`Finish signing in to ${provider.label} in the new tab`);
  const recheck = setInterval(loadSources, 4000);
  setTimeout(() => clearInterval(recheck), 120000);
}

function researchCard(info) {
  const card = el('div', 'card');
  const head = el('div', 'card-head');
  head.append(el('h2', '', 'Research databases'));
  head.append(
    el(
      'span',
      'subtle',
      `${info.cache.matched_items} question(s) matched · ${info.cache.no_strong_matches} with no strong match`
    )
  );
  card.append(head);
  card.append(
    el(
      'p',
      'subtle',
      'Queried per question from the console, and once a day by the research sweep. Results are merged, deduplicated and ranked by evidence quality.'
    )
  );

  const list = el('div', 'source-checks');
  for (const provider of info.providers) {
    const line = el('label', 'inline');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = provider.enabled;
    checkbox.addEventListener('change', async () => {
      await saveSettings({ [`research.provider_${provider.id}`]: String(checkbox.checked) });
      loadSources();
    });
    line.prepend(checkbox);
    line.append(` ${provider.label}`);
    list.append(line);
  }
  card.append(list);

  const emailLabel = el('label', '', 'Contact email (Crossref, OpenAlex and NCBI ask for one)');
  emailLabel.style.marginTop = '0.75rem';
  const email = el('input');
  email.type = 'text';
  email.placeholder = 'you@example.com';
  email.value = info.contact_email || '';
  email.addEventListener('change', async () => {
    await saveSettings({ 'research.contact_email': email.value });
    toast('Contact address saved');
  });
  emailLabel.append(email);
  card.append(emailLabel);

  card.append(el('h3', '', 'Daily sweep'));
  card.append(
    el(
      'p',
      'subtle',
      'How far back the scheduled sweep and the PubMed pull look, and how much each one brings back. Run either from its own card above.'
    )
  );
  const grid = el('div', 'grid-2');
  grid.append(
    numberSetting('Look back (days)', 'pubmed.reldate_days', { min: 1, max: 365 })
  );
  grid.append(
    numberSetting('Max articles per pull', 'pubmed.max_results', { min: 1, max: 100 })
  );
  card.append(grid);

  return card;
}

/** A number input bound straight to one stored setting. */
function numberSetting(label, key, { min, max }) {
  const wrap = el('label', '', label);
  const input = el('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = state.settings[key];
  input.addEventListener('change', async () => {
    await saveSettings({ [key]: input.value });
    toast('Saved');
  });
  wrap.append(input);
  return wrap;
}

async function loadSources() {
  try {
    state.settings = await api('/settings');
    const data = await api('/sources');
    const container = $('#source-cards');
    container.innerHTML = '';
    for (const source of data.sources) container.append(sourceCard(source));
    try {
      container.append(connectionsCard(await api('/connections')));
      container.append(researchCard(await api('/research/providers')));
    } catch (err) {
      console.error(err);
    }

    const log = $('#poll-log');
    log.innerHTML = '';
    if (!data.logs.length) log.append(el('div', 'empty', 'No polls yet.'));
    for (const entry of data.logs) {
      const row = el('div', 'log-row');
      row.append(el('span', 'badge', SOURCE_LABELS[entry.source] || entry.source));
      row.append(el('span', '', entry.status));
      row.append(el('span', 'subtle', relativeTime(entry.started_at)));
      row.append(el('span', 'subtle', `${entry.added} added / ${entry.fetched} fetched`));
      if (entry.message) row.append(el('span', 'subtle', entry.message));
      log.append(row);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveSettings(entries) {
  try {
    state.settings = await api('/settings', { method: 'PUT', body: entries });
    return state.settings;
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

/* -------------------------------------------------------------- workbench */

const EVIDENCE_HINT = {
  1: 'Strongest: pooled trials or an official guideline',
  2: 'Randomized controlled trial',
  3: 'Trial or cohort study',
  4: 'Observational study',
  5: 'Weakest: single case, opinion, or not peer reviewed',
};

/**
 * Open one question in the console: the middle column shows it, the left
 * column its matched research, and the feed card is highlighted.
 */
function selectQuestion(itemId) {
  if (!itemId) return;
  state.workbench.itemId = itemId;
  state.workbench.picked = new Set();
  markSelectedCard();
  showTab('feed');
  if (state.researchView !== 'match') showResearchView('match');
  loadSelection();
}

/** Steps to the next or previous question in the feed column. */
function stepQuestion(delta) {
  const list = state.feed.items;
  if (!list.length) return;
  const index = list.findIndex((i) => i.id === state.workbench.itemId);
  const next = list[Math.min(Math.max(index + delta, 0), list.length - 1)];
  if (!next || next.id === state.workbench.itemId) return;
  selectQuestion(next.id);
}

function renderQuestion(item) {
  const card = $('#wb-question-card');
  card.innerHTML = '';
  if (!item) {
    card.append(el('div', 'empty', 'Pick a question from the feed on the right.'));
    return;
  }

  const head = el('div', 'item-head');
  head.append(el('span', `badge source-${item.source}`, SOURCE_LABELS[item.source] || item.source));
  if (item.origin && item.origin !== item.author) head.append(el('span', '', item.origin));
  if (item.author) head.append(el('span', '', item.author));
  head.append(el('span', '', relativeTime(item.timestamp)));
  card.append(head);

  const step = el('div', 'row');
  const prev = el('button', 'tiny ghost', '↑ Previous');
  prev.title = 'Previous question in the feed';
  prev.addEventListener('click', () => stepQuestion(-1));
  const next = el('button', 'tiny ghost', 'Next ↓');
  next.title = 'Next question in the feed';
  next.addEventListener('click', () => stepQuestion(1));
  step.append(prev, next);
  head.append(step);

  card.append(el('p', 'question-text', item.text));

  const foot = el('div', 'item-foot');
  for (const term of item.keywords_matched || []) {
    foot.append(el('span', 'badge kw', term));
  }
  const group = el('div', 'status-group');
  for (const status of STATUSES) {
    const btn = el('button', status === item.status ? 'active' : '', status);
    btn.addEventListener('click', async () => {
      try {
        const updated = await api(`/items/${item.id}`, { method: 'PATCH', body: { status } });
        [...group.children].forEach((child) =>
          child.classList.toggle('active', child.textContent === updated.status)
        );
        refreshCounts();
      } catch (err) {
        toast(err.message, true);
      }
    });
    group.append(btn);
  }
  foot.append(group);
  if (item.url) {
    const link = el('a', '', 'Open original ↗');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.append(link);
  }
  card.append(foot);
}

function resultCard(result, index) {
  const card = el('div', 'result');
  card.dataset.level = String(result.evidence ? result.evidence.level : 4);

  const badges = el('div', 'item-head');
  if (result.evidence) {
    const badge = el('span', `badge ev${result.evidence.level}`, result.evidence.label);
    badge.title = EVIDENCE_HINT[result.evidence.level] || '';
    badges.append(badge);
  }
  for (const source of result.sources || []) {
    badges.append(el('span', 'badge db', SOURCE_DB_LABELS[source] || source));
  }
  if (result.open_access === true) badges.append(el('span', 'badge oa', 'Open access'));
  else if (result.open_access === false) badges.append(el('span', 'badge paywalled', 'Paywalled'));
  card.append(badges);

  const title = el('h3');
  if (result.url) {
    const link = el('a', '', result.title);
    link.href = result.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    title.append(link);
  } else {
    title.textContent = result.title;
  }
  card.append(title);

  const meta = el('div', 'meta');
  if (result.venue) meta.append(el('span', '', result.venue));
  if (result.year) meta.append(el('span', '', String(result.year)));
  if (typeof result.citations === 'number') {
    meta.append(el('span', '', `${result.citations} citations`));
  }
  if (result.registry && result.status) {
    meta.append(el('span', '', `status: ${result.status.toLowerCase()}`));
  }
  if (result.doi) {
    const doi = el('a', '', `doi:${result.doi}`);
    doi.href = `https://doi.org/${result.doi}`;
    doi.target = '_blank';
    doi.rel = 'noopener noreferrer';
    meta.append(doi);
  }
  if (result.nct_id) meta.append(el('span', '', result.nct_id));
  card.append(meta);

  if (result.snippet) card.append(el('p', 'snippet', result.snippet));
  if (result.registry) {
    card.append(
      el('p', 'subtle', 'Trial registration — study is planned or under way, no published results.')
    );
  }

  // Ticking decides which papers the draft is allowed to cite.
  const pick = el('label', 'pick-line');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = state.workbench.picked.has(index);
  box.addEventListener('change', () => {
    if (box.checked) state.workbench.picked.add(index);
    else state.workbench.picked.delete(index);
    renderPicked();
  });
  pick.append(box, document.createTextNode(' Use this paper in the draft'));
  card.append(pick);
  return card;
}

/** The running count of ticked papers, with a select-all/none shortcut. */
function renderPicked() {
  const box = $('#wb-picked');
  const total = (state.workbench.match && state.workbench.match.results) || [];
  box.innerHTML = '';
  box.classList.toggle('hidden', !total.length);
  if (!total.length) return;

  const picked = state.workbench.picked.size;
  box.append(
    el('span', '', `Drafting from ${picked} of ${total.length} paper${total.length === 1 ? '' : 's'}`)
  );
  const toggle = el('button', 'tiny ghost', picked === total.length ? 'Untick all' : 'Tick all');
  toggle.addEventListener('click', () => {
    state.workbench.picked =
      picked === total.length ? new Set() : new Set(total.map((_, i) => i));
    renderMatch(state.workbench.match);
  });
  box.append(toggle);

  const generate = $('#wb-generate');
  generate.textContent = picked ? `Build from ${picked}` : 'Build draft';
}

const SOURCE_DB_LABELS = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  crossref: 'Crossref',
  semanticscholar: 'Semantic Scholar',
  openalex: 'OpenAlex',
  clinicaltrials: 'ClinicalTrials.gov',
};

function renderMatch(match) {
  const terms = $('#wb-terms');
  const providers = $('#wb-providers');
  const note = $('#wb-note');
  const results = $('#wb-results');
  terms.textContent = '';
  providers.innerHTML = '';
  note.innerHTML = '';
  results.innerHTML = '';

  $('#wb-picked').classList.add('hidden');
  $('#wb-generate').textContent = 'Build draft';

  if (!state.workbench.itemId) {
    results.append(el('div', 'empty', 'Pick a question from the feed on the right.'));
    return;
  }

  if (!match || !match.exists) {
    results.append(
      el('div', 'empty', 'No research matched yet. Press "Match research" to query the six databases.')
    );
    return;
  }

  terms.textContent = match.terms && match.terms.length
    ? `Searched for: ${match.terms.join(', ')}${match.cached ? ` · cached ${relativeTime(match.created_at)}` : ''}`
    : 'No searchable terms were found in this question.';

  for (const provider of match.providers || []) {
    const chip = el(
      'span',
      `chip${provider.status === 'ok' ? '' : ' off'}`,
      `${SOURCE_DB_LABELS[provider.id] || provider.id}: ${
        provider.status === 'ok' ? `${provider.count}` : provider.status
      }`
    );
    if (provider.error) chip.title = provider.error;
    providers.append(chip);
  }

  if (match.no_strong_matches) {
    note.append(
      el(
        'div',
        'banner',
        match.note ||
          'No strong match was found for this question. Nothing here answers it directly.'
      )
    );
  } else if (match.note) {
    note.append(el('div', 'banner', match.note));
  }

  if (!match.results || !match.results.length) {
    results.append(
      el('div', 'empty', 'Nothing relevant enough to show. Weak matches are deliberately not listed.')
    );
    return;
  }
  match.results.forEach((result, index) => results.append(resultCard(result, index)));
  renderPicked();
}

function renderDraft() {
  const draft = state.workbench.draft;
  const text = $('#wb-draft-text');
  const meta = $('#wb-draft-meta');
  const statusGroup = $('#wb-draft-status');
  const citations = $('#wb-draft-citations');

  statusGroup.innerHTML = '';
  citations.innerHTML = '';

  if (!draft) {
    text.value = '';
    meta.textContent = state.workbench.drafts.length
      ? `${state.workbench.drafts.length} saved draft(s)`
      : '';
    $('#wb-draft-saved').textContent = '';
    return;
  }

  text.value = draft.content;
  const usage = draft.usage || {};
  meta.textContent = [
    usage.composed
      ? `built from ${usage.papers} paper${usage.papers === 1 ? '' : 's'}` +
        (usage.quoted ? `, ${usage.quoted} quoted` : '')
      : draft.model,
    `saved ${relativeTime(draft.updated_at)}`,
    state.workbench.drafts.length > 1 ? `${state.workbench.drafts.length} versions` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  for (const status of ['draft', 'edited', 'used']) {
    const btn = el('button', status === draft.status ? 'active' : '', status);
    btn.addEventListener('click', async () => {
      try {
        const updated = await api(`/drafts/${draft.id}`, { method: 'PATCH', body: { status } });
        state.workbench.draft = updated;
        renderDraft();
      } catch (err) {
        toast(err.message, true);
      }
    });
    statusGroup.append(btn);
  }

  if (draft.citations && draft.citations.length) {
    citations.append(el('div', 'subtle', 'Studies given to the model:'));
    for (const cite of draft.citations) {
      const line = el('div', 'cite');
      const label = el('b', '', `[${cite.n}] `);
      line.append(label);
      if (cite.url) {
        const link = el('a', '', cite.title);
        link.href = cite.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        line.append(link);
      } else {
        line.append(document.createTextNode(cite.title));
      }
      line.append(
        document.createTextNode(
          ` — ${[cite.venue, cite.year, cite.evidence].filter(Boolean).join(', ')}`
        )
      );
      citations.append(line);
    }
  }
}

async function refreshDraftAvailability() {
  try {
    const status = await api('/drafts/status');
    state.snippets = { opening: status.opening || '', closing: status.closing || '' };
    $('#wb-generate').title =
      'Builds the question, the ticked papers and their quoted conclusions into a draft';
    $('#wb-draft-hint').textContent =
      'The draft is built here from the ticked papers: each conclusion is quoted ' +
      'from its stored abstract, word for word. The reply itself is yours to write.';
  } catch {
    // Non-fatal: the button stays enabled and any failure surfaces on click.
  }
}

/**
 * The two reusable lines every draft is wrapped in, edited where they are
 * used and stored in the database.
 */
function renderSnippetEditor() {
  const box = $('#wb-snippets');
  const open = box.classList.toggle('hidden');
  if (open) return;

  box.innerHTML = '';
  const fields = [
    ['draft.opening', 'Opening line', state.snippets.opening],
    ['draft.closing', 'Closing line', state.snippets.closing],
  ];
  const inputs = {};
  for (const [key, label, value] of fields) {
    const wrap = el('label', '', label);
    const area = el('textarea');
    area.rows = 3;
    area.value = value;
    wrap.append(area);
    box.append(wrap);
    inputs[key] = area;
  }

  const row = el('div', 'row');
  const save = el('button', 'tiny', 'Save snippets');
  save.addEventListener('click', async () => {
    const entries = {
      'draft.opening': inputs['draft.opening'].value,
      'draft.closing': inputs['draft.closing'].value,
    };
    await saveSettings(entries);
    state.snippets = { opening: entries['draft.opening'], closing: entries['draft.closing'] };
    toast('Snippets saved — they apply to the next draft you build');
  });
  const hide = el('button', 'tiny ghost', 'Close');
  hide.addEventListener('click', () => box.classList.add('hidden'));
  row.append(save, hide);
  box.append(row);
  box.append(
    el('p', 'subtle', 'Either can be left empty. They are not applied to drafts already built.')
  );
}

function renderReply() {
  const bar = $('#wb-reply');
  const target = state.workbench.replyTarget;
  const draft = state.workbench.draft;
  bar.innerHTML = '';
  if (!target) return;

  for (const sent of target.already_posted || []) {
    const box = el('div', `reply-sent${sent.status === 'failed' ? ' failed' : ''}`);
    // A by-hand reply on Quora or a forum names the site, not the source that
    // found it: "on quora.com" reads better than "on Web search as quora.com".
    const bySite = BY_HAND_SOURCES.has(sent.provider) && sent.remote_id;
    const where = bySite ? sent.remote_id : SOURCE_LABELS[sent.provider] || sent.provider;
    box.append(
      document.createTextNode(
        `Replied ${relativeTime(sent.posted_at)} on ${where}` +
          `${
            sent.method === 'manual'
              ? ` by hand${!bySite && sent.remote_id ? ` as ${sent.remote_id}` : ''}`
              : ''
          }. `
      )
    );
    if (sent.url) {
      const link = el('a', '', 'View the reply ↗');
      link.href = sent.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      box.append(link);
    }
    bar.append(box);
  }

  const dest = el('div', 'dest');
  if (!target.can_reply) {
    if (target.manual_only) {
      // A real thread with no API: the dashboard hands over the draft and
      // keeps the record, the physician posts it.
      dest.append(document.createTextNode(target.reason));
    } else if (target.manual_account) {
      dest.append(document.createTextNode('You post as '));
      dest.append(el('b', '', target.manual_account.handle));
      dest.append(
        document.createTextNode(
          ` to ${target.description}. Copy the draft, paste it there, then mark it replied.`
        )
      );
    } else {
      dest.textContent = target.reason || 'This item cannot be replied to from the dashboard.';
    }
    bar.append(dest);
    const row = el('div', 'row');
    if (target.provider && !target.connected) {
      const connect = el(
        'button',
        'tiny ghost',
        target.manual_account
          ? 'Set up one-click posting'
          : `Link a ${target.provider_label} account`
      );
      connect.title = `Register a ${target.provider_label} app so the dashboard can post for you`;
      connect.addEventListener('click', () => showTab('sources'));
      row.append(connect);
    }
    const manual = manualReplyButton(target);
    if (manual) row.append(manual);
    const link = threadLink(target);
    if (link) row.append(link);
    const done = markRepliedButton(target);
    if (done) row.append(done);
    if (row.children.length) bar.append(row);
    return;
  }

  dest.append(document.createTextNode('Posts as '));
  dest.append(el('b', '', target.account_name));
  dest.append(document.createTextNode(` to ${target.description}.`));
  bar.append(dest);

  const row = el('div', 'row');
  const send = el('button', '', 'Post reply');
  send.disabled = !draft || !draft.content.trim();
  send.title = send.disabled ? 'Write or generate a draft first' : `Send to ${target.provider_label}`;
  send.addEventListener('click', () => postReply(target));
  row.append(send);

  const manual = manualReplyButton(target);
  if (manual) row.append(manual);

  const link = threadLink(target);
  if (link) row.append(link);
  bar.append(row);
}

/**
 * Records a reply pasted in by hand, so the feed and the reply log stay
 * accurate even where the dashboard cannot post for you.
 */
function markRepliedButton(target) {
  const draft = state.workbench.draft;
  if (!target.provider && !target.manual_only) return null;
  if (!draft || !draft.content.trim()) return null;

  const button = el('button', 'tiny ghost', 'Mark as replied');
  button.title = 'Record that you posted this yourself';
  button.addEventListener('click', async () => {
    const who = target.manual_account
      ? target.manual_account.handle
      : target.provider_label
        ? `your ${target.provider_label} account`
        : 'you';
    if (!confirm(`Record this draft as posted to ${target.description} as ${who}?`)) return;
    const url = prompt(
      'Link to your reply (optional — paste it so the record points at the right comment):',
      ''
    );
    try {
      const result = await api(`/drafts/${draft.id}/mark-replied`, {
        method: 'POST',
        body: { url: url || undefined },
      });
      toast(result.account ? `Recorded as ${result.account}` : 'Recorded');
      await loadSelection();
      refreshCounts();
    } catch (err) {
      toast(err.message, true);
    }
  });
  return button;
}

/** Opens the original thread, or the source page for a research result. */
function threadLink(target) {
  if (!target.target_url) return null;
  const link = el(
    'a',
    '',
    target.provider || target.manual_only ? 'Open the thread ↗' : 'Open the source ↗'
  );
  link.href = target.target_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

/**
 * The no-API path: copy the draft and open the thread so it can be pasted
 * into the platform's own reply box. Useful before an account is linked, and
 * as a fallback when a token has expired mid-session.
 */
function manualReplyButton(target) {
  const draft = state.workbench.draft;
  // Research results have no reply box to paste into.
  if (!target.provider && !target.manual_only) return null;
  if (!target.target_url) return null;
  if (!draft || !draft.content.trim()) return null;

  const button = el('button', 'tiny ghost', 'Copy draft & open thread');
  button.title = 'Copies the draft, then opens the thread so you can paste and post it yourself';
  button.addEventListener('click', async () => {
    const text = $('#wb-draft-text').value;
    let copied = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      copied = false;
    }
    window.open(target.target_url, '_blank', 'noopener');
    toast(
      copied
        ? 'Draft copied — paste it into the reply box'
        : 'Could not copy automatically — select the draft and copy it manually',
      !copied
    );
  });
  return button;
}

async function postReply(target) {
  const draft = state.workbench.draft;
  if (!draft) return;

  // Save any unsent edits first, so what goes out is what is on screen.
  const onScreen = $('#wb-draft-text').value;
  if (onScreen.trim() !== draft.content.trim()) await saveDraft();

  const current = state.workbench.draft;
  const warning = (target.already_posted || []).some((r) => r.status === 'posted')
    ? '\n\nYou have already replied to this thread once.'
    : '';
  const preview = current.content.trim().slice(0, 400);
  const ok = confirm(
    `Post this reply as ${target.account_name} to ${target.description}?` +
      `${warning}\n\n${preview}${current.content.trim().length > 400 ? '…' : ''}` +
      '\n\nThis publishes publicly and cannot be undone from the dashboard.'
  );
  if (!ok) return;

  const button = $('#wb-reply').querySelector('button');
  if (button) {
    button.disabled = true;
    button.textContent = 'Posting…';
  }
  try {
    const result = await api(`/drafts/${current.id}/post`, {
      method: 'POST',
      body: { confirm: true },
    });
    toast(`Posted as ${result.account}`);
    await loadSelection();
    refreshCounts();
  } catch (err) {
    toast(err.message, true);
    await loadSelection();
  }
}

/* --------------------------------------------- research column: the sweep */

/** Flips the left column between the per-question match and the daily sweep. */
function showResearchView(view) {
  state.researchView = view;
  $$('#research-views button').forEach((btn) =>
    btn.classList.toggle('is-active', btn.dataset.view === view)
  );
  $('#research-match-view').classList.toggle('hidden', view !== 'match');
  $('#research-sweep-view').classList.toggle('hidden', view !== 'sweep');
  $('#research-match-actions').classList.toggle('hidden', view !== 'match');
  $('#research-sweep-actions').classList.toggle('hidden', view !== 'sweep');
  if (view === 'sweep') loadSweep();
}

/**
 * Everything the daily keyword sweep and the PubMed pull have brought in,
 * newest first. These are articles, not questions, so they live here rather
 * than in the feed of things people asked.
 */
async function loadSweep() {
  try {
    const data = await api(`/items?source=${LITERATURE_SOURCES.join(',')}&limit=50`);
    const status = $('#sweep-status');
    status.innerHTML = '';
    status.append(el('span', '', `${data.total} article${data.total === 1 ? '' : 's'}`));

    const sweep = (state.health && state.health.sources.find((s) => s.id === 'literature')) || null;
    if (sweep) {
      status.append(
        el('span', '', sweep.last_run_at ? `last swept ${relativeTime(sweep.last_run_at)}` : 'never swept')
      );
      if (sweep.last_status && sweep.last_status !== 'ok') {
        status.append(el('span', '', `status: ${sweep.last_status}`));
      }
    }

    renderItems(
      $('#sweep-list'),
      data.items,
      'Nothing swept yet. The sweep runs the keywords above against six databases once a day — press "Sweep now" to run it immediately.',
      { pick: false }
    );
  } catch (err) {
    toast(err.message, true);
  }
}

/** Everything a match returns starts ticked; unticking narrows the draft. */
function setMatch(match) {
  state.workbench.match = match;
  state.workbench.picked = new Set(
    ((match && match.results) || []).map((_, index) => index)
  );
}

/** Loads the selected question into the middle and left columns. */
async function loadSelection() {
  const itemId = state.workbench.itemId;
  if (!itemId) {
    renderQuestion(null);
    setMatch(null);
    renderMatch(null);
    state.workbench.draft = null;
    state.workbench.drafts = [];
    state.workbench.replyTarget = null;
    renderDraft();
    renderReply();
    return;
  }

  try {
    const [item, match, draftData, replyTarget] = await Promise.all([
      api(`/items/${itemId}`),
      api(`/items/${itemId}/research`),
      api(`/items/${itemId}/drafts`),
      api(`/items/${itemId}/reply-target`),
    ]);

    // A slower request for a question the physician has already clicked past
    // must not overwrite the one now on screen.
    if (state.workbench.itemId !== itemId) return;

    setMatch(match);
    state.workbench.drafts = draftData.drafts;
    state.workbench.draft = draftData.drafts[0] || null;
    state.workbench.replyTarget = replyTarget;

    renderQuestion(item);
    renderMatch(match);
    renderDraft();
    renderReply();
  } catch (err) {
    toast(err.message, true);
  }
}

async function runMatch(refresh) {
  const itemId = state.workbench.itemId;
  if (!itemId) return;
  const buttons = [$('#wb-match'), $('#wb-rematch')];
  buttons.forEach((b) => {
    b.disabled = true;
  });
  $('#wb-match').textContent = 'Searching…';
  try {
    const match = await api(
      `/items/${itemId}/research${refresh ? '?refresh=true' : ''}`,
      { method: 'POST' }
    );
    setMatch(match);
    renderMatch(match);
    toast(
      match.no_strong_matches
        ? 'No strong match found for this question'
        : `${match.results.length} result(s) from ${
            match.providers.filter((p) => p.status === 'ok').length
          } databases`
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    buttons.forEach((b) => {
      b.disabled = false;
    });
    $('#wb-match').textContent = 'Match research';
  }
}

async function generateDraft() {
  const itemId = state.workbench.itemId;
  if (!itemId) return;

  const results = (state.workbench.match && state.workbench.match.results) || [];
  const use = [...state.workbench.picked].sort((a, b) => a - b);
  if (results.length && !use.length) {
    toast('Tick at least one paper on the left, or re-run the match', true);
    return;
  }

  const button = $('#wb-generate');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Building…';
  try {
    const data = await api(`/items/${itemId}/drafts`, {
      method: 'POST',
      body: { use },
    });
    state.workbench.drafts = [data.draft, ...state.workbench.drafts];
    state.workbench.draft = data.draft;
    renderDraft();
    renderReply();
    const built = data.draft.usage || {};
    toast(
      built.papers
        ? `Draft built from ${built.papers} paper(s), ${built.quoted || 0} with a quoted conclusion`
        : 'Draft built — no papers were ticked, so it cites nothing'
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function saveDraft() {
  const draft = state.workbench.draft;
  const content = $('#wb-draft-text').value;

  // Nothing generated yet: save what was typed as a draft of its own, so the
  // reply workflow does not depend on building one first.
  if (!draft) {
    if (!content.trim() || !state.workbench.itemId) return;
    try {
      const created = await api(`/items/${state.workbench.itemId}/drafts/manual`, {
        method: 'POST',
        body: { content },
      });
      state.workbench.drafts = [created.draft, ...state.workbench.drafts];
      state.workbench.draft = created.draft;
      renderDraft();
      renderReply();
      $('#wb-draft-saved').textContent = 'Saved';
      setTimeout(() => {
        $('#wb-draft-saved').textContent = '';
      }, 2000);
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  try {
    const updated = await api(`/drafts/${draft.id}`, {
      method: 'PUT',
      body: { content },
    });
    state.workbench.draft = updated;
    state.workbench.drafts = state.workbench.drafts.map((d) =>
      d.id === updated.id ? updated : d
    );
    renderDraft();
    renderReply();
    $('#wb-draft-saved').textContent = 'Saved';
    setTimeout(() => {
      $('#wb-draft-saved').textContent = '';
    }, 2000);
  } catch (err) {
    toast(err.message, true);
  }
}

/* ------------------------------------------------------------------- tabs */

function showTab(tab) {
  const changed = state.tab !== tab;
  state.tab = tab;
  $$('#tabs .tab').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  for (const name of ['feed', 'keywords', 'sources']) {
    $(`#panel-${name}`).classList.toggle('hidden', name !== tab);
  }
  if (!changed) return;
  if (tab === 'feed') {
    refreshCounts();
    loadFeed();
  }
  if (tab === 'keywords') loadKeywords();
  if (tab === 'sources') loadSources();
}

/**
 * The console is a full-height three-column layout, so it needs to know how
 * much room the sticky header above it takes.
 */
function trackHeaderHeight() {
  const stack = $('.topstack');
  const apply = () => {
    document.documentElement.style.setProperty(
      '--topstack-h',
      `${Math.round(stack.getBoundingClientRect().height)}px`
    );
  };
  apply();
  if (window.ResizeObserver) new ResizeObserver(apply).observe(stack);
  window.addEventListener('resize', apply);
}

/* ------------------------------------------------------------------- init */

/** Per-source enabled/configured state, used to explain an empty column. */
async function refreshHealth() {
  try {
    state.health = await api('/health');
  } catch {
    // Non-fatal: the empty states fall back to a generic message.
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function init() {
  $$('#tabs .tab').forEach((btn) =>
    btn.addEventListener('click', () => showTab(btn.dataset.tab))
  );

  $('#filter-source').addEventListener('change', (e) => {
    state.feed.source = e.target.value;
    state.feed.offset = 0;
    loadFeed();
  });
  $('#filter-keyword').addEventListener('change', (e) => {
    state.feed.keyword = e.target.value;
    state.feed.offset = 0;
    loadFeed();
  });
  $('#filter-status').addEventListener('change', (e) => {
    state.feed.status = e.target.value;
    state.feed.offset = 0;
    loadFeed();
  });
  $('#filter-q').addEventListener(
    'input',
    debounce((e) => {
      state.feed.q = e.target.value;
      state.feed.offset = 0;
      loadFeed();
    }, 300)
  );
  $('#feed-refresh').addEventListener('click', () => {
    refreshCounts();
    loadFeed();
  });
  $('#feed-prev').addEventListener('click', () => {
    state.feed.offset = Math.max(0, state.feed.offset - state.feed.limit);
    loadFeed();
  });
  $('#feed-next').addEventListener('click', () => {
    state.feed.offset += state.feed.limit;
    loadFeed();
  });

  $$('#research-views button').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.researchViewChosen = true;
      showResearchView(btn.dataset.view);
    })
  );
  $('#sweep-now').addEventListener('click', async () => {
    const button = $('#sweep-now');
    button.disabled = true;
    button.textContent = 'Sweeping…';
    try {
      const result = await api('/sources/literature/poll?force=true', { method: 'POST' });
      toast(
        result.ok
          ? `Sweep: ${result.added || 0} new article(s)${result.notes ? ` — ${result.notes}` : ''}`
          : `Sweep: ${result.error || result.message || result.skipped}`,
        !result.ok
      );
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Sweep now';
      await refreshHealth();
      loadSweep();
    }
  });
  $('#wb-match').addEventListener('click', () => runMatch(false));
  $('#wb-rematch').addEventListener('click', () => runMatch(true));
  $('#wb-generate').addEventListener('click', generateDraft);
  $('#wb-snippets-toggle').addEventListener('click', renderSnippetEditor);
  $('#wb-draft-save').addEventListener('click', saveDraft);
  $('#wb-draft-copy').addEventListener('click', async () => {
    const text = $('#wb-draft-text').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Draft copied');
    } catch {
      toast('Copy failed — select the text and copy manually', true);
    }
  });
  $('#wb-draft-delete').addEventListener('click', async () => {
    const draft = state.workbench.draft;
    if (!draft || !confirm('Delete this draft?')) return;
    try {
      await api(`/drafts/${draft.id}`, { method: 'DELETE' });
      state.workbench.drafts = state.workbench.drafts.filter((d) => d.id !== draft.id);
      state.workbench.draft = state.workbench.drafts[0] || null;
      renderDraft();
      toast('Draft deleted');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#keyword-bar-form').addEventListener('submit', addKeywordFromBar);
  $('#keyword-bar-manage').addEventListener('click', () => showTab('keywords'));

  $('#keyword-form').addEventListener('submit', submitKeyword);
  $('#keyword-cancel').addEventListener('click', resetKeywordForm);
  $$('input[name="scope"]').forEach((input) =>
    input.addEventListener('change', syncScopeVisibility)
  );

  syncScopeVisibility();
  trackHeaderHeight();
  loadKeywordBar();
  refreshDraftAvailability();
  refreshHealth().then(() => {
    refreshCounts();
    loadFeed();
  });

  // Keep the feed reasonably live without hammering the API.
  setInterval(() => {
    if (state.tab === 'feed' && !(document.activeElement || document.body).closest('.col-draft')) {
      refreshCounts();
      loadFeed();
    } else if (state.tab === 'sources') {
      loadSources();
    }
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
