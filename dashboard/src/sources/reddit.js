'use strict';

const config = require('../config');
const atom = require('../lib/atom');
const { fetchJson, fetchText, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const subreddits = require('../lib/subreddits');

const BASE = 'https://www.reddit.com';
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

/* ------------- public Atom feeds, the path that needs no credentials ----- */

/**
 * Reddit refuses the public JSON endpoints for a growing share of clients,
 * answering with an HTML block page. Every subreddit also publishes an Atom
 * feed at the same paths with `.rss` - an official, public interface that is
 * not blocked the same way.
 *
 * So without app credentials the feed is the primary path, not a fallback:
 * trying JSON first only buys a 403 per subreddit per poll. The JSON endpoint
 * is still tried if the feed itself fails, since it carries more (score,
 * comment count, flair) where it does answer.
 */

/** `/r/x/new.json` -> `/r/x/new/.rss`, the feed for the same listing. */
function feedUrl(path, limit) {
  const listing = path.replace(/\.json$/, '');
  return `${BASE}${listing}/.rss?limit=${limit}`;
}

function normalizeFeedEntry(entry, subreddit) {
  const id = atom.tag(entry, 'id').trim();
  const title = atom.tag(entry, 'title');
  const body = atom.htmlToText(atom.tag(entry, 'content'));
  const author = atom.tag(atom.tag(entry, 'author'), 'name').replace(/^\/u\//, '');
  const url = atom.attr(entry, 'link', 'href');
  const isComment = id.startsWith('t1_');

  return {
    external_id: id,
    author: author ? `u/${author}` : null,
    // A comment's feed title is a restatement of the thread, so only the post
    // wants its title prepended to the body.
    text: isComment ? body : [atom.htmlToText(title), body].filter(Boolean).join('\n\n'),
    url: url || null,
    timestamp: atom.tag(entry, 'updated') || atom.tag(entry, 'published'),
    kind: isComment ? 'comment' : 'post',
    origin: `r/${subreddit}`,
    meta: {
      title: isComment ? null : atom.htmlToText(title),
      subreddit,
      via: 'rss',
    },
  };
}

async function fetchFeed(path, limit, subreddit) {
  const { text } = await fetchText(feedUrl(path, limit), {
    timeoutMs: 20000,
    retries: 1,
    headers: {
      'User-Agent': redditUserAgent(),
      Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8',
    },
  });
  // A block page answers 200 as readily as 403; anything that is not a feed
  // is a failure, so the caller can try the other path.
  if (!/<feed\b/i.test(String(text || ''))) {
    throw new Error('the feed address did not answer with a feed');
  }
  return atom.entries(text).map((entry) => normalizeFeedEntry(entry, subreddit));
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

/**
 * Reads a listing, through the OAuth API when credentials are configured and
 * the public JSON endpoint otherwise.
 *
 * The public endpoints are widely blocked from datacenter IPs - Replit's
 * included - which Reddit signals with a 403 and an HTML block page rather
 * than a JSON error, so that case is translated into something actionable.
 */
async function fetchListing(path, limit, subreddit, normalize) {
  const headers = { 'User-Agent': redditUserAgent() };

  // No app credentials: the feed first, the JSON endpoint only if it fails.
  let feedError = null;
  if (!usingOAuth()) {
    try {
      return await fetchFeed(path, limit, subreddit);
    } catch (err) {
      feedError = err;
    }
  }

  const url = usingOAuth()
    ? // /r/x/new.json -> /r/x/new on the OAuth host.
      `${OAUTH_BASE}${path.replace(/\.json$/, '')}?limit=${limit}&raw_json=1`
    : `${BASE}${path}?limit=${limit}&raw_json=1`;
  if (usingOAuth()) headers.Authorization = `Bearer ${await appOnlyToken()}`;

  let data;
  try {
    ({ data } = await fetchJson(url, { timeoutMs: 20000, retries: 1, headers }));
  } catch (err) {
    if (err.status === 401 && usingOAuth()) {
      // The cached token was rejected; drop it so the next poll re-authorizes.
      forgetToken();
    }
    if (feedError) {
      const blocked = new Error(
        'Reddit refused both the public feed and the public JSON endpoint ' +
          `(${describeAttempt(feedError)}, then ${describeAttempt(err)}). It blocks ` +
          'these from datacenter IPs such as Replit\u2019s. Register a Reddit app and ' +
          'set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET to read through the OAuth API ' +
          'instead, or run the dashboard from a home connection.'
      );
      blocked.status = err.status || 403;
      throw blocked;
    }
    throw err;
  }

  const children = data && data.data && Array.isArray(data.data.children)
    ? data.data.children
    : [];
  return children.map((child) => normalize(child, subreddit));
}

/** Short form of one failed attempt, for the two-path error above. */
function describeAttempt(err) {
  if (err && err.status) return `HTTP ${err.status}`;
  return (err && err.message) || 'failed';
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
      : 'the public Atom feeds (.rss), falling back to the JSON endpoint',
    user_agent: redditUserAgent(),
    include_comments: settings.getBool('reddit.include_comments', true),
    listing_limit: settings.getNumber('reddit.listing_limit', 50),
  }),
  poll,
  redditUserAgent,
  usingOAuth,
  forgetToken,
};
