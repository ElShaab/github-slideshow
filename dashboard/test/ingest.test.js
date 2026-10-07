'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb } = require('./helpers');

useTempDb('ingest');
const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const { ingest, toIso } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');

keywords.create({ term: 'phantom limb' });
keywords.create({ term: 'prosthetic' });

const candidate = (id, text, extra = {}) => ({
  external_id: id,
  author: 'u/someone',
  text,
  url: `https://example.test/${id}`,
  timestamp: 1700000000,
  ...extra,
});

test('stores matching items and skips non-matching ones', () => {
  const stats = ingest(
    'reddit',
    [
      candidate('t3_a', 'My phantom limb keeps me up at night'),
      candidate('t3_b', 'Unrelated post about bicycles'),
    ],
    matcherFor('reddit')
  );
  assert.equal(stats.fetched, 2);
  assert.equal(stats.added, 1);
  assert.equal(stats.unmatched, 1);
});

test('re-polling the same IDs adds nothing', () => {
  const stats = ingest(
    'reddit',
    [
      candidate('t3_a', 'My phantom limb keeps me up at night'),
      candidate('t3_b', 'Unrelated post about bicycles'),
    ],
    matcherFor('reddit')
  );
  assert.equal(stats.added, 0);
  // The captured one is a duplicate; the unmatched one is simply weighed
  // again, because the keyword list it failed against can change.
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.unmatched, 1);
  assert.equal(items.query({ source: 'reddit' }).total, 1);
});

test('a keyword added later catches a post that was already passed over', () => {
  // The bicycle post above has been fetched twice and matched nothing. This
  // is the case that made a working source look broken: anything fetched
  // before a keyword existed could never be captured.
  keywords.create({ term: 'bicycles' });
  const stats = ingest(
    'reddit',
    [candidate('t3_b', 'Unrelated post about bicycles')],
    matcherFor('reddit')
  );
  assert.equal(stats.added, 1, 'the new keyword reaches back to it');
  const caught = items.query({ source: 'reddit' }).items.find((i) => i.external_id === 't3_b');
  assert.deepEqual(caught.keywords_matched, ['bicycles']);

  // And once captured it is in the ledger, so it is not captured twice.
  const again = ingest(
    'reddit',
    [candidate('t3_b', 'Unrelated post about bicycles')],
    matcherFor('reddit')
  );
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 1);
});

test('a dismissed item stays dismissed, it does not come back on the next poll', () => {
  const captured = items.query({ source: 'reddit' }).items.find((i) => i.external_id === 't3_b');
  items.remove(captured.id);

  const stats = ingest(
    'reddit',
    [candidate('t3_b', 'Unrelated post about bicycles')],
    matcherFor('reddit')
  );
  assert.equal(stats.added, 0, 'the ledger entry from capture still suppresses it');
  assert.equal(stats.duplicates, 1);
});

test('dedup is per source, so the same ID on another source still lands', () => {
  const stats = ingest(
    'x',
    [candidate('t3_a', 'phantom limb talk on X')],
    matcherFor('x')
  );
  assert.equal(stats.added, 1);
});

test('a dismissed item does not come back on the next poll', () => {
  const [item] = items.query({ source: 'x' }).items;
  assert.equal(items.remove(item.id), true);
  const stats = ingest(
    'x',
    [candidate('t3_a', 'phantom limb talk on X')],
    matcherFor('x')
  );
  assert.equal(stats.added, 0);
  assert.equal(stats.duplicates, 1);
});

test('records every matched keyword and a primary', () => {
  ingest(
    'reddit',
    [candidate('t3_c', 'New prosthetic and the phantom limb feeling is back')],
    matcherFor('reddit')
  );
  const item = items
    .query({ source: 'reddit' })
    .items.find((i) => i.external_id === 't3_c');
  assert.equal(item.keyword_matched, 'phantom limb');
  assert.deepEqual(item.keywords_matched, ['phantom limb', 'prosthetic']);
});

test('fallbackKeyword keeps API-side matches whose text does not contain the term', () => {
  const stats = ingest(
    'youtube',
    [candidate('video:1', 'A video about mobility', { fallbackKeyword: 'limb loss' })],
    matcherFor('youtube')
  );
  assert.equal(stats.added, 1);
  const item = items
    .query({ source: 'youtube' })
    .items.find((i) => i.external_id === 'video:1');
  assert.equal(item.keyword_matched, 'limb loss');
});

test('filters by source, keyword, status and free text', () => {
  assert.equal(items.query({ source: 'reddit' }).total, 2);
  assert.equal(items.query({ keyword: 'prosthetic' }).total, 1);
  assert.equal(items.query({ q: 'bicycles' }).total, 0);
  assert.equal(items.query({ status: 'new' }).total, items.query({}).total);
});

test('status moves through new / reviewed / used', () => {
  const [item] = items.query({ source: 'reddit' }).items;
  assert.equal(items.setStatus(item.id, 'reviewed').status, 'reviewed');
  assert.equal(items.setStatus(item.id, 'used').status, 'used');
  assert.throws(() => items.setStatus(item.id, 'archived'), /Status must be one of/);
  assert.equal(items.query({ status: 'used' }).total, 1);
});

test('feed is ordered newest first', () => {
  ingest(
    'reddit',
    [candidate('t3_new', 'phantom limb, newest', { timestamp: 1800000000 })],
    matcherFor('reddit')
  );
  assert.equal(items.query({ source: 'reddit' }).items[0].external_id, 't3_new');
});

test('timestamps normalize to ISO from seconds, millis, Date and strings', () => {
  assert.equal(toIso(1700000000), '2023-11-14T22:13:20.000Z');
  assert.equal(toIso(1700000000000), '2023-11-14T22:13:20.000Z');
  assert.equal(toIso('2023-11-14T22:13:20Z'), '2023-11-14T22:13:20.000Z');
  assert.equal(toIso(new Date(0)), '1970-01-01T00:00:00.000Z');
  assert.ok(toIso('not a date').endsWith('Z'));
});
