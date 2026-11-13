// ASMR sound design: maps weather, props and character actions to synthesized layers.
import { mulberry32, hashStr, effectiveScene, DESIGN_W } from './util.js';
import { SR, white, biquad, scale, am, place, lfo, click, noiseBurst, thunder, pageFlip, plop, chirp, cricket, thud, bell, mixLayers, softLimit } from './dsp.js';
import { lightningEvents } from './world.js';
import { PROPS, pageFlipEvents } from './props.js';
import { actionDef, actionSoundEvents } from './character.js';
import { characterList, castEntry } from './scene.js';

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) {
    if (cache.size > 80) cache.delete(cache.keys().next().value);
    cache.set(key, build());
  }
  return cache.get(key);
}

const panOf = (x) => ((x ?? DESIGN_W / 2) / DESIGN_W - 0.5) * 1.4;

function poissonTimes(r, rate, L) {
  const out = [];
  let t = -Math.log(1 - r()) / rate;
  while (t < L) {
    out.push(t);
    t += -Math.log(1 - r()) / rate;
  }
  return out;
}

// --------------------------------------------------------------- weather
function weatherLayers(sc, indoor, L) {
  const N = Math.round(L * SR);
  const w = sc.weather;
  const tod = sc.timeOfDay;
  const key = `${w}|${tod}|${indoor}|${L}`;
  const layers = [];
  const add = (name, pan, gain, build) => layers.push({ data: cached(key + name, build), pan, gain });

  if (w === 'rain' || w === 'storm') {
    const heavy = w === 'storm' ? 1.35 : 1;
    for (const [side, seed] of [[-0.8, 11], [0.8, 12]]) {
      add('body' + seed, side, 0.5 * heavy * (indoor ? 0.8 : 1), () => {
        let x = white(N, seed);
        x = biquad(x, 'highpass', indoor ? 300 : 500);
        x = biquad(x, 'lowpass', indoor ? 1600 : 6500);
        return scale(x, 0.5);
      });
      add('drops' + seed, side * 0.6, (indoor ? 0.25 : 0.4) * heavy, () => {
        const r = mulberry32(seed * 7);
        const x = new Float32Array(N);
        for (const t of poissonTimes(r, indoor ? 14 : 30, L)) place(x, click(r, 1500 + r() * 3500, 0.002 + r() * 0.004), t, Math.pow(r(), 2) * 0.5);
        return indoor ? biquad(x, 'lowpass', 2200) : x;
      });
    }
    add('low', 0, indoor ? 0.45 : 0.3, () => scale(biquad(biquad(white(N, 13), 'lowpass', 220), 'lowpass', 300), 2.2));
  }
  if (w === 'storm' || w === 'snow' || w === 'fog' || (!indoor && w === 'clear')) {
    const amt = w === 'storm' ? 0.55 : w === 'snow' ? 0.35 : w === 'fog' ? 0.2 : 0.12;
    add('wind', 0.2, amt * (indoor ? 0.6 : 1), () => {
      let x = white(N, 21);
      x = biquad(x, 'bandpass', 420, 0.5);
      x = biquad(x, 'lowpass', indoor ? 700 : 1400);
      const f1 = lfo(0.06, L);
      const f2 = lfo(0.17, L);
      return am(x, (t) => 0.9 * (0.55 + 0.3 * Math.sin(2 * Math.PI * f1 * t) + 0.15 * Math.sin(2 * Math.PI * f2 * t + 1)));
    });
  }
  if (w === 'storm') {
    add('thunder', 0, indoor ? 0.75 : 1, () => {
      const r = mulberry32(31);
      let x = new Float32Array(N);
      for (const e of lightningEvents(L)) place(x, thunder(r, e.power), e.t + e.delay, 0.6);
      return indoor ? biquad(x, 'lowpass', 400) : x;
    });
  }
  if (w === 'clear' && !indoor) {
    if (tod === 'night') {
      for (const [pan, seed] of [[-0.6, 41], [0.7, 42]]) {
        add('cricket' + seed, pan, 0.18, () => {
          const r = mulberry32(seed);
          const x = new Float32Array(N);
          const period = 0.9 + r() * 0.4;
          const n = Math.max(1, Math.round(L / period));
          for (let k = 0; k < n; k++) place(x, cricket(r), (k * L) / n + r() * 0.05, 0.8);
          return x;
        });
      }
    } else {
      add('birds', 0.3, 0.22, () => {
        const r = mulberry32(51);
        const x = new Float32Array(N);
        for (const t of poissonTimes(r, 0.35, L)) place(x, chirp(r), t, 0.5 + r() * 0.5);
        return x;
      });
    }
  }
  if (indoor && w === 'clear') {
    add('room', 0, 0.12, () => scale(biquad(white(N, 61), 'lowpass', 180), 1.5));
  }
  return layers;
}

