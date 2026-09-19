'use strict';

const config = require('../config');
const { fetchJson, sleep } = require('../lib/http');
const settings = require('../lib/settings');

/**
 * Politeness layer in front of the literature APIs.
 *
 * Each provider gets a minimum interval between requests, enforced across
 * concurrent research runs by a per-provider promise chain, plus a
 * User-Agent carrying a contact address (Crossref, OpenAlex and NCBI all ask
 * for one and give better limits in return).
 */
const lastCallAt = new Map();
const queues = new Map();

function contactEmail() {
  return String(settings.get('research.contact_email') || '').trim();
}

function userAgent() {
  const email = contactEmail();
  return email ? `${config.userAgent} (mailto:${email})` : config.userAgent;
}

function schedule(providerId, minIntervalMs, task) {
  const previous = queues.get(providerId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const last = lastCallAt.get(providerId) || 0;
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt.set(providerId, Date.now());
      return task();
    });
  // Keep the chain alive but never let a rejection poison the next caller.
  queues.set(providerId, next.catch(() => {}));
  return next;
}

/** Rate-limited JSON GET for a provider. */
function get(providerId, url, options = {}) {
  const { minIntervalMs = 300, headers = {}, timeoutMs = 20000, retries = 1 } = options;
  return schedule(providerId, minIntervalMs, () =>
    fetchJson(url, {
      headers: { 'User-Agent': userAgent(), ...headers },
      timeoutMs,
      retries,
    })
  );
}

/** Rate-limited plain-text GET, for the E-utilities XML endpoints. */
function getText(providerId, url, options = {}) {
  const { minIntervalMs = 300, headers = {}, timeoutMs = 20000 } = options;
  return schedule(providerId, minIntervalMs, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': userAgent(), ...headers },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
        err.status = res.status;
        throw err;
      }
      return res.text();
    } finally {
      clearTimeout(timer);
    }
  });
}

function stripMarkup(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function resetForTests() {
  lastCallAt.clear();
  queues.clear();
}

module.exports = { get, getText, contactEmail, userAgent, stripMarkup, resetForTests };
