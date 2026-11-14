// Convert user videos Chromium can't play (MOV ProRes / QuickTime Animation, MKV, AVI…) into a
// playable file with the bundled ffmpeg, keeping transparency:
//   H.264 yuv420p           → MP4, stream copy (instant)
//   has alpha (ProRes 4444…) → WebM VP9 yuva420p (Chromium draws it with alpha)
//   anything else           → MP4 H.264
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveFfmpeg } = require('./exportPipeline.cjs');

const ALPHA_PIX = /^(yuva|argb|rgba|bgra|abgr|gbrap|ya\d)/;
const MAX_W = 1920; // objects never need more; keeps the project file smaller

function ffmpeg(args, onStderr) {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpeg(), args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      err = (err + s).slice(-20000);
      if (onStderr) onStderr(s);
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stderr: err }));
  });
}

/** codec, pixel format, duration (s) of the first video stream. */
async function probe(input) {
  const { stderr } = await ffmpeg(['-hide_banner', '-i', input]); // exits 1 (no output) — fine
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #[^\n]*?Video: (\w+)[^,\n]*, (\w+)/.exec(stderr);
  if (!v) throw new Error('File không có hình video (hoặc ffmpeg không đọc được).');
  return { codec: v[1], pix: v[2], duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0 };
}

/**
 * src: { path } or { bytes, name }. onProgress(0..1). trim: { start, end } seconds (optional) - cut before loading.
 * Resolves { bytes: Buffer, mime, ext, alpha, mode }.
 */
async function convertVideo(src, onProgress = () => {}, trim = null) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyclip-media-'));
  try {
    let input = src.path;
    if (!input) {
      input = path.join(work, 'in' + (path.extname(src.name || '') || '.mov'));
      fs.writeFileSync(input, Buffer.from(src.bytes));
    }
    const info = await probe(input);
    const alpha = ALPHA_PIX.test(info.pix);
    const tStart = trim && trim.start > 0 ? +trim.start : 0;
    const tEnd = trim && trim.end > tStart ? +trim.end : 0;
    const trimmed = tStart > 0 || (tEnd > 0 && (!info.duration || tEnd < info.duration - 0.05));
    const span = trimmed ? (tEnd || info.duration) - tStart : info.duration;
    const inArgs = trimmed ? ['-ss', String(tStart), ...(tEnd ? ['-t', String(tEnd - tStart)] : [])] : [];
    const progress = (s) => {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
      if (m && span > 0) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / span));
    };
    const scale = `scale=w='min(${MAX_W},iw)':h=-2`;
    const attempts = [];
    if (!trimmed && !alpha && info.codec === 'h264' && info.pix === 'yuv420p')
      attempts.push({ mode: 'copy', ext: 'mp4', mime: 'video/mp4', args: ['-c:v', 'copy', '-movflags', '+faststart'] });
    if (alpha)
      attempts.push({
        mode: 'vp9-alpha', ext: 'webm', mime: 'video/webm',
        args: ['-vf', `${scale},format=yuva420p`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30',
          '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-auto-alt-ref', '0'],
      });
    attempts.push({
      mode: 'h264', ext: 'mp4', mime: 'video/mp4',
      args: ['-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    });
    let last = '';
    for (const a of attempts) {
      const out = path.join(work, 'out.' + a.ext);
      const r = await ffmpeg(['-y', '-hide_banner', ...inArgs, '-i', input, '-map', '0:v:0', '-an', ...a.args, out], progress);
      if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) {
        onProgress(1);
        return { bytes: fs.readFileSync(out), mime: a.mime, ext: a.ext, alpha: a.mode === 'vp9-alpha', mode: a.mode };
      }
      last = r.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    }
    throw new Error('Không chuyển đổi được video: ' + last);
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch (_) {}
  }
}

module.exports = { convertVideo, probe };
