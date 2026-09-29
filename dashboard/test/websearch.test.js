'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('websearch');
process.env.BRAVE_SEARCH_API_KEY = 'test-brave-key';
process.env.GOOGLE_SEARCH_API_KEY = 'test-google-key';
process.env.GOOGLE_SEARCH_CX = 'test-cx';

const { db } = require('../src/db');
const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const state = require('../src/lib/state');
const quota = require('../src/lib/quota');
const sites = require('../src/lib/searchSites');
const websearch = require('../src/sources/websearch');

keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'prosthetic socket' });

const braveResponse = {
  body: {
    web: {
      results: [
        {
          title: 'How do you cope with <strong>phantom limb pain</strong>?',
          description: 'Several answers from amputees describing mirror therapy.',
          url: 'https://www.quora.com/How-do-you-cope-with-phantom-limb-pain?utm_source=feed&share=1',
          page_age: '2026-09-10T08:00:00Z',
          meta_url: { hostname: 'www.quora.com' },
        },
        {
          title: 'Unrelated question about bicycles',
          description: 'Nothing to do with the topic.',
          url: 'https://www.quora.com/bicycles',
          meta_url: { hostname: 'www.quora.com' },
        },
      ],
    },
  },
};

test('brave poll stores titles, snippets and links from the search API', async () => {
  db.prepare("DELETE FROM search_sites WHERE domain <> 'quora.com'").run();
  settings.setMany({ 'websearch.provider': 'brave', 'websearch.max_queries_per_poll': '1' });

  let requested = '';
  const mock = mockFetch({
    'api.search.brave.com': (url, options) => {
      requested = url;
      assert.equal(options.headers['X-Subscription-Token'], 'test-brave-key');
      return braveResponse;
    },
  });
  try {
    const result = await websearch.poll();
    assert.equal(result.fetched, 2);
    assert.equal(result.added, 2);
  } finally {
    mock.restore();
  }

  const query = decodeURIComponent(new URL(requested).searchParams.get('q'));
  assert.equal(query, 'site:quora.com "phantom limb pain"');
  assert.match(new URL(requested).searchParams.get('freshness'), /^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/);

  const stored = items.query({ source: 'websearch' }).items;
  const matched = stored.find((i) => i.url.includes('How-do-you-cope'));
  assert.equal(matched.author, 'Quora');
  assert.equal(matched.origin, 'www.quora.com');
  assert.equal(matched.kind, 'search result');
  assert.equal(matched.keyword_matched, 'phantom limb pain');
  assert.match(matched.text, /How do you cope with phantom limb pain\?/);
  assert.ok(!matched.text.includes('<strong>'), 'markup should be stripped');
  assert.equal(matched.meta.published_known, true);

  // The second result matched no keyword in its text, but the API matched it
  // server-side, so the queried term is recorded.
  const fallback = stored.find((i) => i.url.endsWith('/bicycles'));
  assert.equal(fallback.keyword_matched, 'phantom limb pain');
  assert.equal(fallback.meta.published_known, false);
});

test('the same result does not repeat, even with tracking params', async () => {
  state.setCursor('websearch', 0);
  const mock = mockFetch({ 'api.search.brave.com': braveResponse });
  try {
    const result = await websearch.poll();
    assert.equal(result.added, 0);
    assert.equal(result.duplicates, 2);
  } finally {
    mock.restore();
  }
});

test('URL normalization strips tracking parameters and fragments', () => {
  assert.equal(
    websearch.normalizeUrl('https://www.quora.com/thing?utm_source=x&fbclid=y#answer'),
    'https://www.quora.com/thing'
  );
  assert.equal(
    websearch.normalizeUrl('https://www.inspire.com/groups/topic/'),
    'https://www.inspire.com/groups/topic'
  );
});

test('queries rotate through the keyword x site matrix across polls', async () => {
  sites.add('inspire.com', 'Inspire');
  state.setCursor('websearch', 0);

  const seen = [];
  const mock = mockFetch({
    'api.search.brave.com': (url) => {
      seen.push(decodeURIComponent(new URL(url).searchParams.get('q')));
      return { body: { web: { results: [] } } };
    },
  });
  try {
    await websearch.poll();
    await websearch.poll();
    await websearch.poll();
    await websearch.poll();
  } finally {
    mock.restore();
  }

  assert.deepEqual(seen, [
    'site:inspire.com "phantom limb pain"',
    'site:inspire.com "prosthetic socket"',
    'site:quora.com "phantom limb pain"',
    'site:quora.com "prosthetic socket"',
  ]);
});

