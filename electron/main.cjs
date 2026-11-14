const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ExportJob } = require('./exportPipeline.cjs');
const { convertVideo } = require('./mediaConvert.cjs');

let win;
let job = null;

// Nếu lần chạy trước renderer bị crash → lần này tắt tăng tốc GPU (nguyên nhân hay gặp của màn hình đen/crash trên Windows).
const crashFlag = path.join(app.getPath('userData'), 'renderer-crashed.flag');
const safeGpu = process.argv.includes('--safe-gpu') || process.env.COZY_SAFE_GPU === '1' || fs.existsSync(crashFlag);
if (safeGpu) {
  console.warn('[safe-gpu] tắt hardware acceleration (xoá file ' + crashFlag + ' để bật lại)');
  app.disableHardwareAcceleration();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#15161a',
    title: 'CozyClip Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  const wc = win.webContents;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = () => (devUrl ? win.loadURL(devUrl) : win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')));

  // Màn hình đen thường do: Vite chưa sẵn sàng lúc nạp trang, hoặc renderer/GPU bị crash → tự nạp lại.
  let retries = 0;
  const retry = (why) => {
    if (win.isDestroyed() || retries >= 20) return;
    retries++;
    console.warn(`[reload ${retries}] ${why}`);
    setTimeout(() => !win.isDestroyed() && load().catch(() => {}), 500);
  };
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) retry(`did-fail-load ${code} ${desc} ${url}`);
  });
  wc.on('render-process-gone', (_e, d) => {
    console.warn('render-process-gone', JSON.stringify(d), 'gpu=' + !safeGpu);
    try {
      fs.writeFileSync(crashFlag, new Date().toISOString() + ' ' + JSON.stringify(d));
    } catch (_) {}
    retry('render-process-gone ' + d.reason);
  });
  wc.on('unresponsive', () => console.warn('window unresponsive'));
  wc.on('did-finish-load', () => (retries = 0));
  // Sau khi trang nạp xong mà root vẫn trống (React không mount) → nạp lại 1 lần.
  wc.on('did-finish-load', () => {
    setTimeout(async () => {
      if (win.isDestroyed()) return;
      try {
        const empty = await wc.executeJavaScript('!document.getElementById("root") || document.getElementById("root").childElementCount === 0');
        if (empty) retry('root trống');
      } catch (_) {}
    }, 3000);
  });
  load().catch(() => {});
}

app.on('child-process-gone', (_e, d) => console.warn('child-process-gone', d.type, d.reason));

app.whenReady().then(() => {
  createWindow();
  if (process.env.COZY_SELFTEST) selfTest(process.env.COZY_SELFTEST);
});

// `COZY_SELFTEST=<spineDir> electron .` → exports a 1-minute 720p test video next to the spine files.
function selfTest(spineDir) {
  win.webContents.once('did-finish-load', async () => {
    const out = path.join(spineDir, 'cozyclip-selftest.mp4');
    const code = `(async () => {
      const b = await window.api.loadSpine(${JSON.stringify(spineDir)});
      const rig = await window.__cozy.loadRigFromBundle(b);
      const pr = window.__cozy.cozyRoomPreset();
      pr.output = { width: 1280, height: 720, fps: 30, loopSeconds: 20 };
      pr.timeline = [{ id: 'a', action: 'sitLick', anchor: 'a_book', minutes: 1 }, { id: 'b', action: 'sleep', anchor: 'a_fire', minutes: 1, weather: 'storm' }];
      const t0 = performance.now();
      const f = await window.__cozy.exportProject({ project: pr, rig, api: window.api, outFile: ${JSON.stringify(out)} });
      return f + ' in ' + Math.round(performance.now() - t0) + 'ms';
    })()`;
    try {
      console.log('SELFTEST OK', await win.webContents.executeJavaScript(code));
    } catch (e) {
      console.error('SELFTEST FAIL', e);
    }
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());

// ------------------------------------------------------------------ spine
function loadSpineDir(dir) {
  const files = fs.readdirSync(dir);
  const jsonFile = files.find((f) => {
    if (!f.toLowerCase().endsWith('.json')) return false;
    try {
      const head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 400);
      return head.includes('"skeleton"');
    } catch (_) {
      return false;
    }
  });
  if (!jsonFile) throw new Error('Không tìm thấy file Spine .json trong thư mục');
  const base = jsonFile.replace(/\.json$/i, '');
  const atlasFile = files.find((f) => f === base + '.atlas') || files.find((f) => f.toLowerCase().endsWith('.atlas'));
  if (!atlasFile) throw new Error('Không tìm thấy file .atlas');
  const atlasText = fs.readFileSync(path.join(dir, atlasFile), 'utf8');
  const pages = atlasText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\.(png|jpg|jpeg|webp)$/i.test(l));
  const images = {};
  for (const p of pages) {
    const buf = fs.readFileSync(path.join(dir, p));
    const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
    images[p] = `data:image/${ext};base64,${buf.toString('base64')}`;
  }
  return { dir, jsonFile, jsonText: fs.readFileSync(path.join(dir, jsonFile), 'utf8'), atlasText, images };
}

