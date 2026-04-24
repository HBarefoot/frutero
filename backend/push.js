const webpush = require('web-push');
const { Q } = require('./database');

// Web Push orchestration. Key responsibilities:
// 1. Lazy-init VAPID keys (stored in the secrets table on first access).
// 2. Send a push to a specific user (all their subscribed devices) or
//    fan-out to all users.
// 3. Prune dead subscriptions on 410 Gone (typical when a browser
//    uninstalls or the user revokes permission).

let vapidLoaded = false;

function loadVapid() {
  if (vapidLoaded) return;
  let pub = Q.getSecret('push_vapid_public');
  let priv = Q.getSecret('push_vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    Q.setSecret('push_vapid_public', pub);
    Q.setSecret('push_vapid_private', priv);
  }
  const subject = Q.getAllSettings().push_vapid_subject || 'mailto:frutero-owner@example.com';
  webpush.setVapidDetails(subject, pub, priv);
  vapidLoaded = true;
}

function getPublicKey() {
  loadVapid();
  return Q.getSecret('push_vapid_public');
}

function isEnabled() {
  return Q.getAllSettings().notify_push_enabled === '1';
}

async function sendToSubscription(sub, payload) {
  loadVapid();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    Q.touchPushSubscription(sub.endpoint);
    return { ok: true };
  } catch (err) {
    const status = err.statusCode;
    // 404/410 mean the subscription is dead — the browser has revoked
    // or the push service has expired it. Prune silently.
    if (status === 404 || status === 410) {
      Q.deletePushSubscription({ endpoint: sub.endpoint });
      return { ok: false, pruned: true, status };
    }
    return { ok: false, status, detail: err.body || err.message };
  }
}

async function sendToUser(userId, payload) {
  const subs = Q.listPushSubscriptions({ user_id: userId });
  if (subs.length === 0) return { sent: [], reason: 'no_subscriptions' };
  const results = await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
  return { sent: results };
}

async function sendToAll(payload) {
  const subs = Q.listPushSubscriptions();
  if (subs.length === 0) return { sent: [], reason: 'no_subscriptions' };
  const results = await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
  return { sent: results };
}

module.exports = {
  getPublicKey,
  isEnabled,
  sendToUser,
  sendToAll,
  // Exposed for tests + the test-send endpoint.
  sendToSubscription,
};
