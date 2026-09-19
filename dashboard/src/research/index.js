'use strict';

const settings = require('../lib/settings');
const items = require('../lib/items');
const store = require('../lib/researchStore');
const { extractTerms } = require('./terms');
const { mergeWorks } = require('./merge');
const { rankWorks } = require('./rank');
const { classify } = require('./evidence');
const clientLayer = require('./client');

const PROVIDERS = [
  require('./providers/pubmed'),
  require('./providers/europepmc'),
  require('./providers/crossref'),
  require('./providers/semanticscholar'),
  require('./providers/openalex'),
  require('./providers/clinicaltrials'),
];

const SNIPPET_LENGTH = 320;
const ABSTRACT_LIMIT = 2000;

function enabledProviders() {
  return PROVIDERS.filter((p) => settings.getBool(`research.provider_${p.id}`, true));
}

/** First couple of sentences of the abstract, cut on a word boundary. */
function snippet(abstract) {
  const text = String(abstract || '').trim();
  if (!text) return null;
  if (text.length <= SNIPPET_LENGTH) return text;
  const cut = text.slice(0, SNIPPET_LENGTH);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '));
  const body = lastStop > SNIPPET_LENGTH * 0.5 ? cut.slice(0, lastStop + 1) : cut;
  return `${body.trim()}…`;
}

function presentable(work, index) {
  return {
    rank: index + 1,
    title: work.title,
    venue: work.venue,
    year: work.year,
    authors: work.authors || null,
    doi: work.doi || null,
    pmid: work.pmid || null,
    nct_id: work.nct_id || null,
    url: work.url || (work.doi ? `https://doi.org/${work.doi}` : null),
    sources: work.sources,
    evidence: work.evidence,
    publication_types: work.publication_types || [],
    citations: typeof work.citations === 'number' ? work.citations : null,
    open_access: work.open_access === undefined ? null : work.open_access,
    open_access_url: work.open_access_url || null,
    registry: !!work.registry,
    status: work.status || null,
    snippet: snippet(work.abstract),
    abstract: work.abstract ? String(work.abstract).slice(0, ABSTRACT_LIMIT) : null,
    relevance: Number(work.relevance.toFixed(3)),
    score: Math.round(work.score),
  };
}

/**
 * Query every enabled literature API for one question, in parallel, and merge
 * the results.
 *
 * One provider failing (rate limit, outage, schema change) never fails the
 * match: its error is recorded against that provider and the others are
 * merged as usual.
 */
async function runMatch(item, options = {}) {
  const maxTerms = settings.getNumber('research.max_terms', 6);
  const perProvider = settings.getNumber('research.per_provider_limit', 20);
  const { terms, detail } = extractTerms(item, { max: maxTerms });

  if (!terms.length) {
    return {
      terms: [],
      term_detail: [],
      results: [],
      providers: [],
      considered: 0,
      no_strong_matches: true,
      note: 'No searchable terms could be extracted from this question.',
    };
  }

  const providers = options.providers || enabledProviders();
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const started = Date.now();
      try {
        const works = await provider.search(terms, { limit: perProvider });
        return {
          id: provider.id,
          label: provider.label,
          status: 'ok',
          count: works.length,
          ms: Date.now() - started,
          works,
        };
      } catch (err) {
        return {
          id: provider.id,
          label: provider.label,
          status: err && err.status === 429 ? 'rate-limited' : 'error',
          count: 0,
          ms: Date.now() - started,
          error: (err && err.message) || String(err),
          works: [],
        };
      }
    })
  );

  const outcomes = settled.map((entry, index) =>
    entry.status === 'fulfilled'
      ? entry.value
      : {
          id: providers[index].id,
          label: providers[index].label,
          status: 'error',
          count: 0,
          ms: 0,
          error: String(entry.reason),
          works: [],
        }
  );

  const merged = mergeWorks(outcomes.map((o) => o.works)).map((work) => ({
    ...work,
    evidence: classify(work),
  }));

  const ranked = rankWorks(merged, terms, {
    minRelevance: Number(settings.get('research.min_relevance')) || 0.25,
    strongRelevance: Number(settings.get('research.strong_relevance')) || 0.45,
    maxResults: settings.getNumber('research.max_results', 8),
    minResults: settings.getNumber('research.min_results', 3),
  });

  const failed = outcomes.filter((o) => o.status !== 'ok');
  const notes = [ranked.note].filter(Boolean);
  if (failed.length) {
    notes.push(
      `${failed.length} of ${outcomes.length} databases did not answer: ` +
        failed.map((f) => `${f.label} (${f.status})`).join(', ')
    );
  }

  return {
    terms,
    term_detail: detail,
    results: ranked.results.map(presentable),
    providers: outcomes.map(({ works, ...rest }) => rest),
    considered: ranked.considered,
    no_strong_matches: ranked.no_strong_matches,
    note: notes.length ? notes.join(' ') : null,
  };
}

/**
 * Cached entry point used by the API. Pass { refresh: true } to re-query.
 */
async function matchItem(itemId, options = {}) {
  const item = items.get(itemId);
  if (!item) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }

  const cacheHours = settings.getNumber('research.cache_hours', 168);
  if (!options.refresh) {
    const cached = store.getFresh(itemId, cacheHours);
    if (cached) return { ...cached, item, cached: true };
  }

  const match = await runMatch(item, options);
  const saved = store.save(itemId, match);
  return { ...saved, term_detail: match.term_detail, item, cached: false };
}

module.exports = {
  matchItem,
  runMatch,
  PROVIDERS,
  enabledProviders,
  snippet,
  resetRateLimiter: clientLayer.resetForTests,
};
