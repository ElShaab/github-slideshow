'use strict';

const { db } = require('../db');

const STATUSES = ['new', 'reviewed', 'used'];

const stmts = {
  setStatus: db.prepare(
    'UPDATE items SET status = ? WHERE id = ?'
  ),
  remove: db.prepare('DELETE FROM items WHERE id = ?'),
  byId: db.prepare('SELECT * FROM items WHERE id = ?'),
  keywordsFor: db.prepare(
    'SELECT term FROM item_keywords WHERE item_id = ? ORDER BY term'
  ),
  bySource: db.prepare(
    'SELECT source, status, COUNT(*) AS n FROM items GROUP BY source, status'
  ),
  distinctKeywords: db.prepare(
    `SELECT term, COUNT(*) AS n
       FROM item_keywords
      GROUP BY term_lower
      ORDER BY n DESC, term COLLATE NOCASE`
  ),
};

function hydrate(row, keywords) {
  return {
    id: row.id,
    source: row.source,
    external_id: row.external_id,
    author: row.author,
    text: row.text,
    url: row.url,
    timestamp: row.timestamp,
    keyword_matched: row.keyword_matched,
    keywords_matched: keywords || [],
    status: row.status,
    kind: row.kind,
    origin: row.origin,
    meta: row.meta ? JSON.parse(row.meta) : null,
    created_at: row.created_at,
  };
}

function query(opts = {}) {
  const where = [];
  const params = {};

  if (opts.source) {
    const sources = String(opts.source)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (sources.length) {
      where.push(
        `i.source IN (${sources.map((_, idx) => `@source${idx}`).join(', ')})`
      );
      sources.forEach((s, idx) => {
        params[`source${idx}`] = s;
      });
    }
  }
  if (opts.status) {
    const statuses = String(opts.status)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => STATUSES.includes(s));
    if (statuses.length) {
      where.push(
        `i.status IN (${statuses.map((_, idx) => `@status${idx}`).join(', ')})`
      );
      statuses.forEach((s, idx) => {
        params[`status${idx}`] = s;
      });
    }
  }
  if (opts.keyword) {
    where.push(
      `EXISTS (SELECT 1 FROM item_keywords ik
                WHERE ik.item_id = i.id AND ik.term_lower = @keyword)`
    );
    params.keyword = String(opts.keyword).trim().toLowerCase();
  }
  if (opts.q) {
    where.push('(i.text LIKE @q OR i.author LIKE @q OR i.origin LIKE @q)');
    params.q = `%${String(opts.q).trim()}%`;
  }
  if (opts.since) {
    where.push('i.timestamp >= @since');
    params.since = String(opts.since);
  }

  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM items i ${clause}`)
    .get(params).n;

  const rows = db
    .prepare(
      `SELECT i.* FROM items i ${clause}
        ORDER BY i.timestamp DESC, i.id DESC
        LIMIT ${limit} OFFSET ${offset}`
    )
    .all(params);

  const items = rows.map((row) =>
    hydrate(
      row,
      stmts.keywordsFor.all(row.id).map((r) => r.term)
    )
  );

  return { items, total, limit, offset };
}

function get(id) {
  const row = stmts.byId.get(id);
  if (!row) return null;
  return hydrate(
    row,
    stmts.keywordsFor.all(row.id).map((r) => r.term)
  );
}

function setStatus(id, status) {
  if (!STATUSES.includes(status)) {
    const err = new Error(`Status must be one of: ${STATUSES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (!stmts.setStatus.run(status, id).changes) return null;
  return get(id);
}

function remove(id) {
  return stmts.remove.run(id).changes > 0;
}

function summary() {
  const bySource = {};
  let total = 0;
  for (const row of stmts.bySource.all()) {
    bySource[row.source] = bySource[row.source] || {
      total: 0,
      new: 0,
      reviewed: 0,
      used: 0,
    };
    bySource[row.source][row.status] = row.n;
    bySource[row.source].total += row.n;
    total += row.n;
  }
  return { total, bySource, keywords: stmts.distinctKeywords.all() };
}

module.exports = { query, get, setStatus, remove, summary, STATUSES };
