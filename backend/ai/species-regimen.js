const anthropic = require('./providers/anthropic');
const ollama = require('./providers/ollama');
const { Q } = require('../database');
const { extractJsonBlock } = require('./parse-json');

// Asks the configured AI provider for an optimal grow-chamber regimen
// for a given mushroom species. Returns strict JSON shaped to match
// the species table. If the model returns prose alongside, we extract
// the largest {...} block (smaller local models occasionally do this).
//
// Reuses the advisor's provider config — same key in secrets, same
// model name, same Ollama base URL. Owner-toggleable on the AI page.

const SYSTEM_PROMPT = `You are an expert mycologist advising on automated grow-chamber regimens for fruiting mushrooms.

Given a mushroom species name and optional operator notes, output STRICT JSON (no prose, no fences) with the optimal fruiting-stage regimen for an indoor monotub-style chamber:

{
  "name": "<canonical common name, ≤64 chars>",
  "temp_min": <int °F>,
  "temp_max": <int °F>,
  "humid_min": <int %>,
  "humid_max": <int %>,
  "light_hours": <int hours/day, 0-24>,
  "fan_interval": <int minutes between fresh-air-exchange fan cycles>,
  "mister_threshold": <int %, the humidity below which to trigger ultrasonic misting>,
  "mister_pulse_seconds": <int seconds, duration of each mist pulse>,
  "notes": "<1-3 short sentences: fruiting-stage tips, pinning behavior, common pitfalls>"
}

Rules:
- Values target the FRUITING phase, not colonization. Operators handle colonization separately at species-defaults.
- temp_min/max: ranges the chamber should hold at fruiting. Tight ranges (5-10°F band) for picky species, wider for tolerant ones.
- humid_min/max: typical 80-95% during fruiting; some species (lions mane) prefer the higher end.
- light_hours: most species need 6-12h to trigger pinning + healthy color; obligate-dark species are rare in cultivation.
- fan_interval: 15-30 min for high-CO2-sensitive species (oysters), longer for CO2-tolerant (shiitake).
- mister_threshold + pulse_seconds: only set when you'd recommend automatic misting; otherwise omit those keys.
- notes: surface anything operator-actionable that the numbers don't capture (FAE timing, light color, side-fruiting, common contamination risks).
- If the species name is unknown or ambiguous, return your best guess based on the genus + a notes caveat. Do NOT refuse.`;

function getConfig() {
  const s = Q.getAllSettings();
  return {
    enabled: s.ai_enabled === '1',
    provider: s.ai_provider || 'anthropic',
    anthropic_model: s.ai_anthropic_model || anthropic.DEFAULT_MODEL,
    ollama_model: s.ai_ollama_model || ollama.DEFAULT_MODEL,
    ollama_base_url: s.ai_ollama_base_url || ollama.DEFAULT_BASE_URL,
  };
}

function providerFor(name) {
  return name === 'ollama' ? ollama : anthropic;
}

function parseRegimen(rawText) {
  const parsed = extractJsonBlock(rawText);

  const num = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(lo, Math.min(hi, n));
  };

  const temp_min = num(parsed.temp_min, 32, 120);
  const temp_max = num(parsed.temp_max, 32, 120);
  const humid_min = num(parsed.humid_min, 0, 100);
  const humid_max = num(parsed.humid_max, 0, 100);
  if (temp_min == null || temp_max == null || humid_min == null || humid_max == null) {
    throw new Error('model returned non-numeric temp/humid');
  }

  return {
    name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 64) : '',
    temp_min, temp_max, humid_min, humid_max,
    light_hours: num(parsed.light_hours, 0, 24) ?? 12,
    fan_interval: num(parsed.fan_interval, 1, 240) ?? 30,
    mister_threshold: num(parsed.mister_threshold, 0, 100),
    mister_pulse_seconds: num(parsed.mister_pulse_seconds, 1, 120),
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 1000) : null,
  };
}

async function suggest({ name, notes }) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    throw Object.assign(new Error('ai_disabled'), { code: 'ai_disabled' });
  }
  const provider = providerFor(cfg.provider);
  const model = cfg.provider === 'ollama' ? cfg.ollama_model : cfg.anthropic_model;
  const userText =
    `Species: ${(name || '').trim() || '(unspecified)'}\n` +
    (notes ? `Operator notes: ${notes.trim().slice(0, 1000)}\n` : '') +
    `\nReturn the JSON regimen.`;

  const response = await provider.invoke({
    systemPrompt: SYSTEM_PROMPT,
    userText,
    model,
    baseUrl: cfg.ollama_base_url, // ignored by Anthropic provider
  });

  return parseRegimen(response.raw_text || '');
}

module.exports = { suggest, parseRegimen, SYSTEM_PROMPT };
