import React from 'react';
import { PROPS } from '../engine/props.js';
import { TIMES, WEATHERS } from '../engine/world.js';
import { maskActive, rectMask, ellipseMask, MASK_DEFAULTS } from '../engine/mask.js';
import { uid } from '../engine/util.js';
import { renderPropAudio } from '../engine/audio.js';
import { windowPoints } from '../engine/scene.js';
import { useAudition } from './useAudioPreview.js';
import { askTrim } from './TrimDialog.jsx';
import { useLibrary, useArt, setLibrary, partLabel, addLibraryCharToProject, projectFieldsFromSkin, newLibChar, newSkin } from './library.js';
import { setImageSrc, detectKeyBackground, getVideoElement, getMediaDuration, CHROMA_DEFAULTS, LUMA_DEFAULTS, keyModeOf, trimRange } from '../engine/images.js';

const VIDEO_ERR = 'Không đọc được video (định dạng/codec không hỗ trợ). Hãy dùng MP4 (H.264), WebM hoặc MOV.';
const MEDIA_ACCEPT = 'image/*,video/*,.mov,.qt,.mkv,.avi,.m4v,.wmv';
const VIDEO_EXT = /\.(mov|qt|mp4|m4v|webm|mkv|avi|ogv|wmv|flv|mts|m2ts|3gp|mpe?g)$/i;
// containers/codecs Chromium usually can't play (MOV is often ProRes with transparency)
const CONVERT_EXT = /\.(mov|qt|mkv|avi|wmv|flv|mts|m2ts|3gp|mpe?g)$/i;
const isVideoFile = (f) => (f.type || '').startsWith('video') || VIDEO_EXT.test(f.name || '');
const canConvert = () => typeof window !== 'undefined' && !!window.api?.convertVideo;

/** Convert a video with the bundled ffmpeg (Electron only) into a playable MP4 / WebM (alpha kept). */
async function convertVideoFile(file, onStage, trim = null) {
  const label = 'Đang chuyển đổi video ' + ((/\.(\w+)$/.exec(file.name || '') || [])[1] || '').toUpperCase();
  onStage({ label: label.trim(), progress: 0 });
  const r = await window.api.convertVideo(file, (p) => onStage({ label: label.trim(), progress: p }), trim);
  const name = (file.name || 'video').replace(/\.[^.]+$/, '') + '.' + r.ext;
  const out = new File([r.bytes], name, { type: r.mime });
  out.converted = r; // { alpha, mode }
  return out;
}

/** Read a File as a data URL, reporting progress 0..1. */
function readAsDataURL(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Không đọc được file: ' + (fr.error?.message || file.name)));
    fr.readAsDataURL(file);
  });
}

/** Wait for a media element event (or reject on error / timeout). */
function waitFor(el, ev, ms, errMsg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (cleanup(), reject(new Error(errMsg))), ms);
    const ok = () => (cleanup(), resolve());
    const bad = () => (cleanup(), reject(new Error(errMsg)));
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener(ev, ok);
    el.addEventListener('error', bad);
  });
}

/** Video metadata (aspect, duration) + green-screen detection on an early frame. */
async function probeVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  try {
    const meta = waitFor(v, 'loadedmetadata', 20000, VIDEO_ERR);
    v.src = url;
    await meta;
    const duration = isFinite(v.duration) ? v.duration : 0;
    const aspect = (v.videoWidth || 16) / (v.videoHeight || 9);
    let bg = { kind: null, color: CHROMA_DEFAULTS.keyColor };
    try {
      const seeked = waitFor(v, 'seeked', 8000, VIDEO_ERR);
      v.currentTime = Math.min(0.2, duration / 2 || 0);
      await seeked;
      bg = detectKeyBackground(v, v.videoWidth, v.videoHeight);
    } catch (_) {
      // detection is best effort; the video itself loaded fine
    }
    return { aspect, duration, bg };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

function probeImage(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ aspect: (img.naturalWidth || 1) / (img.naturalHeight || 1) });
    img.onerror = () => resolve({ aspect: 1 });
    img.src = dataURL;
  });
}

/**
 * Read + analyse + preload a picked media file for prop `key`, reporting
 * onStage({ label, progress }) along the way. Resolves to the prop params to store.
 */
