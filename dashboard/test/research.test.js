'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('research');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const store = require('../src/lib/researchStore');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');
const research = require('../src/research');
const { extractTerms } = require('../src/research/terms');
const { classify } = require('../src/research/evidence');
const { mergeWorks, similarity } = require('../src/research/merge');
const { rankWorks } = require('../src/research/rank');

keywords.create({ term: 'phantom limb pain' });

ingest(
  'reddit',
  [
    {
      external_id: 't3_q1',
      author: 'u/newamputee',
      text: 'Six weeks post-op BKA and the phantom limb pain is worst at 3am. Did mirror therapy help anyone here?',
      url: 'https://www.reddit.com/r/amputee/comments/q1/',
      timestamp: '2026-09-01T00:00:00Z',
      kind: 'post',
      origin: 'r/amputee',
    },
  ],
  matcherFor('reddit')
);

const question = items.query({ source: 'reddit' }).items[0];

/* --------------------------------------------------------- term extraction */

test('search terms come from keywords, domain phrases and expanded shorthand', () => {
  const { terms } = extractTerms(question, { max: 6 });
  assert.ok(terms.includes('phantom limb pain'));
  assert.ok(terms.includes('mirror therapy'));
  assert.ok(terms.includes('below knee amputation'), 'BKA should expand');
  assert.ok(!terms.includes('3am'), 'timestamps are not search terms');
});

test('chatty questions with no clinical content yield few terms', () => {
  const { terms } = extractTerms({ text: 'Hi everyone, just saying hello today!' });
  assert.ok(terms.length <= 3);
});

/* ------------------------------------------------------- evidence grading */

test('evidence levels rank guidelines and reviews above case reports', () => {
  assert.equal(classify({ publication_types: ['Meta-Analysis'] }).level, 1);
  assert.equal(classify({ publication_types: ['Practice Guideline'] }).level, 1);
  assert.equal(classify({ title: 'A systematic review of mirror therapy' }).level, 1);
  assert.equal(classify({ publication_types: ['Randomized Controlled Trial'] }).level, 2);
  assert.equal(classify({ title: 'A prospective cohort study of socket fit' }).level, 3);
  assert.equal(classify({ title: 'Cross-sectional survey of amputees' }).level, 4);
  assert.equal(classify({ publication_types: ['Case Reports'] }).level, 5);
  assert.equal(classify({ title: 'Something uncategorizable' }).level, 4);
});

test('preprints are demoted a level and labelled', () => {
  const graded = classify({
    title: 'Systematic review of phantom limb pain',
    preprint: true,
  });
  assert.equal(graded.level, 2);
  assert.match(graded.label, /preprint/i);
});

test('trial registrations are graded separately from published results', () => {
  const randomized = classify({
    registry: true,
    study_type: 'INTERVENTIONAL',
    allocation: 'RANDOMIZED',
    title: 'Mirror therapy trial',
  });
  assert.equal(randomized.kind, 'trial-registration');
  assert.equal(randomized.level, 2);
  assert.equal(
    classify({ registry: true, study_type: 'OBSERVATIONAL', title: 'Registry' }).level,
    4
  );
});

/* ------------------------------------------------------------ dedup/merge */

