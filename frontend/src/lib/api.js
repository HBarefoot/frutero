import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

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
