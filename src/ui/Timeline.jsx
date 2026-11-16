import React from 'react';
import { actionDef } from '../engine/character.js';
import { useLibrary, actionLabel, actionOptions as actionOptionsFor } from './library.js';
import { ENTER_PRESETS, resolveEnter } from '../engine/scene.js';
import { TIMES, WEATHERS } from '../engine/world.js';
import { fmtDuration, characterList, castEntry } from '../engine/scene.js';
import { renderActionAudio } from '../engine/audio.js';
import { uid } from '../engine/util.js';
import { Field, Select } from './panels.jsx';
import { useAudition } from './useAudioPreview.js';

const COLORS = ['#7aa5d8', '#d89a7a', '#8fc49a', '#c79ad8', '#d8c47a', '#7ad8c9'];

const presetOf = (e) =>
  !e || e.mode === 'walk' || !e.mode
    ? 'walk'
    : e.mode === 'instant'
    ? 'instant'
    : e.action === 'anim:run' && e.path !== 'arc'
    ? 'run'
    : e.action === 'anim:jump' && e.path === 'arc'
    ? 'jump'
    : 'custom';

/** "Đến vị trí này bằng…": how a character moves from the previous segment into this one. */
function EnterEditor({ project, rig, prevCe, ce, actionOptions, setEnter }) {
  const e = ce.enter || { mode: 'walk' };
  const mv = resolveEnter(project, rig, prevCe, ce);
  const moved = prevCe && Math.hypot((ce.x ?? 0) - (prevCe.x ?? 0), (ce.y ?? 0) - (prevCe.y ?? 0)) > 2;
  const patch = (k, v) => setEnter({ ...e, [k]: v });
  const info = mv
    ? `${mv.delay ? 'chờ ' + mv.delay.toFixed(1) + 's rồi ' : ''}${moved ? 'di chuyển' : 'diễn tại chỗ'} ${mv.T.toFixed(1)}s`
    : e.mode === 'instant'
    ? 'xuất hiện ngay ở vị trí mới'
    : 'không đổi vị trí → không có đoạn di chuyển';
  return (
    <div className="tl-enter">
      <Field label="↪ Đến vị trí này bằng">
        <Select value={presetOf(e)} options={Object.entries(ENTER_PRESETS).map(([k, p]) => [k, p.label])} onChange={(k) => setEnter(structuredClone(ENTER_PRESETS[k].enter))} />
      </Field>
      {e.mode === 'custom' && (
        <>
          <Field label="Hành động khi di chuyển">
            <Select value={e.action || 'anim:walk'} options={actionOptions} onChange={(v) => patch('action', v)} />
          </Field>
          <Field label="Đường đi">
            <Select value={e.path || 'line'} options={[['line', 'Thẳng'], ['arc', 'Vòng cung (nhảy lên/xuống)']]} onChange={(v) => patch('path', v)} />
          </Field>
          {e.path === 'arc' && (
            <Field label="Độ cao vòng cung (px)">
              <input type="number" min={0} max={1000} step={10} value={e.height ?? 120} onChange={(ev) => patch('height', Math.max(0, +ev.target.value || 0))} />
            </Field>
          )}
          <Field label="Hoạt ảnh">
            <Select value={e.once ? 'once' : 'loop'} options={[['loop', 'Lặp lại liên tục'], ['once', 'Một lần, trải hết quãng']]} onChange={(v) => patch('once', v === 'once')} />
          </Field>
          <Field label="Thời gian (s, 0 = tự động)">
            <input type="number" min={0} max={30} step={0.1} value={e.duration ?? 0} onChange={(ev) => patch('duration', Math.max(0, +ev.target.value || 0))} />
          </Field>
          <Field label="Chờ trước khi đi (s)">
            <input type="number" min={0} max={30} step={0.1} value={e.delay ?? 0} onChange={(ev) => patch('delay', Math.max(0, +ev.target.value || 0))} />
          </Field>
        </>
      )}
      <span className="muted small tl-enter-info">{info}</span>
    </div>
  );
}

