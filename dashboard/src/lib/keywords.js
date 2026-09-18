'use strict';

const { db, SOURCES } = require('../db');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

function normalizeTerm(raw) {
  if (typeof raw !== 'string') throw new ValidationError('Keyword is required');
  // Collapse internal whitespace so "limb   loss" and "limb loss" are the same.
  const term = raw.trim().replace(/\s+/g, ' ');
  if (!term) throw new ValidationError('Keyword cannot be empty');
  if (term.length > 120) {
    throw new ValidationError('Keyword must be 120 characters or fewer');
  }
  return term;
}

function normalizeSources(rawSources, scope) {
  if (scope === 'all') return [];
  const list = Array.isArray(rawSources) ? rawSources : [];
  const cleaned = [...new Set(list.map((s) => String(s).trim().toLowerCase()))];
  const bad = cleaned.filter((s) => !SOURCES.includes(s));
  if (bad.length) {
    throw new ValidationError(`Unknown source(s): ${bad.join(', ')}`);
  }
  if (!cleaned.length) {
    throw new ValidationError(
      'Pick at least one source, or set the keyword to apply to all sources'
    );
  }
  return cleaned;
}

function normalizeScope(raw) {
  const scope = String(raw || 'all').trim().toLowerCase();
  if (scope !== 'all' && scope !== 'specific') {
    throw new ValidationError("Scope must be 'all' or 'specific'");
  }
  return scope;
}

const stmts = {
  insert: db.prepare(
    `INSERT INTO keywords (term, term_lower, scope, enabled, notes)
     VALUES (@term, @term_lower, @scope, @enabled, @notes)`
  ),
  update: db.prepare(
    `UPDATE keywords
        SET term = @term, term_lower = @term_lower, scope = @scope,
            enabled = @enabled, notes = @notes, updated_at = datetime('now')
      WHERE id = @id`
  ),
  delete: db.prepare('DELETE FROM keywords WHERE id = ?'),
  byId: db.prepare('SELECT * FROM keywords WHERE id = ?'),
  byTerm: db.prepare('SELECT * FROM keywords WHERE term_lower = ?'),
  list: db.prepare('SELECT * FROM keywords ORDER BY term COLLATE NOCASE'),
  clearSources: db.prepare('DELETE FROM keyword_sources WHERE keyword_id = ?'),
  addSource: db.prepare(
    'INSERT OR IGNORE INTO keyword_sources (keyword_id, source) VALUES (?, ?)'
  ),
  sourcesFor: db.prepare(
    'SELECT source FROM keyword_sources WHERE keyword_id = ? ORDER BY source'
  ),
  allSources: db.prepare('SELECT keyword_id, source FROM keyword_sources'),
};

function hydrate(row, sourcesByKeyword) {
  if (!row) return null;
  const sources =
    row.scope === 'all'
      ? [...SOURCES]
      : sourcesByKeyword
        ? sourcesByKeyword.get(row.id) || []
        : stmts.sourcesFor.all(row.id).map((r) => r.source);
  return {
    id: row.id,
    term: row.term,
    term_lower: row.term_lower,
    scope: row.scope,
    sources,
    enabled: !!row.enabled,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function list() {
  const map = new Map();
  for (const row of stmts.allSources.all()) {
    if (!map.has(row.keyword_id)) map.set(row.keyword_id, []);
    map.get(row.keyword_id).push(row.source);
  }
  return stmts.list.all().map((row) => hydrate(row, map));
}

function get(id) {
  return hydrate(stmts.byId.get(id));
}

/**
 * Keywords a given source should search with, read fresh from the DB on every
 * poll. Poll jobs must call this rather than closing over a cached list.
 */
function forSource(source) {
  return list().filter(
    (k) => k.enabled && (k.scope === 'all' || k.sources.includes(source))
  );
}

const create = db.transaction((input) => {
  const term = normalizeTerm(input.term);
  const scope = normalizeScope(input.scope);
  const sources = normalizeSources(input.sources, scope);
  const term_lower = term.toLowerCase();

  if (stmts.byTerm.get(term_lower)) {
    throw new ConflictError(`Keyword "${term}" already exists`);
  }

  const info = stmts.insert.run({
    term,
    term_lower,
    scope,
    enabled: input.enabled === false ? 0 : 1,
    notes: input.notes ? String(input.notes).trim() : null,
  });
  for (const source of sources) stmts.addSource.run(info.lastInsertRowid, source);
  return get(info.lastInsertRowid);
});

const update = db.transaction((id, input) => {
  const existing = stmts.byId.get(id);
  if (!existing) return null;

  const term = normalizeTerm(
    input.term === undefined ? existing.term : input.term
  );
  const scope = normalizeScope(
    input.scope === undefined ? existing.scope : input.scope
  );
  const sources = normalizeSources(
    input.sources === undefined
      ? stmts.sourcesFor.all(id).map((r) => r.source)
      : input.sources,
    scope
  );
  const term_lower = term.toLowerCase();

  const clash = stmts.byTerm.get(term_lower);
  if (clash && clash.id !== id) {
    throw new ConflictError(`Keyword "${term}" already exists`);
  }

  stmts.update.run({
    id,
    term,
    term_lower,
    scope,
    enabled:
      input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
    notes:
      input.notes === undefined
        ? existing.notes
        : input.notes
          ? String(input.notes).trim()
          : null,
  });
  stmts.clearSources.run(id);
  for (const source of sources) stmts.addSource.run(id, source);
  return get(id);
});

function remove(id) {
  return stmts.delete.run(id).changes > 0;
}

module.exports = {
  list,
  get,
  forSource,
  create,
  update,
  remove,
  normalizeTerm,
  ValidationError,
  ConflictError,
};
