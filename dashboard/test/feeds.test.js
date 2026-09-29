'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('feeds');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const feeds = require('../src/lib/feeds');
const source = require('../src/sources/feeds');
const { parseFeed, isFeed, discoverFeedHref } = require('../src/lib/feedParse');

keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'prosthetic socket' });

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Limb Loss Forum</title>
    <link>https://forum.example.org</link>
    <item>
      <title>Socket rubbing after weight loss</title>
      <link>https://forum.example.org/t/123</link>
      <guid isPermaLink="false">t-123</guid>
      <dc:creator>walker22</dc:creator>
      <pubDate>Mon, 28 Sep 2026 10:00:00 +0000</pubDate>
      <description>&lt;p&gt;My &lt;b&gt;prosthetic socket&lt;/b&gt; started rubbing.&lt;/p&gt;&lt;p&gt;Three refits later.&lt;/p&gt;</description>
    </item>
    <item>
      <title>Best shoes for a new runner</title>
      <link>https://forum.example.org/t/124</link>
      <guid isPermaLink="false">t-124</guid>
      <pubDate>Mon, 28 Sep 2026 11:00:00 +0000</pubDate>
      <description>Nothing to do with the tracked terms.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>r/amputee</title>
  <link rel="self" href="https://www.reddit.com/r/amputee/new/.rss" />
  <entry>
    <author><name>/u/someone</name></author>
    <id>t3_atom1</id>
    <link href="https://www.reddit.com/r/amputee/comments/atom1/x/" />
    <updated>2026-09-27T08:00:00+00:00</updated>
    <title>Phantom limb pain at 3am</title>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;Worst at night &amp;amp; nothing helps.&lt;/p&gt;&lt;/div&gt;</content>
  </entry>
</feed>`;

test('RSS and Atom parse to the same shape', () => {
  const rss = parseFeed(RSS);
  assert.equal(rss.title, 'Limb Loss Forum');
  assert.equal(rss.items.length, 2);
  assert.deepEqual(rss.items[0], {
    id: 't-123',
    title: 'Socket rubbing after weight loss',
    link: 'https://forum.example.org/t/123',
    author: 'walker22',
    published: 'Mon, 28 Sep 2026 10:00:00 +0000',
    text: 'My prosthetic socket started rubbing.\n\nThree refits later.',
  });

  const atom = parseFeed(ATOM);
  assert.equal(atom.title, 'r/amputee');
  assert.equal(atom.items[0].id, 't3_atom1');
  assert.equal(atom.items[0].author, 'someone');
  // rel="self" is the feed's own address, never the entry's.
  assert.equal(atom.items[0].link, 'https://www.reddit.com/r/amputee/comments/atom1/x/');
  assert.equal(atom.items[0].text, 'Worst at night & nothing helps.');

  assert.ok(isFeed(RSS) && isFeed(ATOM));
  assert.ok(!isFeed('<html><body>a page</body></html>'));
});

test('a forum address resolves to the feed it advertises', async () => {
  const page =
    '<html><head><link rel="alternate" type="application/rss+xml" title="Latest" href="/latest.rss"></head><body>…</body></html>';
  assert.equal(discoverFeedHref(page), '/latest.rss');

  const mock = mockFetch({
    'forum.example.org/latest.rss': { body: RSS, headers: { 'content-type': 'application/rss+xml' } },
    'forum.example.org': { body: page, headers: { 'content-type': 'text/html' } },
  });
  let resolved;
  try {
    resolved = await source.resolve('forum.example.org');
  } finally {
    mock.restore();
  }
  assert.equal(resolved.url, 'https://forum.example.org/latest.rss');
  assert.equal(resolved.label, 'Limb Loss Forum');
  assert.equal(resolved.siteUrl, 'https://forum.example.org/');
  assert.equal(resolved.items, 2);
});

test('a page advertising no feed is rejected with a usable message', async () => {
  const mock = mockFetch({
    'nofeed.example.org': { body: '<html><head></head></html>', headers: { 'content-type': 'text/html' } },
  });
  try {
    await assert.rejects(() => source.resolve('https://nofeed.example.org'), /advertises none/);
  } finally {
    mock.restore();
  }
});

test('polling keyword-matches feed items like any other source', async () => {
  feeds.add({ url: 'https://forum.example.org/latest.rss', label: 'Limb Loss Forum' });
  feeds.add({ url: 'https://www.reddit.com/r/amputee/new/.rss', label: 'r/amputee' });

  const mock = mockFetch({
    'forum.example.org/latest.rss': { body: RSS },
    'reddit.com/r/amputee/new/.rss': { body: ATOM },
  });
  let result;
  try {
    result = await source.poll();
  } finally {
    mock.restore();
  }

  assert.equal(result.fetched, 3);
  assert.equal(result.added, 2);
  assert.equal(result.unmatched, 1, 'the off-topic thread is not captured');

  const captured = items.query({ source: 'feeds' }).items;
  const thread = captured.find((i) => i.external_id === 't-123');
  assert.equal(thread.origin, 'Limb Loss Forum');
  assert.equal(thread.author, 'walker22');
  assert.equal(thread.url, 'https://forum.example.org/t/123');
  assert.match(thread.text, /^Socket rubbing after weight loss\n\nMy prosthetic socket/);
  assert.deepEqual(thread.keywords_matched, ['prosthetic socket']);

  const post = captured.find((i) => i.external_id === 't3_atom1');
  assert.equal(post.origin, 'r/amputee');
  assert.deepEqual(post.keywords_matched, ['phantom limb pain']);
});

test('a re-poll adds nothing and one dead feed does not stop the rest', async () => {
  const mock = mockFetch({
    'forum.example.org/latest.rss': { status: 404, body: 'gone' },
    'reddit.com/r/amputee/new/.rss': { body: ATOM },
  });
  let result;
  try {
    result = await source.poll();
  } finally {
    mock.restore();
  }
  assert.equal(result.added, 0);
  assert.match(result.notes, /Limb Loss Forum: HTTP 404/);

  const dead = feeds.list().find((f) => f.label === 'Limb Loss Forum');
  assert.match(dead.last_error, /404/);
  const alive = feeds.list().find((f) => f.label === 'r/amputee');
  assert.equal(alive.last_error, null);
  assert.ok(alive.last_fetched_at);
});

test('every feed failing is a source failure, not a quiet success', async () => {
  const mock = mockFetch({ 'example.org': { status: 500, body: 'boom' } });
  try {
    await assert.rejects(() => source.poll(), /all 2 feed\(s\) failed/);
  } finally {
    mock.restore();
  }
});

test('addresses are normalized and rubbish is rejected', () => {
  assert.equal(feeds.normalizeUrl('forum.example.org/x.rss'), 'https://forum.example.org/x.rss');
  assert.throws(() => feeds.normalizeUrl(''), /required/);
  assert.throws(() => feeds.normalizeUrl('ftp://example.org/feed'), /http and https/);
});
