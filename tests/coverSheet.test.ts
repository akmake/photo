/* The cover as a designed sheet, without a browser.
 *
 *   node --test "tests/*.test.ts"
 *
 * coverSheet.ts imports types, the generated library and pure geometry only,
 * so Node runs it directly with type stripping — no build step. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_SHEET_ID, COVER_TEMPLATE_ID, coverSheetOf, coverTemplateOf, coverZonePlace,
  plainCoverTemplate, spineBand,
} from '../src/album/coverSheet.ts';
import { FIRST_PRINT_PROFILE } from '../src/album/model.ts';
import { colorOf, photoLayers, templateSlots } from '../src/album/templates/library.ts';
import type { AlbumProject, PrintProductProfile } from '../src/album/model.ts';

/** 62 × 21 cm flat: two boards and a 20mm spine, as a layflat album has. */
const profile: PrintProductProfile = {
  ...FIRST_PRINT_PROFILE,
  coverSpec: {
    totalWidthMm: 620,
    totalHeightMm: 210,
    spineWidthMm: 20,
    bleedMm: 3,
    safeMarginMm: 8,
    verified: false,
  },
};

const album = (cover?: AlbumProject['cover']): AlbumProject => ({
  id: 'a1',
  projectId: null,
  name: 'חתונה',
  productProfileId: profile.id,
  styleName: 'classic',
  spreads: [],
  activeSpreadId: 's1',
  cover,
});

test('a cover made before it could be designed becomes a sheet, losing nothing', () => {
  const sheet = coverSheetOf(album({
    background: '#1c1a17',
    frontPhotoId: 'front.jpg',
    backPhotoId: 'back.jpg',
    frontSettings: { fit: 'cover', positionX: 30, positionY: 70, zoom: 140 },
    title: 'דנה ויוסי',
    subtitle: 'קיץ 2026',
    spineText: 'דנה ויוסי',
  }), profile);

  assert.equal(sheet.id, COVER_SHEET_ID);
  assert.equal(sheet.templateInstance?.templateId, COVER_TEMPLATE_ID);
  // back first, front second — the order the places are bound in
  assert.deepEqual(sheet.photoIds, ['back.jpg', 'front.jpg']);
  assert.deepEqual(sheet.templateInstance?.texts, {
    title: 'דנה ויוסי', subtitle: 'קיץ 2026', spine: 'דנה ויוסי',
  });
  assert.equal(sheet.frameSettings?.front?.zoom, 140);
  assert.equal(sheet.templateInstance?.colors.background, '#1c1a17');
});

test('an album with no cover at all still opens on a sheet', () => {
  const sheet = coverSheetOf(album(), profile);
  assert.equal(sheet.templateInstance?.templateId, COVER_TEMPLATE_ID);
  assert.deepEqual(sheet.photoIds, ['', '']);
});

test('a designed cover is returned as it was saved, never rebuilt', () => {
  const saved = coverSheetOf(album(), profile);
  const edited = { ...saved, photoIds: ['x', 'y'] };
  const back = coverSheetOf(album({
    background: '#fff', title: '', subtitle: '', spineText: '', sheet: edited,
  }), profile);
  assert.deepEqual(back.photoIds, ['x', 'y']);
});

test('the spine sits in the middle of the sheet, at the width of the board', () => {
  const band = spineBand(profile);
  assert.ok(Math.abs(band.width - 20 / 620) < 1e-9);
  assert.ok(Math.abs(band.start - (1 - 20 / 620) / 2) < 1e-9);
});

