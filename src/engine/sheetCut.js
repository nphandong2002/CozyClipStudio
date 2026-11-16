// Cắt bảng hình (sprite sheet) thành từng mảnh: tách nền (trong suốt hoặc nền trắng/màu
// đồng nhất), tìm các vùng liền nhau, mỗi vùng thành một ảnh PNG có nền trong suốt.

export const DEFAULT_CUT = { tol: 40, merge: 4, split: 0, inner: false, minArea: 60 };
const MAX_SIDE = 4096;

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Không đọc được ảnh'));
    img.src = src;
  });
}

/** Sheet → ImageData with the background made transparent. */
export function removeBackground(img, opts = {}) {
  const { tol, inner } = { ...DEFAULT_CUT, ...opts };
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * k));
  const H = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const N = W * H;

  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 20) clear++;
  if (clear / N > 0.02) return { data: id, W, H, scale: k, transparent: true }; // đã có nền trong suốt

  // màu nền = trung vị các điểm ở viền ảnh
  const border = [];
  for (let x = 0; x < W; x++) border.push(x, x + (H - 1) * W);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  const med = (c) => {
    const a = border.map((p) => d[p * 4 + c]).sort((x, y) => x - y);
    return a[a.length >> 1];
  };
  const bg = [med(0), med(1), med(2)];
  const dist = (p) => Math.max(Math.abs(d[p * 4] - bg[0]), Math.abs(d[p * 4 + 1] - bg[1]), Math.abs(d[p * 4 + 2] - bg[2]));

  const isBg = new Uint8Array(N);
  if (inner) {
    for (let p = 0; p < N; p++) if (dist(p) < tol) isBg[p] = 1;
  } else {
    // loang từ viền: chỉ xoá nền nối ra ngoài, giữ phần trắng bên trong (lòng trắng mắt…)
    const q = new Int32Array(N);
    let h = 0;
    let t = 0;
    for (const p of border) if (!isBg[p] && dist(p) < tol) (isBg[p] = 1), (q[t++] = p);
    while (h < t) {
      const p = q[h++];
      const x = p % W;
      const y = (p - x) / W;
      if (x > 0 && !isBg[p - 1] && dist(p - 1) < tol) (isBg[p - 1] = 1), (q[t++] = p - 1);
      if (x < W - 1 && !isBg[p + 1] && dist(p + 1) < tol) (isBg[p + 1] = 1), (q[t++] = p + 1);
      if (y > 0 && !isBg[p - W] && dist(p - W) < tol) (isBg[p - W] = 1), (q[t++] = p - W);
      if (y < H - 1 && !isBg[p + W] && dist(p + W) < tol) (isBg[p + W] = 1), (q[t++] = p + W);
    }
  }
  for (let p = 0; p < N; p++) {
    if (isBg[p]) {
      d[p * 4 + 3] = 0;
      continue;
    }
    // làm mềm viền: điểm sát nền mà màu gần nền → bán trong suốt (bớt viền trắng)
    const x = p % W;
    const nearBg = (x > 0 && isBg[p - 1]) || (x < W - 1 && isBg[p + 1]) || (p >= W && isBg[p - W]) || (p < N - W && isBg[p + W]);
    if (nearBg) {
      const a = Math.min(1, Math.max(0, (dist(p) - tol * 0.5) / (tol * 2)));
      d[p * 4 + 3] = Math.round(d[p * 4 + 3] * a);
    }
  }
  return { data: id, W, H, scale: k, transparent: false };
}

