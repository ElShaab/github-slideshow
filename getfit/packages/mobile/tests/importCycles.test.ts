/**
 * Circular imports.
 *
 * A cycle is not always fatal — a type-only edge disappears at compile time —
 * but a runtime one leaves one of the modules briefly undefined, and which one
 * loses depends on the order the bundler happens to emit. That is how a build
 * works in development and throws in release, where the failure surfaces as a
 * blank screen and a message that explains nothing.
 */
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { buildGraph, findCycles, resolveImport, sourceFiles } from '../scripts/importCycles.mjs';

const src = path.resolve(__dirname, '..', 'src');

describe('reading the graph', () => {
  test('finds the app source', () => {
    const files = sourceFiles(src);
    assert.ok(files.length > 50, `only found ${files.length} modules`);
    assert.ok(files.every((f: string) => /\.tsx?$/.test(f)));
  });

  test('resolves a directory import to its index', () => {
    const resolved = resolveImport(path.join(src, 'screens', 'x.tsx'), '../components');
    assert.equal(resolved, path.join(src, 'components', 'index.ts'));
  });

  test('ignores packages, which cannot form a cycle with this app', () => {
    assert.equal(resolveImport(path.join(src, 'a.ts'), 'react-native'), null);
    assert.equal(resolveImport(path.join(src, 'a.ts'), '@getfit/shared'), null);
  });
});

describe('detecting a cycle', () => {
  const graph = (edges: Record<string, string[]>) =>
    new Map(Object.entries(edges).map(([k, v]) => [k, new Set(v)]));

  test('a straight chain has none', () => {
    assert.deepEqual(findCycles(graph({ a: ['b'], b: ['c'], c: [] })), []);
  });

  test('two modules importing each other is one', () => {
    const found = findCycles(graph({ a: ['b'], b: ['a'] }));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], ['a', 'b', 'a']);
  });

  test('a longer loop is found too', () => {
    const found = findCycles(graph({ a: ['b'], b: ['c'], c: ['a'] }));
    assert.equal(found.length, 1);
  });

  test('a diamond is not a cycle', () => {
    assert.deepEqual(findCycles(graph({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [] })), []);
  });
});

describe('the app itself', () => {
  test('has no runtime import cycles', () => {
    const cycles = findCycles(buildGraph(src));
    const described = cycles.map((cycle: string[]) =>
      cycle.map((file) => path.relative(src, file)).join(' → '),
    );
    assert.deepEqual(described, [], `circular imports:\n${described.join('\n')}`);
  });
});
