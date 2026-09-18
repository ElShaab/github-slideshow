'use strict';

const config = require('../config');
const { fetchJson, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const state = require('../lib/state');
const quota = require('../lib/quota');
const sites = require('../lib/searchSites');

/**
 * Discovery source for communities that have no API of their own, such as
 * Quora and Inspire.
 *
 * It asks a licensed search API for site-scoped matches and stores only what
 * that API returns: title, snippet, link. The result pages themselves are
 * never fetched, so nothing here scrapes a site that prohibits it - the feed
 * gives you the link and you read the thread in context.
 *
 * Each poll runs one keyword against one site per query and rotates through
 * the keyword x site matrix across polls, which keeps keyword attribution
 * exact and the query count predictable on a small free tier.
 */

const PROVIDERS = {
  brave: {
    label: 'Brave Search API',
    env: 'BRAVE_SEARCH_API_KEY',
    maxResults: 20,
    // Free tier allows one query per second.
    pacingMs: 1100,
    metered: 'month',
  },
  google: {
    label: 'Google Programmable Search',
    env: 'GOOGLE_SEARCH_API_KEY',
    maxResults: 10,
    pacingMs: 500,
    metered: 'day',
  },
};

function providerId() {
  const raw = String(settings.get('websearch.provider') || 'brave').toLowerCase();
  return PROVIDERS[raw] ? raw : 'brave';
}

function provider() {
  return PROVIDERS[providerId()];
}

function isConfigured() {
  if (providerId() === 'google') {
    return !!(config.search.google.apiKey && config.search.google.cx);
  }
  return !!config.search.brave.apiKey;
}

function quotaState() {
  const id = providerId();
  const reserve = settings.getNumber('websearch.quota_reserve', 0);
  if (provider().metered === 'month') {
    const limit = settings.getNumber('websearch.monthly_quota', 2000);
    return {
      period: 'month',
      window: quota.pacificMonth(),
      limit,
      reserve,
      used: quota.monthUsed('websearch'),
      remaining: quota.monthRemaining('websearch', limit, reserve),
      calls: quota.monthCalls('websearch'),
    };
  }
  const limit = settings.getNumber('websearch.daily_quota', 100);
  return {
    period: 'day',
    window: quota.pacificDay(),
    limit,
    reserve,
    used: quota.used('websearch'),
    remaining: quota.remaining('websearch', limit, reserve),
    calls: quota.calls('websearch'),
  };
}

/** Strip tracking parameters and fragments so the same page dedups to one ID. */
function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|refer|source|share|__|fbclid|gclid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    let out = url.toString();
    if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return String(raw || '').trim();
  }
}

function stripTags(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoteTerm(term) {
  const cleaned = term.replace(/"/g, '');
  return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function buildQuery(site, term) {
  return `site:${site.domain} ${quoteTerm(term)}`;
}

function sinceDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function searchBrave(query, { count, freshnessDays }) {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    result_filter: 'web',
    text_decorations: '0',
    spellcheck: '0',
  });
  const from = sinceDate(freshnessDays).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  params.set('freshness', `${from}to${to}`);

  const { data } = await fetchJson(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.search.brave.apiKey,
      },
      retries: 1,
    }
  );

  const results = (data && data.web && data.web.results) || [];
  return results.map((r) => ({
    title: stripTags(r.title),
    snippet: stripTags(r.description),
    url: r.url,
    published: r.page_age || null,
    host: (r.meta_url && r.meta_url.hostname) || null,
  }));
}

async function searchGoogle(query, { count, freshnessDays }) {
  const params = new URLSearchParams({
    key: config.search.google.apiKey,
    cx: config.search.google.cx,
    q: query,
    num: String(Math.min(count, 10)),
    dateRestrict: `d${freshnessDays}`,
  });

  const { data } = await fetchJson(
    `https://www.googleapis.com/customsearch/v1?${params}`,
    { retries: 1 }
  );

  return (data.items || []).map((item) => {
    const metatags =
      (item.pagemap && item.pagemap.metatags && item.pagemap.metatags[0]) || {};
    return {
      title: stripTags(item.title),
      snippet: stripTags(item.snippet),
      url: item.link,
      published:
        metatags['article:published_time'] ||
        metatags['og:updated_time'] ||
        null,
      host: item.displayLink || null,
    };
  });
}

function runSearch(query, options) {
  return providerId() === 'google'
    ? searchGoogle(query, options)
    : searchBrave(query, options);
}

