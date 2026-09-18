'use strict';

const express = require('express');
const scheduler = require('../scheduler');
const state = require('../lib/state');
const subreddits = require('../lib/subreddits');
const youtubeChannels = require('../lib/youtubeChannels');
const youtube = require('../sources/youtube');
const searchSites = require('../lib/searchSites');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ sources: scheduler.status(), logs: state.recentLogs(25) });
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
