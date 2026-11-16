// Bộ hình Spine: thay ảnh từng bộ phận của nhân vật (mặt, tai, thân, tay, chân…) bằng
// mảnh cắt từ bảng hình của người dùng, giữ nguyên xương + mọi hành động của bộ Spine gốc.
//
// state = {
//   sets:   [{ id, name, base, fit: 'part'|'sheet', scale, parts: { 'slot::tên': ov }, extras: { slot: ov } }],
//   sheets: [{ id, name, img, w, h, opts }],          // bảng hình gốc (để cắt lại)
//   pieces: [{ id, sheet, name, img, x, y, w, h }],   // mảnh đã cắt (x,y = vị trí trên bảng)
// }
// ov = { piece, scale, dx, dy, rot, flip, hide }
// Ảnh (dataURL) lưu riêng theo id: Electron → .cache/spine-art/<id>.png, trình duyệt → IndexedDB.
import * as spine from '@esotericsoftware/spine-canvas';
import { uid } from './util.js';

const api = typeof window !== 'undefined' ? window.api : null;
const empty = () => ({ version: 1, sets: [], sheets: [], pieces: [] });

let state = empty();
const images = new Map(); // imgId -> dataURL
const decoded = new Map(); // imgId -> HTMLImageElement (đã decode xong)
const loading = new Set();
let gen = 1; // tăng mỗi khi bộ hình / ảnh thay đổi → khoá cache skin trong CharacterRig
const subs = new Set();
let loaded = false;
let readyPromise = null;

export const artGen = () => gen;
export const getArt = () => state;
export const getArtSet = (id) => (id ? state.sets.find((s) => s.id === id) : null);
export const getPiece = (id) => state.pieces.find((p) => p.id === id);
export const imageSrc = (id) => images.get(id) || '';

function emit() {
  gen++;
  for (const fn of subs) fn();
}
export function subscribeArt(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// ------------------------------------------------------------------ persistence
const IDB = 'cozyclip-art';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', mode);
    const out = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(out?.result);
    tx.onerror = () => rej(tx.error);
  });
}
const backend = api?.artLoad
  ? {
      load: () => api.artLoad(),
      saveConfig: (json) => api.artSaveConfig(json),
      saveImage: (id, d) => api.artSaveImage(id, d),
      deleteImage: (id) => api.artDeleteImage(id),
    }
  : {
      async load() {
        const db = await idb();
        return new Promise((res, rej) => {
          const out = { config: null, images: {} };
          const tx = db.transaction('kv', 'readonly');
          const cur = tx.objectStore('kv').openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return;
            if (c.key === 'config') out.config = JSON.parse(c.value);
            else if (String(c.key).startsWith('img:')) out.images[c.key.slice(4)] = c.value;
            c.continue();
          };
          tx.oncomplete = () => res(out);
          tx.onerror = () => rej(tx.error);
        });
      },
      saveConfig: (json) => idbOp('readwrite', (s) => s.put(json, 'config')),
      saveImage: (id, d) => idbOp('readwrite', (s) => s.put(d, 'img:' + id)),
      deleteImage: (id) => idbOp('readwrite', (s) => s.delete('img:' + id)),
    };

function normalize(c) {
  const out = empty();
  if (!c || typeof c !== 'object') return out;
  out.sets = (Array.isArray(c.sets) ? c.sets : []).filter((s) => s && s.id).map((s) => ({ ...newArtSet(s.base), ...s, parts: { ...(s.parts || {}) }, extras: { ...(s.extras || {}) } }));
  out.sheets = (Array.isArray(c.sheets) ? c.sheets : []).filter((s) => s && s.id && s.img);
  out.pieces = (Array.isArray(c.pieces) ? c.pieces : []).filter((p) => p && p.id && p.img);
  return out;
}

/** Load config + images once (call early; renderers just see "no art" until it finishes). */
export function loadArt() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      const r = await backend.load();
      if (r?.images) for (const [k, v] of Object.entries(r.images)) images.set(k, v);
      if (r?.config) state = normalize(r.config);
    } catch (e) {
      console.warn('loadArt', e);
    }
    loaded = true;
    emit();
    await Promise.all(state.pieces.map((p) => decodeImage(p.img)));
  })();
  return readyPromise;
}

/** Resolves when the store is loaded and every piece image is decoded (export waits on this). */
export async function artReady() {
  await loadArt();
  await Promise.all(state.pieces.map((p) => decodeImage(p.img)));
}

let saveTimer = null;
function scheduleSave() {
  if (!loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => backend.saveConfig(JSON.stringify(state)).catch((e) => console.warn('saveArt', e)), 300);
}

/** Mutate a draft: setArt((a) => { a.sets.push(...) }). */
export function setArt(fn) {
  const next = structuredClone(state);
  fn(next);
  state = next;
  emit();
  scheduleSave();
}

/** Store a new image (dataURL) and return its id. */
export async function addImage(dataURL, prefix = 'im') {
  const id = uid(prefix);
  images.set(id, dataURL);
  await backend.saveImage(id, dataURL);
  await decodeImage(id);
  return id;
}

