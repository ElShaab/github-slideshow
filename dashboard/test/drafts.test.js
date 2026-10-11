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
const { composeDraft, isQuestion } = require('../src/drafts/compose');
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

/** Every finding in a reply must be a run of some abstract's own text. */
function assertQuotesAreVerbatim(content, works) {
  const plain = (text) => String(text).replace(/[‘’“”"']/g, '"');
  const quotes = [...content.matchAll(/: "(.+?)"(?: https?:\/\/\S+)?$/gm)].map((m) => m[1]);
  assert.ok(quotes.length, 'the reply quotes something');
  for (const quote of quotes) {
    assert.ok(
      works.some((w) => plain(w.abstract || '').includes(plain(quote))),
      `not found in any abstract: ${quote}`
    );
  }
}

test('the text box holds only a postable reply: no headings, no markers, no evidence block', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': 'Ask your prosthetist.' });
  const { content, model, usage } = composeDraft({
    item,
    match: { results: [REVIEW, TRIAL, NO_ABSTRACT] },
  });

  assert.equal(model, null, 'no model was involved');
  assert.equal(usage.composed, true);
  assert.equal(usage.papers, 3);
  assert.equal(usage.quoted, 1);

  for (const scaffolding of ['QUESTION', 'EVIDENCE', 'REPLY —', 'WRITE YOUR REPLY', '[1]', '────']) {
    assert.ok(!content.includes(scaffolding), `no "${scaffolding}" in a postable reply`);
  }
  // Short: a reader should get it in one glance.
  assert.ok(content.split(/\s+/).length < 120, `short enough (${content.split(/\s+/).length} words)`);

  assert.match(content, /^A 2024 systematic review concluded: "/);
  assert.ok(content.includes('https://doi.org/10.1000/mirror'));
  assert.ok(content.endsWith('Ask your prosthetist.'));
  assertQuotesAreVerbatim(content, [REVIEW]);
});

test('a question gets the answer straight; a shared experience is not answered at', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  // The fixture item is a question.
  assert.match(composeDraft({ item, match: { results: [REVIEW] } }).content, /^A 2024 systematic review/);

  const share = { ...item, text: "My new hybrid socket is great, I'm really digging it!" };
  const reply = composeDraft({ item: share, match: { results: [REVIEW] } }).content;
  assert.match(reply, /^For anyone weighing this up, a 2024 systematic review concluded: "/);
});

test('a weak match says so instead of sounding confident', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  const { content } = composeDraft({ item, match: { results: [REVIEW], no_strong_matches: true } });
  assert.match(content, /^The research on this is thin, but the closest I found is a 2024 systematic review, which concluded: "/);
});

test('a leading "In summary," is dropped, and what is left is still verbatim', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  const work = {
    ...REVIEW,
    abstract:
      'METHODS: x. CONCLUSIONS: In summary, no clinical evidence is available to suggest a "standard" system for all users. However, the Iceross system was favored by the majority of users.',
  };
  const { content } = composeDraft({ item, match: { results: [work] } });
  assert.ok(content.includes(': "no clinical evidence is available'), 'starts on the finding');
  assert.ok(content.includes('Iceross system was favored'), 'the second sentence is kept');
  // Nested quotation marks become single quotes, a quote-within-a-quote.
  assert.ok(content.includes('‘standard’'));
  assertQuotesAreVerbatim(content, [work]);
});

test('a conclusion cut off mid-word is never put in a reply, and the next paper is used', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  const cutOff = { ...REVIEW, title: 'Adjustable sockets', abstract: 'OBJECTIVE: y. CONCLUSIONS: The adju' };
  const { content, citations, usage } = composeDraft({ item, match: { results: [cutOff, REVIEW] } });

  assert.ok(!content.includes('The adju'), 'the truncated quote stays out');
  assert.equal(usage.quoted, 1);
  assert.equal(citations[0].quoted, false);
  assert.match(citations[0].note, /cut off.*Re-run/);
  assert.equal(citations[1].quoted, true);
});

