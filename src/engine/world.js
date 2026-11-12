// Backgrounds, sky, weather particles, lightning schedule, lighting pass.
import { TAU, mulberry32, osc, frac, cyclesFor, mix, rgba, lerp, clamp, DESIGN_W, DESIGN_H } from './util.js';

export const TIMES = { day: 'Ban ngày', sunset: 'Hoàng hôn', night: 'Ban đêm' };
export const WEATHERS = { clear: 'Quang đãng', rain: 'Mưa', storm: 'Giông bão', snow: 'Tuyết', fog: 'Sương mù' };

export function skyColors(tod, weather) {
  const overcast = weather === 'rain' || weather === 'storm' || weather === 'fog';
  const snowy = weather === 'snow';
  if (tod === 'night') {
    if (overcast) return ['#0c1018', '#232b38'];
    return ['#070d24', '#24345e'];
  }
  if (tod === 'sunset') {
    if (overcast) return ['#3d3a4a', '#9a8579'];
    return ['#3f3a78', '#ffb37d'];
  }
  if (overcast) return ['#7d8b99', '#c2cbd3'];
  if (snowy) return ['#b9c6d3', '#eef2f6'];
  return ['#6fb3f2', '#dcefff'];
}

/** Lightning: deterministic flash schedule, periodic in L. Shared with audio. */
export function lightningEvents(L, seed = 7) {
  const r = mulberry32(seed);
  const m = Math.max(1, Math.round(L / 24));
  const ev = [];
  for (let k = 0; k < m; k++) ev.push({ t: (L * (k + 0.25 + r() * 0.5)) / m, power: 0.6 + r() * 0.4, delay: 0.7 + r() * 1.6 });
  return ev;
}
export function lightningFlash(env) {
  if (env.weather !== 'storm') return 0;
  let f = 0;
  for (const e of lightningEvents(env.L)) {
    let d = env.t - e.t;
    if (d < 0) d += env.L;
    if (d < 0.6) {
      const a = Math.exp(-d * 9) + 0.6 * Math.exp(-Math.abs(d - 0.18) * 30);
      f = Math.max(f, a * e.power);
    }
  }
  return clamp(f, 0, 1);
}

// ---------------------------------------------------------------- sky view
export function drawSky(ctx, x, y, w, h, env, opts = {}) {
  const [top, bot] = skyColors(env.timeOfDay, env.weather);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const r = mulberry32(opts.seed || 11);
  const overcast = env.weather !== 'clear';

  if (env.timeOfDay === 'night' && !overcast) {
    for (let i = 0; i < Math.round((w * h) / 2600); i++) {
      const sx = x + r() * w;
      const sy = y + r() * h * 0.75;
      const tw = 0.55 + 0.45 * osc(env, 0.2 + r() * 0.6, r() * TAU);
      ctx.fillStyle = `rgba(255,250,230,${0.25 + 0.6 * tw * r()})`;
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
  }
  // sun / moon
  const cx = x + w * (opts.sunX ?? 0.72);
  const cy = y + h * (env.timeOfDay === 'sunset' ? 0.62 : 0.25);
  if (env.timeOfDay === 'night') {
    if (!overcast || env.weather === 'snow') {
      ctx.fillStyle = 'rgba(255,248,220,0.12)';
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.06, 0, TAU);
      ctx.fill();
      ctx.fillStyle = skyColors('night', 'clear')[0];
      ctx.beginPath();
      ctx.arc(cx + h * 0.025, cy - h * 0.01, h * 0.055, 0, TAU);
      ctx.fill();
    }
  } else if (!overcast || env.weather === 'snow') {
    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.35);
    const sc = env.timeOfDay === 'sunset' ? '255,170,90' : '255,250,220';
    sg.addColorStop(0, `rgba(${sc},0.9)`);
    sg.addColorStop(0.15, `rgba(${sc},0.5)`);
    sg.addColorStop(1, `rgba(${sc},0)`);
    ctx.fillStyle = sg;
    ctx.fillRect(x, y, w, h);
  }
  // clouds (gentle sway, periodic)
  const nClouds = overcast ? 9 : 4;
  for (let i = 0; i < nClouds; i++) {
    const bx = x + r() * w;
    const by = y + h * (0.08 + r() * (overcast ? 0.5 : 0.35));
    const s = (0.6 + r() * 0.8) * (h / 4);
    const sway = osc(env, 1 / 40, r() * TAU) * w * 0.03;
    const base = env.timeOfDay === 'night' ? (overcast ? '#2a313d' : '#334066') : env.timeOfDay === 'sunset' ? '#f2b8a0' : overcast ? '#9aa6b1' : '#ffffff';
    ctx.fillStyle = rgba(base, overcast ? 0.75 : env.timeOfDay === 'night' ? 0.4 : 0.85);
    cloud(ctx, bx + sway, by, s);
  }
  // distant hills / tree line
  if (opts.hills !== false) {
    const hillCol = env.timeOfDay === 'night' ? '#141c2c' : env.timeOfDay === 'sunset' ? '#5a4060' : env.weather === 'snow' ? '#e9eef3' : '#6f9a72';
    const hill2 = env.timeOfDay === 'night' ? '#0e1420' : env.timeOfDay === 'sunset' ? '#3f2c48' : env.weather === 'snow' ? '#cfd9e2' : '#4f7c57';
    hills(ctx, x, y + h * 0.7, w, h * 0.3, hillCol, 1.3, opts.seed || 3);
    treeLine(ctx, x, y + h * 0.82, w, h * 0.18, hill2, opts.seed || 5);
  }
}

