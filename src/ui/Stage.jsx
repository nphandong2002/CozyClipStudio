import React, { useEffect, useRef } from 'react';
import { renderFrame, DESIGN_W, DESIGN_H, characterPlacements, windowPoints } from '../engine/scene.js';
import { propBounds, PROPS } from '../engine/props.js';
import { samplePath, tracePath } from '../engine/mask.js';

// ---- mask: chuyển giữa toạ độ thiết kế và toạ độ (u, v) trong khung ảnh của vật thể
function mediaSize(p) {
  return { w: p.params?.natW || 300, h: p.params?.natH || 360 };
}
function uvToDesign(p, u, v) {
  const { w, h } = mediaSize(p);
  const s = p.scale || 1;
  return { x: p.x + (u - 0.5) * w * s * (p.flip ? -1 : 1), y: p.y + (v - 1) * h * s };
}
function designToUv(p, pt) {
  const { w, h } = mediaSize(p);
  const s = p.scale || 1;
  return { u: (pt.x - p.x) / (w * s * (p.flip ? -1 : 1)) + 0.5, v: (pt.y - p.y) / (h * s) + 1 };
}
const maskDesignPts = (p) => (p.params?.mask?.points || []).map((q) => ({ ...uvToDesign(p, q.u, q.v), smooth: !!q.smooth }));
const round4 = (x) => Math.round(x * 10000) / 10000;

const PREVIEW_W = 1280;
const PREVIEW_H = 720;

// Approximate on-screen box of a character around its foot point, for picking/guides.
function charBox(pl) {
  const w = 280 * pl.scale;
  const h = 340 * pl.scale;
  return { x: pl.x - w / 2, y: pl.y - h, w, h };
}

function pointInPoly(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// index of the corner near pt, or -1
function cornerAt(pt, pts, r = 32) {
  for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i].x - pt.x, pts[i].y - pt.y) <= r) return i;
  return -1;
}

