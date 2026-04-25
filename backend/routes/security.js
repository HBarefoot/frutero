const fs = require('node:fs');
const { execSync } = require('node:child_process');
const express = require('express');
const { UAParser } = require('ua-parser-js');
const { Q } = require('../database');
const { throttles } = require('../throttle');
const auth = require('../auth');
const config = require('../config');
const { loadTlsCredentials } = require('../tls');

const router = express.Router();

// Parses journald's "Archived and active journals take up X.YG in the..."
// output into raw bytes. Returns null if journalctl isn't present or the
// format surprises us — Security page will gracefully hide the card.
function journalDiskUsage() {
  try {
    const out = execSync('journalctl --disk-usage', { encoding: 'utf8', timeout: 3000 });
    const m = out.match(/(\d+(?:\.\d+)?)([KMGT]?)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2];
    const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[unit] || 1;
    return Math.round(n * mult);
  } catch {
    return null;
  }
}

// Parses a journald.conf drop-in for our SystemMaxUse/MaxRetentionSec
// values. The installer writes a known location; any custom operator
// value in that file is reflected here unchanged.
function journalLimits() {
  try {
    const text = fs.readFileSync('/etc/systemd/journald.conf.d/frutero.conf', 'utf8');
    const max = text.match(/^\s*SystemMaxUse\s*=\s*(\S+)/m);
    const ret = text.match(/^\s*MaxRetentionSec\s*=\s*(\S+)/m);
    return { max_size_raw: max?.[1] || null, retention_raw: ret?.[1] || null };
  } catch {
    return { max_size_raw: null, retention_raw: null };
  }
}

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
    logs: {
      disk_usage_bytes: journalDiskUsage(),
      ...journalLimits(),
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

// GET/PUT /api/security/access-log — owner-only toggle for the
// diagnostic access log. Off by default; flip on to investigate the
// terminal-init connection drop, then flip off so journald doesn't
// fill up. Reads/writes the access_log_enabled setting which the
// access-log middleware checks on every request.
router.get('/security/access-log', auth.requireAdmin, (_req, res) => {
  const enabled = Q.getAllSettings().access_log_enabled === '1';
  res.json({ enabled });
});
router.put('/security/access-log', auth.requireAdmin, (req, res) => {
  const enabled = req.body?.enabled === true;
  Q.setSetting('access_log_enabled', enabled ? '1' : '0');
  auth.logAudit(req, 'security.access_log.toggle', null, { enabled });
  res.json({ enabled });
});

// GET /api/security/terminal — admin-only browser terminal status. Tells
// the UI whether ttyd is reachable + reveals the password copy-paste-able
// so the operator doesn't have to dig in /etc/. The password lives in
// secrets.terminal_password (seeded by install.sh).
router.get('/security/terminal', auth.requireAdmin, async (_req, res) => {
  const password = Q.getSecret('terminal_password') || null;
  // Quick reachability probe — connects to the loopback ttyd port.
  // Failure means the systemd unit didn't start; the card surfaces it.
  let reachable = false;
  try {
    const net = require('node:net');
    await new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: 7681 });
      sock.setTimeout(500);
      sock.once('connect', () => { reachable = true; sock.end(); resolve(); });
      sock.once('timeout', () => { sock.destroy(); resolve(); });
      sock.once('error', () => resolve());
    });
  } catch { /* keep reachable=false */ }

  res.json({
    reachable,
    has_password: !!password,
    password,
    username: 'frutero',
    url_path: '/terminal/',
    port: 7681,
  });
});

module.exports = router;
