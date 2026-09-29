'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('literature');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const state = require('../src/lib/state');
const research = require('../src/research');
const literature = require('../src/sources/literature');

keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'osseointegration' });

const RECENT = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const OLD = '2011-03-02';

function routes({ crossrefStatus } = {}) {
  return {
    'esearch.fcgi': { body: { esearchresult: { idlist: ['41000001'] } } },
    'esummary.fcgi': {
      body: {
        result: {
          uids: ['41000001'],
          41000001: {
            uid: '41000001',
            title: 'Gabapentin for phantom limb pain: a randomized controlled trial',
            authors: [{ name: 'Ng A' }],
            sortpubdate: `${RECENT.replace(/-/g, '/')} 00:00`,
            fulljournalname: 'Pain',
            pubtype: ['Randomized Controlled Trial'],
            articleids: [{ idtype: 'doi', value: '10.1000/gaba' }],
          },
        },
      },
    },
    'efetch.fcgi': {
      body:
        '<PubmedArticleSet><PubmedArticle><PMID>41000001</PMID>' +
        '<AbstractText>A randomized trial of gabapentin for phantom limb pain after amputation.</AbstractText>' +
        '</PubmedArticle></PubmedArticleSet>',
      headers: { 'content-type': 'text/xml' },
    },
    'ebi.ac.uk/europepmc': {
      body: {
        resultList: {
          result: [
            {
              id: '41000001', source: 'MED', pmid: '41000001', doi: '10.1000/gaba',
              title: 'Gabapentin for phantom limb pain: a randomized controlled trial',
              abstractText: 'Europe PMC copy of the same phantom limb pain trial abstract.',
              pubYear: String(new Date().getFullYear()),
              firstPublicationDate: RECENT,
              journalInfo: { journal: { title: 'Pain' } },
              authorString: 'Ng A', citedByCount: 3, isOpenAccess: 'Y',
              pubTypeList: { pubType: ['Randomized Controlled Trial'] },
            },
            {
              id: 'OLD1', source: 'MED', doi: '10.1000/ancient',
              title: 'Phantom limb pain: a 2011 narrative review',
              abstractText: 'An older narrative review of phantom limb pain.',
              pubYear: '2011', firstPublicationDate: OLD,
              journalInfo: { journal: { title: 'Old Journal' } },
              pubTypeList: { pubType: ['review'] },
            },
          ],
        },
      },
    },
    'api.crossref.org': crossrefStatus
      ? { status: crossrefStatus, body: { error: 'boom' } }
      : { body: { message: { items: [] } } },
    'api.semanticscholar.org': { body: { data: [] } },
    'api.openalex.org': {
      body: {
        results: [
          {
            id: 'https://openalex.org/W9', doi: 'https://doi.org/10.1000/unrelated',
            display_name: 'Corrosion resistance of titanium fasteners in marine environments',
            publication_year: new Date().getFullYear(),
            publication_date: RECENT,
            cited_by_count: 4, type: 'article',
            primary_location: { source: { display_name: 'Materials Today' } },
            open_access: { is_oa: false },
          },
        ],
      },
    },
    'clinicaltrials.gov/api/v2': { body: { studies: [] } },
  };
}

test('a sweep captures recent work for each keyword and files it in the feed', async () => {
  research.resetRateLimiter();
  settings.set('literature.max_keywords', '2');
  state.setCursor('literature', 0);

  const seen = [];
  const mock = mockFetch(
    Object.fromEntries(
      Object.entries(routes()).map(([k, v]) => [k, (url) => { seen.push(url); return v; }])
    )
  );
  let result;
  try {
    result = await literature.poll();
  } finally {
    mock.restore();
  }

  assert.equal(result.added, 1, `one distinct new article: ${JSON.stringify(result)}`);
  assert.match(result.notes, /2 of 2 keyword\(s\) swept, last 30 days/);

  const captured = items.query({ source: 'literature' }).items;
  assert.equal(captured.length, 1);
  const article = captured[0];
  assert.equal(article.external_id, 'doi:10.1000/gaba', 'identity is the DOI');
  assert.equal(article.keyword_matched, 'phantom limb pain');
  assert.equal(article.kind, 'article');
  assert.equal(article.origin, 'Pain');
  assert.equal(article.meta.evidence.level, 2);
  assert.equal(article.meta.open_access, true);
  assert.deepEqual(article.meta.databases.sort(), ['europepmc', 'pubmed']);
  assert.equal(article.timestamp.slice(0, 10), RECENT);
});

