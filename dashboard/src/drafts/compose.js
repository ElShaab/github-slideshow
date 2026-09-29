'use strict';

const settings = require('../lib/settings');
const { extractConclusion } = require('./conclusions');

/**
 * Builds a draft reply from what is already in the database. No model, no
 * network, no key.
 *
 * The rule the whole thing rests on: every word about a study is copied from
 * that study's stored abstract, verbatim and in quotation marks. Nothing here
 * paraphrases a finding, because a paraphrase produced by string handling
 * would be a claim nobody checked. What the reply actually argues is left
 * blank for the physician to write.
 */

const RULE_NOTE = {
  labelled: 'Conclusion, quoted from the abstract',
  cue: 'Conclusion, quoted from the abstract',
  tail: 'Last lines of the abstract, quoted (no conclusion section was labelled)',
};

const DIVIDER = '─'.repeat(56);
const BLANK_MARKER = '[ WRITE YOUR REPLY HERE ]';

function opening() {
  return String(settings.get('draft.opening') || '').trim();
}

function closing() {
  return String(settings.get('draft.closing') || '').trim();
}

const SOURCE_NAMES = {
  reddit: 'Reddit',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  feeds: 'Feed',
  websearch: 'Web',
  pubmed: 'PubMed',
  literature: 'Research sweep',
};

/** Source · origin · author · date, as one line. */
function attribution(item) {
  const when = item.timestamp ? String(item.timestamp).slice(0, 10) : null;
  const where = SOURCE_NAMES[item.source] || item.source;
  return [where, item.origin, item.author, when].filter(Boolean).join(' · ');
}

function questionBlock(item) {
  const lines = ['QUESTION', attribution(item)];
  if (item.url) lines.push(item.url);
  lines.push('');
  // Verbatim, in full: an abridged question is easy to answer wrongly.
  lines.push(`"${String(item.text || '').trim()}"`);
  return lines.join('\n');
}

function paperHeading(work, index) {
  const facts = [
    work.venue,
    work.year ? String(work.year) : null,
    work.evidence ? work.evidence.label : null,
    work.evidence && work.evidence.preprint ? 'preprint, not peer reviewed' : null,
    work.open_access === true ? 'open access' : null,
  ].filter(Boolean);

  const lines = [`[${index + 1}] ${work.title || 'Untitled'}`, `    ${facts.join(' · ')}`];
  const link = work.url || (work.doi ? `https://doi.org/${work.doi}` : null);
  if (link) lines.push(`    ${link}`);
  return lines.join('\n');
}

/** The quoted conclusion, or an honest line about why there is none. */
function paperEvidence(work) {
  if (work.registry) {
    return (
      `    Trial registration${work.status ? `, status ${String(work.status).toLowerCase()}` : ''}` +
      ' — planned or under way, with no published results to quote.'
    );
  }

  const abstract = work.abstract || work.snippet || '';
  const found = extractConclusion(abstract);
  if (!found) {
    return '    No abstract was stored for this paper — read it before citing it.';
  }

  // The stored abstract can itself be an extract (a search snippet, or a
  // provider that returns the opening only). Say so rather than letting the
  // trailing ellipsis pass for the author's own punctuation.
  const abridged = /(?:\u2026|\.\.\.)\s*$/.test(found.text);
  const note = `${RULE_NOTE[found.rule]}${abridged ? '; the stored abstract is itself abridged' : ''}`;

  return [`    ${note}:`, `    "${found.text}"`].join('\n');
}

function evidenceBlock(results) {
  if (!results.length) {
    return [
      'EVIDENCE',
      'No papers were ticked, so this draft cites nothing. Match the research',
      'first if you mean to cite any.',
    ].join('\n');
  }

  const header =
    `EVIDENCE — ${results.length} paper${results.length === 1 ? '' : 's'}. ` +
    'Reference material: delete this block before posting.';

  const papers = results.map(
    (work, index) => `${paperHeading(work, index)}\n${paperEvidence(work)}`
  );
  return [header, '', papers.join('\n\n')].join('\n');
}

function replyBlock() {
  const parts = [DIVIDER, 'REPLY — everything below this line is what you post.', DIVIDER, ''];
  const open = opening();
  if (open) parts.push(open, '');
  parts.push(BLANK_MARKER, '');
  const close = closing();
  if (close) parts.push(close);
  return parts.join('\n');
}

/** The studies handed over, stored so the citation numbers stay resolvable. */
function citationList(results) {
  return results.map((work, index) => ({
    n: index + 1,
    title: work.title,
    venue: work.venue,
    year: work.year,
    url: work.url,
    doi: work.doi || null,
    evidence: work.evidence ? work.evidence.label : null,
    registry: !!work.registry,
    sources: work.sources || [],
  }));
}

/**
 * Returns the same shape the drafts table expects, so a composed draft is
 * edited, saved, copied and posted exactly like any other.
 */
function composeDraft({ item, match }) {
  const results = (match && match.results) || [];
  const quoted = results.filter(
    (work) => !work.registry && extractConclusion(work.abstract || work.snippet || '')
  ).length;

  const content = [questionBlock(item), '', evidenceBlock(results), '', replyBlock()].join('\n');

  return {
    content,
    model: null,
    usage: {
      composed: true,
      papers: results.length,
      quoted,
      no_strong_matches: !!(match && match.no_strong_matches),
    },
    citations: citationList(results),
  };
}

module.exports = { composeDraft, BLANK_MARKER, DIVIDER };
