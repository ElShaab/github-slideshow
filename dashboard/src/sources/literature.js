'use strict';

const crypto = require('crypto');
const { sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const state = require('../lib/state');
const { mergeWorks } = require('../research/merge');
const { classify } = require('../research/evidence');
const { relevance } = require('../research/rank');
const { PROVIDERS } = require('../research');

/**
 * Daily literature sweep.
 *
 * Runs the keyword list against the same six databases the per-question
 * matcher uses - PubMed, Europe PMC, Crossref, Semantic Scholar, OpenAlex and
 * ClinicalTrials.gov - restricted to recently published work, and drops
 * anything new into the unified feed.
 *
 * One keyword at a time, so every captured article carries the term that
 * found it, and each database is asked once per keyword behind the shared
 * politeness queue.
 */

function enabledProviders() {
  return PROVIDERS.filter((p) => settings.getBool(`literature.provider_${p.id}`, true));
}

function lookbackDays() {
  return Math.max(settings.getNumber('literature.lookback_days', 30), 1);
}

function since() {
  return new Date(Date.now() - lookbackDays() * 24 * 60 * 60 * 1000);
}

/** Stable identity across runs: DOI, then a registry id, then the title. */
function externalId(work) {
  if (work.doi) return `doi:${work.doi}`;
  if (work.pmid) return `pmid:${work.pmid}`;
  if (work.nct_id) return `nct:${String(work.nct_id).toUpperCase()}`;
  const key = String(work.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `title:${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

/** Publication date if the provider gave one, otherwise the year, else now. */
function publishedAt(work) {
  if (work.published_on) {
    const parsed = new Date(work.published_on);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (work.year) {
    const parsed = new Date(Date.UTC(Number(work.year), 0, 1));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Belt and braces on the date filter: several of these APIs will quietly
 * ignore a filter they do not recognise, and a sweep that floods the feed
 * with decade-old papers is worse than one that returns nothing.
 */
function isRecent(work, cutoff) {
  if (work.registry) return true;
  const stamp = work.published_on ? new Date(work.published_on) : null;
  if (stamp && !Number.isNaN(stamp.getTime())) return stamp >= cutoff;
  if (work.year) return Number(work.year) >= cutoff.getUTCFullYear();
  // No date at all: keep it and let relevance and dedup decide.
  return true;
}

function toCandidate(work, term) {
  const evidence = work.evidence || classify(work);
  const abstract = work.abstract ? String(work.abstract).slice(0, 1200) : '';
  return {
    external_id: externalId(work),
    author: work.authors || null,
    text: [work.title, abstract, work.venue].filter(Boolean).join('\n\n'),
    url: work.url || (work.doi ? `https://doi.org/${work.doi}` : null),
    timestamp: publishedAt(work),
    kind: evidence.registry ? 'trial' : 'article',
    origin: work.venue || 'Literature',
    // The database matched this server-side; the term that found it is the
    // one recorded even when the abstract does not repeat it verbatim.
    fallbackKeyword: term,
    meta: {
      title: work.title,
      doi: work.doi || null,
      pmid: work.pmid || null,
      nct_id: work.nct_id || null,
      venue: work.venue || null,
      year: work.year || null,
      citations: typeof work.citations === 'number' ? work.citations : null,
      open_access: work.open_access === undefined ? null : work.open_access,
      evidence,
      databases: work.sources || [],
      status: work.status || null,
    },
  };
}

async function poll() {
  const matcher = matcherFor('literature');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to the literature sweep' };
  }

  const providers = enabledProviders();
  if (!providers.length) {
    return { fetched: 0, added: 0, notes: 'every research database is switched off' };
  }

  const maxKeywords = Math.max(settings.getNumber('literature.max_keywords', 8), 1);
  const perProvider = Math.min(
    Math.max(settings.getNumber('literature.per_provider_limit', 15), 1),
    50
  );
  const minRelevance = Number(settings.get('literature.min_relevance')) || 0.3;
  const cutoff = since();
  const terms = matcher.keywords.map((k) => k.term);

  // More keywords than one run should cover: rotate so every term comes round.
  let offset = Number(state.getCursor('literature'));
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset %= terms.length;
  const batch = [];
  for (let i = 0; i < Math.min(maxKeywords, terms.length); i += 1) {
    batch.push(terms[(offset + i) % terms.length]);
  }
  state.setCursor('literature', (offset + batch.length) % terms.length);

  const totals = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const failures = new Map();
  let dropped = 0;
  let answered = 0;

  for (const term of batch) {
    const results = await Promise.allSettled(
      providers.map((provider) =>
        provider.search([term], {
          limit: perProvider,
          since: cutoff,
          sinceDays: lookbackDays(),
        })
      )
    );

    const lists = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        lists.push(result.value);
        answered += 1;
        return;
      }
      // One database failing never stops the sweep; it is counted and
      // reported against the run.
      const label = providers[index].label;
      failures.set(label, (failures.get(label) || 0) + 1);
    });

    const merged = mergeWorks(lists)
      .map((work) => ({ ...work, evidence: classify(work) }))
      .filter((work) => {
        if (!isRecent(work, cutoff)) {
          dropped += 1;
          return false;
        }
        // Keyword search on these APIs is broad; keep what actually matches.
        if (relevance(work, [term]) < minRelevance) {
          dropped += 1;
          return false;
        }
        return true;
      });

    const stats = ingest(
      'literature',
      merged.map((work) => toCandidate(work, term)),
      matcher
    );
    totals.fetched += stats.fetched;
    totals.added += stats.added;
    totals.duplicates += stats.duplicates;
    totals.unmatched += stats.unmatched;

    await sleep(400);
  }

  if (!answered) {
    // Every database failed for every keyword: that is a broken sweep, not an
    // empty one, and the dashboard should show it as such.
    throw new Error(
      `no database answered: ${[...failures]
        .map(([label, count]) => `${label} ×${count}`)
        .join(', ')}`
    );
  }

  const notes = [
    `${batch.length} of ${terms.length} keyword(s) swept, last ${lookbackDays()} days`,
  ];
  if (dropped) notes.push(`${dropped} result(s) dropped as stale or off-topic`);
  if (failures.size) {
    notes.push(
      `database failures: ${[...failures]
        .map(([label, count]) => `${label} ×${count}`)
        .join(', ')}`
    );
  }

  return { ...totals, notes: notes.join('; ') };
}

module.exports = {
  id: 'literature',
  label: 'Research sweep',
  credentials: [
    {
      env: 'SEMANTIC_SCHOLAR_API_KEY',
      label: 'Semantic Scholar key (optional, raises the rate limit)',
      required: false,
    },
  ],
  isConfigured: () => true,
  describe: () => ({
    databases: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      enabled: settings.getBool(`literature.provider_${p.id}`, true),
    })),
    lookback_days: lookbackDays(),
    max_keywords: settings.getNumber('literature.max_keywords', 8),
    per_provider_limit: settings.getNumber('literature.per_provider_limit', 15),
    min_relevance: Number(settings.get('literature.min_relevance')) || 0.3,
    keyword_offset: state.getCursor('literature'),
  }),
  poll,
  externalId,
  isRecent,
};
