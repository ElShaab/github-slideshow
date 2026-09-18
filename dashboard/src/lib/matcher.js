'use strict';

const keywordsRepo = require('./keywords');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive matcher for a term. Multi-word phrases tolerate any
 * run of whitespace between words; word boundaries keep "ak" from matching
 * inside "make".
 */
function buildPattern(term) {
  const tokens = term.trim().split(/\s+/).map(escapeRegExp);
  let body = tokens.join('\\s+');
  if (/^[\w]/.test(term)) body = `\\b${body}`;
  if (/[\w]$/.test(term)) body = `${body}\\b`;
  return new RegExp(body, 'i');
}

function compile(keywords) {
  return keywords.map((k) => ({ keyword: k, pattern: buildPattern(k.term) }));
}

/**
 * @returns {Array<{id:number|null, term:string}>} every keyword found in text.
 */
function matchAll(text, compiled) {
  if (!text) return [];
  const hits = [];
  for (const { keyword, pattern } of compiled) {
    if (pattern.test(text)) hits.push({ id: keyword.id, term: keyword.term });
  }
  return hits;
}

/** Convenience wrapper that reads the live keyword list for a source. */
function matcherFor(source) {
  const compiled = compile(keywordsRepo.forSource(source));
  return {
    keywords: compiled.map((c) => c.keyword),
    match: (text) => matchAll(text, compiled),
    isEmpty: compiled.length === 0,
  };
}

module.exports = { buildPattern, compile, matchAll, matcherFor, escapeRegExp };