/** Square dilation of a 0/1 mask by r pixels (two separable passes with prefix sums). */
function dilate(mask, W, H, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  const pre = new Int32Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y++) {
    pre[0] = 0;
    for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + mask[y * W + x];
    for (let x = 0; x < W; x++) tmp[y * W + x] = pre[Math.min(W, x + r + 1)] - pre[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < W; x++) {
    pre[0] = 0;
    for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + tmp[y * W + x];
    for (let y = 0; y < H; y++) out[y * W + x] = pre[Math.min(H, y + r + 1)] - pre[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

function pieceCanvas(src, W, x0, y0, w, h, keep) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(w, h);
  const s = src.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y0 + y) * W + (x0 + x);
      if (keep && !keep(p)) continue;
      const o = (y * w + x) * 4;
      out.data[o] = s[p * 4];
      out.data[o + 1] = s[p * 4 + 1];
      out.data[o + 2] = s[p * 4 + 2];
      out.data[o + 3] = s[p * 4 + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  return cv;
}

/** 8-connected labels of a 0/1 mask. Returns { lab, n }. */
function label(mask, W, H) {
  const N = W * H;
  const lab = new Int32Array(N);
  const q = new Int32Array(N);
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (!mask[s] || lab[s]) continue;
    n++;
    let h = 0;
    let t = 0;
    lab[s] = n;
    q[t++] = s;
    while (h < t) {
      const p = q[h++];
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const pp = yy * W + xx;
          if (mask[pp] && !lab[pp]) {
            lab[pp] = n;
            q[t++] = pp;
          }
        }
      }
    }
  }
  return { lab, n };
}

/**
 * Tách các hình chạm nhau: bào mỏng mặt nạ r px (chỗ nối mảnh biến mất), gắn nhãn,
 * rồi loang nhãn ngược lại ra toàn bộ hình. Phần quá mảnh bị bào mất thì gắn nhãn riêng.
 */
function splitLabels(fg, W, H, r) {
  const N = W * H;
  const inv = new Uint8Array(N);
  for (let p = 0; p < N; p++) inv[p] = fg[p] ? 0 : 1;
  const grownBg = dilate(inv, W, H, r);
  const core = new Uint8Array(N);
  for (let p = 0; p < N; p++) core[p] = fg[p] && !grownBg[p] ? 1 : 0;
  const { lab, n: n0 } = label(core, W, H);
  const q = new Int32Array(N);
  let h = 0;
  let t = 0;
  for (let p = 0; p < N; p++) if (lab[p]) q[t++] = p;
  while (h < t) {
    const p = q[h++];
    const x = p % W;
    const L = lab[p];
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
    for (const pp of nb) {
      if (pp < 0 || pp >= N || !fg[pp] || lab[pp]) continue;
      lab[pp] = L;
      q[t++] = pp;
    }
  }
  // phần còn lại (nét mảnh như miệng, lông mày) → vùng riêng
  const rest = new Uint8Array(N);
  let any = false;
  for (let p = 0; p < N; p++) if (fg[p] && !lab[p]) (rest[p] = 1), (any = true);
  let n = n0;
  if (any) {
    const r2 = label(rest, W, H);
    for (let p = 0; p < N; p++) if (r2.lab[p]) lab[p] = n0 + r2.lab[p];
    n += r2.n;
  }
  return { lab, n };
}

const bgCache = new WeakMap();
function backgroundRemoved(img, o) {
  const key = JSON.stringify([o.tol, o.inner]);
  const c = bgCache.get(img);
  if (c && c.key === key) return c.v;
  const v = removeBackground(img, o);
  bgCache.set(img, { key, v });
  return v;
}

/** Background removal + component labels (shared by auto cut and rectangle cut). */
function labelSheet(img, opts) {
  const o = { ...DEFAULT_CUT, ...opts };
  const bgr = backgroundRemoved(img, o);
  const { W, H, scale } = bgr;
  const d = bgr.data.data;
  const N = W * H;
  const fg = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (d[p * 4 + 3] > 24) fg[p] = 1;
  const split = Math.round((o.split || 0) * scale);
  const { lab, n } = split > 0 ? splitLabels(fg, W, H, split) : label(dilate(fg, W, H, Math.round(o.merge * scale)), W, H);
  const box = Array.from({ length: n + 1 }, () => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0 }));
  for (let p = 0; p < N; p++) {
    if (!fg[p]) continue;
    const b = box[lab[p]];
    const x = p % W;
    const y = (p - x) / W;
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
    b.area++;
  }
  return { o, bgr, W, H, scale, fg, lab, n, box };
}

/**
 * Split a sheet into pieces. Returns { pieces: [{ x, y, bw, bh, w, h, dataURL }] }:
 * x/y/bw/bh in the ORIGINAL sheet pixel space, w/h = piece image pixels; sorted row by row.
 */
