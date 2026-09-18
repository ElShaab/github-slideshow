'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb } = require('./helpers');

useTempDb('matcher');
const { buildPattern, compile, matchAll } = require('../src/lib/matcher');

test('matching is case-insensitive', () => {
  assert.ok(buildPattern('Phantom Limb').test('my phantom limb hurts'));
});

test('phrases tolerate extra whitespace and newlines', () => {
  assert.ok(buildPattern('limb loss').test('after limb\n  loss surgery'));
});

test('word boundaries prevent substring false positives', () => {
  assert.ok(!buildPattern('ak').test('that makes sense'));
  assert.ok(buildPattern('ak').test('my AK amputation'));
});

test('hyphens and punctuation are treated literally', () => {
  assert.ok(buildPattern('below-knee').test('a below-knee prosthesis'));
  assert.ok(!buildPattern('below-knee').test('below the knee'));
});

test('matchAll returns every hit, first one first', () => {
  const compiled = compile([
    { id: 1, term: 'prosthetic' },
    { id: 2, term: 'phantom pain' },
    { id: 3, term: 'wheelchair' },
  ]);
  const hits = matchAll('New prosthetic socket, still phantom pain at night', compiled);
  assert.deepEqual(hits.map((h) => h.term), ['prosthetic', 'phantom pain']);
});

test('empty text matches nothing', () => {
  assert.deepEqual(matchAll('', compile([{ id: 1, term: 'x' }])), []);
});
