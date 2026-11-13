const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickSpine: () => ipcRenderer.invoke('spine:pick'),
  loadSpine: (dir) => ipcRenderer.invoke('spine:load', dir),
  guessSpine: () => ipcRenderer.invoke('spine:guess'),
  saveProject: (project, path) => ipcRenderer.invoke('project:save', project, path),
  openProject: () => ipcRenderer.invoke('project:open'),
  pickOutput: (name) => ipcRenderer.invoke('export:pickOutput', name),
  exportBegin: (opts) => ipcRenderer.invoke('export:begin', opts),
  clipBegin: (id) => ipcRenderer.invoke('export:clipBegin', id),
  frame: (data) => ipcRenderer.invoke('export:frame', data),
  clipEnd: () => ipcRenderer.invoke('export:clipEnd'),
  wav: (id, buf) => ipcRenderer.invoke('export:wav', id, buf),
  bgAudio: (bytes, ext, volume) => ipcRenderer.invoke('export:bgAudio', bytes, ext, volume),
  finalize: (clips) => ipcRenderer.invoke('export:finalize', clips),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  // convert a picked video File (by its path on disk, or its bytes) into a playable video
  convertVideo: async (file, onProgress) => {
    let p = '';
    try {
      p = webUtils.getPathForFile(file);
    } catch (_) {}
    const h = (_e, v) => onProgress && onProgress(v);
    ipcRenderer.on('media:convertProgress', h);
    try {
      return await ipcRenderer.invoke('media:convert', p ? { path: p } : { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name });
    } finally {
      ipcRenderer.removeListener('media:convertProgress', h);
    }
  },
  onExportProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('export:progress', h);
    return () => ipcRenderer.removeListener('export:progress', h);
  },
});
