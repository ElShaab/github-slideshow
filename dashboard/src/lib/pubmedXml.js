'use strict';

/** Shared PubMed E-utilities XML helpers (used by the feed source and the
 *  research matcher). */

function decodeEntities(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Pull abstracts out of an efetch XML payload without a full XML parser: one
 * record per <PubmedArticle>, with every <AbstractText> segment joined.
 */
function parseAbstracts(xml) {
  const byPmid = new Map();
  const articles = String(xml || '').split('<PubmedArticle>').slice(1);
  for (const article of articles) {
    const pmidMatch = article.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    if (!pmidMatch) continue;
    const segments = [...article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => decodeEntities(m[1]))
      .filter(Boolean);
    if (segments.length) byPmid.set(pmidMatch[1], segments.join('\n\n'));
  }
  return byPmid;
}

module.exports = { decodeEntities, parseAbstracts };
