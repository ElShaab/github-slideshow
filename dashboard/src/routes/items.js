'use strict';

const express = require('express');
const items = require('../lib/items');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(
    items.query({
      source: req.query.source,
      status: req.query.status,
      keyword: req.query.keyword,
      q: req.query.q,
      since: req.query.since,
      limit: req.query.limit,
      offset: req.query.offset,
    })
  );
});

router.get('/summary', (req, res) => {
  res.json(items.summary());
});

router.get('/:id', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

router.patch('/:id', (req, res) => {
  const updated = items.setStatus(Number(req.params.id), req.body && req.body.status);
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  if (!items.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Item not found' });
  }
  // The seen_items ledger keeps the ID, so a re-poll will not bring it back.
  res.status(204).end();
});

module.exports = router;
