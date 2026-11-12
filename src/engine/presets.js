// Starter projects.
export function cozyRoomPreset() {
  return {
    version: 2,
    name: 'Phòng ấm áp đêm mưa',
    output: { width: 1920, height: 1080, fps: 30, loopSeconds: 30 },
    spineDir: '',
    characters: [
      { id: 'c1', name: 'Shiba', skin: 'skins/shiba', eyes: '', costume: '', mask: '', rod: 'rods/rod1', scale: 0.62, facesLeft: false },
      { id: 'c2', name: 'Cáo', skin: 'skins/fox', eyes: '', costume: '', mask: '', rod: 'rods/rod2', scale: 0.56, facesLeft: false },
    ],
    scene: { type: 'indoor', timeOfDay: 'night', weather: 'rain', wallColor: '#c99a76', floorColor: '#7a4e33', floorLevel: 0.74, vignette: 0.45 },
    mix: { master: 0.9, weather: 1, props: 1, character: 1 },
    props: [
      { id: 'rug1', type: 'rug', x: 900, y: 1000, scale: 1.2, layer: 'back' },
      { id: 'win1', type: 'window', x: 520, y: 620, scale: 1.05, layer: 'back', params: { curtains: true, curtainColor: '#8f3b3b' } },
      { id: 'shelf1', type: 'bookshelf', x: 170, y: 800, scale: 1.05, layer: 'back' },
      { id: 'clock1', type: 'clock', x: 960, y: 520, scale: 0.9, layer: 'back' },
      { id: 'fire1', type: 'fireplace', x: 1420, y: 800, scale: 1.05, layer: 'back' },
      { id: 'chair1', type: 'armchair', x: 960, y: 930, scale: 0.95, layer: 'back', params: { color: '#6d8b74' } },
      { id: 'bed1', type: 'catbed', x: 1420, y: 960, scale: 1.0, layer: 'back' },
      { id: 'lamp1', type: 'lamp', x: 1760, y: 840, scale: 1.0, layer: 'back' },
      { id: 'book1', type: 'book', x: 760, y: 990, scale: 1.0, layer: 'back', params: { style: 'open' } },
      { id: 'plant1', type: 'plant', x: 330, y: 960, scale: 0.9, layer: 'back' },
      { id: 'mug1', type: 'mug', x: 1650, y: 1060, scale: 1.3, layer: 'front' },
      { id: 'candle1', type: 'candle', x: 1560, y: 1066, scale: 1.4, layer: 'front' },
      { id: 'fgleaf', type: 'fgLeaves', x: 40, y: 1120, scale: 1.2, layer: 'front', blur: 7 },
    ],
    anchors: [
      { id: 'a_chair', name: 'Trên ghế bành', x: 960, y: 860, scale: 1, flip: false },
      { id: 'a_fire', name: 'Ổ trước lò sưởi', x: 1420, y: 950, scale: 1, flip: true },
      { id: 'a_book', name: 'Cạnh quyển sách', x: 660, y: 985, scale: 1.05, flip: false },
      { id: 'a_floor', name: 'Giữa phòng', x: 1150, y: 1000, scale: 1.05, flip: false },
    ],
    timeline: [
      { id: 's1', minutes: 10, cast: { c1: { action: 'sitLick', anchor: 'a_book' }, c2: { action: 'sleep', anchor: 'a_fire' } } },
      { id: 's2', minutes: 15, cast: { c1: { action: 'sit', anchor: 'a_chair' }, c2: { action: 'sleep', anchor: 'a_fire' } } },
      { id: 's3', minutes: 5, cast: { c1: { action: 'broom', anchor: 'a_floor' }, c2: { action: 'sit', anchor: 'a_chair' } } },
      { id: 's4', minutes: 40, weather: 'storm', cast: { c1: { action: 'sleep', anchor: 'a_fire' }, c2: { action: 'sitSad', anchor: 'a_book' } } },
      { id: 's5', minutes: 30, cast: { c1: { action: 'sleep', anchor: 'a_fire' }, c2: { action: 'sleep', anchor: 'a_book' } } },
    ],
  };
}

