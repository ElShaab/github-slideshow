'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { useTempDb } = require('./helpers');

useTempDb('manual-accounts');

const keywords = require('../src/lib/keywords');
const items = require('../src/lib/items');
const drafts = require('../src/lib/drafts');
const replies = require('../src/lib/replies');
const manualAccounts = require('../src/lib/manualAccounts');
const connect = require('../src/connect');
const post = require('../src/connect/post');
const { ingest } = require('../src/lib/ingest');
const { matcherFor } = require('../src/lib/matcher');

keywords.create({ term: 'phantom limb pain' });
ingest(
  'reddit',
  [
    {
      external_id: 't3_abc',
      author: 'u/newamputee',
      text: 'Does mirror therapy help phantom limb pain?',
      url: 'https://www.reddit.com/r/amputee/comments/abc/',
      timestamp: '2026-09-20T00:00:00Z',
      kind: 'post',
      origin: 'r/amputee',
    },
  ],
  matcherFor('reddit')
);
const question = items.query({ source: 'reddit' }).items[0];

test('handles are accepted in every form people write them', () => {
  const reddit = connect.get('reddit');
  for (const input of ['AmputeeAssit', 'u/AmputeeAssit', 'https://www.reddit.com/user/AmputeeAssit/']) {
    assert.equal(reddit.normalizeHandle(input).handle, 'u/AmputeeAssit');
  }
  assert.equal(
    reddit.normalizeHandle('AmputeeAssit').profile_url,
    'https://www.reddit.com/user/AmputeeAssit/'
  );
  assert.equal(connect.get('x').normalizeHandle('@drsmith').handle, '@drsmith');
  assert.equal(connect.get('youtube').normalizeHandle('https://www.youtube.com/@AmputeeLife').handle, '@AmputeeLife');
});

test('nonsense handles are rejected', () => {
  assert.throws(() => connect.get('reddit').normalizeHandle('not a username'), /not a Reddit username/);
  assert.throws(() => connect.get('x').normalizeHandle('way_too_long_a_handle_here'), /not an X handle/);
});

test('a hand-declared account shows up on the reply target', () => {
  assert.equal(post.target(question.id).manual_account, null);

  manualAccounts.save('reddit', connect.get('reddit').normalizeHandle('AmputeeAssit'));
  const target = post.target(question.id);

  assert.equal(target.manual_account.handle, 'u/AmputeeAssit');
  assert.equal(target.can_reply, false, 'declaring an account does not enable API posting');
  assert.match(target.reason, /copy and paste the reply as u\/AmputeeAssit/);
});

test('marking a draft replied records it against that account', () => {
  const draft = drafts.create({ item_id: question.id, content: 'Mirror therapy has decent evidence [1].' });
  const result = post.recordManual({ draftId: draft.id, url: 'https://www.reddit.com/r/amputee/comments/abc/x/' });

  assert.equal(result.account, 'u/AmputeeAssit');
  assert.equal(result.reply.method, 'manual');
  assert.equal(result.reply.status, 'posted');
  assert.equal(result.reply.url, 'https://www.reddit.com/r/amputee/comments/abc/x/');
  assert.equal(result.reply.content, 'Mirror therapy has decent evidence [1].');

  // The loop closes: draft and question both move to used.
  assert.equal(drafts.get(draft.id).status, 'used');
  assert.equal(items.get(question.id).status, 'used');

  // And it shows up as a prior reply next time.
  assert.equal(post.target(question.id).already_posted.length, 1);
});

test('without a link, the record points at the original thread', () => {
  const draft = drafts.create({ item_id: question.id, content: 'A second reply.' });
  const result = post.recordManual({ draftId: draft.id });
  assert.equal(result.reply.url, question.url);
});

test('API sends and hand-posted replies are distinguishable in the log', () => {
  const log = replies.forItem(question.id);
  assert.ok(log.length >= 2);
  assert.ok(log.every((r) => r.method === 'manual'));

  replies.record({
    item_id: question.id,
    provider: 'reddit',
    target_id: 't3_abc',
    content: 'Sent through the API.',
    status: 'posted',
  });
  assert.equal(replies.forItem(question.id)[0].method, 'api', 'API is the default');
});

test('forgetting the account leaves the reply history intact', () => {
  assert.equal(manualAccounts.remove('reddit'), true);
  assert.equal(manualAccounts.get('reddit'), null);
  assert.ok(replies.forItem(question.id).length >= 3);
  assert.equal(post.target(question.id).manual_account, null);
});
