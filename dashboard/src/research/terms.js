'use strict';

/**
 * Turns a community question into a handful of search terms.
 *
 * Forum posts are conversational ("six weeks post-op and the phantom pain is
 * unbearable, did mirror therapy help anyone?"), so a raw full-text query
 * returns noise from every literature API. This pulls out the clinical
 * substance: the keywords the item already matched, known domain phrases,
 * expanded abbreviations, and the most frequent remaining content words.
 */

const STOPWORDS = new Set(
  `a about after again all also am an and any anyone anything are around as at back be
   because been before being below best better between both but by can cant could did
   didnt do does doesnt doing done dont down during each else even ever every everyone
   feel feeling felt few for from further get gets getting go goes going good got had
   has have having he her here hers him his how i id if ill im in into is isnt it its
   ive just keep know let like little ll long look looking lot made make makes many
   maybe me might month months more most much must my need needs never new next no not
   now of off often on once one only or other our out over own people please post put
   really right said same say see seen should since so some someone something still
   such sure take tell than thank thanks that the their them then there these they
   thing things think this those though thought through time to today told too try
   trying up us use used using very want wants was way we week weeks well were what
   when where which while who why will with without would yeah year years yes yet you
   your yours advice ago anybody anyhow anymore anyway asked asking care case
   comfortable curious experience experiences guys hard help helped helpful hey
   hope hoping idea ideas info information issue issues lately looked lot mine
   normal ok okay questions read seems sorry started stuff suggestions supposed
   thoughts told update wondering worse worst`
    .split(/\s+/)
    .filter(Boolean)
);

/** Multi-word phrases worth searching verbatim when they appear. */
const PHRASES = [
  'phantom limb pain',
  'phantom limb sensation',
  'phantom pain',
  'residual limb pain',
  'residual limb',
  'mirror therapy',
  'prosthetic socket',
  'socket fit',
  'test socket',
  'check socket',
  'below knee amputation',
  'above knee amputation',
  'transtibial amputation',
  'transfemoral amputation',
  'upper limb amputation',
  'lower limb amputation',
  'limb loss',
  'limb difference',
  'targeted muscle reinnervation',
  'regenerative peripheral nerve interface',
  'neuroma pain',
  'osseointegrated prosthesis',
  'bone anchored prosthesis',
  'myoelectric prosthesis',
  'microprocessor knee',
  'prosthetic liner',
  'skin breakdown',
  'pressure ulcer',
  'wound healing',
  'gait training',
  'physical therapy',
  'occupational therapy',
  'peripheral arterial disease',
  'diabetic foot',
  'chronic pain',
  'neuropathic pain',
  'quality of life',
  'body image',
  'return to work',
  'falls risk',
  'energy expenditure',
  'phantom limb',
];

/** Forum shorthand expanded into the words the literature actually uses. */
const ABBREVIATIONS = {
  bka: 'below knee amputation',
  bk: 'below knee amputation',
  aka: 'above knee amputation',
  ak: 'above knee amputation',
  tta: 'transtibial amputation',
  tfa: 'transfemoral amputation',
  plp: 'phantom limb pain',
  tmr: 'targeted muscle reinnervation',
  rpni: 'regenerative peripheral nerve interface',
  mpk: 'microprocessor knee',
  osseo: 'osseointegration',
  pt: 'physical therapy',
  ot: 'occupational therapy',
  pad: 'peripheral arterial disease',
  dvt: 'deep vein thrombosis',
  cpm: 'continuous passive motion',
};

/** Single words that carry clinical meaning in this domain. */
const DOMAIN_TOKENS = new Set([
  'amputation', 'amputee', 'amputees', 'prosthesis', 'prosthetic', 'prosthetics',
  'prosthetist', 'stump', 'limb', 'socket', 'liner', 'suspension', 'pylon',
  'phantom', 'neuroma', 'osseointegration', 'osseointegrated', 'myoelectric',
  'rehabilitation', 'rehab', 'gait', 'mobility', 'pain', 'analgesia', 'opioid',
  'gabapentin', 'pregabalin', 'mirror', 'desensitization', 'edema', 'oedema',
  'shrinker', 'scar', 'wound', 'infection', 'revision', 'dysvascular',
  'diabetes', 'diabetic', 'vascular', 'ischemia', 'ischaemia', 'contracture',
  'depression', 'anxiety', 'adjustment', 'ulcer', 'callus', 'blister',
  'crutches', 'wheelchair', 'k2', 'k3', 'k4', 'bilateral', 'unilateral',
  'paediatric', 'pediatric', 'congenital', 'traumatic', 'surgery', 'surgical',
  'postoperative', 'preoperative', 'hyperhidrosis', 'sweating',
]);