export default function Timeline({ project, update, plan, segIndex, setSegIndex, rig }) {
  const lib = useLibrary();
  const tl = project.timeline;
  const seg = tl[Math.min(segIndex, tl.length - 1)];
  const chars = characterList(project);
  const audition = useAudition();
  const set = (k, v) => update((p) => (p.timeline[segIndex][k] = v === '' ? undefined : v));
  const setCast = (charId, k, v) =>
    update((p) => {
      const s = p.timeline[segIndex];
      s.cast = s.cast || {};
      s.cast[charId] = { ...(s.cast[charId] || {}), [k]: v };
    });
  const total = plan.total || 1;
  const actionOptions = actionOptionsFor(rig, lib);
  const segHasSound = (s) => chars.some((c) => actionDef(castEntry(s, c.id)?.action).sound);
  const moveSeg = (dir) => {
    const j = segIndex + dir;
    if (j < 0 || j >= tl.length) return;
    update((p) => ([p.timeline[segIndex], p.timeline[j]] = [p.timeline[j], p.timeline[segIndex]]));
    setSegIndex(j);
  };

  return (
    <div className="timeline">
      <div className="tl-head">
        <strong>Timeline</strong>
        <span className="muted small">
          Tổng {fmtDuration(plan.total)} · {tl.length} phân cảnh · {plan.clips.filter((c) => c.kind === 'move').length} đoạn di chuyển
        </span>
        <div className="spacer" />
        <button
          onClick={() => {
            const defCast = {};
            const floorY = Math.round((project.scene.floorLevel ?? 0.74) * 1080) + 120;
            chars.forEach((c, k) => (defCast[c.id] = { action: 'sit', x: 600 + k * 320, y: floorY }));
            const base = seg ? structuredClone(seg) : { minutes: 10, cast: defCast };
            const n = { ...base, id: uid('s') };
            update((p) => p.timeline.splice(segIndex + 1, 0, n));
            setSegIndex(segIndex + 1);
          }}
        >
          + Thêm phân cảnh
        </button>
      </div>
      <div className="tl-bar">
        {plan.clips.map((c) => {
          const i = tl.indexOf(c.seg);
          const w = Math.max(0.6, ((c.T * c.repeats) / total) * 100);
          if (c.kind === 'move') return <div key={c.id} className="tl-move" style={{ width: w + '%' }} title={`Di chuyển ${c.T.toFixed(1)}s`} />;
          const titleText = chars.map((ch) => `${ch.name}: ${actionLabel(castEntry(c.seg, ch.id)?.action || 'sit', lib)}`).join(' · ');
          return (
            <div
              key={c.id}
              className={'tl-seg' + (i === segIndex ? ' on' : '')}
              style={{ width: w + '%', background: COLORS[i % COLORS.length] }}
              onClick={() => setSegIndex(i)}
              title={titleText}
            >
              <b>{i + 1}</b> {chars.length} nv · {c.seg.minutes}′
            </div>
          );
        })}
      </div>
      {seg && (
        <div className="tl-editor">
          <div className="tl-cast">
            <strong className="muted small">Phân cảnh {segIndex + 1} — mỗi nhân vật làm gì:</strong>
            {chars.map((ch) => {
              const ce = castEntry(seg, ch.id) || {};
              const prevCe = segIndex > 0 ? castEntry(tl[segIndex - 1], ch.id) : null;
              return (
                <React.Fragment key={ch.id}>
                <div className="tl-cast-row">
                  <span className="tl-cast-name">🐾 {ch.name}</span>
                  <Field label="Hành động">
                    <Select value={ce.action || 'sit'} options={actionOptions} onChange={(v) => setCast(ch.id, 'action', v)} />
                  </Field>
                  <Field label="X">
                    <input type="number" value={Math.round(ce.x ?? 960)} onChange={(e) => setCast(ch.id, 'x', +e.target.value)} />
                  </Field>
                  <Field label="Y (chân)">
                    <input type="number" value={Math.round(ce.y ?? 980)} onChange={(e) => setCast(ch.id, 'y', +e.target.value)} />
                  </Field>
                  <label className="check tl-cast-flip">
                    <input type="checkbox" checked={!!ce.flip} onChange={(e) => setCast(ch.id, 'flip', e.target.checked)} /> Lật
                  </label>
                  {actionDef(ce.action).sound && (
                    <button
                      className="tl-listen"
                      title="Nghe thử tiếng hành động"
                      onClick={() => audition.play(() => renderActionAudio(project, rig, ch, castEntry(seg, ch.id)), `act:${seg.id}:${ch.id}`)}
                    >
                      {audition.playingId === `act:${seg.id}:${ch.id}` ? '⏹' : '🔊'}
                    </button>
                  )}
                </div>
                {prevCe && (
                  <EnterEditor project={project} rig={rig} prevCe={prevCe} ce={ce} actionOptions={actionOptions} setEnter={(v) => setCast(ch.id, 'enter', v)} />
                )}
                </React.Fragment>
              );
            })}
          </div>
          <Field label="Thời lượng (phút)">
            <input type="number" min={1} max={240} value={seg.minutes} onChange={(e) => set('minutes', Math.max(1, +e.target.value || 1))} />
          </Field>
          <Field label="Thời tiết">
            <Select value={seg.weather || ''} options={[['', 'Theo cảnh'], ...Object.entries(WEATHERS)]} onChange={(v) => set('weather', v)} />
          </Field>
          <Field label="Thời điểm">
            <Select value={seg.timeOfDay || ''} options={[['', 'Theo cảnh'], ...Object.entries(TIMES)]} onChange={(v) => set('timeOfDay', v)} />
          </Field>
          <div className="tl-actions">
            <button onClick={() => moveSeg(-1)}>←</button>
            <button onClick={() => moveSeg(1)}>→</button>
            <button
              className="danger"
              disabled={tl.length <= 1}
              onClick={() => {
                update((p) => p.timeline.splice(segIndex, 1));
                setSegIndex(Math.max(0, segIndex - 1));
              }}
            >
              Xoá
            </button>
          </div>
          <span className="muted small">{segHasSound(seg) ? '🔊 có âm thanh hành động' : ''}</span>
        </div>
      )}
    </div>
  );
}