export default function Stage({ project, rig, clip, playing, clock, showGuides, selection, setSelection, update, onMoveDone }) {
  const canvasRef = useRef(null);
  const live = useRef({});
  live.current = { project, rig, clip, playing, showGuides, selection, onMoveDone };
  const drag = useRef(null);

  // pause/resume keeps time continuous
  useEffect(() => {
    const c = clock.current;
    if (!playing) c.pausedAt = (performance.now() - c.start) / 1000;
    else c.start = performance.now() - (c.pausedAt || 0) * 1000;
  }, [playing, clock]);

  useEffect(() => {
    let raf;
    const ctx = canvasRef.current.getContext('2d');
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const { project, rig, clip, playing, showGuides, selection, onMoveDone } = live.current;
      if (!clip) return;
      const c = clock.current;
      let t = playing ? (performance.now() - c.start) / 1000 : c.pausedAt || 0;
      const L = project.output.loopSeconds;
      const preview = { ...project, output: { ...project.output, width: PREVIEW_W, height: PREVIEW_H } };
      if (clip.kind === 'move') {
        if (t >= clip.T) {
          onMoveDone();
          t = clip.T;
        }
        renderFrame(ctx, preview, rig, { t, L, seg: clip.seg, phase: clip.phase, move: { moveCast: clip.moveCast, u: Math.min(1, t / clip.T), T: clip.T } });
      } else {
        renderFrame(ctx, preview, rig, { t: t % L, L, seg: clip.seg, phase: clip.phase });
      }
      if (showGuides) drawGuides(ctx, project, rig, clip, selection);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  const toDesign = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * DESIGN_W, y: ((e.clientY - r.top) / r.height) * DESIGN_H };
  };

  // characters are pickable only on a loop clip (position is per-segment)
  const charHit = (pt) => {
    if (!clip || clip.kind !== 'loop' || !rig) return null;
    const pls = characterPlacements(project, { seg: clip.seg, t: 0, L: project.output.loopSeconds });
    for (let i = pls.length - 1; i >= 0; i--) {
      const b = charBox(pls[i]);
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return { kind: 'char', id: pls[i].char.id };
    }
    return null;
  };

  const hitTest = (pt) => {
    const ch = charHit(pt);
    if (ch) return ch;
    const hits = project.props
      .filter((p) => p.enabled !== false)
      .filter((p) => {
        const b = propBounds(p);
        return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
      })
      .sort((a, b) => {
        const fa = a.layer === 'front' ? 0 : 1;
        const fb = b.layer === 'front' ? 0 : 1;
        if (fa !== fb) return fa - fb;
        const ba = propBounds(a);
        const bb = propBounds(b);
        return ba.w * ba.h - bb.w * bb.h;
      });
    if (hits[0]) return { kind: 'prop', id: hits[0].id };
    const wins = project.scene.windows || [];
    for (let i = wins.length - 1; i >= 0; i--) {
      const pts = windowPoints(wins[i]);
      if (pointInPoly(pt, pts) || cornerAt(pt, pts) >= 0) return { kind: 'window', id: wins[i].id };
    }
    return null;
  };

  const posOf = (hit) => {
    if (hit.kind === 'prop') return project.props.find((p) => p.id === hit.id);
    if (hit.kind === 'char') return clip?.seg?.cast?.[hit.id];
    if (hit.kind === 'window') return (project.scene.windows || []).find((w) => w.id === hit.id);
    return null;
  };
  const winById = (id) => (project.scene.windows || []).find((w) => w.id === id);

  const cursorFor = (pt) => {
    if (selection?.kind === 'window') {
      const w = winById(selection.id);
      if (w) {
        const pts = windowPoints(w);
        if (cornerAt(pt, pts) >= 0) return 'crosshair';
        if (pointInPoly(pt, pts)) return 'move';
      }
    }
    return hitTest(pt) ? 'move' : 'default';
  };

  // apply a change to a window's points, converting a legacy rect window on first edit
  const editWindowPoints = (id, fn) =>
    update((p) => {
      const w = (p.scene.windows || []).find((x) => x.id === id);
      if (!w) return;
      const pts = windowPoints(w).map((pp) => ({ ...pp }));
      fn(pts);
      w.points = pts;
      delete w.x;
      delete w.y;
      delete w.w;
      delete w.h;
      delete w.rotate;
    }, 'drag');

  // ---------------------------------------------------------------- mask editing
  const maskProp = selection?.kind === 'prop' && selection.mask ? project.props.find((p) => p.id === selection.id && p.type === 'image') : null;
  const editMask = (id, fn) =>
    update((p) => {
      const o = p.props.find((x) => x.id === id);
      if (!o) return;
      o.params = o.params || {};
      o.params.mask = o.params.mask || { enabled: true, feather: 0, expand: 0, invert: false, points: [] };
      o.params.mask.points = o.params.mask.points.map((q) => ({ ...q }));
      fn(o.params.mask.points, o);
    }, 'drag');
  const maskPointAt = (p, pt, r = 18) => cornerAt(pt, maskDesignPts(p), r);
  const maskDown = (e, pt) => {
    const p = maskProp;
    const pts = maskDesignPts(p);
    const i = maskPointAt(p, pt);
    // chuột phải / Alt+bấm lên điểm → xoá điểm
    if (i >= 0 && (e.button === 2 || e.altKey)) {
      editMask(p.id, (q) => q.splice(i, 1));
      return;
    }
    if (e.button === 2) return;
    if (i >= 0) {
      drag.current = { maskPoint: true, id: p.id, i };
      return;
    }
    const uv = designToUv(p, pt);
    const add = { u: round4(uv.u), v: round4(uv.v), smooth: false };
    // gần đường viền → chèn điểm vào đúng đoạn đó
    if (pts.length >= 3) {
      let best = null;
      for (const s of samplePath(pts)) {
        const d = Math.hypot(s.x - pt.x, s.y - pt.y);
        if (!best || d < best.d) best = { d, seg: s.seg };
      }
      if (best && best.d <= 14) {
        const at = best.seg + 1;
        add.smooth = !!(pts[best.seg].smooth && pts[(best.seg + 1) % pts.length].smooth);
        editMask(p.id, (q) => q.splice(at, 0, add));
        drag.current = { maskPoint: true, id: p.id, i: at };
        return;
      }
      // trong vùng → kéo cả mask
      if (pointInPoly(pt, pts)) {
        drag.current = { maskMove: true, id: p.id, start: designToUv(p, pt), startPts: p.params.mask.points.map((q) => ({ ...q })) };
        return;
      }
    }
    // chỗ trống → thêm điểm mới vào cuối
    editMask(p.id, (q) => q.push(add));
    drag.current = { maskPoint: true, id: p.id, i: pts.length };
  };
  const maskMove = (pt) => {
    const d = drag.current;
    const p = project.props.find((x) => x.id === d.id);
    if (!p) return;
    const uv = designToUv(p, pt);
    if (d.maskPoint) {
      editMask(d.id, (q) => {
        if (q[d.i]) q[d.i] = { ...q[d.i], u: round4(uv.u), v: round4(uv.v) };
      });
    } else {
      const du = uv.u - d.start.u;
      const dv = uv.v - d.start.v;
      editMask(d.id, (q) => {
        for (let k = 0; k < q.length; k++) q[k] = { ...d.startPts[k], u: round4(d.startPts[k].u + du), v: round4(d.startPts[k].v + dv) };
      });
    }
  };
  const onDouble = (e) => {
    if (!maskProp) return;
    const i = maskPointAt(maskProp, toDesign(e));
    if (i >= 0) editMask(maskProp.id, (q) => (q[i] = { ...q[i], smooth: !q[i].smooth })); // cong ↔ nhọn
  };

  const onDown = (e) => {
    if (!showGuides) return;
    const pt = toDesign(e);
    if (maskProp) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
      maskDown(e, pt);
      return;
    }
    // a corner of the currently selected window?
    if (selection?.kind === 'window') {
      const w = winById(selection.id);
      if (w) {
        const ci = cornerAt(pt, windowPoints(w));
        if (ci >= 0) {
          drag.current = { winCorner: true, id: w.id, ci };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    const hit = hitTest(pt);
    setSelection(hit);
    if (!hit) return;
    if (hit.kind === 'window') {
      const pts = windowPoints(winById(hit.id)).map((pp) => ({ ...pp }));
      drag.current = { winMove: true, id: hit.id, startPts: pts, startPt: pt };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const obj = posOf(hit);
    if (!obj) return;
    drag.current = { hit, dx: (obj.x ?? pt.x) - pt.x, dy: (obj.y ?? pt.y) - pt.y, segId: clip?.seg?.id };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const pt = toDesign(e);
    if (!drag.current) {
      if (showGuides && canvasRef.current) canvasRef.current.style.cursor = maskProp ? (maskPointAt(maskProp, pt) >= 0 ? 'move' : 'crosshair') : cursorFor(pt);
      return;
    }
    if (drag.current.maskPoint || drag.current.maskMove) return maskMove(pt);
    if (drag.current.winCorner) {
      const { id, ci } = drag.current;
      editWindowPoints(id, (pts) => (pts[ci] = { x: Math.round(pt.x), y: Math.round(pt.y) }));
      return;
    }
    if (drag.current.winMove) {
      const { id, startPts, startPt } = drag.current;
      const ddx = pt.x - startPt.x;
      const ddy = pt.y - startPt.y;
      editWindowPoints(id, (pts) => {
        for (let i = 0; i < pts.length; i++) {
          pts[i].x = Math.round(startPts[i].x + ddx);
          pts[i].y = Math.round(startPts[i].y + ddy);
        }
      });
      return;
    }
    const { hit, dx, dy, segId } = drag.current;
    const nx = Math.round(pt.x + dx);
    const ny = Math.round(pt.y + dy);
    if (hit.kind === 'prop') {
      update((p) => {
        const o = p.props.find((x) => x.id === hit.id);
        if (o) {
          o.x = nx;
          o.y = ny;
        }
      }, 'drag');
    } else if (hit.kind === 'char') {
      update((p) => {
        const seg = p.timeline.find((t) => t.id === segId);
        const ce = seg?.cast?.[hit.id];
        if (ce) {
          ce.x = nx;
          ce.y = ny;
        }
      }, 'drag');
    }
  };
  const onUp = () => (drag.current = null);

  return (
    <div className="stage-wrap">
      <canvas
        ref={canvasRef}
        width={PREVIEW_W}
        height={PREVIEW_H}
        className="stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={onDouble}
        onContextMenu={(e) => maskProp && e.preventDefault()}
      />
      {maskProp && (
        <div className="mask-hint">
          ✏️ Đang sửa mask — bấm chỗ trống: thêm điểm · bấm lên viền: chèn điểm · kéo điểm: di chuyển · bấm đúp điểm: cong ↔ nhọn · chuột phải / Alt+bấm điểm: xoá · kéo trong vùng: dời cả mask · Esc: xong
        </div>
      )}
    </div>
  );
}

function drawGuides(ctx, project, rig, clip, selection) {
  ctx.save();
  ctx.setTransform(PREVIEW_W / DESIGN_W, 0, 0, PREVIEW_H / DESIGN_H, 0, 0);
  ctx.lineWidth = 2;
  ctx.font = '600 20px system-ui, sans-serif';
  // mask đang sửa: viền + điểm neo (vuông = góc nhọn, tròn = cong)
  if (selection?.kind === 'prop' && selection.mask) {
    const p = project.props.find((x) => x.id === selection.id);
    if (p) {
      const b = propBounds(p);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const pts = maskDesignPts(p);
      ctx.setLineDash([]);
      if (pts.length >= 2) {
        ctx.beginPath();
        if (pts.length >= 3) tracePath(ctx, pts);
        else {
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
        }
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffd166';
        ctx.stroke();
      }
      pts.forEach((q, i) => {
        ctx.fillStyle = i === 0 ? '#ff7b54' : '#ffd166';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (q.smooth) ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
        else ctx.rect(q.x - 8, q.y - 8, 16, 16);
        ctx.fill();
        ctx.stroke();
      });
      ctx.fillStyle = '#ffd166';
      ctx.fillText(pts.length < 3 ? `✏️ Mask: bấm để đặt điểm (${pts.length}/3)` : '✏️ Mask', b.x + 4, b.y - 8);
    }
  }
  // selected prop
  for (const p of project.props) {
    if (p.enabled === false) continue;
    if (selection?.mask) continue;
    if (!(selection?.kind === 'prop' && selection.id === p.id)) continue;
    const b = propBounds(p);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd166';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(PROPS[p.type]?.label || p.type, b.x + 4, b.y - 8);
  }
  // live-window regions: free 4-corner quads with draggable corner handles
  for (const w of project.scene.windows || []) {
    const pts = windowPoints(w);
    const sel = selection?.kind === 'window' && selection.id === w.id;
    ctx.setLineDash(sel ? [] : [10, 6]);
    ctx.strokeStyle = sel ? '#ffd166' : 'rgba(120,220,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = sel ? '#ffd166' : 'rgba(170,235,255,0.95)';
    ctx.fillText('🪟 cửa sổ', pts[0].x + 6, pts[0].y - 8);
    if (sel) {
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd166';
      for (const pp of pts) ctx.fillRect(pp.x - 12, pp.y - 12, 24, 24); // 4 corner handles
    }
  }
  // characters (loop clip only): dashed box each, solid for selected
  if (rig && clip?.kind === 'loop') {
    const pls = characterPlacements(project, { seg: clip.seg, t: 0, L: project.output.loopSeconds });
    for (const pl of pls) {
      const b = charBox(pl);
      const sel = selection?.kind === 'char' && selection.id === pl.char.id;
      ctx.setLineDash(sel ? [] : [6, 6]);
      ctx.strokeStyle = sel ? '#ffd166' : 'rgba(120,220,255,0.75)';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (sel) {
        ctx.fillStyle = '#ffd166';
        ctx.fillText('🐾 ' + (pl.char.name || ''), b.x + 4, b.y - 8);
      }
    }
  }
  ctx.restore();
}
