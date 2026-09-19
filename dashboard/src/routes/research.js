'use strict';

const express = require('express');
const research = require('../research');
const store = require('../lib/researchStore');
const items = require('../lib/items');
const settings = require('../lib/settings');

const router = express.Router();

router.get('/research/providers', (req, res) => {
  res.json({
    providers: research.PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      enabled: settings.getBool(`research.provider_${p.id}`, true),
    })),
    contact_email: settings.get('research.contact_email') || '',
    cache: store.summary(),
  });
});

/** Cached match only - never calls the upstream APIs. */
router.get('/items/:id/research', (req, res) => {
  const itemId = Number(req.params.id);
  const item = items.get(itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const cached = store.get(itemId);
  if (!cached) return res.json({ exists: false, item_id: itemId, item });
  res.json({ exists: true, cached: true, item, ...cached });
});

/** Runs the match. Returns the cached copy unless ?refresh=true. */
router.post('/items/:id/research', async (req, res) => {
  const match = await research.matchItem(Number(req.params.id), {
    refresh: req.query.refresh === 'true',
  });
  res.json({ exists: true, ...match });
});

router.delete('/items/:id/research', (req, res) => {
  if (!store.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'No cached research for this item' });
  }
  res.status(204).end();
});

module.exports = router;
