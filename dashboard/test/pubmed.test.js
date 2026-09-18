'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('pubmed');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const pubmed = require('../src/sources/pubmed');

keywords.create({ term: 'phantom limb pain' });
keywords.create({
  term: 'osseointegration',
  scope: 'specific',
  sources: ['pubmed'],
});

test('pubmed poll searches title/abstract and stores articles', async () => {
  let esearchUrl = '';
  const mock = mockFetch({
    'esearch.fcgi': (url) => {
      esearchUrl = url;
      return { body: { esearchresult: { count: '2', idlist: ['39000001'] } } };
    },
    'esummary.fcgi': {
      body: {
        result: {
          uids: ['39000001'],
          39000001: {
            uid: '39000001',
            title: 'Osseointegration outcomes after transfemoral amputation',
            authors: [{ name: 'Smith J' }, { name: 'Doe A' }],
            sortpubdate: '2024/05/01 00:00',
            fulljournalname: 'Journal of Prosthetics',
            articleids: [{ idtype: 'doi', value: '10.1000/test' }],
            pubtype: ['Journal Article'],
          },
        },
      },
    },
    'efetch.fcgi': {
      body:
        '<PubmedArticleSet><PubmedArticle><PMID Version="1">39000001</PMID>' +
        '<AbstractText Label="BACKGROUND">Patients with limb loss report phantom limb pain.</AbstractText>' +
        '<AbstractText Label="RESULTS">Osseointegration improved mobility.</AbstractText>' +
        '</PubmedArticle></PubmedArticleSet>',
      headers: { 'content-type': 'text/xml' },
    },
  });
  try {
    const result = await pubmed.poll();
    assert.equal(result.added, 1);
  } finally {
    mock.restore();
  }

  const term = decodeURIComponent(new URL(esearchUrl).searchParams.get('term'));
  assert.match(term, /"osseointegration"\[Title\/Abstract\]/);
  assert.match(term, /"phantom limb pain"\[Title\/Abstract\]/);

  const article = items.query({ source: 'pubmed' }).items[0];
  assert.equal(article.external_id, 'pmid:39000001');
  assert.equal(article.author, 'Smith J, Doe A');
  assert.match(article.text, /Osseointegration improved mobility/);
  assert.equal(article.url, 'https://pubmed.ncbi.nlm.nih.gov/39000001/');
  assert.equal(article.meta.doi, '10.1000/test');
});

test('pubmed still stores the article when abstracts cannot be fetched', async () => {
  const mock = mockFetch({
    'esearch.fcgi': { body: { esearchresult: { count: '1', idlist: ['39000002'] } } },
    'esummary.fcgi': {
      body: {
        result: {
          uids: ['39000002'],
          39000002: {
            uid: '39000002',
            title: 'Prosthetic socket comfort trial',
            authors: [],
            sortpubdate: '2024/06/01 00:00',
            source: 'Prosthet Orthot Int',
          },
        },
      },
    },
    'efetch.fcgi': { status: 500, body: 'boom' },
  });
  try {
    const result = await pubmed.poll();
    assert.equal(result.added, 1);
  } finally {
    mock.restore();
  }
  const article = items
    .query({ source: 'pubmed' })
    .items.find((i) => i.external_id === 'pmid:39000002');
  assert.equal(article.meta.has_abstract, false);
});

test('pubmed abstract parsing keeps one record per article', () => {
  const parsed = pubmed.parseAbstracts(
    '<PubmedArticle><PMID>1</PMID><AbstractText>One</AbstractText></PubmedArticle>' +
      '<PubmedArticle><PMID>2</PMID><AbstractText>Two</AbstractText></PubmedArticle>'
  );
  assert.equal(parsed.get('1'), 'One');
  assert.equal(parsed.get('2'), 'Two');
});
