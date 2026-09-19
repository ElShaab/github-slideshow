/* Amputee research dashboard - plain-JS single page front end. */
'use strict';

const SOURCE_LABELS = {
  reddit: 'Reddit',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  pubmed: 'PubMed',
  websearch: 'Web search',
};

const STATUSES = ['new', 'reviewed', 'used'];

const state = {
  tab: 'feed',
  keywords: [],
  settings: {},
  feed: { source: '', keyword: '', status: '', q: '', limit: 50, offset: 0, total: 0 },
  editingKeyword: null,
  workbench: { itemId: null, items: [], match: null, draft: null, drafts: [] },
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

  const research = el('button', 'tiny ghost', 'Research →');
  research.title = 'Match this question against the research databases';
  research.addEventListener('click', () => openInWorkbench(item.id));
  foot.append(research);

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
  if (source.id === 'websearch') card.append(websearchControls(source));

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
      'Queried per question from the Workbench tab, not on a schedule. Results are merged, deduplicated and ranked by evidence quality.'
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
  return card;
}

async function loadSources() {
  try {
    state.settings = await api('/settings');
    const data = await api('/sources');
    const container = $('#source-cards');
    container.innerHTML = '';
    for (const source of data.sources) container.append(sourceCard(source));
    try {
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

/* -------------------------------------------------------------- workbench */

const EVIDENCE_HINT = {
  1: 'Strongest: pooled trials or an official guideline',
  2: 'Randomized controlled trial',
  3: 'Trial or cohort study',
  4: 'Observational study',
  5: 'Weakest: single case, opinion, or not peer reviewed',
};

function openInWorkbench(itemId) {
  state.workbench.itemId = itemId;
  showTab('workbench');
}

async function loadWorkbenchQuestions() {
  const scope = $('#wb-scope').value;
  const params = new URLSearchParams({ limit: '100' });
  if (scope) params.set('status', scope);
  const data = await api(`/items?${params}`);
  state.workbench.items = data.items;

  // A question opened from the feed stays selected even when the status
  // filter would hide it - the click was explicit.
  const wanted = state.workbench.itemId;
  if (wanted && !data.items.some((i) => i.id === wanted)) {
    try {
      const pinned = await api(`/items/${wanted}`);
      state.workbench.items = [pinned, ...data.items];
    } catch {
      // The item is gone; fall through to the filtered list.
    }
  }

  const select = $('#wb-question');
  select.innerHTML = '';
  if (!state.workbench.items.length) {
    const option = el('option', '', 'No questions match this filter');
    option.value = '';
    select.append(option);
  }
  for (const item of state.workbench.items) {
    const option = el(
      'option',
      '',
      `${SOURCE_LABELS[item.source] || item.source} · ${item.text.slice(0, 80).replace(/\s+/g, ' ')}`
    );
    option.value = String(item.id);
    select.append(option);
  }
  if (
    !state.workbench.itemId ||
    !state.workbench.items.some((i) => i.id === state.workbench.itemId)
  ) {
    state.workbench.itemId = state.workbench.items.length
      ? state.workbench.items[0].id
      : null;
  }
  select.value = state.workbench.itemId ? String(state.workbench.itemId) : '';
}

function renderQuestion(item) {
  const card = $('#wb-question-card');
  card.innerHTML = '';
  if (!item) {
    card.append(el('div', 'empty', 'Pick a question to get started.'));
    return;
  }

  const head = el('div', 'item-head');
  head.append(el('span', `badge source-${item.source}`, SOURCE_LABELS[item.source] || item.source));
  if (item.origin && item.origin !== item.author) head.append(el('span', '', item.origin));
  if (item.author) head.append(el('span', '', item.author));
  head.append(el('span', '', relativeTime(item.timestamp)));
  card.append(head);

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

function resultCard(result) {
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
  return card;
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
  for (const result of match.results) results.append(resultCard(result));
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
    draft.model,
    usage.output_tokens ? `${usage.output_tokens} output tokens` : null,
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
    const button = $('#wb-generate');
    button.disabled = !status.configured;
    button.title = status.configured
      ? `Generates with ${status.model}`
      : 'ANTHROPIC_API_KEY is not set';
    $('#wb-draft-hint').textContent = status.configured
      ? 'Drafts are written from the matched research on the right, for your review only. Nothing is posted anywhere.'
      : 'Set ANTHROPIC_API_KEY (a Replit secret or environment variable) and restart to enable draft generation. You can still write and save drafts by hand here.';
  } catch {
    // Non-fatal: the button stays enabled and any failure surfaces on click.
  }
}

async function loadWorkbench() {
  try {
    await Promise.all([loadWorkbenchQuestions(), refreshDraftAvailability()]);
    const itemId = state.workbench.itemId;
    if (!itemId) {
      renderQuestion(null);
      renderMatch(null);
      state.workbench.draft = null;
      state.workbench.drafts = [];
      renderDraft();
      return;
    }

    const [item, match, draftData] = await Promise.all([
      api(`/items/${itemId}`),
      api(`/items/${itemId}/research`),
      api(`/items/${itemId}/drafts`),
    ]);

    state.workbench.match = match;
    state.workbench.drafts = draftData.drafts;
    state.workbench.draft = draftData.drafts[0] || null;

    renderQuestion(item);
    renderMatch(match);
    renderDraft();
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
    state.workbench.match = match;
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
  const button = $('#wb-generate');
  button.disabled = true;
  button.textContent = 'Generating…';
  try {
    const data = await api(`/items/${itemId}/drafts`, { method: 'POST' });
    state.workbench.drafts = [data.draft, ...state.workbench.drafts];
    state.workbench.draft = data.draft;
    renderDraft();
    toast('Draft generated — review before using');
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Generate draft';
  }
}

async function saveDraft() {
  const draft = state.workbench.draft;
  if (!draft) return;
  try {
    const updated = await api(`/drafts/${draft.id}`, {
      method: 'PUT',
      body: { content: $('#wb-draft-text').value },
    });
    state.workbench.draft = updated;
    state.workbench.drafts = state.workbench.drafts.map((d) =>
      d.id === updated.id ? updated : d
    );
    renderDraft();
    $('#wb-draft-saved').textContent = 'Saved';
    setTimeout(() => {
      $('#wb-draft-saved').textContent = '';
    }, 2000);
  } catch (err) {
    toast(err.message, true);
  }
}

function stepQuestion(delta) {
  const list = state.workbench.items;
  if (!list.length) return;
  const index = list.findIndex((i) => i.id === state.workbench.itemId);
  const next = list[Math.min(Math.max(index + delta, 0), list.length - 1)];
  if (!next || next.id === state.workbench.itemId) return;
  state.workbench.itemId = next.id;
  loadWorkbench();
}

/* ------------------------------------------------------------------- tabs */

function showTab(tab) {
  state.tab = tab;
  $$('#tabs .tab').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  for (const name of ['feed', 'workbench', 'research', 'keywords', 'sources']) {
    $(`#panel-${name}`).classList.toggle('hidden', name !== tab);
  }
  if (tab === 'feed') {
    refreshCounts();
    loadFeed();
  }
  if (tab === 'workbench') loadWorkbench();
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

  $('#wb-question').addEventListener('change', (e) => {
    state.workbench.itemId = Number(e.target.value) || null;
    loadWorkbench();
  });
  $('#wb-scope').addEventListener('change', () => {
    state.workbench.itemId = null;
    loadWorkbench();
  });
  $('#wb-prev').addEventListener('click', () => stepQuestion(-1));
  $('#wb-next').addEventListener('click', () => stepQuestion(1));
  $('#wb-match').addEventListener('click', () => runMatch(false));
  $('#wb-rematch').addEventListener('click', () => runMatch(true));
  $('#wb-generate').addEventListener('click', generateDraft);
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