// ----------------------------------------------------------------- props
function propLayers(p, sc, L) {
  const def = PROPS[p.type];
  if (!def?.sound || p.enabled === false) return [];
  const N = Math.round(L * SR);
  const pan = panOf(p.x);
  const vol = p.volume ?? 1;
  const seed = hashStr(p.id || p.type);
  const key = `${p.type}|${p.id}|${L}`;
  const out = [];
  const add = (name, gain, build, dp = 0) => out.push({ data: cached(key + name, build), pan: pan + dp, gain: gain * vol });

  switch (def.sound) {
    case 'fire':
      add('base', 0.4, () => {
        let x = biquad(white(N, seed), 'lowpass', 320);
        x = biquad(x, 'lowpass', 500);
        const f1 = lfo(0.7, L);
        const f2 = lfo(1.9, L);
        return am(scale(x, 2.5), (t) => 0.7 + 0.2 * Math.sin(2 * Math.PI * f1 * t) + 0.1 * Math.sin(2 * Math.PI * f2 * t));
      });
      add('hiss', 0.04, () => biquad(white(N, seed + 1), 'highpass', 4000));
      for (const dp of [-0.25, 0.25]) {
        add('crackle' + dp, 0.6, () => {
          const r = mulberry32(seed + (dp > 0 ? 3 : 2));
          const x = new Float32Array(N);
          for (const t of poissonTimes(r, 6, L)) place(x, click(r, 1200 + r() * 5000, 0.001 + r() * 0.003), t, Math.pow(r(), 3) * 0.9);
          for (const t of poissonTimes(r, 0.25, L)) {
            place(x, noiseBurst(r, 0.08, 0.001, 0.02, [['lowpass', 1600]]), t, 0.6);
            place(x, click(r, 900, 0.006), t, 0.5);
          }
          return x;
        }, dp);
      }
      break;
    case 'glass':
      if (sc.weather === 'rain' || sc.weather === 'storm') {
        add('taps', 0.3, () => {
          const r = mulberry32(seed);
          const x = new Float32Array(N);
          for (const t of poissonTimes(r, sc.weather === 'storm' ? 7 : 4, L)) place(x, click(r, 2200 + r() * 2000, 0.006 + r() * 0.008), t, 0.2 + r() * 0.4);
          return biquad(x, 'lowpass', 5000);
        });
      }
      break;
    case 'pageflip':
      add('flip', 0.7, () => {
        const r = mulberry32(seed);
        const x = new Float32Array(N);
        for (const t of pageFlipEvents(L, p.id)) place(x, pageFlip(r), t, 0.8);
        return x;
      });
      break;
    case 'tick':
      add('tick', 0.35, () => {
        const r = mulberry32(seed);
        const x = new Float32Array(N);
        const n = Math.round(L / 2);
        for (let k = 0; k < 2 * n; k++) {
          const ev = click(r, k % 2 ? 2100 : 2600, 0.003);
          place(x, ev, (k * L) / (2 * n) + L / (4 * n), 0.7);
        }
        return biquad(x, 'peak', 1300, 2, 8);
      });
      break;
    case 'vinyl':
      add('crackle', 0.35, () => {
        const r = mulberry32(seed);
        const x = new Float32Array(N);
        for (const t of poissonTimes(r, 14, L)) place(x, click(r, 3000 + r() * 4000, 0.0008 + r() * 0.0015), t, Math.pow(r(), 4) * 0.8);
        return biquad(x, 'lowpass', 7000);
      });
      add('hiss', 0.025, () => biquad(white(N, seed + 5), 'highpass', 3000));
      add('rumble', 0.25, () => scale(biquad(biquad(white(N, seed + 6), 'lowpass', 70), 'lowpass', 90), 3));
      break;
    case 'water':
      add('lap', 0.35, () => {
        const x = biquad(biquad(white(N, seed), 'lowpass', 600), 'highpass', 120);
        const f = lfo(0.28, L);
        return am(scale(x, 1.8), (t) => Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * f * t), 2));
      });
      add('plops', 0.25, () => {
        const r = mulberry32(seed + 9);
        const x = new Float32Array(N);
        for (const t of poissonTimes(r, 0.25, L)) place(x, plop(r, 500 + r() * 500, 150, 0.1), t, 0.5);
        return x;
      });
      break;
    case 'stream':
      add('rush', 0.3, () => {
        let x = biquad(white(N, seed), 'bandpass', 950, 0.4);
        x = biquad(x, 'highpass', 260);
        const f = lfo(0.5, L);
        return am(scale(x, 1.7), (t) => 0.75 + 0.25 * Math.sin(2 * Math.PI * f * t));
      });
      add('bubbles', 0.3, () => {
        const r = mulberry32(seed + 3);
        const x = new Float32Array(N);
        for (const t of poissonTimes(r, 10, L)) place(x, plop(r, 800 + r() * 700, 220, 0.06), t, 0.3 + r() * 0.4);
        return x;
      });
      break;
    case 'chime':
      add('tones', 0.4, () => {
        const r = mulberry32(seed);
        const x = new Float32Array(N);
        const notes = [523.25, 587.33, 659.25, 783.99, 880]; // C–D–E–G–A pentatonic
        const windAmt = sc.weather === 'storm' ? 2.4 : sc.weather === 'snow' ? 1.3 : sc.weather === 'fog' ? 0.7 : 0.9;
        for (const t of poissonTimes(r, windAmt, L)) {
          if (t > L - 2) continue; // keep the bell tail inside the loop so it repeats seamlessly
          place(x, bell(notes[Math.floor(r() * notes.length)], 1.8, r), t, 0.25 + r() * 0.5);
        }
        return x;
      });
      break;
    case 'rustle':
      add('leaves', 0.3, () => {
        const r = mulberry32(seed);
        const x = new Float32Array(N);
        const windAmt = sc.weather === 'storm' ? 5 : sc.weather === 'snow' ? 2.4 : sc.weather === 'fog' ? 1.2 : 2;
        for (const t of poissonTimes(r, windAmt, L)) place(x, noiseBurst(r, 0.3 + r() * 0.4, 0.05, 0.18, [['bandpass', 3000, 0.6], ['highpass', 1500]]), t, 0.3 + r() * 0.45);
        return x;
      });
      break;
    case 'fountain':
      add('trickle', 0.3, () => {
        const r = mulberry32(seed);
        const x = new Float32Array(N);
        for (const t of poissonTimes(r, 17, L)) place(x, plop(r, 600 + r() * 600, 180, 0.05), t, 0.2 + r() * 0.4);
        return x;
      });
      add('splash', 0.16, () => {
        const x = biquad(white(N, seed + 7), 'bandpass', 1700, 0.5);
        const f = lfo(0.7, L);
        return am(scale(x, 1.3), (t) => 0.6 + 0.2 * Math.sin(2 * Math.PI * f * t));
      });
      break;
  }
  return out;
}

