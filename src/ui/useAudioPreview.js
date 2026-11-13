import { useCallback, useEffect, useRef, useState } from 'react';
import { renderClipAudio } from '../engine/audio.js';
import { SR } from '../engine/dsp.js';

// ---------------------------------------------------------------- solo bus
// While any audition plays, the scene preview + background music are muted so you hear it alone.
const soloOwners = new Set();
const soloSubs = new Set();
function setSolo(owner, on) {
  const before = soloOwners.size > 0;
  if (on) soloOwners.add(owner);
  else soloOwners.delete(owner);
  const after = soloOwners.size > 0;
  if (before !== after) soloSubs.forEach((f) => f(after));
}
/** true while some "nghe thử" audition is playing. */
export function useAuditionSolo() {
  const [solo, set] = useState(soloOwners.size > 0);
  useEffect(() => {
    soloSubs.add(set);
    set(soloOwners.size > 0);
    return () => soloSubs.delete(set);
  }, []);
  return solo;
}

/**
 * Audition an arbitrary stereo buffer on demand, looped and solo (scene audio is muted meanwhile);
 * toggles off if the same id replays. refresh() swaps the buffer of the playing id (e.g. volume change).
 */
export function useAudition() {
  const ctxRef = useRef(null);
  const srcRef = useRef(null);
  const idRef = useRef(null);
  const owner = useRef({});
  const [playingId, setPlayingId] = useState(null);

  const stop = useCallback(() => {
    if (srcRef.current) {
      try {
        srcRef.current.stop();
      } catch (_) {}
      srcRef.current = null;
    }
    idRef.current = null;
    setPlayingId(null);
    setSolo(owner.current, false);
  }, []);

  const play = useCallback(
    (makeBuffer, id) => {
      if (idRef.current === id) {
        stop();
        return;
      }
      try {
        if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: SR });
        const ac = ctxRef.current;
        if (ac.state === 'suspended') ac.resume();
        const out = makeBuffer();
        const buf = ac.createBuffer(2, out.L.length, SR);
        buf.copyToChannel(out.L, 0);
        buf.copyToChannel(out.R, 1);
        if (srcRef.current) {
          try {
            srcRef.current.stop();
          } catch (_) {}
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(ac.destination);
        src.start();
        srcRef.current = src;
        idRef.current = id;
        setPlayingId(id);
        setSolo(owner.current, true);
      } catch (e) {
        console.warn('Không nghe thử được:', e);
      }
    },
    [stop]
  );

  const refresh = useCallback(
    (makeBuffer, id) => {
      if (idRef.current !== id) return;
      idRef.current = null; // so play() swaps the buffer instead of toggling off
      play(makeBuffer, id);
    },
    [play]
  );

  useEffect(
    () => () => {
      if (srcRef.current) {
        try {
          srcRef.current.stop();
        } catch (_) {}
      }
      setSolo(owner.current, false);
    },
    []
  );

  return { play, stop, refresh, playingId };
}

/** Renders the current clip's audio (same code as export) and loops it. */
export function useAudioPreview({ project, rig, clip, playing, clock, solo = false }) {
  const ctxRef = useRef(null);
  const srcRef = useRef(null);
  const gainRef = useRef(null);
  const soloRef = useRef(solo);
  soloRef.current = solo;

  // mute (without stopping) while an audition plays solo
  useEffect(() => {
    if (gainRef.current && ctxRef.current) gainRef.current.gain.setTargetAtTime(solo ? 0 : 1, ctxRef.current.currentTime, 0.05);
  }, [solo]);

  // audio depends only on parts of the project that affect sound
  const key = clip
    ? JSON.stringify([clip.id, clip.kind, clip.T, clip.phase, clip.seg?.cast, clip.moveCast, clip.seg?.weather, clip.seg?.timeOfDay, project.scene, project.mix, project.output.loopSeconds,
        project.props.map((p) => [p.id, p.type, p.enabled, p.volume, Math.round(p.x / 40)]), (project.characters || []).map((c) => [c.id, c.skin]), !!rig])
    : '';

  useEffect(() => {
    const stop = () => {
      if (srcRef.current) {
        try {
          srcRef.current.stop();
        } catch (_) {}
        srcRef.current = null;
      }
    };
    if (!playing || !clip) {
      stop();
      return stop;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext({ sampleRate: SR });
        gainRef.current = ctxRef.current.createGain();
        gainRef.current.connect(ctxRef.current.destination);
      }
      const ac = ctxRef.current;
      if (ac.state === 'suspended') ac.resume();
      const out = renderClipAudio(project, rig, clip);
      if (cancelled) return;
      const buf = ac.createBuffer(2, out.L.length, SR);
      buf.copyToChannel(out.L, 0);
      buf.copyToChannel(out.R, 1);
      stop();
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = clip.kind === 'loop';
      src.connect(gainRef.current);
      const now = (performance.now() - clock.current.start) / 1000;
      const offset = clip.kind === 'loop' ? now % clip.T : Math.min(now, clip.T - 0.01);
      gainRef.current.gain.setValueAtTime(0, ac.currentTime);
      gainRef.current.gain.linearRampToValueAtTime(soloRef.current ? 0 : 1, ac.currentTime + 0.25);
      src.start(0, Math.max(0, offset));
      srcRef.current = src;
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, playing]);
}

/** Loops the user-uploaded background track continuously while playing. */
export function useBackgroundAudio({ project, playing, solo = false }) {
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const gainRef = useRef(null);
  const bufRef = useRef({ src: null, buffer: null });
  const src = project.audio?.src || null;
  const vol = project.audio?.volume ?? 0.6;

  const soloRef = useRef(solo);
  soloRef.current = solo;

  // live volume / mute (also muted while an audition plays solo)
  useEffect(() => {
    if (gainRef.current && ctxRef.current) gainRef.current.gain.setTargetAtTime(playing && !solo ? vol : 0, ctxRef.current.currentTime, 0.05);
  }, [vol, playing, solo]);

  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      if (nodeRef.current) {
        try {
          nodeRef.current.stop();
        } catch (_) {}
        nodeRef.current = null;
      }
    };
    if (!src || !playing) {
      stop();
      return stop;
    }
    (async () => {
      try {
        if (!ctxRef.current) {
          ctxRef.current = new AudioContext();
          gainRef.current = ctxRef.current.createGain();
          gainRef.current.connect(ctxRef.current.destination);
        }
        const ac = ctxRef.current;
        if (ac.state === 'suspended') await ac.resume();
        if (bufRef.current.src !== src) {
          const ab = await (await fetch(src)).arrayBuffer();
          bufRef.current = { src, buffer: await ac.decodeAudioData(ab) };
        }
        if (cancelled) return;
        stop();
        const node = ac.createBufferSource();
        node.buffer = bufRef.current.buffer;
        node.loop = true;
        node.connect(gainRef.current);
        gainRef.current.gain.setValueAtTime(soloRef.current ? 0 : vol, ac.currentTime);
        node.start();
        nodeRef.current = node;
      } catch (e) {
        console.warn('Không phát được nhạc nền:', e);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, playing]);
}