export function cloud(ctx, x, y, s) {
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.9, s * 0.32, 0, 0, TAU);
  ctx.ellipse(x - s * 0.45, y + s * 0.05, s * 0.45, s * 0.25, 0, 0, TAU);
  ctx.ellipse(x + s * 0.2, y - s * 0.18, s * 0.45, s * 0.33, 0, 0, TAU);
  ctx.ellipse(x + s * 0.6, y + s * 0.02, s * 0.4, s * 0.22, 0, 0, TAU);
  ctx.fill();
}

export function hills(ctx, x, y, w, h, color, freq, seed) {
  const r = mulberry32(seed);
  const p = [r() * TAU, r() * TAU];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const yy = y + h * 0.35 + Math.sin(u * TAU * freq + p[0]) * h * 0.2 + Math.sin(u * TAU * freq * 2.7 + p[1]) * h * 0.08;
    ctx.lineTo(x + u * w, yy);
  }
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

export function treeLine(ctx, x, y, w, h, color, seed) {
  const r = mulberry32(seed);
  ctx.fillStyle = color;
  ctx.fillRect(x, y + h * 0.6, w, h * 0.4 + 2);
  const n = Math.max(6, Math.round(w / 28));
  for (let i = 0; i < n; i++) {
    const tx = x + (i + r() * 0.6) * (w / n);
    const th = h * (0.45 + r() * 0.55);
    const tw = th * 0.38;
    ctx.beginPath();
    ctx.moveTo(tx - tw, y + h * 0.7);
    ctx.lineTo(tx, y + h * 0.7 - th);
    ctx.lineTo(tx + tw, y + h * 0.7);
    ctx.fill();
  }
}

