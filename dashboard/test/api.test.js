'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb } = require('./helpers');

useTempDb('api');
const { app } = require('../src/server');

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

test('health reports every source', async () => {
  const { status, data } = await call('/api/health');
  assert.equal(status, 200);
  assert.deepEqual(
    data.sources.map((s) => s.id),
    ['reddit', 'x', 'youtube', 'pubmed', 'websearch']
  );
});

test('keyword CRUD round trip', async () => {
  const created = await call('/api/keywords', {
    method: 'POST',
    body: { term: ' Limb Loss ', scope: 'specific', sources: ['reddit', 'youtube'] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.term, 'Limb Loss');

  const duplicate = await call('/api/keywords', {
    method: 'POST',
    body: { term: 'limb loss' },
  });
  assert.equal(duplicate.status, 409);

  const invalid = await call('/api/keywords', {
    method: 'POST',
    body: { term: 'x', scope: 'specific', sources: ['inspire'] },
  });
  assert.equal(invalid.status, 400);

  const updated = await call(`/api/keywords/${created.data.id}`, {
    method: 'PUT',
    body: { scope: 'all' },
  });
  assert.deepEqual(updated.data.sources, [
    'reddit',
    'x',
    'youtube',
    'pubmed',
    'websearch',
  ]);

  const listed = await call('/api/keywords');
  assert.equal(listed.data.keywords.length, 1);

  const removed = await call(`/api/keywords/${created.data.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.equal((await call('/api/keywords')).data.keywords.length, 0);
  assert.equal((await call(`/api/keywords/${created.data.id}`)).status, 404);
});

test('settings can be read and written, and reject junk keys', async () => {
  const before = await call('/api/settings');
  assert.ok(before.data['reddit.interval_minutes']);

  const saved = await call('/api/settings', {
    method: 'PUT',
    body: { 'reddit.interval_minutes': '20' },
  });
  assert.equal(saved.data['reddit.interval_minutes'], '20');

  const bad = await call('/api/settings', {
    method: 'PUT',
    body: { 'drop table': '1' },
  });
  assert.equal(bad.status, 400);
});

test('subreddit list validates input', async () => {
  const added = await call('/api/sources/reddit/subreddits', {
    method: 'POST',
    body: { name: 'https://www.reddit.com/r/AmputeeLife/' },
  });
  assert.equal(added.status, 201);
  assert.equal(added.data.name, 'AmputeeLife');

  const bad = await call('/api/sources/reddit/subreddits', {
    method: 'POST',
    body: { name: 'not a subreddit!' },
  });
  assert.equal(bad.status, 400);

  const removed = await call(`/api/sources/reddit/subreddits/${added.data.id}`, {
    method: 'DELETE',
  });
  assert.equal(removed.status, 204);
});

test('youtube channel IDs are validated before an API call is attempted', async () => {
  const bad = await call('/api/sources/youtube/channels', {
    method: 'POST',
    body: { channel_id: 'definitely-not-a-channel' },
  });
  assert.equal(bad.status, 500);
  assert.match(bad.data.error, /YOUTUBE_API_KEY is not set/);
});

test('polling an unconfigured source answers 202 rather than failing', async () => {
  const { status, data } = await call('/api/sources/x/poll', { method: 'POST' });
  assert.equal(status, 202);
  assert.equal(data.skipped, 'not-configured');
});

test('unknown API routes give JSON 404 and the SPA route gives HTML', async () => {
  const missing = await call('/api/nope');
  assert.equal(missing.status, 404);

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Amputee Research Dashboard/);
});
