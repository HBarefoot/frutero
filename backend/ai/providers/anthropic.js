const Anthropic = require('@anthropic-ai/sdk');
const { Q } = require('../../database');

// Anthropic provider for the AI advisor. Uses the official SDK, prompt
// caching on the system prompt (it's stable across calls — the volatile
// state lives in the user turn), and adaptive thinking so Claude can
// think when the task warrants it. See shared/prompt-caching.md for why
// the system prompt goes first + frozen.

const DEFAULT_MODEL = 'claude-opus-4-7';

function getApiKey() {
  return Q.getSecret('ai_anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
}

async function invoke({ systemPrompt, userText, model }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('ai_anthropic_api_key not set');
  }

  const client = new Anthropic({ apiKey });
  const effective = model || DEFAULT_MODEL;

  const response = await client.messages.create({
    model: effective,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userText }],
  });

  // The first text block is the JSON payload. Adaptive thinking may
  // emit a thinking block ahead of it; we skip those and take the first
  // text content we find.
  const text = response.content.find((b) => b.type === 'text')?.text || '';

  return {
    raw_text: text,
    input_tokens: response.usage?.input_tokens ?? null,
    output_tokens: response.usage?.output_tokens ?? null,
    model: effective,
  };
}

module.exports = { invoke, DEFAULT_MODEL };
