'use strict';

const config = require('../config');
const { parseFeed, isFeed } = require('../lib/feedParse');
const { fetchJson, fetchText, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const subreddits = require('../lib/subreddits');

const BASE = 'https://www.reddit.com';
const OLD_BASE = 'https://old.reddit.com';
const OAUTH_BASE = 'https://oauth.reddit.com';

/**
 * Reddit asks for a User-Agent in the form
 * <platform>:<app id>:<version> (by /u/<username>), and answers a generic one
 * with a block page. The username comes from whichever Reddit account the
 * dashboard already knows about.
 */
function redditUserAgent() {
  let username = null;
  try {
    const linked = require('../lib/connections').get('reddit');
    const declared = require('../lib/manualAccounts').get('reddit');
    const handle = (linked && linked.account_name) || (declared && declared.handle);
    if (handle) username = String(handle).replace(/^u\//i, '');
  } catch {
    // Account tables are optional here; the UA just loses the "by" suffix.
  }
  return `nodejs:amputee-research-dashboard:1.1${username ? ` (by /u/${username})` : ''}`;
}

/* ---- app-only OAuth, used whenever client credentials are configured ---- */

let appToken = null;

async function appOnlyToken() {
  if (appToken && appToken.expires_at > Date.now() + 60000) return appToken.value;

  const basic = Buffer.from(
    `${config.reddit.clientId}:${config.reddit.clientSecret || ''}`
  ).toString('base64');

  // A confidential app (with a secret) uses client_credentials; an installed
  // app has no secret and uses the installed_client grant instead.
  const body = config.reddit.clientSecret
    ? { grant_type: 'client_credentials' }
    : {
        grant_type: 'https://oauth.reddit.com/grants/installed_client',
        device_id: 'DO_NOT_TRACK_THIS_DEVICE',
      };

  const { data } = await fetchJson(`${BASE}/api/v1/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(),
    },
    body: new URLSearchParams(body).toString(),
    retries: 1,
  });

  if (!data || !data.access_token) {
    throw new Error('Reddit did not return an app token; check the client ID and secret');
  }
  appToken = {
    value: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return appToken.value;
}

function usingOAuth() {
  return !!config.reddit.clientId;
}

function forgetToken() {
  appToken = null;
}

/** Public JSON listing -> normalized candidates. No credentials required. */
function normalizePost(child, subreddit) {
  const d = child.data || {};
  const title = d.title || '';
  const body = d.selftext || '';
  return {
    external_id: d.name || `t3_${d.id}`,
    author: d.author ? `u/${d.author}` : null,
    text: [title, body].filter(Boolean).join('\n\n'),
    url: d.permalink ? `${BASE}${d.permalink}` : d.url || null,
    timestamp: d.created_utc,
    kind: 'post',
    origin: `r/${subreddit}`,
    meta: {
      title,
      subreddit: d.subreddit || subreddit,
      score: d.score,
      num_comments: d.num_comments,
      flair: d.link_flair_text || null,
    },
  };
}

function normalizeComment(child, subreddit) {
  const d = child.data || {};
  return {
    external_id: d.name || `t1_${d.id}`,
    author: d.author ? `u/${d.author}` : null,
    text: d.body || '',
    url: d.permalink ? `${BASE}${d.permalink}?context=3` : null,
    timestamp: d.created_utc,
    kind: 'comment',
    origin: `r/${subreddit}`,
    meta: {
      subreddit: d.subreddit || subreddit,
      score: d.score,
      post_title: d.link_title || null,
      post_url: d.link_permalink || null,
    },
  };
}

/* ------------- public feeds, the path that needs no credentials ---------- */

/**
 * Reddit refuses the public JSON endpoints for a growing share of clients,
 * answering with an HTML block page. Every subreddit also publishes a feed at
 * the same paths with `.rss` - an official, public interface that is not
 * gated the same way - and old.reddit.com serves both shapes when www does
 * not.
 *
 * So a credential-free read tries four addresses in turn, best first, and
 * remembers which one answered so the rest of the poll goes straight to it.
 */
function publicAttempts(path, limit) {
  const listing = path.replace(/\.json$/, '');
  const query = `limit=${limit}`;
  return [
    { id: 'feed-www', label: 'feed on www.reddit.com', kind: 'feed', url: `${BASE}${listing}/.rss?${query}` },
    { id: 'feed-old', label: 'feed on old.reddit.com', kind: 'feed', url: `${OLD_BASE}${listing}/.rss?${query}` },
    { id: 'json-www', label: 'JSON on www.reddit.com', kind: 'json', url: `${BASE}${path}?${query}&raw_json=1` },
    { id: 'json-old', label: 'JSON on old.reddit.com', kind: 'json', url: `${OLD_BASE}${path}?${query}&raw_json=1` },
  ];
}

/** The address that last answered, so one poll does not re-probe per subreddit. */
let preferred = null;

function feedHeaders() {
  return {
    'User-Agent': redditUserAgent(),
    Accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8',
  };
}

/**
 * Reddit's feed is Atom, but RSS turns up on some paths and mirrors, so the
 * shared reader handles both rather than the Atom-only path this used to take.
 */
function normalizeFeedItem(entry, subreddit) {
  const id = String(entry.id || '').trim();
  const isComment = id.startsWith('t1_');
  return {
    external_id: id,
    author: entry.author ? `u/${entry.author.replace(/^\/?u\//, '')}` : null,
    // A comment's feed title restates the thread, so only a post wants its
    // title prepended to the body.
    text: isComment ? entry.text : [entry.title, entry.text].filter(Boolean).join('\n\n'),
    url: entry.link || null,
    timestamp: entry.published || null,
    kind: isComment ? 'comment' : 'post',
    origin: `r/${subreddit}`,
    meta: { title: isComment ? null : entry.title || null, subreddit, via: 'feed' },
  };
}

async function readFeed(url, subreddit) {
  const { text } = await fetchText(url, { timeoutMs: 20000, retries: 1, headers: feedHeaders() });
  // A block page answers 200 as readily as 403, so "no entries" must never
  // pass for "nothing new".
  if (!isFeed(text)) throw new Error('answered with a page, not a feed');
  const parsed = parseFeed(text);
  if (!parsed.items.length) throw new Error('the feed was empty');
  return parsed.items.map((entry) => normalizeFeedItem(entry, subreddit));
}

async function readJson(url, subreddit, normalize, extraHeaders = {}) {
  const { data } = await fetchJson(url, {
    timeoutMs: 20000,
    retries: 1,
    headers: { 'User-Agent': redditUserAgent(), ...extraHeaders },
  });
  const children =
    data && data.data && Array.isArray(data.data.children) ? data.data.children : [];
  if (!children.length) throw new Error('the listing was empty');
  return children.map((child) => normalize(child, subreddit));
}

function runAttempt(attempt, subreddit, normalize) {
  return attempt.kind === 'feed'
    ? readFeed(attempt.url, subreddit)
    : readJson(attempt.url, subreddit, normalize);
}

/** Short form of one failed attempt, for the combined error below. */
function describeAttempt(err) {
  if (err && err.status) return `HTTP ${err.status}`;
  // A network-level failure arrives as a bare "fetch failed"; name the cause,
  // since "could not connect" and "was refused" need different fixes.
  const cause = err && err.cause && (err.cause.code || err.cause.message);
  if (cause) return `could not connect (${cause})`;
  return (err && err.message) || 'failed';
}

async function fetchListing(path, limit, subreddit, normalize) {
  if (usingOAuth()) {
    // /r/x/new.json -> /r/x/new on the OAuth host.
    const url = `${OAUTH_BASE}${path.replace(/\.json$/, '')}?limit=${limit}&raw_json=1`;
    try {
      return await readJson(url, subreddit, normalize, {
        Authorization: `Bearer ${await appOnlyToken()}`,
      });
    } catch (err) {
      // The cached token was rejected; drop it so the next poll re-authorizes.
      if (err.status === 401) forgetToken();
      if (err.message === 'the listing was empty') return [];
      throw err;
    }
  }

  const attempts = publicAttempts(path, limit);
  // Whatever worked last time first, then the rest in order.
  const ordered = preferred
    ? [
        ...attempts.filter((a) => a.id === preferred),
        ...attempts.filter((a) => a.id !== preferred),
      ]
    : attempts;

  const failures = [];
  for (const attempt of ordered) {
    try {
      const items = await runAttempt(attempt, subreddit, normalize);
      preferred = attempt.id;
      return items;
    } catch (err) {
      // A rate limit is about us, not the address: trying three more makes it
      // worse.
      if (err.status === 429) throw err;
      // An empty listing is an answer, not a refusal.
      if (/was empty$/.test(err.message || '')) {
        preferred = attempt.id;
        return [];
      }
      failures.push(`${attempt.label}: ${describeAttempt(err)}`);
    }
  }

  preferred = null;
  const blocked = new Error(
    `Reddit refused every public address (${failures.join('; ')}). It blocks ` +
      'these from datacenter IPs such as Replit\u2019s. Register a Reddit app and ' +
      'set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET to read through the OAuth API ' +
      'instead, or run the dashboard from a home connection.'
  );
  blocked.status = 403;
  throw blocked;
}

/**
 * Tries every public address once and reports what each one said, without
 * putting a block page into the log. The point is that "Reddit is not
 * working" should be a readable fact rather than an inference.
 */
async function diagnose() {
  const names = subreddits.enabled();
  const subreddit = names[0] || 'amputee';
  const attempts = publicAttempts(`/r/${subreddit}/new.json`, 5);
  const report = [];

  for (const attempt of attempts) {
    const started = Date.now();
    try {
      const rows = await runAttempt(attempt, subreddit, normalizePost);
      report.push({
        ...summarize(attempt, started),
        ok: true,
        items: rows.length,
        sample: rows[0] ? String(rows[0].text || '').slice(0, 120) : null,
      });
    } catch (err) {
      report.push({
        ...summarize(attempt, started),
        ok: false,
        status: err.status || null,
        error: describeAttempt(err),
      });
    }
    await sleep(600);
  }

  return {
    subreddit,
    user_agent: redditUserAgent(),
    using_oauth: usingOAuth(),
    attempts: report,
  };

  function summarize(attempt, started) {
    return {
      id: attempt.id,
      label: attempt.label,
      url: attempt.url,
      ms: Date.now() - started,
    };
  }
}

async function poll() {
  const matcher = matcherFor('reddit');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to Reddit' };
  }

  const names = subreddits.enabled();
  if (!names.length) {
    return { fetched: 0, added: 0, notes: 'no subreddits configured' };
  }

  const limit = Math.min(
    Math.max(settings.getNumber('reddit.listing_limit', 50), 1),
    100
  );
  const includeComments = settings.getBool('reddit.include_comments', true);

  const totals = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const failures = [];

  for (const name of names) {
    const candidates = [];
    try {
      candidates.push(
        ...(await fetchListing(`/r/${name}/new.json`, limit, name, normalizePost))
      );
      if (includeComments) {
        // Be polite to the public endpoint: one request at a time, spaced out.
        await sleep(1200);
        candidates.push(
          ...(await fetchListing(`/r/${name}/comments.json`, limit, name, normalizeComment))
        );
      }
    } catch (err) {
      // A single bad/private/banned subreddit must not abort the whole poll,
      // but a rate limit applies to every subreddit, so that one propagates.
      if (err.status === 429) throw err;
      failures.push(`r/${name}: ${err.message}`);
    }

    const stats = ingest('reddit', candidates, matcher);
    totals.fetched += stats.fetched;
    totals.added += stats.added;
    totals.duplicates += stats.duplicates;
    totals.unmatched += stats.unmatched;

    await sleep(1200);
  }

  if (failures.length === names.length) {
    // Every subreddit failed: that is a source-level failure, not a note, so
    // the dashboard shows Reddit as broken rather than quietly idle. When the
    // cause is the same for all of them, say it once instead of seven times.
    const distinct = [...new Set(failures.map((f) => f.replace(/^r\/[^:]+: /, '')))];
    throw new Error(
      distinct.length === 1
        ? `all ${names.length} subreddit(s) failed: ${distinct[0]}`
        : `all ${names.length} subreddit(s) failed: ${failures.join('; ')}`
    );
  }

  return {
    ...totals,
    notes: failures.length ? failures.join('; ') : null,
  };
}

module.exports = {
  id: 'reddit',
  label: 'Reddit',
  credentials: [],
  isConfigured: () => true,
  describe: () => ({
    subreddits: subreddits.list(),
    reads_via: usingOAuth()
      ? 'oauth.reddit.com (app credentials)'
      : preferred
        ? `${(publicAttempts('/r/x/new.json', 1).find((a) => a.id === preferred) || {}).label} (last address that answered)`
        : 'the public feeds, then the JSON endpoints, on www and old.reddit.com',
    user_agent: redditUserAgent(),
    include_comments: settings.getBool('reddit.include_comments', true),
    listing_limit: settings.getNumber('reddit.listing_limit', 50),
  }),
  poll,
  diagnose,
  redditUserAgent,
  usingOAuth,
  forgetToken,
  /** Re-probe from the top instead of reusing the remembered address. */
  forgetPreferred: () => {
    preferred = null;
  },
};
