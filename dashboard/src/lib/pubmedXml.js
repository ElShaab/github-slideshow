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
 *
 * A structured abstract carries its section name in the Label attribute, and
 * that name is kept as a prefix: it is what tells a reader (or the draft
 * composer) which paragraph is the conclusion rather than the methods.
 */
function parseAbstracts(xml) {
  const byPmid = new Map();
  const articles = String(xml || '').split('<PubmedArticle>').slice(1);
  for (const article of articles) {
    const pmidMatch = article.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    if (!pmidMatch) continue;
    const segments = [...article.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => {
        const body = decodeEntities(m[2]);
        if (!body) return '';
        const label = (m[1].match(/\bLabel="([^"]*)"/i) || [])[1];
        return label && !/^unlabell?ed$/i.test(label)
          ? `${decodeEntities(label)}: ${body}`
          : body;
      })
      .filter(Boolean);
    if (segments.length) byPmid.set(pmidMatch[1], segments.join('\n\n'));
  }
  return byPmid;
}

module.exports = { decodeEntities, parseAbstracts };
