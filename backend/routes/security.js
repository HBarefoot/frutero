const express = require('express');
const { UAParser } = require('ua-parser-js');
const { Q } = require('../database');
const { throttles } = require('../throttle');
const auth = require('../auth');
const config = require('../config');
const { loadTlsCredentials } = require('../tls');

const router = express.Router();

// Owner-only security posture snapshot. Powers the /security page. No
// secrets ever leave this endpoint — pepper, cert bodies, session tokens
// are strictly backend-internal; this returns booleans + counts + preview
// strings only.
router.get('/security', auth.requireAdmin, (_req, res) => {
  const tlsLive = !!loadTlsCredentials();

  const throttleStats = {};
  for (const [name, t] of Object.entries(throttles)) {
    throttleStats[name] = {
      threshold: t.threshold,
      window_seconds: Math.floor(t.windowMs / 1000),
      offenders: t.stats(),
    };
  }

  const sessions = Q.listAllActiveSessions().map((s) => {
    const parsed = parseUa(s.user_agent);
    return {
      token_preview: s.token.slice(0, 8),
      user_id: s.user_id,
      user_email: s.user_email,
      user_name: s.user_name,
      user_role: s.user_role,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      expires_at: s.expires_at,
      ip: s.ip,
      user_agent_raw: s.user_agent,
      user_agent: parsed,
    };
  });

  const invLegacy = Q.countLegacyPlaintextInvites();
  const resetLegacy = Q.countLegacyPlaintextResets();

  res.json({
    tls: {
      active: tlsLive,
      key_path: config.TLS_KEY_PATH || null,
      cert_path: config.TLS_CERT_PATH || null,
      https_port: config.HTTPS_PORT,
      http_port: config.PORT,
    },
    headers: {
      content_security_policy: true,
      x_frame_options: true,
      x_content_type_options: true,
      referrer_policy: true,
      hsts: tlsLive,
    },
    tokens_at_rest: {
      invites_plaintext: invLegacy,
      password_resets_plaintext: resetLegacy,
      fully_hashed: invLegacy === 0 && resetLegacy === 0,
    },
    throttles: throttleStats,
    sessions,
    backup: {
      last_backup_at: Q.getSecret('last_backup_at'),
      last_backup_bytes: parseInt(Q.getSecret('last_backup_bytes') || '0', 10) || 0,
    },
  });
});

function parseUa(raw) {
  if (!raw) return { summary: 'unknown', browser: null, os: null };
  try {
    const p = new UAParser(raw).getResult();
    const browser = p.browser.name ? `${p.browser.name}${p.browser.version ? ' ' + p.browser.version.split('.')[0] : ''}` : null;
    const os = p.os.name ? `${p.os.name}${p.os.version ? ' ' + p.os.version : ''}` : null;
    const summary = [browser, os].filter(Boolean).join(' on ') || 'unknown';
    return { summary, browser, os };
  } catch {
    return { summary: 'unknown', browser: null, os: null };
  }
}

module.exports = router;