test('google provider uses its own endpoint, key and result shape', async () => {
  settings.setMany({ 'websearch.provider': 'google', 'websearch.max_queries_per_poll': '1' });
  state.setCursor('websearch', 0);

  let requested = '';
  const mock = mockFetch({
    'customsearch/v1': (url) => {
      requested = url;
      return {
        body: {
          items: [
            {
              title: 'Living with prosthetic socket pain - Inspire',
              snippet: 'Members discuss refits and skin breakdown.',
              link: 'https://www.inspire.com/groups/amputee/discussion/socket-pain/',
              displayLink: 'www.inspire.com',
              pagemap: {
                metatags: [{ 'article:published_time': '2026-09-01T00:00:00Z' }],
              },
            },
          ],
        },
      };
    },
  });
  try {
    const result = await websearch.poll();
    assert.equal(result.added, 1);
  } finally {
    mock.restore();
    settings.set('websearch.provider', 'brave');
  }

  const params = new URL(requested).searchParams;
  assert.equal(params.get('key'), 'test-google-key');
  assert.equal(params.get('cx'), 'test-cx');
  assert.equal(params.get('dateRestrict'), 'd30');
  assert.match(params.get('q'), /^site:inspire\.com/);
});

test('the free-tier allowance is metered and stops the poll when spent', async () => {
  settings.setMany({
    'websearch.provider': 'brave',
    'websearch.monthly_quota': String(quota.monthUsed('websearch') + 1),
    'websearch.max_queries_per_poll': '4',
  });

  let calls = 0;
  const mock = mockFetch({
    'api.search.brave.com': () => {
      calls += 1;
      return { body: { web: { results: [] } } };
    },
  });
  try {
    const result = await websearch.poll();
    assert.equal(calls, 1, 'only the last allowed query should run');
    assert.match(result.notes, /free tier spent/);
  } finally {
    mock.restore();
    settings.set('websearch.monthly_quota', '2000');
  }
});

test('a rate limit propagates so the scheduler backs the source off', async () => {
  state.setCursor('websearch', 0);
  const mock = mockFetch({
    'api.search.brave.com': {
      status: 429,
      body: { error: 'rate limited' },
      headers: { 'content-type': 'application/json', 'retry-after': '60' },
    },
  });
  try {
    await assert.rejects(() => websearch.poll(), /429/);
  } finally {
    mock.restore();
  }
});

test('a missing provider key is reported rather than silently skipped', () => {
  settings.set('websearch.provider', 'google');
  const original = process.env.GOOGLE_SEARCH_CX;
  delete require('../src/config').search.google.cx;
  assert.equal(websearch.isConfigured(), false);
  require('../src/config').search.google.cx = original;
  settings.set('websearch.provider', 'brave');
});

test('quora and inspire are both seeded and both produce questions', () => {
  // A fresh install tracks both community sites out of the box.
  const seeded = sites.list().map((s) => s.domain);
  assert.ok(seeded.includes('quora.com'), 'quora.com is seeded');
  assert.ok(seeded.includes('inspire.com'), 'inspire.com is seeded');

  assert.equal(
    websearch.buildQuery({ domain: 'quora.com' }, 'phantom limb pain'),
    'site:quora.com "phantom limb pain"'
  );
  assert.equal(
    websearch.buildQuery({ domain: 'inspire.com' }, 'prosthetic socket'),
    'site:inspire.com "prosthetic socket"'
  );
});

