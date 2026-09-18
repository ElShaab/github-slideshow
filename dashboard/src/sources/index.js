'use strict';

/**
 * Source registry. Each source module exports:
 *   id          - matches the DB source enum
 *   label       - display name
 *   credentials - [{ env, label, required }] so the UI can show what is missing
 *   isConfigured() -> boolean
 *   poll(options) -> { fetched, added, duplicates, unmatched, notes }
 *
 * poll() must throw on failure; the scheduler isolates each source so one
 * broken API never stops the others. Source modules are added one at a time.
 */
const modules = [];

const registry = new Map(modules.map((m) => [m.id, m]));

function get(id) {
  return registry.get(id) || null;
}

function list() {
  return [...registry.values()];
}

module.exports = { registry, get, list };
