#!/usr/bin/env node
/**
 * Whether this build would actually carry the Supabase keys.
 *
 * Two things make that hard to see from the outside. The values are
 * substituted into the bundle at build time rather than read on the device, so
 * nothing on disk tells you whether they made it; and Metro caches the
 * transformed module by file content, which `.env` is not part of, so editing
 * `.env` and rebuilding can silently reuse the previous values.
 *
 * This bundles with the cache reset and looks for the values in the output. It
 * takes about twenty seconds and answers the question a full Xcode build would
 * otherwise take ten minutes to answer badly.
 *
 *   npm run env:check --workspace @getfit/mobile
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLE = '/tmp/getfit-env-check.js';

function fromEnvFile(name) {
  try {
    for (const line of readFileSync(path.join(MOBILE, '.env'), 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && match[1] === name) return match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fromEnvFile('EXPO_PUBLIC_SUPABASE_URL');
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  fromEnvFile('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

console.log(`\nGetFit — build configuration check\n${'-'.repeat(40)}`);

if (!url || !key) {
  console.log('  FAIL  packages/mobile/.env has no Supabase values');
  console.log('        Copy .env.example to .env and fill in both lines.');
  console.log('        Without them the app skips the account step after payment.\n');
  process.exit(1);
}
console.log(`  .env  ${url}`);
console.log('  bundling with the cache reset (about 20 seconds)…\n');

rmSync(BUNDLE, { force: true });
try {
  execFileSync(
    'npx',
    [
      'expo', 'export:embed',
      '--platform', 'ios',
      '--dev', 'false',
      '--minify', 'false',
      '--reset-cache',
      '--entry-file', 'packages/mobile/index.js',
      '--bundle-output', BUNDLE,
      '--assets-dest', '/tmp/getfit-env-assets',
    ],
    { cwd: MOBILE, stdio: ['ignore', 'ignore', 'inherit'] },
  );
} catch {
  console.log('\n  FAIL  the bundle did not build. The output above says why.\n');
  process.exit(1);
}

const bundle = readFileSync(BUNDLE, 'utf8');
const hasUrl = bundle.includes(url);
const hasKey = bundle.includes(key);

console.log(hasUrl ? '  ok    the project URL is in the bundle' : '  FAIL  the project URL is NOT in the bundle');
console.log(hasKey ? '  ok    the publishable key is in the bundle' : '  FAIL  the publishable key is NOT in the bundle');

if (hasUrl && hasKey) {
  console.log('\nThis build will ask for an email after payment.\n');
  process.exit(0);
}

console.log('\n  The values are in .env but did not reach the bundle. That is the');
console.log('  Metro cache: it keys on file content, and .env is not part of it.');
console.log('  Run `npx expo start --clear` once, then build again.\n');
process.exit(1);
