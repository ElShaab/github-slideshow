import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Circular imports in a TypeScript source tree.
 *
 * A cycle is not always fatal — a type-only edge disappears at compile time —
 * but a runtime one produces a module that is briefly undefined, and which
 * half of the cycle loses depends on the order the bundler happens to emit.
 * That is how a build works in development and fails in release, so the graph
 * is checked rather than assumed acyclic.
 */

const SOURCE = /\.tsx?$/;
/**
 * Both ways a module can depend on another at runtime.
 *
 * `export … from` is a re-export and every bit as real an edge as an import —
 * a barrel file is nothing but those. Missing them is how a checker reports a
 * clean graph while the cycle it was written to find sits in an index.ts.
 */
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g;

export function sourceFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

/** Resolves a relative specifier the way the bundler does. */
export function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/**
 * The import graph, with type-only edges dropped.
 *
 * `import type` is erased before the bundler ever sees it, so counting it
 * would report cycles that cannot exist at runtime — and a checker that cries
 * wolf gets turned off.
 */
export function buildGraph(root) {
  const graph = new Map();
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const edges = new Set();
    for (const [, typeOnly, specifier] of source.matchAll(IMPORT)) {
      if (typeOnly) continue;
      const target = resolveImport(file, specifier);
      if (target) edges.add(target);
    }
    graph.set(file, edges);
  }
  return graph;
}

/** Every runtime import cycle, each as the list of modules that form it. */
export function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];

  const visit = (node) => {
    state.set(node, 'open');
    stack.push(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (state.get(next) === 'open') cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of [...graph.keys()].sort()) if (!state.has(node)) visit(node);
  return cycles;
}
