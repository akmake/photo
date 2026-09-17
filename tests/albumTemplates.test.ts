/* Rules of template pages (הכספת), without a browser.
 *
 *   node --test "tests/*.test.ts"
 *
 * library.ts imports types and generated data only, so Node runs it directly
 * with type stripping — no build step. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_PAGE_4, TEMPLATE_LIBRARY, applyTemplate, colorOf, findTemplate, fitTemplate,
  newInstance, paintOrder, photoLayers, spreadTemplate, templateBackground, templateSlots,
  templatesFor, textOf, usesSourceLettering,
} from '../src/album/templates/library.ts';

const spread = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  pageStart: 2,
  layoutId: 'balanced',
  photoIds: ['a'],
  background: '#ffffff',
  locked: false,
  status: 'draft' as const,
  ...extra,
});

/* The three standard spreads, plus a narrow portrait book as the hard case. */
const SHAPES = {
  '56×21': 560 / 210,
  '50×25': 500 / 250,
  '60×30': 600 / 300,
  '40×30 portrait': 400 / 300,
};

const finite = (value: number) => Number.isFinite(value);

test('the whole Vault is in the library — 145 designed pages, 457 photo places', () => {
  assert.equal(TEMPLATE_LIBRARY.length, 145);
  assert.equal(TEMPLATE_LIBRARY.reduce((sum, t) => sum + t.photoCount, 0), 457);
  assert.equal(new Set(TEMPLATE_LIBRARY.map((t) => t.id)).size, 145, 'duplicate template id');
  assert.ok(templatesFor(2).length > 0 && templatesFor(1).length > 0);
  assert.ok(templatesFor(1).every((t) => t.photoCount === 1));
});

test('every page is well formed: unique layers, known colours, sane geometry', () => {
  for (const template of TEMPLATE_LIBRARY) {
    const ids = template.layers.map((layer) => layer.id);
    assert.equal(new Set(ids).size, ids.length, `${template.id}: duplicate layer id`);
    const tokens = new Set(template.colors.map((color) => color.id));
    assert.ok(tokens.has(template.backgroundToken), `${template.id}: no background colour`);
    for (const layer of template.layers) {
      const named = layer.type === 'text'
        ? [layer.colorToken]
        : layer.type === 'shape' ? [layer.fillToken, layer.strokeToken] : [];
      for (const token of named.filter(Boolean)) {
        assert.ok(tokens.has(token!), `${template.id}/${layer.id}: unknown colour ${token}`);
      }
      const { x, y, width, height } = layer.box;
      assert.ok([x, y, width, height].every(finite), `${template.id}/${layer.id}: bad box`);
      assert.ok(width > 0 && height > 0, `${template.id}/${layer.id}: empty box`);
    }
    for (const photo of photoLayers(template)) {
      if (photo.rotation) continue; // a tilted collage photo may reach past the edge by design
      const { x, y, width, height } = photo.box;
      assert.ok(x >= 0 && y >= 0 && x + width <= 1 + 1e-6 && y + height <= 1 + 1e-6,
        `${template.id}/${photo.id}: photo outside the page`);
    }
    assert.equal(templateSlots(template).length, template.photoCount);
    assert.equal(photoLayers(template).filter((p) => p.role === 'hero').length, template.photoCount ? 1 : 0);
  }
});

test('page 4 matches the source: one photo across the fold on dark brown, a faint band, white artwork', () => {
  const t = VAULT_PAGE_4;
  assert.equal(t.photoCount, 1);
  assert.equal(templateBackground(t, newInstance(t)), '#251c11');
  const [photo] = photoLayers(t);
  assert.ok(photo.box.x < 0.5 && photo.box.x + photo.box.width > 0.5);
  assert.equal(photo.allowCrossGutter, true);
  const band = t.layers.find((l) => l.type === 'shape' && l.shape === 'rect')!;
  assert.equal(band.opacity, 0.34);
  assert.ok(Math.abs(band.box.x - 0.0717) < 0.001 && Math.abs(band.box.width - 0.1672) < 0.001);
  const artwork = t.layers.filter((l) => l.type === 'shape' && l.shape === 'path');
  assert.ok(artwork.some((l) => l.type === 'shape' && l.fillToken && colorOf(t, newInstance(t), l.fillToken) === '#ffffff'));
});

test('layers paint in the designer order', () => {
  for (const template of TEMPLATE_LIBRARY) {
    const order = paintOrder(template).map((l) => l.zIndex);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  }
});

test('at its own shape every page is exactly the design', () => {
  for (const template of TEMPLATE_LIBRARY) {
    assert.equal(fitTemplate(template, template.nativeAspect), template);
  }
});

