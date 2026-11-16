// Spine character: loading, look (skin combination), deterministic posing.
import * as spine from '@esotericsoftware/spine-canvas';
import { TAU, mulberry32, roundRect as roundRectPath } from './util.js';
import { applyArt, artGen, getArtSet } from './artsets.js';

/** Built-in action presets. `seq` = animations played in order inside one cycle. */
export const ACTIONS = {
  sleep: { label: 'Ngủ', seq: [['sleep', 1]], sound: 'purr', blink: false },
  sit: { label: 'Ngồi thư giãn', seq: [['sit', 1]], sound: null, blink: true },
  sitLick: { label: 'Ngồi liếm lông', seq: [['sit', 4], ['lick', 2]], sound: 'lick', blink: true },
  sitSad: { label: 'Ngồi ngắm mưa', seq: [['sit-sad', 1]], sound: null, blink: true },
  idle: { label: 'Đứng nghỉ', seq: [['idle', 1]], sound: null, blink: true },
  broom: { label: 'Quét nhà', seq: [['broom', 1]], sound: 'sweep', blink: true, tool: 'broom' },
  dig: { label: 'Làm vườn / đào đất', seq: [['dig', 1]], sound: 'dig', blink: true, tool: 'shovel' },
  fish: { label: 'Câu cá', seq: [['fish', 8], ['fish-hook', 2], ['fish-catch', 1]], sound: 'fish', blink: true, needs: 'rod' },
  chew: { label: 'Ăn / nhai', seq: [['chew', 1]], sound: 'chew', blink: true },
  petting: { label: 'Vuốt ve', seq: [['petting', 1]], sound: 'purr', blink: true },
  tired: { label: 'Ngáp / mệt', seq: [['tired', 1]], sound: null, blink: false },
  danceChill: { label: 'Nhún nhảy chill', seq: [['dance-chill', 1]], sound: 'tap', blink: true },
};

export function actionDef(id, animNames) {
  if (ACTIONS[id]) return ACTIONS[id];
  if (id?.startsWith('anim:')) {
    const a = id.slice(5);
    return { label: a, seq: [[a, 1]], sound: null, blink: true };
  }
  return ACTIONS.idle;
}

export const TOOL_ANGLE = { broom: 180, shovel: 180 };

export class CharacterRig {
  static async load({ jsonText, atlasText, images }) {
    const atlas = new spine.TextureAtlas(atlasText);
    for (const page of atlas.pages) {
      const img = images[page.name];
      if (!img) throw new Error('Thiếu ảnh atlas: ' + page.name);
      page.setTexture(new spine.CanvasTexture(img));
    }
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const json = new spine.SkeletonJson(loader);
    const data = json.readSkeletonData(typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText);
    return new CharacterRig(data);
  }

  constructor(data) {
    this.data = data;
    this.skeleton = new spine.Skeleton(data);
    this.renderer = null;
    this.lookKey = '';
    this.animNames = data.animations.map((a) => a.name);
    const names = data.skins.map((s) => s.name);
    this.catalog = {
      characters: names.filter((n) => n.startsWith('skins/')),
      eyes: names.filter((n) => /eyes/.test(n)),
      costumes: names.filter((n) => n.startsWith('costumes/')),
      masks: names.filter((n) => n.startsWith('masks/')),
      rods: names.filter((n) => n.startsWith('rods/')),
      extras: names.filter((n) => n.startsWith('bow-arrow')),
    };
  }

  setLook(look = {}, action = null) {
    const parts = [look.skin || this.catalog.characters[0], look.eyes, look.costume, look.mask];
    const needsRod = action && actionDef(action).needs === 'rod';
    if (needsRod) parts.push(look.rod || this.catalog.rods[0]);
    // bộ hình Spine (ảnh thay thế) → khoá gồm cả "thế hệ" của kho bộ hình để tự dựng lại khi sửa
    const art = look.art && getArtSet(look.art) ? look.art + '@' + artGen() : '';
    const key = parts.filter(Boolean).join('|') + (art ? '#' + art : '');
    if (key === this.lookKey) return;
    this._skins = this._skins || new Map();
    let built = this._skins.get(key);
    if (!built) {
      const skin = new spine.Skin('look');
      const def = this.data.findSkin('default');
      if (def) skin.addSkin(def);
      for (const p of parts) {
        const s = p && this.data.findSkin(p);
        if (s) skin.addSkin(s);
      }
      const extras = art ? applyArt(this, skin, look.art) : [];
      built = { skin, extras };
      if (this._skins.size > 60) this._skins.clear();
      this._skins.set(key, built);
    }
    this.skeleton.setSkin(built.skin);
    this.skeleton.setSlotsToSetupPose();
    this.extras = built.extras;
    this.lookKey = key;
  }

  /** Duration of one action cycle in seconds (before loop fitting). */
  cycleDuration(actionId) {
    const def = actionDef(actionId);
    let d = 0;
    for (const [name, rep] of def.seq) {
      const a = this.data.findAnimation(name);
      d += (a ? Math.max(a.duration, 0.4) : 1) * rep;
    }
    return d;
  }

  /** Number of action cycles that fit exactly into the loop. */
  cyclesInLoop(actionId, L) {
    return Math.max(1, Math.round(L / this.cycleDuration(actionId)));
  }

