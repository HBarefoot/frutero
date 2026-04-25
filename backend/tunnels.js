const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const config = require('./config');

// Detects available off-LAN URLs the cloud can use to reach this Pi.
// Each detector is best-effort + non-fatal — a failure or missing
// daemon just omits that candidate. Run order doesn't matter; the
// caller priority-orders the result.
//
// Detectors are SYNCHRONOUS where possible because they're cheap and
// only run on /api/fleet/status fetches (~15s polling cadence). The
// ngrok detector is async because it needs an HTTP probe to ngrok's
// local control API.

const PROBE_TIMEOUT_MS = 1000;

function piPort() {
  // Match what computeLocalUrl uses for the LAN URL — keeps fallback
  // behavior identical when only LAN is detected.
  const tlsActive = config.TLS_ENABLED && config.TLS_KEY_PATH && config.TLS_CERT_PATH;
  return tlsActive
    ? { scheme: 'https', port: config.HTTPS_PORT }
    : { scheme: 'http', port: config.PORT };
}

// Tailscale: prefer the CLI which gives the deterministic 100.64/10
// address regardless of interface naming. Fall back to scanning
// `tailscale0` from the OS interface table.
function detectTailscale() {
  const { scheme, port } = piPort();
  let ip = null;
  try {
    const out = execSync('tailscale ip -4', {
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().split('\n')[0];
    if (out && /^\d+\.\d+\.\d+\.\d+$/.test(out)) ip = out;
  } catch { /* fall through */ }
  if (!ip) {
    const ifaces = os.networkInterfaces().tailscale0 || [];
    const v4 = ifaces.find((i) => i.family === 'IPv4' && !i.internal);
    if (v4) ip = v4.address;
  }
  if (!ip) return null;
  return {
    kind: 'tailscale',
    label: 'Tailscale',
    url: `${scheme}://${ip}:${port}`,
  };
}

// Cloudflare Tunnel: requires the cloudflared service to be active and
// the operator to have configured an ingress rule with a public
// hostname. We parse the YAML by line-level regex to avoid pulling
// js-yaml into the dependency tree for a one-off helper.
function detectCloudflareTunnel() {
  // Cheap pre-check — if the binary isn't installed or the service
  // isn't running, skip the file IO entirely.
  let active = false;
  try {
    const out = execSync('systemctl is-active cloudflared', {
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    active = out === 'active';
  } catch { /* not installed or failed */ }
  if (!active) return null;

  const candidatePaths = [
    '/etc/cloudflared/config.yml',
    '/etc/cloudflared/config.yaml',
    path.join(os.homedir(), '.cloudflared/config.yml'),
    path.join(os.homedir(), '.cloudflared/config.yaml'),
  ];
  for (const p of candidatePaths) {
    let yml;
    try { yml = fs.readFileSync(p, 'utf8'); }
    catch { continue; }
    // Match `- hostname: chamber.example.com` (with optional quotes).
    const m = yml.match(/^\s*-\s*hostname:\s*['"]?([^'"\s\n]+)/m);
    if (m) {
      return {
        kind: 'cloudflare',
        label: 'Cloudflare Tunnel',
        url: `https://${m[1]}`,
      };
    }
  }
  return null;
}

// ngrok: query the local control API at 4040. Returns the first https
// public URL. If the daemon isn't running, fetch fails fast.
async function detectNgrok() {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!Array.isArray(j.tunnels)) return null;
    const t = j.tunnels.find((x) => typeof x?.public_url === 'string' && x.public_url.startsWith('https://'))
      || j.tunnels.find((x) => typeof x?.public_url === 'string');
    if (!t) return null;
    return { kind: 'ngrok', label: 'ngrok', url: t.public_url };
  } catch {
    return null;
  }
}

// LAN: existing host.getPrimaryIPv4 + active port. Always last in the
// priority order so it's the fallback when nothing else is up.
function detectLan() {
  const host = require('./host');
  const ip = host.getPrimaryIPv4();
  if (!ip) return null;
  const { scheme, port } = piPort();
  return { kind: 'lan', label: 'LAN', url: `${scheme}://${ip}:${port}` };
}

// Returns priority-ordered candidates. Cloudflare > Tailscale > ngrok
// > LAN. Cloudflare wins because it's the only option that works for
// non-tailnet team members. ngrok comes after Tailscale because the
// public_url changes on every ngrok restart.
async function detectTunnels() {
  const cf = detectCloudflareTunnel();
  const ts = detectTailscale();
  const ng = await detectNgrok();
  const lan = detectLan();
  return [cf, ts, ng, lan].filter(Boolean);
}

module.exports = {
  detectTunnels,
  detectTailscale,
  detectCloudflareTunnel,
  detectNgrok,
  detectLan,
};
