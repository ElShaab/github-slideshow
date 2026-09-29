'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb } = require('./helpers');

useTempDb('drafts');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');
const { composeDraft, BLANK_MARKER } = require('../src/drafts/compose');
const { extractConclusion, sentences } = require('../src/drafts/conclusions');

keywords.create({ term: 'phantom limb pain' });
ingest(
  'reddit',
  [
    {
      external_id: 't3_q1',
      author: 'u/newamputee',
      text: 'Does mirror therapy actually help phantom limb pain?',
      url: 'https://www.reddit.com/r/amputee/comments/q1/',
      timestamp: '2026-09-01T00:00:00Z',
      kind: 'post',
      origin: 'r/amputee',
    },
  ],
  matcherFor('reddit')
);
const item = items.query({ source: 'reddit' }).items[0];

const REVIEW = {
  title: 'Mirror therapy for phantom limb pain: a systematic review',
  venue: 'Pain Medicine',
  year: 2024,
  doi: '10.1000/mirror',
  url: 'https://doi.org/10.1000/mirror',
  open_access: true,
  evidence: { level: 1, label: 'Guideline / systematic review', preprint: false },
  abstract:
    'BACKGROUND: Phantom limb pain is common after amputation. ' +
    'METHODS: We searched four databases for randomized trials. ' +
    'RESULTS: Fourteen trials (n=732) met the criteria. ' +
    'CONCLUSIONS: Mirror therapy reduced pain scores more than sham at 4 weeks. ' +
    'The trials were small and at moderate risk of bias. ' +
    'FUNDING: None.',
};

const TRIAL = {
  title: 'Sensory Feedback in Bone-Anchored Prostheses',
  venue: 'ClinicalTrials.gov',
  year: 2026,
  url: 'https://clinicaltrials.gov/study/NCT00000001',
  registry: true,
  status: 'RECRUITING',
  evidence: { level: 2, label: 'Registered randomized trial', preprint: false },
};

const NO_ABSTRACT = {
  title: 'Graded motor imagery versus mirror therapy',
  venue: 'J Rehabil Med',
  year: 2023,
  url: 'https://doi.org/10.1000/rct',
  evidence: { level: 2, label: 'Randomized controlled trial', preprint: false },
  abstract: null,
};

/* ----------------------------------------------------- conclusion quoting */

test('a labelled conclusion section is quoted, and only that section', () => {
  const found = extractConclusion(REVIEW.abstract);
  assert.equal(found.rule, 'labelled');
  assert.equal(
    found.text,
    'Mirror therapy reduced pain scores more than sham at 4 weeks. ' +
      'The trials were small and at moderate risk of bias.'
  );
  // Neither the methods before it nor the funding line after it.
  assert.ok(!found.text.includes('four databases'));
  assert.ok(!found.text.includes('FUNDING'));
  // Verbatim: every sentence appears in the abstract exactly as quoted.
  for (const sentence of sentences(found.text)) {
    assert.ok(REVIEW.abstract.includes(sentence), `not verbatim: ${sentence}`);
  }
});

test('an unstructured abstract falls back to the conclusion cue', () => {
  const found = extractConclusion(
    'We enrolled 180 adults within six weeks of amputation. ' +
      'Gabapentin did not reduce average daily pain at 12 weeks (p = 0.42). ' +
      'These findings suggest gabapentin should not be started routinely here.'
  );
  assert.equal(found.rule, 'cue');
  assert.equal(
    found.text,
    'These findings suggest gabapentin should not be started routinely here.'
  );
});

test('with no cue at all the last lines are quoted, and labelled as such', () => {
  const found = extractConclusion(
    'Thirty-one cohorts were reviewed. Deep infection was uncommon. ' +
      'Implant survival exceeded 90% at five years in most series.'
  );
  assert.equal(found.rule, 'tail');
  assert.equal(
    found.text,
    'Deep infection was uncommon. Implant survival exceeded 90% at five years in most series.'
  );
});

test('abbreviations, initials and decimals do not split a sentence', () => {
  assert.deepEqual(sentences('Smith et al. reported a drop. It was 0.5 mg.'), [
    'Smith et al. reported a drop.',
    'It was 0.5 mg.',
  ]);
  assert.deepEqual(sentences('Pain fell (p = 0.001). No harms were seen.'), [
    'Pain fell (p = 0.001).',
    'No harms were seen.',
  ]);
  assert.equal(sentences('R. J. Smith led the trial.').length, 1);
});

