'use strict';

/** Deduplication and merging of works returned by several APIs. */

function normalizeDoi(raw) {
  if (!raw) return null;
  const doi = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
  return /^10\.\d{4,9}\//.test(doi) ? doi : null;
}

function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
  return set;
}

/** Sorensen-Dice coefficient over character bigrams: 0 (nothing) to 1 (same). */
function similarity(a, b) {
  const left = titleKey(a);
  const right = titleKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const first = bigrams(left);
  const second = bigrams(right);
  if (!first.size || !second.size) return 0;
  let shared = 0;
  for (const gram of first) if (second.has(gram)) shared += 1;
  return (2 * shared) / (first.size + second.size);
}

const FUZZY_THRESHOLD = 0.9;

/** Words that carry no identity in a title, so differing on them is harmless. */
const TITLE_FILLER = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'its', 'their', 'our', 'via',
  'versus', 'among', 'between', 'within', 'after', 'about', 'how', 'what',
]);

/** A title's content words, plural folded, so "system" and "systems" agree. */
function contentTokens(title) {
  return new Set(
    titleKey(title)
      .split(' ')
      .filter((token) => token.length > 2 && !TITLE_FILLER.has(token))
      .map((token) => token.replace(/s$/, ''))
  );
}

/**
 * Whether two titles name the same work.
 *
 * Character similarity alone is not enough. "Transtibial prosthesis
 * suspension systems: systematic review of literature" and "Transfemoral
 * prosthesis suspension systems: a systematic review of the literature" are
 * two different papers - same group, same year - and score 0.904, over the
 * threshold. Merging them pinned one paper's abstract to the other's title,
 * a citation that is simply false. So titles that are close must also agree
 * on every content word; a word in one and not the other (transtibial,
 * transfemoral, upper, lower, children) means two works. A duplicate costs a
 * line in a list. A conflation costs a wrong citation.
 */
function sameWork(a, b) {
  if (similarity(a, b) < FUZZY_THRESHOLD) return false;
  const left = contentTokens(a);
  const right = contentTokens(b);
  for (const token of left) if (!right.has(token)) return false;
  for (const token of right) if (!left.has(token)) return false;
  return true;
}

function pickLonger(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(b).length > String(a).length ? b : a;
}

/** Prefers the more precise date: a full day beats a bare year. */
function bestDate(a, b) {
  const score = (value) => {
    if (!value) return 0;
    const text = String(value);
    if (Number.isNaN(new Date(text).getTime())) return 0;
    return text.length;
  };
  return score(b) > score(a) ? b : a || b || null;
}

function maxNumber(a, b) {
  if (typeof a !== 'number') return typeof b === 'number' ? b : null;
  if (typeof b !== 'number') return a;
  return Math.max(a, b);
}

function mergeInto(target, incoming) {
  target.sources = [...new Set([...target.sources, ...incoming.sources])];
  target.doi = target.doi || incoming.doi;
  target.pmid = target.pmid || incoming.pmid;
  target.nct_id = target.nct_id || incoming.nct_id;
  target.title = pickLonger(target.title, incoming.title);
  target.abstract = pickLonger(target.abstract, incoming.abstract);
  target.venue = target.venue || incoming.venue;
  target.year = target.year || incoming.year;
  // One database often carries a full publication date where another has
  // only the year; keep the better of the two.
  target.published_on = bestDate(target.published_on, incoming.published_on);
  target.url = target.url || incoming.url;
  target.authors = target.authors || incoming.authors;
  target.citations = maxNumber(target.citations, incoming.citations);
  // Open access is a positive claim: one API saying yes outweighs another
  // having no opinion, but neither invents a "no".
  if (incoming.open_access === true) target.open_access = true;
  else if (target.open_access === null || target.open_access === undefined) {
    target.open_access = incoming.open_access;
  }
  target.open_access_url = target.open_access_url || incoming.open_access_url;
  target.publication_types = [
    ...new Set([...(target.publication_types || []), ...(incoming.publication_types || [])]),
  ];
  target.type = target.type || incoming.type;
  target.preprint = target.preprint || incoming.preprint;
  target.registry = target.registry || incoming.registry;
  target.per_source = { ...(target.per_source || {}), ...(incoming.per_source || {}) };
  return target;
}

/**
 * Merge works from every provider into one list, deduplicating by DOI, then by
 * PMID / NCT id, then by near-identical title.
 */
function mergeWorks(lists) {
  const merged = [];
  const byDoi = new Map();
  const byId = new Map();

  for (const work of lists.flat()) {
    if (!work || !work.title) continue;
    const entry = {
      ...work,
      doi: normalizeDoi(work.doi),
      sources: [work.source],
      per_source: { [work.source]: work.source_url || work.url || null },
    };

    const idKeys = [
      entry.pmid ? `pmid:${entry.pmid}` : null,
      entry.nct_id ? `nct:${String(entry.nct_id).toUpperCase()}` : null,
    ].filter(Boolean);

    let existing = entry.doi ? byDoi.get(entry.doi) : null;
    if (!existing) {
      for (const key of idKeys) {
        if (byId.has(key)) {
          existing = byId.get(key);
          break;
        }
      }
    }
    if (!existing) {
      existing = merged.find(
        (candidate) =>
          // A registered trial and a published paper are different records
          // even when their titles match.
          !!candidate.registry === !!entry.registry &&
          sameWork(candidate.title, entry.title)
      );
    }

    if (existing) {
      mergeInto(existing, entry);
      if (existing.doi && !byDoi.has(existing.doi)) byDoi.set(existing.doi, existing);
      for (const key of idKeys) byId.set(key, existing);
      continue;
    }

    merged.push(entry);
    if (entry.doi) byDoi.set(entry.doi, entry);
    for (const key of idKeys) byId.set(key, entry);
  }

  return merged;
}

module.exports = {
  mergeWorks,
  normalizeDoi,
  similarity,
  sameWork,
  titleKey,
  bestDate,
  FUZZY_THRESHOLD,
};
