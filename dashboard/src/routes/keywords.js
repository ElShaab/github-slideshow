'use strict';

const express = require('express');
const keywords = require('../lib/keywords');
const { SOURCES } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ sources: SOURCES, keywords: keywords.list() });
});

router.post('/', (req, res) => {
  res.status(201).json(keywords.create(req.body || {}));
});

router.get('/:id', (req, res) => {
  const keyword = keywords.get(Number(req.params.id));
  if (!keyword) return res.status(404).json({ error: 'Keyword not found' });
  res.json(keyword);
});

router.put('/:id', (req, res) => {
  const updated = keywords.update(Number(req.params.id), req.body || {});
  if (!updated) return res.status(404).json({ error: 'Keyword not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  if (!keywords.remove(Number(req.params.id))) {
    return res.status(404).json({ error: 'Keyword not found' });
  }
  res.status(204).end();
});

module.exports = router;
