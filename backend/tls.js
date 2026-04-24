const fs = require('node:fs');
const config = require('./config');

// Loads TLS credentials from paths on disk if TLS_ENABLED is set and
// the cert + key files actually exist. Returns null (→ HTTP-only mode)
// on any failure, with a diagnostic log.
//
// The installer (`install.sh`) generates a self-signed cert under
// /etc/frutero/ on first run and drops a systemd drop-in that points
// this module at it. Operators who later bring their own cert just
// replace the files — no app code changes needed.
function loadTlsCredentials() {
  if (!config.TLS_ENABLED) return null;
  if (!config.TLS_KEY_PATH || !config.TLS_CERT_PATH) {
    console.warn('[tls] TLS_ENABLED=true but TLS_KEY_PATH/TLS_CERT_PATH unset — staying on HTTP');
    return null;
  }
  try {
    const key = fs.readFileSync(config.TLS_KEY_PATH);
    const cert = fs.readFileSync(config.TLS_CERT_PATH);
    return { key, cert };
  } catch (err) {
    console.warn(`[tls] cert load failed (${err.code || err.message}) — staying on HTTP`);
    return null;
  }
}

module.exports = { loadTlsCredentials };
