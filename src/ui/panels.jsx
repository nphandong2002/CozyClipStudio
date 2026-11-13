import React from 'react';
import { PROPS } from '../engine/props.js';
import { TIMES, WEATHERS } from '../engine/world.js';
import { uid } from '../engine/util.js';
import { renderPropAudio } from '../engine/audio.js';
import { windowPoints } from '../engine/scene.js';
import { useAudition } from './useAudioPreview.js';

/** Detect media kind (image | gif | video) and natural aspect ratio of a picked file. */
function readMediaMeta(file, dataURL, cb) {
  const type = file.type || '';
  if (type.startsWith('video')) {
    const v = document.createElement('video');
    v.onloadedmetadata = () => cb({ mediaType: 'video', aspect: (v.videoWidth || 16) / (v.videoHeight || 9) });
    v.onerror = () => cb({ mediaType: 'video', aspect: 16 / 9 });
    v.src = dataURL;
  } else {
    const mediaType = type === 'image/gif' ? 'gif' : 'image';
    const img = new Image();
    img.onload = () => cb({ mediaType, aspect: (img.naturalWidth || 1) / (img.naturalHeight || 1) });
    img.onerror = () => cb({ mediaType, aspect: 1 });
    img.src = dataURL;
  }
}

/** Open the OS file picker and return the chosen file as a data URL. */
export function pickFile(accept, cb) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept;
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => cb(f, fr.result);
    fr.readAsDataURL(f);
  };
  inp.click();
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Range({ value, min, max, step = 1, onChange, fmt }) {
  return (
    <div className="range">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span>{fmt ? fmt(value) : value}</span>
    </div>
  );
}

