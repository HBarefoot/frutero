import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted Inter font — bundled via Vite so the appliance works on
// fully-offline LANs and CSP doesn't need a third-party style-src.
import '@fontsource-variable/inter';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service worker registration. Skipped in dev because Vite HMR and the
// SW's cache-first asset strategy fight each other. The ?v= pins the
// SW to this build so the browser sees a new registration on each
// release and fires `updatefound`.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${__BUILD_ID__}`)
      .catch((err) => console.warn('[sw] registration failed:', err));
  });
}
