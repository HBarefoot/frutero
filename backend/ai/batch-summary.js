const { Q, getDb } = require('../database');
const { SPECIES_PRESETS } = require('../config');
const anthropic = require('./providers/anthropic');
const ollama = require('./providers/ollama');
const advisor = require('./advisor');

// Per-batch retrospective. Distinct from the live 6h advisor: this
// runs once (on archive or operator request), loads the batch's full
// signal stack, and asks the model for a structured postmortem. The
// result is stored as an ai_insights row with category 'summary' so
// the UI can render it separately from rolling recommendations.

const SYSTEM_PROMPT = `You are a mushroom-cultivation post-run analyst. Given a completed batch's **full history** — readings stats, phase transitions, event log, CV observations, actuator usage, final yield — write a concise, plain-English retrospective.

Focus on what a grower can learn from this run. Call out what went well, what went poorly, and 1–3 specific lessons for the next batch. Be honest but not preachy; a mixed or poor batch is a learning opportunity, not a failure.

Output a JSON object matching this exact shape:

{
  "headline": "One-sentence takeaway (<=120 chars)",
  "health_rating": "excellent" | "good" | "mixed" | "poor",
  "highlights": ["string", "..."],   // 2-4 bullets: what went well
  "concerns":   ["string", "..."],   // 0-3 bullets: issues or red flags
  "lessons":    ["string", "..."]    // 1-3 actionable bullets for next run
}

Rules:
- Each bullet is 1 short sentence. No emoji. No code fences. No prose outside the JSON.
- Ground every claim in the data provided. Don't invent metrics.
- If a signal is missing (e.g., no CV observations), say so in a concern rather than guessing.
- If the batch ended at a non-terminal phase (not 'harvested' or 'culled'), note that the run was archived early.`;

function userPrompt(ctx) {
  return `Here is the batch's full signal stack as JSON. Write the retrospective per the system instructions. Respond with JSON only — no prose, no fences.

${JSON.stringify(ctx, null, 2)}`;
}

function buildBatchContext(batchId) {
  const batch = Q.getBatch(batchId);
  if (!batch) throw new Error(`batch ${batchId} not found`);

  const events = Q.listBatchEvents(batchId, 500);
  const stats = Q.getBatchStats(batchId);

  // Readings are tagged with batch_id on ingest, so filtering directly
  // scopes stats to this batch's window without guessing time ranges.
  const readingStats = getDb().prepare(
    `SELECT MIN(temperature) AS temp_min, MAX(temperature) AS temp_max,
            AVG(temperature) AS temp_avg,
            MIN(humidity) AS humid_min, MAX(humidity) AS humid_max,
            AVG(humidity) AS humid_avg,
            COUNT(*) AS count
     FROM readings WHERE batch_id = ?`
  ).get(batchId);

  const observations = Q.listObservations({ batch_id: batchId, limit: 200 });
  const cvStages = {};
  let contaminationHits = 0;
  for (const o of observations) {
    if (o.error) continue;
    if (o.growth_stage) cvStages[o.growth_stage] = (cvStages[o.growth_stage] || 0) + 1;
    if (o.contamination_risk === 'medium' || o.contamination_risk === 'high') {
      contaminationHits++;
    }
  }

  // Phase transitions from the event log (chronological).
  const phaseChanges = events
    .filter((e) => e.kind === 'phase_change')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((e) => ({ at: e.timestamp, detail: e.detail }));

  const startedMs = new Date(batch.started_at.replace(' ', 'T') + 'Z').getTime();
  const endedMs = batch.ended_at
    ? new Date(batch.ended_at.replace(' ', 'T') + 'Z').getTime()
    : Date.now();
  const durationDays = Math.max(0, Math.floor((endedMs - startedMs) / 86400000));

  const species = batch.species_key && SPECIES_PRESETS[batch.species_key]
    ? {
      key: batch.species_key,
      name: SPECIES_PRESETS[batch.species_key].name,
      temp_range: `${SPECIES_PRESETS[batch.species_key].temp_min}-${SPECIES_PRESETS[batch.species_key].temp_max}°F`,
      humid_range: `${SPECIES_PRESETS[batch.species_key].humid_min}-${SPECIES_PRESETS[batch.species_key].humid_max}%`,
    }
    : null;

  return {
    batch: {
      id: batch.id,
      name: batch.name,
      phase_ended: batch.phase,
      duration_days: durationDays,
      started_at: batch.started_at,
      ended_at: batch.ended_at,
      yield_grams: batch.yield_grams,
      cull_reason: batch.cull_reason,
      notes: batch.notes,
      archived_early: !!batch.ended_at && batch.phase !== 'harvested' && batch.phase !== 'culled',
    },
    species,
    reading_stats: readingStats && readingStats.count > 0 ? {
      count: readingStats.count,
      temp_f: {
        min: Number(readingStats.temp_min?.toFixed?.(1) ?? readingStats.temp_min),
        avg: Number(readingStats.temp_avg?.toFixed?.(1) ?? readingStats.temp_avg),
        max: Number(readingStats.temp_max?.toFixed?.(1) ?? readingStats.temp_max),
      },
      humidity_pct: {
        min: Number(readingStats.humid_min?.toFixed?.(1) ?? readingStats.humid_min),
        avg: Number(readingStats.humid_avg?.toFixed?.(1) ?? readingStats.humid_avg),
        max: Number(readingStats.humid_max?.toFixed?.(1) ?? readingStats.humid_max),
      },
    } : null,
    phase_transitions: phaseChanges,
    events_summary: {
      total: events.length,
      by_kind: events.reduce((acc, e) => {
        acc[e.kind] = (acc[e.kind] || 0) + 1;
        return acc;
      }, {}),
    },
    recent_notes: events
      .filter((e) => e.kind === 'note')
      .slice(0, 10)
      .map((e) => ({ at: e.timestamp, detail: e.detail })),
    cv: {
      total_observations: observations.length,
      errored: observations.filter((o) => o.error).length,
      contamination_hits: contaminationHits,
      stages_seen: cvStages,
    },
    actuators: stats.devices.map((d) => ({
      device: d.device,
      events: d.events,
      on_events: d.on_events,
    })),
    insights_generated: stats.insights,
  };
}

