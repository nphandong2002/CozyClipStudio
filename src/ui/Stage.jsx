import React, { useEffect, useRef } from 'react';
import { renderFrame, DESIGN_W, DESIGN_H, characterPlacements } from '../engine/scene.js';
import { propBounds, PROPS } from '../engine/props.js';

const PREVIEW_W = 1280;
const PREVIEW_H = 720;

// Approximate on-screen box of a character around its foot point, for picking/guides.
function charBox(pl) {
  const w = 280 * pl.scale;
  const h = 340 * pl.scale;
  return { x: pl.x - w / 2, y: pl.y - h, w, h };
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
      const w = wins[i];
      if (pt.x >= w.x && pt.x <= w.x + w.w && pt.y >= w.y && pt.y <= w.y + w.h) return { kind: 'window', id: w.id };
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

  const onDown = (e) => {
    if (!showGuides) return;
    const pt = toDesign(e);
    // resize handle (bottom-right) of the currently selected window?
    if (selection?.kind === 'window') {
      const w = winById(selection.id);
      if (w && pt.x >= w.x + w.w - 48 && pt.x <= w.x + w.w + 12 && pt.y >= w.y + w.h - 48 && pt.y <= w.y + w.h + 12) {
        drag.current = { winResize: true, id: w.id, startPt: pt, startW: w.w, startH: w.h };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = hitTest(pt);
    setSelection(hit);
    if (!hit) {
      // empty area + background image → pan the background "window"
      if (project.scene.backgroundImage) {
        const fr = project.scene.backgroundFrame || {};
        drag.current = { bg: true, startPt: pt, startX: fr.x ?? 0.5, startY: fr.y ?? 0.5, zoom: fr.zoom || 1 };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    const obj = posOf(hit);
    if (!obj) return;
    drag.current = { hit, dx: (obj.x ?? pt.x) - pt.x, dy: (obj.y ?? pt.y) - pt.y, segId: clip?.seg?.id };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const pt = toDesign(e);
    if (drag.current.bg) {
      const { startPt, startX, startY, zoom } = drag.current;
      const nx = Math.min(1, Math.max(0, startX - (pt.x - startPt.x) / DESIGN_W / zoom));
      const ny = Math.min(1, Math.max(0, startY - (pt.y - startPt.y) / DESIGN_H / zoom));
      update((p) => (p.scene.backgroundFrame = { zoom: 1, rotate: 0, ...(p.scene.backgroundFrame || {}), x: nx, y: ny }), 'drag');
      return;
    }
    if (drag.current.winResize) {
      const { id, startPt, startW, startH } = drag.current;
      update((p) => {
        const w = (p.scene.windows || []).find((x) => x.id === id);
        if (w) {
          w.w = Math.max(40, Math.round(startW + (pt.x - startPt.x)));
          w.h = Math.max(40, Math.round(startH + (pt.y - startPt.y)));
        }
      }, 'drag');
      return;
    }
    const { hit, dx, dy, segId } = drag.current;
    const nx = Math.round(pt.x + dx);
    const ny = Math.round(pt.y + dy);
    if (hit.kind === 'window') {
      update((p) => {
        const w = (p.scene.windows || []).find((x) => x.id === hit.id);
        if (w) {
          w.x = nx;
          w.y = ny;
        }
      }, 'drag');
    } else if (hit.kind === 'prop') {
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
      <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}

function drawGuides(ctx, project, rig, clip, selection) {
  ctx.save();
  ctx.setTransform(PREVIEW_W / DESIGN_W, 0, 0, PREVIEW_H / DESIGN_H, 0, 0);
  ctx.lineWidth = 2;
  ctx.font = '600 20px system-ui, sans-serif';
  // selected prop
  for (const p of project.props) {
    if (p.enabled === false) continue;
    if (!(selection?.kind === 'prop' && selection.id === p.id)) continue;
    const b = propBounds(p);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd166';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(PROPS[p.type]?.label || p.type, b.x + 4, b.y - 8);
  }
  // live-window regions
  for (const w of project.scene.windows || []) {
    const sel = selection?.kind === 'window' && selection.id === w.id;
    ctx.setLineDash(sel ? [] : [10, 6]);
    ctx.strokeStyle = sel ? '#ffd166' : 'rgba(120,220,255,0.9)';
    ctx.strokeRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = sel ? '#ffd166' : 'rgba(170,235,255,0.95)';
    ctx.fillText('🪟 cửa sổ', w.x + 6, w.y - 8);
    if (sel) {
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(w.x + w.w - 26, w.y + w.h - 26, 26, 26); // resize handle
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
