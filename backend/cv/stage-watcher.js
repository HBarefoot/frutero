const { Q, getDb } = require('../database');
const notifications = require('../notifications');

// Growth-stage auto-advance suggestion. Called after every successful
// (non-error) cv_observations insert. Walks the batch's recent
// non-error observations; if the last N all agree on a stage that is
// a strict forward transition from the batch's current phase, emits
// a recommendation ai_insight + warn notification.
//
// Safety: this never mutates the batch. The operator reviews and
// clicks "Advance batch" in the UI, which calls PATCH /batches/:id.
// One bad vision reading should not flip a batch to a later phase.

// Vision stages we care about for auto-advance. `harvestable` is
// intentionally NOT mapped: the batch transition to `harvested`
// archives the batch, which should be an explicit operator call.
const VISION_TO_PHASE = {
  colonization: 'colonization',
  pinning: 'pinning',
  fruiting: 'fruiting',
};

const PHASE_ORDER = {
  colonization: 0,
  pinning: 1,
  fruiting: 2,
  harvested: 3,
  culled: 3,
};

function getConfig() {
  const s = Q.getAllSettings();
  return {
    enabled: s.cv_stage_advance_enabled !== '0', // default on
    threshold: Math.max(2, Math.min(10, parseInt(s.cv_stage_advance_threshold, 10) || 3)),
  };
}

// A recent pending suggestion for the same (batch, target) should
// block a duplicate. "Pending" means status in ('new', 'acknowledged')
// — a dismissed or applied one doesn't block a future re-suggestion.
// Debounce window (24h) also prevents rapid re-fire after dismiss.
function hasRecentPending(batchId, targetPhase) {
  const row = getDb().prepare(
    `SELECT id FROM ai_insights
     WHERE batch_id = ?
       AND category = 'recommendation'
       AND title LIKE ?
       AND (
         status IN ('new', 'acknowledged')
         OR timestamp >= datetime('now', '-24 hours')
       )
     LIMIT 1`
  ).get(batchId, `%${targetPhase}%`);
  return !!row;
}

// Inspect the last N non-error observations for the batch; if all N
// map to the same batch-phase AND that phase is strictly forward from
// the current one, return it. Otherwise null.
function consistentTarget(observations, currentPhase, threshold) {
  const recent = observations.filter((o) => !o.error).slice(0, threshold);
  if (recent.length < threshold) return null;

  const target = VISION_TO_PHASE[recent[0].growth_stage];
  if (!target) return null;
  if (!recent.every((o) => VISION_TO_PHASE[o.growth_stage] === target)) return null;

  const currentRank = PHASE_ORDER[currentPhase] ?? -1;
  const targetRank = PHASE_ORDER[target] ?? -1;
  if (targetRank <= currentRank) return null;

  return target;
}

async function checkAfterObservation(observation) {
  try {
    const cfg = getConfig();
    if (!cfg.enabled) return { skipped: true, reason: 'disabled' };

    const batchId = observation?.batch_id;
    if (!batchId) return { skipped: true, reason: 'no_batch' };

    const batch = Q.getBatch(batchId);
    if (!batch || batch.ended_at) return { skipped: true, reason: 'batch_inactive' };

    const observations = Q.listObservations({ batch_id: batchId, limit: cfg.threshold });
    const target = consistentTarget(observations, batch.phase, cfg.threshold);
    if (!target) return { skipped: true, reason: 'no_consensus' };

    if (hasRecentPending(batchId, target)) {
      return { skipped: true, reason: 'already_pending' };
    }

    const title = `Stage transition detected: ${target}`;
    const body = `The last ${cfg.threshold} AI observations of this batch all look like ${target}. `
      + `The batch is currently in ${batch.phase}. Review and advance when ready — the system will not change phase on its own.`;

    const action = {
      label: `Advance to ${target}`,
      hint: `Updates batch '${batch.name}' to phase ${target}.`,
      kind: 'advance_batch_phase',
      phase: target,
      batch_id: batchId,
    };

    const info = Q.insertAIInsight({
      provider: 'system',
      model: 'stage-watcher',
      category: 'recommendation',
      severity: 'warn',
      title,
      body,
      actions: [action],
      batch_id: batchId,
    });

    notifications
      .notify({
        title: `CV · ${title}`,
        body: `${batch.name} — ${cfg.threshold} consecutive ${target} readings. Review in the AI tab.`,
        severity: 'warn',
      })
      .catch((err) => console.error('[stage-watcher] notify failed:', err));

    return { ok: true, insight_id: info.lastInsertRowid, target };
  } catch (err) {
    console.error('[stage-watcher] unexpected error:', err);
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { checkAfterObservation, getConfig, consistentTarget };
