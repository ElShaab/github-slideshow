'use strict';

const express = require('express');
const keywords = require('../lib/keywords');
const missed = require('../lib/missed');
const { SOURCES } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ sources: SOURCES, keywords: keywords.list() });
});

/**
 * A new or widened keyword is weighed straight away against everything the
 * sources already fetched and nobody matched, so it captures those posts now
 * rather than at the next poll.
 */
router.post('/', (req, res) => {
  const created = keywords.create(req.body || {});
  res.status(201).json({ ...created, recheck: missed.recheck() });
});

router.get('/:id', (req, res) => {
  const keyword = keywords.get(Number(req.params.id));
  if (!keyword) return res.status(404).json({ error: 'Keyword not found' });
  res.json(keyword);
});

router.put('/:id', (req, res) => {
  const updated = keywords.update(Number(req.params.id), req.body || {});
  if (!updated) return res.status(404).json({ error: 'Keyword not found' });
  res.json({ ...updated, recheck: missed.recheck() });
});

router.delete('/:id', (req, res) => {
  if (!keywords.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Keyword not found' });
  }
  res.status(204).end();
});

module.exports = router;
