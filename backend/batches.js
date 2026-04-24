const { Q } = require('./database');

// Cached active-batch lookup. The batch gets stamped on every device
// transition, every sensor reading (once M3 lands), and every AI
// insight — hot path enough that we want to avoid a SQLite hit every
// single time. Cache for 30s; any write path that changes the active
// batch must call invalidate().

const CACHE_TTL_MS = 30 * 1000;
let cached = null; // { id, cachedAt }

function getActiveBatchId() {
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.id;
  }
  const row = Q.getActiveBatch();
  cached = { id: row?.id ?? null, cachedAt: Date.now() };
  return cached.id;
}

function invalidate() {
  cached = null;
}

module.exports = { getActiveBatchId, invalidate };
