'use strict';

const express = require('express');
const drafts = require('../lib/drafts');
const items = require('../lib/items');
const store = require('../lib/researchStore');
const research = require('../research');
const generator = require('../drafts/generate');
const settings = require('../lib/settings');

const router = express.Router();

router.get('/drafts/status', (req, res) => {
  res.json({
    configured: generator.isConfigured(),
    model: settings.get('draft.model'),
    effort: settings.get('draft.effort'),
    max_tokens: settings.getNumber('draft.max_tokens', 16000),
    counts: drafts.summary(),
  });
});

router.get('/items/:id/drafts', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ item_id: item.id, drafts: drafts.forItem(item.id) });
});

/**
 * Generate a draft for one question. Uses the cached research match, running
 * the match first when there is none, so the model always sees the same
 * studies the physician is looking at.
 */
router.post('/items/:id/drafts', async (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });

  let match = store.get(item.id);
  if (!match) {
    const fresh = await research.matchItem(item.id);
    match = { ...fresh };
  }

  try {
    const generated = await generator.generateDraft({ item, match });
    const saved = drafts.create({ item_id: item.id, ...generated });
    res.status(201).json({ draft: saved, match_used: { terms: match.terms, count: match.results.length } });
  } catch (err) {
    const described = generator.describeError(err);
    res.status(described.status).json({ error: described.message });
  }
});

router.put('/drafts/:id', (req, res) => {
  const body = req.body || {};
  if (typeof body.content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }
  const updated = drafts.update(Number(req.params.id), {
    content: body.content,
    status: body.status,
  });
  if (!updated) return res.status(404).json({ error: 'Draft not found' });
  res.json(updated);
});

router.patch('/drafts/:id', (req, res) => {
  const updated = drafts.setStatus(Number(req.params.id), (req.body || {}).status);
  if (!updated) return res.status(404).json({ error: 'Draft not found' });
  res.json(updated);
});

router.delete('/drafts/:id', (req, res) => {
  if (!drafts.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  res.status(204).end();
});

module.exports = router;
