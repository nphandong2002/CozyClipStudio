import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const fmt = (s) => (s >= 60 ? Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0') : s.toFixed(1) + 's');

function TrimDialog({ file, duration, onDone }) {
  const vref = useRef(null);
  const [url] = useState(() => URL.createObjectURL(file));
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);
  const [playable, setPlayable] = useState(true);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const clamp = (v) => Math.min(duration, Math.max(0, Number.isFinite(v) ? v : 0));
  const cur = () => vref.current?.currentTime || 0;
  const whole = start <= 0.05 && end >= duration - 0.05;
  const ok = end - start >= 0.2;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 9999, display: 'grid', placeItems: 'center' }}>
      <div style={{ background: '#1d1f25', color: '#eee', padding: 18, borderRadius: 10, width: 520, maxWidth: '92vw', font: '14px sans-serif' }}>
        <h3 style={{ margin: '0 0 4px' }}>Cắt video trước khi nạp</h3>
        <div style={{ opacity: 0.7, marginBottom: 10 }}>
          {file.name} · dài {fmt(duration)}. Cắt ngắn giúp app nhẹ hơn, đỡ crash.
        </div>
        {playable ? (
          <video ref={vref} src={url} controls muted loop style={{ width: '100%', maxHeight: 260, background: '#000' }} onError={() => setPlayable(false)} />
        ) : (
          <div style={{ opacity: 0.6, padding: 8 }}>(Không xem trước được định dạng này — nhập số giây bên dưới)</div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
          <label>
            Bắt đầu (s){' '}
            <input type="number" min={0} max={duration} step={0.1} value={+start.toFixed(2)} style={{ width: 80 }} onChange={(e) => setStart(clamp(+e.target.value))} />
          </label>
          {playable && <button onClick={() => setStart(clamp(cur()))}>Lấy vị trí hiện tại</button>}
          <label>
            Kết thúc (s){' '}
            <input type="number" min={0} max={duration} step={0.1} value={+end.toFixed(2)} style={{ width: 80 }} onChange={(e) => setEnd(clamp(+e.target.value))} />
          </label>
          {playable && <button onClick={() => setEnd(clamp(cur()))}>Lấy vị trí hiện tại</button>}
        </div>
        <div style={{ opacity: 0.8, marginBottom: 12 }}>Đoạn giữ lại: {ok ? fmt(end - start) : 'không hợp lệ (cần ≥ 0.2s)'}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => onDone(undefined)}>Huỷ</button>
          <button onClick={() => onDone(null)}>Dùng cả video</button>
          <button disabled={!ok || whole} onClick={() => onDone({ start, end })}>
            Cắt &amp; nạp
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hỏi người dùng đoạn cần giữ. Resolve: {start,end} = cắt · null = dùng cả video · undefined = huỷ. */
export function askTrim(file, duration) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<TrimDialog file={file} duration={duration} onDone={done} />);
  });
}
