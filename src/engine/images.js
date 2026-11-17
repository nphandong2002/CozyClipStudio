// Loads and caches user media (image / animated GIF / video) used by props and the
// background, so the synchronous draw/export code can blit a frame. Browser/Electron only.
import { parseGIF, decompressFrames } from 'gifuct-js';

const cache = new Map(); // key -> record

function dataUrlToBlob(dataURL) {
  const comma = dataURL.indexOf(',');
  const mime = /data:([^;]+)/.exec(dataURL.slice(0, comma))?.[1] || 'application/octet-stream';
  const bin = atob(dataURL.slice(comma + 1));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

function loadImageRecord(src) {
  const img = new Image();
  const rec = { kind: 'image', src, img, ready: false };
  rec.promise = new Promise((resolve) => {
    img.onload = () => {
      rec.ready = true;
      resolve(rec);
    };
    img.onerror = () => resolve(rec);
  });
  img.src = src;
  return rec;
}

async function decodeGif(src) {
  const buf = await (await fetch(src)).arrayBuffer();
  const gif = parseGIF(buf);
  const frames = decompressFrames(gif, true);
  const W = gif.lsd.width;
  const H = gif.lsd.height;
  const full = document.createElement('canvas');
  full.width = W;
  full.height = H;
  const fctx = full.getContext('2d');
  const out = [];
  let acc = 0;
  for (const fr of frames) {
    const patch = document.createElement('canvas');
    patch.width = fr.dims.width;
    patch.height = fr.dims.height;
    patch.getContext('2d').putImageData(new ImageData(fr.patch, fr.dims.width, fr.dims.height), 0, 0);
    fctx.drawImage(patch, fr.dims.left, fr.dims.top);
    const snap = document.createElement('canvas');
    snap.width = W;
    snap.height = H;
    snap.getContext('2d').drawImage(full, 0, 0);
    acc += (fr.delay || 100) / 1000;
    out.push({ canvas: snap, end: acc });
    if (fr.disposalType === 2) fctx.clearRect(fr.dims.left, fr.dims.top, fr.dims.width, fr.dims.height);
  }
  return { frames: out, totalDur: acc || 1, W, H };
}

function loadGifRecord(src) {
  const rec = { kind: 'gif', src, ready: false, frames: [], totalDur: 1 };
  rec.promise = decodeGif(src)
    .then((g) => {
      rec.frames = g.frames;
      rec.totalDur = g.totalDur;
      rec.ready = rec.frames.length > 0;
      return rec;
    })
    .catch(() => rec);
  return rec;
}

function loadVideoRecord(src, blob) {
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  const rec = { kind: 'video', src, video, ready: false, duration: 0, blobUrl: null, error: null, keyer: null };
  rec.promise = (async () => {
    try {
      // async blob conversion keeps the UI responsive for big uploads (atob on 100MB+ would freeze it)
      const b = blob || (await (await fetch(src)).blob());
      rec.blobUrl = URL.createObjectURL(b);
    } catch (_) {
      rec.blobUrl = src;
    }
    if (rec.disposed) return rec;
    await new Promise((resolve) => {
      video.onloadeddata = () => {
        rec.ready = true;
        rec.duration = video.duration || 0;
        video.play().catch(() => {});
        resolve();
      };
      video.onerror = () => {
        rec.error = 'Không phát được video này (định dạng/codec không hỗ trợ). Hãy dùng MP4 (H.264) hoặc WebM.';
        resolve();
      };
      video.src = rec.blobUrl;
    });
    return rec;
  })();
  return rec;
}

function makeRecord(src, mediaType, blob) {
  if (mediaType === 'video') return loadVideoRecord(src, blob);
  if (mediaType === 'gif') return loadGifRecord(src);
  return loadImageRecord(src);
}

/**
 * Start (or reuse) loading `src` under `key`. Returns a promise resolving to the record when ready
 * (`rec.ready` false + `rec.error` on failure). `blob` (optional) is the original File, used for
 * videos to skip re-decoding the data URL.
 */
export function setImageSrc(key, src, mediaType = 'image', blob = null) {
  const e = cache.get(key);
  if (!src) {
    disposeRecord(e);
    cache.delete(key);
    return Promise.resolve(null);
  }
  if (e && e.src === src && e.kind === (mediaType === 'gif' ? 'gif' : mediaType === 'video' ? 'video' : 'image')) return e.promise;
  disposeRecord(e);
  const rec = makeRecord(src, mediaType, blob);
  cache.set(key, rec);
  return rec.promise;
}

function disposeRecord(rec) {
  if (rec) rec.disposed = true;
  if (rec?.kind === 'video') {
    try {
      rec.video.pause();
    } catch (_) {}
  }
  if (rec?.kind === 'video' && rec.blobUrl && rec.blobUrl.startsWith('blob:')) {
    try {
      rec.video.pause();
      URL.revokeObjectURL(rec.blobUrl);
    } catch (_) {}
  }
}

/** The image element for a still image key (used by the background), or null. */
export function getImage(key) {
  const e = cache.get(key);
  return e && e.kind === 'image' && e.ready ? e.img : null;
}

/**
 * A drawable (image | gif frame canvas | video element | chroma-keyed canvas) for a key at loop
 * time t, or null. `params` are the prop params (video trim + chroma key settings).
 */
export function getDrawable(key, t = 0, params = null) {
  const e = cache.get(key);
  if (!e || !e.ready) return null;
  if (e.kind === 'image') return e.img;
  if (e.kind === 'video') {
    const v = e.video;
    // live preview: keep the freely playing video inside the trimmed segment
    if (!v.paused && !v.seeking) {
      const { start, end } = trimRange(params, e.duration || v.duration || 0);
      if (end > start && (v.currentTime < start - 0.02 || v.currentTime >= end - 0.01)) {
        try {
          v.currentTime = start;
        } catch (_) {}
      }
    }
    const mode = keyModeOf(params);
    return mode !== 'none' ? keyedFrame(e, params, mode) : v;
  }
  if (e.kind === 'gif') {
    const tt = ((t % e.totalDur) + e.totalDur) % e.totalDur;
    for (const f of e.frames) if (f.end > tt) return f.canvas;
    return e.frames[e.frames.length - 1]?.canvas || null;
  }
  return null;
}

function mediaTypeOf(p) {
  return p.params?.mediaType || 'image';
}

/** Preload every media a project references (background + media props). */
export function preloadProject(project) {
  if (!project) return Promise.resolve();
  const ps = [];
  if (project.scene?.backgroundImage) ps.push(setImageSrc('bg', project.scene.backgroundImage, 'image'));
  else {
    disposeRecord(cache.get('bg'));
    cache.delete('bg');
  }
  const liveIds = new Set();
  for (const p of project.props || []) {
    if (p.type === 'image' && p.params?.src) {
      liveIds.add('prop:' + p.id);
      ps.push(setImageSrc('prop:' + p.id, p.params.src, mediaTypeOf(p)));
    }
  }
  for (const k of [...cache.keys()]) {
    if (k.startsWith('prop:') && !liveIds.has(k)) {
      disposeRecord(cache.get(k));
      cache.delete(k);
    }
  }
  return Promise.all(ps);
}

/** Before exporting a frame at loop time t, seek every video prop to the matching time. */
export async function seekMediaForExport(project, t) {
  const tasks = [];
  for (const p of project.props || []) {
    if (p.type !== 'image' || mediaTypeOf(p) !== 'video') continue;
    const rec = cache.get('prop:' + p.id);
    if (!rec || rec.kind !== 'video' || !rec.ready) continue;
    const v = rec.video;
    if (!v.paused) v.pause();
    const { start, end } = trimRange(p.params, rec.duration || v.duration || 0);
    const len = end - start;
    // stay a hair before `end` so the decoded frame is still inside the segment
    const target = len > 0 ? Math.min(end - 1e-3, start + (((t % len) + len) % len)) : start;
    if (Math.abs(v.currentTime - target) < 1e-3) continue;
    tasks.push(
      new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          v.removeEventListener('seeked', done);
          resolve();
        };
        v.addEventListener('seeked', done);
        setTimeout(done, 500); // fallback so export never stalls on a seek
        try {
          v.currentTime = target;
        } catch (_) {
          done();
        }
      })
    );
  }
  await Promise.all(tasks);
}

