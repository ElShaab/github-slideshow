'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('research-providers');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const store = require('../src/lib/researchStore');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');
const research = require('../src/research');

keywords.create({ term: 'phantom limb pain' });
settings.set('research.contact_email', 'doctor@example.com');

ingest(
  'reddit',
  [
    {
      external_id: 't3_q1',
      author: 'u/newamputee',
      text: 'Six weeks post-op and the phantom limb pain is awful. Does mirror therapy actually work?',
      url: 'https://www.reddit.com/r/amputee/comments/q1/',
      timestamp: '2026-09-01T00:00:00Z',
      kind: 'post',
      origin: 'r/amputee',
    },
  ],
  matcherFor('reddit')
);
const question = items.query({ source: 'reddit' }).items[0];

const ROUTES = {
  'esearch.fcgi': { body: { esearchresult: { idlist: ['39000001'] } } },
  'esummary.fcgi': {
    body: {
      result: {
        uids: ['39000001'],
        39000001: {
          uid: '39000001',
          title: 'Mirror therapy for phantom limb pain: a systematic review',
          authors: [{ name: 'Smith J' }, { name: 'Doe A' }],
          sortpubdate: '2024/05/01 00:00',
          fulljournalname: 'Pain Medicine',
          pubtype: ['Systematic Review', 'Journal Article'],
          articleids: [{ idtype: 'doi', value: '10.1000/mirror' }],
        },
      },
    },
  },
  'efetch.fcgi': {
    body:
      '<PubmedArticleSet><PubmedArticle><PMID Version="1">39000001</PMID>' +
      '<AbstractText>Mirror therapy reduced phantom limb pain versus sham in pooled trials.</AbstractText>' +
      '</PubmedArticle></PubmedArticleSet>',
    headers: { 'content-type': 'text/xml' },
  },
  'ebi.ac.uk/europepmc': {
    body: {
      resultList: {
        result: [
          {
            id: 'PPR123',
            source: 'PPR',
            title: 'Phantom limb pain after amputation: a preprint review',
            abstractText: 'Preprint discussing phantom limb pain management.',
            pubYear: '2026',
            journalInfo: { journal: { title: 'medRxiv' } },
            authorString: 'Okafor N.',
            citedByCount: 1,
            isOpenAccess: 'Y',
            pubTypeList: { pubType: ['review'] },
          },
          {
            id: '39000001',
            source: 'MED',
            pmid: '39000001',
            doi: '10.1000/mirror',
            title: 'Mirror therapy for phantom limb pain: a systematic review',
            abstractText: 'Longer Europe PMC copy of the same systematic review abstract about phantom limb pain.',
            pubYear: '2024',
            journalInfo: { journal: { title: 'Pain Medicine' } },
            authorString: 'Smith J, Doe A',
            citedByCount: 57,
            isOpenAccess: 'N',
            pubTypeList: { pubType: ['Systematic Review'] },
          },
        ],
      },
    },
  },
  'api.crossref.org': {
    body: {
      message: {
        items: [
          {
            DOI: '10.1000/mirror',
            title: ['Mirror therapy for phantom limb pain: a systematic review'],
            abstract: '<jats:p>Pooled analysis of mirror therapy trials.</jats:p>',
            'container-title': ['Pain Medicine'],
            issued: { 'date-parts': [[2024, 5, 1]] },
            type: 'journal-article',
            'is-referenced-by-count': 61,
            author: [{ given: 'J', family: 'Smith' }],
            URL: 'https://doi.org/10.1000/mirror',
          },
        ],
      },
    },
  },
  'api.semanticscholar.org': {
    body: {
      data: [
        {
          title: 'Randomized trial of mirror therapy for phantom limb pain',
          abstract: 'An RCT of mirror therapy in phantom limb pain.',
          year: 2023,
          venue: 'Journal of Rehabilitation',
          citationCount: 120,
          influentialCitationCount: 9,
          externalIds: { DOI: '10.1000/rct' },
          publicationTypes: ['JournalArticle', 'RandomizedControlledTrial'],
          isOpenAccess: true,
          openAccessPdf: { url: 'https://example.test/rct.pdf' },
          url: 'https://semanticscholar.test/rct',
          authors: [{ name: 'Lee K' }],
        },
      ],
    },
  },
  'api.openalex.org': {
    body: {
      results: [
        {
          id: 'https://openalex.org/W1',
          doi: 'https://doi.org/10.1000/rct',
          display_name: 'Randomized trial of mirror therapy for phantom limb pain',
          publication_year: 2023,
          cited_by_count: 118,
          type: 'article',
          primary_location: { source: { display_name: 'Journal of Rehabilitation' } },
          open_access: { is_oa: true, oa_url: 'https://example.test/rct.pdf', oa_status: 'gold' },
          abstract_inverted_index: {
            Mirror: [0],
            therapy: [1],
            reduced: [2],
            phantom: [3],
            limb: [4],
            pain: [5],
          },
          authorships: [{ author: { display_name: 'Lee K' } }],
        },
      ],
    },
  },
  'clinicaltrials.gov/api/v2': {
    body: {
      studies: [
        {
          protocolSection: {
            identificationModule: { nctId: 'NCT09876543', briefTitle: 'Mirror Therapy for Phantom Limb Pain After Amputation' },
            statusModule: { overallStatus: 'RECRUITING', startDateStruct: { date: '2026-01' } },
            descriptionModule: { briefSummary: 'A trial of mirror therapy for phantom limb pain.' },
            designModule: { studyType: 'INTERVENTIONAL', phases: ['PHASE2'], designInfo: { allocation: 'RANDOMIZED' } },
            sponsorCollaboratorsModule: { leadSponsor: { name: 'Example University' } },
          },
        },
      ],
    },
  },
};

