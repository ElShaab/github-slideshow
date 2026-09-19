'use strict';

const { db } = require('../db');

const STATUSES = ['draft', 'edited', 'used'];

const stmts = {
  insert: db.prepare(
    `INSERT INTO drafts (item_id, content, status, model, usage, citations)
     VALUES (@item_id, @content, @status, @model, @usage, @citations)`
  ),
  byId: db.prepare('SELECT * FROM drafts WHERE id = ?'),
  forItem: db.prepare('SELECT * FROM drafts WHERE item_id = ? ORDER BY id DESC'),
  latest: db.prepare('SELECT * FROM drafts WHERE item_id = ? ORDER BY id DESC LIMIT 1'),
  updateContent: db.prepare(
    `UPDATE drafts
        SET content = @content, status = @status, updated_at = datetime('now')
      WHERE id = @id`
  ),
  updateStatus: db.prepare(
    "UPDATE drafts SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  remove: db.prepare('DELETE FROM drafts WHERE id = ?'),
  counts: db.prepare('SELECT status, COUNT(*) AS n FROM drafts GROUP BY status'),
};

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    item_id: row.item_id,
    content: row.content,
    status: row.status,
    model: row.model,
    usage: row.usage ? JSON.parse(row.usage) : null,
    citations: row.citations ? JSON.parse(row.citations) : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function create({ item_id, content, model, usage, citations }) {
  const info = stmts.insert.run({
    item_id,
    content,
    status: 'draft',
    model: model || null,
    usage: usage ? JSON.stringify(usage) : null,
    citations: citations ? JSON.stringify(citations) : null,
  });
  return hydrate(stmts.byId.get(info.lastInsertRowid));
}

function get(id) {
  return hydrate(stmts.byId.get(id));
}

function forItem(itemId) {
  return stmts.forItem.all(itemId).map(hydrate);
}

function latest(itemId) {
  return hydrate(stmts.latest.get(itemId));
}

/** Saving edited text moves a generated draft to "edited" unless told otherwise. */
function update(id, { content, status }) {
  const existing = stmts.byId.get(id);
  if (!existing) return null;
  const nextStatus = status || (existing.status === 'draft' ? 'edited' : existing.status);
  if (!STATUSES.includes(nextStatus)) {
    const err = new Error(`Status must be one of: ${STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  stmts.updateContent.run({
    id,
    content: content === undefined ? existing.content : String(content),
    status: nextStatus,
  });
  return get(id);
}

function setStatus(id, status) {
  if (!STATUSES.includes(status)) {
    const err = new Error(`Status must be one of: ${STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (!stmts.updateStatus.run(status, id).changes) return null;
  return get(id);
}

function remove(id) {
  return stmts.remove.run(id).changes > 0;
}

function summary() {
  const counts = { draft: 0, edited: 0, used: 0 };
  for (const row of stmts.counts.all()) counts[row.status] = row.n;
  return counts;
}

module.exports = { create, get, forItem, latest, update, setStatus, remove, summary, STATUSES };
