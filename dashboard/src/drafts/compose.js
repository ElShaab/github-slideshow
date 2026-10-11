'use strict';

const settings = require('../lib/settings');
const { extractConclusion } = require('./conclusions');

/**
 * Builds a reply that can be posted as it stands, from what is already in the
 * database. No model, no network, no key.
 *
 * The text box holds only the reply: an optional opening line, what the
 * ticked research concluded, and a closing line. The working material - the
 * question, every ticked paper, what each one concluded and why any was left
 * out - travels with the draft as its citations and is shown beneath it, so
 * it informs the reply without having to be deleted from it.
 *
 * One rule is kept from the start: nothing about a study is written here.
 * Each finding appears inside quotation marks, copied from that study's own
 * abstract as a contiguous run of its text. The words around a quote say only
 * what kind of study it was and when, which the metadata states outright.
 */

/**
 * How many papers a reply quotes: one by default, because the reply is meant
 * to be short. Two is allowed for a question where a second source genuinely
 * adds something; the rest stay listed beneath the draft.
 */
const MAX_QUOTED = 2;

function quoteCount() {
  const n = Number(settings.get('draft.max_quoted'));
  return n === 2 ? 2 : 1;
}
/**
 * A quote is cut on a sentence boundary under this length, never mid-sentence.
 * Two conclusion sentences is the norm, and the second is often the useful one.
 */
const QUOTE_SOFT_LIMIT = 420;

/** Plain names for study designs, keyed by the grader's `kind`. */
const DESIGN = {
  'systematic-review': 'systematic review',
  guideline: 'clinical guideline',
  rct: 'randomized trial',
  trial: 'clinical trial',
  cohort: 'cohort study',
  observational: 'observational study',
  'case-report': 'case report',
  narrative: 'review',
  preclinical: 'lab study',
  preprint: 'preprint (not yet peer reviewed)',
  unclassified: 'study',
};

/** Openings that start a sentence but carry no content of their own. */
const DISCOURSE_MARKER =
  /^(?:in summary|in conclusion|to conclude|to summarize|in short|overall|taken together|collectively|thus|therefore|hence)\s*,?\s+/i;

function opening() {
  return String(settings.get('draft.opening') || '').trim();
}

/**
 * A question gets the closing line; someone sharing how something went gets
 * its own, empty unless set, since pointing a happy post back to its care
 * team reads as a lecture.
 */
function closing(question) {
  const key = question ? 'draft.closing' : 'draft.closing_share';
  return String(settings.get(key) || '').trim();
}

/** A question, or someone sharing how something went? */
function isQuestion(text) {
  const t = String(text || '');
  return (
    /\?/.test(t) ||
    /^\s*(?:how|what|why|when|which|who|does|do|is|are|can|could|should|would|will|has|have|did|anyone|any tips|any advice)\b/i.test(
      t
    )
  );
}

function designOf(work) {
  const evidence = work.evidence || {};
  if (evidence.kind && DESIGN[evidence.kind]) {
    if (evidence.preprint && evidence.kind !== 'preprint') {
      return `${DESIGN[evidence.kind]} (a preprint, not yet peer reviewed)`;
    }
    return DESIGN[evidence.kind];
  }
  const label = String(evidence.label || '').toLowerCase();
  if (label.includes('systematic')) return 'systematic review';
  if (label.includes('randomized')) return 'randomized trial';
  if (label.includes('cohort')) return 'cohort study';
  if (label.includes('observational')) return 'observational study';
  if (label.includes('preprint')) return 'preprint (not yet peer reviewed)';
  return 'study';
}

