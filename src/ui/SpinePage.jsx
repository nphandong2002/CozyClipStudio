// Trang "Spine": thay hình từng bộ phận của nhân vật bằng mảnh cắt từ bảng hình của bạn,
// giữ nguyên xương và mọi hành động của bộ Spine gốc (đi, ngồi, ngủ, câu cá…).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as spine from '@esotericsoftware/spine-canvas';
import { CharacterRig } from '../engine/character.js';
import {
  setArt,
  getImage,
  decodeImage,
  imageSrc,
  addImage,
  collectGarbage,
  newArtSet,
  newOverride,
  partKey,
  exportArtFile,
  importArtFile,
} from '../engine/artsets.js';
import { cutSheet, cutRect, mergePieces, DEFAULT_CUT } from '../engine/sheetCut.js';
import { uid } from '../engine/util.js';
import { Field, Range, Select } from './panels.jsx';
import { PartPicker } from './LibraryPages.jsx';
import { drawLook } from './RigPreview.jsx';
import { useLibrary, useArt, actionOptions, partLabel, shortName } from './library.js';

// Tên dễ hiểu cho các ô (slot) của bộ Spine mèo
const SLOT_VI = {
  body: 'Thân',
  'cat/Tail': 'Đuôi',
  'Hand Left': 'Tay trái',
  'Hand Right': 'Tay phải',
  'leg-left': 'Chân trái',
  'leg-right': 'Chân phải',
  Face: 'Mặt / đầu',
  'Ear Left': 'Tai trái',
  'Ear Right': 'Tai phải',
  Eyes: 'Mắt',
  'Eyes Holder': 'Viền mắt',
  nose: 'Mũi',
  cheek: 'Má hồng',
  'cat/Mouth (1)': 'Miệng',
  'hair-front': 'Tóc (trước)',
  'hair-back': 'Tóc (sau)',
  Hat: 'Mũ',
  'Hat-Back': 'Mũ (phía sau)',
  glasses: 'Kính',
  mask: 'Mặt nạ',
  'face-mask': 'Khẩu trang / râu',
  'eye-patch': 'Bịt mắt',
  wings: 'Cánh',
  capes: 'Áo choàng',
  'capes-front': 'Áo choàng (trước)',
  'costume-front': 'Trang phục (trước)',
  'costume-back': 'Trang phục (sau)',
  'costume-bow': 'Nơ cổ',
  rod: 'Đồ cầm tay phải',
  hand: 'Bàn tay (vuốt ve)',
  finger1: 'Ngón 1',
  finger2: 'Ngón 2',
  finger3: 'Ngón 3',
  particles: 'Hiệu ứng',
  'particles 2': 'Hiệu ứng 2',
  'particles 3': 'Hiệu ứng 3',
};
const VAR_VI = {
  'Body Main': 'chính diện',
  'Body Back': 'quay lưng / nằm',
  'Body Side': 'nghiêng',
  Open: 'mở',
  Sad: 'buồn',
  Tired: 'mệt',
  Closed: 'nhắm',
  ClosedHappy: 'nhắm cười',
  Hurt: 'đau',
  Closing1: 'đang nhắm 1',
  Closing2: 'đang nhắm 2',
  Main: 'thường',
  Pick: 'cầm',
  Folded: 'gập',
  Dig: 'đào',
  'mouth-default': 'cười',
  'mouth-chew': 'nhai',
  'mouth-open': 'há',
  'mouth-sad': 'buồn',
  'mouth-simple': 'mím',
  'mouth-tongue1': 'lè lưỡi 1',
  'mouth-tongue2': 'lè lưỡi 2',
  'mouth-tongue3': 'lè lưỡi 3',
  'cat/Tail': 'cong trái',
  'cat/Tail 2': 'cong phải',
  'cat/Leg (2)': 'đứng',
  'cat/Leg (1)': 'đứng',
  'cat/Leg1': 'ngồi / gập',
  'cat/Leg': 'ngồi / gập',
};
// ô nên dùng để gắn thêm phụ kiện (mũ, kính, váy…)
const EXTRA_SLOTS = ['Hat', 'Hat-Back', 'hair-front', 'hair-back', 'glasses', 'mask', 'face-mask', 'eye-patch', 'costume-front', 'costume-back', 'costume-bow', 'capes', 'capes-front', 'wings', 'rod'];

const slotLabel = (n) => SLOT_VI[n] || n;
const varLabel = (n) => VAR_VI[n] || shortName(n);
const keySlot = (k) => (k.startsWith('x:') ? k.slice(2) : k.split('::')[0]);
const keyName = (k) => (k.startsWith('x:') ? null : k.slice(k.indexOf('::') + 2));
const keyLabel = (k) => (k ? (k.startsWith('x:') ? `${slotLabel(k.slice(2))} (gắn thêm)` : `${slotLabel(keySlot(k))} · ${varLabel(keyName(k))}`) : '');

const readFile = (f) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

// ------------------------------------------------------------------ small views
/** Thumbnail of an original Spine attachment (straight from the atlas). */
function AttThumb({ att, size = 40 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const r = att?.region;
    const img = r?.texture?.getImage?.();
    if (!cv || !img) return;
    const dpr = 2;
    cv.width = cv.height = size * dpr;
    const ctx = cv.getContext('2d');
    const rot = r.degrees === 90;
    const sw = rot ? r.height : r.width; // kích thước vùng trên atlas
    const sh = rot ? r.width : r.height;
    const k = (Math.min(size / r.width, size / r.height) * 0.92 * dpr);
    ctx.translate((size * dpr) / 2, (size * dpr) / 2);
    if (rot) ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, r.u * img.width, r.v * img.height, sw, sh, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
  }, [att, size]);
  return <canvas ref={ref} className="att-thumb" style={{ width: size, height: size }} />;
}