/** Drop images no longer referenced by any sheet / piece. */
export function collectGarbage() {
  const used = new Set([...state.sheets.map((s) => s.img), ...state.pieces.map((p) => p.img)]);
  for (const id of [...images.keys()]) {
    if (used.has(id)) continue;
    images.delete(id);
    decoded.delete(id);
    backend.deleteImage(id).catch(() => {});
  }
}

export function decodeImage(id) {
  if (decoded.has(id)) return Promise.resolve(decoded.get(id));
  const src = images.get(id);
  if (!src) return Promise.resolve(null);
  const img = new Image();
  loading.add(id);
  // onload thay vì img.decode(): decode() có thể treo khi cửa sổ bị ẩn / thu nhỏ
  return new Promise((res) => {
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  })
    .then((ok) => {
      if (ok) decoded.set(id, img);
      return ok;
    })
    .finally(() => {
      loading.delete(id);
      gen++; // ảnh mới sẵn sàng → dựng lại skin có dùng ảnh này
      for (const fn of subs) fn();
    });
}
/** Decoded image or null (starts decoding in the background). */
export function getImage(id) {
  const img = decoded.get(id);
  if (img) return img;
  if (!loading.has(id) && images.has(id)) decodeImage(id);
  return null;
}

// ------------------------------------------------------------------ model helpers
export function newArtSet(base = 'skins/meow') {
  return { id: uid('art'), name: 'Bộ hình mới', base, fit: 'part', scale: 1, parts: {}, extras: {} };
}
export const newOverride = (piece) => ({ piece, scale: 1, dx: 0, dy: 0, rot: 0, flip: false, hide: false });
export const partKey = (slotName, name) => slotName + '::' + name;

// ------------------------------------------------------------------ apply to a Spine skin
const regionCache = new WeakMap();
function regionFor(img) {
  let r = regionCache.get(img);
  if (!r) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    r = {
      texture: new spine.CanvasTexture(img),
      renderObject: null,
      u: 0, v: 0, u2: 1, v2: 1,
      width: w, height: h, originalWidth: w, originalHeight: h,
      offsetX: 0, offsetY: 0, degrees: 0,
    };
    regionCache.set(img, r);
  }
  return r;
}

