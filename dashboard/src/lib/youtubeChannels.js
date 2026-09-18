'use strict';

const { db } = require('../db');

const stmts = {
  list: db.prepare('SELECT * FROM youtube_channels ORDER BY title COLLATE NOCASE, channel_id'),
  enabled: db.prepare('SELECT * FROM youtube_channels WHERE enabled = 1'),
  byChannelId: db.prepare('SELECT * FROM youtube_channels WHERE channel_id = ?'),
  insert: db.prepare(
    'INSERT OR IGNORE INTO youtube_channels (channel_id, title, enabled) VALUES (?, ?, 1)'
  ),
  setTitle: db.prepare('UPDATE youtube_channels SET title = ? WHERE channel_id = ?'),
  setEnabled: db.prepare('UPDATE youtube_channels SET enabled = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM youtube_channels WHERE id = ?'),
};

function list() {
  return stmts.list.all().map((r) => ({ ...r, enabled: !!r.enabled }));
}

function enabled() {
  return stmts.enabled.all().map((r) => ({ ...r, enabled: true }));
}

function add(channelId, title) {
  const id = String(channelId || '').trim();
  if (!/^UC[A-Za-z0-9_-]{20,24}$/.test(id)) {
    const err = new Error(
      `"${channelId}" is not a channel ID. Channel IDs start with "UC".`
    );
    err.status = 400;
    throw err;
  }
  stmts.insert.run(id, title || null);
  if (title) stmts.setTitle.run(title, id);
  const row = stmts.byChannelId.get(id);
  return { ...row, enabled: !!row.enabled };
}

function setEnabled(id, value) {
  return stmts.setEnabled.run(value ? 1 : 0, id).changes > 0;
}

function remove(id) {
  return stmts.remove.run(id).changes > 0;
}

module.exports = { list, enabled, add, setEnabled, remove };