// ------------------------------------------------------- character action
/** Footsteps for one character walking from → to (positions {x,y}) over the move clip. */
function footstepLayers(project, rig, from, to, T, Ns, gain) {
  if (!from || !to) return [];
  const walk = rig?.data.findAnimation('walk');
  const d = walk ? walk.duration : 1.07;
  const r = mulberry32(77 + Math.round(from.x) * 7 + Math.round(to.x));
  const L = new Float32Array(Ns);
  const R = new Float32Array(Ns);
  for (let t = 0.1; t < T; t += d / 2) {
    const u = t / T;
    const x = from.x + (to.x - from.x) * u;
    const p = Math.max(-1, Math.min(1, panOf(x)));
    const ev = noiseBurst(r, 0.09, 0.004, 0.025, [['lowpass', 900], ['highpass', 90]]);
    const g = 0.45 * gain;
    const s0 = Math.round(t * SR);
    const gl = Math.cos(((p + 1) * Math.PI) / 4);
    const gr = Math.sin(((p + 1) * Math.PI) / 4);
    for (let i = 0; i < ev.length && s0 + i < Ns; i++) {
      L[s0 + i] += ev[i] * g * gl;
      R[s0 + i] += ev[i] * g * gr;
    }
  }
  return [{ data: L, pan: -1, gain: 1 }, { data: R, pan: 1, gain: 1 }];
}