/** Resume free playback of every loaded video (an export pauses them to seek frame by frame). */
export function resumeMediaPlayback() {
  for (const rec of cache.values()) if (rec.kind === 'video' && rec.ready && rec.video.paused) rec.video.play().catch(() => {});
}

/** The <video> element of a loaded video key, or null. */
export function getVideoElement(key) {
  const e = cache.get(key);
  return e?.kind === 'video' && e.ready ? e.video : null;
}

/** Duration (s) of a loaded video key, or 0. */
export function getMediaDuration(key) {
  const e = cache.get(key);
  return e?.kind === 'video' && e.ready ? e.duration || e.video.duration || 0 : 0;
}

// ------------------------------------------------------------------ video trim
/** The prop's trimmed segment (params.trimStart / trimEnd, seconds) clamped to the video duration. */
export function trimRange(params, dur) {
  if (!(dur > 0)) return { start: 0, end: 0 };
  let start = Math.max(0, Math.min(dur, +params?.trimStart || 0));
  let end = params?.trimEnd != null && params.trimEnd !== '' ? Math.max(0, Math.min(dur, +params.trimEnd)) : dur;
  if (end - start < 0.05) {
    start = 0;
    end = dur;
  }
  return { start, end };
}

// ------------------------------------------------------------- chroma key
export const CHROMA_DEFAULTS = { keyColor: '#00ff00', keySimilarity: 0.45, keySmoothness: 0.12, keySpill: 0.6 };
export const LUMA_DEFAULTS = { lumaThreshold: 0.06, lumaBoost: 1 };

