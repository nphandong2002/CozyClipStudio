import React, { useEffect, useRef } from 'react';
import { renderFrame, DESIGN_W, DESIGN_H } from '../engine/scene.js';
import { propBounds, PROPS } from '../engine/props.js';

const PREVIEW_W = 1280;
const PREVIEW_H = 720;

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
      if (showGuides) drawGuides(ctx, project, selection);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  const toDesign = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * DESIGN_W, y: ((e.clientY - r.top) / r.height) * DESIGN_H };
  };

  const hitTest = (pt) => {
    for (const a of project.anchors) if (Math.hypot(a.x - pt.x, a.y - 20 - pt.y) < 30) return { kind: 'anchor', id: a.id };
    const order = [...project.props.filter((p) => p.layer === 'front'), ...project.props.filter((p) => p.layer !== 'front')].reverse();
    // prefer smaller objects when overlapping
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
    void order;
    return hits[0] ? { kind: 'prop', id: hits[0].id } : null;
  };

  const onDown = (e) => {
    if (!showGuides) return;
    const pt = toDesign(e);
    const hit = hitTest(pt);
    setSelection(hit);
    if (!hit) return;
    const obj = hit.kind === 'anchor' ? project.anchors.find((a) => a.id === hit.id) : project.props.find((p) => p.id === hit.id);
    drag.current = { hit, dx: obj.x - pt.x, dy: obj.y - pt.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const pt = toDesign(e);
    const { hit, dx, dy } = drag.current;
    update((p) => {
      const list = hit.kind === 'anchor' ? p.anchors : p.props;
      const o = list.find((x) => x.id === hit.id);
      if (o) {
        o.x = Math.round(pt.x + dx);
        o.y = Math.round(pt.y + dy);
      }
    }, 'drag');
  };
  const onUp = () => (drag.current = null);

  return (
    <div className="stage-wrap">
      <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}

function drawGuides(ctx, project, selection) {
  ctx.save();
  ctx.setTransform(PREVIEW_W / DESIGN_W, 0, 0, PREVIEW_H / DESIGN_H, 0, 0);
  ctx.lineWidth = 2;
  ctx.font = '600 20px system-ui, sans-serif';
  for (const p of project.props) {
    if (p.enabled === false) continue;
    const b = propBounds(p);
    const sel = selection?.kind === 'prop' && selection.id === p.id;
    if (!sel) continue;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd166';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(PROPS[p.type]?.label || p.type, b.x + 4, b.y - 8);
  }
  for (const a of project.anchors) {
    const sel = selection?.kind === 'anchor' && selection.id === a.id;
    ctx.setLineDash(sel ? [] : [6, 6]);
    ctx.strokeStyle = sel ? '#ffd166' : 'rgba(120,220,255,0.9)';
    ctx.fillStyle = sel ? 'rgba(255,209,102,0.25)' : 'rgba(120,220,255,0.15)';
    ctx.beginPath();
    ctx.arc(a.x, a.y - 20, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 4);
    ctx.lineTo(a.x, a.y + 6);
    ctx.stroke();
    ctx.fillStyle = sel ? '#ffd166' : 'rgba(170,235,255,0.95)';
    ctx.fillText('⚓ ' + a.name, a.x + 28, a.y - 14);
  }
  ctx.restore();
}