test('a poll across both sites files each question under the site it came from', async () => {
  db.prepare('DELETE FROM items').run();
  db.prepare('DELETE FROM seen_items').run();
  db.prepare('DELETE FROM search_sites').run();
  sites.add('quora.com', 'Quora');
  sites.add('inspire.com', 'Inspire');
  state.setCursor('websearch', 0);
  quota.record('websearch', -quota.monthUsed('websearch'));
  settings.setMany({
    'websearch.provider': 'brave',
    'websearch.max_queries_per_poll': '4',
  });

  const byQuery = {
    'site:quora.com "phantom limb pain"': [
      {
        title: 'What actually helps <strong>phantom limb pain</strong> at night?',
        description: 'Amputees describe what worked for them after a BKA.',
        url: 'https://www.quora.com/What-actually-helps-phantom-limb-pain-at-night',
        page_age: '2026-09-25T08:00:00Z',
        meta_url: { hostname: 'www.quora.com' },
      },
    ],
    'site:inspire.com "phantom limb pain"': [
      {
        title: 'Phantom limb pain two years on — does it ever stop?',
        description: 'A discussion in the limb loss community.',
        url: 'https://www.inspire.com/groups/amputee-coalition/discussion/phantom-two-years/',
        page_age: '2026-09-24T08:00:00Z',
        meta_url: { hostname: 'www.inspire.com' },
      },
    ],
    'site:quora.com "prosthetic socket"': [
      {
        title: 'How many refits is normal for a new <strong>prosthetic socket</strong>?',
        description: 'Answers from prosthetists and users.',
        url: 'https://www.quora.com/How-many-refits-is-normal',
        meta_url: { hostname: 'www.quora.com' },
      },
    ],
    'site:inspire.com "prosthetic socket"': [
      {
        title: 'Prosthetic socket rubbing after weight loss',
        description: 'What the group suggested.',
        url: 'https://www.inspire.com/groups/amputee-coalition/discussion/socket-rubbing/',
        meta_url: { hostname: 'www.inspire.com' },
      },
    ],
  };

  const queries = [];
  const mock = mockFetch({
    'api.search.brave.com': (url) => {
      const query = new URL(url).searchParams.get('q');
      queries.push(query);
      return { body: { web: { results: byQuery[query] || [] } } };
    },
  });
  let result;
  try {
    result = await websearch.poll();
  } finally {
    mock.restore();
  }

  assert.equal(result.added, 4, 'every site/keyword pair produced a question');
  assert.deepEqual(queries.sort(), Object.keys(byQuery).sort());

  const captured = items.query({ source: 'websearch' }).items;
  const quora = captured.filter((i) => i.author === 'Quora');
  const inspire = captured.filter((i) => i.author === 'Inspire');
  assert.equal(quora.length, 2);
  assert.equal(inspire.length, 2);

  // The question itself is the title, and the keyword that found it is
  // attributed even where the snippet does not repeat it.
  const night = quora.find((i) => i.url.includes('at-night'));
  assert.match(night.text, /^What actually helps phantom limb pain at night\?/);
  assert.deepEqual(night.keywords_matched, ['phantom limb pain']);
  assert.equal(night.origin, 'www.quora.com');
  assert.equal(night.kind, 'search result');

  const twoYears = inspire.find((i) => i.url.includes('phantom-two-years'));
  assert.deepEqual(twoYears.keywords_matched, ['phantom limb pain']);
  assert.equal(twoYears.origin, 'www.inspire.com');
});

test('the site check runs one query and reports what came back', async () => {
  const mock = mockFetch({
    'api.search.brave.com': {
      body: {
        web: {
          results: [
            {
              title: 'Does anyone else get <strong>phantom limb pain</strong> in the cold?',
              description: 'A thread in the amputee community.',
              url: 'https://www.inspire.com/groups/amputee-coalition/discussion/cold/',
              meta_url: { hostname: 'www.inspire.com' },
            },
          ],
        },
      },
    },
  });
  let checked;
  try {
    checked = await websearch.testQuery({ domain: 'inspire.com', term: 'phantom limb pain' });
  } finally {
    mock.restore();
  }

  assert.equal(checked.query, 'site:inspire.com "phantom limb pain"');
  assert.equal(checked.site, 'Inspire');
  assert.equal(checked.count, 1);
  assert.match(checked.results[0].title, /^Does anyone else get phantom limb pain/);
  assert.match(checked.quota, /this month$/);
});

test('the site check says what is missing instead of failing obscurely', async () => {
  const config = require('../src/config');
  const key = config.search.brave.apiKey;
  config.search.brave.apiKey = '';
  try {
    await assert.rejects(
      () => websearch.testQuery({ domain: 'quora.com', term: 'phantom limb pain' }),
      /BRAVE_SEARCH_API_KEY/
    );
  } finally {
    config.search.brave.apiKey = key;
  }
});

test('domains are normalized and validated', () => {
  assert.equal(sites.add('https://www.Example.com/groups/x').domain, 'example.com');
  assert.throws(() => sites.add('not a domain'), /is not a domain/);
});

test('an install that never used web search adopts the new on-by-default', () => {
  // The marker is written once, and a deliberate pause afterwards stands.
  const marker = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('websearch.default_on_applied');
  assert.ok(marker, 'the migration recorded that it ran');
  assert.equal(settings.get('websearch.enabled'), 'true');

  settings.set('websearch.enabled', 'false');
  delete require.cache[require.resolve('../src/db')];
  require('../src/db');
  assert.equal(
    settings.get('websearch.enabled'),
    'false',
    'a pause after the migration is not undone'
  );
  settings.set('websearch.enabled', 'true');
});
