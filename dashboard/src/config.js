'use strict';

const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  quiet: true,
});

const root = path.join(__dirname, '..');

/**
 * All secrets come from the environment. Nothing here has a hardcoded default
 * that could leak a credential into git.
 */
const config = {
  root,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH
    ? path.resolve(root, process.env.DB_PATH)
    : path.join(root, 'data', 'dashboard.db'),

  // Polling can be disabled entirely (useful for tests and for local UI work).
  pollingEnabled: process.env.POLLING_ENABLED !== 'false',

  // Reddit's public JSON endpoints need no credentials, but they do want a
  // descriptive, unique User-Agent or they start answering with 429s.
  userAgent:
    process.env.USER_AGENT ||
    'amputee-research-dashboard/1.0 (personal research tool)',

  x: {
    bearerToken: process.env.X_BEARER_TOKEN || '',
  },

  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
  },

  // Optional: raises Semantic Scholar's shared rate limit. The other five
  // research APIs need no credentials.
  semanticScholar: {
    apiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
  },

  // Draft reply generation. Stored as a Replit secret / environment variable,
  // never in the repository.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  // Licensed search APIs, used to discover discussions on sites that have no
  // API of their own. Only what the search API returns is stored: the result
  // pages themselves are never fetched.
  search: {
    brave: { apiKey: process.env.BRAVE_SEARCH_API_KEY || '' },
    google: {
      apiKey: process.env.GOOGLE_SEARCH_API_KEY || '',
      cx: process.env.GOOGLE_SEARCH_CX || '',
    },
  },

  pubmed: {
    // Optional. Without a key NCBI allows ~3 requests/second, which is plenty.
    apiKey: process.env.PUBMED_API_KEY || '',
    tool: process.env.PUBMED_TOOL || 'amputee-research-dashboard',
    email: process.env.PUBMED_EMAIL || '',
  },
};

module.exports = config;
