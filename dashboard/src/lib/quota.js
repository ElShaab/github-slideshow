'use strict';

const { db } = require('../db');

const stmts = {
  add: db.prepare(
    `INSERT INTO api_usage (day, source, units, calls) VALUES (@day, @source, @units, 1)
     ON CONFLICT (day, source) DO UPDATE
       SET units = units + excluded.units, calls = calls + 1`
  ),
  get: db.prepare('SELECT * FROM api_usage WHERE day = ? AND source = ?'),
  recent: db.prepare(
    'SELECT * FROM api_usage WHERE source = ? ORDER BY day DESC LIMIT ?'
  ),
};

/**
 * YouTube's quota resets at midnight Pacific Time, so usage is bucketed by the
 * Pacific date rather than UTC.
 */
function pacificDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function record(source, units, day = pacificDay()) {
  stmts.add.run({ day, source, units });
  return used(source, day);
}

function used(source, day = pacificDay()) {
  const row = stmts.get.get(day, source);
  return row ? row.units : 0;
}

function calls(source, day = pacificDay()) {
  const row = stmts.get.get(day, source);
  return row ? row.calls : 0;
}

function remaining(source, dailyQuota, reserve = 0, day = pacificDay()) {
  return Math.max(0, dailyQuota - reserve - used(source, day));
}

function history(source, limit = 7) {
  return stmts.recent.all(source, limit);
}

module.exports = { record, used, calls, remaining, history, pacificDay };
