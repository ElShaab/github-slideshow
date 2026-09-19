'use strict';

const client = require('../client');

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

function buildQuery(terms) {
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

async function search(terms, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const params = new URLSearchParams({
    query: buildQuery(terms),
    format: 'json',
    resultType: 'core',
    pageSize: String(limit),
  });
  const email = client.contactEmail();
  if (email) params.set('email', email);

  const { data } = await client.get('europepmc', `${BASE}?${params}`, {
    minIntervalMs: 300,
  });

  const results = (data && data.resultList && data.resultList.result) || [];
  return results.map((r) => {
    const journal =
      (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) ||
      r.journalTitle ||
      r.bookOrReportDetails?.publisher ||
      null;
    return {
      source: 'europepmc',
      title: client.stripMarkup(r.title),
      abstract: r.abstractText ? client.stripMarkup(r.abstractText) : null,
      venue: journal,
      year: Number(r.pubYear) || null,
      doi: r.doi || null,
      pmid: r.pmid || null,
      url: r.doi
        ? `https://doi.org/${r.doi}`
        : `https://europepmc.org/article/${r.source}/${r.id}`,
      source_url: `https://europepmc.org/article/${r.source}/${r.id}`,
      authors: r.authorString || null,
      citations: typeof r.citedByCount === 'number' ? r.citedByCount : null,
      // Europe PMC states open access explicitly, so a "no" here is real.
      open_access: r.isOpenAccess === 'Y' ? true : r.isOpenAccess === 'N' ? false : null,
      open_access_url:
        r.fullTextUrlList && r.fullTextUrlList.fullTextUrl
          ? (r.fullTextUrlList.fullTextUrl.find((u) => u.availability === 'Open access') || {}).url ||
            null
          : null,
      publication_types: (r.pubTypeList && r.pubTypeList.pubType) || [],
      type: r.pubType || null,
      // Europe PMC files preprints under the PPR source.
      preprint: r.source === 'PPR',
    };
  });
}

module.exports = { id: 'europepmc', label: 'Europe PMC', search, buildQuery };
