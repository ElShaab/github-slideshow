'use strict';

const config = require('../config');
const { fetchJson } = require('../lib/http');

const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

function tokenHeaders() {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  // Confidential clients authenticate with Basic; public clients send the
  // client_id in the body instead.
  if (config.x.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.x.clientId}:${config.x.clientSecret}`
    ).toString('base64')}`;
  }
  return headers;
}

async function token(form) {
  const body = { ...form };
  if (!config.x.clientSecret) body.client_id = config.x.clientId;
  const { data } = await fetchJson('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: tokenHeaders(),
    body: new URLSearchParams(body).toString(),
    retries: 1,
  });
  if (!data || !data.access_token) throw new Error('X did not return an access token');
  return data;
}

module.exports = {
  id: 'x',
  label: 'X (Twitter)',
  scopes: SCOPES,
  // X requires PKCE on the authorization code flow.
  usesPkce: true,
  registration:
    'developer.x.com → your project → User authentication settings → enable OAuth 2.0, request "Read and write", set the callback URL below',

  isRegistered: () => !!config.x.clientId,

  authorizeUrl({ state, challenge, redirectUri }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.x.clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `https://x.com/i/oauth2/authorize?${params}`;
  },

  exchangeCode({ code, verifier, redirectUri }) {
    return token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  },

  refresh(refreshToken) {
    return token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  },

  async identity(accessToken) {
    const { data } = await fetchJson('https://api.x.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = (data && data.data) || {};
    return { id: user.id, name: user.username ? `@${user.username}` : user.name };
  },

  canReplyTo(item) {
    return item.source === 'x' && /^\d+$/.test(item.external_id || '');
  },

  describeTarget(item) {
    return `a reply to ${item.author || 'this post'} on X`;
  },

  async postReply({ accessToken, item, text, connection }) {
    if (text.length > 280) {
      throw new Error(
        `X posts are limited to 280 characters; this draft is ${text.length}. Shorten it or post it elsewhere.`
      );
    }
    const { data } = await fetchJson('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        reply: { in_reply_to_tweet_id: item.external_id },
      }),
      retries: 0,
    });
    const posted = (data && data.data) || {};
    if (!posted.id) throw new Error('X accepted the request but returned no post id');
    const handle = connection && connection.account_name ? connection.account_name.replace('@', '') : 'i/web';
    return {
      remote_id: posted.id,
      url: `https://x.com/${handle}/status/${posted.id}`,
    };
  },
};
