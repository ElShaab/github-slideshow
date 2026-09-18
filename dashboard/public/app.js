/* Amputee research dashboard - plain-JS single page front end. */
'use strict';

const SOURCE_LABELS = {
  reddit: 'Reddit',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  pubmed: 'PubMed',
};

const STATUSES = ['new', 'reviewed', 'used'];

const state = {
  tab: 'feed',
  keywords: [],
  settings: {},
  feed: { source: '', keyword: '', status: '', q: '', limit: 50, offset: 0, total: 0 },
  editingKeyword: null,
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

function itemCard(item) {
  const card = el('div', 'item');
  card.dataset.status = item.status;

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

  const body = el('div', 'item-text clamped', item.text);
  body.title = 'Click to expand';
  body.addEventListener('click', () => body.classList.toggle('clamped'));
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

function renderItems(container, items, emptyMessage) {
  container.innerHTML = '';
  if (!items.length) {
    container.append(el('div', 'empty', emptyMessage));
    return;
  }
  for (const item of items) container.append(itemCard(item));
}

async function loadFeed() {
  const params = new URLSearchParams();
  const f = state.feed;
  if (f.source) params.set('source', f.source);
  if (f.keyword) params.set('keyword', f.keyword);
  if (f.status) params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  params.set('limit', String(f.limit));
  params.set('offset', String(f.offset));

  try {
    const data = await api(`/items?${params}`);
    state.feed.total = data.total;
    renderItems(
      $('#feed-list'),
      data.items,
      'Nothing here yet. Add keywords, then poll a source from the Sources tab.'
    );
    const from = data.total === 0 ? 0 : f.offset + 1;
    const to = Math.min(f.offset + f.limit, data.total);
    $('#feed-range').textContent = `${from}-${to} of ${data.total}`;
    $('#feed-prev').disabled = f.offset === 0;
    $('#feed-next').disabled = f.offset + f.limit >= data.total;
  } catch (err) {
    toast(err.message, true);
  }
}

async function refreshCounts() {
  try {
    const summary = await api('/items/summary');
    const counts = $('#feed-counts');
    counts.innerHTML = '';
    counts.append(el('span', '', `${summary.total} items`));
    for (const [source, stats] of Object.entries(summary.bySource)) {
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
        toast(`${source.label}: ${result.added || 0} new item(s) from ${result.fetched || 0} fetched`);
      } else {
        toast(`${source.label}: ${result.error || result.message || result.skipped}`, true);
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      loadSources();
      refreshCounts();
      if (state.tab === 'feed') loadFeed();
      if (state.tab === 'research') loadResearch();
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

  return card;
}

function redditControls(source) {
  const wrap = el('div');
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

async function loadSources() {
  try {
    state.settings = await api('/settings');
    const data = await api('/sources');
    const container = $('#source-cards');
    container.innerHTML = '';
    for (const source of data.sources) container.append(sourceCard(source));

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

/* --------------------------------------------------------------- research */

async function loadResearch() {
  try {
    state.settings = await api('/settings');
    $('#pubmed-reldate').value = state.settings['pubmed.reldate_days'];
    $('#pubmed-max').value = state.settings['pubmed.max_results'];

    const sources = await api('/sources');
    const pubmed = sources.sources.find((s) => s.id === 'pubmed');
    if (pubmed) {
      $('#pubmed-status').textContent = pubmed.last_run_at
        ? `Last pull ${relativeTime(pubmed.last_run_at)} (${pubmed.last_status})`
        : 'Not pulled yet';
      $('#pubmed-query').textContent =
        pubmed.details.example_term || 'Add PubMed keywords to build a query.';
    }

    const data = await api('/items?source=pubmed&limit=50');
    renderItems(
      $('#research-list'),
      data.items,
      'No articles yet. Add research keywords, then use "Pull now".'
    );
  } catch (err) {
    toast(err.message, true);
  }
}

/* ------------------------------------------------------------------- tabs */

function showTab(tab) {
  state.tab = tab;
  $$('#tabs .tab').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  for (const name of ['feed', 'research', 'keywords', 'sources']) {
    $(`#panel-${name}`).classList.toggle('hidden', name !== tab);
  }
  if (tab === 'feed') {
    refreshCounts();
    loadFeed();
  }
  if (tab === 'keywords') loadKeywords();
  if (tab === 'sources') loadSources();
  if (tab === 'research') loadResearch();
}

/* ------------------------------------------------------------------- init */

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

  $('#keyword-form').addEventListener('submit', submitKeyword);
  $('#keyword-cancel').addEventListener('click', resetKeywordForm);
  $$('input[name="scope"]').forEach((input) =>
    input.addEventListener('change', syncScopeVisibility)
  );

  $('#pubmed-save').addEventListener('click', async () => {
    await saveSettings({
      'pubmed.reldate_days': $('#pubmed-reldate').value,
      'pubmed.max_results': $('#pubmed-max').value,
    });
    toast('Research settings saved');
  });
  $('#pubmed-poll').addEventListener('click', async () => {
    const button = $('#pubmed-poll');
    button.disabled = true;
    button.textContent = 'Pulling…';
    try {
      const result = await api('/sources/pubmed/poll?force=true', { method: 'POST' });
      toast(
        result.ok
          ? `PubMed: ${result.added || 0} new article(s)`
          : `PubMed: ${result.error || result.message || result.skipped}`,
        !result.ok
      );
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Pull now';
      loadResearch();
    }
  });

  syncScopeVisibility();
  showTab('feed');

  // Keep the feed reasonably live without hammering the API.
  setInterval(() => {
    if (state.tab === 'feed') {
      refreshCounts();
      loadFeed();
    } else if (state.tab === 'sources') {
      loadSources();
    }
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
