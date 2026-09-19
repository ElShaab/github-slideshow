'use strict';

const client = require('../client');

const BASE = 'https://api.openalex.org/works';

/** OpenAlex ships abstracts as a word -> positions map; rebuild the text. */
function abstractFromInvertedIndex(index) {
  if (!index || typeof index !== 'object') return null;
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) words[position] = word;
  }
  const text = words.filter((w) => w !== undefined).join(' ').trim();
  return text || null;
}

async function search(terms, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const params = new URLSearchParams({
    search: terms.join(' '),
    'per-page': String(limit),
  });
  // OpenAlex routes requests with a contact address into a faster pool.
  const email = client.contactEmail();
  if (email) params.set('mailto', email);

  const { data } = await client.get('openalex', `${BASE}?${params}`, {
    minIntervalMs: 150,
  });

  const results = (data && data.results) || [];
  return results.map((work) => {
    const location = work.primary_location || {};
    const venue =
      (location.source && location.source.display_name) ||
      (work.host_venue && work.host_venue.display_name) ||
      null;
    const authors = (work.authorships || [])
      .map((a) => a.author && a.author.display_name)
      .filter(Boolean);
    const openAccess = work.open_access || {};
    return {
      source: 'openalex',
      title: client.stripMarkup(work.display_name || work.title),
      abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
      venue,
      year: work.publication_year || null,
      doi: work.doi || null,
      pmid: work.ids && work.ids.pmid ? String(work.ids.pmid).split('/').pop() : null,
      url: work.doi || (work.ids && work.ids.openalex) || work.id || null,
      source_url: work.id || null,
      authors: authors.length
        ? authors.length <= 3
          ? authors.join(', ')
          : `${authors[0]} et al.`
        : null,
      citations: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
      // OpenAlex states open access explicitly, so false here is meaningful.
      open_access:
        typeof openAccess.is_oa === 'boolean' ? openAccess.is_oa : null,
      open_access_url: openAccess.oa_url || null,
      oa_status: openAccess.oa_status || null,
      publication_types: [work.type, work.type_crossref].filter(Boolean),
      type: work.type || null,
      preprint: work.type === 'preprint' || location.version === 'submittedVersion',
    };
  });
}

module.exports = { id: 'openalex', label: 'OpenAlex', search, abstractFromInvertedIndex };
