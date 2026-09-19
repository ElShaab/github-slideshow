'use strict';

const crypto = require('crypto');
const { db } = require('../db');
const secrets = require('./secrets');

const stmts = {
  get: db.prepare('SELECT * FROM connections WHERE provider = ?'),
  all: db.prepare('SELECT * FROM connections ORDER BY provider'),
  upsert: db.prepare(
    `INSERT INTO connections
       (provider, account_id, account_name, scopes, access_token, refresh_token, expires_at, last_error)
     VALUES (@provider, @account_id, @account_name, @scopes, @access_token, @refresh_token, @expires_at, NULL)
     ON CONFLICT (provider) DO UPDATE SET
       account_id = excluded.account_id,
       account_name = excluded.account_name,
       scopes = excluded.scopes,
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, connections.refresh_token),
       expires_at = excluded.expires_at,
       last_error = NULL,
       updated_at = datetime('now')`
  ),
  updateTokens: db.prepare(
    `UPDATE connections
        SET access_token = @access_token,
            refresh_token = COALESCE(@refresh_token, refresh_token),
            expires_at = @expires_at,
            last_error = NULL,
            updated_at = datetime('now')
      WHERE provider = @provider`
  ),
  setError: db.prepare(
    "UPDATE connections SET last_error = ?, updated_at = datetime('now') WHERE provider = ?"
  ),
  remove: db.prepare('DELETE FROM connections WHERE provider = ?'),

  addState: db.prepare(
    'INSERT INTO oauth_states (state, provider, verifier) VALUES (?, ?, ?)'
  ),
  getState: db.prepare('SELECT * FROM oauth_states WHERE state = ?'),
  dropState: db.prepare('DELETE FROM oauth_states WHERE state = ?'),
  pruneStates: db.prepare(
    "DELETE FROM oauth_states WHERE created_at < datetime('now', '-30 minutes')"
  ),
};

function expiryFrom(expiresIn) {
  if (!expiresIn) return null;
  // Refresh a minute early so a request never races the expiry.
  return new Date(Date.now() + (Number(expiresIn) - 60) * 1000).toISOString();
}

/** Full record including decrypted tokens. Internal use only. */
function get(provider) {
  const row = stmts.get.get(provider);
  if (!row) return null;
  return {
    provider: row.provider,
    account_id: row.account_id,
    account_name: row.account_name,
    scopes: row.scopes ? row.scopes.split(' ') : [],
    access_token: secrets.decrypt(row.access_token),
    refresh_token: secrets.decrypt(row.refresh_token),
    expires_at: row.expires_at,
    connected_at: row.connected_at,
    updated_at: row.updated_at,
    last_error: row.last_error,
  };
}

/** Safe view for the API and UI: never includes tokens. */
function publicView(row) {
  return {
    provider: row.provider,
    account_name: row.account_name,
    account_id: row.account_id,
    scopes: row.scopes ? row.scopes.split(' ') : [],
    connected_at: row.connected_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    last_error: row.last_error,
  };
}

function list() {
  return stmts.all.all().map(publicView);
}

function save(provider, tokens, identity) {
  stmts.upsert.run({
    provider,
    account_id: identity ? identity.id : null,
    account_name: identity ? identity.name : null,
    scopes: tokens.scope || null,
    access_token: secrets.encrypt(tokens.access_token),
    refresh_token: secrets.encrypt(tokens.refresh_token),
    expires_at: expiryFrom(tokens.expires_in),
  });
  return get(provider);
}

function updateTokens(provider, tokens) {
  stmts.updateTokens.run({
    provider,
    access_token: secrets.encrypt(tokens.access_token),
    refresh_token: secrets.encrypt(tokens.refresh_token),
    expires_at: expiryFrom(tokens.expires_in),
  });
  return get(provider);
}

function setError(provider, message) {
  stmts.setError.run(message ? String(message).slice(0, 500) : null, provider);
}

function remove(provider) {
  return stmts.remove.run(provider).changes > 0;
}

function isExpired(connection) {
  if (!connection || !connection.expires_at) return false;
  return new Date(connection.expires_at).getTime() <= Date.now();
}

/* ---- in-flight authorization state ---- */

function startState(provider, verifier) {
  stmts.pruneStates.run();
  const state = crypto.randomBytes(24).toString('base64url');
  stmts.addState.run(state, provider, verifier || null);
  return state;
}

/** Single-use: a state can never be replayed. */
function consumeState(state) {
  stmts.pruneStates.run();
  const row = stmts.getState.get(state);
  if (!row) return null;
  stmts.dropState.run(state);
  return row;
}

module.exports = {
  get,
  list,
  save,
  updateTokens,
  setError,
  remove,
  isExpired,
  startState,
  consumeState,
  publicView,
};
