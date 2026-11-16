// Trang "Thư viện nhân vật" (tạo nhân vật + skin dùng lại cho mọi dự án)
// và trang "Đặt tên bộ phận" (đặt tên dễ hiểu cho mẫu mắt, trang phục, hành động…).
import React, { useMemo, useState } from 'react';
import { Field, Range, Select } from './panels.jsx';
import { RigPreview, RigThumb } from './RigPreview.jsx';
import {
  useLibrary,
  setLibrary,
  partLabel,
  actionLabel,
  actionOptions,
  shortName,
  newLibChar,
  newSkin,
  skinLook,
  exportLibraryFile,
  importLibraryFile,
} from './library.js';
import { uid } from '../engine/util.js';

/** "Tên tuỳ chỉnh (tên gốc)" so the raw Spine name is never lost. */
function optLabel(name, lib) {
  const custom = lib.labels[name];
  return custom ? `${custom} (${shortName(name)})` : shortName(name);
}

/** Select with ‹ › buttons to flick through parts quickly. */
export function PartPicker({ value, options, onChange }) {
  const i = Math.max(0, options.findIndex((o) => o[0] === (value || '')));
  const step = (d) => onChange(options[(i + d + options.length) % options.length][0]);
  return (
    <div className="picker">
      <button title="Mục trước" onClick={() => step(-1)}>
        ‹
      </button>
      <Select value={value || ''} options={options} onChange={onChange} />
      <button title="Mục sau" onClick={() => step(1)}>
        ›
      </button>
    </div>
  );
}

const defaultBase = (cat) => (cat.characters.includes('skins/meow') ? 'skins/meow' : cat.characters[0] || '');

