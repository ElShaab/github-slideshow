'use strict';

/**
 * Evidence grading. Level 1 is the strongest.
 *
 * The level drives ranking, so this deliberately defaults to the middle of the
 * scale rather than the top: an unclassified paper should never outrank a
 * randomized trial just because its metadata was thin.
 */
const LEVELS = {
  1: { label: 'Guideline / systematic review', weight: 6 },
  2: { label: 'Randomized controlled trial', weight: 5 },
  3: { label: 'Trial / cohort study', weight: 4 },
  4: { label: 'Observational study', weight: 3 },
  5: { label: 'Case report / narrative / preprint', weight: 1 },
};

const RULES = [
  { level: 1, kind: 'guideline', re: /\b(practice guideline|clinical guideline|guidelines?|consensus statement|position statement)\b/ },
  { level: 1, kind: 'systematic-review', re: /\b(systematic review|meta-?analys[ei]s|cochrane|umbrella review|scoping review|evidence synthesis)\b/ },
  { level: 2, kind: 'rct', re: /\b(randomi[sz]ed controlled trial|randomi[sz]ed clinical trial|randomi[sz]ed trial|\brct\b|double-?blind)\b/ },
  { level: 3, kind: 'trial', re: /\b(clinical trial|controlled clinical trial|non-?randomi[sz]ed trial|pilot study|feasibility study|crossover (trial|study)|quasi-experimental)\b/ },
  { level: 3, kind: 'cohort', re: /\b(cohort (study|analysis)|prospective study|longitudinal (study|analysis)|follow-?up study|comparative study)\b/ },
  { level: 4, kind: 'observational', re: /\b(cross-?sectional|case-?control|observational (study|cohort)|retrospective (study|review|analysis)|registry (study|analysis)|survey|questionnaire)\b/ },
  { level: 5, kind: 'case-report', re: /\b(case reports?|case series|clinical vignette)\b/ },
  { level: 5, kind: 'narrative', re: /\b(narrative review|literature review|editorial|letter|comment|commentary|perspective|opinion|book chapter)\b/ },
  { level: 5, kind: 'preclinical', re: /\b(in vitro|in silico|cadaver(ic)?|animal (study|model)|\brats?\b|\bmice\b|murine|porcine)\b/ },
];

function haystack(work) {
  return [
    ...(work.publication_types || []),
    work.type || '',
    work.title || '',
    // Only the opening of the abstract: a systematic review referenced in a
    // discussion section should not promote a case report.
    String(work.abstract || '').slice(0, 320),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * @returns {{level: number, label: string, kind: string, weight: number,
 *            preprint: boolean, registry: boolean}}
 */
function classify(work) {
  const text = haystack(work);

  if (work.registry) {
    // A trial registration is a plan or an in-progress study, not a published
    // result. Randomized interventional trials still rank respectably.
    const randomized = /\brandomi[sz]ed\b/.test(text) || work.allocation === 'RANDOMIZED';
    const interventional = /interventional/i.test(work.study_type || '') || randomized;
    const level = randomized ? 2 : interventional ? 3 : 4;
    return {
      level,
      label: randomized
        ? 'Registered randomized trial'
        : interventional
          ? 'Registered trial'
          : 'Registered observational study',
      kind: 'trial-registration',
      weight: LEVELS[level].weight,
      preprint: false,
      registry: true,
    };
  }

  const preprint =
    !!work.preprint ||
    /\b(preprint|posted-content|medrxiv|biorxiv|research square|ssrn)\b/.test(text);

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      // A preprint systematic review is still unreviewed; cap it one level down
      // but never below the bottom of the scale.
      const level = preprint ? Math.min(5, rule.level + 1) : rule.level;
      return {
        level,
        label: preprint ? `${LEVELS[rule.level].label} (preprint)` : LEVELS[level].label,
        kind: rule.kind,
        weight: LEVELS[level].weight,
        preprint,
        registry: false,
      };
    }
  }

  if (preprint) {
    return {
      level: 5,
      label: 'Preprint (not peer reviewed)',
      kind: 'preprint',
      weight: LEVELS[5].weight,
      preprint: true,
      registry: false,
    };
  }

  return {
    level: 4,
    label: 'Unclassified study',
    kind: 'unclassified',
    weight: LEVELS[4].weight,
    preprint: false,
    registry: false,
  };
}

module.exports = { classify, LEVELS };
