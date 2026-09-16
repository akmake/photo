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
