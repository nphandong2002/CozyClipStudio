// ffmpeg pipeline: encode each clip once, then concat (stream copy) the repeats.
// A 2h video = a handful of short encoded loops + one fast remux.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
    if (p && fs.existsSync(p)) return p;
  } catch (_) {}
  return 'ffmpeg'; // fall back to PATH
}

function run(bin, args, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let tail = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (onLine) s.split(/\r|\n/).forEach((l) => l && onLine(l));
    });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg lỗi (${code}): ${tail}`))));
  });
}

class ExportJob {
  constructor({ outFile, width, height, fps, crf = 20, preset = 'medium', ffmpegPath }) {
    this.outFile = outFile;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.crf = crf;
    this.preset = preset;
    this.ffmpeg = ffmpegPath || resolveFfmpeg();
    this.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyclip-'));
    this.proc = null;
    this.cancelled = false;
  }

  clipVideo(id) {
    return path.join(this.workDir, `${id}.mp4`);
  }
  clipAudio(id) {
    return path.join(this.workDir, `${id}.wav`);
  }

  beginClip(id) {
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${this.width}x${this.height}`, '-r', String(this.fps), '-i', '-',
      '-c:v', 'libx264', '-preset', this.preset, '-crf', String(this.crf), '-pix_fmt', 'yuv420p',
      '-g', String(this.fps * 2), '-bf', '2', '-an', this.clipVideo(id),
    ];
    this.proc = spawn(this.ffmpeg, args, { windowsHide: true });
    this.stderr = '';
    this.proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.done = new Promise((resolve, reject) => {
      this.proc.on('error', reject);
      this.proc.on('close', (code) => (code === 0 || this.cancelled ? resolve() : reject(new Error('ffmpeg lỗi: ' + this.stderr))));
    });
  }

  writeFrame(buf) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('Chưa bắt đầu clip'));
      const ok = this.proc.stdin.write(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
      if (ok) resolve();
      else this.proc.stdin.once('drain', resolve);
    });
  }

  async endClip() {
    this.proc.stdin.end();
    await this.done;
    this.proc = null;
  }

  writeWav(id, arrayBuffer) {
    fs.writeFileSync(this.clipAudio(id), Buffer.from(arrayBuffer));
  }

  /** Save the user-uploaded background track (mixed in during finalize). */
  setBgAudio(bytes, ext, volume) {
    const p = path.join(this.workDir, 'bg.' + (ext || 'bin'));
    fs.writeFileSync(p, Buffer.from(bytes));
    this.bgAudioPath = p;
    this.bgVolume = volume == null ? 0.6 : volume;
  }

  /** clips: [{id, repeats, T}] in order. */
  async finalize(clips, onProgress) {
    const esc = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
    const vList = [];
    const aList = [];
    let total = 0;
    for (const c of clips) {
      for (let k = 0; k < c.repeats; k++) {
        vList.push(`file '${esc(this.clipVideo(c.id))}'`);
        aList.push(`file '${esc(this.clipAudio(c.id))}'`);
      }
      total += c.T * c.repeats;
    }
    const vTxt = path.join(this.workDir, 'video.txt');
    const aTxt = path.join(this.workDir, 'audio.txt');
    fs.writeFileSync(vTxt, vList.join('\n'));
    fs.writeFileSync(aTxt, aList.join('\n'));
    const bg = this.bgAudioPath && fs.existsSync(this.bgAudioPath);
    const args = [
      '-y', '-f', 'concat', '-safe', '0', '-i', vTxt, '-f', 'concat', '-safe', '0', '-i', aTxt,
      ...(bg ? ['-stream_loop', '-1', '-i', this.bgAudioPath] : []),
      ...(bg
        ? ['-filter_complex', `[2:a]volume=${this.bgVolume},aformat=sample_rates=48000:channel_layouts=stereo[bg];[1:a][bg]amix=inputs=2:duration=first:normalize=0[aout]`, '-map', '0:v:0', '-map', '[aout]']
        : ['-map', '0:v:0', '-map', '1:a:0']),
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', total.toFixed(3), '-movflags', '+faststart', this.outFile,
    ];
    await run(this.ffmpeg, args, (line) => {
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(line);
      if (m && onProgress) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
    });
    return this.outFile;
  }

  cancel() {
    this.cancelled = true;
    if (this.proc) {
      try {
        this.proc.stdin.destroy();
        this.proc.kill();
      } catch (_) {}
    }
  }

  cleanup() {
    try {
      fs.rmSync(this.workDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

module.exports = { ExportJob, resolveFfmpeg };