export function campingPreset() {
  return {
    version: 2,
    name: 'Cắm trại bên hồ',
    output: { width: 1920, height: 1080, fps: 30, loopSeconds: 30 },
    spineDir: '',
    characters: [{ id: 'c1', name: 'Cáo', skin: 'skins/fox', eyes: '', costume: '', mask: '', rod: 'rods/rod2', scale: 0.58, facesLeft: false }],
    scene: { type: 'outdoor', timeOfDay: 'night', weather: 'clear', groundColor: '#5f8a45', floorLevel: 0.72, vignette: 0.5 },
    mix: { master: 0.9, weather: 1, props: 1, character: 1 },
    props: [
      { id: 'tree1', type: 'tree', x: 220, y: 820, scale: 1.1, layer: 'back' },
      { id: 'tent1', type: 'tent', x: 520, y: 860, scale: 1.0, layer: 'back', params: { color: '#d9824a', glow: true } },
      { id: 'pond1', type: 'pond', x: 1520, y: 960, scale: 1.1, layer: 'back' },
      { id: 'camp1', type: 'campfire', x: 950, y: 960, scale: 1.0, layer: 'back' },
      { id: 'lant1', type: 'lantern', x: 700, y: 980, scale: 1.0, layer: 'back' },
      { id: 'rock1', type: 'rock', x: 1820, y: 900, scale: 0.8, layer: 'back' },
      { id: 'chime1', type: 'windchime', x: 360, y: 700, scale: 1.0, layer: 'back' },
      { id: 'bush1', type: 'foliage', x: 1700, y: 980, scale: 1.0, layer: 'back' },
      { id: 'grass1', type: 'fgGrass', x: 300, y: 1120, scale: 1.1, layer: 'front', blur: 6 },
      { id: 'grass2', type: 'fgGrass', x: 1750, y: 1130, scale: 1.0, layer: 'front', blur: 6 },
    ],
    anchors: [
      { id: 'a_fire', name: 'Bên lửa trại', x: 1110, y: 975, scale: 1, flip: true },
      { id: 'a_pond', name: 'Bờ ao', x: 1240, y: 960, scale: 1, flip: false },
    ],
    timeline: [
      { id: 's1', minutes: 20, cast: { c1: { action: 'sit', anchor: 'a_fire' } } },
      { id: 's2', minutes: 30, cast: { c1: { action: 'fish', anchor: 'a_pond' } } },
      { id: 's3', minutes: 40, weather: 'rain', cast: { c1: { action: 'sleep', anchor: 'a_fire' } } },
    ],
  };
}

/**
 * Upgrade a project saved with the old single-character shape
 * (project.character + seg.action/seg.anchor) to the multi-character shape
 * (project.characters[] + seg.cast). Idempotent, so it is safe to run on load.
 */
export function migrateProject(project) {
  if (!project || typeof project !== 'object') return project;
  const p = structuredClone(project);
  p.anchors = p.anchors || [];
  p.props = p.props || [];
  p.timeline = p.timeline || [];

  if (!Array.isArray(p.characters)) {
    const base = p.character || { skin: 'skins/shiba', scale: 0.62 };
    p.characters = [
      { id: 'c1', name: 'Nhân vật 1', eyes: '', costume: '', mask: '', rod: 'rods/rod1', scale: 0.62, facesLeft: false, ...base },
    ];
  }
  if (!p.characters.length) p.characters.push({ id: 'c1', name: 'Nhân vật 1', skin: 'skins/shiba', eyes: '', costume: '', mask: '', rod: 'rods/rod1', scale: 0.62, facesLeft: false });
  delete p.character;

  const firstId = p.characters[0].id;
  const fallbackAnchor = p.anchors[0]?.id;
  p.timeline = p.timeline.map((seg) => {
    const s = { ...seg };
    if (!s.cast) {
      s.cast = { [firstId]: { action: s.action || 'sit', anchor: s.anchor || fallbackAnchor } };
    }
    delete s.action;
    delete s.anchor;
    // Guarantee every character has a cast entry (e.g. a character added after this segment).
    for (const c of p.characters) {
      if (!s.cast[c.id]) {
        const used = Object.values(s.cast).map((e) => e.anchor);
        const free = p.anchors.find((a) => !used.includes(a.id)) || p.anchors[0];
        s.cast[c.id] = { action: 'sit', anchor: free?.id };
      }
    }
    return s;
  });
  p.version = 2;
  return p;
}
