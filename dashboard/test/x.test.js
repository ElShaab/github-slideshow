'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('x');
process.env.X_BEARER_TOKEN = 'test-bearer';

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const state = require('../src/lib/state');
const x = require('../src/sources/x');

keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'prosthetic' });
keywords.create({
  term: 'osseointegration',
  scope: 'specific',
  sources: ['pubmed'],
});

test('x poll builds an OR query, stores tweets and remembers since_id', async () => {
  let seenUrl = '';
  const mock = mockFetch({
    'api.x.com/2/tweets/search/recent': (url) => {
      seenUrl = url;
      return {
        body: {
          data: [
            {
              id: '1800000000000000001',
              text: 'Day three with the new prosthetic and it already fits better',
              created_at: '2024-06-01T10:00:00.000Z',
              author_id: '42',
              lang: 'en',
            },
          ],
          includes: { users: [{ id: '42', username: 'limbuser', name: 'Limb User' }] },
          meta: { newest_id: '1800000000000000001', result_count: 1 },
        },
        headers: {
          'content-type': 'application/json',
          'x-rate-limit-remaining': '9',
          'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900),
        },
      };
    },
  });
  try {
    const result = await x.poll();
    assert.equal(result.added, 1);
  } finally {
    mock.restore();
  }

  const query = decodeURIComponent(new URL(seenUrl).searchParams.get('query'));
  assert.match(query, /"phantom limb pain" OR prosthetic/);
  assert.match(query, /-is:retweet/);
  assert.ok(!query.includes('osseointegration'), 'PubMed-only keyword must not be searched on X');

  const tweet = items.query({ source: 'x' }).items[0];
  assert.equal(tweet.author, '@limbuser');
  assert.equal(tweet.url, 'https://x.com/limbuser/status/1800000000000000001');
  assert.equal(state.getCursor('x'), '1800000000000000001');
});

test('x backs off when the rate-limit window is nearly spent', async () => {
  const mock = mockFetch({
    'api.x.com/2/tweets/search/recent': {
      body: { data: [], meta: { result_count: 0 } },
      headers: {
        'content-type': 'application/json',
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 600),
      },
    },
  });
  try {
    await x.poll();
  } finally {
    mock.restore();
  }
  const row = state.get('x');
  assert.ok(new Date(row.next_allowed_at) > new Date(), 'expected a future backoff');
  assert.equal(state.canRun('x'), false);
  state.backOff('x', 0);
});

test('x query batching respects the character budget', () => {
  const terms = Array.from({ length: 40 }, (_, i) => `keyword-number-${i}`);
  const queries = x.buildQueries(terms, { limit: 200, suffix: ' -is:retweet' });
  assert.ok(queries.length > 1);
  for (const q of queries) assert.ok(q.query.length <= 200, q.query.length);
});

test('a Free-tier 403 explains that recent search is not included', async () => {
  const mock = mockFetch({
    'api.x.com/2/tweets/search/recent': {
      status: 403,
      body: {
        title: 'Client Forbidden',
        detail: 'When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project.',
      },
    },
  });
  try {
    await assert.rejects(() => x.poll(), /Recent search is not included in the Free tier/);
  } finally {
    mock.restore();
  }
});

test('a rejected token is reported as a token problem, not a tier one', async () => {
  const mock = mockFetch({
    'api.x.com/2/tweets/search/recent': { status: 401, body: { title: 'Unauthorized' } },
  });
  try {
    await assert.rejects(() => x.poll(), /Regenerate it in the X developer portal/);
  } finally {
    mock.restore();
  }
});

test('the card warns about the Free tier before a token is bought', () => {
  const settings = require('../src/lib/settings');
  settings.set('x.tier', 'free');
  assert.equal(x.describe().search_available, false);
  assert.match(x.describe().tier_note, /does not include recent search/);
  settings.set('x.tier', 'basic');
  assert.equal(x.describe().search_available, true);
  assert.equal(x.describe().tier_note, null);
});
