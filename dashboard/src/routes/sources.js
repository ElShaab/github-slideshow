'use strict';

const express = require('express');
const scheduler = require('../scheduler');
const state = require('../lib/state');
const subreddits = require('../lib/subreddits');

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

module.exports = router;
