// Generic IP-keyed sliding throttle used by every rate-limited auth
// surface. Each throttle is isolated so hammering one endpoint (say
// login) doesn't freeze legit traffic on another (say invite accept).
//
// All counters are in-memory and reset on server restart — appropriate
// for an appliance deployed on a single Pi. A reverse proxy (nginx,
// Cloudflare) is still authoritative once we're behind one; this is
// defense in depth for bare deployments.
//
// Semantic: within a rolling `windowMs`, once `threshold` failures
// from a given key have been recorded, subsequent checks return
// `throttled=true` with a `retryAfterSeconds` until the window closes.
// A successful request should call `reset(key)` to wipe the counter.

function makeThrottle({ threshold, windowMs, name = 'unnamed' }) {
  const fails = new Map(); // key → { count, firstAt, lastAt }

  function isThrottled(key) {
    if (!key) return { throttled: false, retryAfterSeconds: 0 };
    const entry = fails.get(key);
    if (!entry) return { throttled: false, retryAfterSeconds: 0 };
    const elapsed = Date.now() - entry.firstAt;
    if (elapsed > windowMs) {
      fails.delete(key);
      return { throttled: false, retryAfterSeconds: 0 };
    }
    if (entry.count < threshold) return { throttled: false, retryAfterSeconds: 0 };
    return {
      throttled: true,
      retryAfterSeconds: Math.ceil((windowMs - elapsed) / 1000),
    };
  }

  function recordFail(key) {
    if (!key) return;
    const entry = fails.get(key) || { count: 0, firstAt: Date.now(), lastAt: 0 };
    // Slide the window: if the previous window has already expired, start
    // a fresh count on this failure.
    if (Date.now() - entry.firstAt > windowMs) {
      entry.count = 0;
      entry.firstAt = Date.now();
    }
    entry.count += 1;
    entry.lastAt = Date.now();
    fails.set(key, entry);
  }

  function reset(key) {
    if (key) fails.delete(key);
  }

  // Returns a snapshot of current offenders. Used by the Security page
  // in M5 so owners can see live throttle state.
  function stats() {
    const now = Date.now();
    const rows = [];
    for (const [key, entry] of fails.entries()) {
      const elapsed = now - entry.firstAt;
      if (elapsed > windowMs) continue;
      rows.push({
        key,
        count: entry.count,
        last_at: new Date(entry.lastAt).toISOString(),
        throttled: entry.count >= threshold,
        retry_after_seconds: entry.count >= threshold
          ? Math.ceil((windowMs - elapsed) / 1000)
          : 0,
      });
    }
    return rows;
  }

  return {
    name,
    threshold,
    windowMs,
    isThrottled,
    recordFail,
    reset,
    stats,
  };
}

// Named throttles, tuned per surface:
//   login        — 5 fails / 15 min   (matches previous behavior)
//   register     — 3 / 15 min         (first-run owner creation)
//   reset        — 3 / 1 hour         (password reset requests are rare)
//   invite_accept — 5 / 15 min        (accepting an invite has 32-byte token; brute force is impractical but DoS is not)
const loginThrottle = makeThrottle({
  threshold: 5,
  windowMs: 15 * 60 * 1000,
  name: 'login',
});
const registerThrottle = makeThrottle({
  threshold: 3,
  windowMs: 15 * 60 * 1000,
  name: 'register',
});
const resetThrottle = makeThrottle({
  threshold: 3,
  windowMs: 60 * 60 * 1000,
  name: 'reset',
});
const inviteAcceptThrottle = makeThrottle({
  threshold: 5,
  windowMs: 15 * 60 * 1000,
  name: 'invite_accept',
});

// Express middleware factory. Call with a throttle instance + key extractor.
function throttleMiddleware(throttle, { extract }) {
  return (req, res, next) => {
    const key = typeof extract === 'function' ? extract(req) : null;
    const { throttled, retryAfterSeconds } = throttle.isThrottled(key);
    if (throttled) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'too_many_attempts',
        retry_after_seconds: retryAfterSeconds,
      });
    }
    next();
  };
}

const throttles = {
  login: loginThrottle,
  register: registerThrottle,
  reset: resetThrottle,
  invite_accept: inviteAcceptThrottle,
};

module.exports = {
  makeThrottle,
  throttleMiddleware,
  loginThrottle,
  registerThrottle,
  resetThrottle,
  inviteAcceptThrottle,
  throttles,
};
