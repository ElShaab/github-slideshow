'use strict';

const { db, DEFAULT_SETTINGS } = require('../db');

const selectAll = db.prepare('SELECT key, value FROM settings');
const selectOne = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsert = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

function all() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of selectAll.all()) out[row.key] = row.value;
  return out;
}

function get(key, fallback) {
  const row = selectOne.get(key);
  if (row) return row.value;
  if (key in DEFAULT_SETTINGS) return DEFAULT_SETTINGS[key];
  return fallback;
}

function getNumber(key, fallback = 0) {
  const n = Number(get(key));
  return Number.isFinite(n) ? n : fallback;
}

function getBool(key, fallback = false) {
  const v = get(key);
  if (v === undefined || v === null) return fallback;
  return String(v).toLowerCase() === 'true' || v === '1';
}

function set(key, value) {
  upsert.run(key, String(value));
}

const setMany = db.transaction((entries) => {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue;
    upsert.run(key, String(value));
  }
});

module.exports = { all, get, getNumber, getBool, set, setMany };