  /**
   * Pose at loop time t (0..L). Time is stretched slightly so an integer number
   * of cycles fits in L → seamless loop. Returns {anim, local} for debugging.
   */
  pose(actionId, t, L, opts = {}) {
    const def = actionDef(actionId);
    const sk = this.skeleton;
    sk.setToSetupPose();
    let cyc;
    let phaseInCycle;
    if (opts.free) {
      // non-looping (transition clips): natural speed
      const D = this.cycleDuration(actionId);
      phaseInCycle = (t % D) / D;
    } else {
      cyc = this.cyclesInLoop(actionId, L);
      const x = (t * cyc) / L;
      phaseInCycle = x - Math.floor(x);
    }
    const D = this.cycleDuration(actionId);
    let u = phaseInCycle * D;
    let applied = null;
    for (let i = 0; i < def.seq.length; i++) {
      const [name, rep] = def.seq[i];
      const a = this.data.findAnimation(name);
      const unit = a ? Math.max(a.duration, 0.4) : 1;
      const d = unit * rep;
      if (u < d || i === def.seq.length - 1) {
        if (a) {
          const local = Math.min(u % unit, a.duration);
          a.apply(sk, 0, local, true, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
        }
        applied = name;
        break;
      }
      u -= d;
    }
    if (def.blink !== false && opts.blink !== false) {
      const blink = this.data.findAnimation('blink');
      if (blink) {
        const r = mulberry32(opts.seed || 3);
        const n = Math.max(1, Math.round(L / 4.5));
        for (let k = 0; k < n; k++) {
          const bt = ((k + 0.15 + r() * 0.7) * L) / n;
          let d = t - bt;
          if (d < 0) d += L;
          if (d < blink.duration) {
            blink.apply(sk, 0, d, false, null, 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
            break;
          }
        }
      }
    }
    // phụ kiện gắn thêm của bộ hình luôn hiện ở ô của nó
    if (this.extras?.length) for (const e of this.extras) sk.slots[e.slotIndex].setAttachment(e.att);
    this.tool = opts.free ? null : def.tool || null;
    sk.updateWorldTransform();
    return applied;
  }

  draw(ctx, x, y, scale = 1, flip = false) {
    if (!this.renderer || this.renderer.ctx !== ctx) {
      this.renderer = new spine.SkeletonRenderer(ctx);
      this.renderer.triangleRendering = false;
    }
    const sk = this.skeleton;
    sk.x = 0;
    sk.y = 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * (flip ? -1 : 1), -scale);
    this.renderer.draw(sk);
    if (this.tool) this.drawTool(ctx, this.tool);
    ctx.restore();
  }

  /** Procedural hand-held tool (the skeleton has no broom/shovel art). */
  drawTool(ctx, tool) {
    const bone = this.skeleton.findBone('Hand Right');
    if (!bone) return;
    ctx.save();
    ctx.transform(bone.a, bone.c, bone.b, bone.d, bone.worldX, bone.worldY);
    ctx.translate(40, 5);
    ctx.rotate(((TOOL_ANGLE[tool] ?? 0) * Math.PI) / 180);
    if (tool === 'broom') {
      ctx.translate(0, -20);
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(-5, -110, 10, 270);
      ctx.fillStyle = '#d9b45a';
      ctx.beginPath();
      ctx.moveTo(-10, 150);
      ctx.lineTo(10, 150);
      ctx.lineTo(48, 225);
      ctx.lineTo(-48, 225);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#a8833a';
      ctx.lineWidth = 3;
      for (let k = -36; k <= 36; k += 12) {
        ctx.beginPath();
        ctx.moveTo(k * 0.2, 156);
        ctx.lineTo(k, 224);
        ctx.stroke();
      }
      ctx.fillStyle = '#b5523b';
      ctx.fillRect(-11, 142, 22, 12);
    } else if (tool === 'shovel') {
      // garden trowel
      ctx.fillStyle = '#8a5a34';
      roundRectPath(ctx, -7, -20, 14, 60, 6);
      ctx.fill();
      ctx.fillStyle = '#9aa3ab';
      ctx.beginPath();
      ctx.moveTo(-20, 40);
      ctx.lineTo(20, 40);
      ctx.quadraticCurveTo(22, 90, 0, 115);
      ctx.quadraticCurveTo(-22, 90, -20, 40);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Contact-sound times inside one loop for an action (shared with audio). */
export function actionSoundEvents(rig, actionId, L) {
  const def = actionDef(actionId);
  if (!def.sound) return [];
  const cyc = rig ? rig.cyclesInLoop(actionId, L) : Math.max(1, Math.round(L));
  const period = L / cyc;
  const out = [];
  const D = rig ? rig.cycleDuration(actionId) : 1;
  const stretch = period / D;
  for (let k = 0; k < cyc; k++) {
    const base = k * period;
    let off = 0;
    for (const [name, rep] of def.seq) {
      const a = rig?.data.findAnimation(name);
      const d = (a ? Math.max(a.duration, 0.4) : 1) * stretch;
      for (let i = 0; i < rep; i++) {
        out.push({ t: base + off + d * i, anim: name, dur: d });
      }
      off += d * rep;
    }
  }
  return out;
}

export { TAU };
