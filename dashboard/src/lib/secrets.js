'use strict';

const crypto = require('crypto');
const { db } = require('../db');

/**
 * Encryption at rest for OAuth tokens.
 *
 * The key comes from TOKEN_SECRET when it is set. When it is not, a random
 * key is generated once and kept in the settings table: that protects the
 * tokens if the database file leaks on its own (a backup, a stray commit,
 * a shared Replit fork) but not against someone who already has the whole
 * filesystem. Set TOKEN_SECRET to get the stronger property.
 */
const ALGORITHM = 'aes-256-gcm';

let cachedKey = null;

function keyFromSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function key() {
  if (cachedKey) return cachedKey;
  if (process.env.TOKEN_SECRET) {
    cachedKey = keyFromSecret(process.env.TOKEN_SECRET);
    return cachedKey;
  }
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('security.token_key');
  if (row) {
    cachedKey = Buffer.from(row.value, 'base64');
    return cachedKey;
  }
  const generated = crypto.randomBytes(32);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'security.token_key',
    generated.toString('base64')
  );
  cachedKey = generated;
  return cachedKey;
}

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Stored token is not in the expected format');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Only for tests: forget the derived key so a new database derives its own. */
function resetKeyCache() {
  cachedKey = null;
}

module.exports = { encrypt, decrypt, resetKeyCache, usingEnvSecret: () => !!process.env.TOKEN_SECRET };
