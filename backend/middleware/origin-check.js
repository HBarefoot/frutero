// Lightweight CSRF-style guard: reject mutation requests whose Origin (or
// Referer) doesn't match the server's own host. This is defense-in-depth
// on top of SameSite=Lax session cookies. It covers the 1% of browsers/
// proxies that strip SameSite or predate it.
//
// Philosophy:
//   - GET/HEAD/OPTIONS are exempt (cacheable, non-mutating).
//   - If neither Origin nor Referer is present (common for curl / CLI
//     tools / node-fetch), we pass — the session cookie is the real
//     authorization. Blocking would break legit automation.
//   - If Origin is present, it must match the request's host.
//   - If Origin is missing but Referer is present, the Referer origin
//     must match.
//   - TRUSTED_ORIGINS env var allows a CSV whitelist for cross-origin
//     reverse-proxy deployments (e.g., `https://farm.example.com`).

function parseOrigin(str) {
  if (!str) return null;
  try {
    const u = new URL(str);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function selfOriginsFor(req) {
  const host = req.get('host');
  if (!host) return [];
  // Match both http and https since the appliance may run either. The
  // mutation path still requires an authenticated session, so allowing
  // both schemes here doesn't weaken the check.
  return [`http://${host}`, `https://${host}`];
}

function originCheck({ trustedOrigins = [] } = {}) {
  const trusted = new Set(trustedOrigins.filter(Boolean));
  return (req, res, next) => {
    const method = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const originHeader = parseOrigin(req.get('origin'));
    const refererHeader = parseOrigin(req.get('referer'));

    // Neither header: treat as API client (curl, fleet agent). Authorized
    // by session cookie / token alone.
    if (!originHeader && !refererHeader) return next();

    const allowed = new Set([...selfOriginsFor(req), ...trusted]);

    const claim = originHeader || refererHeader;
    if (allowed.has(claim)) return next();

    return res.status(403).json({
      error: 'origin_mismatch',
      detail: `Request origin '${claim}' is not allowed for this host.`,
    });
  };
}

module.exports = { originCheck };
