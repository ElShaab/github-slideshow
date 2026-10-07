'use strict';

const { db } = require('../db');
const missed = require('./missed');

const stmts = {
  seen: db.prepare(
    'SELECT 1 FROM seen_items WHERE source = ? AND external_id = ?'
  ),
  markSeen: db.prepare(
    'INSERT OR IGNORE INTO seen_items (source, external_id) VALUES (?, ?)'
  ),
  insertItem: db.prepare(
    `INSERT INTO items
       (source, external_id, author, text, url, timestamp, keyword_matched, kind, origin, meta)
     VALUES
       (@source, @external_id, @author, @text, @url, @timestamp, @keyword_matched, @kind, @origin, @meta)
     ON CONFLICT (source, external_id) DO NOTHING`
  ),
  insertItemKeyword: db.prepare(
    `INSERT OR IGNORE INTO item_keywords (item_id, term_lower, term)
     VALUES (?, ?, ?)`
  ),
};

/** Accepts Date | ISO string | epoch seconds | epoch ms; returns ISO UTC. */
function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Reddit and YouTube hand back epoch seconds; anything past ~1e12 is ms.
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function clean(text) {
  if (!text) return '';
  return String(text).replace(/​/g, '').trim();
}

/**
 * Normalize, keyword-match and store a batch of source candidates.
 *
 * A candidate looks like:
 *   { external_id, author, text, url, timestamp, kind, origin, meta, fallbackKeyword }
 *
 * Dedup is per source via the seen_items ledger, so re-polls never repeat an
 * item even if it was deleted from the feed.
 */
function ingest(source, candidates, matcher) {
  const stats = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const accepted = [];

  for (const candidate of candidates || []) {
    stats.fetched += 1;
    const externalId = String(candidate.external_id || '').trim();
    if (!externalId) continue;

    if (stmts.seen.get(source, externalId)) {
      stats.duplicates += 1;
      missed.forget(source, externalId);
      continue;
    }

    const text = clean(candidate.text);
    let hits = matcher ? matcher.match(text) : [];
    if (!hits.length && candidate.fallbackKeyword) {
      // The API already filtered server-side by this term (X/YouTube/PubMed
      // search); keep the item even when the match sits in a field we do not
      // store, such as a video transcript or an author bio.
      hits = [{ id: null, term: candidate.fallbackKeyword }];
    }
    if (!hits.length) {
      // Deliberately NOT marked as seen. The keyword list changes - that is
      // the whole point of the keyword bar - and an item passed over today
      // must still be catchable by a term added tomorrow. Suppressing it
      // permanently would mean every post fetched before a keyword existed
      // could never be captured, which looks exactly like a broken source.
      // It is held in the missed list instead, where a new keyword can reach
      // it at once and the physician can see what is going uncaught.
      stats.unmatched += 1;
      missed.record(source, { ...candidate, external_id: externalId });
      continue;
    }

    accepted.push({
      externalId,
      item: {
        source,
        external_id: externalId,
        author: clean(candidate.author) || null,
        text: text || '(no text)',
        url: candidate.url || null,
        timestamp: toIso(candidate.timestamp),
        keyword_matched: hits[0].term,
        kind: candidate.kind || null,
        origin: candidate.origin || null,
        meta: candidate.meta ? JSON.stringify(candidate.meta) : null,
      },
      hits,
    });
  }

  // Only what was actually kept goes in the ledger, so dismissing an item
  // still suppresses it while an unmatched one stays open to a later keyword.
  const write = db.transaction((rows) => {
    for (const row of rows) {
      stmts.markSeen.run(source, row.externalId);
      const info = stmts.insertItem.run(row.item);
      if (!info.changes) {
        stats.duplicates += 1;
        continue;
      }
      stats.added += 1;
      missed.forget(source, row.externalId);
      for (const hit of row.hits) {
        stmts.insertItemKeyword.run(
          info.lastInsertRowid,
          hit.term.toLowerCase(),
          hit.term
        );
      }
    }
  });

  write(accepted);
  return stats;
}

module.exports = { ingest, toIso };
