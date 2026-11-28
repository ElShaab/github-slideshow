/**
 * App Store Connect's length limits, and the copy measured against them.
 *
 * Every field here is rejected outright when it is one character too long, and
 * the copy is edited far more often than it is pasted — so the check lives
 * beside the text rather than in someone's memory of what the limits were.
 */

/** Field order matches the fenced blocks in STORE_LISTING.md. */
export const LISTING_FIELDS = [
  { name: 'Subtitle', limit: 30 },
  { name: 'Subtitle (alternative)', limit: 30 },
  { name: 'Subtitle (alternative)', limit: 30 },
  { name: 'Description', limit: 4000 },
  { name: 'Keywords', limit: 100 },
  { name: 'Promotional text', limit: 170 },
];

/** The fenced blocks of a markdown document, in order, without their fences. */
export function fencedBlocks(markdown) {
  return [...markdown.matchAll(/```\n([\s\S]*?)```/g)].map((match) => match[1].replace(/\n+$/, ''));
}

/**
 * Measures each block against the field it belongs to.
 *
 * @returns {Array<{name: string, limit: number, length: number, over: number}>}
 */
export function measure(markdown, fields = LISTING_FIELDS) {
  const blocks = fencedBlocks(markdown);
  return fields.map((field, index) => {
    const length = blocks[index] === undefined ? -1 : blocks[index].length;
    return { ...field, length, over: length < 0 ? 0 : Math.max(0, length - field.limit) };
  });
}
