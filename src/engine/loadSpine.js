import { CharacterRig } from './character.js';

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** bundle: { jsonText, atlasText, images: { pageName: dataURL | url } } */
export async function loadRigFromBundle(bundle) {
  const images = {};
  for (const [name, src] of Object.entries(bundle.images)) images[name] = await loadImage(src);
  return CharacterRig.load({ jsonText: bundle.jsonText, atlasText: bundle.atlasText, images });
}

/** Browser dev fallback: ./sample/cat.json etc. */
export async function loadSampleBundle(base = './sample/') {
  const res = await fetch(base + 'cat.json');
  if (!res.ok) throw new Error('no sample');
  const jsonText = await res.text();
  const atlasText = await (await fetch(base + 'cat.atlas')).text();
  const pages = atlasText.split(/\r?\n/).map((l) => l.trim()).filter((l) => /\.(png|jpe?g|webp)$/i.test(l));
  const images = {};
  for (const p of pages) images[p] = base + p;
  return { dir: 'sample', jsonText, atlasText, images };
}
