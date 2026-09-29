'use strict';

const { db } = require('../db');

const stmts = {
  get: db.prepare('SELECT * FROM manual_accounts WHERE provider = ?'),
  all: db.prepare('SELECT * FROM manual_accounts ORDER BY provider'),
  upsert: db.prepare(
    `INSERT INTO manual_accounts (provider, handle, profile_url)
     VALUES (@provider, @handle, @profile_url)
     ON CONFLICT (provider) DO UPDATE SET
       handle = excluded.handle,
       profile_url = excluded.profile_url,
       added_at = datetime('now')`
  ),
  remove: db.prepare('DELETE FROM manual_accounts WHERE provider = ?'),
};

function get(provider) {
  return stmts.get.get(provider) || null;
}

function list() {
  return stmts.all.all();
}

function save(provider, { handle, profile_url }) {
  stmts.upsert.run({ provider, handle, profile_url: profile_url || null });
  return get(provider);
}

function remove(provider) {
  return stmts.remove.run(provider).changes > 0;
}

module.exports = { get, list, save, remove };