async function loadMediaFile(file, key, onStage) {
  const isVideo = isVideoFile(file);
  const mediaType = isVideo ? 'video' : file.type === 'image/gif' ? 'gif' : 'image';
  const extra = {};
  let aspect;
  let info = null;
  if (isVideo) {
    // MOV/MKV/AVI… → convert first; anything else that fails to play gets converted as a fallback
    // Electron: cho cắt đoạn cần dùng TRƯỚC khi nạp (video ngắn -> nhẹ, đỡ crash)
    let trim = null;
    if (canConvert() && window.api.probeVideoFile) {
      const pi = await window.api.probeVideoFile(file);
      if (pi && pi.duration > 1) {
        trim = await askTrim(file, pi.duration);
        if (trim === undefined) throw new Error('Đã huỷ');
      }
    }
    if (canConvert() && (trim || CONVERT_EXT.test(file.name || ''))) file = await convertVideoFile(file, onStage, trim);
    onStage({ label: 'Đang phân tích video', progress: 0.02 });
    try {
      info = await probeVideo(file);
    } catch (e) {
      if (!canConvert() || file.converted) throw e;
      file = await convertVideoFile(file, onStage);
      info = await probeVideo(file);
    }
  }
  onStage({ label: 'Đang đọc file', progress: 0.05 });
  const dataURL = await readAsDataURL(file, (f) => onStage({ label: 'Đang đọc file', progress: 0.05 + f * 0.7 }));
  onStage({ label: isVideo ? 'Đang phân tích video' : 'Đang phân tích ảnh', progress: 0.8 });
  if (isVideo) {
    aspect = info.aspect;
    // a video that already has transparency needs no background removal
    const kind = file.converted?.alpha && info.bg.kind !== 'green' ? 'transparent' : info.bg.kind;
    Object.assign(extra, {
      duration: info.duration,
      trimStart: 0,
      trimEnd: null,
      keyMode: kind === 'green' || kind === 'black' ? kind : 'none',
      bgDetected: kind || 'none',
      ...CHROMA_DEFAULTS,
      ...LUMA_DEFAULTS,
      keyColor: info.bg.kind === 'green' ? info.bg.color : CHROMA_DEFAULTS.keyColor,
    });
  } else {
    aspect = (await probeImage(dataURL)).aspect;
  }
  onStage({ label: 'Đang nạp vào cảnh', progress: 0.9 });
  const rec = await setImageSrc(key, dataURL, mediaType, isVideo ? file : null);
  if (isVideo && (!rec || !rec.ready)) throw new Error(rec?.error || VIDEO_ERR);
  onStage({ label: 'Xong', progress: 1 });
  return { src: dataURL, mediaType, aspect, extra };
}

/** Open the OS file picker; cb(file, dataURL), or cb(file) only when `raw` is set. */
export function pickFile(accept, cb, raw = false) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept;
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (raw) return cb(f);
    const fr = new FileReader();
    fr.onload = () => cb(f, fr.result);
    fr.readAsDataURL(f);
  };
  inp.click();
}

/** Slim progress bar / error line for an in-flight media upload. */
function UploadStatus({ state, onClose }) {
  if (!state) return null;
  if (state.error)
    return (
      <div className="upload-error">
        <span className="error">⚠ {state.name ? state.name + ': ' : ''}{state.error}</span>
        <button onClick={onClose}>Đóng</button>
      </div>
    );
  const p = Math.round((state.progress || 0) * 100);
  return (
    <div className="progress slim" title={state.name}>
      <div style={{ width: p + '%' }} />
      <span>
        {state.label}… {p}%
      </span>
    </div>
  );
}