ipcMain.handle('spine:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục Spine (json + atlas + png)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return loadSpineDir(r.filePaths[0]);
});
ipcMain.handle('spine:load', async (_e, dir) => loadSpineDir(path.resolve(dir)));
// First run: if the app folder sits inside the Spine folder (e.g. Downloads\\spine\\CozyClipStudio), use the parent.
ipcMain.handle('spine:guess', async () => {
  for (const d of [path.resolve(process.cwd(), '..'), path.resolve(__dirname, '..', '..')]) {
    try {
      return loadSpineDir(d);
    } catch (_) {}
  }
  return null;
});

// ---------------------------------------------------------------- project
ipcMain.handle('project:save', async (_e, project, filePath) => {
  let p = filePath;
  if (!p) {
    const r = await dialog.showSaveDialog(win, { title: 'Lưu dự án', defaultPath: (project.name || 'du-an') + '.cozy.json', filters: [{ name: 'CozyClip project', extensions: ['json'] }] });
    if (r.canceled) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, JSON.stringify(project, null, 2));
  return p;
});
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Mở dự án', filters: [{ name: 'CozyClip project', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], project: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
});

// ----------------------------------------------------------------- export
ipcMain.handle('export:pickOutput', async (_e, name) => {
  const r = await dialog.showSaveDialog(win, { title: 'Xuất video', defaultPath: (name || 'cozy') + '.mp4', filters: [{ name: 'MP4', extensions: ['mp4'] }] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('export:begin', async (_e, opts) => {
  if (job) job.cleanup();
  job = new ExportJob(opts);
  return job.workDir;
});
ipcMain.handle('export:clipBegin', async (_e, id) => job.beginClip(id));
ipcMain.handle('export:frame', async (_e, data) => job.writeFrame(data));
ipcMain.handle('export:clipEnd', async () => job.endClip());
ipcMain.handle('export:wav', async (_e, id, buf) => job.writeWav(id, buf));
ipcMain.handle('export:bgAudio', async (_e, bytes, ext, volume) => job.setBgAudio(bytes, ext, volume));
ipcMain.handle('export:finalize', async (_e, clips) => {
  const out = await job.finalize(clips, (p) => win.webContents.send('export:progress', p));
  job.cleanup();
  job = null;
  return out;
});
ipcMain.handle('export:cancel', async () => {
  if (job) {
    job.cancel();
    job.cleanup();
    job = null;
  }
});
// ------------------------------------------------------------------ media
// MOV / MKV / AVI… → a file Chromium can play (keeps alpha as WebM VP9)
ipcMain.handle('media:convert', async (e, src) => convertVideo(src, (p) => e.sender.send('media:convertProgress', p)));
ipcMain.handle('shell:show', async (_e, p) => shell.showItemInFolder(p));
