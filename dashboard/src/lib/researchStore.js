'use strict';

const { db } = require('../db');

const stmts = {
  get: db.prepare('SELECT * FROM research_matches WHERE item_id = ?'),
  upsert: db.prepare(
    `INSERT INTO research_matches
       (item_id, query_terms, results, providers, no_strong_matches, note, considered, created_at)
     VALUES (@item_id, @query_terms, @results, @providers, @no_strong_matches, @note, @considered, datetime('now'))
     ON CONFLICT (item_id) DO UPDATE SET
       query_terms = excluded.query_terms,
       results = excluded.results,
       providers = excluded.providers,
       no_strong_matches = excluded.no_strong_matches,
       note = excluded.note,
       considered = excluded.considered,
       created_at = excluded.created_at`
  ),
  remove: db.prepare('DELETE FROM research_matches WHERE item_id = ?'),
  ages: db.prepare(
    `SELECT item_id, created_at, no_strong_matches,
            json_array_length(results) AS result_count
       FROM research_matches`
  ),
};

function hydrate(row) {
  if (!row) return null;
  return {
    item_id: row.item_id,
    terms: JSON.parse(row.query_terms),
    results: JSON.parse(row.results),
    providers: JSON.parse(row.providers),
    no_strong_matches: !!row.no_strong_matches,
    note: row.note,
    considered: row.considered,
    created_at: row.created_at,
  };
}

function get(itemId) {
  return hydrate(stmts.get.get(itemId));
}

/** Cached results older than maxAgeHours are treated as absent. */
function getFresh(itemId, maxAgeHours) {
  const cached = get(itemId);
  if (!cached) return null;
  if (!maxAgeHours || maxAgeHours <= 0) return cached;
  const created = new Date(`${cached.created_at.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(created)) return cached;
  return Date.now() - created <= maxAgeHours * 3600 * 1000 ? cached : null;
}

function save(itemId, match) {
  stmts.upsert.run({
    item_id: itemId,
    query_terms: JSON.stringify(match.terms || []),
    results: JSON.stringify(match.results || []),
    providers: JSON.stringify(match.providers || []),
    no_strong_matches: match.no_strong_matches ? 1 : 0,
    note: match.note || null,
    considered: match.considered || 0,
  });
  return get(itemId);
}

function remove(itemId) {
  return stmts.remove.run(itemId).changes > 0;
}

function summary() {
  const rows = stmts.ages.all();
  return {
    matched_items: rows.length,
    with_results: rows.filter((r) => r.result_count > 0).length,
    no_strong_matches: rows.filter((r) => r.no_strong_matches).length,
  };
}

module.exports = { get, getFresh, save, remove, summary };