// ----------------------------------------------------------- precipitation
export function drawPrecip(ctx, x, y, w, h, env, opts = {}) {
  const weather = env.weather;
  if (weather === 'clear') return;
  const scale = opts.scale || 1;
  const r = mulberry32(opts.seed || 99);
  ctx.save();
  if (weather === 'rain' || weather === 'storm') {
    const density = (weather === 'storm' ? 1.0 : 0.6) * (opts.density || 1);
    const n = Math.round(((w * h) / 2600) * density);
    ctx.lineCap = 'round';
    const slant = weather === 'storm' ? 0.28 : 0.12;
    for (let i = 0; i < n; i++) {
      const depth = r();
      const len = (14 + depth * 22) * scale;
      const speed = (700 + depth * 900) * scale;
      const range = h + len;
      const cyc = cyclesFor(speed / range, env.L);
      const fy = frac(env, cyc, r());
      const yy = y - len + fy * range;
      const raw = r() * w + (yy - y) * slant;
      const xx = x + (((raw % w) + w) % w);
      ctx.strokeStyle = `rgba(200,215,235,${0.18 + depth * 0.35})`;
      ctx.lineWidth = (0.8 + depth * 1.3) * scale;
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx + len * slant, yy + len);
      ctx.stroke();
    }
  } else if (weather === 'snow') {
    const n = Math.round(((w * h) / 3800) * (opts.density || 1));
    for (let i = 0; i < n; i++) {
      const depth = r();
      const size = (1.2 + depth * 3.2) * scale;
      const speed = (30 + depth * 70) * scale;
      const range = h + 20;
      const cyc = cyclesFor(speed / range, env.L);
      const yy = y - 10 + frac(env, cyc, r()) * range;
      const xx = x + r() * w + osc(env, 0.15 + r() * 0.2, r() * TAU) * 18 * scale;
      ctx.fillStyle = `rgba(255,255,255,${0.45 + depth * 0.5})`;
      ctx.beginPath();
      ctx.arc(xx, yy, size, 0, TAU);
      ctx.fill();
    }
  } else if (weather === 'fog') {
    for (let i = 0; i < 6; i++) {
      const yy = y + h * (0.35 + r() * 0.6);
      const xx = x + r() * w + osc(env, 1 / 30, r() * TAU) * w * 0.08;
      const rad = w * (0.25 + r() * 0.3);
      const g = ctx.createRadialGradient(xx, yy, 0, xx, yy, rad);
      g.addColorStop(0, 'rgba(220,226,232,0.35)');
      g.addColorStop(1, 'rgba(220,226,232,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------- backgrounds
export function drawIndoorBackground(ctx, env, scene) {
  const W = DESIGN_W;
  const H = DESIGN_H;
  const floorY = H * (scene.floorLevel ?? 0.74);
  const wall = scene.wallColor || '#d9b48f';
  const g = ctx.createLinearGradient(0, 0, 0, floorY);
  g.addColorStop(0, mix(wall, '#3a2a22', 0.25));
  g.addColorStop(1, wall);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, floorY);
  // wallpaper: soft vertical stripes + tiny dots
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < W; x += 64) ctx.fillRect(x, 0, 26, floorY);
  ctx.fillStyle = 'rgba(90,50,30,0.06)';
  for (let x = 32; x < W; x += 64) for (let y = 30; y < floorY; y += 60) ctx.fillRect(x + 6, y, 3, 3);
  // wainscot
  const wy = floorY - H * 0.16;
  ctx.fillStyle = mix(wall, '#6b4a33', 0.45);
  ctx.fillRect(0, wy, W, floorY - wy);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let x = 20; x < W; x += 150) ctx.fillRect(x, wy + 18, 120, floorY - wy - 36);
  ctx.fillStyle = mix(wall, '#4a3020', 0.6);
  ctx.fillRect(0, wy - 8, W, 10);
  // floor planks
  const floor = scene.floorColor || '#8a5a3b';
  const fg = ctx.createLinearGradient(0, floorY, 0, H);
  fg.addColorStop(0, mix(floor, '#2a1a10', 0.25));
  fg.addColorStop(1, floor);
  ctx.fillStyle = fg;
  ctx.fillRect(0, floorY, W, H - floorY);
  ctx.strokeStyle = 'rgba(40,20,10,0.25)';
  ctx.lineWidth = 2;
  const r = mulberry32(21);
  for (let y = floorY + 22, row = 0; y < H; y += 26 + row * 6, row++) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    for (let x = r() * 200; x < W; x += 180 + r() * 160) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 22 - row * 5);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(30,15,8,0.45)';
  ctx.fillRect(0, floorY - 4, W, 8);
}

export function drawOutdoorBackground(ctx, env, scene) {
  const W = DESIGN_W;
  const H = DESIGN_H;
  const groundY = H * (scene.floorLevel ?? 0.74);
  drawSky(ctx, 0, 0, W, groundY + 40, env, { hills: false, seed: 4, sunX: 0.78 });
  const night = env.timeOfDay === 'night';
  const sunset = env.timeOfDay === 'sunset';
  const snow = env.weather === 'snow';
  hills(ctx, 0, groundY - H * 0.32, W, H * 0.4, night ? '#18223a' : sunset ? '#6a4a6e' : snow ? '#dfe7ee' : '#8fb38c', 1.1, 8);
  hills(ctx, 0, groundY - H * 0.2, W, H * 0.3, night ? '#121a2c' : sunset ? '#4d3756' : snow ? '#cdd8e2' : '#6f9b6c', 1.8, 9);
  treeLine(ctx, 0, groundY - H * 0.13, W, H * 0.15, night ? '#0c1220' : sunset ? '#33243d' : snow ? '#a9b8c4' : '#3f6a48', 12);
  const ground = scene.groundColor || (snow ? '#eef3f7' : '#6e9a4f');
  const gg = ctx.createLinearGradient(0, groundY, 0, H);
  gg.addColorStop(0, mix(ground, '#1d2a14', night ? 0.6 : 0.15));
  gg.addColorStop(1, mix(ground, '#000000', night ? 0.55 : 0.1));
  ctx.fillStyle = gg;
  ctx.fillRect(0, groundY, W, H - groundY);
  // grass blades (sway)
  if (!snow) {
    const r = mulberry32(31);
    ctx.strokeStyle = night ? 'rgba(20,40,25,0.8)' : 'rgba(60,100,40,0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 260; i++) {
      const gx = r() * W;
      const gy = groundY + 6 + r() * (H - groundY);
      const hh = 8 + r() * 16;
      const sw = osc(env, 0.3, gx * 0.01) * 3;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + sw * 0.5, gy - hh * 0.5, gx + sw, gy - hh);
      ctx.stroke();
    }
  }
}

