'use strict';

const config = require('../config');
const { fetchJson, sleep, HttpError } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const state = require('../lib/state');

const ENDPOINT = 'https://api.x.com/2/tweets/search/recent';

/**
 * Per-tier guard rails for the recent-search endpoint. The interval floor is
 * what keeps a 15-minute window from being burned in the first minute; the
 * dashboard's configured interval is clamped up to it.
 */
const TIERS = {
  free: { minIntervalMinutes: 180, maxQueriesPerPoll: 1, maxResults: 10 },
  basic: { minIntervalMinutes: 15, maxQueriesPerPoll: 2, maxResults: 100 },
  pro: { minIntervalMinutes: 5, maxQueriesPerPoll: 5, maxResults: 100 },
};

// X caps the query string itself: 512 characters on free/basic, 1024 on pro.
const QUERY_LIMIT = { free: 512, basic: 512, pro: 1024 };

function tier() {
  const raw = String(settings.get('x.tier') || 'free').toLowerCase();
  return TIERS[raw] ? raw : 'free';
}

function tierLimits() {
  return TIERS[tier()];
}

function quoteTerm(term) {
  const cleaned = term.replace(/"/g, '');
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/**
 * Pack keywords into as few OR queries as the character limit allows.
 * Returns [{ query, terms }].
 */
function buildQueries(terms, { limit, suffix }) {
  const queries = [];
  let current = [];

  const render = (list) => `(${list.map(quoteTerm).join(' OR ')})${suffix}`;

  for (const term of terms) {
    const candidate = [...current, term];
    if (current.length && render(candidate).length > limit) {
      queries.push({ query: render(current), terms: [...current] });
      current = [term];
    } else {
      current = candidate;
    }
    if (render([term]).length > limit) {
      // A single term too long for the query budget: skip it rather than
      // sending something the API will reject.
      current = current.filter((t) => t !== term);
    }
  }
  if (current.length) queries.push({ query: render(current), terms: [...current] });
  return queries;
}

function normalizeTweet(tweet, usersById) {
  const user = usersById.get(tweet.author_id) || {};
  const handle = user.username ? `@${user.username}` : tweet.author_id || null;
  const url = user.username
    ? `https://x.com/${user.username}/status/${tweet.id}`
    : `https://x.com/i/web/status/${tweet.id}`;
  return {
    external_id: tweet.id,
    author: handle,
    text: tweet.text || '',
    url,
    timestamp: tweet.created_at,
    kind: 'tweet',
    origin: handle,
    meta: {
      author_name: user.name || null,
      lang: tweet.lang || null,
      metrics: tweet.public_metrics || null,
      conversation_id: tweet.conversation_id || null,
    },
  };
}

function applyRateLimitHeaders(headers) {
  const remaining = Number(headers.get('x-rate-limit-remaining'));
  const reset = Number(headers.get('x-rate-limit-reset'));
  if (Number.isFinite(remaining) && remaining <= 1 && Number.isFinite(reset)) {
    const seconds = Math.max(30, Math.round(reset - Date.now() / 1000) + 5);
    state.backOff('x', seconds);
    return seconds;
  }
  return null;
}

async function poll() {
  if (!config.x.bearerToken) {
    throw new Error('X_BEARER_TOKEN is not set');
  }

  const matcher = matcherFor('x');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to X' };
  }

  const limits = tierLimits();
  const maxResults = Math.min(
    Math.max(settings.getNumber('x.max_results', 50), 10),
    limits.maxResults
  );
  const terms = matcher.keywords.map((k) => k.term);
  const queries = buildQueries(terms, {
    limit: QUERY_LIMIT[tier()] - 40,
    suffix: ' -is:retweet',
  }).slice(0, limits.maxQueriesPerPoll);

  if (!queries.length) {
    return { fetched: 0, added: 0, notes: 'no usable query built' };
  }

  const sinceId = state.getCursor('x');
  const totals = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const notes = [];
  let newestId = sinceId || null;

  for (const [index, entry] of queries.entries()) {
    const params = new URLSearchParams({
      query: entry.query,
      max_results: String(maxResults),
      'tweet.fields': 'created_at,author_id,lang,public_metrics,conversation_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    if (sinceId) params.set('since_id', sinceId);

    const { data, headers } = await fetchJson(`${ENDPOINT}?${params}`, {
      headers: { Authorization: `Bearer ${config.x.bearerToken}` },
      retries: 1,
    });

    const backedOff = applyRateLimitHeaders(headers);
    if (backedOff) notes.push(`rate window nearly spent, pausing ${backedOff}s`);

    const usersById = new Map(
      ((data.includes && data.includes.users) || []).map((u) => [u.id, u])
    );
    const tweets = data.data || [];
    const candidates = tweets.map((tweet) => {
      const normalized = normalizeTweet(tweet, usersById);
      // The API already matched server-side; keep the matching term around in
      // case the hit is not visible in the stored text.
      normalized.fallbackKeyword = entry.terms[0];
      return normalized;
    });

    if (data.meta && data.meta.newest_id) {
      if (!newestId || BigInt(data.meta.newest_id) > BigInt(newestId)) {
        newestId = data.meta.newest_id;
      }
    }

    const stats = ingest('x', candidates, matcher);
    totals.fetched += stats.fetched;
    totals.added += stats.added;
    totals.duplicates += stats.duplicates;
    totals.unmatched += stats.unmatched;

    if (backedOff) break;
    if (index < queries.length - 1) await sleep(2000);
  }

  if (newestId) state.setCursor('x', newestId);
  if (queries.length < buildQueries(terms, {
    limit: QUERY_LIMIT[tier()] - 40,
    suffix: ' -is:retweet',
  }).length) {
    notes.push(
      `only ${queries.length} of the keyword batches were searched (${tier()} tier cap)`
    );
  }

  return { ...totals, notes: notes.length ? notes.join('; ') : null };
}

module.exports = {
  id: 'x',
  label: 'X (Twitter)',
  credentials: [
    { env: 'X_BEARER_TOKEN', label: 'X API v2 bearer token', required: true },
  ],
  isConfigured: () => !!config.x.bearerToken,
  describe: () => {
    const limits = tierLimits();
    const configured = settings.getNumber('x.interval_minutes', 30);
    return {
      tier: tier(),
      min_interval_minutes: limits.minIntervalMinutes,
      effective_interval_minutes: Math.max(configured, limits.minIntervalMinutes),
      max_queries_per_poll: limits.maxQueriesPerPoll,
      max_results: Math.min(
        settings.getNumber('x.max_results', 50),
        limits.maxResults
      ),
      since_id: state.getCursor('x'),
    };
  },
  minIntervalMinutes: () => tierLimits().minIntervalMinutes,
  buildQueries,
  poll,
};