/** Round-robin over the keyword x site matrix, remembered between polls. */
function nextPairs(pairs, take) {
  let offset = Number(state.getCursor('websearch'));
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset %= pairs.length;

  const picked = [];
  for (let i = 0; i < Math.min(take, pairs.length); i += 1) {
    picked.push(pairs[(offset + i) % pairs.length]);
  }
  state.setCursor('websearch', (offset + picked.length) % pairs.length);
  return picked;
}

async function poll() {
  if (!isConfigured()) {
    throw new Error(
      `${provider().label} is not configured: set ${provider().env}` +
        (providerId() === 'google' ? ' and GOOGLE_SEARCH_CX' : '')
    );
  }

  const matcher = matcherFor('websearch');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to web search' };
  }

  const enabledSites = sites.enabled();
  if (!enabledSites.length) {
    return { fetched: 0, added: 0, notes: 'no sites configured' };
  }

  const terms = matcher.keywords.map((k) => k.term);
  const pairs = [];
  for (const site of enabledSites) {
    for (const term of terms) pairs.push({ site, term });
  }

  const perPoll = Math.max(
    settings.getNumber('websearch.max_queries_per_poll', 4),
    1
  );
  const count = Math.min(
    Math.max(settings.getNumber('websearch.results_per_query', 10), 1),
    provider().maxResults
  );
  const freshnessDays = Math.max(
    settings.getNumber('websearch.freshness_days', 30),
    1
  );

  const totals = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const notes = [];
  let ran = 0;

  for (const pair of nextPairs(pairs, perPoll)) {
    if (quotaState().remaining < 1) {
      notes.push(
        `${provider().label} ${quotaState().period}ly free tier spent ` +
          `(${quotaState().used}/${quotaState().limit}); stopping early`
      );
      break;
    }

    const query = buildQuery(pair.site, pair.term);
    // Count the query before it runs: a failed one still counts against the
    // provider's allowance.
    quota.record('websearch', 1);
    ran += 1;

    let results;
    try {
      results = await runSearch(query, { count, freshnessDays });
    } catch (err) {
      // A rate limit is a source-level problem; let the scheduler back off.
      if (err.status === 429) throw err;
      notes.push(`${query}: ${err.message}`);
      continue;
    }

    const candidates = results.map((result) => ({
      external_id: `url:${normalizeUrl(result.url)}`,
      author: pair.site.label || pair.site.domain,
      text: [result.title, result.snippet].filter(Boolean).join('\n\n'),
      url: result.url,
      timestamp: result.published || new Date().toISOString(),
      kind: 'search result',
      origin: result.host || pair.site.domain,
      // The API matched this server-side; the snippet may not repeat the term.
      fallbackKeyword: pair.term,
      meta: {
        provider: providerId(),
        query,
        domain: pair.site.domain,
        snippet: result.snippet,
        published_known: !!result.published,
      },
    }));

    const stats = ingest('websearch', candidates, matcher);
    totals.fetched += stats.fetched;
    totals.added += stats.added;
    totals.duplicates += stats.duplicates;
    totals.unmatched += stats.unmatched;

    await sleep(provider().pacingMs);
  }

  const q = quotaState();
  notes.push(
    `${ran} of ${pairs.length} keyword/site queries this poll; ` +
      `${q.used}/${q.limit} used this ${q.period}`
  );
  return { ...totals, notes: notes.join('; ') };
}

module.exports = {
  id: 'websearch',
  label: 'Web search (Quora, Inspire…)',
  // Only the selected provider's credentials are required, so the Sources tab
  // does not report the other one as missing.
  get credentials() {
    return providerId() === 'google'
      ? [
          {
            env: 'GOOGLE_SEARCH_API_KEY',
            label: 'Google Programmable Search key',
            required: true,
          },
          {
            env: 'GOOGLE_SEARCH_CX',
            label: 'Google Programmable Search engine ID',
            required: true,
          },
        ]
      : [
          {
            env: 'BRAVE_SEARCH_API_KEY',
            label: 'Brave Search API key',
            required: true,
          },
        ];
  },
  isConfigured,
  describe: () => ({
    provider: providerId(),
    provider_label: provider().label,
    providers: Object.keys(PROVIDERS),
    sites: sites.list(),
    results_per_query: settings.getNumber('websearch.results_per_query', 10),
    freshness_days: settings.getNumber('websearch.freshness_days', 30),
    max_queries_per_poll: settings.getNumber('websearch.max_queries_per_poll', 4),
    rotation_offset: state.getCursor('websearch'),
    quota: quotaState(),
  }),
  poll,
  buildQuery,
  normalizeUrl,
};
