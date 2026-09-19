'use strict';

const config = require('../../config');
const client = require('../client');
const { parseAbstracts } = require('../../lib/pubmedXml');

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const MIN_INTERVAL = () => (config.pubmed.apiKey ? 120 : 400);

function commonParams() {
  const params = { db: 'pubmed', tool: config.pubmed.tool };
  const email = client.contactEmail() || config.pubmed.email;
  if (email) params.email = email;
  if (config.pubmed.apiKey) params.api_key = config.pubmed.apiKey;
  return params;
}

function buildTerm(terms) {
  return terms.map((t) => `"${t.replace(/"/g, '')}"[Title/Abstract]`).join(' OR ');
}

function authorString(summary) {
  const authors = (summary.authors || []).map((a) => a.name).filter(Boolean);
  if (!authors.length) return null;
  return authors.length <= 3 ? authors.join(', ') : `${authors[0]} et al.`;
}

async function search(terms, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);

  const searchParams = new URLSearchParams({
    ...commonParams(),
    term: buildTerm(terms),
    retmode: 'json',
    retmax: String(limit),
    sort: 'relevance',
  });
  const { data } = await client.get('pubmed', `${BASE}/esearch.fcgi?${searchParams}`, {
    minIntervalMs: MIN_INTERVAL(),
  });
  const ids = (data && data.esearchresult && data.esearchresult.idlist) || [];
  if (!ids.length) return [];

  const summaryParams = new URLSearchParams({
    ...commonParams(),
    id: ids.join(','),
    retmode: 'json',
  });
  const { data: summaryData } = await client.get(
    'pubmed',
    `${BASE}/esummary.fcgi?${summaryParams}`,
    { minIntervalMs: MIN_INTERVAL() }
  );
  const result = (summaryData && summaryData.result) || {};

  let abstracts = new Map();
  try {
    const fetchParams = new URLSearchParams({
      ...commonParams(),
      id: ids.join(','),
      rettype: 'abstract',
      retmode: 'xml',
    });
    abstracts = parseAbstracts(
      await client.getText('pubmed', `${BASE}/efetch.fcgi?${fetchParams}`, {
        minIntervalMs: MIN_INTERVAL(),
      })
    );
  } catch {
    // Abstracts are a bonus; titles and metadata are enough to rank on.
  }

  return (result.uids || [])
    .map((uid) => result[uid])
    .filter(Boolean)
    .map((summary) => {
      const doi = (summary.articleids || []).find((a) => a.idtype === 'doi');
      return {
        source: 'pubmed',
        title: client.stripMarkup(summary.title),
        abstract: abstracts.get(String(summary.uid)) || null,
        venue: summary.fulljournalname || summary.source || null,
        year: Number(String(summary.sortpubdate || summary.pubdate || '').slice(0, 4)) || null,
        doi: doi ? doi.value : null,
        pmid: String(summary.uid),
        url: `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`,
        authors: authorString(summary),
        citations: null,
        open_access: null,
        publication_types: summary.pubtype || [],
        type: null,
      };
    });
}

module.exports = {
  id: 'pubmed',
  label: 'PubMed',
  search,
  buildTerm,
};
