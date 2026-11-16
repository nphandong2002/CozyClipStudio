import React, { useRef, useState } from 'react';
import { planStats, exportProject } from '../engine/exporter.js';
import { fmtDuration } from '../engine/scene.js';

export default function ExportDialog({ project, rig, api, onClose }) {
  const stats = planStats(project, rig);
  const [outFile, setOutFile] = useState('');
  const [state, setState] = useState(null); // {progress, detail, stage}
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const cancelled = useRef(false);
  const running = state && state.stage !== 'done' && !error;

  const start = async () => {
    if (!api) return setError('Xuất video cần chạy trong ứng dụng desktop (Electron).');
    let file = outFile;
    if (!file) {
      file = await api.pickOutput(project.name);
      if (!file) return;
      setOutFile(file);
    }
    cancelled.current = false;
    setError(null);
    setResult(null);
    setState({ progress: 0, detail: 'Bắt đầu…', stage: 'render' });
    try {
      const out = await exportProject({ project, rig, api, outFile: file, onProgress: setState, isCancelled: () => cancelled.current });
      setResult(out);
    } catch (e) {
      setError(e.message === 'cancelled' ? 'Đã huỷ.' : e.message);
      setState(null);
    }
  };

  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Xuất video</h2>
        <table className="stats">
          <tbody>
            <tr><td>Thời lượng video</td><td>{fmtDuration(stats.total)}</td></tr>
            <tr><td>Độ phân giải</td><td>{project.output.width}×{project.output.height} @ {project.output.fps}fps</td></tr>
            <tr><td>Đoạn cần render</td><td>{stats.clips.filter((c) => c.kind === 'loop').length} vòng lặp {project.output.loopSeconds}s + {stats.clips.filter((c) => c.kind === 'move').length} đoạn di chuyển</td></tr>
            <tr><td>Khung hình thực render</td><td>{stats.framesToRender.toLocaleString()} (thay vì {Math.round(stats.total * project.output.fps).toLocaleString()})</td></tr>
          </tbody>
        </table>
        <ol className="muted small">
          {stats.clips.map((c) => (
            <li key={c.id}>
              {c.kind === 'move' ? `Đi bộ ${c.T.toFixed(1)}s` : `Vòng lặp ${c.T}s × ${c.repeats} = ${fmtDuration(c.T * c.repeats)}`}
            </li>
          ))}
        </ol>
        {outFile && <p className="small">Lưu tại: {outFile}</p>}
        {state && (
          <div className="progress">
            <div style={{ width: Math.round(state.progress * 100) + '%' }} />
            <span>{Math.round(state.progress * 100)}% · {state.detail}</span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {result && (
          <p className="ok">
            Đã xuất: {result} <button onClick={() => api.showInFolder(result)}>Mở thư mục</button>
          </p>
        )}
        <div className="row end">
          {running ? (
            <button className="danger" onClick={() => (cancelled.current = true)}>Huỷ</button>
          ) : (
            <>
              <button onClick={onClose}>Đóng</button>
              <button className="primary" onClick={start} disabled={!rig}>
                {result ? 'Xuất lại' : 'Chọn nơi lưu & xuất'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