/** Sound for one character performing an action at a position (loop clips, or standing during a move). */
function characterActionLayer(project, rig, c, action, pos, T, gain) {
  const def = actionDef(action);
  if (!def.sound) return [];
  const pan = panOf(pos?.x);
  const cseed = hashStr(String(c.id));
  const key = `act|${action}|${T}|${c.skin}|${c.id}`;
  const N = Math.round(T * SR);
  const events = actionSoundEvents(rig, action, T);
  const r = mulberry32(hashStr(action) + cseed);
  const build = () => {
    const x = new Float32Array(N);
    switch (def.sound) {
      case 'purr': {
        let n = biquad(white(N, 91 + (cseed % 500)), 'lowpass', 160);
        n = biquad(n, 'lowpass', 200);
        const fp = lfo(24, T);
        const fb = lfo(0.32, T);
        const ph = (cseed % 100) / 100;
        am(n, (t) => {
          const pulse = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * fp * t + ph * 6.28), 3);
          const breath = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * fb * t + ph), 1.5);
          return pulse * breath * 6;
        });
        x.set(n);
        break;
      }
      case 'sweep':
        for (const e of events) place(x, noiseBurst(r, 0.5, 0.18, 0.12, [['bandpass', 3200, 0.7], ['highpass', 800]]), e.t + e.dur * 0.2, 1.4);
        break;
      case 'dig':
        for (const e of events) {
          place(x, thud(r, 75, 0.15), e.t + e.dur * 0.45, 0.9);
          place(x, noiseBurst(r, 0.25, 0.01, 0.07, [['bandpass', 1400, 0.8]]), e.t + e.dur * 0.47, 0.8);
        }
        break;
      case 'fish':
        for (const e of events) {
          if (e.anim === 'fish-catch') {
            place(x, noiseBurst(r, 0.5, 0.005, 0.12, [['lowpass', 2500]]), e.t + e.dur * 0.3, 0.8);
            place(x, plop(r, 650, 160, 0.14), e.t + e.dur * 0.3, 0.6);
          } else if (e.anim === 'fish-hook') {
            place(x, plop(r, 900, 300, 0.08), e.t + e.dur * 0.4, 0.35);
          }
        }
        break;
      case 'chew':
        for (const e of events) for (let k = 0; k < 3; k++) place(x, noiseBurst(r, 0.05, 0.001, 0.012, [['bandpass', 2400, 1.2]]), e.t + (e.dur * k) / 3, 0.6);
        break;
      case 'lick':
        for (const e of events) {
          if (e.anim !== 'lick') continue;
          for (let k = 0; k < 4; k++) place(x, click(r, 1100 + r() * 400, 0.008), e.t + (e.dur * k) / 4 + 0.05, 0.35);
        }
        break;
      case 'tap':
        for (const e of events) {
          place(x, thud(r, 70, 0.1), e.t, 0.4);
          place(x, thud(r, 70, 0.1), e.t + e.dur / 2, 0.3);
        }
        break;
    }
    return x;
  };
  return [{ data: cached(key, build), pan, gain: 0.55 * gain }];
}

