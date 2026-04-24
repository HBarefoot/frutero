import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true,
});

// --- Auth -----------------------------------------------------------
export async function fetchBootstrap() {
  return (await api.get('/auth/bootstrap')).data;
}
export async function fetchMe() {
  return (await api.get('/auth/me')).data;
}
export async function loginRequest({ email, password }) {
  return (await api.post('/auth/login', { email, password })).data;
}
export async function logoutRequest() {
  return (await api.post('/auth/logout')).data;
}
export async function setupOwner({ email, name, password }) {
  return (await api.post('/auth/setup', { email, name, password })).data;
}
export async function inspectInvite(token) {
  return (await api.get(`/auth/invite/${encodeURIComponent(token)}`)).data;
}
export async function acceptInvite(token, { name, password }) {
  return (
    await api.post(`/auth/invite/${encodeURIComponent(token)}/accept`, {
      name,
      password,
    })
  ).data;
}

// --- Self-service account -------------------------------------------
export async function updateMyName(name) {
  return (await api.patch('/auth/me', { name })).data;
}
export async function changeMyPassword({ current_password, new_password }) {
  return (await api.post('/auth/me/password', { current_password, new_password })).data;
}
export async function fetchMySessions() {
  return (await api.get('/auth/me/sessions')).data;
}
export async function revokeMyOtherSessions() {
  return (await api.post('/auth/me/revoke-others')).data;
}

// --- Users (owner-only) ---------------------------------------------
export async function fetchUsers() {
  return (await api.get('/users')).data;
}
export async function updateUserRole(id, role) {
  return (await api.patch(`/users/${id}/role`, { role })).data;
}
export async function setUserDisabled(id, disabled) {
  return (await api.patch(`/users/${id}/disabled`, { disabled })).data;
}
export async function deleteUserRequest(id) {
  return (await api.delete(`/users/${id}`)).data;
}
export async function revokeUserSessions(id) {
  return (await api.post(`/users/${id}/revoke-sessions`)).data;
}
export async function issuePasswordReset(id) {
  return (await api.post(`/users/${id}/password-reset`)).data;
}
export async function inspectReset(token) {
  return (await api.get(`/auth/reset/${encodeURIComponent(token)}`)).data;
}
export async function submitReset(token, new_password) {
  return (await api.post(`/auth/reset/${encodeURIComponent(token)}`, { new_password })).data;
}
export async function fetchInvites() {
  return (await api.get('/invites')).data;
}
export async function createInvite({ email, role }) {
  return (await api.post('/invites', { email, role })).data;
}
export async function revokeInvite(token) {
  return (await api.delete(`/invites/${encodeURIComponent(token)}`)).data;
}
export async function fetchAuditLog(limit = 100) {
  return (await api.get('/audit', { params: { limit } })).data;
}

export async function fetchSecurityPosture() {
  return (await api.get('/security')).data;
}

export async function reportClientError(payload) {
  return (await api.post('/client-errors', payload)).data;
}

export async function fetchRecentClientErrors(limit = 20) {
  return (await api.get('/client-errors', { params: { limit } })).data;
}

export async function fetchHostStats() {
  return (await api.get('/hardware/host')).data;
}

// --- AI advisor ------------------------------------------------------
export async function fetchAIConfig() {
  return (await api.get('/ai/config')).data;
}
export async function saveAIConfig(patch) {
  return (await api.put('/ai/config', patch)).data;
}
export async function fetchAIInsights(limit = 50) {
  return (await api.get('/ai/insights', { params: { limit } })).data;
}
export async function updateAIInsight(id, status) {
  return (await api.patch(`/ai/insights/${id}`, { status })).data;
}
export async function runAIAdvisor() {
  return (await api.post('/ai/run')).data;
}

// --- Batches ---------------------------------------------------------
export async function fetchBatches() {
  return (await api.get('/batches')).data;
}
export async function fetchActiveBatch() {
  return (await api.get('/batches/active')).data;
}
export async function fetchBatch(id) {
  return (await api.get(`/batches/${id}`)).data;
}
export async function createBatch(body) {
  return (await api.post('/batches', body)).data;
}
export async function updateBatch(id, patch) {
  return (await api.patch(`/batches/${id}`, patch)).data;
}
export async function addBatchNote(id, detail) {
  return (await api.post(`/batches/${id}/note`, { detail })).data;
}
export async function archiveBatch(id) {
  return (await api.post(`/batches/${id}/archive`)).data;
}
export async function deleteBatch(id) {
  return (await api.delete(`/batches/${id}`)).data;
}

// --- Notifications ---------------------------------------------------
export async function fetchNotificationsConfig() {
  return (await api.get('/notifications/config')).data;
}
export async function saveNotificationsConfig(patch) {
  return (await api.put('/notifications/config', patch)).data;
}
export async function testNotification(channel) {
  return (await api.post(`/notifications/test/${channel}`)).data;
}

