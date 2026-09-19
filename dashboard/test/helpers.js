'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Point the app at a throwaway database before anything requires db.js. */
function useTempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ard-${name}-`));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.POLLING_ENABLED = 'false';
  return dir;
}

/** Replace global fetch with a router keyed by substring of the URL. */
function mockFetch(routes) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const href = String(url);
    calls.push(href);
    // Requests to the test's own HTTP server always pass through, so a route
    // table for upstream APIs does not swallow the calls under test.
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(href)) {
      return original(url, options);
    }
    const key = Object.keys(routes).find((k) => href.includes(k));
    if (!key) {
      return new Response('{"error":"unexpected url"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const route = routes[key];
    const result = typeof route === 'function' ? await route(href, options) : route;
    if (result instanceof Response) return result;
    return new Response(
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      {
        status: result.status || 200,
        headers: result.headers || { 'content-type': 'application/json' },
      }
    );
  };
  return {
    calls,
    restore() {
      global.fetch = original;
    },
  };
}

module.exports = { useTempDb, mockFetch };
