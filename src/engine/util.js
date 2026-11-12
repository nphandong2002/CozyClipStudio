// Shared helpers. Everything time-based is PERIODIC in the loop length L so a
// rendered loop clip can be repeated seamlessly for hours.

export const TAU = Math.PI * 2;
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Integer number of cycles per loop closest to the wanted frequency (>=1). */
export function cyclesFor(hz, L) {
  return Math.max(1, Math.round(hz * L));
}

/** Periodic oscillator: sin with ~hz frequency, exactly periodic over L. */
export function osc(env, hz, phase = 0) {
  const n = cyclesFor(hz, env.L);
  return Math.sin((TAU * n * env.t) / env.L + phase);
}

/** Smooth periodic noise in [-1,1] made of a few incommensurate-looking sines. */
export function pnoise(env, hz, seed = 0) {
  const r = mulberry32(seed);
  let v = 0;
  let w = 0;
  for (let k = 0; k < 4; k++) {
    const amp = 1 / (k + 1);
    v += amp * osc(env, hz * (1 + k * 0.73 + r() * 0.3), r() * TAU);
    w += amp;
  }
  return v / w;
}

/** Fraction 0..1 that advances `cycles` times per loop. */
export function frac(env, cycles, offset = 0) {
  const x = (env.t * cycles) / env.L + offset;
  return x - Math.floor(x);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
export function smooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const c = a.map((v, i) => Math.round(lerp(v, b[i], t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8);
}

/** Effective environment (time of day / weather) for a timeline segment. */
export function effectiveScene(project, seg) {
  const s = project.scene;
  return {
    ...s,
    timeOfDay: (seg && seg.timeOfDay) || s.timeOfDay,
    weather: (seg && seg.weather) || s.weather,
  };
}