for (const [label, aspect] of Object.entries(SHAPES)) {
  test(`fitted to ${label}: photos keep their share of the spread, artwork keeps its shape`, () => {
    for (const template of TEMPLATE_LIBRARY) {
      const fitted = fitTemplate(template, aspect);
      assert.ok(Math.abs(fitted.nativeAspect / aspect - 1) < 1e-3);
      photoLayers(template).forEach((designed, index) => {
        const photo = photoLayers(fitted)[index];
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          assert.ok(Math.abs(photo.box[key] - designed.box[key]) < 1e-9, `${template.id}: photo ${key} moved`);
        }
      });
      template.layers.forEach((designed, index) => {
        const layer = fitted.layers[index];
        const uniform = designed.type === 'text' || (designed.type === 'shape' && designed.shape !== 'rect');
        if (!uniform) return;
        const before = (designed.box.width * template.nativeAspect) / designed.box.height;
        const after = (layer.box.width * aspect) / layer.box.height;
        assert.ok(Math.abs(after / before - 1) < 1e-3, `${template.id}/${layer.id}: distorted`);
        const inside = (b: typeof layer.box) => b.x >= -0.02 && b.x + b.width <= 1.02;
        if (inside(designed.box)) assert.ok(inside(layer.box), `${template.id}/${layer.id}: left the spread`);
      });
    }
  });
}

test('colours belong to the spread and never change the design', () => {
  const t = VAULT_PAGE_4;
  const token = t.colors[1].id;
  const designed = t.colors[1].value;
  const one = newInstance(t);
  const two = newInstance(t);
  one.colors[token] = '#445566';
  assert.equal(colorOf(t, one, token), '#445566');
  assert.equal(colorOf(t, two, token), designed);
  assert.equal(t.colors[1].value, designed);
  assert.equal(colorOf(t, two, 'no-such-token'), '#ff00ff');
});

test('live text shows its words and follows edits', () => {
  const withText = TEMPLATE_LIBRARY.find((t) => t.layers.some((l) => l.type === 'text'))!;
  const layer = withText.layers.find((l) => l.type === 'text')!;
  assert.ok(layer.type === 'text');
  const instance = newInstance(withText);
  assert.equal(textOf(instance, layer), layer.defaultText);
  assert.equal(usesSourceLettering(instance, layer), false, 'live text has no drawn lettering');
  instance.texts[layer.id] = 'שלום';
  assert.equal(textOf(instance, layer), 'שלום');
});

test('placing a design keeps the photos in order and drops the old layout', () => {
  const patch = applyTemplate(
    spread({ photoIds: ['a'], customSlots: [{ id: 'x' }], frameSettings: { x: {} } }) as never,
    VAULT_PAGE_4,
  );
  assert.deepEqual(patch.photoIds, ['a']);
  assert.equal(patch.customSlots, undefined);
  assert.deepEqual(patch.frameSettings, {});
  assert.equal(patch.templateInstance!.templateId, 'vault-p004');

  const empty = applyTemplate(spread({ photoIds: [] }) as never, VAULT_PAGE_4);
  assert.deepEqual(empty.photoIds, [''], 'an empty spread gets an empty photo place');
});

test('a spread knows its design, and an unknown design is not silently replaced', () => {
  assert.equal(spreadTemplate(spread() as never, 2), null);
  const placed = spread({ templateInstance: newInstance(VAULT_PAGE_4) });
  assert.equal(spreadTemplate(placed as never, 2)?.id, 'vault-p004');
  assert.equal(spreadTemplate(placed as never, 2)?.nativeAspect, 2, 'fitted to the album');
  const orphan = spread({ templateInstance: { ...newInstance(VAULT_PAGE_4), templateId: 'gone' } });
  assert.equal(spreadTemplate(orphan as never, 2), null);
  assert.equal(findTemplate('gone'), undefined);
});


/* ---- choosing a page for a group of photos (choose.ts) ---- */
import { rankTemplates, splitForLibrary, MAX_PLACES } from '../src/album/templates/choose.ts';

const pic = (id: string, w: number, h: number) => ({
  id, name: id, url: '', orientation: w > h ? 'landscape' : 'portrait', widthPx: w, heightPx: h,
}) as never;

test('a group gets only pages with exactly its number of places, best fit first', () => {
  const photos = [pic('a', 3000, 2000), pic('b', 2000, 3000)];
  const ranked = rankTemplates(['a', 'b'], photos, 560 / 210);
  assert.ok(ranked.length > 1);
  assert.ok(ranked.every((choice) => choice.template.photoCount === 2));
  for (let i = 1; i < ranked.length; i += 1) assert.ok(ranked[i - 1].score >= ranked[i].score);
  assert.deepEqual([...ranked[0].photoIds].sort(), ['a', 'b'], 'every photo placed once');
});

