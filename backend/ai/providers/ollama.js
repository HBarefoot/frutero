const { Q } = require('../../database');

// Ollama provider — local LLM, no network egress required once the
// model is pulled. Good fit for air-gapped appliances and data-privacy
// workloads. Talks to the Ollama HTTP API directly (no SDK needed).

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

function getBaseUrl() {
  const settings = Q.getAllSettings();
  return (settings.ai_ollama_base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
}

async function invoke({ systemPrompt, userText, model }) {
  const baseUrl = getBaseUrl();
  const effective = model || DEFAULT_MODEL;

  // Use /api/chat (chat-style, newer endpoint). We ask for JSON format
  // so small local models stay on-schema — critical because we then
  // JSON.parse the response downstream.
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: effective,
      stream: false,
      format: 'json',
      options: {
        // Keep the response terse. Smaller models will ramble otherwise.
        num_predict: 1024,
        temperature: 0.3,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ollama http ${res.status}: ${body.slice(0, 400)}`);
  }

  const payload = await res.json();
  const text = payload?.message?.content || '';

  return {
    raw_text: text,
    // Ollama reports prompt_eval_count / eval_count
    input_tokens: payload.prompt_eval_count ?? null,
    output_tokens: payload.eval_count ?? null,
    model: effective,
  };
}

module.exports = { invoke, DEFAULT_BASE_URL, DEFAULT_MODEL };