test('the front board is the right-hand side of a Hebrew cover, and mirrors for ltr', () => {
  const band = spineBand(profile);
  const rtl = plainCoverTemplate(profile, '#ffffff', 'rtl');
  const ltr = plainCoverTemplate(profile, '#ffffff', 'ltr');

  const placesOf = (template: ReturnType<typeof plainCoverTemplate>) => {
    const [back, front] = photoLayers(template);
    return { back, front };
  };
  const right = placesOf(rtl);
  const left = placesOf(ltr);

  assert.equal(right.back.id, 'back');
  assert.equal(right.front.id, 'front');
  assert.equal(right.back.box.x, 0);
  assert.ok(Math.abs(right.front.box.x - (band.start + band.width)) < 1e-9);

  // mirrored — and the two places keep their order, so no photo changes side
  assert.equal(left.back.id, 'back');
  assert.equal(left.front.id, 'front');
  assert.equal(left.front.box.x, 0);
  assert.ok(Math.abs(left.back.box.x - (band.start + band.width)) < 1e-9);
});

test('the two boards and the spine cover the sheet exactly', () => {
  const template = plainCoverTemplate(profile, '#ffffff');
  const [back, front] = photoLayers(template);
  const band = spineBand(profile);
  assert.ok(Math.abs(back.box.width + front.box.width + band.width - 1) < 1e-9);
  assert.equal(back.box.height, 1);
  assert.equal(front.box.height, 1);
  assert.ok(Math.abs(template.nativeAspect - 620 / 210) < 1e-9);
});

const inkOf = (template: ReturnType<typeof plainCoverTemplate>) => (
  template.colors.find((color) => color.id === 'ink')?.value
);

test('lettering opens dark on a pale cover and light on a dark one', () => {
  assert.equal(inkOf(plainCoverTemplate(profile, '#eee6db')), '#2b2118');
  assert.equal(inkOf(plainCoverTemplate(profile, '#1c1a17')), '#ffffff');
});

test('lettering opens white once a photograph fills the front', () => {
  const sheet = coverSheetOf(album(), profile);
  const withPhoto = { ...sheet, photoIds: ['', 'front.jpg'] };
  assert.equal(inkOf(coverTemplateOf(withPhoto, profile)!), '#ffffff');
  // ...and a colour the photographer picked wins over that default
  const chosen = {
    ...withPhoto,
    templateInstance: { ...sheet.templateInstance!, colors: { ink: '#b7501f' } },
  };
  assert.equal(
    colorOf(coverTemplateOf(chosen, profile)!, chosen.templateInstance, 'ink'),
    '#b7501f',
  );
});

test('no spine lettering on a book too thin to carry any', () => {
  const thin = plainCoverTemplate(
    { ...profile, coverSpec: { ...profile.coverSpec, spineWidthMm: 4 } },
    '#ffffff',
  );
  assert.equal(thin.layers.some((layer) => layer.id === 'spine'), false);
  assert.equal(
    plainCoverTemplate(profile, '#ffffff').layers.some((layer) => layer.id === 'spine'),
    true,
  );
});

test('what the photographer moved on the cover is on the page the export draws', () => {
  const sheet = coverSheetOf(album(), profile);
  const moved = {
    ...sheet,
    templateInstance: {
      ...sheet.templateInstance!,
      places: { front: { x: 0.6, y: 0.1, width: 0.3, height: 0.8 } },
      colors: { background: '#101010' },
    },
  };
  const template = coverTemplateOf(moved, profile);
  assert.ok(template);
  const front = templateSlots(template!).find((place) => place.id === 'front');
  assert.deepEqual(
    { x: front!.x, y: front!.y, width: front!.width, height: front!.height },
    { x: 0.6, y: 0.1, width: 0.3, height: 0.8 },
  );
});

test('a page from the Vault placed on the cover is fitted to the cover, not to a spread', () => {
  const sheet = coverSheetOf(album(), profile);
  const vault = {
    ...sheet,
    templateInstance: {
      templateId: 'vault-p004', templateVersion: 1, colors: {}, texts: {},
    },
  };
  const template = coverTemplateOf(vault, profile);
  assert.ok(template);
  assert.ok(Math.abs(template!.nativeAspect - 620 / 210) < 1e-9);
  // and the front/back zones stop meaning anything once it is not a plain cover
  assert.equal(coverZonePlace(vault, 'front'), null);
  assert.equal(coverZonePlace(sheet, 'front'), 1);
  assert.equal(coverZonePlace(sheet, 'back'), 0);
});
