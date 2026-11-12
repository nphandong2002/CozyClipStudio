import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Self-test hook (used by `npm run selftest`): renders + exports a short clip through the real IPC pipeline.
import { exportProject } from './engine/exporter.js';
import { loadRigFromBundle } from './engine/loadSpine.js';
import { cozyRoomPreset } from './engine/presets.js';
window.__cozy = { exportProject, loadRigFromBundle, cozyRoomPreset };
