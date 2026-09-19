'use strict';

const crypto = require('crypto');
const connections = require('./connections');

/**
 * Optional HTTP Basic guard for the whole dashboard.
 *
 * Reading a feed on an unlisted URL is one risk; posting publicly as the
 * physician's own account is another. Set DASHBOARD_PASSWORD (a Replit secret)
 * and the dashboard asks for it. Left unset, the app runs open and warns at
 * boot once an account is linked.
 */
function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function middleware() {
  const password = process.env.DASHBOARD_PASSWORD || '';
  const user = process.env.DASHBOARD_USER || 'dashboard';

  if (!password) {
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    const header = req.get('authorization') || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const index = decoded.indexOf(':');
      const suppliedUser = decoded.slice(0, index);
      const suppliedPassword = decoded.slice(index + 1);
      if (timingSafeEqual(suppliedUser, user) && timingSafeEqual(suppliedPassword, password)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Amputee research dashboard", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}

/** Logged at boot: an open dashboard that can post as a linked account. */
function warnIfUnprotected() {
  if (process.env.DASHBOARD_PASSWORD) return null;
  const linked = connections.list();
  if (!linked.length) return null;
  const message =
    `[security] ${linked.length} account(s) are linked (${linked
      .map((c) => c.account_name || c.provider)
      .join(', ')}) and this dashboard has no password. ` +
    'Anyone who can reach its URL can post as you. Set DASHBOARD_PASSWORD to require one.';
  console.warn(message);
  return message;
}

module.exports = { middleware, warnIfUnprotected };