const fmtSec = (s) => (s >= 60 ? Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0') : s.toFixed(2) + 's');

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
  // ---- nền: ảnh / GIF / video (dùng chung bộ tải của vật thể: tiến độ, chuyển đổi MOV, cắt đoạn)
  const [bgUpload, setBgUpload] = React.useState(null);
  const bgBusy = bgUpload && !bgUpload.error;
  const bgKind = s.backgroundImage ? s.backgroundMedia || 'image' : null;
  const pickBackground = () =>
    pickFile(
      MEDIA_ACCEPT,
      (file) => {
        const old = { src: s.backgroundImage, media: s.backgroundMedia || 'image' };
        setBgUpload({ name: file.name, label: 'Đang đọc file', progress: 0 });
        loadMediaFile(file, 'bg', (st) => setBgUpload({ name: file.name, ...st }))
          .then(({ src, mediaType, extra }) => {
            update((p) => {
              p.scene.backgroundImage = src;
              p.scene.backgroundMedia = mediaType;
              if (mediaType === 'video') p.scene.backgroundParams = { duration: extra.duration || 0, trimStart: 0, trimEnd: null };
              else delete p.scene.backgroundParams;
            });
            setBgUpload(null);
          })
          .catch((e) => {
            setImageSrc('bg', old.src || null, old.media); // trả lại nền cũ
            setBgUpload({ name: file.name, error: e?.message || String(e) });
          });
      },
      true
    );
  const clearBackground = () =>
    update((p) => {
      p.scene.backgroundImage = '';
      delete p.scene.backgroundMedia;
      delete p.scene.backgroundParams;
    });
  const bgDur = bgKind === 'video' ? s.backgroundParams?.duration || getMediaDuration('bg') : 0;
  const [, bgTick] = React.useState(0);
  React.useEffect(() => {
    if (bgKind !== 'video' || bgDur) return;
    const t = setInterval(() => bgTick((x) => x + 1), 400); // dự án cũ chưa lưu độ dài → chờ video tải
    return () => clearInterval(t);
  }, [bgKind, bgDur]);
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
        <p className="muted small">Đang dùng {bgKind === 'video' ? 'video' : bgKind === 'gif' ? 'GIF' : 'ảnh'} nền — màu tường/sàn & đường sàn bị ẩn (nền này thay thế bối cảnh vẽ bằng code).</p>
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

      <h3>Ảnh / video nền</h3>
      <Field label="Nền toàn cảnh" hint="Ảnh, GIF hoặc video (MP4, WebM, MOV…) thay nền vẽ bằng code. Video nền lặp liên tục, tắt tiếng. Nhân vật & vật thể vẫn vẽ đè lên; thời tiết/ánh sáng vẫn hoạt động.">
        <div className="row">
          <button onClick={pickBackground} disabled={bgBusy}>
            {s.backgroundImage ? 'Đổi nền' : '⬆ Tải ảnh / video nền'}
          </button>
          {s.backgroundImage && (
            <button className="danger" onClick={clearBackground} disabled={bgBusy}>
              Bỏ nền
            </button>
          )}
        </div>
      </Field>
      <UploadStatus state={bgUpload} onClose={() => setBgUpload(null)} />
      {bgKind === 'video' && (
        <VideoMediaEditor
          sel={{ id: 'bg', params: s.backgroundParams || {} }}
          mediaKey="bg"
          keying={false}
          dur={bgDur}
          loopSeconds={project.output.loopSeconds}
          setParams={(obj) => update((p) => (p.scene.backgroundParams = { ...(p.scene.backgroundParams || {}), ...obj }))}
        />
      )}
      <h3>Cửa sổ động (trời / thời tiết)</h3>
      <p className="muted small">Khoanh một vùng để vẽ bầu trời + mưa/tuyết/sấm động vào đó — đặt chồng lên ô cửa trong ảnh nền để nó "sống". Kéo 4 góc để tạo hình bất kỳ (nghiêng/méo/to nhỏ); kéo trong lòng để di chuyển.</p>
      <button onClick={addWindow}>+ Thêm vùng cửa sổ</button>
      {(s.windows || []).length > 0 && (
        <ul className="list">
          {(s.windows || []).map((w, i) => (
            <li key={w.id} className={selWin?.id === w.id ? 'on' : ''} onClick={() => setSelection?.({ kind: 'window', id: w.id })}>
              <span className="grow">🪟 Cửa sổ {i + 1}</span>
              {w.sky === false && <span className="badge">chỉ thời tiết</span>}
              <span className="badge">{winSize(w)}</span>
            </li>
          ))}
        </ul>
      )}
      {selWin && (
        <div className="editor">
          <p className="muted small">Kéo 4 góc vàng trên khung hình để tạo hình bất kỳ (nghiêng, méo, to nhỏ tuỳ ý). Kéo trong lòng vùng để di chuyển cả 4 góc.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={selWin.sky !== false}
              onChange={(e) => update((p) => (p.scene.windows.find((w) => w.id === selWin.id).sky = e.target.checked))}
            />{' '}
            Vẽ nền trời (mây, trăng/mặt trời, đồi núi)
          </label>
          {selWin.sky === false && (
            <p className="muted small">
              Chỉ vẽ thời tiết (mưa, tuyết, chớp sấm, giọt nước trên kính); cảnh trong ảnh nền vẫn nhìn thấy bên dưới.
              {(s.weather || 'clear') === 'clear' && ' Thời tiết đang là "trời quang" nên vùng này sẽ trống — đổi thời tiết ở trên hoặc trong timeline.'}
            </p>
          )}
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
  const setParams = (obj) => update((p) => {
    const o = p.props.find((x) => x.id === sel.id);
    o.params = { ...(o.params || {}), ...obj };
  });
  const [upload, setUpload] = React.useState(null); // { name, label, progress, error }
  const busy = upload && !upload.error;
  // read → analyse (green screen) → preload, with a progress bar; then onDone(media)
  const runUpload = (file, key, onDone, onFail = () => setImageSrc(key, null)) => {
    setUpload({ name: file.name, label: 'Đang đọc file', progress: 0 });
    loadMediaFile(file, key, (st) => setUpload({ name: file.name, ...st }))
      .then((m) => {
        onDone(m);
        setUpload(null);
      })
      .catch((e) => {
        onFail(); // drop (or restore) the half-loaded record
        setUpload({ name: file.name, error: e?.message || String(e) });
      });
  };
  const addMedia = () =>
    pickFile(MEDIA_ACCEPT, (f) => {
      const kind = isVideoFile(f) ? 'vid' : f.type === 'image/gif' ? 'gif' : 'img';
      const id = uid(kind);
      runUpload(f, 'prop:' + id, ({ src, mediaType, aspect, extra }) => {
        const natH = 360;
        const natW = Math.round(natH * aspect);
        const floor = (project.scene.floorLevel ?? 0.74) * 1080;
        update((p) => p.props.push({ id, type: 'image', x: 960, y: Math.round(floor + 120), scale: 1, layer: 'back', params: { src, mediaType, natW, natH, ...extra } }));
        setSelection({ kind: 'prop', id });
      });
    }, true);
  const changeMedia = () => {
    const id = sel.id;
    const old = sel.params || {};
    pickFile(MEDIA_ACCEPT, (f) =>
      runUpload(f, 'prop:' + id, ({ src, mediaType, aspect, extra }) =>
        update((p) => {
          const o = p.props.find((x) => x.id === id);
          if (!o) return;
          const h = o.params?.natH || 360;
          const keep = { ...(o.params || {}) };
          for (const k of ['duration', 'trimStart', 'trimEnd', 'chromaKey', 'greenDetected', 'keyMode', 'bgDetected', ...Object.keys(CHROMA_DEFAULTS), ...Object.keys(LUMA_DEFAULTS)]) delete keep[k];
          o.params = { ...keep, src, mediaType, natH: h, natW: Math.round(h * aspect), ...extra };
        }),
      () => setImageSrc('prop:' + id, old.src, old.mediaType || 'image')
      ), true);
  };
  const isVideo = sel?.type === 'image' && sel.params?.mediaType === 'video';
  const vidDur = isVideo ? sel.params.duration || getMediaDuration('prop:' + sel.id) : 0;
  // older projects don't store the duration: poll until the video has loaded
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (!isVideo || vidDur) return;
    const t = setInterval(() => tick((x) => x + 1), 400);
    return () => clearInterval(t);
  }, [isVideo, vidDur]);
  const def = sel && PROPS[sel.type];
  // while auditioning this prop, re-render its sound when its own settings change (volume, style…)
  const auditionKey = sel && def?.sound ? JSON.stringify([sel.id, sel.volume, sel.params, project.scene.weather, project.output.loopSeconds]) : '';
  React.useEffect(() => {
    if (!sel || audition.playingId !== 'prop:' + sel.id) return;
    const t = setTimeout(() => audition.refresh(() => renderPropAudio(project, sel), 'prop:' + sel.id), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditionKey]);
  return (
    <div>
      <h3>Thêm vật thể</h3>
      <Select
        value=""
        options={[['', '+ Chọn loại vật thể…'], ...Object.entries(PROPS).filter(([k]) => k !== 'image').map(([k, d]) => [k, d.label + (d.sound ? ' 🔊' : '')])]}
        onChange={add}
      />
      <button onClick={addMedia} disabled={busy} title="Ảnh, GIF, MP4, WebM, MOV (kể cả MOV nền trong suốt)…">⬆ Tải ảnh / GIF / video làm vật thể</button>
      <UploadStatus state={upload} onClose={() => setUpload(null)} />
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
              <button onClick={changeMedia} disabled={busy}>Đổi ảnh / GIF / video khác</button>
            </div>
          )}
          {isVideo && <VideoMediaEditor sel={sel} setParams={setParams} dur={vidDur} loopSeconds={project.output.loopSeconds} />}
          {sel.type === 'image' && sel.params?.src && <MaskEditor sel={sel} setParams={setParams} selection={selection} setSelection={setSelection} />}
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
              <small className="muted block" style={{ marginBottom: 8 }}>
                Nghe riêng vật thể này: tạm tắt tiếng cảnh & nhạc nền, không tính âm lượng chung — chỉ theo âm lượng bên dưới.
              </small>
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

/** Mask (khoanh vùng) của vật thể ảnh / GIF / video — vẽ & sửa điểm neo trên khung hình. */
function MaskEditor({ sel, setParams, selection, setSelection }) {
  const m = sel.params?.mask;
  const editing = selection?.kind === 'prop' && selection.id === sel.id && !!selection.mask;
  const setEditing = (on) => setSelection({ kind: 'prop', id: sel.id, ...(on ? { mask: true } : {}) });
  const setMask = (obj) => setParams({ mask: { ...MASK_DEFAULTS, ...(m || {}), ...obj } });
  const start = (preset) => {
    setParams({ mask: preset || { ...MASK_DEFAULTS, points: [] } });
    setEditing(true);
  };
  const n = m?.points?.length || 0;
  return (
    <>
      <h3>Mask (khoanh vùng)</h3>
      {!m ? (
        <>
          <small className="muted block" style={{ marginBottom: 6 }}>
            Chỉ giữ lại phần hình bên trong đường viền bạn vẽ — giống Mask Path trong Premiere Pro.
          </small>
          <div className="row">
            <button onClick={() => start(null)}>✏️ Vẽ mask</button>
            <button onClick={() => start(rectMask())}>▭ Chữ nhật</button>
            <button onClick={() => start(ellipseMask())}>◯ Elip</button>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>
              {editing ? '✓ Xong sửa mask' : '✏️ Sửa mask trên khung hình'}
            </button>
            <label className="check">
              <input type="checkbox" checked={m.enabled !== false} onChange={(e) => setMask({ enabled: e.target.checked })} /> Bật
            </label>
          </div>
          {editing && (
            <small className="muted block">
              Bấm chỗ trống để thêm điểm, bấm lên viền để chèn điểm, kéo điểm để di chuyển, bấm đúp điểm để đổi cong ↔ nhọn, chuột phải (hoặc Alt+bấm) để xoá điểm, kéo bên trong để dời cả mask. Esc = xong.
            </small>
          )}
          {n < 3 && <small className="warn block">Cần ít nhất 3 điểm thì mask mới có tác dụng ({n}/3).</small>}
          <Field label="Độ mềm biên">
            <Range value={m.feather || 0} min={0} max={150} step={1} onChange={(v) => setMask({ feather: v })} fmt={(v) => v + ' px'} />
          </Field>
          <Field label="Mở rộng / thu hẹp">
            <Range value={m.expand || 0} min={-150} max={150} step={1} onChange={(v) => setMask({ expand: v })} fmt={(v) => (v > 0 ? '+' : '') + v + ' px'} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={!!m.invert} onChange={(e) => setMask({ invert: e.target.checked })} /> Đảo ngược (giữ phần bên ngoài)
          </label>
          <div className="row">
            <button onClick={() => setMask({ points: m.points.map((q) => ({ ...q, smooth: true })) })} disabled={!n}>
              Làm cong hết
            </button>
            <button onClick={() => setMask({ points: m.points.map((q) => ({ ...q, smooth: false })) })} disabled={!n}>
              Góc nhọn hết
            </button>
            <button
              className="danger"
              onClick={() => {
                setParams({ mask: undefined });
                setEditing(false);
              }}
            >
              Xoá mask
            </button>
          </div>
          {maskActive(m) ? null : n >= 3 && <small className="muted block">Mask đang tắt.</small>}
        </>
      )}
    </>
  );
}

/** Video object: segment trim + green-screen removal (both apply to preview and export). */
function VideoMediaEditor({ sel, setParams, dur, loopSeconds, mediaKey, keying = true }) {
  const prm = sel.params || {};
  const key = mediaKey || 'prop:' + sel.id;
  const { start, end } = trimRange(prm, dur);
  const len = end - start;
  const L = loopSeconds || 0;
  const reps = len > 0 ? L / len : 0;
  const seamless = !L || len <= 0 || Math.abs(reps - Math.round(reps)) < 0.01 || len >= dur - 0.01;
  const setStart = (v) => setParams({ trimStart: Math.min(v, end - 0.1) });
  const setEnd = (v) => setParams({ trimEnd: Math.max(v, start + 0.1) });
  // make the segment length divide the loop length so the exported loop has no jump
  const fitLoop = () => {
    let n = Math.max(1, Math.round(L / len));
    while (n > 1 && start + L / n > dur) n--;
    const want = L / Math.max(1, n);
    if (start + want <= dur) setParams({ trimEnd: +(start + want).toFixed(3) });
    else setParams({ trimStart: Math.max(0, +(dur - want).toFixed(3)), trimEnd: dur });
  };
  const redetect = () => {
    const v = getVideoElement(key);
    if (!v) return;
    const r = detectKeyBackground(v, v.videoWidth, v.videoHeight);
    const mode = r.kind === 'green' || r.kind === 'black' ? r.kind : 'none';
    setParams({ keyMode: mode, bgDetected: r.kind || 'none', chromaKey: false, ...(r.kind === 'green' ? { keyColor: r.color } : {}) });
  };
  const mode = keyModeOf(prm);
  const detected = prm.bgDetected || (prm.greenDetected != null ? (prm.greenDetected ? 'green' : 'none') : null);
  const detectedMsg = { green: '✓ Đã phát hiện nền xanh lá — tự động bật.', black: '✓ Đã phát hiện nền đen (lửa/khói/ánh sáng) — tự động bật.', transparent: '✓ Video đã có nền trong suốt sẵn — không cần xoá nền.', none: 'Không phát hiện nền xanh hay nền đen ở viền video.' }[detected];
  return (
    <>
      <h3>Cắt phân đoạn video</h3>
      {dur > 0 ? (
        <>
          <Field label="Bắt đầu">
            <Range value={+start.toFixed(2)} min={0} max={+dur.toFixed(2)} step={0.05} onChange={setStart} fmt={fmtSec} />
          </Field>
          <Field label="Kết thúc">
            <Range value={+end.toFixed(2)} min={0} max={+dur.toFixed(2)} step={0.05} onChange={setEnd} fmt={fmtSec} />
          </Field>
          <small className="muted">
            Phát lặp đoạn {fmtSec(start)} → {fmtSec(end)} (dài {fmtSec(len)} / cả video {fmtSec(dur)}) — trong khung xem trước và khi xuất.
          </small>
          {!seamless && (
            <small className="muted block">
              Vòng lặp cảnh dài {L}s không chia hết cho độ dài đoạn → video sẽ nhảy khi cảnh lặp lại.
            </small>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            {!seamless && <button onClick={fitLoop}>Khớp với vòng lặp {L}s</button>}
            <button onClick={() => setParams({ trimStart: 0, trimEnd: null })} disabled={len >= dur - 0.01}>
              Dùng cả video
            </button>
          </div>
        </>
      ) : (
        <small className="muted">Đang tải video…</small>
      )}
      {keying && (
      <>
      <h3>Xoá nền video</h3>
      <Field label="Loại nền">
        <div className="row" style={{ margin: 0 }}>
          <Select
            value={mode}
            options={[
              ['none', 'Không xoá nền'],
              ['green', 'Nền xanh lá (chroma key)'],
              ['black', 'Nền đen (lửa, khói, tia sáng…)'],
            ]}
            onChange={(m) => setParams({ keyMode: m, chromaKey: false })}
          />
          <button onClick={redetect} title="Dò lại loại nền từ viền khung hình hiện tại">
            Tự dò
          </button>
        </div>
      </Field>
      {detectedMsg && <small className="muted block">{detectedMsg}</small>}
      {mode === 'black' && (
        <>
          <small className="muted block" style={{ marginBottom: 8 }}>
            Vùng đen thành trong suốt, chỗ sáng (lửa) giữ nguyên, khói mờ thành bán trong suốt — giống chế độ hoà trộn Screen.
          </small>
          <Field label="Ngưỡng nền đen" hint="Tăng nếu còn thấy viền/khung xám đục quanh vật thể.">
            <Range value={prm.lumaThreshold ?? LUMA_DEFAULTS.lumaThreshold} min={0} max={0.4} step={0.01} onChange={(v) => setParams({ lumaThreshold: v })} fmt={pct} />
          </Field>
          <Field label="Độ đậm" hint="Tăng để khói/lửa mờ đặc hơn, giảm để trong hơn.">
            <Range value={prm.lumaBoost ?? LUMA_DEFAULTS.lumaBoost} min={0.5} max={3} step={0.05} onChange={(v) => setParams({ lumaBoost: v })} fmt={(v) => v.toFixed(2) + '×'} />
          </Field>
          <button onClick={() => setParams({ ...LUMA_DEFAULTS })}>Đặt lại thông số</button>
        </>
      )}
      {mode === 'green' && (
        <>
          <Field label="Màu nền cần xoá">
            <input type="color" value={prm.keyColor || CHROMA_DEFAULTS.keyColor} onChange={(e) => setParams({ keyColor: e.target.value })} />
          </Field>
          <Field label="Độ nhạy" hint="Cao hơn = xoá rộng hơn (kể cả vùng xanh tối/bóng đổ).">
            <Range value={prm.keySimilarity ?? CHROMA_DEFAULTS.keySimilarity} min={0.05} max={0.95} step={0.01} onChange={(v) => setParams({ keySimilarity: v })} fmt={pct} />
          </Field>
          <Field label="Độ mềm viền" hint="Cao hơn = quầng sáng, khói, lấp lánh mờ giữ được nhiều hơn (trong hơn); thấp hơn = hình đặc, viền gọn.">
            <Range value={prm.keySmoothness ?? CHROMA_DEFAULTS.keySmoothness} min={0.01} max={0.6} step={0.01} onChange={(v) => setParams({ keySmoothness: v })} fmt={pct} />
          </Field>
          <Field label="Khử ánh xanh ở viền">
            <Range value={prm.keySpill ?? CHROMA_DEFAULTS.keySpill} min={0} max={1} step={0.05} onChange={(v) => setParams({ keySpill: v })} fmt={pct} />
          </Field>
          <button onClick={() => setParams({ ...CHROMA_DEFAULTS, keyColor: prm.keyColor || CHROMA_DEFAULTS.keyColor })}>Đặt lại thông số</button>
        </>
      )}
      </>
      )}
    </>
  );
}

const PARAM_LABELS = { curtains: 'Có rèm cửa', curtainColor: 'Màu rèm', color: 'Màu', glow: 'Đèn sáng bên trong' };

// -------------------------------------------------------------- character
const short = (n) => n.split('/').pop();
export function CharacterPanel({ project, update, rig, charSel, setCharSel, openLibrary }) {
  const lib = useLibrary();
  const art = useArt();
  if (!rig) return <p className="muted">Chưa tải nhân vật Spine.</p>;
  const chars = project.characters || [];
  const sel = chars.find((x) => x.id === charSel) || chars[0];
  const cat = rig.catalog;
  const nameOf = (n) => (lib.labels[n] ? `${lib.labels[n]} (${short(n)})` : short(n));
  const opt = (list, none) => [...(none ? [['', none]] : []), ...list.map((n) => [n, nameOf(n)])];
  const LOOK_FIELDS = ['skin', 'eyes', 'costume', 'mask', 'rod', 'art'];
  const set = (k, v) =>
    update((p) => {
      const c = p.characters.find((x) => x.id === sel.id);
      c[k] = v;
      if (LOOK_FIELDS.includes(k) && c.lib) c.lib = { ...c.lib, skin: '' }; // chỉnh tay → không còn khớp skin thư viện
    });

  // ---- thư viện
  const libChar = sel?.lib && lib.characters.find((c) => c.id === sel.lib.char);
  const addFromLib = (v) => {
    const [cid, sid] = v.split('|');
    const lc = lib.characters.find((c) => c.id === cid);
    const sk = lc?.skins.find((s) => s.id === sid);
    if (!lc || !sk) return;
    const id = uid('c');
    update((p) => addLibraryCharToProject(p, lc, sk, cat.rods[0] || '', id));
    setCharSel(id);
  };
  const applyLibSkin = (sid) => {
    const sk = libChar?.skins.find((s) => s.id === sid);
    if (!sk) return;
    update((p) => Object.assign(p.characters.find((x) => x.id === sel.id), projectFieldsFromSkin(libChar, sk)));
  };
  // Electron không hỗ trợ prompt() → dùng tên mặc định, đổi tên sau ở trang Thư viện nhân vật
  const saveToLib = () => {
    const skin = { ...newSkin(), eyes: sel.eyes || '', costume: sel.costume || '', mask: sel.mask || '', rod: sel.rod || '', art: sel.art || '' };
    const sameBase = libChar && libChar.base === sel.skin;
    if (sameBase && confirm(`Thêm diện mạo hiện tại thành skin mới của "${libChar.name}" trong thư viện?
(Huỷ = tạo nhân vật mới trong thư viện)`)) {
      skin.name = 'Skin ' + (libChar.skins.length + 1);
      setLibrary((l) => l.characters.find((c) => c.id === libChar.id)?.skins.push(skin));
      update((p) => (p.characters.find((x) => x.id === sel.id).lib = { char: libChar.id, skin: skin.id }));
      alert(`Đã thêm "${skin.name}" vào "${libChar.name}". Đổi tên skin ở trang Thư viện nhân vật.`);
      return;
    }
    const lc = { ...newLibChar(sel.skin), name: sel.name || 'Nhân vật mới', scale: sel.scale ?? 0.6, facesLeft: !!sel.facesLeft, skins: [skin] };
    setLibrary((l) => l.characters.push(lc));
    update((p) => (p.characters.find((x) => x.id === sel.id).lib = { char: lc.id, skin: skin.id }));
    alert(`Đã lưu "${lc.name}" vào thư viện. Đổi tên / thêm skin ở trang Thư viện nhân vật.`);
  };
  const libOptions = [['', '+ Thêm từ thư viện…'], ...lib.characters.flatMap((c) => c.skins.map((s) => [c.id + '|' + s.id, `${c.name} — ${s.name}`]))];

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
      <div className="row">
        <button onClick={addChar}>+ Thêm nhân vật</button>
        {lib.characters.length ? (
          <Select value="" options={libOptions} onChange={(v) => v && addFromLib(v)} />
        ) : (
          <button onClick={openLibrary} title="Tạo nhân vật + skin dùng lại cho mọi dự án">
            Mở thư viện nhân vật
          </button>
        )}
      </div>
      <ul className="list">
        {chars.map((c) => (
          <li key={c.id} className={sel?.id === c.id ? 'on' : ''} onClick={() => setCharSel(c.id)}>
            <span className="grow">🐾 {c.name}</span>
            <span className="badge">{partLabel(c.skin || '', lib)}</span>
          </li>
        ))}
      </ul>
      {sel && (
        <div className="editor">
          <Field label="Tên hiển thị">
            <input value={sel.name || ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          {libChar && (
            <Field label={`Skin (thư viện: ${libChar.name})`}>
              <Select
                value={sel.lib.skin || ''}
                options={[...(sel.lib.skin && libChar.skins.some((s) => s.id === sel.lib.skin) ? [] : [['', '— đã chỉnh tay —']]), ...libChar.skins.map((s) => [s.id, s.name])]}
                onChange={(v) => v && applyLibSkin(v)}
              />
            </Field>
          )}
          <Field label="Nhân vật gốc">
            <Select value={sel.skin} options={opt(cat.characters)} onChange={(v) => set('skin', v)} />
          </Field>
          <Field label="Mẫu mắt">
            <Select value={sel.eyes} options={opt(cat.eyes, 'Mặc định')} onChange={(v) => set('eyes', v)} />
          </Field>
          <Field label="Trang phục">
            <Select value={sel.costume} options={opt(cat.costumes, 'Không')} onChange={(v) => set('costume', v)} />
          </Field>
          <Field label="Mặt nạ / phụ kiện">
            <Select value={sel.mask} options={opt(cat.masks, 'Không')} onChange={(v) => set('mask', v)} />
          </Field>
          <Field label="Bộ hình Spine">
            <Select
              value={sel.art || ''}
              options={[['', 'Không — hình gốc'], ...art.sets.map((s) => [s.id, s.name]), ...(sel.art && !art.sets.some((s) => s.id === sel.art) ? [[sel.art, '(bộ hình không có trên máy này)']] : [])]}
              onChange={(v) => set('art', v)}
            />
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
            <button onClick={saveToLib} title="Lưu diện mạo này vào thư viện để dùng cho dự án khác">
              Lưu vào thư viện
            </button>
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