test('the date window is asked for and enforced', async () => {
  const seen = [];
  research.resetRateLimiter();
  state.setCursor('literature', 0);
  const mock = mockFetch(
    Object.fromEntries(
      Object.entries(routes()).map(([k, v]) => [k, (url) => { seen.push(url); return v; }])
    )
  );
  try {
    await literature.poll();
  } finally {
    mock.restore();
  }

  const pubmed = seen.find((u) => u.includes('esearch.fcgi'));
  assert.match(pubmed, /reldate=30/);
  assert.match(pubmed, /datetype=edat/);
  assert.ok(seen.some((u) => u.includes('ebi.ac.uk') && u.includes('FIRST_PDATE')));
  assert.ok(seen.some((u) => u.includes('openalex') && u.includes('from_publication_date')));
  assert.ok(seen.some((u) => u.includes('crossref') && u.includes('from-pub-date')));
  assert.ok(seen.some((u) => u.includes('semanticscholar') && u.includes('publicationDateOrYear')));
  assert.ok(seen.some((u) => u.includes('clinicaltrials') && u.includes('LastUpdatePostDate')));
});

test('a stale result is dropped even when the API ignores the filter', () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  assert.equal(literature.isRecent({ published_on: RECENT }, cutoff), true);
  assert.equal(literature.isRecent({ published_on: OLD }, cutoff), false);
  assert.equal(literature.isRecent({ year: 2011 }, cutoff), false);
  assert.equal(literature.isRecent({ registry: true, year: 2009 }, cutoff), true, 'trials are judged on status, not age');
  assert.equal(literature.isRecent({}, cutoff), true, 'undated work is left to relevance');
});

test('off-topic results are dropped rather than filed', () => {
  // The OpenAlex fixture returns a titanium-fastener paper for every query.
  const captured = items.query({ source: 'literature' }).items;
  assert.ok(!captured.some((i) => /corrosion/i.test(i.text)));
});

test('re-running the sweep adds nothing new', async () => {
  research.resetRateLimiter();
  settings.set('literature.max_keywords', '2');
  state.setCursor('literature', 0);
  const mock = mockFetch(routes());
  let result;
  try {
    result = await literature.poll();
  } finally {
    mock.restore();
  }
  assert.equal(result.added, 0);
  assert.ok(result.duplicates > 0);
});

test('keywords rotate so every term gets swept over successive runs', async () => {
  research.resetRateLimiter();
  settings.set('literature.max_keywords', '1');
  state.setCursor('literature', 0);
  const asked = [];
  const mock = mockFetch({
    ...routes(),
    'esearch.fcgi': (url) => {
      asked.push(decodeURIComponent(new URL(url).searchParams.get('term')));
      return { body: { esearchresult: { idlist: [] } } };
    },
  });
  try {
    await literature.poll();
    await literature.poll();
  } finally {
    mock.restore();
  }
  // The keyword list is alphabetical, so this one comes round first.
  assert.match(asked[0], /osseointegration/);
  assert.match(asked[1], /phantom limb pain/);
});

test('one database failing does not stop the sweep', async () => {
  research.resetRateLimiter();
  settings.set('literature.max_keywords', '1');
  state.setCursor('literature', 0);
  const mock = mockFetch(routes({ crossrefStatus: 500 }));
  let result;
  try {
    result = await literature.poll();
  } finally {
    mock.restore();
  }
  assert.match(result.notes, /database failures: Crossref ×1/);
});

test('with no keywords the sweep says so instead of querying', async () => {
  const all = keywords.list();
  for (const k of all) keywords.remove(k.id);
  const mock = mockFetch({});
  try {
    const result = await literature.poll();
    assert.match(result.notes, /no keywords apply/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
    for (const k of all) keywords.create({ term: k.term, scope: k.scope, sources: k.sources });
  }
});

test('the precise publication date survives a merge', () => {
  const { bestDate, mergeWorks } = require('../src/research/merge');
  assert.equal(bestDate(null, '2026-09-24'), '2026-09-24');
  assert.equal(bestDate('2026', '2026-09-24'), '2026-09-24', 'a full date beats a bare year');
  assert.equal(bestDate('2026-09-24', null), '2026-09-24');
  assert.equal(bestDate('2026-09-24', 'not a date'), '2026-09-24');

  const merged = mergeWorks([
    [{ source: 'pubmed', title: 'A paper', doi: '10.1/a', year: 2026 }],
    [{ source: 'openalex', title: 'A paper', doi: '10.1/a', published_on: '2026-09-24' }],
  ]);
  assert.equal(merged[0].published_on, '2026-09-24');
});

test('a sweep where every database failed is an error, not a quiet success', async () => {
  research.resetRateLimiter();
  settings.set('literature.max_keywords', '1');
  state.setCursor('literature', 0);
  const mock = mockFetch({
    'esearch.fcgi': { status: 503, body: { error: 'down' } },
    'ebi.ac.uk/europepmc': { status: 503, body: { error: 'down' } },
    'api.crossref.org': { status: 503, body: { error: 'down' } },
    'api.semanticscholar.org': { status: 503, body: { error: 'down' } },
    'api.openalex.org': { status: 503, body: { error: 'down' } },
    'clinicaltrials.gov/api/v2': { status: 503, body: { error: 'down' } },
  });
  try {
    await assert.rejects(() => literature.poll(), /no database answered/);
  } finally {
    mock.restore();
  }
});
