'use strict';

const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;

const config = require('../config');
const settings = require('../lib/settings');
const { SYSTEM_PROMPT, buildUserMessage } = require('./prompt');

let cachedClient = null;
let cachedKey = null;

function client() {
  if (!config.anthropic.apiKey) {
    const err = new Error(
      'ANTHROPIC_API_KEY is not set. Add it as a Replit secret (or an environment variable) and restart.'
    );
    err.status = 503;
    throw err;
  }
  if (!cachedClient || cachedKey !== config.anthropic.apiKey) {
    cachedClient = new Anthropic({
      apiKey: config.anthropic.apiKey,
      // Resolve global fetch per call rather than capturing it at
      // construction, so the cached client can never hold a stale reference.
      fetch: (...args) => globalThis.fetch(...args),
    });
    cachedKey = config.anthropic.apiKey;
  }
  return cachedClient;
}

function isConfigured() {
  return !!config.anthropic.apiKey;
}

/** The studies handed to the model, stored alongside the draft so the
 *  citation numbers in the text stay resolvable later. */
function citationList(match) {
  return ((match && match.results) || []).map((work, index) => ({
    n: index + 1,
    title: work.title,
    venue: work.venue,
    year: work.year,
    url: work.url,
    doi: work.doi || null,
    evidence: work.evidence ? work.evidence.label : null,
    registry: !!work.registry,
    sources: work.sources || [],
  }));
}

function textOf(message) {
  return (message.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Generate one draft reply.
 *
 * Streams the response - adaptive thinking plus a few thousand tokens of
 * research context can run long enough to trip a non-streaming HTTP timeout -
 * and returns the assembled text.
 */
async function generateDraft({ item, match }) {
  const model = settings.get('draft.model') || 'claude-opus-5';
  const effort = settings.get('draft.effort') || 'high';
  const maxTokens = Math.min(
    Math.max(settings.getNumber('draft.max_tokens', 16000), 1024),
    64000
  );

  const stream = client().beta.messages.stream({
    model,
    max_tokens: maxTokens,
    // Opus 5's classifiers can decline a request; "default" re-runs it on
    // Anthropic's recommended substitute by refusal category instead of
    // handing us a dead end.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // The system prompt never varies, so it is worth caching across
        // every draft this dashboard generates.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage({ item, match }) }],
  });

  const message = await stream.finalMessage();

  // Check why generation stopped before reading the content.
  if (message.stop_reason === 'refusal') {
    const err = new Error(
      'The model declined to answer this question' +
        (message.stop_details && message.stop_details.category
          ? ` (category: ${message.stop_details.category})`
          : '') +
        '. Try rewording the question, or draft this one by hand.'
    );
    err.status = 422;
    throw err;
  }

  const content = textOf(message);
  if (!content) {
    const err = new Error(
      message.stop_reason === 'max_tokens'
        ? 'The model hit its token limit before writing a draft. Raise draft.max_tokens.'
        : 'The model returned no text.'
    );
    err.status = 502;
    throw err;
  }

  return {
    content,
    model: message.model || model,
    usage: {
      input_tokens: message.usage && message.usage.input_tokens,
      output_tokens: message.usage && message.usage.output_tokens,
      cache_read_input_tokens: message.usage && message.usage.cache_read_input_tokens,
      cache_creation_input_tokens:
        message.usage && message.usage.cache_creation_input_tokens,
      stop_reason: message.stop_reason,
      truncated: message.stop_reason === 'max_tokens',
    },
    citations: citationList(match),
  };
}

/** Maps SDK errors onto HTTP statuses the dashboard can show. */
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Anthropic rate limit reached. Wait a moment and try again.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Anthropic rejected the request: ${err.message}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Could not reach the Anthropic API.' };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status || 502, message: `Anthropic API error: ${err.message}` };
  }
  return { status: err.status || 500, message: err.message || String(err) };
}

module.exports = { generateDraft, isConfigured, describeError, citationList, Anthropic };