/** "a 2014 systematic review", "an observational study". */
function describe(work) {
  const design = designOf(work);
  const phrase = work.year ? `${work.year} ${design}` : design;
  return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

function linkOf(work) {
  if (work.doi) return `https://doi.org/${work.doi}`;
  return work.url || null;
}

/**
 * A sentence that ends anywhere but on a full stop, question mark or
 * exclamation mark - optionally inside a closing quote or bracket - was cut
 * off, by the provider or by an old cache. Such a quote misrepresents the
 * paper, so it is never put in a reply.
 */
function endsCleanly(text) {
  return /[.!?]["'”’)\]]*$/.test(String(text || '').trim());
}

/**
 * Works out whether and how a paper can be quoted. Returns either
 * { usable: true, quote, verb, rule } or { usable: false, reason }.
 */
function assess(work) {
  if (work.registry) {
    return {
      usable: false,
      reason: `Trial registration${work.status ? `, ${String(work.status).toLowerCase()}` : ''} — no published results to quote.`,
    };
  }
  const abstract = work.abstract || '';
  if (!abstract.trim()) {
    return { usable: false, reason: 'No abstract is stored for this paper — read it before citing it.' };
  }

  const found = extractConclusion(abstract, { maxSentences: 2, softLimit: QUOTE_SOFT_LIMIT });
  if (!found) {
    return { usable: false, reason: 'No conclusion could be found in the stored abstract.' };
  }
  if (!endsCleanly(found.text)) {
    return {
      usable: false,
      reason:
        'The stored abstract is cut off before its conclusion ends. Press Re-run on the research to fetch it again.',
      quote: found.text,
      rule: found.rule,
    };
  }

  // Drop a leading "In summary," so the quote reads as a finding. What is
  // left is still a contiguous run of the abstract's own text. Quotation marks
  // inside it become single quotes, the usual convention for a quote within a
  // quote, so the reply does not read as a jumble of double marks.
  const quote = found.text
    .replace(DISCOURSE_MARKER, '')
    .replace(/["\u201c\u201d]([^"\u201c\u201d]*)["\u201c\u201d]/g, '\u2018$1\u2019');
  return {
    usable: true,
    quote,
    rule: found.rule,
    // The last lines of an unstructured abstract are usually its conclusion,
    // but not always - so they are "reported", not "concluded".
    verb: found.rule === 'tail' ? 'reported' : 'concluded',
  };
}

/** `a 2014 systematic review concluded: "…" https://doi.org/…` */
function quotedSentence(work, assessment, { first }) {
  const who = first ? describe(work) : `another, ${describe(work)},`;
  const link = linkOf(work);
  return `${who} ${assessment.verb}: "${assessment.quote}"${link ? ` ${link}` : ''}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function researchParagraphs(item, usable, noStrongMatches) {
  if (!usable.length) {
    return [
      "There isn't much published research that answers this directly yet, so experience from people who've been through it is genuinely useful here.",
    ];
  }

  const sentences = usable.map(({ work, assessment }, index) =>
    quotedSentence(work, assessment, { first: index === 0 })
  );

  // Someone sharing how something went is not asking, so the research is
  // offered to whoever reads the thread rather than as an answer to them.
  if (!isQuestion(item.text)) {
    sentences[0] = `For anyone weighing this up, ${sentences[0]}`;
  } else if (noStrongMatches) {
    sentences[0] = `The research on this is thin, but the closest I found is ${sentences[0].replace(
      / (concluded|reported):/,
      ', which $1:'
    )}`;
  } else {
    sentences[0] = capitalize(sentences[0]);
  }
  return sentences.map((sentence, index) => (index === 0 ? sentence : capitalize(sentence)));
}

/** Everything ticked, with what happened to each, for the reference panel. */
function citationList(results, assessments) {
  return results.map((work, index) => {
    const assessment = assessments[index];
    return {
      n: index + 1,
      title: work.title,
      venue: work.venue,
      year: work.year,
      url: linkOf(work),
      doi: work.doi || null,
      evidence: work.evidence ? work.evidence.label : null,
      registry: !!work.registry,
      sources: work.sources || [],
      quoted: !!assessment.inReply,
      quote: assessment.quote || null,
      rule: assessment.rule || null,
      note: assessment.inReply
        ? null
        : assessment.reason ||
          'Ticked, but the reply quotes only the strongest paper. Untick the one above to quote this instead, or allow two in Snippets.',
    };
  });
}

/**
 * Returns the shape the drafts table expects, so a built draft is edited,
 * saved, copied and posted exactly like any other.
 */
function composeDraft({ item, match }) {
  const results = (match && match.results) || [];
  const assessments = results.map(assess);

  const limit = quoteCount();
  const usable = [];
  results.forEach((work, index) => {
    if (assessments[index].usable && usable.length < limit) {
      assessments[index].inReply = true;
      usable.push({ work, assessment: assessments[index] });
    }
  });

  const parts = [];
  const open = opening();
  if (open) parts.push(open);
  parts.push(...researchParagraphs(item, usable, !!(match && match.no_strong_matches)));
  const close = closing(isQuestion(item.text));
  if (close) parts.push(close);

  return {
    content: parts.join('\n\n'),
    model: null,
    usage: {
      composed: true,
      papers: results.length,
      quoted: usable.length,
      question: isQuestion(item.text),
      no_strong_matches: !!(match && match.no_strong_matches),
    },
    citations: citationList(results, assessments),
  };
}

module.exports = { composeDraft, isQuestion, describe, endsCleanly, MAX_QUOTED };
