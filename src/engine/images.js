// Loads and caches user-uploaded images (object props + background) as HTMLImage
// elements so the synchronous draw/export code can blit them. Browser/Electron only.
const cache = new Map(); // key -> { src, img, ready, promise }

/** The decoded image for a key, or null while it is still loading / absent. */
export function getImage(key) {
  const e = cache.get(key);
  return e && e.ready ? e.img : null;
}

/** Start (or reuse) loading `src` under `key`. Returns a promise that resolves when ready. */
export function setImageSrc(key, src) {
  const e = cache.get(key);
  if (!src) {
    cache.delete(key);
    return Promise.resolve(null);
  }
  if (e && e.src === src) return e.promise;
  const img = new Image();
  const rec = { src, img, ready: false };
  rec.promise = new Promise((resolve) => {
    img.onload = () => {
      rec.ready = true;
      resolve(img);
    };
    img.onerror = () => resolve(null);
  });
  img.src = src;
  cache.set(key, rec);
  return rec.promise;
}

/** Preload every image a project references (background + image props). */
export function preloadProject(project) {
  if (!project) return Promise.resolve();
  const ps = [];
  if (project.scene?.backgroundImage) ps.push(setImageSrc('bg', project.scene.backgroundImage));
  else cache.delete('bg');
  const liveIds = new Set();
  for (const p of project.props || []) {
    if (p.type === 'image' && p.params?.src) {
      liveIds.add('prop:' + p.id);
      ps.push(setImageSrc('prop:' + p.id, p.params.src));
    }
  }
  // drop caches for removed image props
  for (const k of [...cache.keys()]) if (k.startsWith('prop:') && !liveIds.has(k)) cache.delete(k);
  return Promise.all(ps);
}
