'use strict';

const connect = require('./index');
const connections = require('../lib/connections');
const drafts = require('../lib/drafts');
const items = require('../lib/items');
const replies = require('../lib/replies');
const settings = require('../lib/settings');

/**
 * What the dashboard can tell the physician before they press send: which
 * account the reply would go out as, exactly what it would be replying to,
 * and whether this thread already has a reply.
 */
function target(itemId) {
  const item = items.get(itemId);
  if (!item) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }

  const provider = connect.providerFor(item);
  if (!provider) {
    return {
      item_id: item.id,
      can_reply: false,
      reason:
        item.source === 'pubmed' || item.source === 'websearch'
          ? 'This is a research result, not a question anyone posted.'
          : 'This source has no reply endpoint.',
      already_posted: replies.postedForItem(item.id),
    };
  }

  const connection = connections.get(provider.id);
  return {
    item_id: item.id,
    can_reply: !!connection && settings.getBool('reply.enabled', true),
    provider: provider.id,
    provider_label: provider.label,
    registered: provider.isRegistered(),
    connected: !!connection,
    account_name: connection ? connection.account_name : null,
    // Shown verbatim in the confirmation, so the destination is never a guess.
    description: provider.describeTarget(item),
    target_id: item.external_id,
    target_url: item.url,
    reason: !connection
      ? `No ${provider.label} account is linked yet.`
      : !settings.getBool('reply.enabled', true)
        ? 'Replying is switched off in settings.'
        : null,
    already_posted: replies.postedForItem(item.id),
  };
}

/**
 * Send one reply. Only ever called from an explicit, confirmed click on a
 * single draft: nothing in this application posts on a schedule, in bulk, or
 * without the text having been shown first.
 */
async function send({ draftId, confirm }) {
  if (!settings.getBool('reply.enabled', true)) {
    const err = new Error('Replying is switched off in settings.');
    err.status = 403;
    throw err;
  }
  if (settings.getBool('reply.confirm_each', true) && confirm !== true) {
    const err = new Error('A reply needs an explicit confirmation.');
    err.status = 428;
    throw err;
  }

  const draft = drafts.get(draftId);
  if (!draft) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  const item = items.get(draft.item_id);
  if (!item) {
    const err = new Error('The question this draft belongs to is gone');
    err.status = 404;
    throw err;
  }

  const provider = connect.providerFor(item);
  if (!provider) {
    const err = new Error('This item cannot be replied to from the dashboard');
    err.status = 400;
    throw err;
  }

  const text = String(draft.content || '').trim();
  if (!text) {
    const err = new Error('The draft is empty');
    err.status = 400;
    throw err;
  }

  const { connection, accessToken } = await connect.accessTokenFor(provider.id);

  try {
    const result = await provider.postReply({ accessToken, item, text, connection });
    const reply = replies.record({
      item_id: item.id,
      draft_id: draft.id,
      provider: provider.id,
      target_id: item.external_id,
      content: text,
      status: 'posted',
      remote_id: result.remote_id,
      url: result.url,
    });
    // A sent draft is a used draft.
    drafts.setStatus(draft.id, 'used');
    items.setStatus(item.id, 'used');
    return { reply, draft: drafts.get(draft.id), account: connection.account_name };
  } catch (err) {
    replies.record({
      item_id: item.id,
      draft_id: draft.id,
      provider: provider.id,
      target_id: item.external_id,
      content: text,
      status: 'failed',
      error: err.message,
    });
    connections.setError(provider.id, err.message);
    const wrapped = new Error(`${provider.label} rejected the reply: ${err.message}`);
    wrapped.status = err.status && err.status < 500 ? err.status : 502;
    throw wrapped;
  }
}

module.exports = { target, send };
