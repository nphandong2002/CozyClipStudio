// "Dự án mới": chọn điểm bắt đầu (cảnh trống / mẫu có sẵn), đặt tên, nhắc lưu dự án đang làm.
import React, { useEffect, useState } from 'react';
import { Field } from './panels.jsx';
import { blankPreset, cozyRoomPreset, campingPreset } from '../engine/presets.js';

export const PROJECT_STARTS = [
  ['blank-indoor', '🏠 Cảnh trống — trong nhà', 'Chỉ có tường, sàn và 1 nhân vật. Tự thêm vật thể, ảnh / video nền.', () => blankPreset('indoor')],
  ['blank-outdoor', '🌳 Cảnh trống — ngoài trời', 'Chỉ có trời, đất và 1 nhân vật.', () => blankPreset('outdoor')],
  ['room', '🌧 Phòng ấm áp đêm mưa', 'Mẫu có sẵn: lò sưởi, cửa sổ mưa, 2 nhân vật, 5 phân cảnh.', cozyRoomPreset],
  ['camp', '🏕 Cắm trại bên hồ', 'Mẫu có sẵn: lều, lửa trại, hồ câu cá.', campingPreset],
];

export default function NewProjectDialog({ currentName, hasFile, onSaveCurrent, onCreate, onClose }) {
  const [start, setStart] = useState('blank-indoor');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(null); // null | 'saving' | 'error' | đường dẫn / tên file đã lưu

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const saveCurrent = async () => {
    setSaved('saving');
    try {
      const r = await onSaveCurrent();
      setSaved(r ? String(r) : null); // null = người dùng huỷ hộp thoại lưu
    } catch (_) {
      setSaved('error');
    }
  };
  const create = () => {
    const def = PROJECT_STARTS.find((s) => s[0] === start);
    const p = def[3]();
    if (name.trim()) p.name = name.trim(); // để trống → giữ tên của mẫu (cảnh trống: "Dự án mới")
    onCreate(p);
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal new-project">
        <h2>📄 Dự án mới</h2>
        <div className="np-save">
          <span>
            Dự án đang mở: <b>{currentName || '(chưa đặt tên)'}</b>
            {hasFile ? '' : ' — chưa lưu ra file'}
          </span>
          <button onClick={saveCurrent} disabled={saved === 'saving'}>
            {saved === 'saving' ? 'Đang lưu…' : hasFile ? '💾 Lưu lại trước' : '💾 Lưu ra file trước…'}
          </button>
        </div>
        {saved && saved !== 'saving' && saved !== 'error' && <p className="ok small">✓ Đã lưu dự án đang mở: {saved}</p>}
        {saved === 'error' && <p className="error small">Không lưu được dự án đang mở.</p>}

        <Field label="Tên dự án mới">
          <input value={name} placeholder={PROJECT_STARTS.find((x) => x[0] === start)[3]().name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
        </Field>
        <div className="np-starts">
          {PROJECT_STARTS.map(([id, label, hint]) => (
            <label key={id} className={'np-start' + (start === id ? ' on' : '')}>
              <input type="radio" name="np-start" checked={start === id} onChange={() => setStart(id)} />
              <span>
                <b>{label}</b>
                <small className="muted block">{hint}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="muted small">
          Thư mục Spine, thư viện nhân vật và bộ hình Spine giữ nguyên. Lần bấm <b>Lưu</b> đầu tiên sẽ hỏi tên file mới — không ghi đè dự án cũ.
        </p>
        <div className="row end">
          <button onClick={onClose}>Huỷ</button>
          <button className="primary" onClick={create}>
            Tạo dự án
          </button>
        </div>
      </div>
    </div>
  );
}