function actionLayers(project, rig, clip, Ns) {
  const T = clip.T;
  const gain = project.mix?.character ?? 1;
  const chars = characterList(project);
  const out = [];
  if (clip.kind === 'move') {
    for (const c of chars) {
      const mv = clip.moveCast?.[c.id];
      const moving = mv && mv.from && mv.to && Math.hypot(mv.to.x - mv.from.x, mv.to.y - mv.from.y) > 2;
      if (moving) {
        for (const ly of footstepLayers(project, rig, mv.from, mv.to, T, Ns, gain)) out.push(ly);
      } else {
        // Standing while others walk: keep playing its (upcoming segment) action sound.
        const ce = castEntry(clip.seg, c.id);
        if (ce) for (const ly of characterActionLayer(project, rig, c, ce.action, ce, T, gain)) out.push(ly);
      }
    }
    return out;
  }
  for (const c of chars) {
    const ce = castEntry(clip.seg, c.id);
    if (ce) for (const ly of characterActionLayer(project, rig, c, ce.action, ce, T, gain)) out.push(ly);
  }
  return out;
}

/** Render a clip's stereo audio (Float32 L/R, length round(T*SR)). */
export function renderClipAudio(project, rig, clip) {
  const L = project.output.loopSeconds;
  const Ns = Math.round(clip.T * SR);
  const sc = effectiveScene(project, clip.seg);
  const indoor = project.scene.type !== 'outdoor';
  const mix = project.mix || {};
  const phaseOff = Math.round((clip.phase || 0) * SR);
  const layers = [];
  for (const ly of weatherLayers(sc, indoor, L)) layers.push({ ...ly, gain: ly.gain * (mix.weather ?? 1), offset: phaseOff });
  for (const p of project.props) for (const ly of propLayers(p, sc, L)) layers.push({ ...ly, gain: ly.gain * (mix.props ?? 1), offset: phaseOff });
  for (const ly of actionLayers(project, rig, clip, Ns)) layers.push(ly);
  const out = mixLayers(layers, Ns);
  const master = (mix.master ?? 0.9) * 1.6; // ≈ -20 dB RMS, peaks soft-limited
  for (const ch of [out.L, out.R]) for (let i = 0; i < Ns; i++) ch[i] *= master;
  softLimit([out.L, out.R]);
  return out;
}

function masterize(out, Ns, mix) {
  const master = (mix.master ?? 0.9) * 1.6;
  for (const ch of [out.L, out.R]) for (let i = 0; i < Ns; i++) ch[i] *= master;
  softLimit([out.L, out.R]);
  return out;
}

/**
 * Audition one prop's sound alone (one loop) — for the "nghe thử" button. Independent of the scene
 * mix (master / props sliders) and of the prop's on/off checkbox: only its own volume counts.
 */
export function renderPropAudio(project, prop) {
  const L = project.output.loopSeconds;
  const Ns = Math.round(L * SR);
  const sc = effectiveScene(project, null);
  const layers = propLayers({ ...prop, enabled: true }, sc, L);
  return masterize(mixLayers(layers, Ns), Ns, {}); // neutral (default) master, not the scene's
}

/** Audition one character's action sound alone (one loop). */
export function renderActionAudio(project, rig, char, ce) {
  const L = project.output.loopSeconds;
  const Ns = Math.round(L * SR);
  const mix = project.mix || {};
  const layers = characterActionLayer(project, rig, char, ce?.action, ce, L, mix.character ?? 1);
  return masterize(mixLayers(layers, Ns), Ns, mix);
}

export function clearAudioCache() {
  cache.clear();
}

export { SR };
