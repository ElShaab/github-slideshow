'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb } = require('./helpers');

useTempDb('keywords');
const keywords = require('../src/lib/keywords');

test('trims and collapses whitespace', () => {
  const created = keywords.create({ term: '  phantom   limb  pain ' });
  assert.equal(created.term, 'phantom limb pain');
});

test('rejects duplicates case-insensitively', () => {
  assert.throws(
    () => keywords.create({ term: 'PHANTOM Limb Pain' }),
    /already exists/
  );
});

test('rejects an empty keyword', () => {
  assert.throws(() => keywords.create({ term: '   ' }), /cannot be empty/);
});

test('scope "all" expands to every source', () => {
  const created = keywords.create({ term: 'socket fit' });
  assert.deepEqual(created.sources, ['reddit', 'x', 'youtube', 'pubmed']);
});

test('specific scope stores only the chosen sources', () => {
  const created = keywords.create({
    term: 'osseointegration',
    scope: 'specific',
    sources: ['pubmed'],
  });
  assert.deepEqual(created.sources, ['pubmed']);
});

test('specific scope requires at least one source', () => {
  assert.throws(
    () => keywords.create({ term: 'nothing', scope: 'specific', sources: [] }),
    /at least one source/
  );
});

test('unknown sources are rejected', () => {
  assert.throws(
    () => keywords.create({ term: 'facebook group', scope: 'specific', sources: ['facebook'] }),
    /Unknown source/
  );
});

test('forSource reads the live list, honouring scope and enabled', () => {
  const reddit = keywords.forSource('reddit').map((k) => k.term);
  assert.ok(reddit.includes('phantom limb pain'));
  assert.ok(!reddit.includes('osseointegration'));

  const pubmed = keywords.forSource('pubmed').map((k) => k.term);
  assert.ok(pubmed.includes('osseointegration'));

  const target = keywords.list().find((k) => k.term === 'socket fit');
  keywords.update(target.id, { enabled: false });
  assert.ok(!keywords.forSource('reddit').some((k) => k.term === 'socket fit'));
});

test('update can switch scope and rename without clashing', () => {
  const target = keywords.list().find((k) => k.term === 'socket fit');
  const updated = keywords.update(target.id, {
    term: 'socket fit issues',
    scope: 'specific',
    sources: ['reddit', 'youtube'],
    enabled: true,
  });
  assert.equal(updated.term, 'socket fit issues');
  assert.deepEqual(updated.sources, ['reddit', 'youtube']);

  assert.throws(
    () => keywords.update(target.id, { term: 'osseointegration' }),
    /already exists/
  );
});

test('delete removes the keyword and its source rows', () => {
  const target = keywords.list().find((k) => k.term === 'socket fit issues');
  assert.equal(keywords.remove(target.id), true);
  assert.equal(keywords.get(target.id), null);
  assert.equal(keywords.remove(target.id), false);
});
