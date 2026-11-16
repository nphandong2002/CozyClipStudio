// Thư viện nhân vật dùng chung cho mọi dự án + tên tuỳ chỉnh cho các bộ phận Spine
// (mẫu mắt, trang phục, mặt nạ, cần câu, nhân vật gốc, hành động).
// Lưu ra file .cache/library.json (Electron) và localStorage.
import { useSyncExternalStore } from 'react';
import { ACTIONS } from '../engine/character.js';
import { uid } from '../engine/util.js';

const STORE_KEY = 'cozyclip.library.v1';
const api = typeof window !== 'undefined' ? window.api : null;

const empty = () => ({ version: 1, labels: {}, characters: [] });

function normalize(lib) {
  const out = empty();
  if (!lib || typeof lib !== 'object') return out;
  if (lib.labels && typeof lib.labels === 'object') {
    for (const [k, v] of Object.entries(lib.labels)) if (typeof v === 'string' && v.trim()) out.labels[k] = v;
  }
  for (const c of Array.isArray(lib.characters) ? lib.characters : []) {
    if (!c || typeof c !== 'object') continue;
    const skins = (Array.isArray(c.skins) ? c.skins : []).filter((s) => s && typeof s === 'object').map((s) => ({ ...newSkin(), ...s, id: s.id || uid('sk') }));
    out.characters.push({ ...newLibChar(c.base), ...c, id: c.id || uid('lc'), skins: skins.length ? skins : [newSkin()] });
  }
  return out;
}

let state = empty();
try {
  const s = localStorage.getItem(STORE_KEY);
  if (s) state = normalize(JSON.parse(s));
} catch (_) {}

const subs = new Set();
let ready = !api?.loadLibrary; // chưa đọc xong file thì không ghi đè
let saveTimer = null;

function emit() {
  for (const fn of subs) fn();
}
function scheduleSave() {
  if (!ready) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const json = JSON.stringify(state);
    try {
      localStorage.setItem(STORE_KEY, json);
    } catch (_) {}
    api?.saveLibrary?.(json).catch((e) => console.warn('saveLibrary', e));
  }, 200);
}

if (api?.loadLibrary) {
  api
    .loadLibrary()
    .then((lib) => {
      if (lib) {
        state = normalize(lib);
        emit();
      }
    })
    .catch((e) => console.warn('loadLibrary', e))
    .finally(() => {
      ready = true;
    });
}

export const getLibrary = () => state;

/** Mutate a draft of the library: setLibrary((lib) => { lib.characters.push(...) }). */
export function setLibrary(fn) {
  const next = structuredClone(state);
  const r = fn(next);
  state = r && typeof r === 'object' && r !== next ? normalize(r) : next;
  emit();
  scheduleSave();
}

export function useLibrary() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    getLibrary
  );
}

// ------------------------------------------------------------------ labels
export const shortName = (n) => String(n || '').split('/').pop();

/** Display name of a Spine skin part (eyes, costume, mask, rod, base character). */
export function partLabel(name, lib = state) {
  if (!name) return '';
  return lib.labels[name] || shortName(name);
}

/** Display name of an action id ('sitLick', 'anim:wave', …). */
export function actionLabel(id, lib = state) {
  const custom = lib.labels['action:' + id];
  if (custom) return custom;
  if (ACTIONS[id]) return ACTIONS[id].label;
  if (id?.startsWith('anim:')) return 'Spine: ' + id.slice(5);
  return id || '';
}

/** [value, label] pairs for every action (presets + raw Spine animations). */
export function actionOptions(rig, lib = state) {
  return [
    ...Object.keys(ACTIONS).map((k) => [k, actionLabel(k, lib)]),
    ...(rig ? rig.animNames.filter((n) => n !== 'default' && n !== 'blink').map((n) => ['anim:' + n, actionLabel('anim:' + n, lib)]) : []),
  ];
}

// ------------------------------------------------------------------ characters
export function newSkin(name = 'Mặc định') {
  return { id: uid('sk'), name, eyes: '', costume: '', mask: '', rod: '', action: 'idle' };
}

export function newLibChar(base = '') {
  return { id: uid('lc'), name: 'Nhân vật mới', base, scale: 0.6, facesLeft: false, skins: [newSkin()] };
}

/** Look object understood by CharacterRig.setLook. */
export function skinLook(libChar, skin) {
  return { skin: libChar?.base, eyes: skin?.eyes || '', costume: skin?.costume || '', mask: skin?.mask || '', rod: skin?.rod || '' };
}

/** Fields copied onto a project character when a library skin is applied. */
export function projectFieldsFromSkin(libChar, skin) {
  return {
    skin: libChar.base,
    eyes: skin.eyes || '',
    costume: skin.costume || '',
    mask: skin.mask || '',
    rod: skin.rod || '',
    lib: { char: libChar.id, skin: skin.id },
  };
}

/**
 * Add a library character (with one of its skins) to a project draft.
 * Returns the new project character id.
 */
export function addLibraryCharToProject(p, libChar, skin, fallbackRod = '', id = uid('c')) {
  const fields = projectFieldsFromSkin(libChar, skin);
  if (!fields.rod) fields.rod = fallbackRod;
  p.characters.push({ id, name: libChar.name, scale: libChar.scale ?? 0.6, facesLeft: !!libChar.facesLeft, ...fields });
  const floor = Math.round((p.scene?.floorLevel ?? 0.74) * 1080) + 120;
  for (const seg of p.timeline) {
    seg.cast = seg.cast || {};
    const n = Object.keys(seg.cast).length;
    seg.cast[id] = { action: skin.action || 'sit', x: 500 + n * 300, y: floor };
  }
  return id;
}

// ------------------------------------------------------------------ import / export
export function exportLibraryFile() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'thu-vien-nhan-vat.cozylib.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Merge characters + labels from a file the user picks. Resolves with a short summary or null. */
export function importLibraryFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      try {
        const lib = normalize(JSON.parse(await f.text()));
        let added = 0;
        setLibrary((cur) => {
          Object.assign(cur.labels, lib.labels);
          for (const c of lib.characters) {
            const i = cur.characters.findIndex((x) => x.id === c.id);
            if (i >= 0) cur.characters[i] = c;
            else cur.characters.push(c);
            added++;
          }
        });
        resolve(`${added} nhân vật, ${Object.keys(lib.labels).length} tên tuỳ chỉnh`);
      } catch (e) {
        reject(new Error('File thư viện không hợp lệ: ' + e.message));
      }
    };
    inp.click();
  });
}
