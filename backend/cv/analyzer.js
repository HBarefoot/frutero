const fs = require('node:fs');
const path = require('node:path');
const { Q } = require('../database');
const notifications = require('../notifications');
const anthropic = require('../ai/providers/anthropic');
const ollama = require('../ai/providers/ollama');
const { SYSTEM_PROMPT, userPrompt } = require('./vision-prompt');

// Vision analyzer. Takes a snapshot row, reads the file from disk,
// sends it to whichever provider the operator has configured in the
// AI advisor settings (Anthropic or Ollama), parses the structured
// JSON response, persists a cv_observations row, and fires a warn
// notification when contamination_risk is high.
//
// Reuses the advisor's provider + model settings — one place to set
// the LLM credential, same provider for chamber analysis and image
// analysis. When the operator picks Ollama for vision, they are
// expected to pull a vision-capable model (llava, qwen2-vl,
// minicpm-v) and set ai_ollama_model accordingly.

const GROWTH_STAGES = new Set([
  'colonization', 'pinning', 'fruiting', 'harvestable', 'empty', 'unknown',
]);
const RISK_LEVELS = new Set(['none', 'low', 'medium', 'high', 'unknown']);

function providerFor(name) {
  if (name === 'ollama') return ollama;
  return anthropic;
}

function getAiConfig() {
  const s = Q.getAllSettings();
  return {
    provider: s.ai_provider || 'anthropic',
    anthropic_model: s.ai_anthropic_model || anthropic.DEFAULT_MODEL,
    ollama_model: s.ai_ollama_model || ollama.DEFAULT_MODEL,
  };
}

function parseObservation(rawText) {
  const trimmed = (rawText || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('response was not JSON');
    parsed = JSON.parse(m[0]);
  }

  const growth_stage = GROWTH_STAGES.has(parsed.growth_stage) ? parsed.growth_stage : 'unknown';
  const contamination_risk = RISK_LEVELS.has(parsed.contamination_risk) ? parsed.contamination_risk : 'unknown';
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.filter((f) => typeof f === 'string').slice(0, 8).map((f) => f.slice(0, 200))
    : [];
  const recommendation = typeof parsed.recommendation === 'string'
    ? parsed.recommendation.trim().slice(0, 400)
    : null;

  return { growth_stage, contamination_risk, findings, recommendation };
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function analyze(snapshotId, { force = false } = {}) {
  const snap = Q.getSnapshot(snapshotId);
  if (!snap) return { ok: false, reason: 'snapshot_not_found' };

  // Refuse to analyze stubs + failed captures — nothing visually
  // meaningful there. The .svg placeholder writes when no camera is
  // attached; error rows are captures that crashed partway.
  if (snap.error) return { ok: false, reason: 'snapshot_has_error', detail: snap.error };
  if (snap.path.endsWith('.svg')) return { ok: false, reason: 'stub_placeholder' };

  // Skip re-analysis unless forced — we've already got a recent result.
  if (!force) {
    const existing = Q.getLatestObservationFor(snapshotId);
    if (existing && !existing.error) {
      return { ok: true, skipped: true, reason: 'already_analyzed', observation: existing };
    }
  }

  // Load the image off disk. Keep this in memory only long enough to
  // hand to the provider — don't accumulate references.
  let b64;
  try {
    const bytes = fs.readFileSync(snap.path);
    b64 = bytes.toString('base64');
  } catch (err) {
    return { ok: false, reason: 'read_failed', detail: err.message };
  }

  const cfg = getAiConfig();
  const provider = providerFor(cfg.provider);
  const model = cfg.provider === 'ollama' ? cfg.ollama_model : cfg.anthropic_model;

  const started = Date.now();
  let raw;
  try {
    raw = await provider.invoke({
      systemPrompt: SYSTEM_PROMPT,
      userText: userPrompt(),
      model,
      images: [{ data: b64, media_type: mimeFromPath(snap.path) }],
    });
  } catch (err) {
    const error = err.message || String(err);
    Q.insertObservation({
      snapshot_id: snap.id,
      batch_id: snap.batch_id,
      provider: cfg.provider,
      model,
      error,
      latency_ms: Date.now() - started,
    });
    return { ok: false, reason: 'provider_error', detail: error };
  }
  const latency = Date.now() - started;

  let obs;
  try {
    obs = parseObservation(raw.raw_text);
  } catch (err) {
    Q.insertObservation({
      snapshot_id: snap.id,
      batch_id: snap.batch_id,
      provider: cfg.provider,
      model: raw.model,
      raw_output: raw.raw_text?.slice(0, 2000),
      input_tokens: raw.input_tokens,
      output_tokens: raw.output_tokens,
      latency_ms: latency,
      error: `parse_failed: ${err.message}`,
    });
    return { ok: false, reason: 'parse_failed', detail: err.message, raw_text: raw.raw_text?.slice(0, 400) };
  }

  Q.insertObservation({
    snapshot_id: snap.id,
    batch_id: snap.batch_id,
    provider: cfg.provider,
    model: raw.model,
    growth_stage: obs.growth_stage,
    contamination_risk: obs.contamination_risk,
    findings: obs.findings,
    recommendation: obs.recommendation,
    raw_output: raw.raw_text?.slice(0, 2000),
    input_tokens: raw.input_tokens,
    output_tokens: raw.output_tokens,
    latency_ms: latency,
  });

  // Stage-watcher runs after every successful observation. It's
  // cheap (one indexed SQL query) and idempotent — duplicate pending
  // suggestions are filtered out inside the watcher itself.
  try {
    const stageWatcher = require('./stage-watcher');
    stageWatcher.checkAfterObservation({
      batch_id: snap.batch_id,
      growth_stage: obs.growth_stage,
    }).catch((err) => console.error('[cv] stage-watcher failed:', err));
  } catch (err) {
    console.error('[cv] stage-watcher hook error:', err);
  }

  // High-risk observations fan out through notifications. Medium does
  // not — too noisy; operators can dial up min_severity to `warn` if
  // they want only these.
  if (obs.contamination_risk === 'high') {
    const bullets = obs.findings.slice(0, 3).map((f) => `• ${f}`).join('\n');
    notifications
      .notify({
        title: 'CV · possible contamination detected',
        body: `${obs.recommendation || 'Inspect the chamber.'}\n\n${bullets}`,
        severity: 'warn',
      })
      .catch((err) => console.error('[cv] notify failed:', err));
  }

  return {
    ok: true,
    observation: obs,
    provider: cfg.provider,
    model: raw.model,
    latency_ms: latency,
    input_tokens: raw.input_tokens,
    output_tokens: raw.output_tokens,
  };
}

// Serialize analyses: one call in flight at a time. Snapshots queued
// up by the capture scheduler wait behind the current call so a fast
// 1-minute snapshot cadence doesn't pile up concurrent Ollama calls
// on a single-GPU host.
let runningChain = Promise.resolve();
function enqueueAnalyze(snapshotId) {
  runningChain = runningChain
    .then(() => analyze(snapshotId))
    .catch((err) => console.error('[cv] queued analyze failed:', err));
  return runningChain;
}

module.exports = { analyze, enqueueAnalyze, parseObservation };
