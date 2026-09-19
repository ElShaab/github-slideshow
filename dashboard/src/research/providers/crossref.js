'use strict';

const client = require('../client');

const BASE = 'https://api.crossref.org/works';

const SELECT = [
  'DOI',
  'title',
  'abstract',
  'container-title',
  'issued',
  'type',
  'subtype',
  'is-referenced-by-count',
  'author',
  'URL',
].join(',');

async function search(terms, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const params = new URLSearchParams({
    'query.bibliographic': terms.join(' '),
    rows: String(limit),
    select: SELECT,
  });
  // Crossref's "polite pool" is faster and more reliable than the anonymous
  // one, and only asks for a contact address.
  const email = client.contactEmail();
  if (email) params.set('mailto', email);

  const { data } = await client.get('crossref', `${BASE}?${params}`, {
    minIntervalMs: 150,
  });

  const items = (data && data.message && data.message.items) || [];
  return items.map((item) => {
    const year =
      item.issued && item.issued['date-parts'] && item.issued['date-parts'][0]
        ? Number(item.issued['date-parts'][0][0])
        : null;
    const authors = (item.author || [])
      .map((a) => [a.family, a.given].filter(Boolean).join(' '))
      .filter(Boolean);
    return {
      source: 'crossref',
      title: client.stripMarkup((item.title || [])[0]),
      // Crossref abstracts arrive as JATS XML.
      abstract: item.abstract ? client.stripMarkup(item.abstract) : null,
      venue: (item['container-title'] || [])[0] || null,
      year: Number.isFinite(year) ? year : null,
      doi: item.DOI || null,
      url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
      authors: authors.length
        ? authors.length <= 3
          ? authors.join(', ')
          : `${authors[0]} et al.`
        : null,
      citations:
        typeof item['is-referenced-by-count'] === 'number'
          ? item['is-referenced-by-count']
          : null,
      open_access: null,
      publication_types: [item.type, item.subtype].filter(Boolean),
      type: item.type || null,
      preprint: item.type === 'posted-content' || item.subtype === 'preprint',
    };
  });
}

module.exports = { id: 'crossref', label: 'Crossref', search };
