const { Q } = require('../database');
const { SYSTEM_PROMPT, buildContext, userPrompt } = require('./prompt');
const anthropic = require('./providers/anthropic');
const ollama = require('./providers/ollama');

// Central advisor. Reads settings to pick a provider, snapshots chamber
// state, calls the LLM, parses + validates the response shape, persists
// insights. Never actuates devices.

function getConfig() {
  const s = Q.getAllSettings();
  return {
    enabled: s.ai_enabled === '1',
    provider: s.ai_provider || 'anthropic',
    anthropic_model: s.ai_anthropic_model || anthropic.DEFAULT_MODEL,
    ollama_model: s.ai_ollama_model || ollama.DEFAULT_MODEL,
    ollama_base_url: s.ai_ollama_base_url || ollama.DEFAULT_BASE_URL,
    cadence_hours: parseInt(s.ai_cadence_hours, 10) || 6,
  };
}

function providerFor(name) {
  if (name === 'ollama') return ollama;
  return anthropic;
}

function parseInsights(rawText) {
  // Try strict JSON parse first. If the model wrapped it in prose or a
  // fence (happens with smaller local models despite our "no fences"
  // instruction), fish out the largest {...} block as a fallback.
  const trimmed = (rawText || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('model response was not JSON');
    parsed = JSON.parse(m[0]);
  }

  const insights = Array.isArray(parsed?.insights) ? parsed.insights : [];
  const cleaned = [];
  for (const ins of insights) {
    if (!ins || typeof ins !== 'object') continue;
    if (typeof ins.title !== 'string' || !ins.title.trim()) continue;
    if (typeof ins.body !== 'string' || !ins.body.trim()) continue;

    const category = ['observation', 'recommendation', 'warning'].includes(ins.category)
      ? ins.category : 'observation';
    const severity = ['info', 'warn'].includes(ins.severity) ? ins.severity : 'info';
    const actions = Array.isArray(ins.actions)
      ? ins.actions
        .filter((a) => a && typeof a === 'object' && typeof a.label === 'string')
        .slice(0, 4)
        .map((a) => ({ label: String(a.label).slice(0, 80), hint: String(a.hint || '').slice(0, 200) }))
      : [];

    cleaned.push({
      category,
      severity,
      title: ins.title.trim().slice(0, 120),
      body: ins.body.trim().slice(0, 1500),
      actions,
    });
  }
  return cleaned.slice(0, 3);
}

async function runOnce({ force = false } = {}) {
  const cfg = getConfig();
  if (!force && !cfg.enabled) {
    return { skipped: true, reason: 'ai_disabled' };
  }

  const provider = providerFor(cfg.provider);
  const model = cfg.provider === 'ollama' ? cfg.ollama_model : cfg.anthropic_model;

  const snapshot = buildContext();
  const started = Date.now();

  let raw;
  try {
    raw = await provider.invoke({
      systemPrompt: SYSTEM_PROMPT,
      userText: userPrompt(snapshot),
      model,
    });
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      provider: cfg.provider,
      model,
    };
  }

  const latency = Date.now() - started;

  let insights;
  try {
    insights = parseInsights(raw.raw_text);
  } catch (err) {
    return {
      ok: false,
      error: `parse_failed: ${err.message}`,
      provider: cfg.provider,
      model: raw.model,
      raw_text: raw.raw_text.slice(0, 400),
    };
  }

  for (const ins of insights) {
    Q.insertAIInsight({
      provider: cfg.provider,
      model: raw.model,
      category: ins.category,
      severity: ins.severity,
      title: ins.title,
      body: ins.body,
      actions: ins.actions,
      input_tokens: raw.input_tokens,
      output_tokens: raw.output_tokens,
      latency_ms: latency,
    });
  }

  return {
    ok: true,
    provider: cfg.provider,
    model: raw.model,
    latency_ms: latency,
    input_tokens: raw.input_tokens,
    output_tokens: raw.output_tokens,
    insights_generated: insights.length,
  };
}

let tickHandle = null;
function startScheduler() {
  if (tickHandle) clearInterval(tickHandle);
  // Re-read cadence every check so the operator can tune without restart.
  // Worst case: changing from 6h to 1h takes up to 15 minutes to apply.
  const checkEveryMs = 15 * 60 * 1000;
  let lastRunAt = 0;
  tickHandle = setInterval(() => {
    const cfg = getConfig();
    if (!cfg.enabled) return;
    const cadenceMs = Math.max(1, cfg.cadence_hours) * 60 * 60 * 1000;
    if (Date.now() - lastRunAt < cadenceMs) return;
    lastRunAt = Date.now();
    runOnce().catch((err) => console.error('[ai] scheduled run failed:', err));
  }, checkEveryMs);
  tickHandle.unref?.();
}

function stopScheduler() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

module.exports = { runOnce, getConfig, startScheduler, stopScheduler, parseInsights };
