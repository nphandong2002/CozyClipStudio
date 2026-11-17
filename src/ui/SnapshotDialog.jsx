// "Xuất khung hình" — chụp đúng khung hình đang xem ra ảnh PNG / JPG, giống Export Frame của Premiere Pro.
import React, { useEffect, useRef, useState } from 'react';
import { Field, Range, Select } from './panels.jsx';

const PREF_KEY = 'cozyclip.snapshot.v1';
const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch (_) {
    return {};
  }
};
const savePrefs = (p) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch (_) {}
};

const toBlob = (canvas, type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));

/** canvas: the captured full-resolution frame; defaultName: suggested file name (no extension). */
export default function SnapshotDialog({ canvas, defaultName, info, api, onClose }) {
  const prefs = useRef(loadPrefs()).current;
  const [name, setName] = useState(defaultName);
  const [format, setFormat] = useState(prefs.format || 'png');
  const [quality, setQuality] = useState(prefs.quality ?? 0.92);
  const [dir, setDir] = useState(prefs.dir || '');
  const [after, setAfter] = useState(prefs.after || 'folder'); // 'folder' | 'image' | 'none'
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const preview = useRef(null);
  const desktop = !!api?.saveFrame;

  useEffect(() => {
    if (desktop && !dir) api.defaultFrameDir().then((d) => d && setDir(d)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const cv = preview.current;
    if (!cv) return;
    cv.width = 480;
    cv.height = Math.round((480 * canvas.height) / canvas.width);
    cv.getContext('2d').drawImage(canvas, 0, 0, cv.width, cv.height);
  }, [canvas]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const browse = async () => {
    const d = await api.pickFrameDir(dir);
    if (d) setDir(d);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      savePrefs({ format, quality, dir, after });
      const blob = await toBlob(canvas, format === 'jpeg' ? 'image/jpeg' : 'image/png', quality);
      if (!blob) throw new Error('Không tạo được ảnh');
      if (!desktop) {
        // trình duyệt: tải file về thư mục Downloads
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name || 'khung-hinh'}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setSaved(a.download);
        return;
      }
      if (!dir) throw new Error('Chưa chọn thư mục lưu.');
      const file = await api.saveFrame(dir, name, ext, new Uint8Array(await blob.arrayBuffer()));
      setSaved(file);
      if (after === 'folder') api.showInFolder(file);
      else if (after === 'image') api.openPath(file);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal snapshot">
        <h2>📷 Xuất khung hình</h2>
        <canvas ref={preview} className="snap-preview" />
        <p className="muted small">
          {canvas.width}×{canvas.height} · {info}
        </p>
        <Field label="Tên file">
          <div className="picker">
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && !busy && save()} />
            <span className="muted">.{ext}</span>
          </div>
        </Field>
        <Field label="Định dạng">
          <Select
            value={format}
            options={[
              ['png', 'PNG (nét nhất, file lớn)'],
              ['jpeg', 'JPG (nhẹ hơn)'],
            ]}
            onChange={setFormat}
          />
        </Field>
        {format === 'jpeg' && (
          <Field label="Chất lượng JPG">
            <Range value={quality} min={0.5} max={1} step={0.01} onChange={setQuality} fmt={(v) => Math.round(v * 100) + '%'} />
          </Field>
        )}
        {desktop ? (
          <>
            <Field label="Lưu vào thư mục">
              <div className="picker">
                <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Chọn thư mục…" />
                <button onClick={browse}>Chọn…</button>
              </div>
            </Field>
            <Field label="Sau khi lưu">
              <Select
                value={after}
                options={[
                  ['folder', 'Mở thư mục chứa ảnh'],
                  ['image', 'Mở ảnh'],
                  ['none', 'Không làm gì'],
                ]}
                onChange={setAfter}
              />
            </Field>
          </>
        ) : (
          <p className="muted small">Bản trình duyệt: ảnh được tải về thư mục Tải xuống.</p>
        )}
        {error && <p className="error">{error}</p>}
        {saved && (
          <p className="ok small">
            ✓ Đã lưu: {saved}{' '}
            {desktop && (
              <>
                <button className="linkish" onClick={() => api.openPath(saved)}>
                  Mở ảnh
                </button>{' '}
                <button className="linkish" onClick={() => api.showInFolder(saved)}>
                  Mở thư mục
                </button>
              </>
            )}
          </p>
        )}
        <div className="row end">
          <button onClick={onClose} disabled={busy}>
            {saved ? 'Đóng' : 'Huỷ'}
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Đang lưu…' : saved ? 'Lưu thêm bản nữa' : 'Lưu ảnh'}
          </button>
        </div>
      </div>
    </div>
  );
}
