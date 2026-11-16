// Xem trước nhân vật Spine: khung động lớn + ảnh thu nhỏ tĩnh (vẽ theo hàng đợi để không giật).
import React, { useEffect, useRef } from 'react';
import * as spine from '@esotericsoftware/spine-canvas';
import { CharacterRig } from '../engine/character.js';

// Mỗi SkeletonData dùng một rig riêng cho xem trước, không đụng tới rig của khung hình chính.
const rigCache = new WeakMap();
function previewRig(rig, slot) {
  let m = rigCache.get(rig.data);
  if (!m) rigCache.set(rig.data, (m = {}));
  if (!m[slot]) m[slot] = new CharacterRig(rig.data);
  return m[slot];
}

const tmpOff = new spine.Vector2();
const tmpSize = new spine.Vector2();

/** World-space box of every attachment hanging off the 'head' bone (face, eyes, ears, mask). */
function headBox(sk) {
  const root = sk.findBone('head');
  if (!root) return null;
  const underHead = (bone) => {
    for (let b = bone; b; b = b.parent) if (b === root) return true;
    return false;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const slot of sk.drawOrder) {
    if (!slot.bone.active || !underHead(slot.bone)) continue;
    const a = slot.getAttachment();
    let v;
    if (a instanceof spine.RegionAttachment) {
      v = new Float32Array(8);
      a.computeWorldVertices(slot, v, 0, 2);
    } else if (a instanceof spine.MeshAttachment) {
      v = new Float32Array(a.worldVerticesLength);
      a.computeWorldVertices(slot, 0, a.worldVerticesLength, v, 0, 2);
    } else continue;
    for (let i = 0; i < v.length; i += 2) {
      x0 = Math.min(x0, v[i]);
      x1 = Math.max(x1, v[i]);
      y0 = Math.min(y0, v[i + 1]);
      y1 = Math.max(y1, v[i + 1]);
    }
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Bounds (world units) of the character in its idle pose for this look; cached per look. */
function lookBounds(r, look) {
  r.setLook(look);
  const key = r.lookKey;
  r._bounds = r._bounds || {};
  if (r._bounds[key]) return r._bounds[key];
  r.pose('idle', 0, r.cycleDuration('idle'), { blink: false });
  r.skeleton.getBounds(tmpOff, tmpSize, []);
  let b = { x: tmpOff.x, y: tmpOff.y, w: tmpSize.x, h: tmpSize.y };
  if (!isFinite(b.w) || b.w <= 0 || !isFinite(b.h) || b.h <= 0) b = { x: -200, y: 0, w: 400, h: 500 };
  b.head = headBox(r.skeleton) || { x: b.x + b.w * 0.2, y: b.y + b.h * 0.45, w: b.w * 0.6, h: b.h * 0.55 };
  r._bounds[key] = b;
  return b;
}

/**
 * Draw one frame of `look` doing `action` at time t (s) into ctx (W×H).
 * frame: 'full' (whole body) or 'head' (zoom on the face, for eyes).
 */
export function drawLook(ctx, r, { look, action = 'idle', t = 0, frame = 'full', W, H, flip = false }) {
  const b = lookBounds(r, look);
  r.setLook(look, action);
  const L = r.cycleDuration(action);
  r.pose(action, ((t % L) + L) % L, L, { seed: 7, blink: frame !== 'head' }); // xem mặt → không chớp để thấy rõ mắt
  let s, x, y;
  if (frame === 'head') {
    const h = b.head;
    s = Math.min((W * 0.9) / h.w, (H * 0.9) / h.h);
    x = W / 2 - (h.x + h.w / 2) * s;
    y = H / 2 + (h.y + h.h / 2) * s;
  } else {
    s = Math.min((W * 0.78) / b.w, (H * 0.8) / b.h);
    x = W / 2 - (b.x + b.w / 2) * s;
    y = H * 0.5 + (b.y + b.h / 2) * s;
    // bóng dưới chân
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(W / 2, y - b.y * s, b.w * s * 0.42, Math.max(4, b.w * s * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (flip) x = W - x;
  r.draw(ctx, x, y, s, flip);
}

function paintBg(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#3a3530');
  g.addColorStop(1, '#1d1c1f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Animated preview canvas. */
export function RigPreview({ rig, look, action = 'idle', frame = 'full', flip = false, className = 'rig-preview', playing = true }) {
  const ref = useRef(null);
  const props = useRef({});
  props.current = { look, action, frame, flip, playing };

  useEffect(() => {
    if (!rig) return;
    const cv = ref.current;
    const r = new CharacterRig(rig.data); // mỗi khung động một rig riêng
    let raf = 0;
    const t0 = performance.now();
    let tPaused = 0;
    let last = t0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const p = props.current;
      if (!p.playing) tPaused += now - last;
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
      paintBg(ctx, W, H);
      try {
        drawLook(ctx, r, { look: p.look, action: p.action, frame: p.frame, flip: p.flip, t: (now - t0 - tPaused) / 1000, W, H });
      } catch (e) {
        console.warn('preview', e);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rig]);

  return <canvas ref={ref} className={className} />;
}

// ------------------------------------------------------------------ thumbnails
const queue = [];
let pumping = false;
let offscreen = null;

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const until = performance.now() + 10; // ~10ms mỗi khung để UI không giật
    while (queue.length && performance.now() < until) {
      const job = queue.shift();
      if (!job.cancelled) {
        try {
          job.run();
        } catch (e) {
          console.warn('thumb', e);
        }
      }
    }
    if (queue.length) requestAnimationFrame(step);
    else pumping = false;
  };
  requestAnimationFrame(step);
}

/** Static thumbnail, rendered lazily through a shared queue. */
export function RigThumb({ rig, look, action = 'idle', frame = 'full', t = 0.35, size = 112 }) {
  const ref = useRef(null);
  const key = JSON.stringify([look, action, frame, t, size]);
  useEffect(() => {
    if (!rig) return;
    const cv = ref.current;
    const job = {
      run() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.round(size * dpr);
        const H = W;
        if (!offscreen) offscreen = document.createElement('canvas');
        offscreen.width = W;
        offscreen.height = H;
        const octx = offscreen.getContext('2d');
        octx.setTransform(1, 0, 0, 1, 0, 0);
        paintBg(octx, W, H);
        const r = previewRig(rig, 'thumb');
        // t là tỉ lệ trong một vòng hành động → chọn khung giữa động tác cho dễ nhận ra
        drawLook(octx, r, { look, action, frame, t: t * r.cycleDuration(action), W, H });
        cv.width = W;
        cv.height = H;
        cv.getContext('2d').drawImage(offscreen, 0, 0);
      },
    };
    queue.push(job);
    pump();
    return () => {
      job.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, key]);
  return <canvas ref={ref} className="rig-thumb" style={{ width: size, height: size }} />;
}
