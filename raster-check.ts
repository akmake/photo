import { TEMPLATE_LIBRARY, findTemplate, spreadTemplate } from './src/album/templates/library';
import { newInstance } from './src/album/templates/library';
import { drawTemplateSpread } from './src/album/templates/raster';
import { measureDirection, pageColors } from './src/album/albumColor';
import type { AlbumPhoto, AlbumSpread } from './src/album/model';

const SRC = [
  { url: '/demo/a.jpg', w: 5472, h: 3648 },
  { url: '/demo/c.jpg', w: 3648, h: 5472 },
  { url: '/demo/b.jpg', w: 5472, h: 3648 },
];
const photo = (i: number): AlbumPhoto => {
  const s = SRC[i % SRC.length];
  return {
    id: `p${i}`, name: `photo ${i}`, url: s.url,
    orientation: s.w > s.h ? 'landscape' : 'portrait',
    widthPx: s.w, heightPx: s.h, focalPoint: { x: 0.5, y: 0.42 },
    analysis: {
      status: 'ready', faces: [], focalPoint: { x: 0.5, y: 0.42 },
      sharpnessScore: 0.8, qualityScore: 0.8, analyzedBy: 'harness',
      palette: {
        colors: [{ hex: '#8a6a30', weight: 0.5, l: 48, c: 38, h: 78 }],
        chromaticCount: 1, skin: { hex: '#c09a80', l: 66, c: 18, h: 45 },
        meanL: 46, meanC: 24, measuredBy: 'harness',
      },
    },
  };
};

const ASPECT = 560 / 210;              // the 56×21 album, his first profile
const W = 1800;
const H = Math.round(W / ASPECT);

// A page of each photo-count the library has, so every kind of design is seen.
const wanted = [1, 2, 3, 4, 6].map((count) => (
  TEMPLATE_LIBRARY.find((t) => t.photoCount === count)!
)).filter(Boolean);
// Plus a page that carries the designer's own lettering, if there is one.
const lettered = TEMPLATE_LIBRARY.find((t) => t.layers.some((l) => l.type === 'text'));
if (lettered && !wanted.includes(lettered)) wanted.push(lettered);

const out = document.getElementById('out')!;
const direction = measureDirection([photo(0).analysis!.palette!]);

for (const designed of wanted) {
  const photos = Array.from({ length: designed.photoCount }, (_, i) => photo(i));
  const spread: AlbumSpread = {
    id: `s-${designed.id}`, pageStart: 2, layoutId: designed.id,
    photoIds: photos.map((p) => p.id), background: '#eee', locked: false, status: 'draft',
    frameSettings: {},
    templateInstance: {
      ...newInstance(designed),
      colors: pageColors(designed.colors, designed.backgroundToken, direction),
    },
  };
  const template = spreadTemplate(spread, ASPECT)!;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  await drawTemplateSpread(ctx, W, H, {
    template, instance: spread.templateInstance!, spread, photos,
    bitmapOf: async (p) => createImageBitmap(await (await fetch(p.url)).blob()),
  });
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = `${designed.id} · ${designed.name} · ${designed.photoCount} photos · `
    + `${designed.layers.length} layers (${designed.layers.filter((l) => l.type === 'shape').length} shapes, `
    + `${designed.layers.filter((l) => l.type === 'text').length} text) · bg ${spread.templateInstance!.colors[designed.backgroundToken] ?? '—'}`;
  figure.append(caption, canvas);
  out.append(figure);
}
(window as unknown as { RASTER_DONE: boolean }).RASTER_DONE = true;
