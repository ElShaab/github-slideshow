'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('reddit');

const { db } = require('../src/db');
const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const subreddits = require('../src/lib/subreddits');
const reddit = require('../src/sources/reddit');

keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'prosthetic' });
keywords.create({
  term: 'osseointegration',
  scope: 'specific',
  sources: ['pubmed'],
});

db.prepare('DELETE FROM subreddits').run();
subreddits.add('amputee');
settings.set('reddit.include_comments', 'true');

const redditPosts = {
  body: {
    data: {
      children: [
        {
          data: {
            name: 't3_aaa',
            id: 'aaa',
            title: 'Phantom limb pain at night',
            selftext: 'Anyone found something that helps?',
            author: 'someone',
            permalink: '/r/amputee/comments/aaa/phantom/',
            created_utc: 1700000000,
            subreddit: 'amputee',
            score: 12,
            num_comments: 3,
          },
        },
        {
          data: {
            name: 't3_bbb',
            id: 'bbb',
            title: 'Weekly check-in thread',
            selftext: 'Say hello',
            author: 'mod',
            permalink: '/r/amputee/comments/bbb/weekly/',
            created_utc: 1700000100,
            subreddit: 'amputee',
          },
        },
      ],
    },
  },
};

const redditComments = {
  body: {
    data: {
      children: [
        {
          data: {
            name: 't1_ccc',
            id: 'ccc',
            body: 'My prosthetic socket never fit right either',
            author: 'commenter',
            permalink: '/r/amputee/comments/aaa/phantom/ccc/',
            created_utc: 1700000200,
            subreddit: 'amputee',
            link_title: 'Phantom limb pain at night',
          },
        },
      ],
    },
  },
};

test('reddit poll normalizes posts and comments, keeping only matches', async () => {
  const mock = mockFetch({
    '/r/amputee/new.json': redditPosts,
    '/r/amputee/comments.json': redditComments,
  });
  try {
    const result = await reddit.poll();
    assert.equal(result.fetched, 3);
    assert.equal(result.added, 2);
    assert.equal(result.unmatched, 1);
  } finally {
    mock.restore();
  }

  const post = items.query({ source: 'reddit' }).items.find(
    (i) => i.external_id === 't3_aaa'
  );
  assert.equal(post.author, 'u/someone');
  assert.equal(post.origin, 'r/amputee');
  assert.equal(post.kind, 'post');
  assert.equal(post.url, 'https://www.reddit.com/r/amputee/comments/aaa/phantom/');
  assert.equal(post.timestamp, '2023-11-14T22:13:20.000Z');
  assert.equal(post.keyword_matched, 'phantom limb pain');

  const comment = items.query({ source: 'reddit' }).items.find(
    (i) => i.external_id === 't1_ccc'
  );
  assert.equal(comment.kind, 'comment');
  assert.equal(comment.keyword_matched, 'prosthetic');
});

test('reddit re-poll adds nothing new', async () => {
  const mock = mockFetch({
    '/r/amputee/new.json': redditPosts,
    '/r/amputee/comments.json': redditComments,
  });
  try {
    const result = await reddit.poll();
    assert.equal(result.added, 0);
    assert.equal(result.duplicates, 3);
  } finally {
    mock.restore();
  }
});

test('one failing subreddit does not abort the rest of the poll', async () => {
  subreddits.add('prosthetics');
  const mock = mockFetch({
    '/r/amputee/new.json': redditPosts,
    '/r/amputee/comments.json': redditComments,
    '/r/prosthetics/': { status: 404, body: { error: 404 } },
  });
  try {
    const result = await reddit.poll();
    assert.match(result.notes, /r\/prosthetics/);
  } finally {
    mock.restore();
  }
  db.prepare("DELETE FROM subreddits WHERE name = 'prosthetics'").run();
});

/* ------------------------------------------------- blocked public endpoints */

test('a 403 block page becomes an actionable error, not a wall of CSS', async () => {
  const blockPage =
    '<body class=theme-beta><div><style>.theme-light,:root{--rem360:22.5rem;--rem320:20rem;' +
    '--rem192:12rem;--rem144:9rem}</style></div></body>';
  const mock = mockFetch({
    'www.reddit.com': { status: 403, body: blockPage, headers: { 'content-type': 'text/html' } },
  });
  let message = '';
  try {
    await reddit.poll();
  } catch (err) {
    message = err.message;
  } finally {
    mock.restore();
  }

  assert.match(message, /datacenter IPs/);
  assert.match(message, /REDDIT_CLIENT_ID/);
  assert.ok(!message.includes('--rem360'), 'the block page markup must not reach the log');
  // One cause, stated once, rather than repeated per subreddit.
  assert.equal(message.match(/datacenter IPs/g).length, 1);
});

test('with client credentials, reads go through the OAuth API', async () => {
  const config = require('../src/config');
  config.reddit.clientId = 'cid';
  config.reddit.clientSecret = 'csecret';
  reddit.forgetToken();

  const seen = [];
  const headers = {};
  const mock = mockFetch({
    'www.reddit.com/api/v1/access_token': (url, options) => {
      seen.push(url);
      return { body: { access_token: 'app-token', expires_in: 3600 } };
    },
    'oauth.reddit.com': (url, options) => {
      seen.push(url);
      headers[url] = options.headers;
      return { body: { data: { children: [] } } };
    },
  });
  try {
    await reddit.poll();
  } finally {
    mock.restore();
  }

  assert.ok(seen.some((u) => u.includes('/api/v1/access_token')), 'an app token is fetched');
  const listing = seen.find((u) => u.includes('oauth.reddit.com'));
  assert.ok(listing, 'listings come from the OAuth host');
  assert.ok(!listing.includes('.json'), 'the OAuth host has no .json suffix');
  assert.equal(headers[listing].Authorization, 'Bearer app-token');
  assert.match(headers[listing]['User-Agent'], /^nodejs:amputee-research-dashboard:/);

  config.reddit.clientId = '';
  config.reddit.clientSecret = '';
  reddit.forgetToken();
});

test('an app without a secret uses the installed-client grant', async () => {
  const config = require('../src/config');
  config.reddit.clientId = 'cid-only';
  config.reddit.clientSecret = '';
  reddit.forgetToken();

  let tokenBody = '';
  const mock = mockFetch({
    'www.reddit.com/api/v1/access_token': (url, options) => {
      tokenBody = options.body;
      return { body: { access_token: 'installed-token', expires_in: 3600 } };
    },
    'oauth.reddit.com': { body: { data: { children: [] } } },
  });
  try {
    await reddit.poll();
  } finally {
    mock.restore();
  }
  assert.match(tokenBody, /installed_client/);
  assert.match(tokenBody, /device_id=DO_NOT_TRACK_THIS_DEVICE/);

  config.reddit.clientId = '';
  reddit.forgetToken();
});

test('the user agent names the account the dashboard knows about', () => {
  const manualAccounts = require('../src/lib/manualAccounts');
  assert.match(reddit.redditUserAgent(), /^nodejs:amputee-research-dashboard:[\d.]+$/);
  manualAccounts.save('reddit', { handle: 'u/someone', profile_url: null });
  assert.match(reddit.redditUserAgent(), /\(by \/u\/someone\)$/);
  manualAccounts.remove('reddit');
});