// ------------------------------------------------------- lighting & extras
export function darknessFor(env, indoor) {
  let d = env.timeOfDay === 'night' ? 0.62 : env.timeOfDay === 'sunset' ? 0.28 : 0.06;
  if (env.weather === 'rain' || env.weather === 'storm') d += 0.1;
  if (indoor && env.timeOfDay === 'day') d += 0.06;
  return clamp(d, 0, 0.8);
}

let lightCanvas = null;
export function drawLighting(ctx, env, lights, indoor) {
  const W = DESIGN_W;
  const H = DESIGN_H;
  const dark = darknessFor(env, indoor);
  if (!lightCanvas) {
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = W / 2;
    lightCanvas.height = H / 2;
  }
  const lc = lightCanvas.getContext('2d');
  lc.setTransform(0.5, 0, 0, 0.5, 0, 0);
  lc.globalCompositeOperation = 'source-over';
  lc.clearRect(0, 0, W, H);
  const tint = env.timeOfDay === 'night' ? '#0a1030' : env.timeOfDay === 'sunset' ? '#3a1a30' : '#1a2030';
  lc.fillStyle = rgba(tint, dark);
  lc.fillRect(0, 0, W, H);
  lc.globalCompositeOperation = 'destination-out';
  for (const L of lights) {
    const g = lc.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    g.addColorStop(0, `rgba(0,0,0,${clamp(L.intensity, 0, 1)})`);
    g.addColorStop(0.45, `rgba(0,0,0,${clamp(L.intensity * 0.55, 0, 1)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }
  ctx.drawImage(lightCanvas, 0, 0, W, H);
  // warm additive glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    if (!L.glow) continue;
    const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r * 0.8);
    g.addColorStop(0, rgba(L.color || '#ffb060', L.glow * dark * 0.6 + L.glow * 0.08));
    g.addColorStop(1, rgba(L.color || '#ffb060', 0));
    ctx.fillStyle = g;
    ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }
  ctx.restore();
  const flash = lightningFlash(env);
  if (flash > 0) {
    ctx.fillStyle = `rgba(220,230,255,${flash * (indoor ? 0.18 : 0.45)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

export function drawDust(ctx, env, indoor) {
  const r = mulberry32(55);
  const W = DESIGN_W;
  const H = DESIGN_H;
  if (indoor) {
    for (let i = 0; i < 70; i++) {
      const cyc = 1;
      const fy = frac(env, cyc, r());
      const x = r() * W + osc(env, 0.05 + r() * 0.05, r() * TAU) * 40;
      const y = H - fy * (H + 40);
      ctx.fillStyle = `rgba(255,240,210,${0.08 + r() * 0.18})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + r() * 1.6, 0, TAU);
      ctx.fill();
    }
  } else if (env.timeOfDay === 'night' && env.weather === 'clear') {
    for (let i = 0; i < 40; i++) {
      const x = r() * W + osc(env, 0.07 + r() * 0.05, r() * TAU) * 60;
      const y = H * (0.45 + r() * 0.5) + osc(env, 0.09 + r() * 0.05, r() * TAU) * 40;
      const b = Math.max(0, osc(env, 0.25 + r() * 0.3, r() * TAU));
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, `rgba(220,255,140,${0.9 * b})`);
      g.addColorStop(1, 'rgba(220,255,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 14, y - 14, 28, 28);
    }
  }
}

export function drawVignette(ctx, strength = 0.45) {
  const W = DESIGN_W;
  const H = DESIGN_H;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export { lerp };
