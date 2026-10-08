/* Automatic album layout (src/album/autoLayout.ts) on the real Vault, without
 * a browser:  node --test "tests/*.test.ts" */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomaticAlbum } from '../src/album/albumFlow.ts';
import { assessCrop } from '../src/album/cropEngine.ts';
import { faceOnFold, fitPage, FOLD_CLEARANCE, planAlbum } from '../src/album/autoLayout.ts';
import { findTemplate, fittedTemplate, photoLayers, templatesFor } from '../src/album/templates/library.ts';
import type { AlbumPhoto } from '../src/album/model';

const SPREAD = (280 / 210) * 2;

/** A frame with one face, at `faceX` across the photo. */
function photo(id: string, orientation: 'portrait' | 'landscape', faceX = 0.45, quality = 0.75): AlbumPhoto {
  const [w, h] = orientation === 'portrait' ? [4000, 6000] : [6000, 4000];
  return {
    id, name: id, url: '', orientation, widthPx: w, heightPx: h,
    analysis: {
      status: 'ready',
      faces: [{ x: faceX, y: 0.25, width: 0.12, height: 0.12 }],
      focalPoint: { x: faceX + 0.06, y: 0.31 },
      sharpnessScore: quality, qualityScore: quality, analyzedBy: 'test',
    },
  };
}

/* 30 photos in five sets, mixed orientation and face positions — enough that
 * some runs only fit pages that would put a face on the fold. */
const PHOTOS: AlbumPhoto[] = Array.from({ length: 30 }, (_, i) => photo(
  `p${i}`,
  i % 3 === 0 ? 'landscape' : 'portrait',
  [0.2, 0.45, 0.62, 0.3, 0.5][i % 5],
  0.6 + ((i * 7) % 10) / 30,
));
const SESSIONS = [[0, 6], [6, 13], [13, 19], [19, 24], [24, 30]].map(([a, b], c) => ({
  id: `s${c}`, label: `s${c}`, photoIds: PHOTOS.slice(a, b).map((p) => p.id),
}));
const BY_ID = new Map(PHOTOS.map((p) => [p.id, p]));

function placements(spreads: ReturnType<typeof buildAutomaticAlbum>) {
  return spreads.flatMap((spread) => {
    const template = fittedTemplate(findTemplate(spread.templateInstance!.templateId)!, SPREAD);
    return photoLayers(template).map((layer, index) => {
      const p = BY_ID.get(spread.photoIds[index])!;
      const slot = { id: layer.id, ...layer.box, role: layer.role, preferred: layer.preferred };
      const crop = assessCrop(p, slot, { fit: 'smart', positionX: 50, positionY: 50 }, SPREAD);
      return { spread, p, slot, crop };
    });
  });
}

test('every chosen photo is placed exactly once', () => {
  const spreads = buildAutomaticAlbum(PHOTOS.map((p) => p.id), PHOTOS, 280 / 210, undefined, SESSIONS);
  const placed = spreads.flatMap((s) => s.photoIds).sort();
  assert.deepEqual(placed, PHOTOS.map((p) => p.id).sort());
});

test('a spread never mixes two chapters, and chapters keep their order', () => {
  const spreads = buildAutomaticAlbum(PHOTOS.map((p) => p.id), PHOTOS, 280 / 210, undefined, SESSIONS);
  const chapterOf = new Map(SESSIONS.flatMap((s) => s.photoIds.map((id) => [id, s.id])));
  let last = -1;
  for (const spread of spreads) {
    const chapters = new Set(spread.photoIds.map((id) => chapterOf.get(id)));
    assert.equal(chapters.size, 1, `spread mixes chapters: ${[...chapters]}`);
    const index = Number([...chapters][0]!.slice(1));
    assert.ok(index >= last, 'chapters out of order');
    last = index;
  }
});

test('no face is cut and no face lands on the fold', () => {
  const spreads = buildAutomaticAlbum(PHOTOS.map((p) => p.id), PHOTOS, 280 / 210, undefined, SESSIONS);
  for (const { p, slot, crop } of placements(spreads)) {
    assert.ok(crop.safe, `${p.id}: ${crop.warnings.join(', ')}`);
    assert.ok(!faceOnFold(p, slot, crop.crop, FOLD_CLEARANCE), `${p.id}: face on the fold`);
  }
});

test('a page that would put a face on the fold is refused', () => {
  // Vault page 4 runs one photo across the fold; a face a third of the way
  // into the photo lands on the crease there. Without the rule it is offered.
  const p = photo('c', 'landscape', 0.35);
  p.analysis!.faces = [{ x: 0.35, y: 0.25, width: 0.1, height: 0.12 }];
  const page4 = findTemplate('vault-p004')!;
  assert.ok(fitPage([p], page4, SPREAD, 0), 'page 4 should carry this photo when the fold is ignored');
  assert.equal(fitPage([p], page4, SPREAD), null, 'page 4 put a face on the fold');
});

test('the strongest photo takes the largest place', () => {
  const group = [photo('a', 'portrait', 0.4, 0.6), photo('b', 'portrait', 0.4, 0.95), photo('c', 'portrait', 0.4, 0.6)];
  const fits = templatesFor(3).map((t) => fitPage(group, t, SPREAD)).filter(Boolean);
  assert.ok(fits.length > 0);
  for (const fit of fits) {
    const layers = photoLayers(fittedTemplate(fit!.template, SPREAD));
    const areas = layers.map((l) => l.box.width * l.box.height);
    const largest = areas.indexOf(Math.max(...areas));
    const clearlyLargest = areas.filter((a) => a >= areas[largest] * 0.9).length === 1;
    if (clearlyLargest) assert.equal(fit!.photoIds[largest], 'b', `${fit!.template.id}`);
  }
});

test('the same page is not used twice within three spreads', () => {
  const plan = planAlbum(SESSIONS, PHOTOS, SPREAD, { pace: 3 });
  const ids = plan.map((s) => s.fit?.template.id);
  ids.forEach((id, i) => {
    if (id) assert.ok(!ids.slice(Math.max(0, i - 3), i).includes(id), `${id} repeated at spread ${i}`);
  });
});

test('ninety photos are laid out in well under a second', () => {
  const many = Array.from({ length: 90 }, (_, i) => photo(`m${i}`, i % 3 ? 'portrait' : 'landscape', 0.3 + (i % 4) / 10));
  const sessions = [0, 30, 60].map((a, c) => ({ id: `m${c}`, label: '', photoIds: many.slice(a, a + 30).map((p) => p.id) }));
  const t = performance.now();
  buildAutomaticAlbum(many.map((p) => p.id), many, 280 / 210, undefined, sessions);
  assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms`);
});
