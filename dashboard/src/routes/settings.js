'use strict';

const express = require('express');
const settings = require('../lib/settings');
const scheduler = require('../scheduler');
const sources = require('../sources');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(settings.all());
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const entries = {};
  for (const [key, value] of Object.entries(body)) {
    if (!/^[a-z_]+\.[a-z_]+$/.test(key)) {
      return res.status(400).json({ error: `Invalid setting key: ${key}` });
    }
    entries[key] = value;
  }
  settings.setMany(entries);

  // Interval or enabled changes take effect without a restart.
  const touched = new Set(
    Object.keys(entries)
      .map((key) => key.split('.')[0])
      .filter((id) => sources.get(id))
  );
  for (const id of touched) scheduler.reschedule(id);

  res.json(settings.all());
});

module.exports = router;
