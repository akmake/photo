/* The page-colour rule (albumColor.ts), without a browser.
 *
 *   node --test "tests/*.test.ts"
 *
 * albumColor.ts is pure and imports types only, so Node runs it directly.
 *
 * What is checked here is what would actually ruin a printed album: a page
 * that ignores its photographs, a page that copies them, a background that
 * lands on the faces, a hairline frame that turns invisible, and a page
 * coloured from nothing at all. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrastRatio, hexToLab, labToHex, measureDirection, pageColors, tintedBackground,
} from '../src/album/albumColor.ts';
import type { PhotoPalette } from '../src/api.ts';

const lch = (hex: string) => {
  const lab = hexToLab(hex);
  return {
    l: lab.l,
    c: Math.hypot(lab.a, lab.b),
    h: (((Math.atan2(lab.b, lab.a) * 180) / Math.PI) + 360) % 360,
  };
};

/** A palette as the engine reports one. `h` in degrees, `c` in Lab chroma. */
const palette = (
  colors: Array<{ weight: number; l: number; c: number; h: number }>,
  skinL: number | null = null,
  meanL = 45,
): PhotoPalette => ({
  colors: colors.map((color) => ({ ...color, hex: '#000000' })),
  chromaticCount: colors.filter((color) => color.c >= 6).length,
  skin: skinL === null ? null : { hex: '#000000', l: skinL, c: 18, h: 45 },
  meanL,
  meanC: 20,
  measuredBy: 'test',
});

/* Warm golden photographs, as the demo frames measure: hue near 75°. */
const WARM = palette([{ weight: 0.5, l: 48, c: 40, h: 75 }, { weight: 0.3, l: 37, c: 25, h: 95 }]);
/* A cold blue-hour set, hue near 260°. */
const COLD = palette([{ weight: 0.6, l: 40, c: 30, h: 260 }]);
/* The Vault's own page colour: 140 of its 145 pages are this dark brown. */
const VAULT_BROWN = '#251c11';

test('Lab conversion round-trips a colour', () => {
  ['#251c11', '#ffffff', '#000000', '#7f5a2b', '#3c5f8a'].forEach((hex) => {
    assert.equal(labToHex(hexToLab(hex)), hex);
  });
});

test('no measured palette colours nothing', () => {
  assert.equal(measureDirection([]), null);
  assert.equal(measureDirection([undefined, undefined]), null);
  assert.deepEqual(pageColors([{ id: 'background', label: 'רקע', value: VAULT_BROWN }], 'background', null), {});
});

test('a grey set has no hue to follow, and still has a lightness', () => {
  const direction = measureDirection([palette([{ weight: 0.9, l: 50, c: 2, h: 210 }], null, 50)]);
  assert.ok(direction);
  assert.equal(direction.chroma, 0);
  assert.equal(direction.lightness, 50);
});

test('the background leans towards the photographs but never copies them', () => {
  const warm = measureDirection([WARM])!;
  const cold = measureDirection([COLD])!;
  const onWarm = lch(tintedBackground(VAULT_BROWN, warm));
  const onCold = lch(tintedBackground(VAULT_BROWN, cold));

  // It moved, and the two sets do not produce the same page.
  assert.notEqual(tintedBackground(VAULT_BROWN, warm), tintedBackground(VAULT_BROWN, cold));
  // Towards the photographs' hue, not onto it.
  const gap = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  assert.ok(gap(onCold.h, cold.hue) < gap(lch(VAULT_BROWN).h, cold.hue), 'moved towards the set');
  assert.ok(gap(onCold.h, cold.hue) > 1, 'did not land on the set');
  // And it stays a quiet page: well under the photographs' own chroma.
  assert.ok(onWarm.c < warm.chroma * 0.6, `background chroma ${onWarm.c} vs photos ${warm.chroma}`);
});

test('a page drawn dark stays dark', () => {
  const direction = measureDirection([palette([{ weight: 0.8, l: 80, c: 25, h: 75 }], null, 82)])!;
  const lightness = lch(tintedBackground(VAULT_BROWN, direction)).l;
  assert.ok(lightness < 30, `bright photographs must not turn a dark page pale (got L=${lightness})`);
});

