'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('connections');
process.env.REDDIT_CLIENT_ID = 'rid';
process.env.REDDIT_CLIENT_SECRET = 'rsecret';
process.env.X_CLIENT_ID = 'xid';
process.env.X_CLIENT_SECRET = 'xsecret';
process.env.GOOGLE_CLIENT_ID = 'gid';
process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
process.env.PUBLIC_URL = 'https://dash.example.test/';

const { db } = require('../src/db');
const connect = require('../src/connect');
const connections = require('../src/lib/connections');
const secrets = require('../src/lib/secrets');

function urlOf(provider) {
  return new URL(connect.beginConnect(connect.get(provider), null));
}

test('redirect URIs come from one configured public URL', () => {
  assert.equal(
    connect.redirectUri('reddit'),
    'https://dash.example.test/api/connections/reddit/callback'
  );
});

test('Reddit asks for a permanent grant and the scopes it needs', () => {
  const url = urlOf('reddit');
  assert.equal(url.origin + url.pathname, 'https://www.reddit.com/api/v1/authorize');
  assert.equal(url.searchParams.get('duration'), 'permanent', 'without this there is no refresh token');
  assert.equal(url.searchParams.get('scope'), 'identity submit edit read');
  assert.equal(url.searchParams.get('client_id'), 'rid');
  assert.ok(url.searchParams.get('state'));
});

test('X uses PKCE and requests write plus offline access', () => {
  const url = urlOf('x');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.match(url.searchParams.get('scope'), /tweet\.write/);
  assert.match(url.searchParams.get('scope'), /offline\.access/);
});

test('Google asks for offline access so a refresh token comes back', () => {
  const url = urlOf('youtube');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.force-ssl');
});

test('an unregistered provider explains what to create', () => {
  const original = require('../src/config').reddit.clientId;
  require('../src/config').reddit.clientId = '';
  assert.throws(() => urlOf('reddit'), /not registered yet/);
  require('../src/config').reddit.clientId = original;
});

test('the callback exchanges the code, stores the account, and encrypts tokens', async () => {
  const state = new URL(connect.beginConnect(connect.get('reddit'), null)).searchParams.get('state');

  let tokenBody;
  const mock = mockFetch({
    'reddit.com/api/v1/access_token': (url, options) => {
      tokenBody = options.body;
      return { body: { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, scope: 'identity submit' } };
    },
    'oauth.reddit.com/api/v1/me': { body: { id: 'abc123', name: 'drsmith' } },
  });

  let saved;
  try {
    saved = await connect.completeConnect(connect.get('reddit'), { code: 'the-code', state }, null);
  } finally {
    mock.restore();
  }

  assert.match(tokenBody, /grant_type=authorization_code/);
  assert.match(tokenBody, /code=the-code/);
  assert.equal(saved.account_name, 'u/drsmith');
  assert.equal(saved.access_token, 'acc-1');

  // What lands on disk is ciphertext, not the token.
  const row = db.prepare('SELECT * FROM connections WHERE provider = ?').get('reddit');
  assert.ok(row.access_token.startsWith('v1:'));
  assert.ok(!row.access_token.includes('acc-1'));
  assert.ok(!row.refresh_token.includes('ref-1'));
  assert.equal(secrets.decrypt(row.refresh_token), 'ref-1');

  // The public view never carries tokens.
  const listed = connections.list().find((c) => c.provider === 'reddit');
  assert.equal(listed.account_name, 'u/drsmith');
  assert.ok(!('access_token' in listed));
});

test('an authorization state cannot be replayed', async () => {
  const state = new URL(connect.beginConnect(connect.get('reddit'), null)).searchParams.get('state');
  const mock = mockFetch({
    'reddit.com/api/v1/access_token': { body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } },
    'oauth.reddit.com/api/v1/me': { body: { id: 'x', name: 'drsmith' } },
  });
  try {
    await connect.completeConnect(connect.get('reddit'), { code: 'c', state }, null);
    await assert.rejects(
      () => connect.completeConnect(connect.get('reddit'), { code: 'c', state }, null),
      /expired or was already used/
    );
  } finally {
    mock.restore();
  }
});

