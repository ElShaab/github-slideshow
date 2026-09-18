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
  month: db.prepare(
    `SELECT COALESCE(SUM(units), 0) AS units, COALESCE(SUM(calls), 0) AS calls
       FROM api_usage
      WHERE source = ? AND day LIKE ?`
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

/** Calendar month of the quota day, e.g. "2026-09". */
function pacificMonth(date = new Date()) {
  return pacificDay(date).slice(0, 7);
}

/** Units used this calendar month, for providers that meter monthly. */
function monthUsed(source, month = pacificMonth()) {
  return stmts.month.get(source, `${month}%`).units;
}

function monthCalls(source, month = pacificMonth()) {
  return stmts.month.get(source, `${month}%`).calls;
}

function monthRemaining(source, monthlyQuota, reserve = 0, month = pacificMonth()) {
  return Math.max(0, monthlyQuota - reserve - monthUsed(source, month));
}

function history(source, limit = 7) {
  return stmts.recent.all(source, limit);
}

module.exports = {
  record,
  used,
  calls,
  remaining,
  history,
  pacificDay,
  pacificMonth,
  monthUsed,
  monthCalls,
  monthRemaining,
};