// --- CV / computer vision -------------------------------------------
export async function fetchCVSnapshots({ batch_id, limit = 200 } = {}) {
  return (await api.get('/cv/snapshots', { params: { batch_id, limit } })).data;
}
export async function fetchLatestSnapshot({ batch_id } = {}) {
  return (await api.get('/cv/snapshots/latest', { params: { batch_id } })).data;
}
export function snapshotImageUrl(id) {
  return `/api/cv/snapshots/${id}/image`;
}
export async function triggerSnapshot() {
  return (await api.post('/cv/snapshots/now')).data;
}
export async function fetchCVConfig() {
  return (await api.get('/cv/config')).data;
}
export async function saveCVConfig(patch) {
  return (await api.put('/cv/config', patch)).data;
}
export async function fetchCVObservations(params = {}) {
  return (await api.get('/cv/observations', { params })).data;
}
export async function analyzeSnapshot(snapshotId, { force = false } = {}) {
  return (await api.post(`/cv/analyze/${snapshotId}`, { force })).data;
}

export async function fetchStatus() {
  return (await api.get('/status')).data;
}

export async function setDevice(key, state) {
  return (await api.post(`/devices/${encodeURIComponent(key)}`, { state })).data;
}

export async function setFan(state) { return setDevice('fan', state); }
export async function setLight(state) { return setDevice('light', state); }

export async function clearOverride(key) {
  return (await api.post(`/devices/${encodeURIComponent(key)}/clear-override`)).data;
}

export async function runTest(device, duration) {
  return (await api.post('/test', { device, duration })).data;
}

// --- Actuators ------------------------------------------------------
export async function fetchActuators() {
  return (await api.get('/actuators')).data;
}
export async function createActuator(payload) {
  return (await api.post('/actuators', payload)).data;
}
export async function updateActuator(key, payload) {
  return (await api.put(`/actuators/${encodeURIComponent(key)}`, payload)).data;
}
export async function deleteActuator(key) {
  return (await api.delete(`/actuators/${encodeURIComponent(key)}`)).data;
}
export async function pulseActuator(key, ms = 1000) {
  return (await api.post(`/actuators/${encodeURIComponent(key)}/test`, { ms })).data;
}

// --- Misting --------------------------------------------------------
export async function fetchMistingStatus() {
  return (await api.get('/misting')).data;
}
export async function saveMistingConfig(payload) {
  return (await api.put('/misting', payload)).data;
}

// --- Camera ---------------------------------------------------------
export async function fetchCameraStatus() {
  return (await api.get('/camera')).data;
}
export async function saveCameraConfig(payload) {
  return (await api.put('/camera', payload)).data;
}
export const cameraSnapshotUrl = (cacheBust = false) =>
  `/api/camera/snapshot${cacheBust ? `?t=${Date.now()}` : ''}`;
export const cameraStreamUrl = () => `/api/camera/stream`;

// --- Hardware (owner-only) -----------------------------------------
export async function fetchHardwareScan() {
  return (await api.get('/hardware/scan')).data;
}
export async function fetchSetupHardwareScan() {
  return (await api.get('/setup/hardware-scan')).data;
}
export async function fetchHardwareGpio() {
  return (await api.get('/hardware/gpio')).data;
}

export async function fetchReadings(hours = 24) {
  return (await api.get('/readings', { params: { hours } })).data;
}

export async function fetchReadingStats(hours = 24) {
  return (await api.get('/readings/stats', { params: { hours } })).data;
}

export async function fetchDeviceLog(limit = 20) {
  return (await api.get('/device-log', { params: { limit } })).data;
}

export async function fetchSchedules() {
  return (await api.get('/schedule')).data;
}

export async function createSchedule(payload) {
  return (await api.post('/schedule', payload)).data;
}

export async function updateSchedule(id, payload) {
  return (await api.put(`/schedule/${id}`, payload)).data;
}

export async function deleteSchedule(id) {
  return (await api.delete(`/schedule/${id}`)).data;
}

export async function fetchAlerts() {
  return (await api.get('/alerts')).data;
}

export async function saveAlerts(payload) {
  return (await api.put('/alerts', payload)).data;
}

export async function fetchTelegramConfig() {
  return (await api.get('/alerts/telegram')).data;
}
export async function saveTelegramConfig(payload) {
  return (await api.put('/alerts/telegram', payload)).data;
}
export async function testTelegram() {
  return (await api.post('/alerts/telegram/test')).data;
}

export async function fetchSettings() {
  return (await api.get('/settings')).data;
}

export async function saveSettings(payload) {
  return (await api.put('/settings', payload)).data;
}

export async function applySpecies(species) {
  return (await api.post('/settings/species', { species })).data;
}
