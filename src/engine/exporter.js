// Renderer-side export orchestration. `api` is window.api (Electron) or a test shim.
import { buildPlan, renderFrame } from './scene.js';
import { renderClipAudio } from './audio.js';
import { encodeWav, SR } from './dsp.js';
import { preloadProject, seekMediaForExport, resumeMediaPlayback } from './images.js';
import { artReady } from './artsets.js';

const AUDIO_EXT = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/webm': 'webm',
};
function dataUrlToBytes(dataURL) {
  const comma = dataURL.indexOf(',');
  const mime = /data:([^;]+)/.exec(dataURL.slice(0, comma))?.[1] || '';
  const bin = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext: AUDIO_EXT[mime] || 'bin' };
}

export function planStats(project, rig = null) {
  const plan = buildPlan(project, rig);
  const fps = project.output.fps;
  const frames = plan.clips.reduce((s, c) => s + Math.round(c.T * fps), 0);
  return { ...plan, framesToRender: frames };
}

export async function exportProject({ project, rig, api, outFile, onProgress = () => {}, isCancelled = () => false }) {
  const plan = buildPlan(project, rig);
  const { width, height, fps } = project.output;
  const L = project.output.loopSeconds;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const totalFrames = plan.clips.reduce((s, c) => s + Math.round(c.T * fps), 0);
  let done = 0;
  const t0 = performance.now();

  await preloadProject(project); // uploaded image props + background must be ready before rendering
  await artReady(); // ảnh của bộ hình Spine phải decode xong, nếu không nhân vật sẽ hiện hình gốc
  await api.exportBegin({ outFile, width, height, fps });
  try {
    if (project.audio?.src && api.bgAudio) {
      const { bytes, ext } = dataUrlToBytes(project.audio.src);
      await api.bgAudio(bytes, ext, project.audio.volume ?? 0.6);
    }
    for (const clip of plan.clips) {
      const frames = Math.round(clip.T * fps);
      await api.clipBegin(clip.id);
      for (let i = 0; i < frames; i++) {
        if (isCancelled()) throw new Error('cancelled');
        const t = i / fps;
        const envT = (((t + (clip.phase || 0)) % L) + L) % L;
        await seekMediaForExport(project, envT); // sync video props to this frame's loop time
        renderFrame(ctx, project, rig, {
          t,
          L,
          seg: clip.seg,
          phase: clip.phase,
          move: clip.kind === 'move' ? { moveCast: clip.moveCast, u: i / frames, T: clip.T } : null,
        });
        const img = ctx.getImageData(0, 0, width, height);
        await api.frame(new Uint8Array(img.data.buffer));
        done++;
        if (done % 10 === 0) {
          const el = (performance.now() - t0) / 1000;
          onProgress({ stage: 'render', progress: (done / totalFrames) * 0.9, detail: `Khung hình ${done}/${totalFrames} · còn ~${Math.round((el / done) * (totalFrames - done))}s` });
        }
      }
      await api.clipEnd();
      const audio = renderClipAudio(project, rig, clip);
      await api.wav(clip.id, encodeWav(audio.L, audio.R, SR));
    }
    onProgress({ stage: 'mux', progress: 0.9, detail: 'Ghép video dài & trộn âm thanh…' });
    const off = api.onExportProgress ? api.onExportProgress((p) => onProgress({ stage: 'mux', progress: 0.9 + p * 0.1, detail: `Ghép ${Math.round(p * 100)}%` })) : null;
    const out = await api.finalize(plan.clips.map((c) => ({ id: c.id, repeats: c.repeats, T: c.T })));
    if (off) off();
    onProgress({ stage: 'done', progress: 1, detail: 'Xong' });
    return out;
  } catch (e) {
    await api.cancelExport();
    throw e;
  } finally {
    resumeMediaPlayback(); // video props were paused for frame-accurate seeking
  }
}
