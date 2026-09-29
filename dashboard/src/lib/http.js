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
 * Small fetch wrapper: timeout, a couple of retries for transient network or
 * 5xx failures, and structured errors so callers can back a source off
 * without taking the other polls down with it.
 *
 * Returns the raw body as well as the parsed JSON, so a caller expecting XML
 * or plain text shares the same retry and error handling.
 */
async function fetchRaw(url, options = {}) {
  const {
    headers = {},
    timeoutMs = 20000,
    retries = 2,
    retryDelayMs = 1000,
    method = 'GET',
    body,
    accept = 'application/json',
    parseJson = true,
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
          Accept: accept,
          ...headers,
        },
      });

      const text = await res.text();
      let parsed = null;
      if (text && parseJson) {
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
        if (parseJson && parsed === null && text) {
          throw new HttpError('Response was not valid JSON', {
            status: res.status,
            body: text.slice(0, 200),
          });
        }
        return { data: parsed, text, headers: res.headers, status: res.status };
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

const fetchJson = (url, options = {}) => fetchRaw(url, options);

/** Same wrapper for an endpoint that answers with XML or plain text. */
const fetchText = (url, options = {}) =>
  fetchRaw(url, { accept: 'text/xml, application/xml, text/plain', ...options, parseJson: false });

module.exports = {
  fetchJson,
  fetchText,
  fetchRaw,
  HttpError,
  sleep,
  looksLikeHtml,
  describeFailure,
};
