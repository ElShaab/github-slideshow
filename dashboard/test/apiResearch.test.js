'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('api-research');

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

test('draft status reports the local mode and the stored snippets', async () => {
  const { data } = await call('/api/drafts/status');
  assert.equal(data.mode, 'local');
  assert.equal(data.configured, true, 'there is nothing to configure');
  assert.equal(typeof data.opening, 'string');
  assert.equal(typeof data.closing, 'string');
});

test('building a draft stores it against the question, with no network call', async () => {
  // Any outbound request at all would be a bug: the draft is built from the
  // database alone.
  const mock = mockFetch({});
  let created;
  try {
    created = await call(`/api/items/${question.id}/drafts`, { method: 'POST' });
  } finally {
    mock.restore();
  }
  const outbound = mock.calls.filter((url) => !/127\.0\.0\.1|localhost/.test(url));
  assert.deepEqual(outbound, [], 'nothing outside this process was fetched');
  assert.equal(created.status, 201);
  assert.equal(created.data.draft.status, 'draft');
  assert.equal(created.data.draft.model, null);
  assert.equal(created.data.draft.usage.composed, true);
  assert.match(created.data.draft.content, /QUESTION/);
  assert.match(created.data.draft.content, /WRITE YOUR REPLY HERE/);
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

test('the snippets stored in settings are what a built draft carries', async () => {
  await call('/api/settings', {
    method: 'PUT',
    body: { 'draft.opening': 'Opening from settings.', 'draft.closing': 'Closing from settings.' },
  });
  const built = await call(`/api/items/${question.id}/drafts`, { method: 'POST' });
  assert.match(built.data.draft.content, /Opening from settings\./);
  assert.match(built.data.draft.content, /Closing from settings\./);
  await call(`/api/drafts/${built.data.draft.id}`, { method: 'DELETE' });
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

  const created = await call(`/api/items/${question.id}/drafts`, {
    method: 'POST',
    body: { use: [0, 2] },
  });

  assert.equal(created.status, 201);
  assert.equal(created.data.match_used.count, 2);
  assert.deepEqual(
    created.data.draft.citations.map((c) => c.title),
    ['Paper 1', 'Paper 3']
  );

  const draft = created.data.draft.content;
  assert.match(draft, /\[1\] Paper 1/);
  assert.match(draft, /\[2\] Paper 3/);
  assert.ok(!draft.includes('Paper 2'), 'the unticked paper is left out');
  // Each ticked paper's own conclusion, quoted.
  assert.match(draft, /"Findings of paper 1\."/);
  assert.match(draft, /"Findings of paper 3\."/);

  await call(`/api/items/${question.id}/drafts`).then(({ data }) =>
    Promise.all(
      data.drafts.map((d) => call(`/api/drafts/${d.id}`, { method: 'DELETE' }))
    )
  );
});

test('ticking every paper is the same as ticking none', async () => {
  const created = await call(`/api/items/${question.id}/drafts`, {
    method: 'POST',
    body: { use: [0, 1, 2] },
  });
  assert.equal(created.data.match_used.count, 3);
  assert.match(created.data.draft.content, /\[3\] Paper 3/);
  await call(`/api/drafts/${created.data.draft.id}`, { method: 'DELETE' });
});

test('a draft can be written by hand with no model involved', async () => {
  const written = await call(`/api/items/${question.id}/drafts/manual`, {
    method: 'POST',
    body: { content: 'Written by hand, no API key needed.' },
  });
  assert.equal(written.status, 201);
  assert.equal(written.data.draft.model, null);
  assert.equal(written.data.draft.status, 'draft');
  assert.equal(written.data.draft.content, 'Written by hand, no API key needed.');

  // It behaves like any other draft from there on.
  const edited = await call(`/api/drafts/${written.data.draft.id}`, {
    method: 'PUT',
    body: { content: 'Reworded by hand.' },
  });
  assert.equal(edited.data.status, 'edited');

  assert.equal(
    (await call(`/api/items/${question.id}/drafts/manual`, { method: 'POST', body: { content: '  ' } }))
      .status,
    400,
    'an empty draft is not stored'
  );
  assert.equal(
    (await call('/api/items/99999/drafts/manual', { method: 'POST', body: { content: 'x' } })).status,
    404
  );

  await call(`/api/drafts/${written.data.draft.id}`, { method: 'DELETE' });
});

test('existing feed and keyword endpoints still work', async () => {
  assert.equal((await call('/api/items')).data.items.length, 1);
  assert.equal((await call('/api/keywords')).data.keywords.length, 1);
  assert.equal((await call('/api/health')).data.ok, true);
});
