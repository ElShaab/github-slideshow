'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('drafts');
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

const config = require('../src/config');
const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const draftStore = require('../src/lib/drafts');
const researchStore = require('../src/lib/researchStore');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');
const { generateDraft, describeError, Anthropic } = require('../src/drafts/generate');
const { renderResearch, buildUserMessage, SYSTEM_PROMPT } = require('../src/drafts/prompt');

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

const MATCH = {
  terms: ['phantom limb pain', 'mirror therapy'],
  no_strong_matches: false,
  note: null,
  results: [
    {
      title: 'Mirror therapy for phantom limb pain: a systematic review',
      venue: 'Pain Medicine',
      year: 2024,
      citations: 61,
      url: 'https://doi.org/10.1000/mirror',
      doi: '10.1000/mirror',
      sources: ['pubmed', 'europepmc'],
      evidence: { level: 1, label: 'Guideline / systematic review', preprint: false },
      abstract: 'Pooled trials suggest mirror therapy reduces phantom limb pain.',
    },
    {
      title: 'Mirror Therapy for Phantom Limb Pain After Amputation',
      venue: 'ClinicalTrials.gov - Example University',
      year: 2026,
      url: 'https://clinicaltrials.gov/study/NCT09876543',
      sources: ['clinicaltrials'],
      registry: true,
      status: 'RECRUITING',
      evidence: { level: 2, label: 'Registered randomized trial', preprint: false },
      abstract: 'A trial of mirror therapy for phantom limb pain.',
    },
  ],
};

/** A minimal but valid Messages API SSE stream. */
function sseStream(text, { stopReason = 'end_turn', model = 'claude-opus-5' } = {}) {
  const events = [
    ['message_start', {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 900 },
      },
    }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 240 },
    }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return {
    body: events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
    headers: { 'content-type': 'text/event-stream' },
  };
}

const DRAFT_TEXT =
  'Mirror therapy has reasonable evidence behind it for phantom limb pain [1]. ' +
  'A newer trial is still recruiting, so it has no results yet [2]. ' +
  'Your prosthetist or pain specialist is the right person to ask about your own situation.';

/* ------------------------------------------------------------------ prompt */

test('the system prompt carries the audience, citation and safety rules', () => {
  assert.match(SYSTEM_PROMPT, /not for clinicians/i);
  assert.match(SYSTEM_PROMPT, /Never cite a study that is not in the list/i);
  assert.match(SYSTEM_PROMPT, /Never give individualized medical advice/i);
  assert.match(SYSTEM_PROMPT, /Never suggest replacing, bypassing/i);
  assert.match(SYSTEM_PROMPT, /does not actually answer the question/i);
  assert.match(SYSTEM_PROMPT, /honest about uncertainty/i);
});

test('studies are numbered, graded and flagged in the prompt', () => {
  const rendered = renderResearch(MATCH.results);
  assert.match(rendered, /\[1\] Mirror therapy for phantom limb pain/);
  assert.match(rendered, /Evidence: Guideline \/ systematic review/);
  assert.match(rendered, /\[2\] Mirror Therapy for Phantom Limb Pain/);
  assert.match(rendered, /trial registration, status: RECRUITING - no published results/);
});

test('a study with no abstract warns the model not to infer from the title', () => {
  const rendered = renderResearch([{ title: 'Something', evidence: { label: 'Unclassified study' } }]);
  assert.match(rendered, /do not infer findings from the title alone/);
});

test('a no-match result tells the model to lead with that', () => {
  const message = buildUserMessage({
    item,
    match: { terms: ['x'], results: [], no_strong_matches: true, note: 'No results matched.' },
  });
  assert.match(message, /found no strong match/);
  assert.match(message, /No studies were found/);
});

/* -------------------------------------------------------------- generation */

