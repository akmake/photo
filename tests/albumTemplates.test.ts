/* Rules of template pages (הכספת), without a browser.
 *
 *   node --test tests/
 *
 * library.ts imports types only (plus generated outline strings), so Node runs
 * it directly with type stripping — no build step. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_PAGE_4, TEMPLATE_LIBRARY, applyTemplate, colorOf, findTemplate, fitTemplate, layerBands,
  newInstance, spreadTemplate, templateBackground, templateSlots,
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

const ASPECT_28x21 = 560 / 210;

test('page 4 is offered to every one-photo spread, whatever the album shape', () => {
  assert.deepEqual(templatesFor(1).map((t) => t.id), ['vault-p004']);
  assert.equal(templatesFor(2).length, 0);
});

/* The three standard spreads, plus a narrow portrait book as the hard case. */
const SHAPES = {
  '56×21': 560 / 210,
  '50×25': 500 / 250,
  '60×30': 600 / 300,
  '40×30 portrait': 400 / 300,
};

const within = (value: number, lo: number, hi: number) => value >= lo - 1e-9 && value <= hi + 1e-9;

test('at its own shape the page is exactly the design', () => {
  assert.equal(fitTemplate(VAULT_PAGE_4, ASPECT_28x21), VAULT_PAGE_4);
});

for (const [label, aspect] of Object.entries(SHAPES)) {
  test(`fitted to ${label}: nothing leaves the spread or changes page`, () => {
    const fitted = fitTemplate(VAULT_PAGE_4, aspect);
    assert.ok(Math.abs(fitted.nativeAspect / aspect - 1) < 1e-3, 'fitted to the album shape');
    for (const layer of fitted.layers) {
      assert.ok(within(layer.box.x, 0, 1) && within(layer.box.x + layer.box.width, 0, 1), `${label}/${layer.id} x`);
      assert.ok(within(layer.box.y, 0, 1) && within(layer.box.y + layer.box.height, 0, 1), `${label}/${layer.id} y`);
      assert.ok(layer.box.width > 0 && layer.box.height > 0, `${label}/${layer.id} size`);
    }
    // decoration designed on the left page stays on the left page
    for (const id of ['band', 'title', 'subtitle', 'frame']) {
      const layer = fitted.layers.find((item) => item.id === id)!;
      assert.ok(layer.box.x + layer.box.width <= 0.5 + 1e-9, `${label}/${id} crossed the fold`);
    }
    // the photo still crosses the fold, as designed, and keeps a real share of the spread
    const [slot] = templateSlots(fitted);
    assert.ok(slot.x < 0.5 && slot.x + slot.width > 0.5, `${label}: photo left the fold`);
    assert.ok(slot.width * aspect > 0.5, `${label}: photo shrank to ${slot.width * aspect} page-heights`);
    // the photo never slides under the colour band
    const band = fitted.layers.find((item) => item.id === 'band')!;
    assert.ok(slot.x >= band.box.x + band.box.width - 1e-9, `${label}: photo under the band`);
  });

  test(`fitted to ${label}: lettering and frame keep their shape`, () => {
    const fitted = fitTemplate(VAULT_PAGE_4, aspect);
    for (const id of ['title', 'subtitle', 'frame']) {
      const designed = VAULT_PAGE_4.layers.find((item) => item.id === id)!;
      const layer = fitted.layers.find((item) => item.id === id)!;
      const designedRatio = (designed.box.width * VAULT_PAGE_4.nativeAspect) / designed.box.height;
      const ratio = (layer.box.width * aspect) / layer.box.height;
      assert.ok(Math.abs(ratio / designedRatio - 1) < 1e-3, `${label}/${id} was distorted`);
    }
    // the title still sits on the frame's corner: same offset, scaled with it
    const pick = (t: typeof fitted, id: string) => t.layers.find((item) => item.id === id)!.box;
    const scale = pick(fitted, 'frame').height / pick(VAULT_PAGE_4, 'frame').height;
    const offset = (t: typeof fitted, a: number) => (pick(t, 'title').x - pick(t, 'frame').x) * a;
    assert.ok(Math.abs(offset(fitted, aspect) - offset(VAULT_PAGE_4, ASPECT_28x21) * scale) < 1e-3);
  });
}

