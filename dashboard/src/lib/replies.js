'use strict';

const { db } = require('../db');

const stmts = {
  insert: db.prepare(
    `INSERT INTO replies (item_id, draft_id, provider, target_id, content, status, remote_id, url, error)
     VALUES (@item_id, @draft_id, @provider, @target_id, @content, @status, @remote_id, @url, @error)`
  ),
  byId: db.prepare('SELECT * FROM replies WHERE id = ?'),
  forItem: db.prepare('SELECT * FROM replies WHERE item_id = ? ORDER BY id DESC'),
  recent: db.prepare('SELECT * FROM replies ORDER BY id DESC LIMIT ?'),
  postedForItem: db.prepare(
    "SELECT * FROM replies WHERE item_id = ? AND status = 'posted' ORDER BY id DESC"
  ),
  counts: db.prepare('SELECT status, COUNT(*) AS n FROM replies GROUP BY status'),
};

function record(entry) {
  const info = stmts.insert.run({
    item_id: entry.item_id,
    draft_id: entry.draft_id || null,
    provider: entry.provider,
    target_id: entry.target_id,
    content: entry.content,
    status: entry.status,
    remote_id: entry.remote_id || null,
    url: entry.url || null,
    error: entry.error ? String(entry.error).slice(0, 1000) : null,
  });
  return stmts.byId.get(info.lastInsertRowid);
}

function forItem(itemId) {
  return stmts.forItem.all(itemId);
}

/** Successful sends only - used to warn before replying twice to one thread. */
function postedForItem(itemId) {
  return stmts.postedForItem.all(itemId);
}

function recent(limit = 25) {
  return stmts.recent.all(Math.min(Math.max(Number(limit) || 25, 1), 200));
}

function summary() {
  const counts = { posted: 0, failed: 0 };
  for (const row of stmts.counts.all()) counts[row.status] = row.n;
  return counts;
}

module.exports = { record, forItem, postedForItem, recent, summary };
