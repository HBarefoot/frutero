const express = require('express');
const { Q } = require('../database');
const auth = require('../auth');
const advisor = require('../ai/advisor');
const anthropicProvider = require('../ai/providers/anthropic');
const ollamaProvider = require('../ai/providers/ollama');

const router = express.Router();

// Owner-only config: provider selection, keys, models, cadence.
// API key is write-only from the client's perspective — we never echo
// it back. Responses include a boolean `has_key` flag instead.

const CONFIG_FIELDS = [
  'ai_enabled',
  'ai_provider',
  'ai_anthropic_model',
  'ai_ollama_base_url',
  'ai_ollama_model',
  'ai_cadence_hours',
];

function currentConfig() {
  const s = Q.getAllSettings();
  return {
    enabled: s.ai_enabled === '1',
    provider: s.ai_provider || 'anthropic',
    anthropic: {
      model: s.ai_anthropic_model || anthropicProvider.DEFAULT_MODEL,
      has_key: !!(Q.getSecret('ai_anthropic_api_key') || process.env.ANTHROPIC_API_KEY),
    },
    ollama: {
      base_url: s.ai_ollama_base_url || ollamaProvider.DEFAULT_BASE_URL,
      model: s.ai_ollama_model || ollamaProvider.DEFAULT_MODEL,
    },
    cadence_hours: parseInt(s.ai_cadence_hours, 10) || 6,
    defaults: {
      anthropic_model: anthropicProvider.DEFAULT_MODEL,
      ollama_base_url: ollamaProvider.DEFAULT_BASE_URL,
      ollama_model: ollamaProvider.DEFAULT_MODEL,
    },
  };
}

router.get('/ai/config', auth.requireAdmin, (_req, res) => {
  res.json(currentConfig());
});

router.put('/ai/config', auth.requireAdmin, (req, res) => {
  const body = req.body || {};

  if (body.provider !== undefined && !['anthropic', 'ollama'].includes(body.provider)) {
    return res.status(400).json({ error: 'provider must be anthropic or ollama' });
  }
  if (body.cadence_hours !== undefined) {
    const n = Number(body.cadence_hours);
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      return res.status(400).json({ error: 'cadence_hours must be 1-168' });
    }
  }

  const mapping = {
    enabled: 'ai_enabled',
    provider: 'ai_provider',
    anthropic_model: 'ai_anthropic_model',
    ollama_base_url: 'ai_ollama_base_url',
    ollama_model: 'ai_ollama_model',
    cadence_hours: 'ai_cadence_hours',
  };

  for (const [k, settingKey] of Object.entries(mapping)) {
    if (body[k] === undefined) continue;
    const value = k === 'enabled' ? (body[k] ? '1' : '0') : String(body[k]);
    Q.setSetting(settingKey, value);
  }

  // API key handling — sent as `anthropic_api_key` (set) or explicit
  // null/empty to clear. Never stored in the settings table; lives in
  // `secrets` so it's not bulk-exported with the config.
  if (body.anthropic_api_key !== undefined) {
    const k = String(body.anthropic_api_key || '').trim();
    if (k.length === 0) {
      Q.deleteSecret('ai_anthropic_api_key');
    } else if (k.length < 16 || !k.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'anthropic_api_key looks malformed (expected sk-ant-…)' });
    } else {
      Q.setSecret('ai_anthropic_api_key', k);
    }
  }

  auth.logAudit(req, 'ai.config_update', null, {
    fields: Object.keys(body).filter((k) => k !== 'anthropic_api_key'),
    rotated_key: body.anthropic_api_key !== undefined,
  });

  res.json(currentConfig());
});

// GET /ai/insights — list recent insights. Any authenticated user can
// read; dismissing/acknowledging still requires mutate role via the
// global gate.
router.get('/ai/insights', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json({
    entries: Q.listAIInsights(limit),
    count_24h: Q.countAIInsights(24),
  });
});

router.patch('/ai/insights/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const { status } = req.body || {};
  if (!['new', 'acknowledged', 'dismissed', 'applied'].includes(status)) {
    return res.status(400).json({ error: 'status must be new|acknowledged|dismissed|applied' });
  }
  const info = Q.updateAIInsightStatus(id, status, req.user?.id ?? null);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  auth.logAudit(req, 'ai.insight_status', `insight:${id}`, { status });
  res.json({ ok: true });
});

// POST /ai/run — manual trigger. Owner-only; also runs even if
// `ai_enabled=0` so you can sanity-test a newly-configured provider.
//
// Fire-and-forget by design: local LLMs on a Pi routinely take 30–90 s
// to complete, and Claude with adaptive thinking can be similar on big
// prompts. Holding the HTTP connection open that long runs into axios
// defaults, nginx 60s caps, and the backend's 10-min max. Instead we
// kick off the run in the background and let the `/ai/insights` list
// (polled every 30 s by the UI) surface new entries when they land.
//
// Serialization: a single in-flight run at a time. Clicking Generate
// twice in quick succession returns { already_running: true } on the
// second press rather than queuing a second call against the provider.
//
// `lastRun` captures the outcome of the most recent run so the UI can
// distinguish "still running" from "failed silently" (Ollama unreachable,
// API key wrong, parse failure, etc.) — without it, a failed run looks
// the same as a slow run that never produces insights.
let runInFlight = null;
let lastRun = null;

router.post('/ai/run', auth.requireAdmin, (req, res) => {
  const cfg = advisor.getConfig();
  if (runInFlight) {
    return res.status(202).json({
      started: false,
      already_running: true,
      provider: cfg.provider,
    });
  }

  const startedAt = Date.now();
  runInFlight = advisor.runOnce({ force: true })
    .then((result) => {
      lastRun = {
        ok: !!result.ok,
        provider: result.provider || cfg.provider,
        model: result.model || null,
        insights: result.insights_generated ?? 0,
        error: result.error || null,
        latency_ms: result.latency_ms ?? null,
        started_at: startedAt,
        finished_at: Date.now(),
      };
      console.log('[ai] manual run finished:', lastRun);
      return lastRun;
    })
    .catch((err) => {
      lastRun = {
        ok: false,
        provider: cfg.provider,
        model: null,
        insights: 0,
        error: err.message || 'run_failed',
        latency_ms: null,
        started_at: startedAt,
        finished_at: Date.now(),
      };
      console.error('[ai] manual run failed:', err);
      return lastRun;
    })
    .finally(() => {
      runInFlight = null;
    });

  auth.logAudit(req, 'ai.manual_run', null, { provider: cfg.provider });

  // 202 Accepted — work is in progress, see /api/ai/insights for results.
  // started_at lets the UI correlate this run with the eventual /ai/last-run row.
  res.status(202).json({
    started: true,
    started_at: startedAt,
    provider: cfg.provider,
    model: cfg.provider === 'ollama' ? cfg.ollama_model : cfg.anthropic_model,
    hint: 'Run started. New insights will appear on the /ai page within a minute for Claude, or 1–3 minutes for Ollama on Pi-class hardware.',
  });
});

// GET /ai/last-run — outcome of the most recent manual run. Frontend
// uses this to surface failures (ok=false, error=<reason>) that would
// otherwise be invisible since failed runs produce zero new insights.
router.get('/ai/last-run', auth.requireAdmin, (_req, res) => {
  res.json({ last_run: lastRun, in_flight: !!runInFlight });
});

module.exports = router;
