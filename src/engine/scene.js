// Frame composition + timeline planning.
import { DESIGN_W, DESIGN_H, effectiveScene, lerp, smooth, hashStr } from './util.js';
import { drawIndoorBackground, drawOutdoorBackground, drawPrecip, drawLighting, drawDust, drawVignette } from './world.js';
import { drawProp, propLights, drawWindowQuad } from './props.js';
import { getImage } from './images.js';

export const WALK_SPEED = 170; // design px per second at character scale 1.6

/**
 * Draw one frame.
 * state: { t, L, seg, move?: {from, to, u}, phase }
 *  - t: time inside clip (s). Props use (t + phase) so everything stays continuous across clips.
 */
export function renderFrame(ctx, project, rig, state) {
  const { width, height } = project.output;
  const env = { ...effectiveScene(project, state.seg), t: mod(state.t + (state.phase || 0), state.L), L: state.L };
  const indoor = project.scene.type !== 'outdoor';
  ctx.setTransform(width / DESIGN_W, 0, 0, height / DESIGN_H, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';

  const bgImg = project.scene.backgroundImage ? getImage('bg') : null;
  if (bgImg) {
    drawBackground(ctx, bgImg, DESIGN_W, DESIGN_H);
    if (!indoor) drawPrecip(ctx, 0, 0, DESIGN_W, DESIGN_H, env, { scale: 0.6, density: 0.8, seed: 5 });
  } else if (indoor) {
    drawIndoorBackground(ctx, env, project.scene);
  } else {
    drawOutdoorBackground(ctx, env, project.scene);
    drawPrecip(ctx, 0, 0, DESIGN_W, DESIGN_H, env, { scale: 0.6, density: 0.8, seed: 5 });
  }

  // user-defined "live window" regions (free 4-corner quad over the background)
  for (const win of project.scene.windows || []) drawWindowQuad(ctx, windowPoints(win), env, (hashStr(win.id) % 9973) + 1, { sky: win.sky !== false });

  const props = project.props.filter((p) => p.enabled !== false);
  const back = props.filter((p) => (p.layer || 'back') === 'back');
  const front = props.filter((p) => p.layer === 'front');
  for (const p of back) drawProp(ctx, p, env);

  // characters (depth-sorted: farther/higher drawn first, nearer drawn on top)
  if (rig) {
    for (const pl of characterPlacements(project, state)) {
      rig.setLook(pl.char, pl.action);
      // "một lần": trải đúng 1 vòng hoạt ảnh theo thời gian di chuyển (nhảy lên/xuống giường…)
      const animT = pl.onceProgress != null ? Math.min(0.999, pl.onceProgress) * rig.cycleDuration(pl.action) : pl.animT;
      rig.pose(pl.action, animT, state.L, { free: !!pl.free, seed: pl.seed });
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(pl.x, pl.y - 2, 105 * pl.scale, 18 * pl.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      rig.draw(ctx, pl.x, pl.y, pl.scale, pl.flip);
    }
  }

  for (const p of front) drawProp(ctx, p, env);
  if (!indoor) drawPrecip(ctx, 0, 0, DESIGN_W, DESIGN_H, env, { scale: 1.3, density: 0.35, seed: 6 });
  drawDust(ctx, env, indoor);
  const lights = props.flatMap((p) => propLights(p, env));
  drawLighting(ctx, env, lights, indoor);
  drawVignette(ctx, project.scene.vignette ?? 0.45);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function mod(a, b) {
  return ((a % b) + b) % b;
}

/**
 * Draw a background image into WxH with an adjustable "window": pan (x,y in 0..1),
 * zoom (>=1) and rotate (degrees). Default {0.5,0.5,1,0} == CSS background-size: cover.
 * Cover scale is rotation-aware so the frame never shows gaps when tilted.
 */
export function drawBackground(ctx, img, W, H, frame) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const f = frame || {};
  const zoom = f.zoom || 1;
  const rot = ((f.rotate || 0) * Math.PI) / 180;
  const cx = f.x ?? 0.5;
  const cy = f.y ?? 0.5;
  const ac = Math.abs(Math.cos(rot));
  const as = Math.abs(Math.sin(rot));
  const Wr = W * ac + H * as;
  const Hr = W * as + H * ac;
  const s = Math.max(Wr / iw, Hr / ih) * zoom;
  const w = iw * s;
  const h = ih * s;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(rot);
  ctx.drawImage(img, -w / 2 + (0.5 - cx) * w, -h / 2 + (0.5 - cy) * h, w, h);
  ctx.restore();
}

/** List of characters in the project (tolerant of the legacy single-character shape). */
export function characterList(project) {
  if (Array.isArray(project.characters)) return project.characters;
  if (project.character) return [{ id: 'c1', name: 'Nhân vật 1', ...project.character }];
  return [];
}

/** A character's { action, x, y, scale?, flip? } for a segment (undefined if not cast). */
export function castEntry(seg, charId) {
  return seg && seg.cast ? seg.cast[charId] : undefined;
}

function charSeed(id) {
  return (hashStr(String(id)) % 9973) + 1;
}

/** A window region's 4 corner points [TL,TR,BR,BL], tolerant of the legacy
 *  rect+rotate shape (converted on the fly). */
export function windowPoints(win) {
  if (Array.isArray(win.points) && win.points.length === 4) return win.points;
  const x = win.x ?? 760;
  const y = win.y ?? 300;
  const w = win.w ?? 520;
  const h = win.h ?? 380;
  const rot = ((win.rotate || 0) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

const MOVE_EPS = 2; // px: below this, a character is considered standing still between segments

/**
 * How a character gets to its position in a segment (stored on the destination cast entry as `enter`):
 *  mode 'walk'    – đi bộ thẳng (mặc định, như trước)
 *  mode 'custom'  – hành động tuỳ chọn: { action, path: 'line'|'arc', height, duration (0 = tự động),
 *                   once (trải 1 vòng hoạt ảnh trên cả quãng), delay (chờ trước, giây) }.
 *                   Dùng được cả khi đứng yên tại chỗ (vd. thức dậy, vươn vai).
 *  mode 'instant' – xuất hiện ngay ở vị trí mới, không có đoạn di chuyển.
 */
export const ENTER_PRESETS = {
  walk: { label: 'Đi bộ', enter: { mode: 'walk' } },
  run: { label: 'Chạy', enter: { mode: 'custom', action: 'anim:run', path: 'line', height: 0, duration: 0, once: false, delay: 0 } },
  jump: { label: 'Nhảy (vòng cung)', enter: { mode: 'custom', action: 'anim:jump', path: 'arc', height: 160, duration: 0, once: true, delay: 0 } },
  custom: { label: 'Tuỳ chỉnh…', enter: { mode: 'custom', action: 'anim:walk', path: 'line', height: 120, duration: 0, once: false, delay: 0 } },
  instant: { label: 'Xuất hiện ngay', enter: { mode: 'instant' } },
};

const isMoving = (from, to) => !!(from && to && Math.hypot(to.x - from.x, to.y - from.y) > MOVE_EPS);

/**
 * Resolve one character's transition into `to` (cast entry of the new segment).
 * Returns null when there is nothing to animate, else
 * { from, to, action, path, height, once, delay, T, moving, fromAction }.
 */
export function resolveEnter(project, rig, from, to) {
  if (!from || !to) return null;
  const e = to.enter || { mode: 'walk' };
  const moving = isMoving(from, to);
  if (e.mode === 'instant') return null;
  const fps = project.output.fps;
  const frames = (s) => Math.max(1 / fps, Math.round(s * fps) / fps);
  if (e.mode !== 'custom') {
    if (!moving) return null;
    return { from, to, action: 'anim:walk', path: 'line', height: 0, once: false, delay: 0, T: moveDuration(project, from, to), moving, fromAction: from.action };
  }
  const action = e.action || 'anim:walk';
  let T = +e.duration || 0;
  if (!T) {
    if (e.once && rig) T = rig.cycleDuration(action);
    else if (moving) T = moveDuration(project, from, to);
    else T = rig ? rig.cycleDuration(action) : 2;
  }
  T = frames(Math.min(30, Math.max(0.2, T)));
  return {
    from,
    to,
    action,
    path: e.path === 'arc' ? 'arc' : 'line',
    height: +e.height || 0,
    once: !!e.once,
    delay: +e.delay > 0 ? Math.round(+e.delay * fps) / fps : 0,
    T,
    moving,
    fromAction: from.action,
  };
}

/**
 * Placement for every character in this frame, depth-sorted (lower on screen = nearer = drawn on top).
 * During a move clip each character follows its own transition (walk / custom action / arc jump) with its
 * own duration and delay; before it starts it keeps its previous action, after it arrives it starts the new one.
 */
export function characterPlacements(project, state) {
  const chars = characterList(project);
  const seg = state.seg;
  const out = [];
  for (const c of chars) {
    const base = c.scale || 0.6;
    const seed = charSeed(c.id);
    const mv = state.move ? state.move.moveCast?.[c.id] : null;
    if (mv && mv.T) {
      const tm = state.move.u * state.move.T; // giây trong đoạn di chuyển
      const a = mv.from;
      const b = mv.to;
      const flipAt = (p) => !!p.flip;
      if (tm < mv.delay) {
        out.push({ char: c, seed, free: true, action: mv.fromAction, animT: tm, x: a.x, y: a.y, scale: base * (a.scale || 1), flip: flipAt(a) });
      } else if (tm < mv.delay + mv.T) {
        const v = (tm - mv.delay) / mv.T;
        const k = smooth(v);
        const dx = b.x - a.x;
        const arc = mv.path === 'arc';
        const y = arc ? lerp(a.y, b.y, v) - mv.height * 4 * v * (1 - v) : lerp(a.y, b.y, k);
        // hướng mặt: theo chiều đi ngang; đi thẳng lên/xuống thì giữ hướng của vị trí đích
        const flip = Math.abs(dx) > MOVE_EPS ? (c.facesLeft ? dx > 0 : dx < 0) : flipAt(b);
        out.push({
          char: c,
          seed,
          free: true,
          action: mv.action,
          animT: tm - mv.delay,
          onceProgress: mv.once ? v : null,
          x: lerp(a.x, b.x, v),
          y,
          scale: base * lerp(a.scale || 1, b.scale || 1, k),
          flip,
        });
      } else {
        out.push({ char: c, seed, free: true, action: b.action, animT: tm - mv.delay - mv.T, x: b.x, y: b.y, scale: base * (b.scale || 1), flip: flipAt(b) });
      }
    } else {
      const ce = castEntry(seg, c.id);
      if (!ce || typeof ce.x !== 'number') continue;
      out.push({ char: c, seed, free: false, action: ce.action, animT: state.t, x: ce.x, y: ce.y, scale: base * (ce.scale || 1), flip: !!ce.flip });
    }
  }
  out.sort((p, q) => p.y - q.y);
  return out;
}

/** Walking time between two positions {x,y} (seconds, rounded to whole frames). */
export function moveDuration(project, from, to) {
  if (!from || !to) return 0;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist <= MOVE_EPS) return 0;
  const fps = project.output.fps;
  const T = Math.min(10, Math.max(2, dist / WALK_SPEED));
  return Math.round(T * fps) / fps;
}

/**
 * Timeline → render plan.
 * loop clip: rendered once (L seconds), repeated `repeats` times.
 * move clip: walking between anchors, rendered once.
 * `phase` keeps prop animation continuous across clips.
 */
export function buildPlan(project, rig = null) {
  const L = project.output.loopSeconds;
  const chars = characterList(project);
  const clips = [];
  let phase = 0;
  let prev = null;
  project.timeline.forEach((seg, i) => {
    if (prev) {
      // Per-character transition: walk / custom action / arc jump, each with its own duration + delay.
      const moveCast = {};
      let maxT = 0;
      for (const c of chars) {
        const mv = resolveEnter(project, rig, castEntry(prev, c.id), castEntry(seg, c.id));
        if (!mv) continue;
        moveCast[c.id] = mv;
        maxT = Math.max(maxT, mv.delay + mv.T);
      }
      maxT = Math.round(maxT * project.output.fps) / project.output.fps;
      if (maxT > 0) {
        clips.push({ kind: 'move', id: `move_${i}`, seg, moveCast, T: maxT, phase, repeats: 1 });
        phase = mod(phase + maxT, L);
      }
    }
    const repeats = Math.max(1, Math.round((seg.minutes * 60) / L));
    clips.push({ kind: 'loop', id: `seg_${i}`, seg, T: L, phase, repeats });
    prev = seg;
  });
  const total = clips.reduce((s, c) => s + c.T * c.repeats, 0);
  return { L, clips, total };
}

export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return (h ? h + 'h ' : '') + String(m).padStart(h ? 2 : 1, '0') + 'm ' + String(s).padStart(2, '0') + 's';
}

export { DESIGN_W, DESIGN_H };
