'use strict';

const { fetchText, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const feeds = require('../lib/feeds');
const { parseFeed, isFeed, discoverFeedHref } = require('../lib/feedParse');

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

async function read(url) {
  try {
    const { text } = await fetchText(url, {
      timeoutMs: 20000,
      retries: 1,
      headers: { Accept: ACCEPT },
    });
    return text;
  } catch (err) {
    // A network-level failure arrives as a bare "fetch failed"; name the host
    // and the cause, since a bare address is assumed to be https.
    if (!err.status) {
      const cause = (err.cause && (err.cause.code || err.cause.message)) || err.message;
      const described = new Error(`Could not reach ${new URL(url).host}: ${cause}`);
      described.status = 502;
      throw described;
    }
    throw err;
  }
}

/**
 * Accepts either a feed address or the page it belongs to: when the body is
 * a web page, the `<link rel="alternate">` tag every publisher uses to
 * advertise its feed is followed once. This is discovery, the mechanism the
 * tag exists for - nothing is read out of the page itself.
 */
async function resolve(rawUrl) {
  const url = feeds.normalizeUrl(rawUrl);
  const body = await read(url);

  if (isFeed(body)) {
    const parsed = parseFeed(body);
    return { url, label: parsed.title || new URL(url).hostname, siteUrl: null, items: parsed.items.length };
  }

  const href = discoverFeedHref(body);
  if (!href) {
    const err = new Error(
      `${new URL(url).hostname} did not answer with a feed, and its page advertises none. ` +
        'Paste the address of the RSS or Atom feed itself.'
    );
    err.status = 400;
    throw err;
  }

  const feedUrl = new URL(href, url).toString();
  const feedBody = await read(feedUrl);
  if (!isFeed(feedBody)) {
    const err = new Error(`The feed advertised at ${feedUrl} did not answer with a feed`);
    err.status = 400;
    throw err;
  }
  const parsed = parseFeed(feedBody);
  return {
    url: feedUrl,
    label: parsed.title || new URL(url).hostname,
    siteUrl: url,
    items: parsed.items.length,
  };
}

function normalizeItem(item, feed) {
  const origin = feed.label || new URL(feed.url).hostname;
  return {
    external_id: item.id,
    author: item.author || null,
    // The title is usually the question itself on a forum, so it leads.
    text: [item.title, item.text].filter(Boolean).join('\n\n'),
    url: item.link || null,
    timestamp: item.published || null,
    kind: 'post',
    origin,
    meta: { title: item.title || null, feed: feed.url, feed_label: feed.label },
  };
}

async function poll() {
  const matcher = matcherFor('feeds');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to feeds' };
  }

  const list = feeds.enabled();
  if (!list.length) {
    return { fetched: 0, added: 0, notes: 'no feeds configured' };
  }

  const maxItems = Math.min(Math.max(settings.getNumber('feeds.max_items', 50), 1), 200);
  const totals = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const failures = [];

  for (const feed of list) {
    try {
      const body = await read(feed.url);
      if (!isFeed(body)) throw new Error('the address no longer answers with a feed');

      const parsed = parseFeed(body);
      const candidates = parsed.items
        .slice(0, maxItems)
        .map((item) => normalizeItem(item, feed));

      const stats = ingest('feeds', candidates, matcher);
      totals.fetched += stats.fetched;
      totals.added += stats.added;
      totals.duplicates += stats.duplicates;
      totals.unmatched += stats.unmatched;
      feeds.recordFetch(feed.id, null);
    } catch (err) {
      // One dead feed must not take the others down with it.
      if (err.status === 429) throw err;
      feeds.recordFetch(feed.id, err.message);
      failures.push(`${feed.label || feed.url}: ${err.message}`);
    }

    // Politeness: these are often small community servers.
    await sleep(1000);
  }

  if (failures.length === list.length) {
    throw new Error(`all ${list.length} feed(s) failed: ${failures.join('; ')}`);
  }

  return { ...totals, notes: failures.length ? failures.join('; ') : null };
}

module.exports = {
  id: 'feeds',
  label: 'Feeds (RSS / Atom)',
  credentials: [],
  isConfigured: () => true,
  describe: () => ({
    feeds: feeds.list(),
    max_items: settings.getNumber('feeds.max_items', 50),
  }),
  poll,
  resolve,
};
