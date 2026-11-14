import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Nếu React crash thì không để màn hình đen: hiện lỗi + nút khôi phục (xoá dữ liệu lưu tạm rồi tải lại).
class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 24, color: '#eee', font: '14px sans-serif' }}>
        <h3>Ứng dụng gặp lỗi</h3>
        <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>{String(this.state.err?.stack || this.state.err)}</pre>
        <button onClick={() => location.reload()}>Tải lại</button>{' '}
        <button
          onClick={() => {
            try {
              localStorage.removeItem('cozyclip.project.v1');
            } catch (_) {}
            location.reload();
          }}
        >
          Xoá dữ liệu lưu tạm &amp; tải lại
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Self-test hook (used by `npm run selftest`): renders + exports a short clip through the real IPC pipeline.
import { exportProject } from './engine/exporter.js';
import { loadRigFromBundle } from './engine/loadSpine.js';
import { cozyRoomPreset } from './engine/presets.js';
window.__cozy = { exportProject, loadRigFromBundle, cozyRoomPreset };