/** Background removal mode of a video prop: 'none' | 'green' (chroma key) | 'black' (fire/smoke/light on black). */
export function keyModeOf(params) {
  if (!params) return 'none';
  if (params.keyMode) return params.keyMode;
  return params.chromaKey ? 'green' : 'none'; // projects saved before keyMode existed
}

/**
 * Remove a black background, in place (RGBA bytes) — for fire, smoke, sparks, light leaks…
 * Alpha comes from brightness and the colour is "unmultiplied", so drawn over any scene the result
 * matches a Screen blend: black vanishes, bright flames stay opaque, smoke becomes see-through.
 * lumaThreshold cuts near-black noise; lumaBoost > 1 makes faint parts more solid.
 */
export function applyLumaKey(data, opts) {
  const thr = Math.max(0, Math.min(0.9, opts.lumaThreshold ?? LUMA_DEFAULTS.lumaThreshold)) * 255;
  const boost = Math.max(0.1, opts.lumaBoost ?? LUMA_DEFAULTS.lumaBoost);
  const k = 255 / (255 - thr);
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.max(0, data[i] - thr) * k;
    const g = Math.max(0, data[i + 1] - thr) * k;
    const b = Math.max(0, data[i + 2] - thr) * k;
    const m = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (m <= 0) {
      data[i + 3] = 0;
      continue;
    }
    const a = Math.min(255, m * boost); // 0..255
    const s = 255 / a;
    data[i] = r * s;
    data[i + 1] = g * s;
    data[i + 2] = b * s;
    data[i + 3] = (data[i + 3] * a) / 255;
  }
}
const MAX_KEY_DIM = 1280; // keyed frames are processed at most this big (long side)

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x00ff00;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

/**
 * Remove a green (or any colour) screen, in place (RGBA bytes).
 *
 * Every pixel is treated as a MIX of the foreground and the key colour:
 *   pixel = a·foreground + (1 − a)·key
 * The share of key colour is read from the pixel's chroma (CbCr) projected onto the key's chroma,
 * so neutral / differently coloured content keeps a = 1, the screen gets a = 0, and soft content
 * (glow, smoke, sparkles, light rays, motion blur) gets its real partial transparency instead of
 * being cut away. The key is then subtracted back out of the colour ("unmix"), so glows keep their
 * own colour instead of turning green.
 *   keySimilarity: how much key share counts as pure background (raises the black point)
 *   keySmoothness: how gradually alpha ramps up after that (higher = softer, more see-through glow)
 *   keySpill:      removes the green cast left on the foreground
 */
