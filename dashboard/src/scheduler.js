'use strict';

const settings = require('./lib/settings');
const state = require('./lib/state');
const sources = require('./sources');

const MIN_INTERVAL_MINUTES = 1;
const timers = new Map();
const nextRunAt = new Map();
const inFlight = new Map();

function log(...args) {
  console.log(`[scheduler ${new Date().toISOString()}]`, ...args);
}

function intervalMinutes(sourceId) {
  const source = sources.get(sourceId);
  // A source can impose its own floor (X's per-tier rate limits, for example).
  const floor =
    source && typeof source.minIntervalMinutes === 'function'
      ? source.minIntervalMinutes()
      : MIN_INTERVAL_MINUTES;
  return Math.max(
    settings.getNumber(`${sourceId}.interval_minutes`, 30),
    floor,
    MIN_INTERVAL_MINUTES
  );
}

function intervalMs(sourceId) {
  return intervalMinutes(sourceId) * 60 * 1000;
}

function isEnabled(sourceId) {
  return settings.getBool(`${sourceId}.enabled`, false);
}

/**
 * Run one source's poll. Never throws: failures are recorded against the
 * source so a rate-limited or broken API cannot take the other polls down.
 */
async function runSource(sourceId, { manual = false, force = false } = {}) {
  const source = sources.get(sourceId);
  if (!source) {
    return { ok: false, skipped: 'unknown-source', source: sourceId };
  }
  if (inFlight.has(sourceId)) {
    return { ok: false, skipped: 'already-running', source: sourceId };
  }
  if (!force && !manual && !isEnabled(sourceId)) {
    return { ok: false, skipped: 'disabled', source: sourceId };
  }
  if (!force && !state.canRun(sourceId)) {
    const current = state.get(sourceId);
    return {
      ok: false,
      skipped: 'backing-off',
      source: sourceId,
      next_allowed_at: current && current.next_allowed_at,
    };
  }
  if (!source.isConfigured()) {
    const message = `${source.label} is missing configuration`;
    const logId = state.startRun(sourceId);
    state.finishRun(logId, sourceId, { status: 'skipped', error: message });
    return { ok: false, skipped: 'not-configured', source: sourceId, message };
  }

  const promise = (async () => {
    const logId = state.startRun(sourceId);
    try {
      const result = (await source.poll({ manual })) || {};
      state.finishRun(logId, sourceId, {
        status: 'ok',
        fetched: result.fetched || 0,
        added: result.added || 0,
        error: result.notes || null,
      });
      log(
        `${sourceId}: fetched ${result.fetched || 0}, added ${result.added || 0}` +
          (result.notes ? ` (${result.notes})` : '')
      );
      return { ok: true, source: sourceId, ...result };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      let status = 'error';
      if (err && (err.status === 429 || err.status === 503)) {
        status = 'rate-limited';
        const seconds = Math.min(
          Math.max(Number(err.retryAfter) || 15 * 60, 60),
          6 * 60 * 60
        );
        const until = state.backOff(sourceId, seconds);
        log(`${sourceId}: rate limited, backing off until ${until}`);
      }
      state.finishRun(logId, sourceId, { status, error: message });
      log(`${sourceId}: ${status} - ${message}`);
      return { ok: false, source: sourceId, error: message, status };
    }
  })();

  inFlight.set(sourceId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(sourceId);
  }
}

function schedule(sourceId, delayMs) {
  clearTimer(sourceId);
  const delay = Math.max(delayMs, 1000);
  nextRunAt.set(sourceId, new Date(Date.now() + delay).toISOString());
  const timer = setTimeout(async () => {
    try {
      if (isEnabled(sourceId)) await runSource(sourceId);
    } catch (err) {
      // runSource swallows its own errors; this is belt and braces so a bug
      // here can never kill the process.
      log(`${sourceId}: unexpected scheduler error`, err);
    } finally {
      // Re-read the interval each cycle so settings changes take effect
      // without a restart.
      schedule(sourceId, intervalMs(sourceId));
    }
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(sourceId, timer);
}

function clearTimer(sourceId) {
  const existing = timers.get(sourceId);
  if (existing) clearTimeout(existing);
  timers.delete(sourceId);
  nextRunAt.delete(sourceId);
}

function start() {
  state.resetRunning();
  for (const source of sources.list()) {
    // Stagger the first run of each source so a restart does not fire every
    // API call at once.
    const offset = 15000 + Math.floor(Math.random() * 45000);
    schedule(source.id, offset);
  }
  log(
    `started with ${sources.list().length} sources: ` +
      sources
        .list()
        .map((s) => `${s.id}=${intervalMinutes(s.id)}m`)
        .join(', ')
  );
}

function stop() {
  for (const id of [...timers.keys()]) clearTimer(id);
}

/** Called after settings change so a new interval applies immediately. */
function reschedule(sourceId) {
  if (!sources.get(sourceId)) return;
  schedule(sourceId, intervalMs(sourceId));
}

function status() {
  return sources.list().map((source) => {
    const row = state.get(source.id) || {};
    return {
      id: source.id,
      label: source.label,
      enabled: isEnabled(source.id),
      configured: source.isConfigured(),
      credentials: (source.credentials || []).map((c) => ({
        ...c,
        present: !!process.env[c.env],
      })),
      interval_minutes: settings.getNumber(`${source.id}.interval_minutes`, 30),
      effective_interval_minutes: intervalMinutes(source.id),
      running: !!row.running || inFlight.has(source.id),
      last_run_at: row.last_run_at || null,
      last_status: row.last_status || null,
      last_error: row.last_error || null,
      last_fetched: row.last_fetched || 0,
      last_added: row.last_added || 0,
      total_added: row.total_added || 0,
      next_allowed_at: row.next_allowed_at || null,
      next_run_at: nextRunAt.get(source.id) || null,
      details: typeof source.describe === 'function' ? source.describe() : null,
    };
  });
}

module.exports = { start, stop, reschedule, runSource, status };
