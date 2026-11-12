// Frame composition + timeline planning.
import { DESIGN_W, DESIGN_H, effectiveScene, lerp, smooth, hashStr } from './util.js';
import { drawIndoorBackground, drawOutdoorBackground, drawPrecip, drawLighting, drawDust, drawVignette } from './world.js';
import { drawProp, propLights } from './props.js';
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
    drawImageCover(ctx, bgImg, DESIGN_W, DESIGN_H);
    if (!indoor) drawPrecip(ctx, 0, 0, DESIGN_W, DESIGN_H, env, { scale: 0.6, density: 0.8, seed: 5 });
  } else if (indoor) {
    drawIndoorBackground(ctx, env, project.scene);
  } else {
    drawOutdoorBackground(ctx, env, project.scene);
    drawPrecip(ctx, 0, 0, DESIGN_W, DESIGN_H, env, { scale: 0.6, density: 0.8, seed: 5 });
  }

  const props = project.props.filter((p) => p.enabled !== false);
  const back = props.filter((p) => (p.layer || 'back') === 'back');
  const front = props.filter((p) => p.layer === 'front');
  for (const p of back) drawProp(ctx, p, env);

  // characters (depth-sorted: farther/higher drawn first, nearer drawn on top)
  if (rig) {
    for (const pl of characterPlacements(project, state)) {
      rig.setLook(pl.char, pl.action);
      rig.pose(pl.action, pl.animT, state.L, { free: !!pl.free, seed: pl.seed });
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

/** Draw an image scaled to cover WxH (like CSS background-size: cover), centred. */
function drawImageCover(ctx, img, W, H) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.max(W / iw, H / ih);
  const w = iw * s;
  const h = ih * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

export function anchorById(project, id) {
  return project.anchors.find((a) => a.id === id) || project.anchors[0];
}

/** List of characters in the project (tolerant of the legacy single-character shape). */
export function characterList(project) {
  if (Array.isArray(project.characters)) return project.characters;
  if (project.character) return [{ id: 'c1', name: 'Nhân vật 1', ...project.character }];
  return [];
}

/** A character's action + anchor for a segment (undefined if that character is not cast). */
export function castEntry(seg, charId) {
  return seg && seg.cast ? seg.cast[charId] : undefined;
}

function charSeed(id) {
  return (hashStr(String(id)) % 9973) + 1;
}

/**
 * Placement for every character in this frame, depth-sorted (lower on screen = nearer = drawn on top).
 * During a move clip, each character walks its own from→to; characters that keep their anchor stand still.
 */
export function characterPlacements(project, state) {
  const chars = characterList(project);
  const seg = state.seg;
  const out = [];
  for (const c of chars) {
    const base = c.scale || 0.6;
    const seed = charSeed(c.id);
    const mv = state.move ? state.move.moveCast?.[c.id] : null;
    if (mv && mv.from && mv.to && mv.from !== mv.to) {
      const a = anchorById(project, mv.from);
      const b = anchorById(project, mv.to);
      if (!a || !b) continue;
      const u = state.move.u;
      const k = smooth(u);
      const goingRight = b.x > a.x;
      out.push({
        char: c,
        seed,
        free: true,
        action: 'anim:walk',
        animT: u * state.move.T,
        x: lerp(a.x, b.x, u),
        y: lerp(a.y, b.y, k),
        scale: base * lerp(a.scale || 1, b.scale || 1, k),
        flip: c.facesLeft ? goingRight : !goingRight,
      });
    } else {
      const ce = castEntry(seg, c.id);
      if (!ce) continue;
      const a = anchorById(project, ce.anchor);
      if (!a) continue;
      out.push({ char: c, seed, free: false, action: ce.action, animT: state.t, x: a.x, y: a.y, scale: base * (a.scale || 1), flip: !!a.flip });
    }
  }
  out.sort((p, q) => p.y - q.y);
  return out;
}

/** Walking time between two anchors (seconds, rounded to whole frames). */
export function moveDuration(project, fromId, toId) {
  const a = anchorById(project, fromId);
  const b = anchorById(project, toId);
  if (!a || !b || a.id === b.id) return 0;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
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
export function buildPlan(project) {
  const L = project.output.loopSeconds;
  const chars = characterList(project);
  const clips = [];
  let phase = 0;
  let prev = null;
  project.timeline.forEach((seg, i) => {
    if (prev) {
      // Per-character walk: each character moves from its previous anchor to its new one.
      const moveCast = {};
      let maxT = 0;
      for (const c of chars) {
        const from = castEntry(prev, c.id)?.anchor;
        const to = castEntry(seg, c.id)?.anchor;
        moveCast[c.id] = { from, to };
        if (from && to && from !== to) maxT = Math.max(maxT, moveDuration(project, from, to));
      }
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