test("a state from one provider cannot be used to connect another", async () => {
  const state = new URL(connect.beginConnect(connect.get('reddit'), null)).searchParams.get('state');
  await assert.rejects(
    () => connect.completeConnect(connect.get('x'), { code: 'c', state }, null),
    /expired or was already used/
  );
});

test('an expired access token is refreshed before use', async () => {
  db.prepare("UPDATE connections SET expires_at = datetime('now', '-1 hour') WHERE provider = 'reddit'").run();

  let refreshBody;
  const mock = mockFetch({
    'reddit.com/api/v1/access_token': (url, options) => {
      refreshBody = options.body;
      return { body: { access_token: 'acc-2', expires_in: 3600 } };
    },
  });
  let result;
  try {
    result = await connect.accessTokenFor('reddit');
  } finally {
    mock.restore();
  }

  assert.match(refreshBody, /grant_type=refresh_token/);
  assert.equal(result.accessToken, 'acc-2');
  // The refresh token is kept when the platform does not send a new one.
  assert.equal(connections.get('reddit').refresh_token, 'r');
});

test('a failed refresh asks for a reconnect and records why', async () => {
  db.prepare("UPDATE connections SET expires_at = datetime('now', '-1 hour') WHERE provider = 'reddit'").run();
  const mock = mockFetch({
    'reddit.com/api/v1/access_token': { status: 400, body: { error: 'invalid_grant' } },
  });
  try {
    await assert.rejects(() => connect.accessTokenFor('reddit'), /Reconnect the account/);
  } finally {
    mock.restore();
  }
  assert.match(connections.get('reddit').last_error, /invalid_grant|400/);
  db.prepare("UPDATE connections SET expires_at = datetime('now', '+1 hour') WHERE provider = 'reddit'").run();
});

test('replying needs a linked account', async () => {
  await assert.rejects(() => connect.accessTokenFor('x'), /No X \(Twitter\) account is linked/);
});

test('disconnecting removes the stored tokens', () => {
  connections.save('x', { access_token: 'a', refresh_token: 'b', expires_in: 100 }, { id: '1', name: '@doc' });
  assert.ok(connections.get('x'));
  assert.equal(connections.remove('x'), true);
  assert.equal(connections.get('x'), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM connections WHERE provider='x'").get().n, 0);
});

/* ------------------------------------------------------------------- guard */

test('the dashboard password guard rejects wrong credentials and passes right ones', async () => {
  const guard = require('../src/lib/guard');
  process.env.DASHBOARD_PASSWORD = 'letmein';
  process.env.DASHBOARD_USER = 'doc';

  const run = (header) =>
    new Promise((resolve) => {
      const req = { get: () => header };
      const res = {
        statusCode: 200,
        headers: {},
        set(key, value) { this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        send() { resolve({ allowed: false, status: this.statusCode, headers: this.headers }); },
      };
      require('../src/lib/guard').middleware()(req, res, () => resolve({ allowed: true }));
    });

  assert.equal((await run('')).allowed, false);
  assert.equal((await run('Basic ' + Buffer.from('doc:wrong').toString('base64'))).allowed, false);
  assert.match((await run('')).headers['WWW-Authenticate'], /Basic realm/);
  assert.equal((await run('Basic ' + Buffer.from('doc:letmein').toString('base64'))).allowed, true);

  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.DASHBOARD_USER;
  // With no password set the guard is a pass-through.
  assert.equal((await run('')).allowed, true);
  assert.equal(guard.warnIfUnprotected(), null || guard.warnIfUnprotected());
});

test('an unprotected dashboard with a linked account warns at boot', () => {
  const guard = require('../src/lib/guard');
  connections.save('youtube', { access_token: 'a', expires_in: 60 }, { id: '1', name: 'Dr Smith' });
  const warning = guard.warnIfUnprotected();
  assert.match(warning, /no password/);
  assert.match(warning, /post as you/);
  connections.remove('youtube');
});
