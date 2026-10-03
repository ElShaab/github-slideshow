/**
 * Turning the legal documents in this repo into the pages GitHub Pages serves.
 *
 * App Review opens the privacy and support URLs, so they have to be live before
 * the build is submitted — and they have to say what the app actually does. The
 * markdown in the repo is the source of truth; these functions derive the
 * published page from it, so the two can never drift apart.
 */

/** The note to the repo's owner, which no visitor should ever read. */
const EDITOR_NOTE = /^> \*\*Before publishing:\*\*[\s\S]*?(?=\n\n)/m;

/**
 * Anything still in square brackets that is not a link.
 *
 * Deliberately wider than `[LEGAL ENTITY NAME]`: a note to whoever deploys the
 * app reads as ordinary prose — "[If you have an EU/UK representative, name
 * them here]" — and an all-caps rule sails straight past it onto the live
 * page. The negative lookahead spares markdown links, which are the only
 * brackets these documents legitimately contain.
 */
const PLACEHOLDER = /\[[^\]]+\](?!\()/g;

/** Every unfilled placeholder in `markdown`, deduplicated and in order. */
export function placeholders(markdown) {
  return [...new Set(markdown.match(PLACEHOLDER) ?? [])];
}

/** Strips the front matter Jekyll would otherwise render as text. */
function frontMatter({ title, permalink, description }) {
  return [
    '---',
    'layout: legal',
    `title: ${title}`,
    `description: ${description}`,
    `permalink: ${permalink}`,
    '---',
    '',
    '<!-- Generated from the markdown in getfit/ by `npm run legal`. Do not edit. -->',
    '',
    '',
  ].join('\n');
}

/**
 * The published page for one document.
 *
 * The heading is dropped because the layout renders the title, and the
 * "Before publishing" note is dropped because it is addressed to whoever
 * deploys the app, not to the person reading the policy.
 *
 * @param {string} markdown the source document
 * @param {{ title: string, permalink: string, description: string }} page
 * @returns {string}
 */
export function renderPage(markdown, page) {
  const body = markdown
    .replace(EDITOR_NOTE, '')
    .replace(/^# .*\n/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `${frontMatter(page)}${body}\n`;
}

/** The documents published, and where each one lands. */
export const PAGES = [
  {
    source: 'PRIVACY.md',
    output: 'privacy.md',
    title: 'Privacy Policy',
    permalink: '/privacy',
    description: 'What GetFit collects, why, and what control you have over it.',
  },
  {
    source: 'SUPPORT.md',
    output: 'support.md',
    title: 'Support',
    permalink: '/support',
    description: 'How to get help with GetFit, manage a membership, or delete your data.',
  },
];
