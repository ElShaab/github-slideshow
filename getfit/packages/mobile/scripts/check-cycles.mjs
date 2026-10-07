#!/usr/bin/env node
/**
 * Fails when the app's modules import each other in a circle.
 *
 *   npm run cycles
 */
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { buildGraph, findCycles } from './importCycles.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const cycles = findCycles(buildGraph(root));

if (cycles.length === 0) {
  console.log('✓ no circular imports');
  process.exit(0);
}

console.error(`✖ ${cycles.length} circular import${cycles.length === 1 ? '' : 's'}:\n`);
for (const cycle of cycles) {
  console.error(`  ${cycle.map((file) => relative(root, file)).join('\n    → ')}\n`);
}
console.error('Which half of a cycle loses depends on the order the bundler emits,');
console.error('so this works until it does not, and then only in release.\n');
process.exit(1);
