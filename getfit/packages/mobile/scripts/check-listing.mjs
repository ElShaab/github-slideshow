#!/usr/bin/env node
/**
 * Checks the App Store listing copy against Apple's length limits.
 *
 *   npm run listing
 *
 * Exits non-zero naming the field and how far over it is.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LISTING_FIELDS, measure } from './listingLimits.mjs';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const results = measure(readFileSync(resolve(docs, 'STORE_LISTING.md'), 'utf8'), LISTING_FIELDS);

let failed = 0;
for (const { name, limit, length, over } of results) {
  if (length < 0) {
    console.error(`✖ ${name}: no copy found`);
    failed += 1;
  } else if (over > 0) {
    console.error(`✖ ${name}: ${length}/${limit} — ${over} over`);
    failed += 1;
  } else {
    console.log(`✓ ${name}: ${length}/${limit}`);
  }
}

if (failed > 0) {
  console.error('\nApp Store Connect refuses copy over the limit; trim it before pasting.\n');
  process.exit(1);
}
