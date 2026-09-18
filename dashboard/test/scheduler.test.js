'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('scheduler');
// Deliberately leave X_BEARER_TOKEN and YOUTUBE_API_KEY unset.

const { db } = require('../src/db');
const keywords = require('../src/lib/keywords');
const settings = require('../src/lib/settings');
const state = require('../src/lib/state');
const scheduler = require('../src/scheduler');

keywords.create({ term: 'phantom limb pain' });

// One subreddit keeps the polite inter-request pacing from slowing the suite.
db.prepare("DELETE FROM subreddits WHERE name <> 'amputee'").run();

test('a failing source is recorded without taking the others down', async () => {
  const mock = mockFetch({
    'reddit.com': { status: 500, body: { error: 'reddit is down' } },
    'esearch.fcgi': { body: { esearchresult: { count: '0', idlist: [] } } },
  });
  try {
    const [redditResult, pubmedResult] = await Promise.all([
      scheduler.runSource('reddit', { manual: true }),
      scheduler.runSource('pubmed', { manual: true }),
    ]);
    assert.equal(redditResult.ok, false);
    assert.match(redditResult.error, /500/);
    assert.equal(pubmedResult.ok, true);
  } finally {
    mock.restore();
  }

  assert.equal(state.get('reddit').last_status, 'error');
  assert.equal(state.get('pubmed').last_status, 'ok');
});

test('a 429 parks the source behind a backoff instead of retrying hot', async () => {
  const mock = mockFetch({
    'reddit.com': {
      status: 429,
      body: { error: 'too many requests' },
      headers: { 'content-type': 'application/json', 'retry-after': '120' },
    },
  });
  try {
    const result = await scheduler.runSource('reddit', { manual: true });
    assert.equal(result.status, 'rate-limited');
  } finally {
    mock.restore();
  }

  const row = state.get('reddit');
  assert.ok(new Date(row.next_allowed_at) > new Date());
  assert.equal(state.canRun('reddit'), false);

  const skipped = await scheduler.runSource('reddit', { manual: true });
  assert.equal(skipped.skipped, 'backing-off');

  state.backOff('reddit', 0);
});

test('a source missing credentials is skipped, not crashed', async () => {
  const result = await scheduler.runSource('x', { manual: true });
  assert.equal(result.skipped, 'not-configured');
  assert.equal(state.get('x').last_status, 'skipped');
});

test('disabled sources are skipped by the scheduler but can be polled manually', async () => {
  settings.set('pubmed.enabled', 'false');
  const auto = await scheduler.runSource('pubmed');
  assert.equal(auto.skipped, 'disabled');

  const mock = mockFetch({
    'esearch.fcgi': { body: { esearchresult: { count: '0', idlist: [] } } },
  });
  try {
    const manual = await scheduler.runSource('pubmed', { manual: true });
    assert.equal(manual.ok, true);
  } finally {
    mock.restore();
    settings.set('pubmed.enabled', 'true');
  }
});

test('unknown sources are reported rather than thrown', async () => {
  const result = await scheduler.runSource('facebook', { manual: true });
  assert.equal(result.skipped, 'unknown-source');
});

test("X's tier floor overrides a too-aggressive configured interval", () => {
  settings.setMany({ 'x.tier': 'basic', 'x.interval_minutes': '1' });
  const x = scheduler.status().find((s) => s.id === 'x');
  assert.equal(x.interval_minutes, 1);
  assert.equal(x.effective_interval_minutes, 15);
});

test('status reports which credentials are missing', () => {
  const x = scheduler.status().find((s) => s.id === 'x');
  assert.equal(x.configured, false);
  assert.deepEqual(
    x.credentials.map((c) => [c.env, c.present]),
    [['X_BEARER_TOKEN', false]]
  );
});
