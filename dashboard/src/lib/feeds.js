'use strict';

const { db } = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM feeds ORDER BY label COLLATE NOCASE, url'),
  enabled: db.prepare(
    'SELECT * FROM feeds WHERE enabled = 1 ORDER BY label COLLATE NOCASE, url'
  ),
  insert: db.prepare('INSERT OR IGNORE INTO feeds (url, label, site_url) VALUES (?, ?, ?)'),
  byUrl: db.prepare('SELECT * FROM feeds WHERE url = ?'),
  setEnabled: db.prepare('UPDATE feeds SET enabled = ? WHERE id = ?'),
  touch: db.prepare(
    "UPDATE feeds SET last_fetched_at = datetime('now'), last_error = ? WHERE id = ?"
  ),
  remove: db.prepare('DELETE FROM feeds WHERE id = ?'),
};

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    const err = new Error('A feed address is required');
    err.status = 400;
    throw err;
  }
  // A bare host gets https://; anything that already names a scheme keeps it,
  // so a wrong one is rejected rather than folded into the path.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  let url;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    const err = new Error(`"${raw}" is not a valid address`);
    err.status = 400;
    throw err;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('Only http and https feeds are supported');
    err.status = 400;
    throw err;
  }
  url.hash = '';
  return url.toString();
}

function hydrate(row) {
  return row ? { ...row, enabled: !!row.enabled } : null;
}

function list() {
  return stmts.list.all().map(hydrate);
}

function enabled() {
  return stmts.enabled.all().map(hydrate);
}

function add({ url, label, siteUrl }) {
  const normalized = normalizeUrl(url);
  const existing = stmts.byUrl.get(normalized);
  if (existing) return hydrate(existing);
  stmts.insert.run(
    normalized,
    label ? String(label).trim().slice(0, 120) : new URL(normalized).hostname,
    siteUrl || null
  );
  return hydrate(stmts.byUrl.get(normalized));
}

function setEnabled(id, value) {
  return stmts.setEnabled.run(value ? 1 : 0, id).changes > 0;
}

/** Records the outcome of one read, so a dead feed is visible in the UI. */
function recordFetch(id, error) {
  stmts.touch.run(error ? String(error).slice(0, 300) : null, id);
}

function remove(id) {
  return stmts.remove.run(id).changes > 0;
}

module.exports = { list, enabled, add, setEnabled, recordFetch, remove, normalizeUrl };