test('a portrait photo goes to the tallest place on the chosen page', () => {
  const photos = [pic('wide', 3000, 2000), pic('tall', 2000, 3000)];
  const [best] = rankTemplates(['wide', 'tall'], photos, 2);
  const places = photoLayers(fitTemplate(best.template, 2));
  const ratio = (i: number) => (places[i].box.width * 2) / places[i].box.height;
  const tallIndex = best.photoIds.indexOf('tall');
  const wideIndex = best.photoIds.indexOf('wide');
  assert.ok(ratio(tallIndex) <= ratio(wideIndex), 'portrait landed in the wider place');
});

test('a page used on the last spreads drops down the list', () => {
  const photos = [pic('a', 3000, 2000)];
  const [first] = rankTemplates(['a'], photos, 2);
  const again = rankTemplates(['a'], photos, 2, [first.template.id]);
  assert.notEqual(again[0].template.id, first.template.id);
});

test('a run longer than any page is split into near-equal spreads', () => {
  const ids = Array.from({ length: 23 }, (_, i) => `p${i}`);
  const parts = splitForLibrary(ids);
  assert.ok(parts.every((part) => part.length <= MAX_PLACES));
  assert.deepEqual(parts.flat(), ids);
  assert.equal(parts.length, 3);
  assert.deepEqual(splitForLibrary(['x']), [['x']]);
  assert.equal(rankTemplates([], [], 2).length, 0);
});


/* ---- smart guides (smartGuides.ts) ---- */
import { smartGuides } from '../src/album/templates/smartGuides.ts';

const ctxFor = (others: { x: number; y: number; width: number; height: number }[]) => ({
  aspect: 2, heightMm: 250, safeMarginMm: 8, tolerancePx: 7, screenHeightPx: 500, others, sizeReferences: others,
});
const B = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('guides: a block dragged near another block edge locks onto it and shows a line', () => {
  const other = B(0.1, 0.1, 0.2, 0.3);
  const r = smartGuides(B(0, 0, 0.1, 0.2), B(0.104, 0.55, 0.1, 0.2), 'move', ctxFor([other]), { snap: true, keepRatio: false });
  assert.ok(close(r.box.x, 0.1), `x=${r.box.x}`);
  assert.ok(r.lines.some((l) => close(l.x1, 0.1) && close(l.x2, 0.1)));
});

test('guides: Alt drags freely — no snap', () => {
  const r = smartGuides(B(0, 0, 0.1, 0.2), B(0.104, 0.55, 0.1, 0.2), 'move', ctxFor([B(0.1, 0.1, 0.2, 0.3)]), { snap: false, keepRatio: false });
  assert.ok(close(r.box.x, 0.104));
  assert.equal(r.lines.length, 0);
});

test('guides: equal spacing locks to a gap that already exists in the row, and marks both gaps', () => {
  // two blocks with a 0.05-wide gap, a third dragged to their right almost 0.05 away
  const a = B(0.1, 0.2, 0.1, 0.3);
  const b = B(0.25, 0.2, 0.1, 0.3);
  const r = smartGuides(B(0, 0, 0.1, 0.3), B(0.403, 0.26, 0.1, 0.3), 'move', ctxFor([a, b]), { snap: true, keepRatio: false });
  assert.ok(close(r.box.x, 0.4), `x=${r.box.x}`);
  const equal = r.gaps.filter((g) => g.equal);
  assert.ok(equal.length >= 2, 'the new gap and the matched gap are both marked');
  assert.ok(equal.every((g) => g.label === equal[0].label));
});

test('guides: resizing to almost another photo width locks to it and says so', () => {
  const ref = B(0.6, 0.1, 0.2, 0.3);
  const r = smartGuides(B(0.1, 0.5, 0.15, 0.2), B(0.1, 0.5, 0.203, 0.2), 'e', ctxFor([ref]), { snap: true, keepRatio: false });
  assert.ok(close(r.box.width, 0.2), `w=${r.box.width}`);
  assert.ok(r.badges.includes('רוחב זהה'));
});

test('guides: the block size and distances are reported in centimetres', () => {
  const r = smartGuides(B(0.1, 0.1, 0.2, 0.4), B(0.1, 0.1, 0.2, 0.4), 'move', ctxFor([]), { snap: false, keepRatio: false });
  assert.equal(r.size, '10.0 × 10.0 ס״מ'); // 0.2 of a 500 mm spread, 0.4 of 250 mm
  assert.ok(r.gaps.some((g) => g.label === '5.0 ס״מ'), 'distance to the left page edge');
});
