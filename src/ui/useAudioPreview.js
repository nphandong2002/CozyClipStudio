import { useCallback, useEffect, useRef, useState } from 'react';
import { renderClipAudio } from '../engine/audio.js';
import { SR } from '../engine/dsp.js';

/** Audition an arbitrary stereo buffer on demand, looped; toggles off if the same id replays. */
export function useAudition() {
  const ctxRef = useRef(null);
  const srcRef = useRef(null);
  const idRef = useRef(null);
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
      } catch (e) {
        console.warn('Không nghe thử được:', e);
      }
    },
    [stop]
  );

  useEffect(
    () => () => {
      if (srcRef.current) {
        try {
          srcRef.current.stop();
        } catch (_) {}
      }
    },
    []
  );

  return { play, stop, playingId };
}

/** Renders the current clip's audio (same code as export) and loops it. */
export function useAudioPreview({ project, rig, clip, playing, clock }) {
  const ctxRef = useRef(null);
  const srcRef = useRef(null);
  const gainRef = useRef(null);

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
      gainRef.current.gain.linearRampToValueAtTime(1, ac.currentTime + 0.25);
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
export function useBackgroundAudio({ project, playing }) {
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const gainRef = useRef(null);
  const bufRef = useRef({ src: null, buffer: null });
  const src = project.audio?.src || null;
  const vol = project.audio?.volume ?? 0.6;

  // live volume / mute
  useEffect(() => {
    if (gainRef.current && ctxRef.current) gainRef.current.gain.setTargetAtTime(playing ? vol : 0, ctxRef.current.currentTime, 0.1);
  }, [vol, playing]);

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
        gainRef.current.gain.setValueAtTime(vol, ac.currentTime);
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
