'use strict';

const { db } = require('../db');

const stmts = {
  get: db.prepare('SELECT * FROM source_state WHERE source = ?'),
  all: db.prepare('SELECT * FROM source_state ORDER BY source'),
  ensure: db.prepare('INSERT OR IGNORE INTO source_state (source) VALUES (?)'),
  start: db.prepare(
    `UPDATE source_state
        SET running = 1, last_run_at = datetime('now')
      WHERE source = ?`
  ),
  finish: db.prepare(
    `UPDATE source_state
        SET running = 0,
            last_status = @status,
            last_error = @error,
            last_fetched = @fetched,
            last_added = @added,
            total_added = total_added + @added
      WHERE source = @source`
  ),
  backoff: db.prepare(
    'UPDATE source_state SET next_allowed_at = ? WHERE source = ?'
  ),
  cursor: db.prepare('UPDATE source_state SET cursor = ? WHERE source = ?'),
  logStart: db.prepare(
    `INSERT INTO poll_log (source, started_at, status)
     VALUES (?, datetime('now'), 'running')`
  ),
  logFinish: db.prepare(
    `UPDATE poll_log
        SET ended_at = datetime('now'), status = @status,
            fetched = @fetched, added = @added, message = @message
      WHERE id = @id`
  ),
  recentLogs: db.prepare(
    'SELECT * FROM poll_log ORDER BY id DESC LIMIT ?'
  ),
  trimLogs: db.prepare(
    'DELETE FROM poll_log WHERE id NOT IN (SELECT id FROM poll_log ORDER BY id DESC LIMIT 200)'
  ),
};

function get(source) {
  stmts.ensure.run(source);
  return stmts.get.get(source);
}

function all() {
  return stmts.all.all();
}

function startRun(source) {
  stmts.ensure.run(source);
  stmts.start.run(source);
  return stmts.logStart.run(source).lastInsertRowid;
}

function finishRun(logId, source, { status, error, fetched = 0, added = 0 }) {
  stmts.finish.run({
    source,
    status,
    error: error || null,
    fetched,
    added,
  });
  stmts.logFinish.run({
    id: logId,
    status,
    fetched,
    added,
    message: error || null,
  });
  stmts.trimLogs.run();
}

/** Push the next allowed poll time out, e.g. after a 429. */
function backOff(source, seconds) {
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  stmts.backoff.run(until, source);
  return until;
}

function canRun(source) {
  const row = get(source);
  if (!row) return true;
  if (row.running) return false;
  if (row.next_allowed_at && new Date(row.next_allowed_at) > new Date()) {
    return false;
  }
  return true;
}

function setCursor(source, value) {
  stmts.cursor.run(value === null || value === undefined ? null : String(value), source);
}

function getCursor(source) {
  const row = get(source);
  return row ? row.cursor : null;
}

function recentLogs(limit = 25) {
  return stmts.recentLogs.all(Math.min(Math.max(Number(limit) || 25, 1), 200));
}

/** Clears a stale running flag left behind by a crash or restart. */
function resetRunning() {
  db.prepare('UPDATE source_state SET running = 0').run();
  db.prepare(
    `UPDATE poll_log SET status = 'interrupted', ended_at = datetime('now')
      WHERE status = 'running'`
  ).run();
}

module.exports = {
  get,
  all,
  startRun,
  finishRun,
  backOff,
  canRun,
  setCursor,
  getCursor,
  recentLogs,
  resetRunning,
};
