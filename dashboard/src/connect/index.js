'use strict';

const crypto = require('crypto');
const config = require('../config');
const connections = require('../lib/connections');

const PROVIDERS = [
  require('./reddit'),
  require('./x'),
  require('./youtube'),
];

const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

function get(id) {
  return byId.get(id) || null;
}

/**
 * OAuth redirect URI for a provider. Must match the value registered with the
 * platform exactly, so it is derived from one configured public URL.
 */
function redirectUri(providerId, req) {
  const base =
    config.publicUrl ||
    (req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${config.port}`);
  return `${base.replace(/\/+$/, '')}/api/connections/${providerId}/callback`;
}

/** PKCE pair for the providers that require it. */
function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

function beginConnect(provider, req) {
  if (!provider.isRegistered()) {
    const err = new Error(
      `${provider.label} is not registered yet. Create the app (${provider.registration}) and set its client credentials.`
    );
    err.status = 400;
    throw err;
  }
  const pair = provider.usesPkce ? pkce() : {};
  const state = connections.startState(provider.id, pair.verifier);
  return provider.authorizeUrl({
    state,
    challenge: pair.challenge,
    redirectUri: redirectUri(provider.id, req),
  });
}

async function completeConnect(provider, { code, state }, req) {
  const stored = connections.consumeState(state);
  if (!stored || stored.provider !== provider.id) {
    const err = new Error('This sign-in link has expired or was already used. Start again.');
    err.status = 400;
    throw err;
  }
  const tokens = await provider.exchangeCode({
    code,
    verifier: stored.verifier,
    redirectUri: redirectUri(provider.id, req),
  });
  const identity = await provider.identity(tokens.access_token);
  return connections.save(provider.id, tokens, identity);
}

/**
 * Returns a usable access token, refreshing first when the stored one has
 * expired. Throws when the account is not linked or the refresh fails.
 */
async function accessTokenFor(providerId) {
  const provider = get(providerId);
  const connection = connections.get(providerId);
  if (!connection) {
    const err = new Error(
      `No ${provider ? provider.label : providerId} account is linked. Connect one in Sources first.`
    );
    err.status = 412;
    throw err;
  }
  if (!connections.isExpired(connection)) return { connection, accessToken: connection.access_token };

  if (!connection.refresh_token) {
    const err = new Error(
      `The ${provider.label} connection expired and has no refresh token. Reconnect the account.`
    );
    err.status = 401;
    throw err;
  }
  try {
    const tokens = await provider.refresh(connection.refresh_token);
    const updated = connections.updateTokens(providerId, tokens);
    return { connection: updated, accessToken: updated.access_token };
  } catch (err) {
    connections.setError(providerId, err.message);
    const wrapped = new Error(
      `Could not refresh the ${provider.label} connection: ${err.message}. Reconnect the account.`
    );
    wrapped.status = 401;
    throw wrapped;
  }
}

/** Provider that could reply to this item, or null when nothing can. */
function providerFor(item) {
  if (!item) return null;
  for (const provider of PROVIDERS) {
    if (provider.canReplyTo(item)) return provider;
  }
  return null;
}

function status(req) {
  const linked = new Map(connections.list().map((c) => [c.provider, c]));
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    registered: provider.isRegistered(),
    registration: provider.registration,
    scopes: provider.scopes,
    redirect_uri: redirectUri(provider.id, req),
    connection: linked.get(provider.id) || null,
  }));
}

module.exports = {
  PROVIDERS,
  get,
  beginConnect,
  completeConnect,
  accessTokenFor,
  providerFor,
  redirectUri,
  status,
};