test('the same paper from several databases merges into one record', () => {
  const merged = mergeWorks([
    [{ source: 'pubmed', title: 'Mirror therapy for phantom limb pain', doi: '10.1000/ABC', pmid: '1' }],
    [{ source: 'crossref', title: 'Mirror therapy for phantom limb pain', doi: 'https://doi.org/10.1000/abc', citations: 42 }],
    [{ source: 'openalex', title: 'Mirror therapy for phantom limb pain.', open_access: true }],
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ['pubmed', 'crossref', 'openalex']);
  assert.equal(merged[0].doi, '10.1000/abc', 'DOIs normalize before comparison');
  assert.equal(merged[0].citations, 42);
  assert.equal(merged[0].open_access, true);
  assert.equal(merged[0].pmid, '1');
});

test('near-identical titles merge when no DOI is present', () => {
  assert.ok(
    similarity(
      'Phantom limb pain after lower limb amputation: a systematic review',
      'Phantom limb pain after lower-limb amputation - a systematic review'
    ) >= 0.9
  );
  const merged = mergeWorks([
    [{ source: 'europepmc', title: 'Socket fit and skin breakdown in transtibial amputees' }],
    [{ source: 'semanticscholar', title: 'Socket fit and skin breakdown in transtibial amputees.' }],
  ]);
  assert.equal(merged.length, 1);
});

test('different papers stay separate', () => {
  const merged = mergeWorks([
    [{ source: 'pubmed', title: 'Mirror therapy for phantom limb pain', doi: '10.1/a' }],
    [{ source: 'pubmed', title: 'Osseointegration outcomes after amputation', doi: '10.1/b' }],
  ]);
  assert.equal(merged.length, 2);
});

test('a registered trial does not merge into a published paper of the same name', () => {
  const merged = mergeWorks([
    [{ source: 'pubmed', title: 'Mirror therapy for phantom limb pain' }],
    [{ source: 'clinicaltrials', title: 'Mirror therapy for phantom limb pain', registry: true, nct_id: 'NCT1' }],
  ]);
  assert.equal(merged.length, 2);
});

/* ---------------------------------------------------------------- ranking */

test('evidence quality outranks recency and citations', () => {
  const terms = ['phantom limb pain'];
  const { results } = rankWorks(
    [
      {
        title: 'Phantom limb pain case report',
        abstract: 'A case report of phantom limb pain.',
        year: 2026,
        citations: 900,
        evidence: classify({ publication_types: ['Case Reports'] }),
      },
      {
        title: 'Systematic review of phantom limb pain treatments',
        abstract: 'Systematic review of phantom limb pain.',
        year: 2019,
        citations: 3,
        evidence: classify({ publication_types: ['Systematic Review'] }),
      },
    ],
    terms,
    { now: new Date('2026-09-19T00:00:00Z') }
  );
  assert.match(results[0].title, /Systematic review/);
});

test('recency and citations break ties inside an evidence level', () => {
  const terms = ['phantom limb pain'];
  const evidence = classify({ publication_types: ['Randomized Controlled Trial'] });
  const { results } = rankWorks(
    [
      { title: 'Older RCT on phantom limb pain', abstract: 'phantom limb pain', year: 2012, citations: 5, evidence },
      { title: 'Newer RCT on phantom limb pain', abstract: 'phantom limb pain', year: 2025, citations: 5, evidence },
    ],
    terms,
    { now: new Date('2026-09-19T00:00:00Z') }
  );
  assert.match(results[0].title, /Newer/);
});

test('irrelevant results are dropped, not padded into the list', () => {
  const ranked = rankWorks(
    [
      { title: 'Corrosion resistance of titanium bolts', abstract: 'Metallurgy.', year: 2024, evidence: classify({}) },
    ],
    ['phantom limb pain', 'mirror therapy'],
    { minRelevance: 0.25 }
  );
  assert.equal(ranked.results.length, 0);
  assert.equal(ranked.no_strong_matches, true);
  assert.match(ranked.note, /No results/);
});

test('weak-but-present matches are flagged rather than presented as answers', () => {
  const ranked = rankWorks(
    [
      {
        title: 'Amputation epidemiology in Denmark',
        abstract: 'Registry analysis mentioning phantom limb pain once.',
        year: 2020,
        evidence: classify({ title: 'registry analysis' }),
      },
    ],
    ['phantom limb pain', 'mirror therapy', 'below knee amputation'],
    { minRelevance: 0.1 }
  );
  assert.equal(ranked.no_strong_matches, true);
  assert.match(ranked.note, /weak/i);
});
