'use strict';

const config = require('../config');
const { fetchJson, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// NCBI allows 3 requests/second without an API key, 10 with one.
function pacingMs() {
  return config.pubmed.apiKey ? 120 : 400;
}

function commonParams() {
  const params = { db: 'pubmed', tool: config.pubmed.tool };
  if (config.pubmed.email) params.email = config.pubmed.email;
  if (config.pubmed.apiKey) params.api_key = config.pubmed.apiKey;
  return params;
}

/** OR the research keywords across title and abstract. */
function buildTerm(terms) {
  return terms
    .map((t) => `"${t.replace(/"/g, '')}"[Title/Abstract]`)
    .join(' OR ');
}

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

async function esearch(term, retmax, reldate) {
  const params = new URLSearchParams({
    ...commonParams(),
    term,
    retmode: 'json',
    retmax: String(retmax),
    sort: 'date',
    datetype: 'edat',
    reldate: String(reldate),
  });
  const { data } = await fetchJson(`${BASE}/esearch.fcgi?${params}`, { retries: 1 });
  const result = data && data.esearchresult ? data.esearchresult : {};
  return {
    ids: result.idlist || [],
    count: Number(result.count || 0),
  };
}

async function esummary(ids) {
  const params = new URLSearchParams({
    ...commonParams(),
    id: ids.join(','),
    retmode: 'json',
  });
  const { data } = await fetchJson(`${BASE}/esummary.fcgi?${params}`, { retries: 1 });
  const result = (data && data.result) || {};
  return (result.uids || []).map((uid) => result[uid]).filter(Boolean);
}

async function efetchAbstracts(ids) {
  const params = new URLSearchParams({
    ...commonParams(),
    id: ids.join(','),
    rettype: 'abstract',
    retmode: 'xml',
  });
  const url = `${BASE}/efetch.fcgi?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent } });
  if (!res.ok) return new Map();
  return parseAbstracts(await res.text());
}

function formatAuthors(summary) {
  const authors = (summary.authors || [])
    .map((a) => a.name)
    .filter(Boolean);
  if (!authors.length) return null;
  if (authors.length <= 3) return authors.join(', ');
  return `${authors[0]} et al.`;
}

function normalize(summary, abstract) {
  const title = decodeEntities(summary.title || '(untitled)');
  const journal = summary.fulljournalname || summary.source || '';
  const body = [title, abstract, journal].filter(Boolean).join('\n\n');
  return {
    external_id: `pmid:${summary.uid}`,
    author: formatAuthors(summary),
    text: body,
    url: `https://pubmed.ncbi.nlm.nih.gov/${summary.uid}/`,
    timestamp: summary.sortpubdate || summary.epubdate || summary.pubdate,
    kind: 'article',
    origin: journal || 'PubMed',
    meta: {
      pmid: summary.uid,
      title,
      journal,
      pubdate: summary.pubdate || null,
      doi: (summary.articleids || []).find((a) => a.idtype === 'doi')
        ? (summary.articleids || []).find((a) => a.idtype === 'doi').value
        : null,
      pubtypes: summary.pubtype || [],
      has_abstract: !!abstract,
    },
  };
}

async function poll() {
  const matcher = matcherFor('pubmed');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to PubMed' };
  }

  const terms = matcher.keywords.map((k) => k.term);
  const retmax = Math.min(
    Math.max(settings.getNumber('pubmed.max_results', 25), 1),
    100
  );
  const reldate = Math.max(settings.getNumber('pubmed.reldate_days', 30), 1);

  const { ids, count } = await esearch(buildTerm(terms), retmax, reldate);
  if (!ids.length) {
    return { fetched: 0, added: 0, notes: `no results in the last ${reldate} days` };
  }

  await sleep(pacingMs());
  const summaries = await esummary(ids);

  await sleep(pacingMs());
  let abstracts = new Map();
  try {
    abstracts = await efetchAbstracts(ids);
  } catch {
    // Abstracts are a nicety; the title alone is still a usable feed item.
  }

  const candidates = summaries.map((summary) => {
    const item = normalize(summary, abstracts.get(String(summary.uid)));
    item.fallbackKeyword = terms[0];
    return item;
  });

  const stats = ingest('pubmed', candidates, matcher);
  return {
    ...stats,
    notes: `${count} total matches in the last ${reldate} days; newest ${ids.length} examined`,
  };
}

module.exports = {
  id: 'pubmed',
  label: 'PubMed',
  credentials: [
    {
      env: 'PUBMED_API_KEY',
      label: 'NCBI API key (optional, raises the rate limit)',
      required: false,
    },
  ],
  isConfigured: () => true,
  describe: () => ({
    reldate_days: settings.getNumber('pubmed.reldate_days', 30),
    max_results: settings.getNumber('pubmed.max_results', 25),
    api_key_set: !!config.pubmed.apiKey,
    example_term: buildTerm(
      matcherFor('pubmed').keywords.map((k) => k.term).slice(0, 5)
    ),
  }),
  buildTerm,
  parseAbstracts,
  poll,
};
