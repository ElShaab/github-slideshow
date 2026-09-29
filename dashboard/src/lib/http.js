'use strict';

const config = require('../config');

class HttpError extends Error {
  constructor(message, { status, retryAfter, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

function parseRetryAfter(headers) {
  const raw = headers.get('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return seconds;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return Math.max(0, Math.round((date.getTime() - Date.now()) / 1000));
    }
  }
  // X API v2 uses an epoch-seconds reset header.
  const reset = headers.get('x-rate-limit-reset');
  if (reset && Number.isFinite(Number(reset))) {
    return Math.max(0, Math.round(Number(reset) - Date.now() / 1000));
  }
  return null;
}

function looksLikeHtml(text) {
  return /^\s*(<!doctype html|<html|<body|<head|<\?xml[^>]*>\s*<!doctype html)/i.test(
    String(text || '')
  );
}

/**
 * A readable one-line reason. An API's own JSON error is worth quoting; a page
 * of markup is not - a block or login page dumped into the log buries the
 * actual problem under a stylesheet.
 */
function describeFailure(parsed, text) {
  if (parsed && parsed.error) return `: ${JSON.stringify(parsed.error).slice(0, 200)}`;
  if (parsed && parsed.detail) return `: ${String(parsed.detail).slice(0, 200)}`;
  if (parsed && parsed.message) return `: ${String(parsed.message).slice(0, 200)}`;
  if (looksLikeHtml(text)) {
    return ': the server returned a web page instead of JSON (a block, login or error page)';
  }
  if (text) return `: ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}`;
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Small JSON fetch wrapper: timeout, a couple of retries for transient network
 * or 5xx failures, and structured errors so callers can back a source off
 * without taking the other polls down with it.
 */
async function fetchJson(url, options = {}) {
  const {
    headers = {},
    timeoutMs = 20000,
    retries = 2,
    retryDelayMs = 1000,
    method = 'GET',
    body,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        headers: {
          'User-Agent': config.userAgent,
          Accept: 'application/json',
          ...headers,
        },
      });

      const text = await res.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!res.ok) {
        const retryAfter = parseRetryAfter(res.headers);
        const err = new HttpError(
          `HTTP ${res.status} from ${new URL(url).host}${describeFailure(parsed, text)}`,
          { status: res.status, retryAfter, body: parsed, html: looksLikeHtml(text) }
        );
        // 4xx other than 429 will not get better by retrying.
        if (res.status < 500 && res.status !== 429) throw err;
        lastError = err;
        if (res.status === 429) throw err;
      } else {
        if (parsed === null && text) {
          throw new HttpError('Response was not valid JSON', {
            status: res.status,
            body: text.slice(0, 200),
          });
        }
        return { data: parsed, headers: res.headers, status: res.status };
      }
    } catch (err) {
      if (err instanceof HttpError && (err.status === 429 || (err.status < 500 && err.status >= 400))) {
        throw err;
      }
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
  }

  throw lastError || new HttpError('Request failed');
}

module.exports = { fetchJson, HttpError, sleep, looksLikeHtml, describeFailure };
