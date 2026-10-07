'use strict';

/**
 * What a poll fetched but no keyword matched.
 *
 * Unmatched posts are deliberately kept out of the dedup ledger so a keyword
 * added later can still catch them. This holds the most recent ones per
 * source, in memory, for two jobs:
 *
 *  - showing the physician what the sources actually returned, and which
 *    words keep turning up in it, so the keyword gap is visible instead of
 *    looking like a dead source;
 *  - re-weighing them the moment a keyword is added, so a new term reaches
 *    back into what was already fetched without waiting for the next poll.
 *
 * Memory only, and bounded: it is a working set, not a record. A restart
 * empties it and the next poll refills it.
 */

const { STOPWORDS, ABBREVIATIONS, DOMAIN_TOKENS, normalizeText, tokenize } = require('../research/terms');

const MAX_PER_SOURCE = 150;
const buffers = new Map();

/** Chatty words that fill forum posts but make useless keywords. */
const CONVERSATIONAL = new Set([
  'anyone', 'someone', 'everyone', 'anybody', 'really', 'just', 'know', 'like',
  'get', 'got', 'getting', 'feel', 'feels', 'felt', 'feeling', 'think', 'thing',
  'things', 'going', 'want', 'wanted', 'need', 'needs', 'also', 'even', 'still',
  'much', 'many', 'lot', 'lots', 'today', 'year', 'years', 'day', 'days', 'week',
  'weeks', 'month', 'months', 'time', 'times', 'good', 'bad', 'better', 'best',
  'people', 'help', 'thanks', 'thank', 'question', 'post', 'reddit', 'edit',
  'update', 'back', 'way', 'make', 'made', 'see', 'said', 'say', 'use', 'used',
  'using', 'try', 'tried', 'trying', 'work', 'works', 'worked', 'new', 'first',
  'last', 'long', 'little', 'right', 'left', 'ago', 'since', 'around', 'always',
  'never', 'every', 'something', 'anything', 'everything', 'nothing', 'pretty',
  'sure', 'maybe', 'probably', 'actually', 'though', 'already', 'yet', 'next',
  'come', 'came', 'go', 'went', 'take', 'took', 'look', 'looking', 'looks',
  'well', 'great', 'thought', 'thoughts', 'advice', 'experience', 'experiences',
  'anyone-else', 'else', 'hey', 'hello', 'hi', 'guys', 'yeah', 'lol', 'deleted',
  'removed', 'comment', 'comments', 'thread', 'sub', 'subreddit',
  // Number words and the verbs that carry a sentence without naming anything.
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'twenty', 'thirty', 'hundred', 'second', 'third',
  'keep', 'keeps', 'kept', 'start', 'starts', 'started', 'makes', 'doing',
  'done', 'does', 'gets', 'goes', 'happen', 'happens', 'happened', 'whole',
  'normal', 'inside', 'outside', 'there', 'other', 'others', 'another',
]);

/** Everyday words must recur more than clinical vocabulary to be offered. */
const MIN_POSTS = { domain: 2, other: 3 };

function bufferFor(source) {
  if (!buffers.has(source)) buffers.set(source, new Map());
  return buffers.get(source);
}

/** Called by ingest for each candidate that matched nothing. */
function record(source, candidate) {
  const id = String(candidate.external_id || '').trim();
  if (!id) return;
  const buffer = bufferFor(source);
  // Re-insert so a post seen again moves to the newest end.
  buffer.delete(id);
  buffer.set(id, { ...candidate, external_id: id, missed_at: Date.now() });
  while (buffer.size > MAX_PER_SOURCE) {
    buffer.delete(buffer.keys().next().value);
  }
}

/** Called by ingest when a candidate is captured, so it leaves the list. */
function forget(source, externalId) {
  const buffer = buffers.get(source);
  if (buffer) buffer.delete(String(externalId));
}

function recent(sources) {
  const out = [];
  for (const source of sources) {
    const buffer = buffers.get(source);
    if (!buffer) continue;
    for (const candidate of buffer.values()) out.push({ source, ...candidate });
  }
  return out.sort((a, b) => b.missed_at - a.missed_at);
}

function isDomainish(token) {
  return DOMAIN_TOKENS.has(token) || Object.prototype.hasOwnProperty.call(ABBREVIATIONS, token);
}

function useful(token) {
  return token && !STOPWORDS.has(token) && !CONVERSATIONAL.has(token);
}

/** Up to ~140 characters around the first use of a term, for context. */
function excerpt(text, term) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(term);
  if (at === -1) return flat.slice(0, 140);
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, at + term.length + 80);
  return `${start ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/**
 * The words and pairs that keep turning up in what was missed, ranked by how
 * many posts carry them - not raw counts, so one long post cannot dominate.
 * Domain vocabulary ranks above everyday words, and anything already tracked
 * is left out.
 */
function suggest(posts, trackedTerms, { limit = 12 } = {}) {
  const tracked = new Set(trackedTerms.map((t) => String(t).toLowerCase().trim()));
  const counts = new Map();

  for (const post of posts) {
    const tokens = tokenize(normalizeText(post.text)).filter(useful);
    const inPost = new Set();

    for (const token of tokens) {
      if (isDomainish(token) || token.length > 4) inPost.add(token);
    }
    // Adjacent pairs, kept only when one half is clinical vocabulary.
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (a !== b && (isDomainish(a) || isDomainish(b))) inPost.add(`${a} ${b}`);
    }

    for (const term of inPost) {
      if (tracked.has(term)) continue;
      const entry = counts.get(term) || { term, posts: 0, sample: null };
      entry.posts += 1;
      if (!entry.sample) entry.sample = excerpt(post.text, term);
      counts.set(term, entry);
    }
  }

  return [...counts.values()]
    .map((entry) => ({
      ...entry,
      domain: entry.term.split(' ').some(isDomainish),
    }))
    .filter((entry) => entry.posts >= (entry.domain ? MIN_POSTS.domain : MIN_POSTS.other))
    .sort(
      (a, b) =>
        // Clinical vocabulary first, then by reach, then pairs over singles
        // at equal reach since they are more specific.
        Number(b.domain) - Number(a.domain) ||
        b.posts - a.posts ||
        b.term.split(' ').length - a.term.split(' ').length ||
        a.term.localeCompare(b.term)
    )
    .slice(0, limit);
}

/**
 * Re-weighs everything held against the current keyword list, so a keyword
 * added now captures what earlier polls already fetched.
 */
function recheck() {
  // Required here rather than at the top: ingest records into this module.
  const { ingest } = require('./ingest');
  const { matcherFor } = require('./matcher');

  const result = { added: 0, bySource: {} };
  for (const [source, buffer] of buffers) {
    if (!buffer.size) continue;
    const candidates = [...buffer.values()];
    const stats = ingest(source, candidates, matcherFor(source));
    if (stats.added) {
      result.bySource[source] = stats.added;
      result.added += stats.added;
    }
  }
  return result;
}

function clear() {
  buffers.clear();
}

module.exports = { record, forget, recent, suggest, recheck, clear, MAX_PER_SOURCE };
