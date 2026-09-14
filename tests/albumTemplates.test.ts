/* Rules of template pages (הכספת), without a browser.
 *
 *   node --test tests/
 *
 * library.ts imports types only (plus generated outline strings), so Node runs
 * it directly with type stripping — no build step. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_PAGE_4, TEMPLATE_LIBRARY, applyTemplate, colorOf, findTemplate, layerBands,
  libraryFitsAspect, newInstance, spreadTemplate, templateBackground, templateSlots,
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

test('page 4 is offered only to a one-photo spread of the Vault shape', () => {
  assert.deepEqual(templatesFor(1, ASPECT_28x21).map((t) => t.id), ['vault-p004']);
  assert.equal(templatesFor(2, ASPECT_28x21).length, 0);
  assert.equal(templatesFor(1, 600 / 200).length, 0, '30×20 is a different shape');
  assert.equal(templatesFor(1, 600 / 300).length, 0, '30×30 is a different shape');
  assert.equal(libraryFitsAspect(ASPECT_28x21), true);
  assert.equal(libraryFitsAspect(2), false);
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
  assert.equal(spreadTemplate(spread() as never), null);
  const placed = spread({ templateInstance: newInstance(VAULT_PAGE_4) });
  assert.equal(spreadTemplate(placed as never)?.id, 'vault-p004');
  const orphan = spread({ templateInstance: { ...newInstance(VAULT_PAGE_4), templateId: 'gone' } });
  assert.equal(spreadTemplate(orphan as never), null);
  assert.equal(findTemplate('gone'), undefined);
});
