'use strict';

const config = require('../config');
const { fetchJson } = require('../lib/http');

const SCOPES = ['identity', 'submit', 'edit', 'read'];

function basicAuth() {
  return Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString('base64');
}

async function token(form) {
  const { data } = await fetchJson('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    retries: 1,
  });
  if (!data || !data.access_token) {
    throw new Error(
      `Reddit did not return an access token${data && data.error ? `: ${data.error}` : ''}`
    );
  }
  return data;
}

module.exports = {
  id: 'reddit',
  label: 'Reddit',
  scopes: SCOPES,
  usesPkce: false,
  // Reddit issues a refresh token only when duration=permanent is requested.
  registration:
    'reddit.com/prefs/apps → create app → type "web app" → set the redirect URI below',

  isRegistered: () => !!(config.reddit.clientId && config.reddit.clientSecret),

  authorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: config.reddit.clientId,
      response_type: 'code',
      state,
      redirect_uri: redirectUri,
      duration: 'permanent',
      scope: SCOPES.join(' '),
    });
    return `https://www.reddit.com/api/v1/authorize?${params}`;
  },

  exchangeCode({ code, redirectUri }) {
    return token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  },

  refresh(refreshToken) {
    return token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  },

  async identity(accessToken) {
    const { data } = await fetchJson('https://oauth.reddit.com/api/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { id: data.id, name: `u/${data.name}` };
  },

  /** Reddit fullnames are what the feed already stores: t3_ posts, t1_ comments. */
  canReplyTo(item) {
    return item.source === 'reddit' && /^t[13]_/.test(item.external_id || '');
  },

  describeTarget(item) {
    const kind = item.external_id.startsWith('t3_') ? 'post' : 'comment';
    return `a ${kind} in ${item.origin || 'Reddit'}`;
  },

  async postReply({ accessToken, item, text }) {
    const { data } = await fetchJson('https://oauth.reddit.com/api/comment', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        api_type: 'json',
        thing_id: item.external_id,
        text,
      }).toString(),
      retries: 0,
    });

    const errors = data && data.json && data.json.errors;
    if (errors && errors.length) {
      // Reddit answers 200 with an errors array for rule violations,
      // rate limits and removed threads.
      throw new Error(errors.map((e) => e.join(': ')).join('; '));
    }
    const thing =
      data && data.json && data.json.data && data.json.data.things
        ? data.json.data.things[0]
        : null;
    if (!thing) throw new Error('Reddit accepted the request but returned no comment');

    return {
      remote_id: thing.data.name || thing.data.id,
      url: thing.data.permalink
        ? `https://www.reddit.com${thing.data.permalink}`
        : item.url || null,
    };
  },
};
