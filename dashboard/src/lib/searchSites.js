'use strict';

const { db } = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM search_sites ORDER BY domain'),
  enabled: db.prepare('SELECT * FROM search_sites WHERE enabled = 1 ORDER BY domain'),
  byDomain: db.prepare('SELECT * FROM search_sites WHERE domain = ?'),
  insert: db.prepare(
    'INSERT OR IGNORE INTO search_sites (domain, label) VALUES (?, ?)'
  ),
  setEnabled: db.prepare('UPDATE search_sites SET enabled = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM search_sites WHERE id = ?'),
};

/** Accepts "quora.com", "www.quora.com" or a full URL; stores the bare host. */
function normalize(raw) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('/')[0].split('?')[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) {
    const err = new Error(`"${raw}" is not a domain`);
    err.status = 400;
    throw err;
  }
  return value;
}

function hydrate(row) {
  return { ...row, enabled: !!row.enabled };
}

function list() {
  return stmts.list.all().map(hydrate);
}

function enabled() {
  return stmts.enabled.all().map(hydrate);
}

function add(rawDomain, label) {
  const domain = normalize(rawDomain);
  stmts.insert.run(domain, label ? String(label).trim() : null);
  return hydrate(stmts.byDomain.get(domain));
}

function setEnabled(id, value) {
  return stmts.setEnabled.run(value ? 1 : 0, id).changes > 0;
}

function remove(id) {
  return stmts.remove.run(id).changes > 0;
}

module.exports = { list, enabled, add, setEnabled, remove, normalize };
