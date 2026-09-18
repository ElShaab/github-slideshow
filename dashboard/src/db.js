'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
-- Search terms the poll jobs read at runtime. Never hardcode keywords.
CREATE TABLE IF NOT EXISTS keywords (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  term        TEXT    NOT NULL,
  term_lower  TEXT    NOT NULL UNIQUE,
  scope       TEXT    NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'specific')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Only populated when scope = 'specific'.
CREATE TABLE IF NOT EXISTS keyword_sources (
  keyword_id  INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  source      TEXT    NOT NULL,
  PRIMARY KEY (keyword_id, source)
);

-- The dedup ledger. Rows survive deleting an item from the feed, so a
-- re-poll never resurfaces something already seen.
CREATE TABLE IF NOT EXISTS seen_items (
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, external_id)
);

-- The unified feed. Every source normalizes into this shape.
CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT    NOT NULL,
  external_id     TEXT    NOT NULL,
  author          TEXT,
  text            TEXT    NOT NULL,
  url             TEXT,
  timestamp       TEXT    NOT NULL,
  keyword_matched TEXT,
  status          TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'used')),
  kind            TEXT,
  origin          TEXT,
  meta            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_items_timestamp ON items (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_items_source    ON items (source);
CREATE INDEX IF NOT EXISTS idx_items_status    ON items (status);

-- Every keyword an item matched (an item can match several).
CREATE TABLE IF NOT EXISTS item_keywords (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  term_lower TEXT    NOT NULL,
  term       TEXT    NOT NULL,
  PRIMARY KEY (item_id, term_lower)
);

CREATE INDEX IF NOT EXISTS idx_item_keywords_term ON item_keywords (term_lower);

-- One row per source: last poll result, and the earliest time the next poll
-- is allowed (used to back off after a rate limit).
CREATE TABLE IF NOT EXISTS source_state (
  source          TEXT PRIMARY KEY,
  last_run_at     TEXT,
  last_status     TEXT,
  last_error      TEXT,
  last_fetched    INTEGER NOT NULL DEFAULT 0,
  last_added      INTEGER NOT NULL DEFAULT 0,
  total_added     INTEGER NOT NULL DEFAULT 0,
  running         INTEGER NOT NULL DEFAULT 0,
  next_allowed_at TEXT,
  cursor          TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subreddits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Domains the licensed-search-API source runs site: queries against.
CREATE TABLE IF NOT EXISTS search_sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  domain     TEXT    NOT NULL UNIQUE,
  label      TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS youtube_channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT    NOT NULL UNIQUE,
  title      TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Daily API-unit accounting, mainly for YouTube's 10k/day free quota.
CREATE TABLE IF NOT EXISTS api_usage (
  day    TEXT    NOT NULL,
  source TEXT    NOT NULL,
  units  INTEGER NOT NULL DEFAULT 0,
  calls  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);

CREATE TABLE IF NOT EXISTS poll_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT    NOT NULL,
  started_at TEXT    NOT NULL,
  ended_at   TEXT,
  status     TEXT    NOT NULL,
  fetched    INTEGER NOT NULL DEFAULT 0,
  added      INTEGER NOT NULL DEFAULT 0,
  message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_poll_log_started ON poll_log (started_at DESC);
`;

/**
 * Databases created before the source list grew carry a CHECK constraint that
 * only allows the original four sources. SQLite cannot alter a CHECK in place,
 * so those two tables are rebuilt without it. Runs before the schema is
 * applied, so the CREATE INDEX statements below restore the dropped indexes.
 */
function migrateLegacySourceChecks() {
  const tableSql = (name) => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    return row ? row.sql : null;
  };

  const stale = ['items', 'keyword_sources'].filter((name) => {
    const sql = tableSql(name);
    return sql && /CHECK \(source IN/.test(sql);
  });
  if (!stale.length) return;

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const name of stale) {
      const rebuilt = tableSql(name)
        .replace(/CHECK \(source IN \([^)]*\)\)/, '')
        .replace(/source(\s+)TEXT(\s+)NOT NULL(\s+),/, 'source$1TEXT$2NOT NULL,')
        .replace(new RegExp(`(CREATE TABLE )("?)${name}\\2`), `$1${name}__migrated`);
      db.exec(rebuilt);
      const columns = db
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((c) => `"${c.name}"`)
        .join(', ');
      db.exec(
        `INSERT INTO ${name}__migrated (${columns}) SELECT ${columns} FROM ${name}`
      );
      db.exec(`DROP TABLE ${name}`);
      db.exec(`ALTER TABLE ${name}__migrated RENAME TO ${name}`);
    }
  })();
  db.pragma('foreign_keys = ON');
  console.log(
    `[db] migrated ${stale.join(', ')} to the extensible source list`
  );
}

migrateLegacySourceChecks();

db.exec(SCHEMA);

const SOURCES = ['reddit', 'x', 'youtube', 'pubmed', 'websearch'];

const DEFAULT_SETTINGS = {
  'reddit.enabled': 'true',
  'reddit.interval_minutes': '15',
  'reddit.listing_limit': '50',
  'reddit.include_comments': 'true',

  'x.enabled': 'false',
  'x.interval_minutes': '30',
  'x.max_results': '50',
  // Free tier is extremely tight on recent-search; basic/pro allow more.
  'x.tier': 'free',

  'youtube.enabled': 'false',
  'youtube.interval_minutes': '30',
  'youtube.daily_quota': '10000',
  'youtube.quota_reserve': '500',
  'youtube.search_videos': 'true',
  'youtube.channel_comments': 'true',
  'youtube.max_search_keywords': '4',

  // Licensed search APIs have small free tiers, so this polls twice a day.
  'websearch.enabled': 'false',
  'websearch.interval_minutes': '720',
  'websearch.provider': 'brave',
  'websearch.results_per_query': '10',
  'websearch.freshness_days': '30',
  'websearch.max_queries_per_poll': '4',
  // Brave's free tier is 2,000 queries/month; Google's is 100/day.
  'websearch.monthly_quota': '2000',
  'websearch.daily_quota': '100',
  'websearch.quota_reserve': '0',

  'pubmed.enabled': 'true',
  'pubmed.interval_minutes': '360',
  'pubmed.reldate_days': '30',
  'pubmed.max_results': '25',
};

const DEFAULT_SEARCH_SITES = [
  ['quora.com', 'Quora'],
  ['inspire.com', 'Inspire'],
];

const DEFAULT_SUBREDDITS = [
  'amputee',
  'amputees',
  'prosthetics',
  'Prosthetist',
  'limbloss',
  'disability',
  'AskDocs',
];

function seed() {
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const insertState = db.prepare(
    'INSERT OR IGNORE INTO source_state (source) VALUES (?)'
  );
  const insertSub = db.prepare(
    'INSERT OR IGNORE INTO subreddits (name) VALUES (?)'
  );
  const insertSite = db.prepare(
    'INSERT OR IGNORE INTO search_sites (domain, label) VALUES (?, ?)'
  );

  db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(key, value);
    }
    for (const source of SOURCES) {
      insertState.run(source);
    }
    const existing = db
      .prepare('SELECT COUNT(*) AS n FROM subreddits')
      .get().n;
    if (existing === 0) {
      for (const name of DEFAULT_SUBREDDITS) insertSub.run(name);
    }
    const existingSites = db
      .prepare('SELECT COUNT(*) AS n FROM search_sites')
      .get().n;
    if (existingSites === 0) {
      for (const [domain, label] of DEFAULT_SEARCH_SITES) insertSite.run(domain, label);
    }
  })();
}

seed();

module.exports = { db, SOURCES, DEFAULT_SETTINGS };
