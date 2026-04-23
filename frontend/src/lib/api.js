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

export async function fetchStatus() {
  return (await api.get('/status')).data;
}

export async function setFan(state) {
  return (await api.post('/fan', { state })).data;
}

export async function setLight(state) {
  return (await api.post('/light', { state })).data;
}

export async function clearOverride(device) {
  return (await api.post(`/${device}/clear-override`)).data;
}

export async function runTest(device, duration) {
  return (await api.post('/test', { device, duration })).data;
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

export async function fetchSettings() {
  return (await api.get('/settings')).data;
}

export async function saveSettings(payload) {
  return (await api.put('/settings', payload)).data;
}

export async function applySpecies(species) {
  return (await api.post('/settings/species', { species })).data;
}