export function Select({ value, options, onChange }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

const pct = (v) => Math.round(v * 100) + '%';

// ------------------------------------------------------------------ scene
export function ScenePanel({ project, update, presets, selection, setSelection }) {
  const s = project.scene;
  const set = (k, v) => update((p) => (p.scene[k] = v));
  const selWin = selection?.kind === 'window' ? (s.windows || []).find((w) => w.id === selection.id) : null;
  const winSize = (w) => {
    const pts = windowPoints(w);
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    return Math.round(Math.max(...xs) - Math.min(...xs)) + '×' + Math.round(Math.max(...ys) - Math.min(...ys));
  };
  const addWindow = () => {
    const id = uid('win');
    update((p) => {
      p.scene.windows = p.scene.windows || [];
      p.scene.windows.push({ id, points: [{ x: 700, y: 280 }, { x: 1220, y: 280 }, { x: 1220, y: 660 }, { x: 700, y: 660 }] });
    });
    setSelection?.({ kind: 'window', id });
  };
  const resetWinRect = () =>
    update((p) => {
      const w = p.scene.windows.find((x) => x.id === selWin.id);
      const pts = windowPoints(w);
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const minx = Math.min(...xs);
      const maxx = Math.max(...xs);
      const miny = Math.min(...ys);
      const maxy = Math.max(...ys);
      w.points = [{ x: minx, y: miny }, { x: maxx, y: miny }, { x: maxx, y: maxy }, { x: minx, y: maxy }];
      delete w.x;
      delete w.y;
      delete w.w;
      delete w.h;
      delete w.rotate;
    });
  const mix = project.mix || {};
  const setMix = (k, v) => update((p) => ((p.mix = p.mix || {}), (p.mix[k] = v)));
  const out = project.output;
  return (
    <div>
      <h3>Mẫu nhanh</h3>
      <div className="row">
        <button onClick={presets.room}>Phòng đêm mưa</button>
        <button onClick={presets.camp}>Cắm trại bên hồ</button>
      </div>
      <h3>Bối cảnh</h3>
      <Field label="Không gian">
        <Select value={s.type} options={[['indoor', 'Trong nhà'], ['outdoor', 'Ngoài trời']]} onChange={(v) => set('type', v)} />
      </Field>
      <Field label="Thời điểm">
        <Select value={s.timeOfDay} options={Object.entries(TIMES)} onChange={(v) => set('timeOfDay', v)} />
      </Field>
      <Field label="Thời tiết" hint={s.type === 'indoor' ? 'Trong nhà: thấy qua cửa sổ, tiếng bị lọc trầm hơn' : 'Ngoài trời: mưa/tuyết phủ cả cảnh'}>
        <Select value={s.weather} options={Object.entries(WEATHERS)} onChange={(v) => set('weather', v)} />
      </Field>
      {s.backgroundImage ? (
        <p className="muted small">Đang dùng ảnh nền — màu tường/sàn & đường sàn bị ẩn (ảnh thay thế bối cảnh vẽ bằng code).</p>
      ) : (
        <>
          {s.type === 'indoor' ? (
            <div className="row">
              <Field label="Màu tường">
                <input type="color" value={s.wallColor || '#c99a76'} onChange={(e) => set('wallColor', e.target.value)} />
              </Field>
              <Field label="Màu sàn">
                <input type="color" value={s.floorColor || '#7a4e33'} onChange={(e) => set('floorColor', e.target.value)} />
              </Field>
            </div>
          ) : (
            <Field label="Màu đất/cỏ">
              <input type="color" value={s.groundColor || '#6e9a4f'} onChange={(e) => set('groundColor', e.target.value)} />
            </Field>
          )}
          <Field label="Đường sàn / chân trời">
            <Range value={s.floorLevel ?? 0.74} min={0.55} max={0.9} step={0.01} onChange={(v) => set('floorLevel', v)} fmt={pct} />
          </Field>
        </>
      )}
      <Field label="Viền tối (vignette)">
        <Range value={s.vignette ?? 0.45} min={0} max={0.9} step={0.05} onChange={(v) => set('vignette', v)} fmt={pct} />
      </Field>

      <h3>Ảnh nền</h3>
      <Field label="Ảnh nền toàn cảnh" hint="Thay nền vẽ bằng code. Nhân vật & vật thể vẫn vẽ đè lên; thời tiết/ánh sáng vẫn hoạt động.">
        <div className="row">
          <button onClick={() => pickFile('image/*', (f, d) => set('backgroundImage', d))}>{s.backgroundImage ? 'Đổi ảnh nền' : '⬆ Tải ảnh nền'}</button>
          {s.backgroundImage && (
            <button className="danger" onClick={() => set('backgroundImage', '')}>
              Bỏ ảnh nền
            </button>
          )}
        </div>
      </Field>
      <h3>Cửa sổ động (trời / thời tiết)</h3>
      <p className="muted small">Khoanh một vùng để vẽ bầu trời + mưa/tuyết/sấm động vào đó — đặt chồng lên ô cửa trong ảnh nền để nó "sống". Kéo 4 góc để tạo hình bất kỳ (nghiêng/méo/to nhỏ); kéo trong lòng để di chuyển.</p>
      <button onClick={addWindow}>+ Thêm vùng cửa sổ</button>
      {(s.windows || []).length > 0 && (
        <ul className="list">
          {(s.windows || []).map((w, i) => (
            <li key={w.id} className={selWin?.id === w.id ? 'on' : ''} onClick={() => setSelection?.({ kind: 'window', id: w.id })}>
              <span className="grow">🪟 Cửa sổ {i + 1}</span>
              <span className="badge">{winSize(w)}</span>
            </li>
          ))}
        </ul>
      )}
      {selWin && (
        <div className="editor">
          <p className="muted small">Kéo 4 góc vàng trên khung hình để tạo hình bất kỳ (nghiêng, méo, to nhỏ tuỳ ý). Kéo trong lòng vùng để di chuyển cả 4 góc.</p>
          <div className="row">
            <button onClick={resetWinRect}>Đặt lại hình chữ nhật</button>
            <button
              className="danger"
              onClick={() => {
                update((p) => (p.scene.windows = (p.scene.windows || []).filter((w) => w.id !== selWin.id)));
                setSelection?.(null);
              }}
            >
              Xoá vùng
            </button>
          </div>
        </div>
      )}

      <h3>Nhạc nền</h3>
      <Field label="Nhạc / âm thanh nền" hint="mp3/wav — phát lặp suốt video, trộn ở bước xuất.">
        <div className="row">
          <button onClick={() => pickFile('audio/*', (f, d) => update((p) => (p.audio = { name: f.name, src: d, volume: p.audio?.volume ?? 0.6 })))}>
            {project.audio ? 'Đổi nhạc' : '⬆ Tải nhạc nền'}
          </button>
          {project.audio && (
            <button className="danger" onClick={() => update((p) => (p.audio = undefined))}>
              Bỏ nhạc
            </button>
          )}
        </div>
      </Field>
      {project.audio && (
        <>
          <p className="muted small">♪ {project.audio.name}</p>
          <Field label="Âm lượng nhạc nền">
            <Range value={project.audio.volume ?? 0.6} min={0} max={1.5} step={0.05} onChange={(v) => update((p) => (p.audio.volume = v))} fmt={pct} />
          </Field>
        </>
      )}

      <h3>Âm thanh tổng</h3>
      <Field label="Âm lượng chung">
        <Range value={mix.master ?? 0.9} min={0} max={1.5} step={0.05} onChange={(v) => setMix('master', v)} fmt={pct} />
      </Field>
      <Field label="Thời tiết (mưa, gió, sấm…)">
        <Range value={mix.weather ?? 1} min={0} max={2} step={0.05} onChange={(v) => setMix('weather', v)} fmt={pct} />
      </Field>
      <Field label="Vật thể (lửa, đồng hồ, sách…)">
        <Range value={mix.props ?? 1} min={0} max={2} step={0.05} onChange={(v) => setMix('props', v)} fmt={pct} />
      </Field>
      <Field label="Nhân vật (bước chân, gừ gừ, quét…)">
        <Range value={mix.character ?? 1} min={0} max={2} step={0.05} onChange={(v) => setMix('character', v)} fmt={pct} />
      </Field>

      <h3>Xuất video</h3>
      <Field label="Độ phân giải">
        <Select
          value={`${out.width}x${out.height}`}
          options={[['1920x1080', '1080p (1920×1080)'], ['1280x720', '720p (1280×720)'], ['2560x1440', '1440p (2560×1440)']]}
          onChange={(v) => update((p) => ([p.output.width, p.output.height] = v.split('x').map(Number)))}
        />
      </Field>
      <Field label="FPS">
        <Select value={String(out.fps)} options={[['24', '24'], ['30', '30']]} onChange={(v) => update((p) => (p.output.fps = +v))} />
      </Field>
      <Field label="Độ dài vòng lặp" hint="Mỗi phân cảnh được render 1 vòng rồi lặp liền mạch. Dài hơn = ít lặp lộ hơn, render lâu hơn.">
        <Select
          value={String(out.loopSeconds)}
          options={[['20', '20 giây'], ['30', '30 giây'], ['45', '45 giây'], ['60', '60 giây'], ['90', '90 giây']]}
          onChange={(v) => update((p) => (p.output.loopSeconds = +v))}
        />
      </Field>
    </div>
  );
}

// ------------------------------------------------------------------ props
export function PropsPanel({ project, update, selection, setSelection }) {
  const audition = useAudition();
  const sel = selection?.kind === 'prop' ? project.props.find((p) => p.id === selection.id) : null;
  const setP = (k, v) => update((p) => (p.props.find((x) => x.id === sel.id)[k] = v));
  const setParam = (k, v) => update((p) => {
    const o = p.props.find((x) => x.id === sel.id);
    o.params = { ...(o.params || {}), [k]: v };
  });
  const add = (type) => {
    if (!type) return;
    const def = PROPS[type];
    const id = uid(type);
    const floor = (project.scene.floorLevel ?? 0.74) * 1080;
    update((p) => p.props.push({ id, type, x: 960, y: def.layer === 'front' ? 1080 : Math.round(floor + 120), scale: 1, layer: def.layer, blur: def.blur, params: def.params ? { ...def.params } : undefined }));
    setSelection({ kind: 'prop', id });
  };
  const move = (dir) => update((p) => {
    const i = p.props.findIndex((x) => x.id === sel.id);
    const j = i + dir;
    if (j < 0 || j >= p.props.length) return;
    [p.props[i], p.props[j]] = [p.props[j], p.props[i]];
  });
  const addMedia = () =>
    pickFile('image/*,video/*', (f, dataURL) =>
      readMediaMeta(f, dataURL, ({ mediaType, aspect }) => {
        const natH = 360;
        const natW = Math.round(natH * aspect);
        const id = uid(mediaType === 'video' ? 'vid' : mediaType === 'gif' ? 'gif' : 'img');
        const floor = (project.scene.floorLevel ?? 0.74) * 1080;
        update((p) => p.props.push({ id, type: 'image', x: 960, y: Math.round(floor + 120), scale: 1, layer: 'back', params: { src: dataURL, mediaType, natW, natH } }));
        setSelection({ kind: 'prop', id });
      })
    );
  const changeMedia = () =>
    pickFile('image/*,video/*', (f, dataURL) =>
      readMediaMeta(f, dataURL, ({ mediaType, aspect }) => {
        update((p) => {
          const o = p.props.find((x) => x.id === sel.id);
          const h = o.params?.natH || 360;
          o.params = { ...(o.params || {}), src: dataURL, mediaType, natH: h, natW: Math.round(h * aspect) };
        });
      })
    );
  const def = sel && PROPS[sel.type];
  return (
    <div>
      <h3>Thêm vật thể</h3>
      <Select
        value=""
        options={[['', '+ Chọn loại vật thể…'], ...Object.entries(PROPS).filter(([k]) => k !== 'image').map(([k, d]) => [k, d.label + (d.sound ? ' 🔊' : '')])]}
        onChange={add}
      />
      <button onClick={addMedia}>⬆ Tải ảnh / GIF / video làm vật thể</button>
      <h3>Danh sách (thứ tự vẽ: trên → dưới)</h3>
      <ul className="list">
        {project.props.map((p) => (
          <li key={p.id} className={sel?.id === p.id ? 'on' : ''} onClick={() => setSelection({ kind: 'prop', id: p.id })}>
            <input
              type="checkbox"
              checked={p.enabled !== false}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => update((pp) => (pp.props.find((x) => x.id === p.id).enabled = e.target.checked))}
            />
            <span className="grow">{PROPS[p.type]?.label || p.type}</span>
            {PROPS[p.type]?.sound && <span title="Có âm thanh">🔊</span>}
            <span className={'badge ' + (p.layer === 'front' ? 'front' : '')}>{p.layer === 'front' ? 'tiền cảnh' : 'nền'}</span>
          </li>
        ))}
      </ul>
      {sel && (
        <div className="editor">
          <h3>{def?.label}</h3>
          {sel.type === 'image' && (
            <div className="row">
              <button onClick={changeMedia}>Đổi ảnh / GIF / video khác</button>
            </div>
          )}
          <div className="row">
            <Field label="X">
              <input type="number" value={sel.x} onChange={(e) => setP('x', +e.target.value)} />
            </Field>
            <Field label="Y (chân)">
              <input type="number" value={sel.y} onChange={(e) => setP('y', +e.target.value)} />
            </Field>
          </div>
          <Field label="Kích thước">
            <Range value={sel.scale ?? 1} min={0.2} max={3} step={0.05} onChange={(v) => setP('scale', v)} fmt={(v) => v.toFixed(2) + '×'} />
          </Field>
          <Field label="Lớp" hint="Tiền cảnh = vẽ trước nhân vật, tạo chiều sâu">
            <Select value={sel.layer || 'back'} options={[['back', 'Nền (sau nhân vật)'], ['front', 'Tiền cảnh (trước nhân vật)']]} onChange={(v) => setP('layer', v)} />
          </Field>
          <Field label="Làm mờ (độ sâu trường ảnh)">
            <Range value={sel.blur ?? def?.blur ?? 0} min={0} max={16} step={1} onChange={(v) => setP('blur', v)} fmt={(v) => v + 'px'} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={!!sel.flip} onChange={(e) => setP('flip', e.target.checked)} /> Lật ngang
          </label>
          {def?.sound && (
            <>
              <div className="row">
                <button onClick={() => audition.play(() => renderPropAudio(project, sel), 'prop:' + sel.id)}>
                  {audition.playingId === 'prop:' + sel.id ? '⏹ Dừng nghe' : '▶ Nghe thử âm thanh'}
                </button>
              </div>
              <Field label="Âm lượng của vật thể">
                <Range value={sel.volume ?? 1} min={0} max={2} step={0.05} onChange={(v) => setP('volume', v)} fmt={pct} />
              </Field>
            </>
          )}
          {sel.type !== 'image' && sel.params &&
            Object.entries(sel.params).map(([k, v]) =>
              typeof v === 'boolean' ? (
                <label className="check" key={k}>
                  <input type="checkbox" checked={v} onChange={(e) => setParam(k, e.target.checked)} /> {PARAM_LABELS[k] || k}
                </label>
              ) : k === 'style' ? (
                <Field label="Kiểu" key={k}>
                  <Select value={v} options={[['open', 'Sách mở (lật trang)'], ['stack', 'Chồng sách']]} onChange={(x) => setParam(k, x)} />
                </Field>
              ) : (
                <Field label={PARAM_LABELS[k] || k} key={k}>
                  <input type="color" value={v} onChange={(e) => setParam(k, e.target.value)} />
                </Field>
              )
            )}
          {sel.type === 'window' && !sel.params?.curtainColor && (
            <button onClick={() => setParam('curtainColor', '#9b3d3d')}>Đổi màu rèm</button>
          )}
          <div className="row">
            <button onClick={() => move(-1)}>↑ Vẽ sớm hơn</button>
            <button onClick={() => move(1)}>↓ Vẽ muộn hơn</button>
          </div>
          <div className="row">
            <button
              onClick={() => {
                const id = uid(sel.type);
                update((p) => p.props.push({ ...structuredClone(sel), id, x: sel.x + 60 }));
                setSelection({ kind: 'prop', id });
              }}
            >
              Nhân bản
            </button>
            <button
              className="danger"
              onClick={() => {
                update((p) => (p.props = p.props.filter((x) => x.id !== sel.id)));
                setSelection(null);
              }}
            >
              Xoá
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const PARAM_LABELS = { curtains: 'Có rèm cửa', curtainColor: 'Màu rèm', color: 'Màu', glow: 'Đèn sáng bên trong' };

// -------------------------------------------------------------- character
const short = (n) => n.split('/').pop();
export function CharacterPanel({ project, update, rig, charSel, setCharSel }) {
  if (!rig) return <p className="muted">Chưa tải nhân vật Spine.</p>;
  const chars = project.characters || [];
  const sel = chars.find((x) => x.id === charSel) || chars[0];
  const cat = rig.catalog;
  const opt = (list, none) => [...(none ? [['', none]] : []), ...list.map((n) => [n, short(n)])];
  const set = (k, v) => update((p) => (p.characters.find((x) => x.id === sel.id)[k] = v));

  const addChar = () => {
    const id = uid('c');
    update((p) => {
      const base = p.characters[0] || {};
      p.characters.push({
        id,
        name: 'Nhân vật ' + (p.characters.length + 1),
        skin: base.skin || cat.characters[0],
        eyes: '',
        costume: '',
        mask: '',
        rod: base.rod || cat.rods[0] || '',
        scale: base.scale ?? 0.6,
        facesLeft: !!base.facesLeft,
      });
      const floor = Math.round((p.scene.floorLevel ?? 0.74) * 1080) + 120;
      for (const seg of p.timeline) {
        seg.cast = seg.cast || {};
        const n = Object.keys(seg.cast).length;
        seg.cast[id] = { action: 'sit', x: 500 + n * 300, y: floor };
      }
    });
    setCharSel(id);
  };
  const dupChar = () => {
    const id = uid('c');
    update((p) => {
      const src = p.characters.find((x) => x.id === sel.id);
      p.characters.push({ ...structuredClone(src), id, name: src.name + ' (bản sao)' });
      const floor = Math.round((p.scene.floorLevel ?? 0.74) * 1080) + 120;
      for (const seg of p.timeline) {
        seg.cast = seg.cast || {};
        const srcCast = seg.cast[sel.id];
        seg.cast[id] = srcCast
          ? { ...structuredClone(srcCast), x: (srcCast.x ?? 960) + 60, y: (srcCast.y ?? floor) + 20 }
          : { action: 'sit', x: 960, y: floor };
      }
    });
    setCharSel(id);
  };
  const delChar = () => {
    update((p) => {
      p.characters = p.characters.filter((x) => x.id !== sel.id);
      for (const seg of p.timeline) if (seg.cast) delete seg.cast[sel.id];
    });
    setCharSel(chars.find((x) => x.id !== sel.id)?.id || null);
  };

  return (
    <div>
      <h3>Nhân vật trong clip</h3>
      <button onClick={addChar}>+ Thêm nhân vật</button>
      <ul className="list">
        {chars.map((c) => (
          <li key={c.id} className={sel?.id === c.id ? 'on' : ''} onClick={() => setCharSel(c.id)}>
            <span className="grow">🐾 {c.name}</span>
            <span className="badge">{short(c.skin || '')}</span>
          </li>
        ))}
      </ul>
      {sel && (
        <div className="editor">
          <Field label="Tên hiển thị">
            <input value={sel.name || ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Nhân vật">
            <Select value={sel.skin} options={opt(cat.characters)} onChange={(v) => set('skin', v)} />
          </Field>
          <Field label="Màu mắt">
            <Select value={sel.eyes} options={opt(cat.eyes, 'Mặc định')} onChange={(v) => set('eyes', v)} />
          </Field>
          <Field label="Trang phục">
            <Select value={sel.costume} options={opt(cat.costumes, 'Không')} onChange={(v) => set('costume', v)} />
          </Field>
          <Field label="Mặt nạ / phụ kiện">
            <Select value={sel.mask} options={opt(cat.masks, 'Không')} onChange={(v) => set('mask', v)} />
          </Field>
          <Field label="Cần câu (dùng khi câu cá)">
            <Select value={sel.rod} options={opt(cat.rods)} onChange={(v) => set('rod', v)} />
          </Field>
          <Field label="Kích thước nhân vật">
            <Range value={sel.scale ?? 0.6} min={0.25} max={1.4} step={0.01} onChange={(v) => set('scale', v)} fmt={(v) => v.toFixed(2) + '×'} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={!!sel.facesLeft} onChange={(e) => set('facesLeft', e.target.checked)} /> Nhân vật gốc quay mặt sang trái (sửa hướng khi đi)
          </label>
          <div className="row">
            <button onClick={dupChar}>Nhân bản</button>
            <button className="danger" disabled={chars.length <= 1} onClick={delChar}>
              Xoá nhân vật
            </button>
          </div>
        </div>
      )}
      <p className="muted small">
        Kéo nhân vật trực tiếp trên khung hình để đặt vị trí cho từng phân cảnh (hoặc nhập X/Y ở Timeline). Đổi vị trí giữa 2 phân cảnh → nhân vật tự đi bộ sang. Bộ Spine có{' '}
        {cat.characters.length} nhân vật, {cat.costumes.length} trang phục, {cat.masks.length} mặt nạ, {rig.animNames.length} hành động.
      </p>
    </div>
  );
}
