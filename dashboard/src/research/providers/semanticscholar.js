'use strict';

const config = require('../../config');
const client = require('../client');

const BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';

const FIELDS = [
  'title',
  'abstract',
  'year',
  'venue',
  'publicationVenue',
  'citationCount',
  'influentialCitationCount',
  'externalIds',
  'publicationTypes',
  'isOpenAccess',
  'openAccessPdf',
  'url',
  'authors',
].join(',');

async function search(terms, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const params = new URLSearchParams({
    query: terms.join(' '),
    limit: String(limit),
    fields: FIELDS,
  });

  const headers = {};
  if (config.semanticScholar.apiKey) {
    headers['x-api-key'] = config.semanticScholar.apiKey;
  }

  const { data } = await client.get('semanticscholar', `${BASE}?${params}`, {
    // The unauthenticated pool is shared and strict; a key raises it.
    minIntervalMs: config.semanticScholar.apiKey ? 200 : 1100,
    headers,
  });

  const papers = (data && data.data) || [];
  return papers.map((paper) => {
    const ids = paper.externalIds || {};
    const authors = (paper.authors || []).map((a) => a.name).filter(Boolean);
    return {
      source: 'semanticscholar',
      title: client.stripMarkup(paper.title),
      abstract: paper.abstract ? client.stripMarkup(paper.abstract) : null,
      venue:
        (paper.publicationVenue && paper.publicationVenue.name) || paper.venue || null,
      year: paper.year || null,
      doi: ids.DOI || null,
      pmid: ids.PubMed || null,
      url: paper.url || (ids.DOI ? `https://doi.org/${ids.DOI}` : null),
      authors: authors.length
        ? authors.length <= 3
          ? authors.join(', ')
          : `${authors[0]} et al.`
        : null,
      citations:
        typeof paper.citationCount === 'number' ? paper.citationCount : null,
      influential_citations:
        typeof paper.influentialCitationCount === 'number'
          ? paper.influentialCitationCount
          : null,
      open_access: typeof paper.isOpenAccess === 'boolean' ? paper.isOpenAccess : null,
      open_access_url: paper.openAccessPdf ? paper.openAccessPdf.url : null,
      publication_types: paper.publicationTypes || [],
      type: null,
      preprint: !!(ids.ArXiv || ids.MedRxiv || ids.BioRxiv),
    };
  });
}

module.exports = { id: 'semanticscholar', label: 'Semantic Scholar', search };
