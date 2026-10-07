/**
 * How the app reaches @getfit/shared.
 *
 * This pins the fix for a failure that shipped: the package's `main` points at
 * `dist/`, `dist/` is gitignored, and nothing in the iOS build path compiles
 * it. Metro therefore bundled whatever build output happened to be lying on the
 * machine — and a function added to the source but missing from a stale build
 * does not fail the bundle. It resolves to `undefined`, the bundle is written
 * with no error and no warning, and the app crashes at the first call with
 * "undefined is not a function".
 *
 * Metro resolves the `react-native` field ahead of `main`, so pointing it at
 * the TypeScript source means the app compiles it itself and can never bundle a
 * stale copy. Node ignores that field, so the server and these tests keep using
 * `dist/`.
 *
 * If someone removes it to "clean up an odd-looking field", this fails.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const SHARED = path.join(__dirname, '..', '..', 'shared');

const manifest = JSON.parse(
  readFileSync(path.join(SHARED, 'package.json'), 'utf8'),
) as Record<string, string>;

describe('the app bundles shared code from source, not from a build output', () => {
  test('the react-native entry point is declared', () => {
    assert.ok(
      manifest['react-native'],
      'Removing this makes Metro fall back to main (dist/), which is gitignored ' +
        'and not built by the iOS build — the app would silently ship stale shared code.',
    );
  });

  test('it points at a file that exists', () => {
    const entry = path.join(SHARED, manifest['react-native']);
    assert.ok(existsSync(entry), `${manifest['react-native']} does not exist`);
  });

  test('it is the TypeScript source, not the compiled output', () => {
    assert.match(manifest['react-native'], /^src\/.*\.ts$/);
    assert.ok(!manifest['react-native'].includes('dist'));
  });

  test('node consumers still resolve the compiled output', () => {
    // The server and these tests run under Node, which ignores react-native.
    // Changing main to source would break them.
    assert.match(manifest.main, /^dist\//);
  });

  test('the source entry really exports what the screens call', () => {
    // The three that were undefined on the device, named so this test says
    // something if the entry point stops re-exporting a module.
    const source = readFileSync(path.join(SHARED, manifest['react-native']), 'utf8');
    assert.match(source, /export \* from '\.\/units'/);
  });
});
