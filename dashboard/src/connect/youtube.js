'use strict';

const config = require('../config');
const { fetchJson } = require('../lib/http');
const quota = require('../lib/quota');

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

// Documented quota cost of the write endpoints.
const COST = { insert: 50, list: 1 };

async function token(form) {
  const { data } = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      ...form,
    }).toString(),
    retries: 1,
  });
  if (!data || !data.access_token) throw new Error('Google did not return an access token');
  return data;
}

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  scopes: SCOPES,
  usesPkce: false,
  registration:
    'console.cloud.google.com → Credentials → OAuth client ID (Web application) → add the redirect URI below, and enable the YouTube Data API v3',

  isRegistered: () => !!(config.google.clientId && config.google.clientSecret),

  authorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // Google only returns a refresh token with these two together.
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  exchangeCode({ code, redirectUri }) {
    return token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  },

  refresh(refreshToken) {
    return token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  },

  async identity(accessToken) {
    const { data } = await fetchJson(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const channel = ((data && data.items) || [])[0];
    if (!channel) throw new Error('That Google account has no YouTube channel');
    return { id: channel.id, name: channel.snippet ? channel.snippet.title : channel.id };
  },

  canReplyTo(item) {
    return item.source === 'youtube' && /^(comment|video):/.test(item.external_id || '');
  },

  describeTarget(item) {
    return item.external_id.startsWith('comment:')
      ? `a reply to ${item.author || 'a comment'} on ${item.origin || 'YouTube'}`
      : `a new comment on the video "${(item.meta && item.meta.title) || item.origin || 'this video'}"`;
  },

  async postReply({ accessToken, item, text }) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    if (item.external_id.startsWith('comment:')) {
      const commentId = item.external_id.slice('comment:'.length);

      // A reply must hang off the top-level comment, so if the captured
      // comment is itself a reply, walk up to its parent first.
      quota.record('youtube', COST.list);
      const { data: lookup } = await fetchJson(
        `https://www.googleapis.com/youtube/v3/comments?part=snippet&id=${encodeURIComponent(commentId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const found = ((lookup && lookup.items) || [])[0];
      const parentId =
        found && found.snippet && found.snippet.parentId
          ? found.snippet.parentId
          : commentId;

      quota.record('youtube', COST.insert);
      const { data } = await fetchJson(
        'https://www.googleapis.com/youtube/v3/comments?part=snippet',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
          retries: 0,
        }
      );
      if (!data || !data.id) throw new Error('YouTube returned no comment id');
      const videoId = (item.meta && item.meta.video_id) || null;
      return {
        remote_id: data.id,
        url: videoId
          ? `https://www.youtube.com/watch?v=${videoId}&lc=${data.id}`
          : item.url || null,
      };
    }

    const videoId = item.external_id.slice('video:'.length);
    quota.record('youtube', COST.insert);
    const { data } = await fetchJson(
      'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } },
        }),
        retries: 0,
      }
    );
    if (!data || !data.id) throw new Error('YouTube returned no comment id');
    const commentId =
      data.snippet && data.snippet.topLevelComment ? data.snippet.topLevelComment.id : data.id;
    return {
      remote_id: commentId,
      url: `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`,
    };
  },

  quotaCost: COST,
};
