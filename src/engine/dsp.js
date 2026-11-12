// Pure-JS ASMR sound synthesis (no WebAudio needed, works in Node too).
// Every layer is a PERIODIC signal of N samples: filters are run twice to reach
// steady state, events wrap around the end. Repeating the buffer is seamless.
import { mulberry32 } from './util.js';

export const SR = 48000;

export function white(N, seed) {
  const r = mulberry32(seed);
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = r() * 2 - 1;
  return x;
}

/** RBJ biquad, periodic (2 passes). type: lowpass|highpass|bandpass|peak */
export function biquad(x, type, f, Q = 0.707, gainDb = 0, sr = SR, periodic = true) {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cs = Math.cos(w0);
  const sn = Math.sin(w0);
  const al = sn / (2 * Q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  } else if (type === 'highpass') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  } else if (type === 'bandpass') {
    b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  } else {
    b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const N = x.length;
  const y = new Float32Array(N);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const passes = periodic ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < N; i++) {
      const xi = x[i];
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi;
      if (p === passes - 1) y[i] = yi;
    }
  }
  return y;
}

export function scale(x, g) {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** Multiply by a periodic gain function g(tSeconds). */
export function am(x, g, sr = SR) {
  for (let i = 0; i < x.length; i++) x[i] *= g(i / sr);
  return x;
}

/** Add an event into a periodic buffer (wraps). */
export function place(buf, ev, atSec, gain = 1, sr = SR) {
  const N = buf.length;
  let s = Math.round(atSec * sr) % N;
  if (s < 0) s += N;
  for (let i = 0; i < ev.length; i++) {
    buf[(s + i) % N] += ev[i] * gain;
  }
}

/** Integer cycles per loop for an LFO. */
export const lfo = (hz, L) => Math.max(1, Math.round(hz * L)) / L;

// ------------------------------------------------------------ event synths
function env(len, attack, decay, sr = SR) {
  const n = Math.round(len * sr);
  const e = new Float32Array(n);
  const a = Math.max(1, Math.round(attack * sr));
  for (let i = 0; i < n; i++) e[i] = i < a ? i / a : Math.exp(-(i - a) / (decay * sr));
  return e;
}

export function click(r, f = 3000, decay = 0.004, sr = SR) {
  const n = Math.round(decay * 8 * sr);
  const x = new Float32Array(n);
  const ph = r() * 6.28;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = (Math.sin(2 * Math.PI * f * t + ph) * 0.6 + (r() * 2 - 1) * 0.6) * Math.exp(-t / decay);
  }
  return x;
}

export function noiseBurst(r, dur, attack, decay, filt, sr = SR) {
  const e = env(dur, attack, decay, sr);
  let x = new Float32Array(e.length);
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  for (const [type, f, Q] of filt) x = biquad(x, type, f, Q || 0.7, 0, sr, false);
  for (let i = 0; i < x.length; i++) x[i] *= e[i];
  return x;
}

export function thunder(r, power = 1, sr = SR) {
  const dur = 5 + power * 3;
  const n = Math.round(dur * sr);
  let x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  x = biquad(x, 'lowpass', 160, 0.8, 0, sr, false);
  x = biquad(x, 'lowpass', 220, 0.7, 0, sr, false);
  const rumbles = 3 + Math.floor(r() * 4);
  const bumps = [];
  for (let k = 0; k < rumbles; k++) bumps.push([r() * dur * 0.5, 0.3 + r() * 0.7]);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = Math.min(1, t / 0.08) * Math.exp(-t / (1.4 + power));
    for (const [bt, ba] of bumps) g += ba * Math.exp(-Math.abs(t - bt) / 0.35) * 0.5;
    x[i] *= g * 9 * power;
  }
  return x;
}

export function pageFlip(r, sr = SR) {
  const dur = 0.55;
  const n = Math.round(dur * sr);
  let x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  x = biquad(x, 'bandpass', 2800, 0.6, 0, sr, false);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const sw = Math.sin(Math.PI * Math.min(1, t / 0.45));
    const flutter = 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 38) * Math.sin(t * 2 * Math.PI * 7);
    x[i] *= sw * flutter * 1.6;
  }
  // final soft "flap"
  const flap = noiseBurst(r, 0.12, 0.003, 0.03, [['lowpass', 900]], sr);
  for (let i = 0; i < flap.length && i + Math.round(0.42 * sr) < n; i++) x[i + Math.round(0.42 * sr)] += flap[i] * 1.5;
  return x;
}