test('generateDraft sends the documented request and returns the text', async () => {
  let body;
  let headers;
  const mock = mockFetch({
    'api.anthropic.com': (url, options) => {
      body = JSON.parse(options.body);
      headers = options.headers;
      return sseStream(DRAFT_TEXT);
    },
  });

  let generated;
  try {
    generated = await generateDraft({ item, match: MATCH });
  } finally {
    mock.restore();
  }

  assert.equal(body.model, 'claude-opus-5');
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.output_config.effort, 'high');
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, 'default');
  // The SDK sends betas as a header, not in the body.
  assert.equal(headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01');
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
  assert.match(body.system[0].text, /amputee or limb-loss community/);

  const userContent = body.messages[0].content;
  assert.match(userContent, /Does mirror therapy actually help phantom limb pain\?/);
  assert.match(userContent, /\[1\] Mirror therapy for phantom limb pain/);
  assert.match(userContent, /cite only from this list/);

  assert.equal(generated.content, DRAFT_TEXT);
  assert.equal(generated.model, 'claude-opus-5');
  assert.equal(generated.usage.output_tokens, 240);
  assert.equal(generated.usage.cache_read_input_tokens, 900);
  assert.equal(generated.citations.length, 2);
  assert.equal(generated.citations[0].n, 1);
  assert.equal(generated.citations[1].registry, true);
});

test('a refusal is surfaced instead of being stored as a draft', async () => {
  const mock = mockFetch({
    'api.anthropic.com': () => sseStream('', { stopReason: 'refusal' }),
  });
  try {
    await assert.rejects(() => generateDraft({ item, match: MATCH }), /declined to answer/);
  } finally {
    mock.restore();
  }
});

test('hitting the token cap is reported rather than saved empty', async () => {
  const mock = mockFetch({
    'api.anthropic.com': () => sseStream('', { stopReason: 'max_tokens' }),
  });
  try {
    await assert.rejects(() => generateDraft({ item, match: MATCH }), /token limit/);
  } finally {
    mock.restore();
  }
});

test('a missing API key fails fast with a clear message', async () => {
  const original = config.anthropic.apiKey;
  config.anthropic.apiKey = '';
  try {
    await assert.rejects(() => generateDraft({ item, match: MATCH }), /ANTHROPIC_API_KEY is not set/);
  } finally {
    config.anthropic.apiKey = original;
  }
});

test('SDK errors map onto useful statuses', () => {
  const auth = new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
  assert.equal(describeError(auth).status, 401);
  assert.match(describeError(auth).message, /API key/);

  const limited = new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers());
  assert.equal(describeError(limited).status, 429);

  assert.equal(describeError(new Error('boom')).status, 500);
});

/* ------------------------------------------------------------------ storage */

test('drafts are stored against the question and move through their statuses', () => {
  const created = draftStore.create({
    item_id: item.id,
    content: DRAFT_TEXT,
    model: 'claude-opus-5',
    usage: { output_tokens: 240 },
    citations: [{ n: 1, title: 'Mirror therapy' }],
  });
  assert.equal(created.status, 'draft');
  assert.equal(created.citations[0].title, 'Mirror therapy');

  // Saving edited text promotes draft -> edited automatically.
  const edited = draftStore.update(created.id, { content: `${DRAFT_TEXT} Edited.` });
  assert.equal(edited.status, 'edited');
  assert.match(edited.content, /Edited\.$/);

  const used = draftStore.setStatus(created.id, 'used');
  assert.equal(used.status, 'used');

  // An explicit save on a used draft does not silently demote it.
  assert.equal(draftStore.update(created.id, { content: 'more' }).status, 'used');

  assert.throws(() => draftStore.setStatus(created.id, 'published'), /Status must be one of/);
  assert.equal(draftStore.latest(item.id).id, created.id);
  assert.deepEqual(draftStore.summary(), { draft: 0, edited: 0, used: 1 });
});

test('several drafts can exist per question, newest first', () => {
  draftStore.create({ item_id: item.id, content: 'second attempt' });
  const all = draftStore.forItem(item.id);
  assert.equal(all.length, 2);
  assert.equal(all[0].content, 'second attempt');
  assert.equal(draftStore.remove(all[0].id), true);
  assert.equal(draftStore.forItem(item.id).length, 1);
});

test('deleting a question removes its drafts and cached research', () => {
  researchStore.save(item.id, { terms: ['x'], results: [], providers: [] });
  items.remove(item.id);
  assert.equal(draftStore.forItem(item.id).length, 0);
  assert.equal(researchStore.get(item.id), null);
});
