'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('api-research');
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

const { app } = require('../src/server');
const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');
const research = require('../src/research');
const researchStore = require('../src/lib/researchStore');

keywords.create({ term: 'phantom limb pain' });
ingest(
  'reddit',
  [
    {
      external_id: 't3_q1',
      author: 'u/newamputee',
      text: 'Does mirror therapy help phantom limb pain after a below knee amputation?',
      url: 'https://www.reddit.com/r/amputee/comments/q1/',
      timestamp: '2026-09-01T00:00:00Z',
      kind: 'post',
      origin: 'r/amputee',
    },
  ],
  matcherFor('reddit')
);
const question = items.query({ source: 'reddit' }).items[0];

let base;
let server;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

async function call(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

const RESEARCH_ROUTES = {
  'esearch.fcgi': { body: { esearchresult: { idlist: ['1'] } } },
  'esummary.fcgi': {
    body: {
      result: {
        uids: ['1'],
        1: {
          uid: '1',
          title: 'Mirror therapy for phantom limb pain: a systematic review',
          authors: [{ name: 'Smith J' }],
          sortpubdate: '2024/01/01 00:00',
          fulljournalname: 'Pain Medicine',
          pubtype: ['Systematic Review'],
          articleids: [{ idtype: 'doi', value: '10.1000/mirror' }],
        },
      },
    },
  },
  'efetch.fcgi': {
    body: '<PubmedArticleSet><PubmedArticle><PMID>1</PMID><AbstractText>Mirror therapy reduces phantom limb pain in pooled trials of below knee amputation patients.</AbstractText></PubmedArticle></PubmedArticleSet>',
    headers: { 'content-type': 'text/xml' },
  },
  'ebi.ac.uk/europepmc': { body: { resultList: { result: [] } } },
  'api.crossref.org': { body: { message: { items: [] } } },
  'api.semanticscholar.org': { body: { data: [] } },
  'api.openalex.org': { body: { results: [] } },
  'clinicaltrials.gov/api/v2': { body: { studies: [] } },
};

function sseStream(text) {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, usage: { input_tokens: 500, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 200 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return {
    body: events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join(''),
    headers: { 'content-type': 'text/event-stream' },
  };
}

test('research is absent until it is run', async () => {
  const { status, data } = await call(`/api/items/${question.id}/research`);
  assert.equal(status, 200);
  assert.equal(data.exists, false);
});

test('POST runs the match and GET then serves it from cache', async () => {
  research.resetRateLimiter();
  const mock = mockFetch(RESEARCH_ROUTES);
  let ran;
  try {
    ran = await call(`/api/items/${question.id}/research`, { method: 'POST' });
  } finally {
    mock.restore();
  }
  assert.equal(ran.status, 200);
  assert.equal(ran.data.cached, false);
  assert.equal(ran.data.results.length, 1);
  assert.equal(ran.data.results[0].evidence.level, 1);

  const cached = await call(`/api/items/${question.id}/research`);
  assert.equal(cached.data.exists, true);
  assert.equal(cached.data.cached, true);
  assert.equal(cached.data.results[0].title, ran.data.results[0].title);
});

test('research for a missing item is a 404', async () => {
  assert.equal((await call('/api/items/99999/research')).status, 404);
  assert.equal((await call('/api/items/99999/research', { method: 'POST' })).status, 404);
});

test('provider list reports which databases are enabled', async () => {
  const { data } = await call('/api/research/providers');
  assert.deepEqual(
    data.providers.map((p) => p.id),
    ['pubmed', 'europepmc', 'crossref', 'semanticscholar', 'openalex', 'clinicaltrials']
  );
  assert.ok(data.providers.every((p) => p.enabled));
  assert.equal(data.cache.matched_items, 1);
});

test('draft status reports whether the API key is present', async () => {
  const { data } = await call('/api/drafts/status');
  assert.equal(data.configured, true);
  assert.equal(data.model, 'claude-opus-5');
});

test('generating a draft stores it against the question', async () => {
  const mock = mockFetch({ 'api.anthropic.com': () => sseStream('Mirror therapy has decent evidence [1].') });
  let created;
  try {
    created = await call(`/api/items/${question.id}/drafts`, { method: 'POST' });
  } finally {
    mock.restore();
  }
  assert.equal(created.status, 201);
  assert.equal(created.data.draft.status, 'draft');
  assert.match(created.data.draft.content, /Mirror therapy/);
  assert.equal(created.data.draft.citations.length, 1);
  assert.equal(created.data.match_used.count, 1);

  const listed = await call(`/api/items/${question.id}/drafts`);
  assert.equal(listed.data.drafts.length, 1);
});

test('editing a draft saves the text and flips it to edited', async () => {
  const { data } = await call(`/api/items/${question.id}/drafts`);
  const draft = data.drafts[0];

  const saved = await call(`/api/drafts/${draft.id}`, {
    method: 'PUT',
    body: { content: 'My edited version.' },
  });
  assert.equal(saved.data.content, 'My edited version.');
  assert.equal(saved.data.status, 'edited');

  const used = await call(`/api/drafts/${draft.id}`, { method: 'PATCH', body: { status: 'used' } });
  assert.equal(used.data.status, 'used');

  const bad = await call(`/api/drafts/${draft.id}`, { method: 'PATCH', body: { status: 'posted' } });
  assert.equal(bad.status, 400);

  assert.equal((await call(`/api/drafts/${draft.id}`, { method: 'PUT', body: {} })).status, 400);
  assert.equal((await call(`/api/drafts/${draft.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/drafts/${draft.id}`, { method: 'DELETE' })).status, 404);
});

test('an Anthropic failure is reported without storing a draft', async () => {
  const mock = mockFetch({
    'api.anthropic.com': { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } },
  });
  let attempt;
  try {
    attempt = await call(`/api/items/${question.id}/drafts`, { method: 'POST' });
  } finally {
    mock.restore();
  }
  assert.equal(attempt.status, 429);
  assert.match(attempt.data.error, /rate limit/i);
  assert.equal((await call(`/api/items/${question.id}/drafts`)).data.drafts.length, 0);
});

test('only the ticked papers are handed to the model', async () => {
  // Three cached papers; the console ticks the first and the third.
  researchStore.save(question.id, {
    terms: ['phantom limb pain'],
    results: [1, 2, 3].map((n) => ({
      title: `Paper ${n}`,
      venue: 'Journal',
      year: 2020 + n,
      url: `https://doi.org/10.1000/p${n}`,
      sources: ['pubmed'],
      evidence: { level: 2, label: 'Randomized trial', preprint: false },
      abstract: `Findings of paper ${n}.`,
    })),
    providers: [{ id: 'pubmed', status: 'ok', count: 3 }],
    no_strong_matches: true,
    note: 'nothing matched strongly',
    considered: 3,
  });

  let sent;
  const mock = mockFetch({
    'api.anthropic.com': (url, options) => {
      sent = JSON.parse(options.body);
      return sseStream('Two papers looked at this [1][2].');
    },
  });
  let created;
  try {
    created = await call(`/api/items/${question.id}/drafts`, {
      method: 'POST',
      body: { use: [0, 2] },
    });
  } finally {
    mock.restore();
  }

  assert.equal(created.status, 201);
  assert.equal(created.data.match_used.count, 2);
  assert.deepEqual(
    created.data.draft.citations.map((c) => c.title),
    ['Paper 1', 'Paper 3']
  );

  const prompt = sent.messages[0].content;
  assert.match(prompt, /\[1\] Paper 1/);
  assert.match(prompt, /\[2\] Paper 3/);
  assert.ok(!prompt.includes('Paper 2'), 'the unticked paper is not sent');
  // Picking by hand is the physician's own relevance call.
  assert.match(prompt, /physician read the retrieved research/);
  assert.ok(!prompt.includes('no strong match'), 'the automatic verdict is dropped');

  await call(`/api/items/${question.id}/drafts`).then(({ data }) =>
    Promise.all(
      data.drafts.map((d) => call(`/api/drafts/${d.id}`, { method: 'DELETE' }))
    )
  );
});

test('ticking every paper is the same as ticking none', async () => {
  let sent;
  const mock = mockFetch({
    'api.anthropic.com': (url, options) => {
      sent = JSON.parse(options.body);
      return sseStream('All three [1][2][3].');
    },
  });
  let created;
  try {
    created = await call(`/api/items/${question.id}/drafts`, {
      method: 'POST',
      body: { use: [0, 1, 2] },
    });
  } finally {
    mock.restore();
  }
  assert.equal(created.data.match_used.count, 3);
  // The whole set is not a hand-picked subset, so the honest verdict stands.
  assert.match(sent.messages[0].content, /no strong match/);
});

test('existing feed and keyword endpoints still work', async () => {
  assert.equal((await call('/api/items')).data.items.length, 1);
  assert.equal((await call('/api/keywords')).data.keywords.length, 1);
  assert.equal((await call('/api/health')).data.ok, true);
});