function PieceImg({ piece, size = 40 }) {
  if (!piece) return <span className="piece-img empty" style={{ width: size, height: size }} />;
  return <img className="piece-img" src={imageSrc(piece.img)} style={{ width: size, height: size }} alt="" draggable={false} />;
}

/** Sheet with clickable boxes around the cut pieces; drag on empty space to cut a rectangle. */
function SheetView({ sheet, pieces, sel, used, onPick, onRect }) {
  const wrap = useRef(null);
  const [drag, setDrag] = useState(null);
  const toSheet = (e) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * sheet.w, y: ((e.clientY - r.top) / r.height) * sheet.h };
  };
  const pct = (v, of) => (v / of) * 100 + '%';
  return (
    <div
      ref={wrap}
      className="sheet-view"
      onMouseDown={(e) => {
        if (e.target !== wrap.current && !e.target.classList.contains('sheet-img')) return;
        e.preventDefault();
        const p = toSheet(e);
        setDrag({ a: p, b: p });
      }}
      onMouseMove={(e) => drag && setDrag({ ...drag, b: toSheet(e) })}
      onMouseUp={() => {
        if (!drag) return;
        const x = Math.min(drag.a.x, drag.b.x);
        const y = Math.min(drag.a.y, drag.b.y);
        const w = Math.abs(drag.a.x - drag.b.x);
        const h = Math.abs(drag.a.y - drag.b.y);
        setDrag(null);
        if (w > 6 && h > 6) onRect({ x, y, w, h });
      }}
      onMouseLeave={() => setDrag(null)}
    >
      <img className="sheet-img" src={imageSrc(sheet.img)} alt="" draggable={false} />
      {pieces.map((p, i) => (
        <div
          key={p.id}
          className={'sheet-box' + (sel.includes(p.id) ? ' on' : '') + (used.has(p.id) ? ' used' : '')}
          style={{ left: pct(p.x, sheet.w), top: pct(p.y, sheet.h), width: pct(p.bw ?? p.w, sheet.w), height: pct(p.bh ?? p.h, sheet.h) }}
          title={`${p.name}${used.has(p.id) ? ' · đang dùng' : ''} — bấm để chọn, Shift+bấm để chọn nhiều`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => onPick(p.id, e.shiftKey || e.ctrlKey || e.metaKey)}
        >
          <span>{i + 1}</span>
        </div>
      ))}
      {drag && (
        <div
          className="sheet-drag"
          style={{
            left: pct(Math.min(drag.a.x, drag.b.x), sheet.w),
            top: pct(Math.min(drag.a.y, drag.b.y), sheet.h),
            width: pct(Math.abs(drag.a.x - drag.b.x), sheet.w),
            height: pct(Math.abs(drag.a.y - drag.b.y), sheet.h),
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ interactive preview
const alphaCache = new WeakMap();
function alphaAt(img, x, y) {
  let a = alphaCache.get(img);
  if (!a) {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth || img.width;
    cv.height = img.naturalHeight || img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    a = { W: cv.width, H: cv.height, d: ctx.getImageData(0, 0, cv.width, cv.height).data };
    alphaCache.set(img, a);
  }
  const px = Math.floor(x * a.W);
  const py = Math.floor(y * a.H);
  if (px < 0 || py < 0 || px >= a.W || py >= a.H) return 0;
  return a.d[(py * a.W + px) * 4 + 3];
}

const qv = new Float32Array(8);
/** Key of the topmost visible part under world point (wx, wy), testing real pixel alpha. */
function hitTest(r, wx, wy) {
  const sk = r.skeleton;
  for (let i = sk.drawOrder.length - 1; i >= 0; i--) {
    const slot = sk.drawOrder[i];
    if (!slot.bone.active) continue;
    const a = slot.getAttachment();
    if (!(a instanceof spine.RegionAttachment) || a.color.a * slot.color.a < 0.05) continue;
    a.computeWorldVertices(slot, qv, 0, 2);
    // toạ độ (s, t) trong hình bình hành BL→UL (s), BL→BR (t)
    const ex = qv[2] - qv[0], ey = qv[3] - qv[1];
    const fx = qv[6] - qv[0], fy = qv[7] - qv[1];
    const det = ex * fy - ey * fx;
    if (Math.abs(det) < 1e-6) continue;
    const px = wx - qv[0], py = wy - qv[1];
    const s = (px * fy - py * fx) / det;
    const t = (ex * py - ey * px) / det;
    if (s < 0 || s > 1 || t < 0 || t > 1) continue;
    const uv = a.uvs;
    const u = uv[0] + s * (uv[2] - uv[0]) + t * (uv[6] - uv[0]);
    const v = uv[1] + s * (uv[3] - uv[1]) + t * (uv[7] - uv[1]);
    const img = a.region.texture.getImage();
    if (alphaAt(img, u, v) < 40) continue;
    return keyOfAttachment(r, slot, a);
  }
  return null;
}
function keyOfAttachment(r, slot, a) {
  if (a.__key) return a.__key;
  const map = r.skeleton.skin?.attachments[slot.data.index];
  if (map) for (const [name, att] of Object.entries(map)) if (att === a) return partKey(slot.data.name, name);
  return partKey(slot.data.name, a.name);
}

function ArtPreview({ rig, look, frameLook, action, flip, frame, playing, selKey, forceVariant, outline, r0Of, onPick, onDrag, onScale, onHover }) {
  const ref = useRef(null);
  const live = useRef({});
  live.current = { look, frameLook, action, flip, frame, playing, selKey, forceVariant, outline, r0Of, onPick, onDrag, onScale, onHover };
  const tf = useRef(null);
  const rRef = useRef(null);

  useEffect(() => {
    if (!rig) return;
    const cv = ref.current;
    const r = new CharacterRig(rig.data);
    rRef.current = r;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const v8 = new Float32Array(8);
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const p = live.current;
      if (p.playing) t += (now - last) / 1000;
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(cv.clientWidth * dpr));
      const H = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.5, Math.max(W, H) * 0.75);
      g.addColorStop(0, '#3a3530');
      g.addColorStop(1, '#1d1c1f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const sel = p.selKey;
      const force = (rr) => {
        if (!p.forceVariant || !sel || sel.startsWith('x:')) return;
        const slot = rr.skeleton.findSlot(keySlot(sel));
        if (slot) slot.setAttachment(rr.skeleton.getAttachment(slot.data.index, keyName(sel)));
      };
      try {
        tf.current = drawLook(ctx, r, { look: p.look, frameLook: p.frameLook, action: p.action, frame: p.frame, flip: p.flip, t, W, H, afterPose: force });
      } catch (e) {
        console.warn('art preview', e);
        return;
      }
      // viền bộ phận đang chọn
      if (sel && p.outline) {
        const slot = r.skeleton.findSlot(keySlot(sel));
        const a = slot?.getAttachment();
        if (slot && a instanceof spine.RegionAttachment && keyOfAttachment(r, slot, a) === sel) {
          a.computeWorldVertices(slot, v8, 0, 2);
          const T = tf.current;
          const X = (wx) => T.x + wx * T.s * (T.flip ? -1 : 1);
          const Y = (wy) => T.y - wy * T.s;
          ctx.save();
          ctx.setLineDash([6 * dpr, 4 * dpr]);
          ctx.lineWidth = 1.5 * dpr;
          ctx.strokeStyle = '#ffb347';
          ctx.beginPath();
          ctx.moveTo(X(v8[0]), Y(v8[1]));
          for (let k = 2; k < 8; k += 2) ctx.lineTo(X(v8[k]), Y(v8[k + 1]));
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rig]);

  // chuột: bấm chọn bộ phận, kéo để di chuyển, lăn để phóng to/thu nhỏ
  useEffect(() => {
    const cv = ref.current;
    const toWorld = (e) => {
      const T = tf.current;
      if (!T) return null;
      const rc = cv.getBoundingClientRect();
      const dpr = cv.width / rc.width;
      const px = (e.clientX - rc.left) * dpr;
      const py = (e.clientY - rc.top) * dpr;
      return { wx: ((px - T.x) / T.s) * (T.flip ? -1 : 1), wy: -(py - T.y) / T.s };
    };
    let drag = null;
    const down = (e) => {
      const w = toWorld(e);
      const r = rRef.current;
      if (!w || !r) return;
      const hit = hitTest(r, w.wx, w.wy);
      const p = live.current;
      if (hit && hit !== p.selKey) p.onPick(hit);
      const key = hit || p.selKey;
      if (key && (hit === key || !hit)) drag = { key, last: w, moved: false, sx: e.clientX, sy: e.clientY };
    };
    const move = (e) => {
      const r = rRef.current;
      const w = toWorld(e);
      if (!w || !r) return;
      if (!drag) {
        live.current.onHover?.(hitTest(r, w.wx, w.wy));
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      const slot = r.skeleton.findSlot(keySlot(drag.key));
      if (!slot) return;
      const b = slot.bone;
      const dwx = w.wx - drag.last.wx;
      const dwy = w.wy - drag.last.wy;
      drag.last = w;
      const det = b.a * b.d - b.b * b.c;
      if (Math.abs(det) < 1e-9) return;
      const lx = (b.d * dwx - b.b * dwy) / det;
      const ly = (-b.c * dwx + b.a * dwy) / det;
      const r0 = ((live.current.r0Of(drag.key, r) || 0) * Math.PI) / 180;
      live.current.onDrag(drag.key, Math.cos(r0) * lx + Math.sin(r0) * ly, -Math.sin(r0) * lx + Math.cos(r0) * ly);
    };
    const up = () => (drag = null);
    const wheel = (e) => {
      const k = live.current.selKey;
      if (!k) return;
      e.preventDefault();
      live.current.onScale(k, Math.exp(-e.deltaY * 0.0015));
    };
    cv.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cv.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      cv.removeEventListener('wheel', wheel);
    };
  }, []);

  return <canvas ref={ref} className="rig-preview art-preview" />;
}

// ------------------------------------------------------------------ page
const defaultBase = (cat) => (cat.characters.includes('skins/meow') ? 'skins/meow' : cat.characters[0] || '');

export function SpinePage({ rig }) {
  const art = useArt();
  const lib = useLibrary();
  const [setId, setSetId] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [selPieces, setSelPieces] = useState([]);
  const [selKey, setSelKey] = useState(null);
  const [hoverKey, setHoverKey] = useState(null);
  const [action, setAction] = useState('idle');
  const [playing, setPlaying] = useState(true);
  const [flip, setFlip] = useState(false);
  const [frame, setFrame] = useState('full');
  const [forceVariant, setForceVariant] = useState(true);
  const [outline, setOutline] = useState(true);
  const [autoAssign, setAutoAssign] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [cutOpts, setCutOpts] = useState(DEFAULT_CUT);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [extraSlot, setExtraSlot] = useState('Hat');

  const set = art.sets.find((s) => s.id === setId) || art.sets[0];
  const sheet = art.sheets.find((s) => s.id === sheetId) || art.sheets[0];
  const sheetPieces = sheet ? art.pieces.filter((p) => p.sheet === sheet.id) : [];
  const piece = art.pieces.find((p) => p.id === selPieces[selPieces.length - 1]);

  // các biến thể (attachment) của nhân vật gốc, theo ô
  const base = set?.base || (rig ? defaultBase(rig.catalog) : '');
  const plain = useMemo(() => {
    if (!rig) return [];
    const skin = new spine.Skin('plain');
    for (const n of ['default', base]) {
      const s = rig.data.findSkin(n);
      if (s) skin.addSkin(s);
    }
    return skin
      .getAttachments()
      .filter((e) => e.attachment instanceof spine.RegionAttachment)
      .map((e) => ({ slotIndex: e.slotIndex, slotName: rig.data.slots[e.slotIndex].name, name: e.name, att: e.attachment, key: partKey(rig.data.slots[e.slotIndex].name, e.name) }));
  }, [rig, base]);
  // biến thể thực sự hiện ra: đặt sẵn trong Spine hoặc được hành động bật lên
  const usedNames = useMemo(() => {
    const m = new Map();
    if (!rig) return m;
    const add = (i, n) => n && (m.get(i) || m.set(i, new Set()).get(i)).add(n);
    rig.data.slots.forEach((s) => add(s.index, s.attachmentName));
    for (const a of rig.data.animations) for (const tl of a.timelines) if (tl instanceof spine.AttachmentTimeline) for (const n of tl.attachmentNames) add(tl.slotIndex, n);
    return m;
  }, [rig]);
  // biến thể nào hiện trong hành động nào (để biết cần thay hình gì cho "ngủ", "nhảy"…)
  const usedBy = useMemo(() => {
    const m = new Map();
    if (!rig) return m;
    for (const a of rig.data.animations) {
      if (a.name === 'blink' || a.name === 'default') continue;
      for (const tl of a.timelines) {
        if (!(tl instanceof spine.AttachmentTimeline)) continue;
        for (const n of tl.attachmentNames) {
          if (!n) continue;
          const k = partKey(rig.data.slots[tl.slotIndex].name, n);
          (m.get(k) || m.set(k, new Set()).get(k)).add(a.name);
        }
      }
    }
    return m;
  }, [rig]);
  const groups = useMemo(() => {
    const out = [];
    if (!rig) return out;
    for (const sd of rig.data.slots) {
      const items = plain.filter((e) => e.slotIndex === sd.index && (showAll || usedNames.get(sd.index)?.has(e.name)));
      if (items.length) out.push({ slot: sd.name, items });
    }
    return out;
  }, [rig, plain, usedNames, showAll]);
  const plainByKey = useMemo(() => new Map(plain.map((e) => [e.key, e])), [plain]);

  if (!rig) return <div className="page-empty muted">Chưa tải bộ Spine — bấm "Thư mục Spine" ở thanh trên.</div>;
  const cat = rig.catalog;

  const usedPieces = new Set(art.sets.flatMap((s) => [...Object.values(s.parts), ...Object.values(s.extras)].map((o) => o.piece).filter(Boolean)));
  const editSet = (fn) =>
    setArt((a) => {
      const s = a.sets.find((x) => x.id === set.id);
      if (s) fn(s);
    });
  const ovOf = (s, key) => (!s || !key ? null : key.startsWith('x:') ? s.extras[key.slice(2)] : s.parts[key]);
  const editOv = (key, fn) =>
    editSet((s) => {
      const o = ovOf(s, key);
      if (o) fn(o);
    });
  const assign = (key, pieceId) => {
    if (!set || !key || !pieceId) return;
    editSet((s) => {
      if (key.startsWith('x:')) s.extras[key.slice(2)] = newOverride(pieceId);
      else s.parts[key] = newOverride(pieceId);
    });
  };
  const clearOv = (key) =>
    editSet((s) => {
      if (key.startsWith('x:')) delete s.extras[key.slice(2)];
      else delete s.parts[key];
    });
  const toggleHide = (key) =>
    editSet((s) => {
      const o = s.parts[key];
      if (o && o.hide && !o.piece) delete s.parts[key];
      else if (o) o.hide = !o.hide;
      else s.parts[key] = { ...newOverride(null), hide: true };
    });

  // ---- bộ hình
  const addSet = () => {
    const s = newArtSet(defaultBase(cat));
    s.name = 'Bộ hình ' + (art.sets.length + 1);
    setArt((a) => a.sets.push(s));
    setSetId(s.id);
  };
  const dupSet = () => {
    const s = { ...structuredClone(set), id: uid('art'), name: set.name + ' (bản sao)' };
    setArt((a) => a.sets.push(s));
    setSetId(s.id);
  };
  const delSet = () => {
    const usedBy = lib.characters.flatMap((c) => c.skins.filter((s) => s.art === set.id).map((s) => `${c.name} — ${s.name}`));
    if (!confirm(`Xoá bộ hình "${set.name}"?${usedBy.length ? `\nĐang dùng ở: ${usedBy.join(', ')} (sẽ quay về hình gốc).` : ''}`)) return;
    setArt((a) => (a.sets = a.sets.filter((x) => x.id !== set.id)));
    setSetId(null);
  };

  // ---- bảng hình
  const upload = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/webp,image/jpeg';
    inp.multiple = true;
    inp.onchange = async () => {
      const files = [...(inp.files || [])];
      let last = null;
      try {
        for (const [i, f] of files.entries()) {
          setBusy(`Đang cắt ${f.name} (${i + 1}/${files.length})…`);
          await new Promise((r) => setTimeout(r, 30)); // để chữ "đang cắt" kịp hiện
          const src = await readFile(f);
          const imgId = await addImage(src, 'sh');
          const img = await decodeImage(imgId);
          const cut = cutSheet(img, cutOpts);
          const sh = { id: uid('sheet'), name: f.name.replace(/\.[^.]+$/, ''), img: imgId, w: img.naturalWidth, h: img.naturalHeight, opts: { ...cutOpts } };
          const pcs = [];
          for (const [k, c] of cut.pieces.entries()) pcs.push({ id: uid('pc'), sheet: sh.id, name: `${sh.name} #${k + 1}`, img: await addImage(c.dataURL, 'pc'), x: c.x, y: c.y, bw: c.bw, bh: c.bh, w: c.w, h: c.h });
          setArt((a) => {
            a.sheets.push(sh);
            a.pieces.push(...pcs);
          });
          last = sh.id;
          setMsg(`"${sh.name}": cắt được ${pcs.length} mảnh.`);
        }
      } catch (e) {
        alert('Không đọc được ảnh: ' + e.message);
      } finally {
        setBusy('');
      }
      if (last) setSheetId(last);
    };
    inp.click();
  };
  const recut = async () => {
    setBusy('Đang cắt lại…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const img = await decodeImage(sheet.img);
      const cut = cutSheet(img, cutOpts);
      const keep = sheetPieces.filter((p) => usedPieces.has(p.id)); // mảnh đang dùng thì giữ lại
      const overlap = (a, b) => {
        const ix = Math.max(0, Math.min(a.x + a.bw, b.x + b.bw) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.bh, b.y + b.bh) - Math.max(a.y, b.y));
        return (ix * iy) / Math.max(1, Math.min(a.bw * a.bh, b.bw * b.bh));
      };
      const pcs = [];
      let k = sheetPieces.length;
      for (const c of cut.pieces) {
        if (keep.some((p) => overlap(p, c) > 0.85)) continue;
        pcs.push({ id: uid('pc'), sheet: sheet.id, name: `${sheet.name} #${++k}`, img: await addImage(c.dataURL, 'pc'), x: c.x, y: c.y, bw: c.bw, bh: c.bh, w: c.w, h: c.h });
      }
      setArt((a) => {
        a.pieces = a.pieces.filter((p) => p.sheet !== sheet.id || usedPieces.has(p.id)).concat(pcs);
        const s = a.sheets.find((x) => x.id === sheet.id);
        if (s) s.opts = { ...cutOpts };
      });
      collectGarbage();
      setSelPieces([]);
      setMsg(`Cắt lại: ${pcs.length} mảnh mới${keep.length ? `, giữ ${keep.length} mảnh đang dùng` : ''}.`);
    } finally {
      setBusy('');
    }
  };
  const delSheet = () => {
    const n = sheetPieces.filter((p) => usedPieces.has(p.id)).length;
    if (!confirm(`Xoá bảng hình "${sheet.name}" và ${sheetPieces.length} mảnh của nó?${n ? `\n${n} mảnh đang được dùng — các bộ phận đó sẽ quay về hình gốc.` : ''}`)) return;
    setArt((a) => {
      a.sheets = a.sheets.filter((s) => s.id !== sheet.id);
      a.pieces = a.pieces.filter((p) => p.sheet !== sheet.id);
    });
    collectGarbage();
    setSheetId(null);
    setSelPieces([]);
  };
  const pickPiece = (id, multi) => {
    if (multi) return setSelPieces((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setSelPieces([id]);
    if (autoAssign && selKey && set) assign(selKey, id);
  };
  const rectCut = async (rect) => {
    const img = await decodeImage(sheet.img);
    const c = cutRect(img, rect, sheet.opts || cutOpts);
    if (!c) return;
    const p = { id: uid('pc'), sheet: sheet.id, name: `${sheet.name} (cắt tay)`, img: await addImage(c.dataURL, 'pc'), x: c.x, y: c.y, bw: c.bw, bh: c.bh, w: c.w, h: c.h };
    setArt((a) => a.pieces.push(p));
    setSelPieces([p.id]);
  };
  const mergeSel = async () => {
    const ps = selPieces.map((id) => art.pieces.find((p) => p.id === id)).filter(Boolean);
    const imgs = await Promise.all(ps.map((p) => decodeImage(p.img)));
    const m = mergePieces(ps.map((p, i) => ({ ...p, bw: p.bw ?? p.w, bh: p.bh ?? p.h, img: imgs[i] })));
    const np = { id: uid('pc'), sheet: ps[0].sheet, name: `${ps[0].name} (gộp)`, img: await addImage(m.dataURL, 'pc'), x: m.x, y: m.y, bw: m.bw, bh: m.bh, w: m.w, h: m.h };
    const drop = new Set(ps.filter((p) => !usedPieces.has(p.id)).map((p) => p.id));
    setArt((a) => {
      a.pieces = a.pieces.filter((p) => !drop.has(p.id));
      a.pieces.push(np);
    });
    collectGarbage();
    setSelPieces([np.id]);
  };
  const delPieces = () => {
    const n = selPieces.filter((id) => usedPieces.has(id)).length;
    if (n && !confirm(`${n} mảnh đang được dùng — xoá thì các bộ phận đó quay về hình gốc. Xoá?`)) return;
    const drop = new Set(selPieces);
    setArt((a) => (a.pieces = a.pieces.filter((p) => !drop.has(p.id))));
    collectGarbage();
    setSelPieces([]);
  };

  const ov = ovOf(set, selKey);
  // các biến thể khác cùng ô (vd. thân: chính diện / quay lưng / nghiêng) đang hiện trong danh sách
  const siblings = selKey && !selKey.startsWith('x:') ? (groups.find((g) => g.slot === keySlot(selKey))?.items || []).map((e) => e.key).filter((k) => k !== selKey) : [];
  const applyToSiblings = () =>
    editSet((s) => {
      const src = s.parts[selKey];
      if (src) for (const k of siblings) s.parts[k] = { ...src };
    });
  const selPiece = ov?.piece && art.pieces.find((p) => p.id === ov.piece);
  const look = set ? { skin: set.base, art: set.id } : { skin: base };
  const actOpts = [['__setup', 'Tư thế gốc (đứng yên)'], ...actionOptions(rig, lib)];
  const r0Of = (key, r) => {
    if (key.startsWith('x:')) return r.extras?.find((e) => e.att.__key === key)?.att.__r0 || 0;
    return plainByKey.get(key)?.att.rotation || 0;
  };
  const extraSlots = rig.data.slots.map((s) => s.name);
  const extraOptions = [...EXTRA_SLOTS.filter((n) => extraSlots.includes(n)), ...extraSlots.filter((n) => !EXTRA_SLOTS.includes(n))].map((n) => [n, slotLabel(n) + (SLOT_VI[n] ? ` (${n})` : '')]);

  return (
    <div className="lib-page spine-page">
      <aside className="lib-left spine-left">
        <div className="lib-head">
          <h2>Spine — thay hình nhân vật</h2>
          <p className="muted small">
            Thay ảnh từng bộ phận (mặt, tai, thân, tay, chân…) bằng hình của bạn, <b>giữ nguyên mọi hành động</b> của {partLabel(base, lib) || 'mèo'}. ① Tải bảng hình → tự cắt
            thành mảnh. ② Chọn bộ phận (bấm lên nhân vật hoặc trong danh sách). ③ Bấm mảnh hình để gán. ④ Kéo / lăn chuột trên khung xem để chỉnh.
          </p>
        </div>

        {/* ---------------- bộ hình */}
        <section className="sp-sec">
          <h3>Bộ hình</h3>
          <div className="chips">
            {art.sets.map((s) => (
              <button key={s.id} className={s.id === set?.id ? 'chip on' : 'chip'} onClick={() => setSetId(s.id)}>
                {s.name}
              </button>
            ))}
            <button className="chip add" onClick={addSet}>
              + Bộ hình mới
            </button>
          </div>
          {set ? (
            <>
              <Field label="Tên bộ hình">
                <input value={set.name} onChange={(e) => editSet((s) => (s.name = e.target.value))} />
              </Field>
              <Field label="Nhân vật gốc (lấy xương + hành động)">
                <PartPicker value={set.base} options={cat.characters.map((n) => [n, partLabel(n, lib)])} onChange={(v) => editSet((s) => (s.base = v))} />
              </Field>
              <Field label="Co giãn mảnh hình" hint={set.fit === 'sheet' ? 'Mọi mảnh trên cùng một bảng dùng chung một tỉ lệ → giữ đúng tỉ lệ đầu / thân / tay như trên bảng vẽ.' : 'Mỗi mảnh được co cho vừa khung bộ phận gốc của mèo.'}>
                <Select
                  value={set.fit}
                  options={[
                    ['part', 'Vừa khít từng bộ phận gốc'],
                    ['sheet', 'Giữ tỉ lệ như trên bảng hình'],
                  ]}
                  onChange={(v) => editSet((s) => (s.fit = v))}
                />
              </Field>
              <Field label="Tỉ lệ chung">
                <Range value={set.scale ?? 1} min={0.3} max={3} step={0.01} onChange={(v) => editSet((s) => (s.scale = v))} fmt={(v) => v.toFixed(2) + '×'} />
              </Field>
              <div className="row">
                <button onClick={dupSet}>Nhân bản</button>
                <button className="danger" onClick={delSet}>
                  Xoá
                </button>
                <div className="spacer" />
                <button onClick={() => exportArtFile([set.id])} title="Lưu bộ hình (kèm ảnh) ra file để mang sang máy khác">
                  Xuất…
                </button>
                <button
                  onClick={async () => {
                    try {
                      const r = await importArtFile();
                      if (r) setMsg('Đã nhập ' + r);
                    } catch (e) {
                      alert(e.message);
                    }
                  }}
                >
                  Nhập…
                </button>
              </div>
              <p className="muted small">Dùng bộ hình: ở trang Thư viện nhân vật (mục skin) hoặc bảng Nhân vật khi dựng clip → chọn “Bộ hình Spine”.</p>
            </>
          ) : (
            <p className="muted">
              Bấm <b>+ Bộ hình mới</b> để bắt đầu.{' '}
              <button className="linkish" onClick={async () => importArtFile().then((r) => r && setMsg('Đã nhập ' + r)).catch((e) => alert(e.message))}>
                Hoặc nhập từ file…
              </button>
            </p>
          )}
          {msg && <p className="ok small">{msg}</p>}
        </section>

        {/* ---------------- bảng hình */}
        <section className="sp-sec">
          <h3>Bảng hình</h3>
          <div className="chips">
            {art.sheets.map((s) => (
              <button key={s.id} className={s.id === sheet?.id ? 'chip on' : 'chip'} onClick={() => (setSheetId(s.id), setSelPieces([]))}>
                {s.name}
              </button>
            ))}
            <button className="chip add" onClick={upload} disabled={!!busy}>
              + Tải bảng hình…
            </button>
          </div>
          {busy && <p className="small accent">{busy}</p>}
          {sheet && (
            <>
              <SheetView sheet={sheet} pieces={sheetPieces} sel={selPieces} used={usedPieces} onPick={pickPiece} onRect={rectCut} />
              <p className="muted small">
                Bấm khung để chọn mảnh{selKey ? (autoAssign ? ` → gán ngay cho “${keyLabel(selKey)}”` : '') : ''}. Shift+bấm chọn nhiều để gộp. Kéo chuột trên chỗ trống để tự cắt một vùng.
              </p>
              <label className="check">
                <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} /> Bấm mảnh là gán ngay cho bộ phận đang chọn
              </label>
              {selPieces.length > 0 && (
                <div className="row sel-pieces">
                  {selPieces.slice(0, 6).map((id) => (
                    <PieceImg key={id} piece={art.pieces.find((p) => p.id === id)} size={44} />
                  ))}
                  <div className="spacer" />
                  {selPieces.length > 1 && <button onClick={mergeSel}>Gộp {selPieces.length} mảnh</button>}
                  {selPieces.length === 1 && selKey && set && <button onClick={() => assign(selKey, selPieces[0])}>Gán</button>}
                  <button className="danger" onClick={delPieces}>
                    Xoá mảnh
                  </button>
                </div>
              )}
              <details className="sp-cut">
                <summary>Tuỳ chọn cắt</summary>
                <Field label="Độ lệch màu nền" hint="Tăng nếu còn sót viền nền; giảm nếu bị ăn mất phần sáng màu.">
                  <Range value={cutOpts.tol} min={5} max={120} onChange={(v) => setCutOpts({ ...cutOpts, tol: v })} />
                </Field>
                <Field label="Gộp mảnh gần nhau (px)" hint="Tăng để các chi tiết rời (lông mày, nơ…) dính vào mảnh chính.">
                  <Range value={cutOpts.merge} min={0} max={30} onChange={(v) => setCutOpts({ ...cutOpts, merge: v })} />
                </Field>
                <Field label="Tách hình dính nhau (px)" hint="Khi nhiều hình chạm nhau bị gộp thành một (vd. các đầu đứng sát nhau): tăng lên 3–8. Khi bật, “Gộp mảnh gần nhau” không dùng.">
                  <Range value={cutOpts.split || 0} min={0} max={20} onChange={(v) => setCutOpts({ ...cutOpts, split: v })} fmt={(v) => (v ? v : 'tắt')} />
                </Field>
                <Field label="Bỏ mảnh nhỏ hơn (px²)">
                  <Range value={cutOpts.minArea} min={0} max={2000} step={10} onChange={(v) => setCutOpts({ ...cutOpts, minArea: v })} />
                </Field>
                <label className="check">
                  <input type="checkbox" checked={cutOpts.inner} onChange={(e) => setCutOpts({ ...cutOpts, inner: e.target.checked })} /> Xoá cả nền bên trong (tròng kính…)
                </label>
                <div className="row">
                  <button onClick={recut} disabled={!!busy}>
                    Cắt lại bảng này
                  </button>
                  <div className="spacer" />
                  <button className="danger" onClick={delSheet}>
                    Xoá bảng hình
                  </button>
                </div>
              </details>
            </>
          )}
          {!art.sheets.length && <p className="muted small">Tải ảnh PNG/WebP chứa nhiều bộ phận (nền trong suốt hoặc nền trắng). Ứng dụng tự tách từng mảnh.</p>}
        </section>

        {/* ---------------- bộ phận */}
        {set && (
          <section className="sp-sec">
            <h3>
              Bộ phận của {partLabel(set.base, lib)}
              <label className="check small sp-all">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Hiện cả biến thể ít dùng
              </label>
            </h3>
            {groups.map((g) => (
              <div key={g.slot} className="sp-group">
                <div className="sp-slot">{slotLabel(g.slot)}</div>
                {g.items.map((e) => {
                  const o = set.parts[e.key];
                  const pc = o?.piece && art.pieces.find((p) => p.id === o.piece);
                  return (
                    <div key={e.key} className={'sp-part' + (selKey === e.key ? ' on' : '') + (hoverKey === e.key ? ' hover' : '')} onClick={() => setSelKey(e.key)}>
                      <AttThumb att={e.att} />
                      <span
                        className="grow"
                        title={`${e.name}${rig.data.slots[e.slotIndex].attachmentName === e.name ? ' · hiện mặc định' : ''}${usedBy.get(e.key) ? ' · dùng trong: ' + [...usedBy.get(e.key)].join(', ') : ''}`}
                      >
                        {varLabel(e.name)}
                        {rig.data.slots[e.slotIndex].attachmentName !== e.name && <small className="muted"> · {usedBy.get(e.key) ? [...usedBy.get(e.key)].slice(0, 3).join(', ') + (usedBy.get(e.key).size > 3 ? '…' : '') : 'ít dùng'}</small>}
                      </span>
                      <span className="muted">→</span>
                      {o?.hide ? <span className="piece-img empty hidden-tag">ẩn</span> : <PieceImg piece={pc} />}
                      <button
                        className="mini"
                        title={o?.hide ? 'Hiện lại bộ phận' : 'Ẩn bộ phận này'}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleHide(e.key);
                        }}
                      >
                        {o?.hide ? 'Hiện' : 'Ẩn'}
                      </button>
                      <button
                        className="mini"
                        title="Bỏ thay hình (về hình gốc)"
                        disabled={!o}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          clearOv(e.key);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        )}

        {/* ---------------- phụ kiện gắn thêm */}
        {set && (
          <section className="sp-sec">
            <h3>Gắn thêm phụ kiện</h3>
            <p className="muted small">Mũ, kính, váy, túi… gắn vào một ô của xương, tự cử động theo nhân vật.</p>
            <div className="row">
              <Select value={extraSlot} options={extraOptions} onChange={setExtraSlot} />
              <button
                disabled={!piece}
                onClick={() => {
                  assign('x:' + extraSlot, piece.id);
                  setSelKey('x:' + extraSlot);
                }}
              >
                Gắn mảnh đang chọn
              </button>
            </div>
            {Object.entries(set.extras).map(([slot, o]) => (
              <div key={slot} className={'sp-part' + (selKey === 'x:' + slot ? ' on' : '')} onClick={() => setSelKey('x:' + slot)}>
                <PieceImg piece={art.pieces.find((p) => p.id === o.piece)} />
                <span className="grow">{slotLabel(slot)}</span>
                <button
                  className="mini"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    clearOv('x:' + slot);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </section>
        )}
      </aside>

      <section className="lib-right">
        <div className="lib-preview-head">
          <Select value={action} options={actOpts} onChange={setAction} />
          <button onClick={() => setPlaying(!playing)}>{playing ? '⏸ Dừng' : '▶ Chạy'}</button>
          <Select
            value={frame}
            options={[
              ['full', 'Toàn thân'],
              ['head', 'Phóng to mặt'],
            ]}
            onChange={setFrame}
          />
          <label className="check">
            <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} /> Lật
          </label>
          <label className="check" title="Luôn hiện biến thể đang chọn (vd. mắt nhắm) dù hành động không dùng tới">
            <input type="checkbox" checked={forceVariant} onChange={(e) => setForceVariant(e.target.checked)} /> Ép hiện biến thể đang chọn
          </label>
          <label className="check">
            <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> Viền
          </label>
          <div className="spacer" />
          <span className="muted small">{hoverKey ? keyLabel(hoverKey) : 'Bấm lên nhân vật để chọn bộ phận'}</span>
        </div>
        <ArtPreview
          rig={rig}
          look={look}
          frameLook={{ skin: look.skin }}
          action={action}
          flip={flip}
          frame={frame}
          playing={playing}
          selKey={selKey}
          forceVariant={forceVariant}
          outline={outline}
          r0Of={r0Of}
          onPick={setSelKey}
          onHover={setHoverKey}
          onDrag={(key, dx, dy) =>
            editOv(key, (o) => {
              o.dx = (o.dx || 0) + dx;
              o.dy = (o.dy || 0) + dy;
            })
          }
          onScale={(key, f) => editOv(key, (o) => (o.scale = Math.min(8, Math.max(0.05, (o.scale || 1) * f))))}
        />
        <div className="sp-edit">
          {!set ? (
            <span className="muted">Tạo một bộ hình để bắt đầu thay hình.</span>
          ) : !selKey ? (
            <span className="muted">Chọn một bộ phận để thay hình.</span>
          ) : (
            <>
              <div className="sp-edit-head">
                {!selKey.startsWith('x:') && plainByKey.get(selKey) && <AttThumb att={plainByKey.get(selKey).att} size={48} />}
                <span className="muted">→</span>
                {ov?.hide ? <span className="piece-img empty hidden-tag">ẩn</span> : <PieceImg piece={selPiece} size={48} />}
                <b className="grow">{keyLabel(selKey)}</b>
                {piece && !(ov && ov.piece === piece.id) && (
                  <button className="primary" onClick={() => assign(selKey, piece.id)}>
                    Gán mảnh đang chọn
                  </button>
                )}
                {!selKey.startsWith('x:') && <button onClick={() => toggleHide(selKey)}>{ov?.hide ? 'Hiện lại' : 'Ẩn bộ phận'}</button>}
                {ov && <button onClick={() => clearOv(selKey)}>Về hình gốc</button>}
              </div>
              {ov && ov.piece && !ov.hide ? (
                <div className="sp-edit-grid">
                  <Field label="Kích thước">
                    <Range value={ov.scale ?? 1} min={0.05} max={4} step={0.01} onChange={(v) => editOv(selKey, (o) => (o.scale = v))} fmt={(v) => v.toFixed(2) + '×'} />
                  </Field>
                  <Field label="Xoay">
                    <Range value={ov.rot ?? 0} min={-180} max={180} step={1} onChange={(v) => editOv(selKey, (o) => (o.rot = v))} fmt={(v) => Math.round(v) + '°'} />
                  </Field>
                  <Field label="Ngang">
                    <Range value={ov.dx ?? 0} min={-400} max={400} step={1} onChange={(v) => editOv(selKey, (o) => (o.dx = v))} fmt={(v) => Math.round(v)} />
                  </Field>
                  <Field label="Dọc">
                    <Range value={ov.dy ?? 0} min={-400} max={400} step={1} onChange={(v) => editOv(selKey, (o) => (o.dy = v))} fmt={(v) => Math.round(v)} />
                  </Field>
                  <label className="check">
                    <input type="checkbox" checked={!!ov.flip} onChange={(e) => editOv(selKey, (o) => (o.flip = e.target.checked))} /> Lật mảnh
                  </label>
                  <label className="check" title="Một mảnh thành hai bên đối xứng — dùng cho mắt, má hồng khi bảng hình chỉ vẽ 1 bên">
                    <input type="checkbox" checked={!!ov.pair} onChange={(e) => editOv(selKey, (o) => (o.pair = e.target.checked))} /> Nhân đôi đối xứng (2 mắt / 2 má)
                  </label>
                  {ov.pair && (
                    <Field label="Khoảng cách hai bên">
                      <Range value={ov.gap ?? 0} min={-200} max={600} step={1} onChange={(v) => editOv(selKey, (o) => (o.gap = v))} fmt={(v) => Math.round(v) + ' px'} />
                    </Field>
                  )}
                  <button onClick={() => editOv(selKey, (o) => Object.assign(o, { scale: 1, dx: 0, dy: 0, rot: 0 }))}>Đặt lại vị trí</button>
                  {!selKey.startsWith('x:') && siblings.length > 0 && (
                    <button title={`Dùng cùng mảnh hình + vị trí cho: ${siblings.map((k) => varLabel(keyName(k))).join(', ')}`} onClick={applyToSiblings}>
                      Áp cho mọi biến thể của {slotLabel(keySlot(selKey))} ({siblings.length})
                    </button>
                  )}
                  <span className="muted small">Mẹo: kéo bộ phận trên khung xem để di chuyển, lăn chuột để phóng to / thu nhỏ.</span>
                </div>
              ) : (
                !ov?.hide && <span className="muted small">Chưa gán hình — bấm một mảnh trên bảng hình{autoAssign ? '' : ' rồi bấm “Gán mảnh đang chọn”'}.</span>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
