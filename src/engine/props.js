// Procedural scene props. Each prop is drawn around its anchor point (x, y) =
// bottom-centre on the floor/wall, in a local space where scale 1 ≈ natural size.
// Replace any `draw` with an image later — the registry API stays the same.
import { TAU, mulberry32, osc, pnoise, frac, cyclesFor, mix, rgba, roundRect, clamp, lerp } from './util.js';
import { drawSky, drawPrecip, lightningFlash } from './world.js';
import { getDrawable } from './images.js';

// ---------------------------------------------------------------- flames
function flame(ctx, env, w, h, seed, intensity = 1) {
  const r = mulberry32(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const tongues = 6;
  for (let i = 0; i < tongues; i++) {
    const off = (i / (tongues - 1) - 0.5) * w * 0.7;
    const hh = h * (0.55 + r() * 0.45) * (0.8 + 0.2 * pnoise(env, 2.2 + r(), seed + i)) * intensity;
    const ww = w * (0.22 + r() * 0.12);
    const sway = pnoise(env, 1.4 + r(), seed * 3 + i) * ww * 0.6;
    const g = ctx.createLinearGradient(0, 0, 0, -hh);
    g.addColorStop(0, 'rgba(255,240,170,0.95)');
    g.addColorStop(0.35, 'rgba(255,170,60,0.85)');
    g.addColorStop(0.75, 'rgba(230,80,30,0.45)');
    g.addColorStop(1, 'rgba(200,40,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(off - ww, 0);
    ctx.bezierCurveTo(off - ww, -hh * 0.45, off + sway - ww * 0.3, -hh * 0.6, off + sway, -hh);
    ctx.bezierCurveTo(off + sway + ww * 0.3, -hh * 0.6, off + ww, -hh * 0.45, off + ww, 0);
    ctx.closePath();
    ctx.fill();
  }
  // core
  const cg = ctx.createRadialGradient(0, -h * 0.1, 0, 0, -h * 0.1, w * 0.5);
  cg.addColorStop(0, 'rgba(255,250,210,0.8)');
  cg.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(-w * 0.6, -h * 0.6, w * 1.2, h * 0.7);
  // embers
  for (let i = 0; i < 10; i++) {
    const cyc = cyclesFor(0.35 + r() * 0.4, env.L);
    const f = frac(env, cyc, r());
    const ex = (r() - 0.5) * w * 0.6 + Math.sin(f * TAU * 2 + i) * 8;
    const ey = -f * h * 1.6;
    ctx.fillStyle = `rgba(255,${150 + r() * 80},60,${(1 - f) * 0.9})`;
    ctx.fillRect(ex, ey, 2.5, 2.5);
  }
  ctx.restore();
}

function logs(ctx, w) {
  ctx.fillStyle = '#4a2e1e';
  roundRect(ctx, -w * 0.5, -16, w, 16, 8);
  ctx.fill();
  ctx.save();
  ctx.rotate(-0.18);
  ctx.fillStyle = '#5c3a25';
  roundRect(ctx, -w * 0.45, -26, w * 0.85, 15, 7);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#c99a6a';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, -8, 5, 8, 0, 0, TAU);
  ctx.fill();
}

const fireFlicker = (env, seed) => 0.85 + 0.15 * pnoise(env, 3, seed);

/**
 * Draw the live "outside view" (sky + precipitation + lightning + rain on glass + sheen)
 * clipped to a rectangle — no frame/curtains. Reused by the window prop and by
 * user-defined window regions placed over a background photo.
 */
export function drawWindowView(ctx, x, y, w, h, env, seed = 8) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  drawSky(ctx, x, y, w, h, env, { seed: 2, sunX: 0.7 });
  drawPrecip(ctx, x, y, w, h, env, { scale: 0.7, density: 1.4, seed: 4 });
  const f = lightningFlash(env);
  if (f > 0) {
    ctx.fillStyle = `rgba(230,235,255,${f * 0.75})`;
    ctx.fillRect(x, y, w, h);
  }
  if (env.weather === 'rain' || env.weather === 'storm') {
    const r = mulberry32(seed);
    for (let i = 0; i < 70; i++) {
      const dx = x + r() * w;
      const dy = y + r() * h;
      const rad = 1 + r() * 2.5;
      ctx.fillStyle = 'rgba(220,235,255,0.35)';
      ctx.beginPath();
      ctx.arc(dx, dy, rad, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 9; i++) {
      const cyc = cyclesFor(0.12 + r() * 0.15, env.L);
      const f2 = frac(env, cyc, r());
      const dx = x + r() * w;
      const dy = y + Math.pow(f2, 1.8) * (h + 20);
      ctx.strokeStyle = 'rgba(220,235,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(dx, dy - 40 * f2);
      ctx.lineTo(dx, dy);
      ctx.stroke();
      ctx.fillStyle = 'rgba(230,240,255,0.55)';
      ctx.beginPath();
      ctx.arc(dx, dy, 3, 0, TAU);
      ctx.fill();
    }
  }
  const sg = ctx.createLinearGradient(x, y, x + w, y + h);
  sg.addColorStop(0, 'rgba(255,255,255,0.10)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0)');
  sg.addColorStop(0.6, 'rgba(255,255,255,0.06)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ------------------------------------------------------------- registry
export const PROPS = {
  fireplace: {
    label: 'Lò sưởi',
    layer: 'back',
    sound: 'fire',
    w: 380,
    h: 400,
    draw(ctx, p, env) {
      const W = 380;
      const H = 400;
      // brick body
      ctx.fillStyle = '#7d4b38';
      ctx.fillRect(-W / 2, -H, W, H);
      ctx.strokeStyle = 'rgba(40,20,15,0.35)';
      ctx.lineWidth = 2;
      for (let y = -H + 60, row = 0; y < 0; y += 22, row++) {
        ctx.beginPath();
        ctx.moveTo(-W / 2, y);
        ctx.lineTo(W / 2, y);
        ctx.stroke();
        for (let x = -W / 2 + (row % 2) * 24; x < W / 2; x += 48) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 22);
          ctx.stroke();
        }
      }
      // mantel
      ctx.fillStyle = '#4b2f22';
      ctx.fillRect(-W / 2 - 26, -H, W + 52, 34);
      ctx.fillStyle = '#5e3c2b';
      ctx.fillRect(-W / 2 - 14, -H + 34, W + 28, 14);
      // firebox
      const fw = 220;
      const fh = 190;
      ctx.fillStyle = '#1a0f0b';
      ctx.beginPath();
      ctx.moveTo(-fw / 2, 0);
      ctx.lineTo(-fw / 2, -fh + 50);
      ctx.quadraticCurveTo(-fw / 2, -fh, 0, -fh);
      ctx.quadraticCurveTo(fw / 2, -fh, fw / 2, -fh + 50);
      ctx.lineTo(fw / 2, 0);
      ctx.closePath();
      ctx.fill();
      const ig = ctx.createRadialGradient(0, -30, 10, 0, -40, 160);
      ig.addColorStop(0, rgba('#ff8a30', 0.55 * fireFlicker(env, 5)));
      ig.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = ig;
      ctx.fill();
      ctx.save();
      ctx.translate(0, -18);
      flame(ctx, env, 150, 150, 17, fireFlicker(env, 9));
      ctx.restore();
      logs(ctx, 150);
      // hearth
      ctx.fillStyle = '#3b2a24';
      ctx.fillRect(-W / 2 - 30, -10, W + 60, 14);
      // mantel decor: two candles stand-ins
      ctx.fillStyle = '#e9dcc0';
      ctx.fillRect(-W / 2 + 20, -H - 40, 14, 40);
      ctx.fillStyle = '#d7c39b';
      ctx.fillRect(W / 2 - 50, -H - 30, 30, 30);
    },
    light: (p, env) => [{ x: 0, y: -90, r: 760, intensity: 0.9 * fireFlicker(env, 9), glow: 0.55, color: '#ff9a40' }],
  },

  window: {
    label: 'Cửa sổ (thời tiết)',
    layer: 'back',
    sound: 'glass',
    w: 440,
    h: 420,
    params: { curtains: true },
    draw(ctx, p, env) {
      const gw = 340;
      const gh = 300;
      const gx = -gw / 2;
      const gy = -gh - 40;
      drawWindowView(ctx, gx, gy, gw, gh, env, 8);
      // frame
      ctx.strokeStyle = '#f2e6d4';
      ctx.lineWidth = 16;
      ctx.strokeRect(gx, gy, gw, gh);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(0, gy + gh);
      ctx.moveTo(gx, gy + gh * 0.45);
      ctx.lineTo(gx + gw, gy + gh * 0.45);
      ctx.stroke();
      // sill
      ctx.fillStyle = '#e8d9c2';
      ctx.fillRect(gx - 30, gy + gh + 4, gw + 60, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(gx - 26, gy + gh + 22, gw + 52, 8);
      if (p.params?.curtains !== false) {
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(side * (gw / 2 + 18), gy - 30);
          const cw = 90;
          const sway = osc(env, 0.1, side) * 3;
          const g = ctx.createLinearGradient(-cw / 2, 0, cw / 2, 0);
          const c = p.params?.curtainColor || '#9b3d3d';
          g.addColorStop(0, mix(c, '#000000', 0.25));
          g.addColorStop(0.5, c);
          g.addColorStop(1, mix(c, '#000000', 0.3));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(-cw / 2, 0);
          ctx.lineTo(cw / 2, 0);
          ctx.quadraticCurveTo(cw / 2 - side * 10 + sway, gh * 0.6, cw / 2 - side * 30, gh + 70);
          ctx.lineTo(-cw / 2 + side * 0, gh + 70);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.15)';
          ctx.lineWidth = 3;
          for (let k = -1; k <= 1; k++) {
            ctx.beginPath();
            ctx.moveTo(k * 22, 0);
            ctx.lineTo(k * 22 - side * 8, gh + 68);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.fillStyle = '#5a3b2a';
        ctx.fillRect(-gw / 2 - 90, gy - 40, gw + 180, 12);
      }
    },
    light: (p, env) => {
      const k = env.timeOfDay === 'day' ? 0.75 : env.timeOfDay === 'sunset' ? 0.45 : 0.12;
      const c = env.timeOfDay === 'sunset' ? '#ffb070' : env.timeOfDay === 'night' ? '#8aa0ff' : '#e8f0ff';
      return [{ x: 0, y: -190, r: 620, intensity: k, glow: env.timeOfDay === 'night' ? 0.08 : 0.25, color: c }];
    },
  },

  bookshelf: {
    label: 'Kệ sách',
    layer: 'back',
    w: 300,
    h: 480,
    draw(ctx, p) {
      const W = 300;
      const H = 480;
      ctx.fillStyle = '#5a3826';
      ctx.fillRect(-W / 2, -H, W, H);
      ctx.fillStyle = '#3d2519';
      ctx.fillRect(-W / 2 + 14, -H + 14, W - 28, H - 28);
      const r = mulberry32(p.seed || 3);
      const colors = ['#b5523b', '#3f6e8c', '#d9a441', '#5f8a4f', '#8a4f7d', '#e6d3b3', '#2f4858', '#c46a3a'];
      const shelfH = (H - 28) / 4;
      for (let s = 0; s < 4; s++) {
        const by = -H + 14 + shelfH * (s + 1);
        ctx.fillStyle = '#6b4430';
        ctx.fillRect(-W / 2 + 10, by - 8, W - 20, 10);
        let x = -W / 2 + 22;
        while (x < W / 2 - 40) {
          const bw = 12 + r() * 14;
          const bh = shelfH * (0.55 + r() * 0.35);
          if (r() < 0.1) {
            x += 18;
            continue;
          }
          ctx.fillStyle = colors[Math.floor(r() * colors.length)];
          if (r() < 0.12 && x < W / 2 - 70) {
            ctx.save();
            ctx.translate(x, by - 8);
            ctx.rotate(-0.25);
            ctx.fillRect(0, -bh, bw, bh);
            ctx.restore();
            x += bw + 14;
          } else {
            ctx.fillRect(x, by - 8 - bh, bw, bh);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(x + 2, by - 8 - bh * 0.8, bw - 4, 3);
            x += bw + 1;
          }
        }
      }
      // small plant on top
      ctx.fillStyle = '#b86b45';
      ctx.fillRect(W / 2 - 80, -H - 36, 40, 36);
      ctx.fillStyle = '#4f8a4a';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(W / 2 - 60 + (i - 2.5) * 9, -H - 50 - (i % 2) * 8, 8, 20, (i - 2.5) * 0.3, 0, TAU);
        ctx.fill();
      }
    },
  },

  book: {
    label: 'Sách (lật trang)',
    layer: 'back',
    sound: 'pageflip',
    w: 160,
    h: 60,
    params: { style: 'open' },
    draw(ctx, p, env) {
      if (p.params?.style === 'stack') {
        const cols = ['#3f6e8c', '#b5523b', '#d9a441', '#5f8a4f'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = cols[i];
          const w = 150 - i * 12 + (i % 2) * 10;
          roundRect(ctx, -w / 2 + (i % 2) * 6, -22 * (i + 1), w, 20, 3);
          ctx.fill();
          ctx.fillStyle = '#f3ead8';
          ctx.fillRect(-w / 2 + (i % 2) * 6 + 6, -22 * (i + 1) + 4, w - 10, 3);
        }
        return;
      }
      ctx.fillStyle = '#7a3b2e';
      roundRect(ctx, -84, -16, 168, 16, 4);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#f6efe0';
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.quadraticCurveTo(side * 40, -34, side * 80, -24);
        ctx.lineTo(side * 80, -8);
        ctx.quadraticCurveTo(side * 40, -18, 0, -6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,60,40,0.25)';
        ctx.lineWidth = 1.5;
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(side * 14, -18 - k * 3 + 6);
          ctx.lineTo(side * 66, -24 - k * 3 + 8);
          ctx.stroke();
        }
      }
      // page turning periodically (visual matches pageflip sound events)
      const ev = pageFlipEvents(env.L, p.id);
      for (const e of ev) {
        let d = env.t - e;
        if (d < 0) d += env.L;
        if (d < 0.5) {
          const a = d / 0.5;
          ctx.save();
          ctx.scale(Math.cos(a * Math.PI), 1);
          ctx.fillStyle = '#fffaf0';
          ctx.beginPath();
          ctx.moveTo(0, -12);
          ctx.quadraticCurveTo(40, -40 - Math.sin(a * Math.PI) * 18, 78, -26);
          ctx.lineTo(78, -10);
          ctx.quadraticCurveTo(40, -18, 0, -6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    },
  },

  armchair: {
    label: 'Ghế bành',
    layer: 'back',
    w: 340,
    h: 320,
    params: { color: '#6d8b74' },
    draw(ctx, p) {
      const c = p.params?.color || '#6d8b74';
      const dark = mix(c, '#000000', 0.3);
      ctx.fillStyle = '#3b2518';
      ctx.fillRect(-140, -26, 16, 26);
      ctx.fillRect(124, -26, 16, 26);
      ctx.fillStyle = dark;
      roundRect(ctx, -150, -320, 300, 240, 60);
      ctx.fill();
      ctx.fillStyle = c;
      roundRect(ctx, -130, -300, 260, 200, 50);
      ctx.fill();
      ctx.fillStyle = mix(c, '#ffffff', 0.08);
      roundRect(ctx, -150, -130, 300, 104, 30);
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.fillStyle = dark;
        roundRect(ctx, s * 170 - 40, -200, 80, 180, 36);
        ctx.fill();
        ctx.fillStyle = mix(c, '#ffffff', 0.05);
        ctx.beginPath();
        ctx.ellipse(s * 170, -196, 40, 22, 0, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-120, -128);
      ctx.lineTo(120, -128);
      ctx.stroke();
    },
  },

  rug: {
    label: 'Thảm',
    layer: 'back',
    w: 640,
    h: 100,
    params: { color: '#a8473b' },
    draw(ctx, p) {
      const c = p.params?.color || '#a8473b';
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(0, -30, 330, 54, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, -36, 320, 50, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = mix(c, '#f3d9a8', 0.6);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(0, -36, 270, 38, 0, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -36, 200, 26, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = mix(c, '#f3d9a8', 0.5);
      ctx.beginPath();
      ctx.ellipse(0, -36, 70, 10, 0, 0, TAU);
      ctx.fill();
    },
  },

  catbed: {
    label: 'Ổ nằm / đệm',
    layer: 'back',
    w: 260,
    h: 90,
    params: { color: '#d98b6a' },
    draw(ctx, p) {
      const c = p.params?.color || '#d98b6a';
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(0, -8, 140, 20, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = mix(c, '#000000', 0.2);
      ctx.beginPath();
      ctx.ellipse(0, -40, 130, 44, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = mix(c, '#fff4e0', 0.55);
      ctx.beginPath();
      ctx.ellipse(0, -46, 100, 28, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(0, -22, 130, 24, 0, 0, Math.PI);
      ctx.fill();
    },
  },

  lamp: {
    label: 'Đèn cây',
    layer: 'back',
    w: 160,
    h: 460,
    draw(ctx) {
      ctx.fillStyle = '#2d2420';
      ctx.beginPath();
      ctx.ellipse(0, -6, 50, 10, 0, 0, TAU);
      ctx.fill();
      ctx.fillRect(-4, -380, 8, 376);
      ctx.fillStyle = '#f2d7a6';
      ctx.beginPath();
      ctx.moveTo(-50, -380);
      ctx.lineTo(50, -380);
      ctx.lineTo(30, -460);
      ctx.lineTo(-30, -460);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,230,170,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, -380, 50, 7, 0, 0, TAU);
      ctx.fill();
    },
    light: () => [{ x: 0, y: -400, r: 520, intensity: 0.8, glow: 0.5, color: '#ffc874' }],
  },

  candle: {
    label: 'Nến',
    layer: 'front',
    w: 50,
    h: 90,
    draw(ctx, p, env) {
      ctx.fillStyle = '#c9b48a';
      ctx.beginPath();
      ctx.ellipse(0, -4, 26, 6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#f4ecd8';
      ctx.fillRect(-12, -60, 24, 56);
      ctx.fillStyle = '#e5d9bf';
      ctx.beginPath();
      ctx.ellipse(0, -60, 12, 4, 0, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(0, -62);
      ctx.globalCompositeOperation = 'lighter';
      const h = 26 * (0.85 + 0.15 * pnoise(env, 3, 31));
      const sw = pnoise(env, 1.1, 77) * 3;
      const g = ctx.createLinearGradient(0, 0, 0, -h);
      g.addColorStop(0, 'rgba(255,240,180,1)');
      g.addColorStop(0.6, 'rgba(255,170,60,0.8)');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(-6, -h * 0.6, sw, -h);
      ctx.quadraticCurveTo(6, -h * 0.6, 6, 0);
      ctx.fill();
      ctx.restore();
    },
    light: (p, env) => [{ x: 0, y: -80, r: 260, intensity: 0.7 * (0.9 + 0.1 * pnoise(env, 3, 31)), glow: 0.6, color: '#ffb35c' }],
  },

  mug: {
    label: 'Cốc trà nóng',
    layer: 'front',
    w: 80,
    h: 140,
    draw(ctx, p, env) {
      ctx.fillStyle = p.params?.color || '#e4e0d8';
      roundRect(ctx, -26, -60, 52, 60, 8);
      ctx.fill();
      ctx.strokeStyle = p.params?.color || '#e4e0d8';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(28, -32, 13, -1.2, 1.2);
      ctx.stroke();
      ctx.fillStyle = '#6b3e22';
      ctx.beginPath();
      ctx.ellipse(0, -58, 22, 5, 0, 0, TAU);
      ctx.fill();
      // steam
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const f = frac(env, cyclesFor(0.25, env.L), i / 3);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * Math.sin(f * Math.PI)})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        const bx = (i - 1) * 10;
        const y0 = -66 - f * 70;
        ctx.moveTo(bx, y0);
        ctx.bezierCurveTo(bx + 12, y0 - 15, bx - 12, y0 - 30, bx + 4, y0 - 45);
        ctx.stroke();
      }
    },
  },

  plant: {
    label: 'Chậu cây',
    layer: 'back',
    w: 200,
    h: 300,
    draw(ctx, p, env) {
      ctx.fillStyle = '#b8653f';
      ctx.beginPath();
      ctx.moveTo(-50, -90);
      ctx.lineTo(50, -90);
      ctx.lineTo(38, 0);
      ctx.lineTo(-38, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9a4f30';
      ctx.fillRect(-56, -100, 112, 16);
      const r = mulberry32(p.seed || 9);
      for (let i = 0; i < 9; i++) {
        const ang = -Math.PI / 2 + (i / 8 - 0.5) * 2.2 + osc(env, 0.12, i) * 0.03;
        const len = 120 + r() * 90;
        ctx.save();
        ctx.translate(0, -96);
        ctx.rotate(ang + Math.PI / 2);
        ctx.strokeStyle = '#3f6b3a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -len);
        ctx.stroke();
        ctx.fillStyle = i % 2 ? '#4f8a4a' : '#5f9e55';
        ctx.beginPath();
        ctx.ellipse(0, -len, 26, 48, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,60,30,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -len + 44);
        ctx.lineTo(0, -len - 44);
        ctx.stroke();
        ctx.restore();
      }
    },
  },

  clock: {
    label: 'Đồng hồ treo (tích tắc)',
    layer: 'back',
    sound: 'tick',
    w: 140,
    h: 280,
    draw(ctx, p, env) {
      ctx.fillStyle = '#5a3826';
      roundRect(ctx, -50, -280, 100, 280, 18);
      ctx.fill();
      ctx.fillStyle = '#f4ead6';
      ctx.beginPath();
      ctx.arc(0, -220, 38, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#3a2418';
      ctx.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * 30, -220 - Math.cos(a) * 30);
        ctx.lineTo(Math.sin(a) * 35, -220 - Math.cos(a) * 35);
        ctx.stroke();
      }
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -220);
      ctx.lineTo(16, -232);
      ctx.moveTo(0, -220);
      ctx.lineTo(-4, -248);
      ctx.stroke();
      // pendulum: 1 swing per second (matches tick sound)
      ctx.fillStyle = '#2a1a12';
      ctx.fillRect(-30, -170, 60, 150);
      const n = Math.round(env.L / 2);
      const ang = Math.sin((TAU * n * env.t) / env.L) * 0.28;
      ctx.save();
      ctx.translate(0, -168);
      ctx.rotate(ang);
      ctx.strokeStyle = '#c9a04a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 110);
      ctx.stroke();
      ctx.fillStyle = '#d9b25a';
      ctx.beginPath();
      ctx.arc(0, 118, 13, 0, TAU);
      ctx.fill();
      ctx.restore();
    },
  },

  vinyl: {
    label: 'Máy hát đĩa than',
    layer: 'back',
    sound: 'vinyl',
    w: 240,
    h: 260,
    draw(ctx, p, env) {
      ctx.fillStyle = '#6b4430';
      ctx.fillRect(-110, -170, 220, 170);
      ctx.fillStyle = '#5a3826';
      ctx.fillRect(-100, -150, 95, 140);
      ctx.fillRect(5, -150, 95, 140);
      ctx.fillStyle = '#3a2418';
      ctx.fillRect(-120, -200, 240, 32);
      ctx.save();
      ctx.translate(-10, -200);
      ctx.scale(1, 0.32);
      ctx.fillStyle = '#121212';
      ctx.beginPath();
      ctx.arc(0, -10, 80, 0, TAU);
      ctx.fill();
      const rot = (TAU * Math.round(env.L * 0.55) * env.t) / env.L;
      ctx.rotate(rot);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let k = 30; k < 78; k += 8) {
        ctx.beginPath();
        ctx.arc(0, 0, k, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#f5e6c8';
      ctx.fillRect(-4, -14, 8, 8);
      ctx.restore();
      ctx.strokeStyle = '#c9c9c9';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(95, -215);
      ctx.lineTo(70, -200);
      ctx.lineTo(30, -204);
      ctx.stroke();
    },
  },

  fgLeaves: {
    label: 'Lá cây tiền cảnh (mờ)',
    layer: 'front',
    blur: 7,
    w: 500,
    h: 500,
    draw(ctx, p, env) {
      const r = mulberry32(p.seed || 41);
      for (let i = 0; i < 7; i++) {
        const ang = -1.2 + i * 0.32 + osc(env, 0.1, i) * 0.03;
        const len = 220 + r() * 220;
        ctx.save();
        ctx.rotate(ang);
        ctx.strokeStyle = '#1f3a22';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -len);
        ctx.stroke();
        ctx.fillStyle = i % 2 ? '#24452a' : '#2d5433';
        ctx.beginPath();
        ctx.ellipse(0, -len, 60, 120, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    },
  },

  fgTable: {
    label: 'Bàn tiền cảnh (mờ)',
    layer: 'front',
    blur: 5,
    w: 700,
    h: 260,
    draw(ctx, p, env) {
      ctx.fillStyle = '#3e2618';
      ctx.fillRect(-350, -120, 700, 40);
      ctx.fillStyle = '#2f1c12';
      ctx.fillRect(-330, -80, 40, 80);
      ctx.fillRect(290, -80, 40, 80);
      ctx.fillStyle = '#e8e2d4';
      roundRect(ctx, -120, -200, 80, 80, 10);
      ctx.fill();
      const f = frac(env, cyclesFor(0.2, env.L));
      ctx.strokeStyle = `rgba(255,255,255,${0.3 * Math.sin(f * Math.PI)})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(-80, -210 - f * 80);
      ctx.bezierCurveTo(-60, -230 - f * 80, -100, -250 - f * 80, -80, -280 - f * 80);
      ctx.stroke();
      const cols = ['#3f6e8c', '#b5523b', '#d9a441'];
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(40 - i * 6, -150 - i * 30, 220 - i * 20, 28);
      });
    },
  },

  // ------------------------------------------------------------ outdoor
  campfire: {
    label: 'Lửa trại',
    layer: 'back',
    sound: 'fire',
    w: 220,
    h: 220,
    draw(ctx, p, env) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, -6, 110, 18, 0, 0, TAU);
      ctx.fill();
      const r = mulberry32(14);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        ctx.fillStyle = mix('#7d7d7d', '#4a4a4a', r());
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 90, -10 + Math.sin(a) * 14, 22, 14, 0, 0, TAU);
        ctx.fill();
      }
      logs(ctx, 130);
      ctx.save();
      ctx.translate(0, -20);
      flame(ctx, env, 130, 170, 23, fireFlicker(env, 3));
      ctx.restore();
    },
    light: (p, env) => [{ x: 0, y: -80, r: 820, intensity: 0.95 * fireFlicker(env, 3), glow: 0.6, color: '#ff9a40' }],
  },

  tent: {
    label: 'Lều',
    layer: 'back',
    w: 420,
    h: 300,
    params: { color: '#d9824a', glow: true },
    draw(ctx, p, env) {
      const c = p.params?.color || '#d9824a';
      ctx.fillStyle = mix(c, '#000000', 0.3);
      ctx.beginPath();
      ctx.moveTo(-210, 0);
      ctx.lineTo(0, -290);
      ctx.lineTo(210, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-180, 0);
      ctx.lineTo(0, -280);
      ctx.lineTo(60, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.params?.glow ? `rgba(255,200,110,${0.85 + 0.1 * pnoise(env, 0.5, 2)})` : '#2a1a12';
      ctx.beginPath();
      ctx.moveTo(-40, 0);
      ctx.lineTo(10, -160);
      ctx.lineTo(60, 0);
      ctx.closePath();
      ctx.fill();
    },
    light: (p) => (p.params?.glow ? [{ x: 10, y: -60, r: 340, intensity: 0.6, glow: 0.35, color: '#ffc06a' }] : []),
  },

  tree: {
    label: 'Cây lớn',
    layer: 'back',
    w: 420,
    h: 640,
    draw(ctx, p, env) {
      ctx.fillStyle = '#4a3020';
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(-20, -330);
      ctx.lineTo(20, -330);
      ctx.lineTo(34, 0);
      ctx.closePath();
      ctx.fill();
      const snow = env.weather === 'snow';
      const r = mulberry32(p.seed || 19);
      for (let i = 0; i < 9; i++) {
        const sx = (r() - 0.5) * 300 + osc(env, 0.08, i) * 6;
        const sy = -360 - r() * 240;
        const rad = 90 + r() * 70;
        ctx.fillStyle = mix('#2f5d3a', '#4f8a4f', r());
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, TAU);
        ctx.fill();
        if (snow) {
          ctx.fillStyle = 'rgba(245,250,255,0.85)';
          ctx.beginPath();
          ctx.ellipse(sx, sy - rad * 0.7, rad * 0.7, rad * 0.25, 0, 0, TAU);
          ctx.fill();
        }
      }
    },
  },

  lantern: {
    label: 'Đèn lồng',
    layer: 'back',
    w: 60,
    h: 130,
    draw(ctx, p, env) {
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(-26, -12, 52, 12);
      ctx.fillRect(-20, -100, 40, 10);
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -112, 14, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,205,120,${0.85 + 0.1 * pnoise(env, 2, 5)})`;
      ctx.fillRect(-20, -90, 40, 78);
      ctx.strokeRect(-20, -90, 40, 78);
    },
    light: (p, env) => [{ x: 0, y: -55, r: 300, intensity: 0.75 * (0.92 + 0.08 * pnoise(env, 2, 5)), glow: 0.55, color: '#ffc06a' }],
  },

  pond: {
    label: 'Ao nước (câu cá)',
    layer: 'back',
    sound: 'water',
    w: 600,
    h: 120,
    draw(ctx, p, env) {
      const night = env.timeOfDay === 'night';
      ctx.fillStyle = night ? '#16233a' : '#4f7fa3';
      ctx.beginPath();
      ctx.ellipse(0, -50, 300, 56, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = night ? 'rgba(150,180,220,0.25)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const f = frac(env, cyclesFor(0.15, env.L), i / 4);
        ctx.globalAlpha = 1 - f;
        ctx.beginPath();
        ctx.ellipse(-60 + i * 50, -50, 20 + f * 90, 4 + f * 16, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#6b6b5b';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 300, -50 + Math.sin(a) * 56, 22, 12, 0, 0, TAU);
        ctx.fill();
      }
    },
  },

  rock: {
    label: 'Tảng đá',
    layer: 'back',
    w: 200,
    h: 120,
    draw(ctx) {
      ctx.fillStyle = '#6f6f68';
      ctx.beginPath();
      ctx.moveTo(-100, 0);
      ctx.quadraticCurveTo(-90, -110, 0, -110);
      ctx.quadraticCurveTo(100, -100, 100, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(-20, -80, 40, 16, -0.3, 0, TAU);
      ctx.fill();
    },
  },

  fgGrass: {
    label: 'Cỏ tiền cảnh (mờ)',
    layer: 'front',
    blur: 6,
    w: 700,
    h: 260,
    draw(ctx, p, env) {
      const r = mulberry32(p.seed || 61);
      ctx.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const x = (r() - 0.5) * 700;
        const h = 120 + r() * 160;
        const sw = osc(env, 0.2, i) * 14;
        ctx.strokeStyle = r() < 0.5 ? '#21401f' : '#2c5428';
        ctx.lineWidth = 8 + r() * 6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + sw * 0.4, -h * 0.5, x + sw + (r() - 0.5) * 40, -h);
        ctx.stroke();
      }
    },
  },

  stream: {
    label: 'Suối / thác nhỏ',
    layer: 'back',
    sound: 'stream',
    w: 540,
    h: 110,
    draw(ctx, p, env) {
      const night = env.timeOfDay === 'night';
      const deep = night ? '#16293f' : '#3f6f93';
      const shallow = night ? '#22405f' : '#5b93b4';
      // water body
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.ellipse(0, -40, 250, 44, 0, 0, TAU);
      ctx.fill();
      // flowing highlight bands drifting left → right
      ctx.strokeStyle = night ? 'rgba(150,185,225,0.3)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const f = frac(env, cyclesFor(0.4, env.L), i / 6);
        const x = -230 + f * 460;
        const yy = -40 + Math.sin((i + f) * 3) * 16;
        ctx.globalAlpha = Math.sin(Math.PI * f) * 0.8;
        ctx.beginPath();
        ctx.ellipse(x, yy, 38, 6, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // little cascade lip on the right with falling streaks
      ctx.fillStyle = shallow;
      ctx.fillRect(168, -72, 92, 22);
      ctx.strokeStyle = night ? 'rgba(170,200,235,0.5)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 4;
      for (let i = 0; i < 5; i++) {
        const f = frac(env, cyclesFor(1.2, env.L), i / 5);
        const x = 180 + i * 18;
        ctx.globalAlpha = 1 - f;
        ctx.beginPath();
        ctx.moveTo(x, -64);
        ctx.lineTo(x + 4, -64 + f * 46);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // bank stones
      ctx.fillStyle = '#6b6b5b';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 250, -40 + Math.sin(a) * 44, 20, 11, 0, 0, TAU);
        ctx.fill();
      }
    },
  },

  windchime: {
    label: 'Chuông gió',
    layer: 'back',
    sound: 'chime',
    w: 110,
    h: 240,
    draw(ctx, p, env) {
      const windy = env.weather === 'storm' ? 2.2 : env.weather === 'snow' ? 1.4 : 1;
      const sway = osc(env, 0.18, 7) * 0.06 * windy;
      ctx.save();
      ctx.translate(0, -212);
      ctx.rotate(sway);
      // top hanger
      ctx.fillStyle = '#6b4a2e';
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 10, 0, 0, TAU);
      ctx.fill();
      // metal tubes
      const tubes = [120, 150, 134, 166, 126];
      for (let i = 0; i < tubes.length; i++) {
        const x = -32 + i * 16;
        const len = tubes[i];
        ctx.strokeStyle = 'rgba(80,60,40,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 6);
        ctx.stroke();
        ctx.fillStyle = '#c9cdd4';
        ctx.fillRect(x - 4, 6, 8, len);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x - 3, 6, 2, len);
      }
      // central cord, clapper and wind sail
      const sailSway = osc(env, 0.5, 3) * 10 * windy;
      ctx.strokeStyle = 'rgba(80,60,40,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(sailSway * 0.4, 150);
      ctx.stroke();
      ctx.fillStyle = '#8a5a34';
      ctx.beginPath();
      ctx.arc(sailSway * 0.4, 150, 13, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#9b6b3e';
      ctx.beginPath();
      ctx.moveTo(-17 + sailSway, 168);
      ctx.lineTo(17 + sailSway, 168);
      ctx.lineTo(10 + sailSway, 205);
      ctx.lineTo(-10 + sailSway, 205);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  },

  foliage: {
    label: 'Bụi cây (lá xào xạc)',
    layer: 'back',
    sound: 'rustle',
    w: 420,
    h: 340,
    draw(ctx, p, env) {
      const r = mulberry32(p.seed || 37);
      const windy = env.weather === 'storm' ? 2.4 : env.weather === 'snow' ? 1.4 : 1;
      const gust = osc(env, 0.25, 4) * windy;
      const snow = env.weather === 'snow';
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(0, -6, 150, 16, 0, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 7; i++) {
        const bx = (r() - 0.5) * 280;
        const by = -60 - r() * 150;
        const rad = 58 + r() * 55;
        const swayX = gust * (by < -130 ? 18 : 8);
        ctx.fillStyle = mix('#28502b', '#59934f', r());
        ctx.beginPath();
        ctx.arc(bx + swayX, by, rad, 0, TAU);
        ctx.fill();
        if (snow) {
          ctx.fillStyle = 'rgba(245,250,255,0.8)';
          ctx.beginPath();
          ctx.ellipse(bx + swayX, by - rad * 0.6, rad * 0.7, rad * 0.22, 0, 0, TAU);
          ctx.fill();
        }
      }
    },
  },

  image: {
    label: 'Ảnh / GIF / video của bạn',
    layer: 'back',
    w: 300,
    h: 300,
    params: { src: '', mediaType: 'image', natW: 300, natH: 360 },
    size: (p) => ({ w: p.params?.natW || 300, h: p.params?.natH || 360 }),
    draw(ctx, p, env) {
      const w = p.params?.natW || 300;
      const h = p.params?.natH || 360;
      const d = getDrawable('prop:' + p.id, env.t);
      if (d) {
        try {
          ctx.drawImage(d, -w / 2, -h, w, h);
        } catch (_) {}
      } else {
        // placeholder while the image loads (or if it failed)
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-w / 2, -h, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '600 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.params?.src ? 'Đang tải ảnh…' : 'Chưa chọn ảnh', 0, -h / 2);
        ctx.textAlign = 'left';
      }
    },
  },

  fountain: {
    label: 'Đài phun nước',
    layer: 'back',
    sound: 'fountain',
    w: 280,
    h: 340,
    draw(ctx, p, env) {
      const night = env.timeOfDay === 'night';
      const stone = '#9a948a';
      const stoneD = '#6f6a62';
      const water = night ? '#2a4a63' : '#5f93b4';
      // base pool
      ctx.fillStyle = stoneD;
      ctx.beginPath();
      ctx.ellipse(0, -10, 130, 30, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.ellipse(0, -16, 112, 22, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const f = frac(env, cyclesFor(0.3, env.L), i / 3);
        ctx.globalAlpha = 1 - f;
        ctx.beginPath();
        ctx.ellipse(0, -16, 20 + f * 80, 4 + f * 15, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // pedestal + upper bowl
      ctx.fillStyle = stone;
      ctx.fillRect(-22, -140, 44, 128);
      ctx.fillStyle = stoneD;
      ctx.beginPath();
      ctx.ellipse(0, -150, 70, 18, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.ellipse(0, -154, 58, 12, 0, 0, TAU);
      ctx.fill();
      // top spout
      ctx.fillStyle = stone;
      ctx.fillRect(-8, -208, 16, 58);
      ctx.beginPath();
      ctx.arc(0, -210, 12, 0, TAU);
      ctx.fill();
      // falling water: top jet + bowl overflow streaks
      ctx.strokeStyle = night ? 'rgba(170,205,235,0.55)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const f = frac(env, cyclesFor(1.4, env.L), i / 6);
        ctx.globalAlpha = 1 - f;
        const jx = Math.sin(i * 1.7) * 26;
        ctx.beginPath();
        ctx.moveTo(jx, -198 + f * 44);
        ctx.lineTo(jx, -192 + f * 44);
        ctx.stroke();
        const side = i % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(side * 54, -148 + f * 8);
        ctx.lineTo(side * 60, -148 + f * 128);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
};

/** Page-flip times for a book prop, shared by visual and audio. */
export function pageFlipEvents(L, id = 'book') {
  const r = mulberry32((id || 'book').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const n = Math.max(1, Math.round(L / 14));
  const out = [];
  for (let k = 0; k < n; k++) out.push(((k + 0.2 + r() * 0.6) * L) / n);
  return out;
}

/** Design-space size of a prop (fixed, or dynamic via def.size for uploaded images). */
function sizeOf(def, p) {
  if (def?.size) return def.size(p);
  return { w: def?.w || 100, h: def?.h || 100 };
}

export function propLights(p, env) {
  const def = PROPS[p.type];
  if (!def?.light || p.enabled === false) return [];
  const s = p.scale || 1;
  return def.light(p, env).map((l) => ({ ...l, x: p.x + l.x * s * (p.flip ? -1 : 1), y: p.y + l.y * s, r: l.r * s }));
}

export function drawProp(ctx, p, env) {
  const def = PROPS[p.type];
  if (!def || p.enabled === false) return;
  const s = p.scale || 1;
  const blur = p.blur ?? def.blur ?? 0;
  if (blur > 0) return drawBlurred(ctx, p, def, env, s, blur);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(s * (p.flip ? -1 : 1), s);
  def.draw(ctx, p, env);
  ctx.restore();
}

// Blur is expensive on a full 1080p canvas: draw the prop into a small half-res
// offscreen canvas covering only its bounds, then blur while compositing.
const blurCanvases = new Map();
function drawBlurred(ctx, p, def, env, s, blur) {
  const k = 0.5; // offscreen resolution relative to design px
  const pad = 0.35;
  const sz = sizeOf(def, p);
  const w = sz.w * s * (1 + pad * 2);
  const h = sz.h * s * (1 + pad * 2);
  const ox = p.x - w / 2;
  const oy = p.y - sz.h * s * (1 + pad);
  let oc = blurCanvases.get(p.id);
  const cw = Math.ceil(w * k);
  const chh = Math.ceil(h * k);
  if (!oc) {
    oc = document.createElement('canvas');
    blurCanvases.set(p.id, oc);
  }
  if (oc.width !== cw || oc.height !== chh) {
    oc.width = cw;
    oc.height = chh;
  }
  const o = oc.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, cw, chh);
  o.setTransform(k, 0, 0, k, -ox * k, -oy * k);
  o.translate(p.x, p.y);
  o.scale(s * (p.flip ? -1 : 1), s);
  def.draw(o, p, env);
  ctx.save();
  // filter radius is in destination pixels; scale it with the output transform
  const sx = ctx.getTransform().a;
  ctx.filter = `blur(${(blur * sx).toFixed(2)}px)`;
  ctx.drawImage(oc, ox, oy, w, h);
  ctx.restore();
}

export function propBounds(p) {
  const def = PROPS[p.type];
  const s = p.scale || 1;
  const sz = sizeOf(def, p);
  const w = sz.w * s;
  const h = sz.h * s;
  return { x: p.x - w / 2, y: p.y - h, w, h };
}

export { lerp, clamp, rgba };