test('a full match queries every database and merges the results', async () => {
  research.resetRateLimiter();
  const seen = [];
  const mock = mockFetch(
    Object.fromEntries(
      Object.entries(ROUTES).map(([key, value]) => [
        key,
        (url) => {
          seen.push(url);
          return value;
        },
      ])
    )
  );

  let match;
  try {
    match = await research.matchItem(question.id);
  } finally {
    mock.restore();
  }

  assert.deepEqual(
    match.providers.map((p) => `${p.id}:${p.status}`).sort(),
    [
      'clinicaltrials:ok',
      'crossref:ok',
      'europepmc:ok',
      'openalex:ok',
      'pubmed:ok',
      'semanticscholar:ok',
    ]
  );

  // Contact address reaches the APIs that ask for one.
  assert.ok(seen.some((u) => u.includes('api.crossref.org') && u.includes('mailto=doctor%40example.com')));
  assert.ok(seen.some((u) => u.includes('api.openalex.org') && u.includes('mailto=doctor%40example.com')));

  // 7 raw records across 6 databases collapse to 4 distinct works.
  assert.equal(match.considered, 4);

  const review = match.results.find((r) => /systematic review/i.test(r.title));
  assert.deepEqual(review.sources.sort(), ['crossref', 'europepmc', 'pubmed']);
  assert.equal(review.doi, '10.1000/mirror');
  assert.equal(review.evidence.level, 1);
  assert.equal(review.citations, 61, 'highest citation count across sources wins');
  assert.ok(review.snippet.length <= 330);

  const rct = match.results.find((r) => /randomized trial/i.test(r.title));
  assert.deepEqual(rct.sources.sort(), ['openalex', 'semanticscholar']);
  assert.equal(rct.evidence.level, 2);
  assert.equal(rct.open_access, true);
  assert.equal(rct.open_access_url, 'https://example.test/rct.pdf');

  const trial = match.results.find((r) => r.registry);
  assert.equal(trial.nct_id, 'NCT09876543');
  assert.equal(trial.evidence.kind, 'trial-registration');
  assert.equal(trial.status, 'RECRUITING');

  // Evidence quality first: the systematic review outranks the RCT, which
  // outranks the registration and the preprint.
  assert.match(match.results[0].title, /systematic review/i);
  assert.equal(match.no_strong_matches, false);

  const preprint = match.results.find((r) => r.evidence.preprint);
  assert.ok(preprint, 'the preprint is kept but graded down');
  assert.ok(
    match.results.indexOf(preprint) > match.results.indexOf(rct),
    'preprints rank below peer-reviewed work'
  );
});

