'use strict';

const { decodeEntities } = require('./pubmedXml');

/** Splits an Atom document into its <entry> bodies. */
function entries(xml) {
  return [...String(xml || '').matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
}

/** First <name>…</name> in a fragment, decoded. */
function tag(fragment, name) {
  const match = String(fragment || '').match(
    new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`)
  );
  return match ? match[1] : '';
}

/** An attribute of the first matching self-closing or open tag. */
function attr(fragment, name, key) {
  const match = String(fragment || '').match(
    new RegExp(`<${name}\\b[^>]*\\b${key}="([^"]*)"`)
  );
  return match ? decodeEntities(match[1]) : '';
}

/**
 * Atom <content type="html"> carries escaped markup. Unescape it once, then
 * flatten the tags to text, keeping paragraph and list breaks so a post does
 * not come out as one run-on line.
 */
function htmlToText(value) {
  const html = String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n\n')
      .replace(/&nbsp;/g, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { entries, tag, attr, htmlToText };
