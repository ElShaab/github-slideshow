'use strict';

const config = require('../config');
const { fetchJson, sleep } = require('../lib/http');
const { ingest } = require('../lib/ingest');
const { matcherFor } = require('../lib/matcher');
const settings = require('../lib/settings');
const state = require('../lib/state');
const quota = require('../lib/quota');
const channels = require('../lib/youtubeChannels');

const API = 'https://www.googleapis.com/youtube/v3';

// Documented quota cost per call for the endpoints used here.
const COST = { search: 100, commentThreads: 1, videos: 1, channels: 1 };

function dailyQuota() {
  return settings.getNumber('youtube.daily_quota', 10000);
}

function reserve() {
  return settings.getNumber('youtube.quota_reserve', 500);
}

function remainingUnits() {
  return quota.remaining('youtube', dailyQuota(), reserve());
}

async function call(endpoint, params, cost) {
  if (cost > remainingUnits()) {
    const err = new Error(
      `YouTube daily quota guard: ${endpoint} needs ${cost} units, ` +
        `${remainingUnits()} left of ${dailyQuota()} (reserve ${reserve()})`
    );
    err.code = 'QUOTA_GUARD';
    throw err;
  }
  const search = new URLSearchParams({ ...params, key: config.youtube.apiKey });
  // Count the units before the call: a failed request still costs quota.
  quota.record('youtube', cost);
  const { data } = await fetchJson(`${API}/${endpoint}?${search}`, { retries: 1 });
  return data;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function normalizeComment(comment, channel) {
  const s = comment.snippet || {};
  const videoId = s.videoId || null;
  return {
    external_id: `comment:${comment.id}`,
    author: s.authorDisplayName || null,
    text: stripHtml(s.textOriginal || s.textDisplay),
    url: videoId
      ? `https://www.youtube.com/watch?v=${videoId}&lc=${comment.id}`
      : null,
    timestamp: s.publishedAt,
    kind: 'comment',
    origin: channel && channel.title ? channel.title : s.authorChannelUrl || null,
    meta: {
      video_id: videoId,
      channel_id: channel ? channel.channel_id : s.channelId || null,
      likes: s.likeCount,
      updated_at: s.updatedAt || null,
    },
  };
}

function normalizeVideo(item) {
  const s = item.snippet || {};
  const videoId = item.id && item.id.videoId ? item.id.videoId : item.id;
  return {
    external_id: `video:${videoId}`,
    author: s.channelTitle || null,
    text: [stripHtml(s.title), stripHtml(s.description)]
      .filter(Boolean)
      .join('\n\n'),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    timestamp: s.publishedAt,
    kind: 'video',
    origin: s.channelTitle || null,
    meta: {
      title: stripHtml(s.title),
      video_id: videoId,
      channel_id: s.channelId || null,
      thumbnail:
        s.thumbnails && s.thumbnails.medium ? s.thumbnails.medium.url : null,
    },
  };
}

function readCursor() {
  const raw = state.getCursor('youtube');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeCursor(next) {
  state.setCursor('youtube', JSON.stringify(next));
}

async function pollChannelComments(matcher, totals, notes) {
  const list = channels.enabled();
  if (!list.length) {
    notes.push('no channel IDs configured');
    return;
  }
  for (const channel of list) {
    if (COST.commentThreads > remainingUnits()) {
      notes.push('quota guard stopped channel comment polling');
      return;
    }
    try {
      const data = await call(
        'commentThreads',
        {
          part: 'snippet,replies',
          allThreadsRelatedToChannelId: channel.channel_id,
          order: 'time',
          maxResults: '50',
          textFormat: 'plainText',
        },
        COST.commentThreads
      );
      const candidates = [];
      for (const thread of data.items || []) {
        const top =
          thread.snippet && thread.snippet.topLevelComment
            ? thread.snippet.topLevelComment
            : null;
        if (top) candidates.push(normalizeComment(top, channel));
        for (const reply of (thread.replies && thread.replies.comments) || []) {
          candidates.push(normalizeComment(reply, channel));
        }
      }
      const stats = ingest('youtube', candidates, matcher);
      totals.fetched += stats.fetched;
      totals.added += stats.added;
      totals.duplicates += stats.duplicates;
      totals.unmatched += stats.unmatched;
    } catch (err) {
      if (err.code === 'QUOTA_GUARD') {
        notes.push(err.message);
        return;
      }
      if (err.status === 429 || err.status === 403) {
        // 403 here is usually "comments disabled" for one channel, but it is
        // also how the API reports quotaExceeded - check before swallowing it.
        const reason =
          err.body &&
          err.body.error &&
          err.body.error.errors &&
          err.body.error.errors[0]
            ? err.body.error.errors[0].reason
            : '';
        if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') throw err;
      }
      notes.push(`${channel.title || channel.channel_id}: ${err.message}`);
    }
    await sleep(500);
  }
}

async function pollVideoSearch(matcher, totals, notes) {
  if (COST.search > remainingUnits()) {
    notes.push(
      `skipped video search: needs ${COST.search} units, ${remainingUnits()} left today`
    );
    return;
  }

  const maxTerms = Math.max(
    settings.getNumber('youtube.max_search_keywords', 4),
    1
  );
  const terms = matcher.keywords.slice(0, maxTerms).map((k) => k.term);
  if (!terms.length) return;

  // YouTube's q parameter treats "|" as OR; quote phrases so they stay intact.
  const q = terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' | ');

  const cursor = readCursor();
  const publishedAfter =
    cursor.searchAfter ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const data = await call(
    'search',
    {
      part: 'snippet',
      q,
      type: 'video',
      order: 'date',
      maxResults: '50',
      publishedAfter,
    },
    COST.search
  );

  const candidates = (data.items || []).map((item) => {
    const normalized = normalizeVideo(item);
    normalized.fallbackKeyword = terms[0];
    return normalized;
  });

  const stats = ingest('youtube', candidates, matcher);
  totals.fetched += stats.fetched;
  totals.added += stats.added;
  totals.duplicates += stats.duplicates;
  totals.unmatched += stats.unmatched;

  writeCursor({ ...cursor, searchAfter: new Date().toISOString() });
  if (terms.length < matcher.keywords.length) {
    notes.push(
      `video search used the first ${terms.length} of ${matcher.keywords.length} keywords (quota)`
    );
  }
}

async function poll() {
  if (!config.youtube.apiKey) throw new Error('YOUTUBE_API_KEY is not set');

  const matcher = matcherFor('youtube');
  if (matcher.isEmpty) {
    return { fetched: 0, added: 0, notes: 'no keywords apply to YouTube' };
  }

  const totals = { fetched: 0, added: 0, duplicates: 0, unmatched: 0 };
  const notes = [];

  if (settings.getBool('youtube.channel_comments', true)) {
    await pollChannelComments(matcher, totals, notes);
  }
  if (settings.getBool('youtube.search_videos', true)) {
    await pollVideoSearch(matcher, totals, notes);
  }

  notes.push(`quota used today: ${quota.used('youtube')}/${dailyQuota()}`);
  return { ...totals, notes: notes.join('; ') };
}

/** Resolve a channel ID, @handle or channel URL into { channel_id, title }. */
async function resolveChannel(input) {
  if (!config.youtube.apiKey) throw new Error('YOUTUBE_API_KEY is not set');
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Channel ID or handle is required');

  const urlChannel = raw.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);
  const urlHandle = raw.match(/youtube\.com\/@([A-Za-z0-9_.-]+)/);
  const id = urlChannel ? urlChannel[1] : /^UC[A-Za-z0-9_-]{20,24}$/.test(raw) ? raw : null;
  const handle = urlHandle ? urlHandle[1] : raw.startsWith('@') ? raw.slice(1) : null;

  const params = { part: 'snippet' };
  if (id) params.id = id;
  else if (handle) params.forHandle = `@${handle}`;
  else throw Object.assign(new Error(`Could not read a channel from "${raw}"`), { status: 400 });

  const data = await call('channels', params, COST.channels);
  const item = (data.items || [])[0];
  if (!item) {
    throw Object.assign(new Error(`No YouTube channel found for "${raw}"`), {
      status: 404,
    });
  }
  return { channel_id: item.id, title: item.snippet ? item.snippet.title : null };
}

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  credentials: [
    { env: 'YOUTUBE_API_KEY', label: 'YouTube Data API v3 key', required: true },
  ],
  isConfigured: () => !!config.youtube.apiKey,
  describe: () => ({
    channels: channels.list(),
    channel_comments: settings.getBool('youtube.channel_comments', true),
    search_videos: settings.getBool('youtube.search_videos', true),
    quota: {
      daily: dailyQuota(),
      reserve: reserve(),
      used_today: quota.used('youtube'),
      remaining: remainingUnits(),
      calls_today: quota.calls('youtube'),
      resets: 'midnight America/Los_Angeles',
      history: quota.history('youtube', 7),
    },
  }),
  poll,
  resolveChannel,
  stripHtml,
};
