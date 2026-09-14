#!/usr/bin/env node
/**
 * Release preflight — checks what App Review checks, before the build is made
 * rather than after it is rejected.
 *
 *   npm run preflight -- --profile production
 *
 * Exits non-zero naming the exact fields to fix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { checkRelease } from './preflightChecks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileArg = process.argv.indexOf('--profile');
const profile = profileArg === -1 ? 'production' : process.argv[profileArg + 1];

const { problems, warnings } = checkRelease({
  app: JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo,
  eas: JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8')),
  profile,
  env: process.env,
});

for (const warning of warnings) console.warn(`  note     ${warning}`);

if (problems.length > 0) {
  console.error(`\n✖ Not ready to build "${profile}" — ${problems.length} to fix:\n`);
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error('\nSee RELEASE.md, "Before you build".\n');
  process.exit(1);
}

console.log(`✓ "${profile}" preflight passed.`);
