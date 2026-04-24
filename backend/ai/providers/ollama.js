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

// 10 minute hard ceiling on a single Ollama call. A model that can't
// complete in 10 minutes on the configured host is either too big for
// the hardware (swap thrash / OOM) or stuck — either way, aborting is
// kinder than blocking the advisor's scheduler indefinitely.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

async function invoke({ systemPrompt, userText, model, images }) {
  const baseUrl = getBaseUrl();
  const effective = model || DEFAULT_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Ollama's /api/chat accepts images per-message as a flat array of
  // base64-encoded strings. Vision-capable models only (llava, qwen2-vl,
  // minicpm-v, etc.); text-only models silently ignore.
  const userMessage = { role: 'user', content: userText };
  if (Array.isArray(images) && images.length > 0) {
    userMessage.images = images.map((img) => img.data);
  }

  let res;
  try {
    // Use /api/chat (chat-style, newer endpoint). We ask for JSON format
    // so small local models stay on-schema — critical because we then
    // JSON.parse the response downstream.
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
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
          userMessage,
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `ollama request timed out after ${REQUEST_TIMEOUT_MS / 60000} min — the model is likely too large for this host (${baseUrl}). Try a smaller model like qwen2.5:3b or llama3.2:3b.`
      );
    }
    if (err.cause?.code === 'ECONNREFUSED') {
      throw new Error(`ollama not reachable at ${baseUrl} — is the server running?`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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