export function plop(r, f0 = 700, f1 = 180, dur = 0.12, sr = SR) {
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / dur / sr;
    const f = f0 * Math.pow(f1 / f0, t);
    ph += (2 * Math.PI * f) / sr;
    x[i] = Math.sin(ph) * Math.sin(Math.PI * Math.min(1, t * 6)) * (1 - t);
  }
  return x;
}

export function chirp(r, sr = SR) {
  // small bird: 2-4 quick sine sweeps
  const notes = 2 + Math.floor(r() * 3);
  const base = 2500 + r() * 2500;
  const n = Math.round(notes * 0.11 * sr);
  const x = new Float32Array(n);
  for (let k = 0; k < notes; k++) {
    const s0 = Math.round(k * 0.11 * sr);
    const len = Math.round(0.07 * sr);
    let ph = 0;
    const up = r() < 0.5;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / len;
      const f = base * (up ? 1 + 0.4 * t : 1.4 - 0.4 * t);
      ph += (2 * Math.PI * f) / sr;
      x[s0 + i] += Math.sin(ph) * Math.sin(Math.PI * t) * 0.5;
    }
  }
  return x;
}

export function cricket(r, sr = SR) {
  const f = 4200 + r() * 600;
  const pulses = 3;
  const n = Math.round(0.25 * sr);
  const x = new Float32Array(n);
  for (let k = 0; k < pulses; k++) {
    const s0 = Math.round(k * 0.045 * sr);
    const len = Math.round(0.03 * sr);
    for (let i = 0; i < len; i++) x[s0 + i] += Math.sin((2 * Math.PI * f * i) / sr) * Math.sin((Math.PI * i) / len) * 0.4;
  }
  return x;
}

/** Metallic chime/bell: a few inharmonic partials with exponential decay. */
export function bell(f0 = 660, dur = 1.6, r = Math.random, sr = SR) {
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  const partials = [[1, 1], [2.76, 0.55], [5.4, 0.32], [8.93, 0.18]];
  const ph = partials.map(() => (typeof r === 'function' ? r() : Math.random()) * 6.28);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const atk = Math.min(1, t / 0.003);
    let v = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, amp] = partials[k];
      v += amp * Math.sin(2 * Math.PI * f0 * ratio * t + ph[k]) * Math.exp(-t / (dur * (1 - k * 0.18)));
    }
    x[i] = v * atk * 0.4;
  }
  return x;
}

export function thud(r, f = 90, dur = 0.12, sr = SR) {
  const n = Math.round(dur * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = (Math.sin(2 * Math.PI * f * t * (1 - t * 2)) * 0.8 + (r() * 2 - 1) * 0.15) * Math.exp(-t / (dur * 0.3));
  }
  return biquad(x, 'lowpass', 600, 0.7, 0, sr, false);
}

// ----------------------------------------------------------- stereo mixing
export function panGains(pan) {
  const p = (Math.max(-1, Math.min(1, pan)) + 1) * 0.25 * Math.PI;
  return [Math.cos(p), Math.sin(p)];
}

export function mixLayers(layers, N) {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  for (const ly of layers) {
    if (!ly || !ly.data || ly.gain <= 0) continue;
    const [gl, gr] = panGains(ly.pan || 0);
    const d = ly.data;
    const off = ly.offset || 0;
    const M = d.length;
    for (let i = 0; i < N; i++) {
      const v = d[(off + i) % M] * ly.gain;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  }
  return { L, R };
}

export function softLimit(ch, ceiling = 0.9) {
  for (const x of ch) {
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const a = Math.abs(v);
      if (a > 0.6) x[i] = Math.sign(v) * (0.6 + (ceiling - 0.6) * Math.tanh((a - 0.6) / (ceiling - 0.6)));
    }
  }
}

export function encodeWav(L, R, sr = SR) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    dv.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    dv.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    o += 4;
  }
  return buf;
}
