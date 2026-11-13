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

function loadVideoRecord(src) {
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  const rec = { kind: 'video', src, video, ready: false, duration: 0, blobUrl: null };
  try {
    rec.blobUrl = URL.createObjectURL(dataUrlToBlob(src));
  } catch (_) {
    rec.blobUrl = src;
  }
  rec.promise = new Promise((resolve) => {
    video.onloadeddata = () => {
      rec.ready = true;
      rec.duration = video.duration || 0;
      video.play().catch(() => {});
      resolve(rec);
    };
    video.onerror = () => resolve(rec);
  });
  video.src = rec.blobUrl;
  return rec;
}

function makeRecord(src, mediaType) {
  if (mediaType === 'video') return loadVideoRecord(src);
  if (mediaType === 'gif') return loadGifRecord(src);
  return loadImageRecord(src);
}

/** Start (or reuse) loading `src` under `key`. Returns a promise resolving when ready. */
export function setImageSrc(key, src, mediaType = 'image') {
  const e = cache.get(key);
  if (!src) {
    disposeRecord(e);
    cache.delete(key);
    return Promise.resolve(null);
  }
  if (e && e.src === src && e.kind === (mediaType === 'gif' ? 'gif' : mediaType === 'video' ? 'video' : 'image')) return e.promise;
  disposeRecord(e);
  const rec = makeRecord(src, mediaType);
  cache.set(key, rec);
  return rec.promise;
}

function disposeRecord(rec) {
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

/** A drawable (image | gif frame canvas | video element) for a key at loop time t, or null. */
export function getDrawable(key, t = 0) {
  const e = cache.get(key);
  if (!e || !e.ready) return null;
  if (e.kind === 'image') return e.img;
  if (e.kind === 'video') return e.video;
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
    const dur = rec.duration || v.duration || 0;
    const target = dur > 0 ? ((t % dur) + dur) % dur : 0;
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