function parseSummary(rawText) {
  const trimmed = (rawText || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('model response was not JSON');
    parsed = JSON.parse(m[0]);
  }

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim().slice(0, 120) : '';
  if (!headline) throw new Error('headline missing');

  const health = ['excellent', 'good', 'mixed', 'poor'].includes(parsed.health_rating)
    ? parsed.health_rating : 'mixed';

  const cleanList = (arr, max) => (Array.isArray(arr) ? arr : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, max)
    .map((s) => s.trim().slice(0, 240));

  const highlights = cleanList(parsed.highlights, 4);
  const concerns = cleanList(parsed.concerns, 3);
  const lessons = cleanList(parsed.lessons, 3);

  return { headline, health_rating: health, highlights, concerns, lessons };
}

// Renders the structured summary into the body field as markdown.
// The frontend just renders body text; keeping structure in the text
// avoids a schema migration and still reads cleanly in the insights UI.
function renderBody({ health_rating, highlights, concerns, lessons }) {
  const sections = [];
  sections.push(`**Rating:** ${health_rating}`);
  if (highlights.length) {
    sections.push(`**Highlights**\n${highlights.map((s) => `- ${s}`).join('\n')}`);
  }
  if (concerns.length) {
    sections.push(`**Concerns**\n${concerns.map((s) => `- ${s}`).join('\n')}`);
  }
  if (lessons.length) {
    sections.push(`**Lessons for next run**\n${lessons.map((s) => `- ${s}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

async function summarize(batchId, { force = false } = {}) {
  const cfg = advisor.getConfig();
  if (!force && !cfg.enabled) {
    return { skipped: true, reason: 'ai_disabled' };
  }

  const ctx = buildBatchContext(batchId);
  const provider = cfg.provider === 'ollama' ? ollama : anthropic;
  const model = cfg.provider === 'ollama' ? cfg.ollama_model : cfg.anthropic_model;

  const started = Date.now();
  let raw;
  try {
    raw = await provider.invoke({
      systemPrompt: SYSTEM_PROMPT,
      userText: userPrompt(ctx),
      model,
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err), provider: cfg.provider, model };
  }
  const latency = Date.now() - started;

  let summary;
  try {
    summary = parseSummary(raw.raw_text);
  } catch (err) {
    return {
      ok: false,
      error: `parse_failed: ${err.message}`,
      provider: cfg.provider,
      model: raw.model,
      raw_text: raw.raw_text.slice(0, 400),
    };
  }

  const info = Q.insertAIInsight({
    provider: cfg.provider,
    model: raw.model,
    category: 'summary',
    severity: 'info',
    title: summary.headline,
    body: renderBody(summary),
    actions: [],
    input_tokens: raw.input_tokens,
    output_tokens: raw.output_tokens,
    latency_ms: latency,
    batch_id: batchId,
  });

  Q.insertBatchEvent({
    batch_id: batchId,
    kind: 'summary',
    detail: `AI retrospective generated · ${summary.health_rating}`,
    user_id: null,
  });

  return {
    ok: true,
    insight_id: info.lastInsertRowid,
    provider: cfg.provider,
    model: raw.model,
    latency_ms: latency,
    summary,
  };
}

module.exports = { summarize, buildBatchContext, parseSummary, SYSTEM_PROMPT };
