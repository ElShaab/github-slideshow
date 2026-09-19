'use strict';

const express = require('express');
const connect = require('../connect');
const connections = require('../lib/connections');
const post = require('../connect/post');
const replies = require('../lib/replies');

const router = express.Router();

router.get('/connections', (req, res) => {
  res.json({ providers: connect.status(req), replies: replies.summary() });
});

/** Step 1: hand the browser off to the platform's consent screen. */
router.get('/connections/:provider/start', (req, res) => {
  const provider = connect.get(req.params.provider);
  if (!provider) return res.status(404).json({ error: 'Unknown provider' });
  res.redirect(connect.beginConnect(provider, req));
});

/** Step 2: the platform sends the browser back here with a code. */
router.get('/connections/:provider/callback', async (req, res) => {
  const provider = connect.get(req.params.provider);
  if (!provider) return res.status(404).send('Unknown provider');

  // Everything interpolated below comes from the platform's redirect or an
  // error message, so it is escaped rather than trusted.
  const esc = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const page = (title, body, ok) => `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; display: grid; place-items: center; min-height: 100vh;
         background: #f6f7f9; color: #16202b; }
  .card { background: #fff; border: 1px solid #dfe3e8; border-radius: 12px;
          padding: 28px 32px; max-width: 30rem; box-shadow: 0 1px 3px rgba(16,24,40,.06); }
  h1 { font-size: 1.05rem; margin: 0 0 8px; color: ${ok ? '#1a7f5a' : '#b3261e'}; }
  p { margin: 0 0 14px; color: #5c6b7a; }
  a { color: #1f6feb; }
  @media (prefers-color-scheme: dark) {
    body { background: #12161c; color: #e6ebf1; }
    .card { background: #1a2029; border-color: #2d3743; }
    p { color: #9aa8b8; }
  }
</style>
<div class="card"><h1>${esc(title)}</h1><p>${body}</p><p><a href="/">Back to the dashboard</a></p></div>`;

  if (req.query.error) {
    connections.setError(provider.id, String(req.query.error));
    return res
      .status(400)
      .send(
        page(
          `${provider.label} was not connected`,
          `The platform returned: ${esc(req.query.error)}. Nothing was saved.`,
          false
        )
      );
  }
  if (!req.query.code || !req.query.state) {
    return res.status(400).send(page('Missing authorization code', 'Start the connection again from the dashboard.', false));
  }

  try {
    const saved = await connect.completeConnect(
      provider,
      { code: String(req.query.code), state: String(req.query.state) },
      req
    );
    res.send(
      page(
        `${provider.label} connected`,
        `Replies will post as <strong>${esc(saved.account_name)}</strong>. You can close this tab.`,
        true
      )
    );
  } catch (err) {
    connections.setError(provider.id, err.message);
    res.status(err.status || 500).send(page(`${provider.label} was not connected`, esc(err.message), false));
  }
});

router.delete('/connections/:provider', (req, res) => {
  if (!connect.get(req.params.provider)) {
    return res.status(404).json({ error: 'Unknown provider' });
  }
  if (!connections.remove(req.params.provider)) {
    return res.status(404).json({ error: 'That account is not linked' });
  }
  res.status(204).end();
});

/* ---- replying ---- */

router.get('/items/:id/reply-target', (req, res) => {
  res.json(post.target(Number(req.params.id)));
});

router.post('/drafts/:id/post', async (req, res) => {
  const result = await post.send({
    draftId: Number(req.params.id),
    confirm: (req.body || {}).confirm === true,
  });
  res.status(201).json(result);
});

router.get('/replies', (req, res) => {
  res.json({ replies: replies.recent(req.query.limit), counts: replies.summary() });
});

router.get('/items/:id/replies', (req, res) => {
  res.json({ replies: replies.forItem(Number(req.params.id)) });
});

module.exports = router;
