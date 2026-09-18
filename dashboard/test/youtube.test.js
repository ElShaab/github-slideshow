'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('youtube');
process.env.YOUTUBE_API_KEY = 'test-key';

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const settings = require('../src/lib/settings');
const quota = require('../src/lib/quota');
const youtubeChannels = require('../src/lib/youtubeChannels');
const youtube = require('../src/sources/youtube');

keywords.create({ term: 'phantom limb pain' });
keywords.create({ term: 'prosthetic' });

const commentThreads = {
  body: {
    items: [
      {
        snippet: {
          topLevelComment: {
            id: 'c1',
            snippet: {
              authorDisplayName: 'Viewer One',
              textOriginal: 'The phantom limb pain part really landed for me',
              publishedAt: '2024-05-01T12:00:00Z',
              videoId: 'vid123',
              likeCount: 4,
            },
          },
        },
        replies: {
          comments: [
            {
              id: 'c2',
              snippet: {
                authorDisplayName: 'Viewer Two',
                textOriginal: 'Ask your prosthetist about a new prosthetic liner',
                publishedAt: '2024-05-01T13:00:00Z',
                videoId: 'vid123',
              },
            },
            {
              id: 'c3',
              snippet: {
                authorDisplayName: 'Viewer Three',
                textOriginal: 'Great video, thanks',
                publishedAt: '2024-05-01T14:00:00Z',
                videoId: 'vid123',
              },
            },
          ],
        },
      },
    ],
  },
};

const videoSearch = {
  body: {
    items: [
      {
        id: { videoId: 'vid999' },
        snippet: {
          title: 'Living with phantom limb pain',
          description: 'A physician explains &amp; answers questions',
          publishedAt: '2024-05-20T09:00:00Z',
          channelTitle: 'Limb Loss Channel',
          channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    ],
  },
};

test('youtube poll reads channel comments and keyword video search', async () => {
  youtubeChannels.add('UCaaaaaaaaaaaaaaaaaaaaaa', 'Limb Loss Channel');
  const mock = mockFetch({
    'youtube/v3/commentThreads': commentThreads,
    'youtube/v3/search': videoSearch,
  });
  try {
    const result = await youtube.poll();
    assert.equal(result.fetched, 4);
    assert.equal(result.added, 3);
    assert.equal(result.unmatched, 1);
  } finally {
    mock.restore();
  }

  const comment = items.query({ source: 'youtube' }).items.find(
    (i) => i.external_id === 'comment:c1'
  );
  assert.equal(comment.author, 'Viewer One');
  assert.equal(comment.url, 'https://www.youtube.com/watch?v=vid123&lc=c1');

  const video = items.query({ source: 'youtube' }).items.find(
    (i) => i.external_id === 'video:vid999'
  );
  assert.match(video.text, /A physician explains & answers questions/);
});

test('youtube charges the documented quota cost per call', () => {
  // 1 unit for the channel comment thread + 100 for the keyword search.
  assert.equal(quota.used('youtube'), 101);
});

test('youtube quota guard blocks the expensive search near the cap', async () => {
  settings.set('youtube.daily_quota', '150');
  const mock = mockFetch({
    'youtube/v3/commentThreads': commentThreads,
    'youtube/v3/search': videoSearch,
  });
  try {
    const result = await youtube.poll();
    assert.match(result.notes, /skipped video search/);
  } finally {
    mock.restore();
    settings.set('youtube.daily_quota', '10000');
  }
  assert.ok(quota.used('youtube') < 250, 'search must not have been called');
});

test('a channel with comments disabled is reported, not fatal', async () => {
  const mock = mockFetch({
    'youtube/v3/commentThreads': {
      status: 403,
      body: { error: { errors: [{ reason: 'commentsDisabled' }] } },
    },
    'youtube/v3/search': videoSearch,
  });
  try {
    const result = await youtube.poll();
    assert.match(result.notes, /Limb Loss Channel/);
  } finally {
    mock.restore();
  }
});

test('quotaExceeded propagates so the scheduler can back the source off', async () => {
  const mock = mockFetch({
    'youtube/v3/commentThreads': {
      status: 403,
      body: { error: { errors: [{ reason: 'quotaExceeded' }] } },
    },
  });
  try {
    await assert.rejects(() => youtube.poll(), /403/);
  } finally {
    mock.restore();
  }
});
