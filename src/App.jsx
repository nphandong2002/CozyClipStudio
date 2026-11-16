import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cozyRoomPreset, campingPreset, migrateProject } from './engine/presets.js';
import { loadRigFromBundle, loadSampleBundle } from './engine/loadSpine.js';
import { buildPlan, fmtDuration, windowPoints } from './engine/scene.js';
import Stage from './ui/Stage.jsx';
import Timeline from './ui/Timeline.jsx';
import { ScenePanel, PropsPanel, CharacterPanel } from './ui/panels.jsx';
import ExportDialog from './ui/ExportDialog.jsx';
import { useAudioPreview, useBackgroundAudio, useAuditionSolo } from './ui/useAudioPreview.js';
import { useHistory } from './ui/useHistory.js';
import { preloadProject } from './engine/images.js';
import { uid } from './engine/util.js';
import { LibraryPage, NamesPage } from './ui/LibraryPages.jsx';
import { SpinePage } from './ui/SpinePage.jsx';
import { loadArt } from './engine/artsets.js';

loadArt(); // bộ hình Spine (ảnh thay thế bộ phận) dùng chung cho mọi dự án
import { addLibraryCharToProject } from './ui/library.js';

const STORE_KEY = 'cozyclip.project.v1';
const api = typeof window !== 'undefined' ? window.api : null;

function loadStored() {
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s) return migrateProject(JSON.parse(s));
  } catch (_) {}
  return cozyRoomPreset();
}

