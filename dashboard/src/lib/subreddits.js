'use strict';

const { db } = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM subreddits ORDER BY name COLLATE NOCASE'),
  enabled: db.prepare(
    'SELECT * FROM subreddits WHERE enabled = 1 ORDER BY name COLLATE NOCASE'
  ),
  insert: db.prepare(
    'INSERT OR IGNORE INTO subreddits (name, enabled) VALUES (?, ?)'
  ),
  byName: db.prepare('SELECT * FROM subreddits WHERE name = ? COLLATE NOCASE'),
  setEnabled: db.prepare('UPDATE subreddits SET enabled = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM subreddits WHERE id = ?'),
};

function normalize(raw) {
  const name = String(raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.|old\.)?reddit\.com/i, '')
    .replace(/^\/?r\//i, '')
    .replace(/\/.*$/, '')
    .trim();
  if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) {
    const err = new Error(`"${raw}" is not a valid subreddit name`);
    err.status = 400;
    throw err;
  }
  return name;
}

function list() {
  return stmts.list.all().map((r) => ({ ...r, enabled: !!r.enabled }));
}

function enabled() {
  return stmts.enabled.all().map((r) => r.name);
}

function add(raw) {
  const name = normalize(raw);
  const existing = stmts.byName.get(name);
  if (existing) return { ...existing, enabled: !!existing.enabled };
  stmts.insert.run(name, 1);
  const row = stmts.byName.get(name);
  return { ...row, enabled: !!row.enabled };
}

function setEnabled(id, value) {
  return stmts.setEnabled.run(value ? 1 : 0, id).changes > 0;
}

function remove(id) {
  return stmts.remove.run(id).changes > 0;
}

module.exports = { list, enabled, add, setEnabled, remove, normalize };
