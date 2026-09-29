'use strict';

/**
 * Pulls the conclusion out of a stored abstract, verbatim.
 *
 * Nothing here rewrites, summarizes or paraphrases: every character returned
 * is copied from the abstract as the database holds it. Where the conclusion
 * cannot be located confidently the last sentences are returned and the
 * caller is told which rule fired, so a draft never implies more precision
 * than the extraction actually had.
 */

/** Headings that introduce a conclusion in a structured abstract. */
const CONCLUSION_HEADING =
  /\b(conclusions? and relevance|conclusions? and implications?|conclusions?|interpretation|clinical relevance|clinical implications?)\b\s*[:.–—-]?\s+/gi;

/** Headings that end one: whatever follows belongs to another section. */
const FOLLOWING_HEADING =
  /\b(funding|trial registration|registration|keywords?|level of evidence|acknowledgements?|conflicts? of interest|disclosures?|copyright|systematic review registration)\b\s*[:.–—-]?\s+/i;

/** Sentence openings that mark a conclusion in an unstructured abstract. */
const CONCLUSION_CUE =
  /^\s*(?:in conclusion|we conclude|to conclude|taken together|overall,|in summary|these (?:findings|results|data|observations) (?:suggest|indicate|show|support)|this (?:study|trial|review|analysis|meta-analysis) (?:suggests|shows|indicates|supports|demonstrates|found))/i;

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'vs', 'cf', 'approx', 'fig', 'figs', 'tab', 'no', 'nos', 'ca',
  'resp', 'et al', 'al', 'dr', 'prof', 'mr', 'mrs', 'ms', 'st', 'jr', 'sr',
  'inc', 'ltd', 'co', 'etc', 'min', 'max', 'sd', 'se', 'ci', 'iqr', 'yr', 'yrs',
  'mo', 'wk', 'hr', 'mg', 'ml', 'kg', 'cm', 'mm', 'u.s', 'u.k',
]);

function endsWithAbbreviation(fragment) {
  const trimmed = fragment.trimEnd();
  if (!trimmed.endsWith('.')) return false;
  const tail = trimmed.slice(0, -1);
  // A lone initial ("R. Smith") or a known abbreviation.
  if (/(?:^|[\s(])[A-Za-z]$/.test(tail)) return true;
  const word = (tail.match(/[A-Za-z.]+$/) || [''])[0].toLowerCase();
  if (ABBREVIATIONS.has(word)) return true;
  // "et al." arrives as two fragments; check the last two words too.
  const pair = (tail.match(/[A-Za-z]+\s+[A-Za-z]+$/) || [''])[0].toLowerCase();
  return ABBREVIATIONS.has(pair);
}

/**
 * Splits prose into sentences without breaking on abbreviations, initials or
 * decimals. Decimals are safe by construction: the split needs whitespace
 * after the stop.
 */
function sentences(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];

  const parts = raw.split(/(?<=[.!?])\s+(?=[A-Z0-9(\["'“])/);
  const out = [];
  for (const part of parts) {
    if (out.length && endsWithAbbreviation(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1]} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Text after the last conclusion heading, up to the next section. */
function labelledConclusion(abstract) {
  const text = String(abstract || '');
  let last = null;
  CONCLUSION_HEADING.lastIndex = 0;
  for (let m = CONCLUSION_HEADING.exec(text); m; m = CONCLUSION_HEADING.exec(text)) {
    // A heading is a heading, not the word used mid-sentence: it either
    // starts the abstract, follows a sentence end, or carries a colon.
    const before = text.slice(Math.max(0, m.index - 2), m.index);
    const isHeading = m.index === 0 || /[.;\n]\s?$/.test(before) || /:/.test(m[0]);
    if (isHeading) last = m;
  }
  if (!last) return null;

  let rest = text.slice(last.index + last[0].length).trim();
  const next = rest.match(FOLLOWING_HEADING);
  if (next && next.index > 0) rest = rest.slice(0, next.index).trim();
  return rest || null;
}

/** From the first cue sentence to the end of the abstract. */
function cuedConclusion(list) {
  const start = list.findIndex((sentence) => CONCLUSION_CUE.test(sentence));
  return start === -1 ? null : list.slice(start);
}

/**
 * Returns { text, rule, sentences } where text is verbatim from the abstract.
 * `rule` says how it was found, so the UI can be honest about confidence.
 */
function extractConclusion(abstract, { maxSentences = 3, softLimit = 700 } = {}) {
  const whole = String(abstract || '').trim();
  if (!whole) return null;

  const labelled = labelledConclusion(whole);
  let picked = null;
  let rule = null;

  if (labelled) {
    picked = sentences(labelled);
    rule = 'labelled';
  } else {
    const all = sentences(whole);
    const cued = cuedConclusion(all);
    if (cued) {
      picked = cued;
      rule = 'cue';
    } else {
      picked = all.slice(-2);
      rule = 'tail';
    }
  }

  if (!picked || !picked.length) return null;

  // Cap the length, but never mid-sentence: a truncated quote is not verbatim.
  const kept = [];
  for (const sentence of picked) {
    if (kept.length >= maxSentences) break;
    if (kept.length && kept.join(' ').length + sentence.length > softLimit) break;
    kept.push(sentence);
  }

  return {
    text: kept.join(' '),
    rule,
    sentences: kept.length,
    truncated: kept.length < picked.length,
  };
}

module.exports = { extractConclusion, sentences, labelledConclusion };
