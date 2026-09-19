'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const scheduler = require('./scheduler');
const items = require('./lib/items');
const settings = require('./lib/settings');

const guard = require('./lib/guard');

const app = express();
app.disable('x-powered-by');
// Optional password, in front of everything including the OAuth callbacks.
app.use(guard.middleware());
app.use(express.json({ limit: '256kb' }));

app.use('/api/keywords', require('./routes/keywords'));
app.use('/api/items', require('./routes/items'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api', require('./routes/research'));
app.use('/api', require('./routes/drafts'));
app.use('/api', require('./routes/connections'));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    polling_enabled: config.pollingEnabled,
    sources: scheduler.status().map((s) => ({
      id: s.id,
      enabled: s.enabled,
      configured: s.configured,
      last_status: s.last_status,
      last_run_at: s.last_run_at,
    })),
    feed: items.summary(),
  });
});

app.get('/api/overview', (req, res) => {
  res.json({
    feed: items.summary(),
    sources: scheduler.status(),
    settings: settings.all(),
  });
});

app.use(express.static(path.join(config.root, 'public')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

// One error handler for the whole API: validation and conflict errors carry a
// status; anything else is a 500 with the message kept short.
app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

function start() {
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `Amputee research dashboard listening on http://${config.host}:${config.port}`
    );
    console.log(`Database: ${config.dbPath}`);
    guard.warnIfUnprotected();
    if (config.pollingEnabled) {
      scheduler.start();
    } else {
      console.log('Background polling disabled (POLLING_ENABLED=false)');
    }
  });

  const shutdown = () => {
    scheduler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}

if (require.main === module) start();

module.exports = { app, start };
