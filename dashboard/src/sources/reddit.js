'use strict';

const { fetchJson, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const subreddits = require('../lib/subreddits');

const BASE = 'https://www.reddit.com';

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

async function fetchListing(path, limit) {
  const url = `${BASE}${path}?limit=${limit}&raw_json=1`;
  const { data } = await fetchJson(url, { timeoutMs: 20000, retries: 1 });
  const children = data && data.data && Array.isArray(data.data.children)
    ? data.data.children
    : [];
  return children;
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
      for (const child of await fetchListing(`/r/${name}/new.json`, limit)) {
        candidates.push(normalizePost(child, name));
      }
      if (includeComments) {
        // Be polite to the public endpoint: one request at a time, spaced out.
        await sleep(1200);
        for (const child of await fetchListing(`/r/${name}/comments.json`, limit)) {
          candidates.push(normalizeComment(child, name));
        }
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
    // the dashboard shows Reddit as broken rather than quietly idle.
    throw new Error(`all ${names.length} subreddit(s) failed: ${failures.join('; ')}`);
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
    include_comments: settings.getBool('reddit.include_comments', true),
    listing_limit: settings.getNumber('reddit.listing_limit', 50),
  }),
  poll,
};
