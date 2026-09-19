'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb, mockFetch } = require('./helpers');

useTempDb('replying');
process.env.REDDIT_CLIENT_ID = 'rid';
process.env.REDDIT_CLIENT_SECRET = 'rsecret';
process.env.X_CLIENT_ID = 'xid';
process.env.GOOGLE_CLIENT_ID = 'gid';
process.env.GOOGLE_CLIENT_SECRET = 'gsecret';

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const drafts = require('../src/lib/drafts');
const replies = require('../src/lib/replies');
const connections = require('../src/lib/connections');
const settings = require('../src/lib/settings');
const quota = require('../src/lib/quota');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');
const post = require('../src/connect/post');

keywords.create({ term: 'phantom limb pain' });

function capture(source, candidate) {
  ingest(source, [candidate], matcherFor(source));
  return items.query({ source }).items.find((i) => i.external_id === candidate.external_id);
}

const redditPost = capture('reddit', {
  external_id: 't3_abc',
  author: 'u/newamputee',
  text: 'Does mirror therapy help phantom limb pain?',
  url: 'https://www.reddit.com/r/amputee/comments/abc/',
  timestamp: '2026-09-01T00:00:00Z',
  kind: 'post',
  origin: 'r/amputee',
});
const tweet = capture('x', {
  external_id: '1800000000000000001',
  author: '@someone',
  text: 'Two years after limb loss the phantom limb pain still wakes me.',
  url: 'https://x.com/someone/status/1800000000000000001',
  timestamp: '2026-09-02T00:00:00Z',
  kind: 'tweet',
});
const ytComment = capture('youtube', {
  external_id: 'comment:reply42',
  author: 'Jamie R.',
  text: 'Nobody warned me about phantom limb pain before surgery.',
  url: 'https://www.youtube.com/watch?v=vid1&lc=reply42',
  timestamp: '2026-09-03T00:00:00Z',
  kind: 'comment',
  origin: 'Amputee Life',
  meta: { video_id: 'vid1' },
});
const article = capture('pubmed', {
  external_id: 'pmid:1',
  text: 'Phantom limb pain review',
  url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
  timestamp: '2026-09-01T00:00:00Z',
  kind: 'article',
});

function link(provider, name) {
  connections.save(
    provider,
    { access_token: `${provider}-token`, refresh_token: 'r', expires_in: 3600 },
    { id: '1', name }
  );
}
function draftFor(item, content) {
  return drafts.create({ item_id: item.id, content, model: 'claude-opus-5' });
}

/* ------------------------------------------------------------------ targets */

test('the reply target names the account and the exact thread', () => {
  link('reddit', 'u/drsmith');
  const target = post.target(redditPost.id);
  assert.equal(target.can_reply, true);
  assert.equal(target.provider, 'reddit');
  assert.equal(target.account_name, 'u/drsmith');
  assert.equal(target.description, 'a post in r/amputee');
  assert.equal(target.target_id, 't3_abc');
});

test('research results are not repliable', () => {
  const target = post.target(article.id);
  assert.equal(target.can_reply, false);
  assert.match(target.reason, /not a question anyone posted/);
});

test('an unlinked platform says so rather than offering to send', () => {
  const target = post.target(tweet.id);
  assert.equal(target.can_reply, false);
  assert.equal(target.connected, false);
  assert.match(target.reason, /No X \(Twitter\) account is linked/);
});

/* ------------------------------------------------------------- safety rails */

test('a reply without an explicit confirmation is refused', async () => {
  const draft = draftFor(redditPost, 'Mirror therapy has reasonable evidence [1].');
  await assert.rejects(
    () => post.send({ draftId: draft.id, confirm: false }),
    (err) => err.status === 428 && /explicit confirmation/.test(err.message)
  );
  assert.equal(replies.forItem(redditPost.id).length, 0, 'nothing recorded, nothing sent');
});

test('replying can be switched off entirely', async () => {
  settings.set('reply.enabled', 'false');
  const draft = draftFor(redditPost, 'Text.');
  await assert.rejects(
    () => post.send({ draftId: draft.id, confirm: true }),
    (err) => err.status === 403
  );
  settings.set('reply.enabled', 'true');
});

test('an empty draft is never sent', async () => {
  const draft = draftFor(redditPost, '   ');
  await assert.rejects(() => post.send({ draftId: draft.id, confirm: true }), /empty/);
});

test('a draft on an unrepliable item is refused', async () => {
  const draft = draftFor(article, 'Some text.');
  await assert.rejects(() => post.send({ draftId: draft.id, confirm: true }), /cannot be replied to/);
});

/* -------------------------------------------------------------------- reddit */

test('a Reddit reply posts to the captured thing_id and is recorded', async () => {
  const draft = draftFor(redditPost, 'Mirror therapy has reasonable evidence behind it [1].');
  let body;
  let auth;
  const mock = mockFetch({
    'oauth.reddit.com/api/comment': (url, options) => {
      body = options.body;
      auth = options.headers.Authorization || options.headers.authorization;
      return {
        body: {
          json: {
            errors: [],
            data: { things: [{ data: { name: 't1_new', permalink: '/r/amputee/comments/abc/x/' } }] },
          },
        },
      };
    },
  });

  let result;
  try {
    result = await post.send({ draftId: draft.id, confirm: true });
  } finally {
    mock.restore();
  }

  assert.match(body, /thing_id=t3_abc/);
  assert.match(body, /api_type=json/);
  assert.equal(auth, 'Bearer reddit-token');
  assert.equal(result.reply.status, 'posted');
  assert.equal(result.reply.remote_id, 't1_new');
  assert.equal(result.reply.url, 'https://www.reddit.com/r/amputee/comments/abc/x/');
  assert.equal(result.account, 'u/drsmith');

  // Sending marks both the draft and the question as used.
  assert.equal(drafts.get(draft.id).status, 'used');
  assert.equal(items.get(redditPost.id).status, 'used');

  // The record keeps what was actually sent.
  const recorded = replies.postedForItem(redditPost.id)[0];
  assert.equal(recorded.content, 'Mirror therapy has reasonable evidence behind it [1].');
  assert.equal(recorded.target_id, 't3_abc');
});

