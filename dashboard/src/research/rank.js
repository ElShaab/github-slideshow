'use strict';

const { classify } = require('./evidence');

/**
 * How well a work answers the question, from term overlap. Title hits count
 * more than abstract hits, and multi-word phrases more than single words.
 * Returns 0..1.
 */
function relevance(work, terms) {
  if (!terms || !terms.length) return 0;
  const title = String(work.title || '').toLowerCase();
  const abstract = String(work.abstract || '').toLowerCase();
  const venue = String(work.venue || '').toLowerCase();

  let got = 0;
  let possible = 0;
  for (const term of terms) {
    const weight = term.includes(' ') ? 1.5 : 1;
    possible += weight;
    if (title.includes(term)) got += weight;
    else if (abstract.includes(term)) got += weight * 0.6;
    else if (venue.includes(term)) got += weight * 0.3;
    else {
      // Partial credit when most words of a phrase are present.
      const words = term.split(' ').filter((w) => w.length > 3);
      if (words.length > 1) {
        const hits = words.filter(
          (word) => title.includes(word) || abstract.includes(word)
        ).length;
        got += weight * 0.5 * (hits / words.length);
      }
    }
  }
  return possible ? Math.min(1, got / possible) : 0;
}

function recencyPoints(year, now = new Date()) {
  if (!year) return 0;
  const age = now.getFullYear() - Number(year);
  if (!Number.isFinite(age)) return 0;
  if (age < 0) return 40;
  return Math.max(0, 40 - age * 4);
}

function citationPoints(citations) {
  if (typeof citations !== 'number' || citations <= 0) return 0;
  return Math.min(40, Math.log10(1 + citations) * 13);
}

/**
 * Evidence quality dominates: its weight is multiplied by 1000, so no amount
 * of recency or citation count lifts a case report above a systematic review.
 * Recency and citations break ties within a level.
 */
function score(work, terms, now = new Date()) {
  const evidence = work.evidence || classify(work);
  const rel = relevance(work, terms);
  return {
    evidence,
    relevance: rel,
    recency: recencyPoints(work.year, now),
    citation_points: citationPoints(work.citations),
    score:
      evidence.weight * 1000 +
      recencyPoints(work.year, now) +
      citationPoints(work.citations) +
      rel * 50,
  };
}

/**
 * Grade, filter and order merged works.
 *
 * Anything below `minRelevance` is dropped rather than padded into the result
 * list - a weak match presented as evidence is worse than saying nothing.
 */
function rankWorks(works, terms, options = {}) {
  const minRelevance = options.minRelevance === undefined ? 0.25 : options.minRelevance;
  // "Strong" is an absolute bar - how much of the question a paper actually
  // covers - not a function of the display threshold, so lowering
  // minRelevance to see more never makes weak matches look confident.
  const strongRelevance =
    options.strongRelevance === undefined ? 0.45 : options.strongRelevance;
  const maxResults = Math.max(Number(options.maxResults) || 8, 1);
  const minResults = Math.max(Number(options.minResults) || 3, 1);
  const now = options.now || new Date();

  const graded = works.map((work) => {
    const scored = score(work, terms, now);
    return { ...work, ...scored };
  });

  const relevant = graded
    .filter((work) => work.relevance >= minRelevance)
    .sort((a, b) => b.score - a.score);

  const top = relevant.slice(0, maxResults);
  const strong =
    top.length >= Math.min(minResults, 1) &&
    top.some((work) => work.relevance >= strongRelevance);

  return {
    results: top,
    considered: graded.length,
    no_strong_matches: !top.length || !strong,
    note: !top.length
      ? 'No results from any database matched this question closely enough to show.'
      : !strong
        ? 'Only weak matches were found - treat these as background reading, not an answer.'
        : null,
  };
}

module.exports = { rankWorks, relevance, score, recencyPoints, citationPoints };