test('results are cached per question and reused without new requests', async () => {
  const mock = mockFetch({});
  try {
    const cached = await research.matchItem(question.id);
    assert.equal(cached.cached, true);
    assert.equal(mock.calls.length, 0, 'no upstream calls on a cache hit');
    assert.ok(cached.results.length > 0);
  } finally {
    mock.restore();
  }
});

test('refresh=true re-queries and overwrites the cache', async () => {
  research.resetRateLimiter();
  const mock = mockFetch({ ...ROUTES, 'api.crossref.org': { body: { message: { items: [] } } } });
  try {
    const refreshed = await research.matchItem(question.id, { refresh: true });
    assert.equal(refreshed.cached, false);
    assert.ok(mock.calls.length > 0);
    const review = refreshed.results.find((r) => /systematic review/i.test(r.title));
    assert.ok(!review.sources.includes('crossref'));
  } finally {
    mock.restore();
  }
});

test('one database failing does not break the others', async () => {
  research.resetRateLimiter();
  const mock = mockFetch({
    ...ROUTES,
    'api.semanticscholar.org': { status: 429, body: { error: 'too many requests' } },
    'api.crossref.org': { status: 500, body: { error: 'boom' } },
  });

  let match;
  try {
    match = await research.matchItem(question.id, { refresh: true });
  } finally {
    mock.restore();
  }

  const byId = Object.fromEntries(match.providers.map((p) => [p.id, p]));
  assert.equal(byId.semanticscholar.status, 'rate-limited');
  assert.equal(byId.crossref.status, 'error');
  assert.equal(byId.pubmed.status, 'ok');
  assert.equal(byId.openalex.status, 'ok');
  assert.ok(match.results.length > 0, 'surviving databases still produce results');
  assert.match(match.note, /2 of 6 databases did not answer/);
});

test('a question with no real matches says so instead of padding the list', async () => {
  const empty = {
    'esearch.fcgi': { body: { esearchresult: { idlist: [] } } },
    'ebi.ac.uk/europepmc': { body: { resultList: { result: [] } } },
    'api.crossref.org': { body: { message: { items: [] } } },
    'api.semanticscholar.org': { body: { data: [] } },
    'api.openalex.org': { body: { results: [] } },
    'clinicaltrials.gov/api/v2': { body: { studies: [] } },
  };
  research.resetRateLimiter();
  const mock = mockFetch(empty);
  try {
    const match = await research.matchItem(question.id, { refresh: true });
    assert.equal(match.results.length, 0);
    assert.equal(match.no_strong_matches, true);
    assert.match(match.note, /No results/);
  } finally {
    mock.restore();
  }
});

test('disabled providers are not queried', async () => {
  settings.setMany({
    'research.provider_crossref': 'false',
    'research.provider_semanticscholar': 'false',
  });
  research.resetRateLimiter();
  const mock = mockFetch(ROUTES);
  try {
    const match = await research.matchItem(question.id, { refresh: true });
    assert.deepEqual(
      match.providers.map((p) => p.id).sort(),
      ['clinicaltrials', 'europepmc', 'openalex', 'pubmed']
    );
    assert.ok(!mock.calls.some((u) => u.includes('crossref')));
  } finally {
    mock.restore();
    settings.setMany({
      'research.provider_crossref': 'true',
      'research.provider_semanticscholar': 'true',
    });
  }
});

test('the cached row survives a round trip through SQLite', () => {
  const cached = store.get(question.id);
  assert.ok(Array.isArray(cached.terms));
  assert.ok(Array.isArray(cached.results));
  assert.ok(Array.isArray(cached.providers));
  assert.equal(store.summary().matched_items, 1);
});