/** Piece drawn twice, mirrored, side by side (a pair of eyes / cheeks from one drawing). */
const pairCache = new Map();
function pairImage(img, gap) {
  const key = img.src.length + ':' + img.src.slice(-40) + '|' + Math.round(gap);
  let cv = pairCache.get(key);
  if (cv) return cv;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const g = Math.max(-w * 0.9, Math.round(gap));
  cv = document.createElement('canvas');
  cv.width = Math.max(1, w * 2 + g);
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.save();
  ctx.translate(cv.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  if (pairCache.size > 80) pairCache.clear();
  pairCache.set(key, cv);
  return cv;
}
/** Image actually used for an override (handles the mirrored pair option). */
function ovImage(img, ov) {
  return ov.pair ? pairImage(img, ov.gap ?? 0) : img;
}
const imgW = (im) => im.naturalWidth || im.width;
const imgH = (im) => im.naturalHeight || im.height;

const fitK = (att, pc) => Math.min(att.width / pc.w, att.height / pc.h); // pc: { w, h } kích thước ảnh
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * Size factor (skeleton units per piece pixel) for every sheet: median of the
 * "fit to the original part" factors of the parts that use that sheet. Used by the
 * 'sheet' fit mode so the parts keep the proportions they have on the drawing.
 */
export function sheetFactors(set, entries) {
  const per = {};
  const all = [];
  for (const e of entries) {
    const ov = set.parts[partKey(e.slotName, e.name)];
    const pc = ov && !ov.hide && getPiece(ov.piece);
    if (!pc || !(e.attachment instanceof spine.RegionAttachment)) continue;
    const k = fitK(e.attachment, { w: pc.w * (ov.pair ? 2 : 1), h: pc.h });
    (per[pc.sheet] = per[pc.sheet] || []).push(k);
    all.push(k);
  }
  const out = {};
  for (const [s, a] of Object.entries(per)) out[s] = median(a);
  out.__all = median(all);
  return out;
}

/** Bone world rotation (deg) in setup pose — extras are counter-rotated so they start upright. */
function setupRotation(rig, boneIndex) {
  if (!rig._setupSk) {
    rig._setupSk = new spine.Skeleton(rig.data);
    rig._setupSk.setToSetupPose();
    rig._setupSk.updateWorldTransform();
  }
  return rig._setupSk.bones[boneIndex].getWorldRotationX();
}

const rad = (d) => (d * Math.PI) / 180;

/**
 * Replace attachments of `skin` according to art set `artId`.
 * Returns extras: [{ slotIndex, att }] that CharacterRig.pose() forces onto their slots.
 */
export function applyArt(rig, skin, artId) {
  const set = getArtSet(artId);
  if (!set) return [];
  const data = rig.data;
  const entries = skin.getAttachments().map((e) => ({ slotIndex: e.slotIndex, name: e.name, attachment: e.attachment, slotName: data.slots[e.slotIndex].name }));
  const K = set.fit === 'sheet' ? sheetFactors(set, entries) : {};
  const g = set.scale || 1;

  for (const e of entries) {
    const key = partKey(e.slotName, e.name);
    const ov = set.parts[key];
    const src = e.attachment;
    if (!ov || !(src instanceof spine.RegionAttachment)) continue;
    const c = src.copy();
    c.sequence = null;
    c.__r0 = src.rotation;
    c.__key = key;
    if (ov.hide) {
      c.color.a = 0;
    } else {
      const pc = getPiece(ov.piece);
      const raw = pc && getImage(pc.img);
      if (!raw) continue;
      const img = ovImage(raw, ov);
      const dim = { w: imgW(img), h: imgH(img) };
      // ảnh đôi: tỉ lệ theo bảng tính trên 1 mảnh → nhân theo bề ngang thật của ảnh đôi
      const f = (set.fit === 'sheet' ? K[pc.sheet] ?? fitK(src, dim) : fitK(src, dim)) * g * (ov.scale || 1);
      c.region = regionFor(img);
      c.path = 'art:' + pc.id;
      c.width = dim.w * f;
      c.height = dim.h * f;
      const r0 = rad(src.rotation);
      const dx = ov.dx || 0;
      const dy = ov.dy || 0;
      c.x = src.x + Math.cos(r0) * dx - Math.sin(r0) * dy;
      c.y = src.y + Math.sin(r0) * dx + Math.cos(r0) * dy;
      c.rotation = src.rotation + (ov.rot || 0);
      if (ov.flip) c.scaleX = -src.scaleX;
      c.updateRegion();
    }
    skin.setAttachment(e.slotIndex, e.name, c);
  }

  const extras = [];
  const baseK = (set.fit === 'sheet' ? K : sheetFactors(set, entries));
  for (const [slotName, ov] of Object.entries(set.extras || {})) {
    const slot = data.findSlot(slotName);
    const pc = ov && getPiece(ov.piece);
    const raw = pc && getImage(pc.img);
    if (!slot || !raw) continue;
    const img = ovImage(raw, ov);
    const k = baseK[pc.sheet] ?? baseK.__all ?? 160 / Math.max(pc.w, pc.h);
    const f = k * g * (ov.scale || 1);
    const att = new spine.RegionAttachment('art+' + slotName, 'art:' + pc.id);
    att.region = regionFor(img);
    att.width = imgW(img) * f;
    att.height = imgH(img) * f;
    const r0deg = -setupRotation(rig, slot.boneData.index);
    const r0 = rad(r0deg);
    att.x = Math.cos(r0) * (ov.dx || 0) - Math.sin(r0) * (ov.dy || 0);
    att.y = Math.sin(r0) * (ov.dx || 0) + Math.cos(r0) * (ov.dy || 0);
    att.rotation = r0deg + (ov.rot || 0);
    if (ov.flip) att.scaleX = -1;
    att.updateRegion();
    att.__r0 = r0deg;
    att.__key = 'x:' + slotName;
    extras.push({ slotIndex: slot.index, att });
  }
  return extras;
}

// ------------------------------------------------------------------ share between machines
export function exportArtFile(setIds) {
  const sets = state.sets.filter((s) => setIds.includes(s.id));
  const pieceIds = new Set(sets.flatMap((s) => [...Object.values(s.parts), ...Object.values(s.extras)].map((o) => o.piece).filter(Boolean)));
  const pieces = state.pieces.filter((p) => pieceIds.has(p.id));
  const sheetIds = new Set(pieces.map((p) => p.sheet));
  const sheets = state.sheets.filter((s) => sheetIds.has(s.id));
  const imgs = {};
  for (const x of [...pieces, ...sheets]) imgs[x.img] = images.get(x.img);
  const blob = new Blob([JSON.stringify({ kind: 'cozyclip-art', version: 1, sets, sheets, pieces, images: imgs })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (sets.length === 1 ? sets[0].name : 'bo-hinh-spine') + '.cozyart.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function importArtFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      try {
        const d = JSON.parse(await f.text());
        if (d.kind !== 'cozyclip-art') throw new Error('không phải file bộ hình');
        for (const [id, src] of Object.entries(d.images || {})) {
          if (!src || images.has(id)) continue;
          images.set(id, src);
          await backend.saveImage(id, src);
        }
        const inc = normalize(d);
        setArt((a) => {
          for (const k of ['sets', 'sheets', 'pieces']) {
            for (const x of inc[k]) {
              const i = a[k].findIndex((y) => y.id === x.id);
              if (i >= 0) a[k][i] = x;
              else a[k].push(x);
            }
          }
        });
        await Promise.all(inc.pieces.map((p) => decodeImage(p.img)));
        resolve(`${inc.sets.length} bộ hình, ${inc.pieces.length} mảnh hình`);
      } catch (e) {
        reject(new Error('File bộ hình không hợp lệ: ' + e.message));
      }
    };
    inp.click();
  });
}
