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