function normalizeText(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return text
    .split(' ')
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter(
      (t) =>
        t.length > 2 &&
        !STOPWORDS.has(t) &&
        // Keep words, not timestamps or counts ("3am", "2x"); the few useful
        // alphanumerics in this domain are whitelisted below.
        (/^[a-z][a-z-]+$/.test(t) || DOMAIN_TOKENS.has(t))
    );
}

/**
 * @param {{text?: string, keywords_matched?: string[], keyword_matched?: string}} question
 * @param {{max?: number}} [options]
 * @returns {{terms: string[], detail: Array<{term: string, weight: number, kind: string}>}}
 */
function extractTerms(question, options = {}) {
  const max = Math.max(Number(options.max) || 6, 1);
  const text = normalizeText(question && question.text);
  const tokens = tokenize(text);
  const scores = new Map();

  const add = (term, weight, kind) => {
    const key = term.trim().toLowerCase();
    if (!key) return;
    const existing = scores.get(key);
    if (existing) {
      existing.weight += weight;
      if (kind === 'keyword') existing.kind = kind;
    } else {
      scores.set(key, { term: key, weight, kind });
    }
  };

  // 1. Keywords the item already matched are the strongest signal: the
  //    physician chose them.
  const matched = Array.isArray(question && question.keywords_matched)
    ? question.keywords_matched
    : [];
  const primary = question && question.keyword_matched ? [question.keyword_matched] : [];
  for (const keyword of [...matched, ...primary]) {
    add(String(keyword), 6, 'keyword');
  }

  // 2. Known domain phrases present verbatim in the text.
  for (const phrase of PHRASES) {
    if (text.includes(phrase)) add(phrase, 4, 'phrase');
  }

  // 3. Forum shorthand, expanded.
  for (const token of new Set(tokens)) {
    if (ABBREVIATIONS[token]) add(ABBREVIATIONS[token], 3.5, 'expanded');
  }

  // 4. Remaining content words, by frequency, with a domain boost.
  const frequency = new Map();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  for (const [token, count] of frequency) {
    if (ABBREVIATIONS[token]) continue;
    const boost = DOMAIN_TOKENS.has(token) ? 2.5 : 0;
    if (!boost && count < 2 && tokens.length > 12) continue;
    add(token, 1 + Math.log2(count) + boost, boost ? 'domain' : 'word');
  }

  const ranked = [...scores.values()].sort(
    (a, b) => b.weight - a.weight || a.term.localeCompare(b.term)
  );

  // A bare content word ("rubbing", "refits") is only worth searching when the
  // question gave us nothing clinical to go on; otherwise it drags in noise.
  const isStrong = (entry) => entry.kind !== 'word';
  const strongCount = ranked.filter(isStrong).length;
  const weakBudget = Math.max(0, 3 - strongCount);

  const chosen = [];
  let weakUsed = 0;
  for (const entry of ranked) {
    if (!isStrong(entry)) {
      if (weakUsed >= weakBudget) continue;
      weakUsed += 1;
    }
    // Drop single words already contained in a stronger phrase.
    const covered = chosen.some(
      (kept) =>
        kept.term !== entry.term &&
        kept.term.split(' ').length > entry.term.split(' ').length &&
        kept.term.includes(entry.term)
    );
    if (covered) continue;
    chosen.push(entry);
    if (chosen.length >= max) break;
  }

  return { terms: chosen.map((c) => c.term), detail: chosen };
}

module.exports = {
  extractTerms,
  normalizeText,
  tokenize,
  STOPWORDS,
  PHRASES,
  ABBREVIATIONS,
  DOMAIN_TOKENS,
};