test('one paper is quoted by default, so the reply stays short', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '', 'draft.max_quoted': '1' });
  const more = [REVIEW, { ...REVIEW, title: 'Second', doi: '10.1000/b' }];
  const { content, citations } = composeDraft({ item, match: { results: more } });
  assert.equal((content.match(/concluded: "/g) || []).length, 1);
  assert.equal(citations[1].quoted, false);
  assert.match(citations[1].note, /quotes only the strongest paper/);
});

test('two can be allowed, and the second reads as a second source', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '', 'draft.max_quoted': '2' });
  const more = [REVIEW, { ...REVIEW, title: 'Second', doi: '10.1000/b' }, { ...REVIEW, title: 'Third', doi: '10.1000/c' }];
  const { content, citations } = composeDraft({ item, match: { results: more } });
  assert.equal((content.match(/concluded: "/g) || []).length, 2);
  assert.match(content, /\n\nAnother, a 2024 systematic review, concluded: "/);
  assert.equal(citations[2].quoted, false);
  settings.set('draft.max_quoted', '1');
});

test('a shared experience gets its own closing, empty unless set', () => {
  settings.setMany({
    'draft.opening': '',
    'draft.closing': 'Talk to your prosthetist.',
    'draft.closing_share': '',
  });
  const share = { ...item, text: "I'm really digging this hybrid socket!" };
  const reply = composeDraft({ item: share, match: { results: [REVIEW] } }).content;
  assert.ok(!reply.includes('Talk to your prosthetist.'), 'a happy post is not lectured');

  settings.set('draft.closing_share', 'Glad it is working for you.');
  assert.match(
    composeDraft({ item: share, match: { results: [REVIEW] } }).content,
    /\n\nGlad it is working for you\.$/
  );
  // A question still gets the question closing.
  assert.match(composeDraft({ item, match: { results: [REVIEW] } }).content, /Talk to your prosthetist\.$/);
  settings.set('draft.closing_share', '');
});

test('registrations and missing abstracts are explained beneath, never quoted', () => {
  const { citations } = composeDraft({ item, match: { results: [TRIAL, NO_ABSTRACT, REVIEW] } });
  assert.match(citations[0].note, /Trial registration, recruiting — no published results/);
  assert.match(citations[1].note, /No abstract is stored/);
  assert.equal(citations[2].quoted, true);
});

test('with nothing usable the reply is honest rather than empty', () => {
  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  const { content, usage } = composeDraft({ item, match: { results: [TRIAL, NO_ABSTRACT] } });
  assert.equal(usage.quoted, 0);
  assert.match(content, /^There isn't much published research that answers this directly yet/);
  assert.ok(!/"/.test(content.replace(/'/g, '')), 'and it quotes nothing');
});

test('the opening and closing snippets come from settings and can be emptied', () => {
  settings.setMany({ 'draft.opening': 'Short answer first.', 'draft.closing': 'Ask your prosthetist.' });
  let content = composeDraft({ item, match: { results: [REVIEW] } }).content;
  assert.match(content, /^Short answer first\.\n\n/);
  assert.match(content, /\n\nAsk your prosthetist\.$/);

  settings.setMany({ 'draft.opening': '', 'draft.closing': '' });
  content = composeDraft({ item, match: { results: [REVIEW] } }).content;
  assert.ok(!content.includes('Short answer first.'));
  assert.ok(!content.includes('Ask your prosthetist.'));
});

test('question or share is told apart from the text', () => {
  assert.equal(isQuestion('Does mirror therapy help?'), true);
  assert.equal(isQuestion('Anyone found a liner that does not sweat'), true);
  assert.equal(isQuestion("I'm really digging this hybrid!"), false);
  assert.equal(isQuestion('Ran my first 5k today.'), false);
});

test('an install still on the old snippet defaults moves to the new ones; edits are kept', () => {
  const { db } = require('../src/db');
  const OLD_OPENING =
    'Here is what the research actually says on this, in plain language. ' +
    'General information rather than advice about your own case.';
  settings.setMany({ 'draft.opening': OLD_OPENING, 'draft.closing': 'My own closing line.' });
  db.prepare("DELETE FROM settings WHERE key = 'draft.snippets_v2_applied'").run();

  delete require.cache[require.resolve('../src/db')];
  require('../src/db');

  assert.equal(settings.get('draft.opening'), '', 'the untouched old default is replaced');
  assert.equal(settings.get('draft.closing'), 'My own closing line.', 'an edited one is left alone');
});