export function cutSheet(img, opts = {}) {
  const { o, bgr, W, H, scale, lab, n, box } = labelSheet(img, opts);
  const minArea = o.minArea * scale * scale;
  const list = [];
  for (let i = 1; i <= n; i++) {
    const b = box[i];
    if (b.area < minArea) continue;
    list.push({ id: i, ...b, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 });
  }
  // sắp theo hàng: hai mảnh cùng hàng nếu tâm dọc lệch nhau < 0.6 chiều cao trung vị
  const hs = list.map((b) => b.y1 - b.y0).sort((a, b) => a - b);
  const rowH = Math.max(8, (hs[hs.length >> 1] || 40) * 0.6);
  list.sort((a, b) => a.cy - b.cy);
  let row = 0;
  let rowY = -Infinity;
  for (const b of list) {
    if (b.cy - rowY > rowH) {
      row++;
      rowY = b.cy;
    }
    b.row = row;
  }
  list.sort((a, b) => a.row - b.row || a.cx - b.cx);

  const pieces = list.map((b) => {
    const pad = 2;
    const x0 = Math.max(0, b.x0 - pad);
    const y0 = Math.max(0, b.y0 - pad);
    const w = Math.min(W, b.x1 + pad + 1) - x0;
    const h = Math.min(H, b.y1 + pad + 1) - y0;
    const cv = pieceCanvas(bgr.data, W, x0, y0, w, h, (p) => lab[p] === b.id);
    return { x: x0 / scale, y: y0 / scale, bw: w / scale, bh: h / scale, w, h, dataURL: cv.toDataURL('image/png') };
  });
  return { pieces, W, H, scale };
}

/**
 * Cut a rectangle (sheet pixel space). Only the shapes that mostly lie inside the
 * rectangle are kept, so slivers of neighbouring drawings are dropped.
 */
export function cutRect(img, rect, opts = {}) {
  const { bgr, W, H, scale, fg, lab } = labelSheet(img, opts);
  let x0 = Math.max(0, Math.floor(rect.x * scale));
  let y0 = Math.max(0, Math.floor(rect.y * scale));
  let x1 = Math.min(W, Math.ceil((rect.x + rect.w) * scale));
  let y1 = Math.min(H, Math.ceil((rect.y + rect.h) * scale));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const count = new Map();
  let total = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (!fg[p]) continue;
      count.set(lab[p], (count.get(lab[p]) || 0) + 1);
      total++;
    }
  if (!total) return null;
  const keep = new Set([...count].filter(([, c]) => c >= total * 0.12).map(([l]) => l));
  // thu khung vừa khít phần giữ lại
  let bx0 = x1, by0 = y1, bx1 = x0, by1 = y0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      if (!fg[p] || !keep.has(lab[p])) continue;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  x0 = Math.max(x0, bx0 - 2);
  y0 = Math.max(y0, by0 - 2);
  x1 = Math.min(x1, bx1 + 3);
  y1 = Math.min(y1, by1 + 3);
  const cv = pieceCanvas(bgr.data, W, x0, y0, x1 - x0, y1 - y0, (p) => fg[p] && keep.has(lab[p]));
  return { x: x0 / scale, y: y0 / scale, bw: (x1 - x0) / scale, bh: (y1 - y0) / scale, w: x1 - x0, h: y1 - y0, dataURL: cv.toDataURL('image/png') };
}

/** Merge several pieces ({x, y, bw, bh} in sheet space + decoded img) into one image. */
export function mergePieces(parts) {
  const k = parts[0].img.naturalWidth / parts[0].bw; // điểm ảnh mảnh / điểm ảnh bảng (=1 nếu bảng không bị thu nhỏ)
  const x0 = Math.min(...parts.map((p) => p.x));
  const y0 = Math.min(...parts.map((p) => p.y));
  const x1 = Math.max(...parts.map((p) => p.x + p.bw));
  const y1 = Math.max(...parts.map((p) => p.y + p.bh));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round((x1 - x0) * k));
  cv.height = Math.max(1, Math.round((y1 - y0) * k));
  const ctx = cv.getContext('2d');
  for (const p of parts) ctx.drawImage(p.img, Math.round((p.x - x0) * k), Math.round((p.y - y0) * k));
  return { x: x0, y: y0, bw: x1 - x0, bh: y1 - y0, w: cv.width, h: cv.height, dataURL: cv.toDataURL('image/png') };
}
