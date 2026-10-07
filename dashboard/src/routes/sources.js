'use strict';

const express = require('express');
const scheduler = require('../scheduler');
const state = require('../lib/state');
const subreddits = require('../lib/subreddits');
const feeds = require('../lib/feeds');
const feedSource = require('../sources/feeds');
const reddit = require('../sources/reddit');
const missed = require('../lib/missed');
const keywordStore = require('../lib/keywords');

/** The question sources; literature is matched differently and kept apart. */
const COMMUNITY = ['reddit', 'x', 'youtube', 'feeds', 'websearch'];
const youtubeChannels = require('../lib/youtubeChannels');
const youtube = require('../sources/youtube');
const searchSites = require('../lib/searchSites');
const websearch = require('../sources/websearch');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ sources: scheduler.status(), logs: state.recentLogs(25) });
});

/**
 * What the sources fetched that no keyword matched, with the words that keep
 * recurring in it. This is the view that tells a keyword gap apart from a
 * dead source.
 */
router.get('/missed', (req, res) => {
  const wanted = String(req.query.source || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => COMMUNITY.includes(s));
  const sources = wanted.length ? wanted : COMMUNITY;

  const posts = missed.recent(sources);
  const tracked = keywordStore.list().map((k) => k.term);
  res.json({
    total: posts.length,
    by_source: sources.reduce((acc, source) => {
      const n = posts.filter((p) => p.source === source).length;
      if (n) acc[source] = n;
      return acc;
    }, {}),
    suggestions: missed.suggest(posts, tracked),
    posts: posts.slice(0, 60).map((p) => ({
      source: p.source,
      external_id: p.external_id,
      origin: p.origin || null,
      author: p.author || null,
      url: p.url || null,
      kind: p.kind || null,
      text: String(p.text || '').slice(0, 400),
    })),
  });
});

/** Every source, in turn, so an empty feed can be diagnosed in one click. */
router.post('/poll-all', async (req, res) => {
  res.json({ results: await scheduler.runAll({ manual: true, force: req.query.force === 'true' }) });
});

router.post('/:source/poll', async (req, res) => {
  // Manual "poll now" ignores the enabled flag so a source can be tested
  // before it is switched on, but still respects an active rate-limit backoff
  // unless force=true is passed.
  const result = await scheduler.runSource(req.params.source, {
    manual: true,
    force: req.query.force === 'true',
  });
  res.status(result.ok ? 200 : 202).json(result);
});

router.post('/:source/clear-backoff', (req, res) => {
  state.backOff(req.params.source, 0);
  res.json({ ok: true, source: req.params.source });
});

/* ---- Reddit: subreddit list ---- */

/** Tries every public address once and reports what each one answered. */
router.post('/reddit/diagnose', async (req, res) => {
  try {
    res.json(await reddit.diagnose());
  } catch (err) {
    res.status(502).json({ error: err.message || 'The check failed' });
  }
});

router.get('/reddit/subreddits', (req, res) => {
  res.json(subreddits.list());
});

router.post('/reddit/subreddits', (req, res) => {
  res.status(201).json(subreddits.add((req.body || {}).name));
});

router.patch('/reddit/subreddits/:id', (req, res) => {
  const ok = subreddits.setEnabled(Number(req.params.id), (req.body || {}).enabled);
  if (!ok) return res.status(404).json({ error: 'Subreddit not found' });
  res.json({ ok: true });
});

router.delete('/reddit/subreddits/:id', (req, res) => {
  if (!subreddits.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Subreddit not found' });
  }
  res.status(204).end();
});

/* ---- Feeds: any RSS or Atom address ---- */

router.get('/feeds/feeds', (req, res) => {
  res.json(feeds.list());
});

/**
 * Takes a feed address or the page that advertises one, checks it answers,
 * and stores it with the title the feed gives itself.
 */
router.post('/feeds/feeds', async (req, res) => {
  const body = req.body || {};
  try {
    const resolved = await feedSource.resolve(body.url);
    const saved = feeds.add({
      url: resolved.url,
      label: body.label || resolved.label,
      siteUrl: resolved.siteUrl,
    });
    res.status(201).json({ ...saved, items_seen: resolved.items });
  } catch (err) {
    res.status(err.status && err.status < 500 ? err.status : 502).json({
      error: err.message || 'Could not read that feed',
    });
  }
});

router.patch('/feeds/feeds/:id', (req, res) => {
  const ok = feeds.setEnabled(Number(req.params.id), (req.body || {}).enabled);
  if (!ok) return res.status(404).json({ error: 'Feed not found' });
  res.json({ ok: true });
});

router.delete('/feeds/feeds/:id', (req, res) => {
  if (!feeds.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Feed not found' });
  }
  res.status(204).end();
});

/* ---- YouTube: channel list ---- */

router.get('/youtube/channels', (req, res) => {
  res.json(youtubeChannels.list());
});

router.post('/youtube/channels', async (req, res) => {
  const body = req.body || {};
  const raw = String(body.channel_id || body.channel || '').trim();
  if (!raw) return res.status(400).json({ error: 'channel_id is required' });

  // A raw UC... ID needs no API call; a handle or URL costs 1 quota unit.
  if (/^UC[A-Za-z0-9_-]{20,24}$/.test(raw)) {
    return res.status(201).json(youtubeChannels.add(raw, body.title));
  }
  const resolved = await youtube.resolveChannel(raw);
  res.status(201).json(youtubeChannels.add(resolved.channel_id, resolved.title));
});

router.patch('/youtube/channels/:id', (req, res) => {
  const ok = youtubeChannels.setEnabled(Number(req.params.id), (req.body || {}).enabled);
  if (!ok) return res.status(404).json({ error: 'Channel not found' });
  res.json({ ok: true });
});

router.delete('/youtube/channels/:id', (req, res) => {
  if (!youtubeChannels.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  res.status(204).end();
});

/* ---- Web search: site list ---- */

/** One live query against one site, so "does Quora work?" is answerable. */
router.post('/websearch/test', async (req, res) => {
  try {
    res.json(await websearch.testQuery(req.body || {}));
  } catch (err) {
    res.status(err.status && err.status < 500 ? err.status : 502).json({
      error: err.message || 'The search failed',
    });
  }
});

router.get('/websearch/sites', (req, res) => {
  res.json(searchSites.list());
});

router.post('/websearch/sites', (req, res) => {
  const body = req.body || {};
  res.status(201).json(searchSites.add(body.domain || body.site, body.label));
});

router.patch('/websearch/sites/:id', (req, res) => {
  const ok = searchSites.setEnabled(Number(req.params.id), (req.body || {}).enabled);
  if (!ok) return res.status(404).json({ error: 'Site not found' });
  res.json({ ok: true });
});

router.delete('/websearch/sites/:id', (req, res) => {
  if (!searchSites.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Site not found' });
  }
  res.status(204).end();
});

module.exports = router;