test('a brighter chapter than the album sits on a lighter page, and the drift is bounded', () => {
  const album = measureDirection([palette([{ weight: 0.8, l: 40, c: 20, h: 75 }], null, 40)])!;
  const bright = measureDirection([palette([{ weight: 0.8, l: 75, c: 20, h: 75 }], null, 78)])!;
  const dark = measureDirection([palette([{ weight: 0.8, l: 12, c: 20, h: 75 }], null, 12)])!;

  const base = lch(tintedBackground(VAULT_BROWN, album, album)).l;
  const lifted = lch(tintedBackground(VAULT_BROWN, bright, album)).l;
  const lowered = lch(tintedBackground(VAULT_BROWN, dark, album)).l;

  assert.ok(lifted > base, 'a bright chapter lifts the page');
  assert.ok(lowered < base, 'a dark chapter lowers it');
  // The bound is 7 points; the slack is the sRGB round-trip through the hex.
  assert.ok(lifted - base <= 7.5 && base - lowered <= 7.5, 'and never by more than a few points');
});

test('the background gets clear of the skin on it', () => {
  // A page drawn just above the faces (L≈69 against skin at 60): a push of ten
  // points is inside the budget, so the full gap is reached, upwards — the side
  // the page was designed on.
  const faces = measureDirection([palette([{ weight: 0.7, l: 55, c: 20, h: 60 }], 60, 52)])!;
  const designed = lch('#b0a89c').l;
  const lightness = lch(tintedBackground('#b0a89c', faces)).l;
  assert.ok(Math.abs(designed - 60) < 18, 'the designed page really does sit on the faces');
  assert.ok(lightness > designed, 'it moved away on its own side');
  assert.ok(lightness - 60 >= 17.5, `page L=${lightness} must clear skin L=60`);
});

test('a page that cannot reach the full gap takes the separation it can', () => {
  // L≈56 against skin at 60: the nearer side is 42, which is thirteen points
  // away — one more than the budget allows, so the page stops at the budget.
  const faces = measureDirection([palette([{ weight: 0.7, l: 55, c: 20, h: 60 }], 60, 52)])!;
  const designed = lch('#8d8478').l;
  const lightness = lch(tintedBackground('#8d8478', faces)).l;
  assert.ok(designed - lightness <= 12.5, 'never further than the budget');
  assert.ok(Math.abs(lightness - 60) >= 15, `and still clearly off the faces (L=${lightness})`);
});

test('getting clear of the skin never costs the album its character', () => {
  // Dark pages, dark faces: the page cannot reach a full gap downwards without
  // becoming black, so it takes what it can and stays dark.
  const darkFaces = measureDirection([palette([{ weight: 0.7, l: 30, c: 20, h: 60 }], 22, 30)])!;
  const before = lch(VAULT_BROWN).l;
  const after = lch(tintedBackground(VAULT_BROWN, darkFaces)).l;
  assert.ok(Math.abs(after - 22) > Math.abs(before - 22), 'it still moved away from the faces');
  assert.ok(after < 30, `a dark page stays dark (got L=${after})`);
  assert.ok(before - after <= 12.5, 'and never moves further than its budget');
});

test('a white hairline frame survives the page changing colour', () => {
  const colors = [
    { id: 'background', label: 'רקע', value: VAULT_BROWN },
    { id: 'c1', label: 'קווים ומסגרות', value: '#ffffff' },
  ];
  // Photographs bright enough to pull the page up as far as it will go.
  const bright = measureDirection([palette([{ weight: 0.8, l: 85, c: 30, h: 75 }], null, 88)])!;
  const album = measureDirection([palette([{ weight: 0.8, l: 20, c: 30, h: 75 }], null, 20)])!;
  const out = pageColors(colors, 'background', bright, album);

  assert.equal(Object.keys(out).length, 2, 'every designed colour is answered');
  assert.ok(contrastRatio(out.c1, out.background) >= 1.6, 'the frame is still a frame');
  assert.ok(lch(out.c1).c <= 12.01, 'a white line may be tinted, never coloured');
});

test('a light page keeps a dark line dark', () => {
  const colors = [
    { id: 'background', label: 'רקע', value: '#ffffff' },
    { id: 'c1', label: 'קווים', value: '#1a1a1a' },
  ];
  const direction = measureDirection([WARM])!;
  const out = pageColors(colors, 'background', direction);
  assert.ok(lch(out.c1).l < lch(out.background).l, 'the designed relationship is kept');
  assert.ok(contrastRatio(out.c1, out.background) >= 4.4, 'and it stays clearly readable');
});

test('the map is exactly what a hand-picked colour writes', () => {
  const colors = [{ id: 'background', label: 'רקע', value: VAULT_BROWN }];
  const out = pageColors(colors, 'background', measureDirection([WARM])!);
  assert.deepEqual(Object.keys(out), ['background']);
  assert.match(out.background, /^#[0-9a-f]{6}$/);
});