test('on every shape the photo keeps the share of the spread it has in the design', () => {
  const [designed] = templateSlots(VAULT_PAGE_4);
  for (const aspect of Object.values(SHAPES)) {
    const [slot] = templateSlots(fitTemplate(VAULT_PAGE_4, aspect));
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      assert.ok(Math.abs(slot[key] - designed[key]) < 1e-9, `${aspect}: photo ${key} changed`);
    }
  }
});

test('every layer id is unique and every colour it names exists', () => {
  for (const template of TEMPLATE_LIBRARY) {
    const ids = template.layers.map((layer) => layer.id);
    assert.equal(new Set(ids).size, ids.length, `${template.id}: duplicate layer id`);
    const tokens = new Set(template.colors.map((color) => color.id));
    assert.ok(tokens.has(template.backgroundToken));
    for (const layer of template.layers) {
      const named = layer.type === 'text'
        ? [layer.colorToken]
        : layer.type === 'shape' ? [layer.fillToken, layer.strokeToken] : [];
      for (const token of named.filter(Boolean)) {
        assert.ok(tokens.has(token!), `${template.id}/${layer.id}: unknown colour ${token}`);
      }
    }
    assert.equal(templateSlots(template).length, template.photoCount);
  }
});

test('page 4 geometry stays inside the spread and matches the PDF', () => {
  const [slot] = templateSlots(VAULT_PAGE_4);
  assert.equal(slot.id, 'hero');
  assert.equal(slot.allowCrossGutter, true, 'the design runs the photo across the fold');
  assert.ok(slot.x < 0.5 && slot.x + slot.width > 0.5);

  const frame = VAULT_PAGE_4.layers.find((layer) => layer.id === 'frame');
  assert.ok(frame && frame.type === 'shape' && frame.points);
  const xs = frame.points!.map(([x]) => x);
  const ys = frame.points!.map(([, y]) => y);
  assert.ok(Math.abs(Math.min(...xs) - 0.093) < 0.0005);
  assert.ok(Math.abs(Math.max(...xs) - 0.2069) < 0.0005);
  assert.ok(Math.abs(Math.min(...ys) - 0.4571) < 0.0005);
  assert.ok(Math.abs(Math.max(...ys) - 0.5785) < 0.0005);

  for (const layer of VAULT_PAGE_4.layers) {
    assert.ok(layer.box.x >= 0 && layer.box.y >= 0, layer.id);
    assert.ok(layer.box.x + layer.box.width <= 1 + 1e-9, layer.id);
    assert.ok(layer.box.y + layer.box.height <= 1 + 1e-9, layer.id);
  }
});

test('photos sit between the band and the title', () => {
  const { below, above } = layerBands(VAULT_PAGE_4);
  assert.deepEqual(below.map((layer) => layer.id), ['band']);
  assert.deepEqual(above.map((layer) => layer.id).sort(), ['frame', 'subtitle', 'title']);
  assert.ok([...below, ...above].every((layer) => layer.type !== 'photo'));
});

test('colours belong to the spread and never change the design', () => {
  const one = newInstance(VAULT_PAGE_4);
  const two = newInstance(VAULT_PAGE_4);
  one.colors.band = '#445566';
  assert.equal(colorOf(VAULT_PAGE_4, one, 'band'), '#445566');
  assert.equal(colorOf(VAULT_PAGE_4, two, 'band'), '#b28858');
  assert.equal(VAULT_PAGE_4.colors.find((color) => color.id === 'band')!.value, '#b28858');
  assert.equal(templateBackground(VAULT_PAGE_4, two), '#251c11');
  assert.equal(colorOf(VAULT_PAGE_4, two, 'no-such-token'), '#ff00ff');
});

test('the designer lettering shows until the words change', () => {
  const instance = newInstance(VAULT_PAGE_4);
  const title = VAULT_PAGE_4.layers.find((layer) => layer.id === 'title');
  assert.ok(title && title.type === 'text');
  assert.equal(textOf(instance, title), 'ליהנות');
  assert.equal(usesSourceLettering(instance, title), true);
  instance.texts.title = 'להתרגש';
  assert.equal(textOf(instance, title), 'להתרגש');
  assert.equal(usesSourceLettering(instance, title), false);
  instance.texts.title = 'ליהנות';
  assert.equal(usesSourceLettering(instance, title), true, 'typing the original back restores it');
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
  assert.equal(patch.templateInstance!.templateVersion, VAULT_PAGE_4.version);

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