export function applyChromaKey(data, opts) {
  const [kr, kg, kb] = hexToRgb(opts.keyColor);
  const kcb = -0.168736 * kr - 0.331264 * kg + 0.5 * kb;
  const kcr = 0.5 * kr - 0.418688 * kg - 0.081312 * kb;
  const k2 = kcb * kcb + kcr * kcr || 1;
  const sim = Math.max(0, Math.min(1, opts.keySimilarity ?? CHROMA_DEFAULTS.keySimilarity));
  const smooth = Math.max(0, opts.keySmoothness ?? CHROMA_DEFAULTS.keySmoothness);
  const spill = Math.max(0, Math.min(1, opts.keySpill ?? CHROMA_DEFAULTS.keySpill));
  const lo = sim * 0.4; // key share above (1 − lo) → fully transparent (screen + its noise/unevenness)
  const span = Math.max(0.02, Math.min(1 - lo, 0.1 + smooth * 5));
  // despill acts on the key's dominant channel (green for a green screen)
  const dom = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0;
  const o1 = dom === 0 ? 1 : 0;
  const o2 = dom === 2 ? 1 : 2;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
    const t = (cb * kcb + cr * kcr) / k2; // share of key colour in this pixel (1 = pure screen)
    const raw = 1 - t; // foreground share
    if (raw <= lo) {
      data[i + 3] = 0;
      continue;
    }
    if (t > 0) {
      // unmix: take the key colour back out so soft edges/glows keep their own colour
      const inv = 1 / raw;
      r = (r - t * kr) * inv;
      g = (g - t * kg) * inv;
      b = (b - t * kb) * inv;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      const a = (raw - lo) / span;
      if (a < 1) data[i + 3] = data[i + 3] * a;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    if (spill > 0) {
      const c = data[i + dom];
      const lim = Math.max(data[i + o1], data[i + o2]);
      if (c > lim) data[i + dom] = c - (c - lim) * spill;
    }
  }
}

function keyedFrame(rec, params, mode) {
  const v = rec.video;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return v;
  let k = rec.keyer;
  if (!k) {
    const canvas = document.createElement('canvas');
    k = rec.keyer = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), stamp: '' };
  }
  const stamp = [v.currentTime, mode, params.keyColor, params.keySimilarity, params.keySmoothness, params.keySpill, params.lumaThreshold, params.lumaBoost].join('|');
  // reuse the last keyed frame while the video is still on it (or mid-seek)
  if (k.stamp && (v.seeking || k.stamp === stamp)) return k.canvas;
  const sc = Math.min(1, MAX_KEY_DIM / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * sc));
  const h = Math.max(1, Math.round(vh * sc));
  if (k.canvas.width !== w || k.canvas.height !== h) {
    k.canvas.width = w;
    k.canvas.height = h;
  }
  k.ctx.clearRect(0, 0, w, h);
  k.ctx.drawImage(v, 0, 0, w, h);
  const img = k.ctx.getImageData(0, 0, w, h);
  if (mode === 'black') applyLumaKey(img.data, { ...LUMA_DEFAULTS, ...params });
  else applyChromaKey(img.data, { ...CHROMA_DEFAULTS, ...params });
  k.ctx.putImageData(img, 0, 0);
  k.stamp = stamp;
  return k.canvas;
}

/**
 * Look at the border of a video frame to guess its background: mostly green → green screen,
 * (almost) all black → fire/smoke/light footage on black.
 * Returns { kind: 'green' | 'black' | 'transparent' | null, color } (color = average border green, '#rrggbb').
 */
export function detectKeyBackground(source, sw, sh) {
  const W = 96;
  const H = Math.max(8, Math.round((W * (sh || 9)) / (sw || 16)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const band = 3; // px of border sampled
  let n = 0;
  let hit = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let dark = 0;
  let clear = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= band && x < W - band && y >= band && y < H - band) continue;
      const i = (y * W + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      n++;
      if (d[i + 3] < 24) {
        clear++; // already transparent (alpha video)
        continue;
      }
      if (Math.max(r, g, b) < 32) dark++;
      if (g > 70 && g > r * 1.3 && g > b * 1.3 && g - Math.max(r, b) > 40) {
        hit++;
        sr += r;
        sg += g;
        sb += b;
      }
    }
  }
  const color = hit ? rgbToHex(sr / hit, sg / hit, sb / hit) : CHROMA_DEFAULTS.keyColor;
  const kind = n > 0 && clear / n >= 0.6 ? 'transparent' : n > 0 && hit / n >= 0.45 ? 'green' : n > 0 && dark / n >= 0.92 ? 'black' : null;
  return { kind, color };
}