test("Reddit's 200-with-errors responses are treated as failures", async () => {
  const draft = draftFor(redditPost, 'Another reply.');
  const mock = mockFetch({
    'oauth.reddit.com/api/comment': {
      body: { json: { errors: [['RATELIMIT', 'you are doing that too much', 'ratelimit']] } },
    },
  });
  try {
    await assert.rejects(
      () => post.send({ draftId: draft.id, confirm: true }),
      /doing that too much/
    );
  } finally {
    mock.restore();
  }

  const failed = replies.forItem(redditPost.id)[0];
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /RATELIMIT/);
  assert.equal(drafts.get(draft.id).status, 'draft', 'a failed send does not mark the draft used');
  assert.match(connections.get('reddit').last_error, /doing that too much/);
});

test('a second reply to the same thread is surfaced beforehand', () => {
  const target = post.target(redditPost.id);
  assert.equal(target.already_posted.length, 1);
  assert.equal(target.already_posted[0].remote_id, 't1_new');
});

/* ------------------------------------------------------------------------ x */

test('an X reply targets the captured tweet id', async () => {
  link('x', '@drsmith');
  const draft = draftFor(tweet, 'Short evidence-based reply.');
  let payload;
  const mock = mockFetch({
    'api.x.com/2/tweets': (url, options) => {
      payload = JSON.parse(options.body);
      return { body: { data: { id: '1900000000000000002' } } };
    },
  });
  let result;
  try {
    result = await post.send({ draftId: draft.id, confirm: true });
  } finally {
    mock.restore();
  }
  assert.equal(payload.reply.in_reply_to_tweet_id, '1800000000000000001');
  assert.equal(payload.text, 'Short evidence-based reply.');
  assert.equal(result.reply.url, 'https://x.com/drsmith/status/1900000000000000002');
});

test('a draft too long for X is caught before it is sent', async () => {
  const draft = draftFor(tweet, 'x'.repeat(281));
  const mock = mockFetch({});
  try {
    await assert.rejects(
      () => post.send({ draftId: draft.id, confirm: true }),
      /limited to 280 characters; this draft is 281/
    );
    assert.equal(mock.calls.length, 0, 'nothing was sent to X');
  } finally {
    mock.restore();
  }
});

/* ------------------------------------------------------------------ youtube */

test('a YouTube reply hangs off the top-level comment and costs quota', async () => {
  link('youtube', 'Dr Smith');
  const before = quota.used('youtube');
  const draft = draftFor(ytComment, 'General information, not advice for you specifically.');

  let inserted;
  const mock = mockFetch({
    'youtube/v3/comments?part=snippet&id=': {
      // The captured comment is itself a reply, so its parent is the thread.
      body: { items: [{ id: 'reply42', snippet: { parentId: 'topLevel7' } }] },
    },
    'youtube/v3/comments?part=snippet': (url, options) => {
      if (options.method !== 'POST') return { body: { items: [] } };
      inserted = JSON.parse(options.body);
      return { body: { id: 'newcomment9' } };
    },
  });

  let result;
  try {
    result = await post.send({ draftId: draft.id, confirm: true });
  } finally {
    mock.restore();
  }

  assert.equal(inserted.snippet.parentId, 'topLevel7');
  assert.equal(result.reply.url, 'https://www.youtube.com/watch?v=vid1&lc=newcomment9');
  assert.equal(quota.used('youtube') - before, 51, 'one lookup (1) plus one insert (50)');
});

test('a reply to a video opens a new comment thread', async () => {
  const video = capture('youtube', {
    external_id: 'video:vid9',
    author: 'Prosthetics Explained',
    text: 'How a prosthetic socket is made, and phantom limb pain basics',
    url: 'https://www.youtube.com/watch?v=vid9',
    timestamp: '2026-09-04T00:00:00Z',
    kind: 'video',
    meta: { title: 'How a socket is made' },
  });
  const draft = draftFor(video, 'A general comment about the evidence.');

  let payload;
  const mock = mockFetch({
    'youtube/v3/commentThreads?part=snippet': (url, options) => {
      payload = JSON.parse(options.body);
      return { body: { id: 'thread1', snippet: { topLevelComment: { id: 'top1' } } } };
    },
  });
  let result;
  try {
    result = await post.send({ draftId: draft.id, confirm: true });
  } finally {
    mock.restore();
  }
  assert.equal(payload.snippet.videoId, 'vid9');
  assert.equal(payload.snippet.topLevelComment.snippet.textOriginal, 'A general comment about the evidence.');
  assert.equal(result.reply.url, 'https://www.youtube.com/watch?v=vid9&lc=top1');
});

/* ------------------------------------------------------------------- record */

test('every send attempt is on the record, successful or not', () => {
  const all = replies.recent(50);
  assert.ok(all.length >= 5);
  assert.deepEqual(
    Object.keys(replies.summary()).sort(),
    ['failed', 'posted']
  );
  assert.ok(replies.summary().posted >= 4);
  assert.ok(replies.summary().failed >= 1);
});
