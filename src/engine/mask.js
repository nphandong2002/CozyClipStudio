// Mask (khoanh vùng) cho vật thể ảnh / GIF / video — giống Mask Path của Premiere Pro.
//
// mask = { points: [{ u, v, smooth }], enabled, feather, expand, invert }
//   u, v    : vị trí điểm neo trong khung ảnh, 0..1 (0,0 = góc trên trái; 1,1 = góc dưới phải)
//   smooth  : true → đường đi qua điểm này cong mượt; false → góc nhọn
//   feather : độ mềm biên (px thiết kế)
//   expand  : mở rộng (+) / thu hẹp (−) vùng mask (px thiết kế)
//   invert  : giữ phần NGOÀI đường viền thay vì phần trong

export const MASK_DEFAULTS = { enabled: true, feather: 0, expand: 0, invert: false };

export const maskActive = (m) => !!m && m.enabled !== false && Array.isArray(m.points) && m.points.length >= 3;

/** Points of the mask in the media's local drawing space (rect −w/2..w/2 × −h..0). */
export function maskLocalPoints(m, w, h) {
  return m.points.map((p) => ({ x: (p.u - 0.5) * w, y: (p.v - 1) * h, smooth: !!p.smooth }));
}

/**
 * Closed path through `pts` ({x, y, smooth}). Smooth points get Catmull-Rom tangents,
 * sharp points none, so a polygon with every point sharp is just straight lines.
 */
export function tracePath(ctx, pts) {
  const n = pts.length;
  if (n < 2) return;
  const P = (i) => pts[(i + n) % n];
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const a = P(i);
    const b = P(i + 1);
    const ta = a.smooth ? { x: (b.x - P(i - 1).x) / 6, y: (b.y - P(i - 1).y) / 6 } : { x: 0, y: 0 };
    const tb = b.smooth ? { x: (P(i + 2).x - a.x) / 6, y: (P(i + 2).y - a.y) / 6 } : { x: 0, y: 0 };
    ctx.bezierCurveTo(a.x + ta.x, a.y + ta.y, b.x - tb.x, b.y - tb.y, b.x, b.y);
  }
  ctx.closePath();
}

/** Points sampled along the closed path (for hit-testing the outline). seg = index of the segment. */
export function samplePath(pts, per = 16) {
  const n = pts.length;
  const out = [];
  const P = (i) => pts[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const a = P(i);
    const b = P(i + 1);
    const ta = a.smooth ? { x: (b.x - P(i - 1).x) / 6, y: (b.y - P(i - 1).y) / 6 } : { x: 0, y: 0 };
    const tb = b.smooth ? { x: (P(i + 2).x - a.x) / 6, y: (P(i + 2).y - a.y) / 6 } : { x: 0, y: 0 };
    const c1 = { x: a.x + ta.x, y: a.y + ta.y };
    const c2 = { x: b.x - tb.x, y: b.y - tb.y };
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const s = 1 - t;
      out.push({
        x: s * s * s * a.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t * t * t * b.x,
        y: s * s * s * a.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t * t * t * b.y,
        seg: i,
      });
    }
  }
  return out;
}

export function rectMask() {
  return { ...MASK_DEFAULTS, points: [{ u: 0.1, v: 0.1 }, { u: 0.9, v: 0.1 }, { u: 0.9, v: 0.9 }, { u: 0.1, v: 0.9 }].map((p) => ({ ...p, smooth: false })) };
}
export function ellipseMask() {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    pts.push({ u: 0.5 + Math.cos(a) * 0.4, v: 0.5 + Math.sin(a) * 0.4, smooth: true });
  }
  return { ...MASK_DEFAULTS, points: pts };
}

// ------------------------------------------------------------------ drawing
const caches = new Map(); // key -> { sharp, soft, content, stamp }
const MAX_PX = 2048;

function canvas2(w, h, c) {
  c = c || document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Draw `src` into the rect (−w/2, −h, w, h) of ctx through the mask.
 * Rendered offscreen at the destination's real pixel size; the (blurred) mask is cached
 * until the mask or the size changes, so video frames only cost one composite each.
 */
export function drawMasked(ctx, src, m, w, h, key) {
  const t = ctx.getTransform();
  const sx = Math.hypot(t.a, t.b) || 1;
  const sy = Math.hypot(t.c, t.d) || 1;
  const k = Math.min(1, MAX_PX / Math.max(w * sx, h * sy));
  const W = Math.max(1, Math.round(w * sx * k));
  const H = Math.max(1, Math.round(h * sy * k));
  const px = (W / w + H / h) / 2; // offscreen px per local unit
  const ck = `${key}@${W}x${H}`; // khung xem trước và bản xuất có kích thước khác nhau → cache riêng
  let c = caches.get(ck);
  if (!c) caches.set(ck, (c = {}));
  const stamp = JSON.stringify([m.points, m.feather, m.expand, m.invert, W, H]);
  if (c.stamp !== stamp) {
    // 1) sharp mask: path (+ expand / − shrink) — 2) blurred copy for feathering
    const sharp = (c.sharp = canvas2(W, H, c.sharp));
    const g = sharp.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(W / w, 0, 0, H / h, W / 2, H); // local (−w/2..w/2, −h..0) → offscreen px
    g.beginPath();
    tracePath(g, maskLocalPoints(m, w, h));
    g.fillStyle = '#fff';
    g.fill();
    const ex = (m.expand || 0) * 2;
    if (ex) {
      g.lineJoin = 'round';
      g.lineWidth = Math.abs(ex);
      g.strokeStyle = '#fff';
      if (ex < 0) g.globalCompositeOperation = 'destination-out';
      g.stroke();
      g.globalCompositeOperation = 'source-over';
    }
    if (m.invert) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'xor';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    const soft = (c.soft = canvas2(W, H, c.soft));
    const sg = soft.getContext('2d');
    sg.clearRect(0, 0, W, H);
    const f = Math.max(0, m.feather || 0) * px;
    sg.filter = f > 0.3 ? `blur(${(f / 2).toFixed(2)}px)` : 'none';
    sg.drawImage(sharp, 0, 0);
    sg.filter = 'none';
    c.stamp = stamp;
  }
  const content = (c.content = canvas2(W, H, c.content));
  const cg = content.getContext('2d');
  cg.globalCompositeOperation = 'source-over';
  cg.clearRect(0, 0, W, H);
  cg.drawImage(src, 0, 0, W, H);
  cg.globalCompositeOperation = 'destination-in';
  cg.drawImage(c.soft, 0, 0);
  cg.globalCompositeOperation = 'source-over';
  ctx.drawImage(content, -w / 2, -h, w, h);
}

/** Forget cached canvases of props that no longer exist. */
export function pruneMaskCache(liveKeys) {
  for (const k of [...caches.keys()]) if (!liveKeys.has(k.split('@')[0])) caches.delete(k);
}
