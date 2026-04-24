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
