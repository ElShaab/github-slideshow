'use strict';

/**
 * Reads RSS 2.0 and Atom with the same shape, so a source can accept whatever
 * a forum happens to publish. Deliberately tolerant: feeds in the wild are
 * frequently malformed, and a missing field should cost one item, not the
 * whole poll.
 */

const { decodeEntities } = require('./pubmedXml');
const atom = require('./atom');

function block(xml, name) {
  const match = String(xml || '').match(
    new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i')
  );
  return match ? match[1] : '';
}

function blocks(xml, name) {
  return [
    ...String(xml || '').matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi')),
  ].map((m) => m[1]);
}

/** Atom entries carry the link as an attribute; RSS as element text. */
function linkOf(fragment) {
  const alternates = [
    ...String(fragment || '').matchAll(/<link\b([^>]*)\/?>/gi),
  ]
    .map((m) => m[1])
    .filter((attrs) => !/rel="(self|edit|replies|hub)"/i.test(attrs));
  for (const attrs of alternates) {
    const href = attrs.match(/href="([^"]*)"/);
    if (href) return decodeEntities(href[1]);
  }
  const text = block(fragment, 'link').trim();
  if (text) return decodeEntities(text);
  const guid = block(fragment, 'guid').trim();
  return /^https?:\/\//i.test(guid) ? decodeEntities(guid) : '';
}

function authorOf(fragment) {
  const named = atom.tag(atom.tag(fragment, 'author'), 'name');
  if (named) return decodeEntities(named).replace(/^\/u\//, '');
  const creator = block(fragment, 'dc:creator') || block(fragment, 'author');
  return decodeEntities(creator)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

function bodyOf(fragment) {
  // Richest first: full content, then the summary or description.
  const raw =
    block(fragment, 'content:encoded') ||
    atom.tag(fragment, 'content') ||
    block(fragment, 'description') ||
    atom.tag(fragment, 'summary');
  return atom.htmlToText(raw);
}

function dateOf(fragment) {
  return (
    block(fragment, 'published') ||
    block(fragment, 'updated') ||
    block(fragment, 'pubDate') ||
    block(fragment, 'dc:date') ||
    ''
  ).trim();
}

function identityOf(fragment, link, title) {
  const id = (atom.tag(fragment, 'id') || block(fragment, 'guid')).trim();
  if (id) return decodeEntities(id);
  if (link) return link;
  return title ? `title:${title}` : '';
}

/** True when the body looks like a feed rather than a web page. */
function isFeed(xml) {
  return /<(rss|feed|rdf:RDF)\b/i.test(String(xml || ''));
}

/**
 * The standard discovery tag a site puts in its <head> so readers can find
 * its feed. Returns the href as written, for the caller to resolve.
 */
function discoverFeedHref(html) {
  const links = [...String(html || '').matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]);
  for (const attrs of links) {
    if (!/rel="[^"]*alternate[^"]*"/i.test(attrs)) continue;
    if (!/type="application\/(rss|atom)\+xml"/i.test(attrs)) continue;
    const href = attrs.match(/href="([^"]*)"/i);
    if (href) return decodeEntities(href[1]);
  }
  return null;
}

function parseFeed(xml) {
  const source = String(xml || '');
  const channel = block(source, 'channel') || source;
  const title = decodeEntities(
    block(channel.replace(/<item\b[\s\S]*$/i, ''), 'title') ||
      block(source.replace(/<entry\b[\s\S]*$/i, ''), 'title')
  );

  const fragments = [...blocks(source, 'item'), ...blocks(source, 'entry')];
  const items = fragments
    .map((fragment) => {
      const entryTitle = atom.htmlToText(block(fragment, 'title'));
      const link = linkOf(fragment);
      return {
        id: identityOf(fragment, link, entryTitle),
        title: entryTitle,
        link,
        author: authorOf(fragment),
        published: dateOf(fragment),
        text: bodyOf(fragment),
      };
    })
    .filter((item) => item.id && (item.title || item.text));

  return { title, items };
}

module.exports = { parseFeed, isFeed, discoverFeedHref };