// ====================================================================== library
export function LibraryPage({ rig, onAddToProject, goNames }) {
  const lib = useLibrary();
  const [selId, setSelId] = useState(null);
  const [skinId, setSkinId] = useState(null);
  const [flip, setFlip] = useState(false);
  const [msg, setMsg] = useState('');

  if (!rig) return <div className="page-empty muted">Chưa tải bộ Spine — bấm "Thư mục Spine" ở thanh trên.</div>;
  const cat = rig.catalog;
  const ch = lib.characters.find((c) => c.id === selId) || lib.characters[0];
  const skin = ch && (ch.skins.find((s) => s.id === skinId) || ch.skins[0]);

  const editChar = (fn) =>
    setLibrary((l) => {
      const c = l.characters.find((x) => x.id === ch.id);
      if (c) fn(c);
    });
  const editSkin = (k, v) =>
    editChar((c) => {
      const s = c.skins.find((x) => x.id === skin.id);
      if (s) s[k] = v;
    });

  const addChar = () => {
    const c = newLibChar(defaultBase(cat));
    c.name = 'Nhân vật ' + (lib.characters.length + 1);
    setLibrary((l) => l.characters.push(c));
    setSelId(c.id);
    setSkinId(c.skins[0].id);
  };
  const dupChar = () => {
    const c = structuredClone(ch);
    c.id = uid('lc');
    c.name += ' (bản sao)';
    c.skins = c.skins.map((s) => ({ ...s, id: uid('sk') }));
    setLibrary((l) => l.characters.push(c));
    setSelId(c.id);
    setSkinId(c.skins[0].id);
  };
  const delChar = () => {
    if (!confirm(`Xoá nhân vật "${ch.name}" khỏi thư viện? (Các dự án đã dùng nhân vật này không bị ảnh hưởng.)`)) return;
    setLibrary((l) => (l.characters = l.characters.filter((x) => x.id !== ch.id)));
    setSelId(null);
    setSkinId(null);
  };
  const addSkin = (copy) => {
    const s = copy ? { ...structuredClone(skin), id: uid('sk'), name: skin.name + ' (bản sao)' } : newSkin('Skin ' + (ch.skins.length + 1));
    editChar((c) => c.skins.push(s));
    setSkinId(s.id);
  };
  const delSkin = () => {
    if (!confirm(`Xoá skin "${skin.name}"?`)) return;
    editChar((c) => (c.skins = c.skins.filter((x) => x.id !== skin.id)));
    setSkinId(null);
  };
  const doImport = async () => {
    try {
      const r = await importLibraryFile();
      if (r) setMsg('Đã nhập ' + r);
    } catch (e) {
      alert(e.message);
    }
  };

  const parts = (list, none) => [...(none ? [['', none]] : []), ...list.map((n) => [n, optLabel(n, lib)])];
  const look = ch && skinLook(ch, skin);

  return (
    <div className="lib-page">
      <aside className="lib-left">
        <div className="lib-head">
          <h2>Thư viện nhân vật</h2>
          <div className="row">
            <button className="primary" onClick={addChar}>
              + Nhân vật mới
            </button>
            <button onClick={doImport} title="Nhập nhân vật + tên tuỳ chỉnh từ file .json">
              Nhập…
            </button>
            <button onClick={exportLibraryFile} disabled={!lib.characters.length && !Object.keys(lib.labels).length} title="Lưu thư viện ra file để mang sang máy khác">
              Xuất…
            </button>
          </div>
          {msg && <p className="ok small">{msg}</p>}
        </div>

        {!lib.characters.length ? (
          <p className="muted">
            Chưa có nhân vật nào. Bấm <b>+ Nhân vật mới</b>, chọn nhân vật gốc rồi tạo các skin (mẫu mắt, trang phục…). Nhân vật trong thư viện dùng được cho mọi dự án.
          </p>
        ) : (
          <ul className="list lib-chars">
            {lib.characters.map((c) => (
              <li
                key={c.id}
                className={ch?.id === c.id ? 'on' : ''}
                onClick={() => {
                  setSelId(c.id);
                  setSkinId(null);
                }}
              >
                <RigThumb rig={rig} look={skinLook(c, c.skins[0])} frame="head" size={36} />
                <span className="grow">{c.name}</span>
                <span className="badge">{c.skins.length} skin</span>
              </li>
            ))}
          </ul>
        )}

        {ch && skin && (
          <div className="editor">
            <h3>Nhân vật</h3>
            <Field label="Tên nhân vật">
              <input value={ch.name} onChange={(e) => editChar((c) => (c.name = e.target.value))} />
            </Field>
            <Field label="Nhân vật gốc (bộ Spine)">
              <PartPicker value={ch.base} options={parts(cat.characters)} onChange={(v) => editChar((c) => (c.base = v))} />
            </Field>
            <Field label="Kích thước mặc định trong clip">
              <Range value={ch.scale ?? 0.6} min={0.25} max={1.4} step={0.01} onChange={(v) => editChar((c) => (c.scale = v))} fmt={(v) => v.toFixed(2) + '×'} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={!!ch.facesLeft} onChange={(e) => editChar((c) => (c.facesLeft = e.target.checked))} /> Nhân vật gốc quay mặt sang trái
            </label>

            <h3>Skin</h3>
            <div className="chips">
              {ch.skins.map((s) => (
                <button key={s.id} className={s.id === skin.id ? 'chip on' : 'chip'} onClick={() => setSkinId(s.id)}>
                  {s.name || '(chưa đặt tên)'}
                </button>
              ))}
              <button className="chip add" onClick={() => addSkin(false)}>
                + Skin mới
              </button>
            </div>
            <Field label="Tên skin">
              <input value={skin.name} onChange={(e) => editSkin('name', e.target.value)} />
            </Field>
            <Field label="Mẫu mắt">
              <PartPicker value={skin.eyes} options={parts(cat.eyes, 'Mặc định')} onChange={(v) => editSkin('eyes', v)} />
            </Field>
            <Field label="Trang phục">
              <PartPicker value={skin.costume} options={parts(cat.costumes, 'Không')} onChange={(v) => editSkin('costume', v)} />
            </Field>
            <Field label="Mặt nạ / phụ kiện">
              <PartPicker value={skin.mask} options={parts(cat.masks, 'Không')} onChange={(v) => editSkin('mask', v)} />
            </Field>
            <Field label="Cần câu (hiện khi câu cá)">
              <PartPicker value={skin.rod} options={parts(cat.rods, 'Mặc định')} onChange={(v) => editSkin('rod', v)} />
            </Field>
            <Field label="Hành động mặc định" hint="Dùng để xem trước và làm hành động ban đầu khi thêm vào dự án.">
              <PartPicker value={skin.action || 'idle'} options={actionOptions(rig, lib)} onChange={(v) => editSkin('action', v)} />
            </Field>
            <div className="row">
              <button onClick={() => addSkin(true)}>Nhân bản skin</button>
              <button className="danger" disabled={ch.skins.length <= 1} onClick={delSkin}>
                Xoá skin
              </button>
            </div>
            <p className="muted small">
              Chưa biết “{shortName(skin.costume || 'dress-blue')}” trông thế nào?{' '}
              <button className="linkish" onClick={goNames}>
                Xem &amp; đặt tên ở trang Đặt tên bộ phận →
              </button>
            </p>

            <div className="row lib-actions">
              <button onClick={dupChar}>Nhân bản nhân vật</button>
              <button className="danger" onClick={delChar}>
                Xoá nhân vật
              </button>
              <div className="spacer" />
              <button className="primary" onClick={() => onAddToProject(ch, skin)}>
                Thêm vào dự án
              </button>
            </div>
          </div>
        )}
      </aside>

      <section className="lib-right">
        {ch && skin ? (
          <>
            <div className="lib-preview-head">
              <b>{ch.name}</b>
              <span className="muted">
                · {skin.name} · {actionLabel(skin.action || 'idle', lib)}
              </span>
              <div className="spacer" />
              <label className="check">
                <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} /> Lật ngang
              </label>
            </div>
            <RigPreview rig={rig} look={look} action={skin.action || 'idle'} flip={flip} />
            <div className="skin-strip">
              {ch.skins.map((s) => (
                <button key={s.id} className={s.id === skin.id ? 'skin-card on' : 'skin-card'} onClick={() => setSkinId(s.id)}>
                  <RigThumb rig={rig} look={skinLook(ch, s)} action="idle" size={96} />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="page-empty muted">Xem trước nhân vật sẽ hiện ở đây.</div>
        )}
      </section>
    </div>
  );
}

// ====================================================================== names
const CATS = [
  { key: 'costumes', label: 'Trang phục', field: 'costume', frame: 'full' },
  { key: 'eyes', label: 'Mẫu mắt', field: 'eyes', frame: 'head' },
  { key: 'masks', label: 'Mặt nạ / phụ kiện', field: 'mask', frame: 'head' },
  { key: 'actions', label: 'Hành động', frame: 'full' },
  { key: 'characters', label: 'Nhân vật gốc', field: 'skin', frame: 'full' },
  { key: 'rods', label: 'Cần câu', field: 'rod', frame: 'full', action: 'fish' },
];

export function NamesPage({ rig }) {
  const lib = useLibrary();
  const [catKey, setCatKey] = useState('costumes');
  const [q, setQ] = useState('');
  const [hideFat, setHideFat] = useState(false);
  const [onlyUnnamed, setOnlyUnnamed] = useState(false);
  const [ref, setRef] = useState('');
  const [sel, setSel] = useState(null);
  const [zoomHead, setZoomHead] = useState(true);

  const catDef = CATS.find((c) => c.key === catKey);
  const items = useMemo(() => {
    if (!rig) return [];
    if (catKey === 'actions') return actionOptions(rig, { labels: {} }).map(([id, def]) => ({ id, key: 'action:' + id, raw: id.replace(/^anim:/, ''), def }));
    return (rig.catalog[catKey] || []).map((n) => ({ id: n, key: n, raw: shortName(n), def: shortName(n) }));
  }, [rig, catKey]);

  if (!rig) return <div className="page-empty muted">Chưa tải bộ Spine — bấm "Thư mục Spine" ở thanh trên.</div>;
  const cat = rig.catalog;
  const refBase = cat.characters.includes(ref) ? ref : defaultBase(cat);

  const needle = q.trim().toLowerCase();
  const shown = items.filter((it) => {
    if (hideFat && /-fat$/.test(it.raw)) return false;
    const custom = lib.labels[it.key] || '';
    if (onlyUnnamed && custom) return false;
    if (!needle) return true;
    return it.raw.toLowerCase().includes(needle) || it.def.toLowerCase().includes(needle) || custom.toLowerCase().includes(needle);
  });
  const named = items.filter((it) => lib.labels[it.key]).length;

  const lookFor = (it) => {
    if (catKey === 'actions' || !catDef.field) return { skin: refBase };
    if (catKey === 'characters') return { skin: it.id };
    return { skin: refBase, [catDef.field]: it.id };
  };
  const actionFor = (it) => (catKey === 'actions' ? it.id : catDef.action || 'idle');
  const setLabel = (key, v) =>
    setLibrary((l) => {
      if (v.trim()) l.labels[key] = v;
      else delete l.labels[key];
    });

  const cur = shown.find((it) => it.key === sel) || items.find((it) => it.key === sel) || shown[0];
  const curFrame = catDef.frame === 'head' && zoomHead ? 'head' : 'full';

  return (
    <div className="lib-page names-page">
      <aside className="lib-left wide">
        <div className="lib-head">
          <h2>Đặt tên bộ phận</h2>
          <p className="muted small">Bấm vào một ô để xem lớn bên phải, gõ tên dễ nhớ vào ô bên dưới ảnh. Tên này dùng ở mọi danh sách chọn trong ứng dụng; để trống = dùng tên gốc.</p>
        </div>
        <nav className="seg">
          {CATS.map((c) => (
            <button
              key={c.key}
              className={c.key === catKey ? 'on' : ''}
              onClick={() => {
                setCatKey(c.key);
                setSel(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </nav>
        <div className="row names-filters">
          <input className="grow" placeholder="Tìm theo tên gốc hoặc tên đã đặt…" value={q} onChange={(e) => setQ(e.target.value)} />
          {catKey !== 'characters' && (
            <label className="field inline">
              <span>Xem trên</span>
              <Select value={refBase} options={cat.characters.map((n) => [n, optLabel(n, lib)])} onChange={setRef} />
            </label>
          )}
        </div>
        <div className="row names-filters">
          {catKey === 'costumes' && (
            <label className="check">
              <input type="checkbox" checked={hideFat} onChange={(e) => setHideFat(e.target.checked)} /> Ẩn bản “-fat”
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={onlyUnnamed} onChange={(e) => setOnlyUnnamed(e.target.checked)} /> Chỉ hiện mục chưa đặt tên
          </label>
          <div className="spacer" />
          <span className="muted small">
            Đã đặt tên {named}/{items.length} · đang hiện {shown.length}
          </span>
        </div>
        <div className="name-grid">
          {shown.map((it) => (
            <div key={it.key} className={cur?.key === it.key ? 'name-card on' : 'name-card'} onClick={() => setSel(it.key)}>
              <RigThumb rig={rig} look={lookFor(it)} action={actionFor(it)} frame={catDef.frame} size={120} />
              <code title={it.id}>{it.raw}</code>
              <input value={lib.labels[it.key] || ''} placeholder={it.def} onFocus={() => setSel(it.key)} onChange={(e) => setLabel(it.key, e.target.value)} />
            </div>
          ))}
          {!shown.length && <p className="muted">Không có mục nào khớp.</p>}
        </div>
      </aside>

      <section className="lib-right">
        {cur ? (
          <>
            <div className="lib-preview-head">
              <b>{lib.labels[cur.key] || cur.def}</b>
              <code className="muted">{cur.id}</code>
              <div className="spacer" />
              {catDef.frame === 'head' && (
                <label className="check">
                  <input type="checkbox" checked={zoomHead} onChange={(e) => setZoomHead(e.target.checked)} /> Phóng to mặt
                </label>
              )}
            </div>
            <RigPreview rig={rig} look={lookFor(cur)} action={actionFor(cur)} frame={curFrame} />
            <Field label="Tên hiển thị">
              <input value={lib.labels[cur.key] || ''} placeholder={cur.def} onChange={(e) => setLabel(cur.key, e.target.value)} />
            </Field>
          </>
        ) : (
          <div className="page-empty muted">Chọn một mục để xem trước.</div>
        )}
      </section>
    </div>
  );
}