export default function App() {
  const { project, update, setProject, undo, redo } = useHistory(loadStored);
  const [rig, setRig] = useState(null);
  const [spineMsg, setSpineMsg] = useState('Đang tải nhân vật…');
  const [view, setView] = useState('edit'); // 'edit' | 'library' | 'spine' | 'names'
  const [tab, setTab] = useState('scene');
  const [selection, setSelection] = useState(null); // {kind:'prop'|'anchor', id}
  const [charSel, setCharSel] = useState(null);
  const [segIndex, setSegIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [filePath, setFilePath] = useState(null);
  const [previewMove, setPreviewMove] = useState(false);
  const clock = useRef({ start: performance.now(), pausedAt: 0 });
  const clipboard = useRef(null);

  // Khôi phục từ file cache (Electron) nếu có — ưu tiên hơn localStorage vì không bị giới hạn dung lượng
  const cacheReady = useRef(!api?.loadCache);
  useEffect(() => {
    if (!api?.loadCache) return;
    api
      .loadCache()
      .then((c) => {
        if (c) setProject(migrateProject(c));
      })
      .catch((e) => console.warn('loadCache', e))
      .finally(() => (cacheReady.current = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave: mỗi thay đổi → ghi ra file cache (và localStorage nếu còn chỗ)
  useEffect(() => {
    if (!cacheReady.current) return; // chưa nạp xong cache thì không ghi đè
    const id = setTimeout(() => {
      let json;
      try {
        json = JSON.stringify(project);
      } catch (_) {
        return;
      }
      api?.saveCache?.(json).catch((e) => console.warn('saveCache', e));
      try {
        localStorage.setItem(STORE_KEY, json);
      } catch (_) {}
    }, 150);
    return () => clearTimeout(id);
  }, [project]);

  // load spine
  const applyBundle = useCallback(
    async (bundle) => {
      const r = await loadRigFromBundle(bundle);
      setRig(r);
      setSpineMsg(`${r.catalog.characters.length} nhân vật · ${r.animNames.length} hành động`);
      if (bundle.dir && bundle.dir !== 'sample') update((p) => (p.spineDir = bundle.dir));
      update((p) => {
        for (const c of p.characters || []) {
          if (!r.catalog.characters.includes(c.skin)) c.skin = r.catalog.characters[0];
        }
      });
    },
    [update]
  );

  useEffect(() => {
    (async () => {
      try {
        if (api && project.spineDir) return await applyBundle(await api.loadSpine(project.spineDir));
        if (api) {
          const g = await api.guessSpine();
          if (g) return await applyBundle(g);
        }
      } catch (e) {
        console.warn(e);
      }
      try {
        await applyBundle(await loadSampleBundle());
      } catch (_) {
        setSpineMsg('Chưa có nhân vật — bấm "Thư mục Spine"');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickSpine = async () => {
    if (!api) return alert('Chức năng này cần chạy trong ứng dụng desktop (npm run dev).');
    try {
      const b = await api.pickSpine();
      if (b) await applyBundle(b);
    } catch (e) {
      alert(e.message);
    }
  };

  const plan = useMemo(() => buildPlan(project, rig), [project, rig]);
  const seg = project.timeline[Math.min(segIndex, project.timeline.length - 1)];
  const loopClip = plan.clips.find((c) => c.kind === 'loop' && c.seg === seg) || plan.clips.find((c) => c.kind === 'loop');
  const moveClip = plan.clips[plan.clips.indexOf(loopClip) - 1];
  const activeClip = previewMove && moveClip?.kind === 'move' ? moveClip : loopClip;

  // restart clock when clip changes
  useEffect(() => {
    clock.current = { start: performance.now(), pausedAt: 0 };
  }, [activeClip?.id]);

  const solo = useAuditionSolo(); // a "nghe thử" is playing → scene audio muted meanwhile
  const editing = view === 'edit';
  useAudioPreview({ project, rig, clip: activeClip, playing: editing && playing && !muted, clock, solo });
  useBackgroundAudio({ project, playing: editing && playing && !muted, solo });

  // preload user-uploaded images (object props + background)
  useEffect(() => {
    preloadProject(project);
  }, [project]);

  const onMoveDone = useCallback(() => setPreviewMove(false), []);

  const save = async (as) => {
    if (!api) {
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (project.name || 'du-an') + '.cozy.json';
      a.click();
      return;
    }
    const p = await api.saveProject(project, as ? null : filePath);
    if (p) setFilePath(p);
  };
  const open = async () => {
    let r = null;
    if (api) r = await api.openProject();
    else {
      // Chạy trên trình duyệt (không có Electron): chọn file .json bằng hộp thoại của trình duyệt
      r = await new Promise((resolve) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json';
        inp.onchange = async () => {
          const f = inp.files?.[0];
          if (!f) return resolve(null);
          try {
            resolve({ path: null, project: JSON.parse(await f.text()) });
          } catch (e) {
            alert('File dự án không hợp lệ: ' + e.message);
            resolve(null);
          }
        };
        inp.oncancel = () => resolve(null);
        inp.click();
      });
    }
    if (r) {
      setProject(migrateProject(r.project));
      setFilePath(r.path);
      setSegIndex(0);
    }
  };
  const loadPreset = (fn) => {
    if (!confirm('Thay dự án hiện tại bằng mẫu này?')) return;
    const p = fn();
    p.spineDir = project.spineDir;
    setProject(p);
    setSegIndex(0);
    setSelection(null);
  };

  // Thêm một nhân vật (với skin đã chọn) từ thư viện vào dự án đang mở
  const addFromLibrary = (libChar, skin) => {
    const id = uid('c'); // tạo id ngoài updater (updater có thể chạy 2 lần)
    update((p) => {
      addLibraryCharToProject(p, libChar, skin, rig?.catalog.rods[0] || '', id);
    });
    setView('edit');
    setTab('char');
    setCharSel(id);
    setSelection({ kind: 'char', id });
  };

  // ---------------------------------------------------- selection operations
  const deleteSel = () => {
    if (!selection) return;
    if (selection.kind === 'prop') {
      update((p) => (p.props = p.props.filter((x) => x.id !== selection.id)));
      setSelection(null);
    } else if (selection.kind === 'char') {
      if ((project.characters || []).length <= 1) return;
      update((p) => {
        p.characters = p.characters.filter((c) => c.id !== selection.id);
        for (const s of p.timeline) if (s.cast) delete s.cast[selection.id];
      });
      setCharSel(project.characters.find((c) => c.id !== selection.id)?.id || null);
      setSelection(null);
    } else if (selection.kind === 'window') {
      update((p) => (p.scene.windows = (p.scene.windows || []).filter((w) => w.id !== selection.id)));
      setSelection(null);
    }
  };
  const copySel = () => {
    if (selection?.kind !== 'prop') return; // only props copy/paste on the stage
    const o = project.props.find((x) => x.id === selection.id);
    if (o) clipboard.current = { kind: 'prop', data: structuredClone(o) };
  };
  const pasteClip = () => {
    const c = clipboard.current;
    if (!c || c.kind !== 'prop') return;
    const id = uid(c.data.type);
    const copy = { ...structuredClone(c.data), id, x: (c.data.x || 0) + 40, y: (c.data.y || 0) + 40 };
    update((p) => p.props.push(copy));
    setSelection({ kind: 'prop', id });
    setTab('props');
  };
  const duplicateSel = () => {
    copySel();
    pasteClip();
  };
  const nudgeSel = (dx, dy) => {
    if (!selection) return;
    if (selection.kind === 'prop') {
      update((p) => {
        const o = p.props.find((x) => x.id === selection.id);
        if (o) {
          o.x = Math.round((o.x || 0) + dx);
          o.y = Math.round((o.y || 0) + dy);
        }
      }, 'nudge');
    } else if (selection.kind === 'char') {
      update((p) => {
        const ce = p.timeline[segIndex]?.cast?.[selection.id];
        if (ce) {
          ce.x = Math.round((ce.x || 0) + dx);
          ce.y = Math.round((ce.y || 0) + dy);
        }
      }, 'nudge');
    } else if (selection.kind === 'window') {
      update((p) => {
        const w = (p.scene.windows || []).find((x) => x.id === selection.id);
        if (w) {
          w.points = windowPoints(w).map((pt) => ({ x: Math.round(pt.x + dx), y: Math.round(pt.y + dy) }));
          delete w.x;
          delete w.y;
          delete w.w;
          delete w.h;
          delete w.rotate;
        }
      }, 'nudge');
    }
  };

  // keep the latest closures in a ref so the window listener stays stable
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    const el = document.activeElement;
    if (view !== 'edit') return; // phím tắt chỉnh sửa chỉ dùng ở màn dựng clip
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo();
    if (mod && k === 'y') return e.preventDefault(), redo();
    if (mod && k === 's') return e.preventDefault(), save(false);
    if (mod && k === 'c') return copySel();
    if (mod && k === 'v') {
      if (clipboard.current) {
        e.preventDefault();
        pasteClip();
      }
      return;
    }
    if (mod && k === 'd') {
      if (selection) {
        e.preventDefault();
        duplicateSel();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection) {
        e.preventDefault();
        deleteSel();
      }
      return;
    }
    if (selection && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      nudgeSel(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    }
  };
  useEffect(() => {
    const onKey = (e) => keyRef.current && keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">CozyClip Studio</div>
        <nav className="views">
          {[
            ['edit', '🎬 Dựng clip'],
            ['library', '🐾 Thư viện nhân vật'],
            ['spine', '🎨 Spine'],
            ['names', '🏷 Đặt tên bộ phận'],
          ].map(([k, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </nav>
        <input className="name" value={project.name} onChange={(e) => update((p) => (p.name = e.target.value))} />
        <div className="spacer" />
        <span className="muted small">{spineMsg}</span>
        <button onClick={pickSpine}>Thư mục Spine</button>
        <button title="Hoàn tác (Ctrl+Z)" onClick={undo}>↶</button>
        <button title="Làm lại (Ctrl+Y)" onClick={redo}>↷</button>
        <button onClick={open}>Mở</button>
        <button onClick={() => save(false)}>Lưu</button>
        <button onClick={() => save(true)}>Lưu thành…</button>
        <button className="primary" onClick={() => setExportOpen(true)} disabled={!rig}>
          Xuất video ({fmtDuration(plan.total)})
        </button>
      </header>

      {view === 'library' && <LibraryPage rig={rig} onAddToProject={addFromLibrary} goNames={() => setView('names')} goSpine={() => setView('spine')} />}
      {view === 'names' && <NamesPage rig={rig} />}
      {view === 'spine' && <SpinePage rig={rig} />}
      {view === 'edit' && (
      <div className="main">
        <aside className="side">
          <nav className="tabs">
            {[
              ['scene', 'Cảnh'],
              ['props', 'Vật thể'],
              ['char', 'Nhân vật'],
            ].map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </nav>
          <div className="panel">
            {tab === 'scene' && (
              <ScenePanel
                project={project}
                update={update}
                presets={{ room: () => loadPreset(cozyRoomPreset), camp: () => loadPreset(campingPreset) }}
                selection={selection}
                setSelection={setSelection}
              />
            )}
            {tab === 'props' && <PropsPanel project={project} update={update} selection={selection} setSelection={setSelection} />}
            {tab === 'char' && <CharacterPanel project={project} update={update} rig={rig} charSel={charSel} setCharSel={setCharSel} openLibrary={() => setView('library')} />}
          </div>
        </aside>

        <section className="center">
          <Stage
            project={project}
            rig={rig}
            clip={activeClip}
            playing={playing}
            clock={clock}
            showGuides={showGuides}
            selection={selection}
            setSelection={(s) => {
              setSelection(s);
              if (s?.kind === 'prop') setTab('props');
              else if (s?.kind === 'char') {
                setTab('char');
                setCharSel(s.id);
              } else if (s?.kind === 'window') setTab('scene');
            }}
            update={update}
            onMoveDone={onMoveDone}
          />
          <div className="transport">
            <button onClick={() => setPlaying((v) => !v)}>{playing ? '❚❚ Dừng' : '▶ Phát'}</button>
            <button onClick={() => setMuted((v) => !v)}>{muted ? '🔇 Bật tiếng' : '🔊 Tắt tiếng'}</button>
            <button disabled={moveClip?.kind !== 'move'} onClick={() => setPreviewMove(true)}>
              ↪ Xem đoạn di chuyển
            </button>
            <label className="check">
              <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} /> Hiện khung chỉnh
            </label>
            <span className="muted small">
              Đang xem: {activeClip?.kind === 'move' ? 'di chuyển' : `phân cảnh ${project.timeline.indexOf(seg) + 1}`} · vòng lặp {project.output.loopSeconds}s · kéo thả vật thể / điểm neo trên khung hình
            </span>
            <span className="muted small kbd-hint">
              Phím tắt: <b>Delete</b> xoá · <b>Ctrl+Z/Y</b> hoàn tác/làm lại · <b>Ctrl+C/V</b> chép/dán · <b>Ctrl+D</b> nhân bản · <b>mũi tên</b> dịch (giữ Shift = 10px) · <b>Ctrl+S</b> lưu
            </span>
          </div>
          <Timeline project={project} update={update} plan={plan} segIndex={segIndex} setSegIndex={setSegIndex} rig={rig} />
        </section>
      </div>
      )}

      {exportOpen && <ExportDialog project={project} rig={rig} api={api} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
