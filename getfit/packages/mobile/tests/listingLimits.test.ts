/**
 * The App Store listing copy, against Apple's limits.
 *
 * A field one character over is rejected outright, and the copy is edited far
 * more often than it is pasted — so the real document is measured here rather
 * than a fixture, and a trimmed subtitle that creeps back over fails a test
 * instead of failing at the paste.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { LISTING_FIELDS, fencedBlocks, measure } from '../scripts/listingLimits.mjs';

const listing = readFileSync(path.resolve(__dirname, '..', '..', '..', 'STORE_LISTING.md'), 'utf8');

describe('reading the copy out of the document', () => {
  test('takes each fenced block, without its fences', () => {
    assert.deepEqual(fencedBlocks('a\n```\none\n```\nb\n```\ntwo\n```\n'), ['one', 'two']);
  });

  test('a document with no copy in it yields nothing', () => {
    assert.deepEqual(fencedBlocks('just prose'), []);
  });

  test('trailing blank lines are not counted as characters', () => {
    assert.deepEqual(fencedBlocks('```\nhello\n\n\n```'), ['hello']);
  });
});

describe('the committed listing fits', () => {
  const measured = measure(listing, LISTING_FIELDS);

  for (const [index, field] of LISTING_FIELDS.entries()) {
    test(`${field.name} is within ${field.limit}`, () => {
      const result = measured[index];
      assert.ok(result.length > 0, `${field.name} has no copy`);
      assert.equal(result.over, 0, `${field.name} is ${result.length}, ${result.over} over`);
    });
  }

  test('a field over the limit is reported, not rounded down', () => {
    const over = measure('```\n' + 'x'.repeat(31) + '\n```', [{ name: 'Subtitle', limit: 30 }]);
    assert.equal(over[0].over, 1);
  });

  test('a missing field is reported rather than passing silently', () => {
    const missing = measure('no copy here', [{ name: 'Subtitle', limit: 30 }]);
    assert.equal(missing[0].length, -1);
  });
});

describe('the copy says nothing the app does not do', () => {
  const description = fencedBlocks(listing)[3] ?? '';

  test('claims no AI, because there is none', () => {
    // Body composition is computed in-process from published formulas. The
    // repository name is a leftover; the app has no model and no AI provider.
    assert.doesNotMatch(description, /\bAI\b|artificial intelligence|machine learning/i);
  });

  test('makes no ranking claim, which Apple rejects without evidence', () => {
    assert.doesNotMatch(description, /\b(#1|number one|best app|world's best)\b/i);
  });

  test('states the subscription terms Guideline 3.1.2 requires', () => {
    for (const required of [/\$4\.99/, /\$19\.99/, /per month/, /per year/, /renews automatically/]) {
      assert.match(description, required);
    }
  });

  test('links the privacy policy this repository publishes', () => {
    assert.match(description, /github\.io\/github-slideshow\/privacy\.html/);
  });

  test('carries the health disclaimer the app carries', () => {
    // Matched on substance rather than exact phrasing: the wording should be
    // free to change, the disclaimer should not be free to disappear.
    assert.match(description, /not a medical device/i);
    assert.match(description, /medical advice/i);
    assert.match(description, /doctor/i);
  });
});
