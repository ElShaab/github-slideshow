'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('missed');

const { db } = require('../src/db');
const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const subreddits = require('../src/lib/subreddits');
const missed = require('../src/lib/missed');
const reddit = require('../src/sources/reddit');
const { app } = require('../src/server');

// The keywords the physician actually had: long clinical phrases.
keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'prosthetic socket' });

db.prepare('DELETE FROM subreddits').run();
subreddits.add('amputee');

/** Posts written the way people write them, not the way papers do. */
const POSTS = [
  ['t3_m1', 'Socket rubbing after I lost weight', 'My socket rubs raw on the inside since I dropped 15 pounds. New liner?'],
  ['t3_m2', 'Liner sweating in the heat', 'The liner fills with sweat by noon and the socket slips. Any tricks?'],
  ['t3_m3', 'PLP at night', 'The PLP is worst at 3am. Mirror therapy did nothing for me.'],
  ['t3_m4', 'Socket fit after a revision', 'Third socket in eight months. Is that normal after a revision?'],
  ['t3_m5', 'PLP and sleep', 'Anyone found anything for PLP keeping them awake?'],
  ['t3_m6', 'First 5k on my leg', 'Ran my first 5k today, no pain at all. Feeling great.'],
];

function atomFeed(rows) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>r/amputee</title>${rows
    .map(
      ([id, title, body]) =>
        `<entry><author><name>/u/someone</name></author><id>${id}</id>` +
        `<link href="https://www.reddit.com/r/amputee/comments/${id}/x/"/>` +
        `<updated>2026-10-06T08:00:00+00:00</updated><title>${title}</title>` +
        `<content type="html">&lt;p&gt;${body}&lt;/p&gt;</content></entry>`
    )
    .join('')}</feed>`;
}

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
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

test('a poll whose posts match no keyword captures nothing but keeps them in view', async () => {
  missed.clear();
  reddit.forgetPreferred();
  const mock = mockFetch({
    '/r/amputee/new/.rss': { body: atomFeed(POSTS), headers: { 'content-type': 'application/atom+xml' } },
    '/r/amputee/comments/.rss': { body: atomFeed([]), headers: { 'content-type': 'application/atom+xml' } },
  });
  let result;
  try {
    result = await reddit.poll();
  } finally {
    mock.restore();
  }

  // This is exactly what the physician saw: a working source, an empty feed.
  assert.equal(result.fetched, 6);
  assert.equal(result.added, 0);
  assert.equal(result.unmatched, 6);
  assert.equal(items.query({ source: 'reddit' }).total, 0);

  // But nothing is lost: all six are waiting, newest first.
  const held = missed.recent(['reddit']);
  assert.equal(held.length, 6);
  assert.ok(held.every((p) => p.source === 'reddit'));
});

test('the words that keep coming up are suggested, clinical vocabulary first', () => {
  const suggestions = missed.suggest(missed.recent(['reddit']), keywords.list().map((k) => k.term));
  const terms = suggestions.map((s) => s.term);

  assert.ok(terms.includes('socket'), `socket is suggested (got ${terms.join(', ')})`);
  assert.ok(terms.includes('liner'), 'liner is suggested');
  assert.ok(terms.includes('plp'), 'the abbreviation people actually use is suggested');

  const socket = suggestions.find((s) => s.term === 'socket');
  assert.equal(socket.posts, 3, 'counted by posts, not occurrences');
  assert.equal(socket.domain, true);
  assert.match(socket.sample, /socket/i, 'with an excerpt for context');

  // Chatter, number words and words that appear once are not offered.
  for (const noise of ['anyone', 'today', 'great', 'ran', 'eight', 'keeps', 'third']) {
    assert.ok(!terms.includes(noise), `${noise} is not suggested`);
  }
  // Already tracked phrases are not offered back.
  assert.ok(!terms.includes('prosthetic socket'));
});

test('GET /api/sources/missed reports the posts and the suggestions', async () => {
  const { status, data } = await call('/api/sources/missed');
  assert.equal(status, 200);
  assert.equal(data.total, 6);
  assert.deepEqual(data.by_source, { reddit: 6 });
  assert.ok(data.suggestions.some((s) => s.term === 'socket'));
  assert.equal(data.posts.length, 6);
  assert.match(data.posts.find((p) => p.external_id === 't3_m1').text, /Socket rubbing/);

  // Literature is not a question source and cannot be asked for here.
  const lit = await call('/api/sources/missed?source=literature');
  assert.equal(lit.data.total, 6, 'an unknown or literature source falls back to the community set');
});

test('tracking a suggested word captures its posts at once, with no new poll', async () => {
  // Any network call here would mean it waited for Reddit; it must not.
  const mock = mockFetch({});
  let created;
  try {
    created = await call('/api/keywords', { method: 'POST', body: { term: 'socket', scope: 'all' } });
  } finally {
    mock.restore();
  }
  const outbound = mock.calls.filter((u) => !/127\.0\.0\.1|localhost/.test(u));
  assert.deepEqual(outbound, [], 'nothing was fetched');

  assert.equal(created.status, 201);
  assert.equal(created.data.recheck.added, 3, 'the three socket posts were captured');
  assert.deepEqual(created.data.recheck.bySource, { reddit: 3 });

  const captured = items.query({ source: 'reddit' }).items;
  assert.equal(captured.length, 3);
  assert.ok(captured.every((i) => i.keywords_matched.includes('socket')));

  // And they leave the missed list.
  const after = await call('/api/sources/missed');
  assert.equal(after.data.total, 3);
  assert.ok(!after.data.posts.some((p) => p.external_id === 't3_m1'));
});

test('a second word reaches the rest, and the next poll does not duplicate them', async () => {
  const created = await call('/api/keywords', { method: 'POST', body: { term: 'plp', scope: 'all' } });
  assert.equal(created.data.recheck.added, 2);
  assert.equal(items.query({ source: 'reddit' }).total, 5);

  // The off-topic 5k post is the only one still waiting.
  const left = missed.recent(['reddit']).map((p) => p.external_id);
  assert.deepEqual(left, ['t3_m6']);

  const mock = mockFetch({
    '/r/amputee/new/.rss': { body: atomFeed(POSTS), headers: { 'content-type': 'application/atom+xml' } },
    '/r/amputee/comments/.rss': { body: atomFeed([]), headers: { 'content-type': 'application/atom+xml' } },
  });
  let result;
  try {
    result = await reddit.poll();
  } finally {
    mock.restore();
  }
  assert.equal(result.added, 0, 'nothing captured twice');
  assert.equal(result.duplicates, 5);
  assert.equal(result.unmatched, 1);
  assert.equal(items.query({ source: 'reddit' }).total, 5);
});

test('the working set is bounded, so a busy source cannot grow it without limit', () => {
  missed.clear();
  for (let i = 0; i < missed.MAX_PER_SOURCE + 40; i += 1) {
    missed.record('reddit', { external_id: `t3_bulk${i}`, text: `post ${i}` });
  }
  const held = missed.recent(['reddit']);
  assert.equal(held.length, missed.MAX_PER_SOURCE);
  // The oldest were dropped, the newest kept.
  assert.ok(held.some((p) => p.external_id === `t3_bulk${missed.MAX_PER_SOURCE + 39}`));
  assert.ok(!held.some((p) => p.external_id === 't3_bulk0'));
  missed.clear();
});
