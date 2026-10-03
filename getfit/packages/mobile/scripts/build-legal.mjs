#!/usr/bin/env node
/**
 * Regenerates the published legal pages from the markdown in this repo.
 *
 *   npm run legal
 *
 * Writes to the repository root, because GitHub Pages serves a project site
 * from there rather than from a subdirectory. Refuses to publish a page that
 * still carries an unfilled placeholder — a privacy policy naming
 * "[LEGAL ENTITY NAME]" is worse than no page at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PAGES, placeholders, renderPage } from './legalPages.mjs';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(mobile, '..', '..');
const site = resolve(docs, '..');

let unfilled = 0;

for (const page of PAGES) {
  const markdown = readFileSync(resolve(docs, page.source), 'utf8');
  const rendered = renderPage(markdown, page);
  // Checked on the rendered page, not the source: the "Before publishing" note
  // names `[BRACKETED]` as an example and is stripped before anyone reads it.
  const missing = placeholders(rendered);

  if (missing.length > 0) {
    console.error(`✖ ${page.source} still has ${missing.length} to fill: ${missing.join(', ')}`);
    unfilled += missing.length;
    continue;
  }

  writeFileSync(resolve(site, page.output), rendered);
  console.log(`✓ ${page.output} ← ${page.source}`);
}

if (unfilled > 0) {
  console.error('\nNothing published. Fill those in first — a live page showing them is worse.\n');
  process.exit(1);
}