test('a quote is never cut mid-sentence to meet the length cap', () => {
  const long = `CONCLUSIONS: ${'This is a long conclusion sentence that runs on. '.repeat(20)}`;
  const found = extractConclusion(long, { maxSentences: 3, softLimit: 40 });
  assert.ok(found.text.endsWith('.'), 'ends on a sentence boundary');
  assert.ok(long.includes(found.text), 'still verbatim');
  assert.ok(found.truncated, 'and says it left some out');
});

test('an empty abstract yields nothing rather than an invented quote', () => {
  assert.equal(extractConclusion(''), null);
  assert.equal(extractConclusion(null), null);
  assert.equal(extractConclusion('   '), null);
});

/* -------------------------------------------------------- draft composing */

test('the draft restates the question, quotes each paper, and leaves the body blank', () => {
  const { content, citations, usage, model } = composeDraft({
    item,
    match: { results: [REVIEW, TRIAL, NO_ABSTRACT] },
  });

  assert.equal(model, null, 'no model was involved');
  assert.equal(usage.composed, true);
  assert.equal(usage.papers, 3);
  assert.equal(usage.quoted, 1, 'only the paper with an abstract is quoted');

  // The question, in full and verbatim.
  assert.ok(content.includes('QUESTION'));
  assert.ok(content.includes('Reddit · r/amputee · u/newamputee · 2026-09-01'));
  assert.ok(content.includes(`"${item.text}"`));

  // Each paper numbered, with journal, year and evidence level.
  assert.ok(content.includes('[1] Mirror therapy for phantom limb pain: a systematic review'));
  assert.ok(content.includes('Pain Medicine · 2024 · Guideline / systematic review · open access'));
  assert.ok(content.includes('https://doi.org/10.1000/mirror'));
  assert.ok(content.includes('[2] Sensory Feedback in Bone-Anchored Prostheses'));
  assert.ok(content.includes('[3] Graded motor imagery versus mirror therapy'));

  // The conclusion, quoted word for word.
  assert.ok(
    content.includes(
      '"Mirror therapy reduced pain scores more than sham at 4 weeks. ' +
        'The trials were small and at moderate risk of bias."'
    )
  );
  // A registration and a missing abstract are stated, not papered over.
  assert.ok(content.includes('Trial registration, status recruiting'));
  assert.ok(content.includes('No abstract was stored for this paper'));

  // And the reply body is left for the physician.
  assert.ok(content.includes(BLANK_MARKER));
  assert.equal(citations.length, 3);
  assert.equal(citations[0].n, 1);
  assert.equal(citations[1].registry, true);
});

test('the opening and closing snippets come from settings and can be emptied', () => {
  settings.setMany({
    'draft.opening': 'Short answer first.',
    'draft.closing': 'Ask your prosthetist.',
  });
  let content = composeDraft({ item, match: { results: [REVIEW] } }).content;
  assert.ok(content.includes('Short answer first.'));
  assert.ok(content.includes('Ask your prosthetist.'));
  // The body marker sits between them, in that order.
  const openAt = content.indexOf('Short answer first.');
  const blankAt = content.indexOf(BLANK_MARKER);
  const closeAt = content.indexOf('Ask your prosthetist.');
  assert.ok(openAt < blankAt, 'the opening line comes before the blank body');
  assert.ok(blankAt < closeAt, 'the closing line comes after it');

  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  content = composeDraft({ item, match: { results: [REVIEW] } }).content;
  assert.ok(!content.includes('Short answer first.'));
  assert.ok(content.includes(BLANK_MARKER), 'the blank section is always there');
});

test('a question with no ticked papers still builds, citing nothing', () => {
  const { content, citations, usage } = composeDraft({ item, match: { results: [] } });
  assert.equal(citations.length, 0);
  assert.equal(usage.papers, 0);
  assert.ok(content.includes('No papers were ticked'));
  assert.ok(content.includes(BLANK_MARKER));
  assert.ok(content.includes(`"${item.text}"`));
});

test('nothing in a composed draft is invented: every quote is in an abstract', () => {
  const { content } = composeDraft({ item, match: { results: [REVIEW] } });
  const quotes = [...content.matchAll(/^ {4}"([\s\S]*?)"$/gm)].map((m) => m[1]);
  assert.equal(quotes.length, 1);
  for (const quote of quotes) {
    assert.ok(REVIEW.abstract.includes(quote), `quote not found in the abstract: ${quote}`);
  }
});

test('an abstract that is itself an extract is flagged, not passed off as whole', () => {
  const { content } = composeDraft({
    item,
    match: {
      results: [
        { ...REVIEW, abstract: 'Mirror therapy reduced pain scores more than sham at 4 weeks…' },
      ],
    },
  });
  assert.match(content, /the stored abstract is itself abridged/);
  assert.match(content, /"Mirror therapy reduced pain scores more than sham at 4 weeks…"/);
});
