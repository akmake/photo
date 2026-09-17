import type { PhotoPalette } from '../api';
import type { TemplateColor } from './templates/types';

/* Page colours chosen from the photographs on the page.
 *
 * The photographer can already set every colour of a designed page by hand —
 * "רקע", "קווים ומסגרות" — and each choice is stored per spread. This is the
 * machine filling in the same field, so an automatically built album arrives
 * already coloured for its own photographs instead of arriving on the one
 * background the Vault was drawn in.
 *
 * What it does NOT do is take the colours of the photograph and paint the page
 * with them. Averaging a photograph gives mud, and a page in the photograph's
 * own colour makes the photograph disappear into it. Four rules instead, each
 * one axis of Lab:
 *
 *   LIGHTNESS stays the designer's. A page drawn dark stays dark — that is the
 *   album's character, not a detail. It drifts a few points only, and only by
 *   how bright this chapter actually is against the album's own average, so a
 *   bright morning chapter sits on a lighter page than a dark dancefloor.
 *
 *   HUE leans towards the photographs. Most of the way, not all of it: the page
 *   answers the photographs, it does not copy them.
 *
 *   CHROMA stays quiet and capped, harder on light pages than on dark ones. The
 *   background is the stage.
 *
 *   SKIN is what the page must stay away from. A background at the same
 *   lightness as the faces on it flattens them, so a guaranteed gap is kept —
 *   measured from the real skin tone of the real photographs, away from hair
 *   and highlights.
 *
 * Every other colour on the page — the lines, the frames, the words — moves
 * with the background and keeps its contrast against it, because a white
 * hairline frame on a page that just turned cream is a frame that vanished.
 *
 * Pure and measured in Lab: tested in tests/albumColor.test.ts. With no
 * measured palette this returns nothing at all and the page keeps the colours
 * it was designed in — a page is never coloured from a guess.
 */

/** The colour direction of a set of photographs. */
export interface ColorDirection {
  /** Degrees, 0..360. The area- and chroma-weighted hue of the photographs. */
  hue: number;
  /** Mean chroma of the photographs' chromatic colours. */
  chroma: number;
  /** Mean lightness of the photographs, 0..100. */
  lightness: number;
  /** Lightness of the faces, when there are faces. The page stays away from it. */
  skinLightness: number | null;
  /** How many photographs this was measured from. */
  measured: number;
}

/** Below this chroma a colour is grey and its hue is noise. Matches the
 *  engine's own threshold in album_palette.py. */
const NEUTRAL_CHROMA = 6;
/** A designed colour flatter than this has no hue worth preserving — a white or
 *  near-black page takes the photographs' hue outright. */
const DESIGNED_NEUTRAL = 2.5;
/** Share of the way the background's hue travels towards the photographs. */
const BACKGROUND_HUE_PULL = 0.6;
/** The lines and words follow more gently, so the page reads as one family
 *  without every element turning the same colour. */
const DETAIL_HUE_PULL = 0.35;
/** Share of the photographs' chroma the background is allowed to take. */
const CHROMA_SHARE = 0.3;
/** How much of the designed chroma survives, against the measured target. */
const DESIGNED_CHROMA_WEIGHT = 0.4;
/** Lightness points the page drifts per point this chapter differs from the
 *  album's average brightness, and the most it may ever drift. */
const DRIFT_GAIN = 0.35;
const DRIFT_MAX = 7;
/** The lightness gap the background keeps from the skin on it. Below roughly
 *  this the faces stop separating from the page. */
const SKIN_GAP = 18;
/** The most the skin rule may move a page from the lightness it was designed
 *  in. A face that does not separate is worse than a page a few points off its
 *  design — but not worse than a dark album turning pale, so getting clear of
 *  the faces is a goal with a budget, not a demand. */
const SKIN_PUSH_MAX = 12;
/** Lines and words stay faintly tinted, never coloured. */
const DETAIL_CHROMA_LIFT = 3;
const DETAIL_CHROMA_CAP = 12;
/** The contrast a detail keeps against the new background: what it was
 *  designed with, but never demanding more than this, and never less than a
 *  line that is still clearly a line. */
const DETAIL_CONTRAST_TARGET = 4.5;
const DETAIL_CONTRAST_FLOOR = 1.6;
/** Printable range. Pure black and pure white are not places to push a page to. */
const L_MIN = 4;
const L_MAX = 96;

interface Lab { l: number; a: number; b: number }
interface Lch { l: number; c: number; h: number }

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((ch) => ch + ch).join('') : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (channel: number): number => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (channel: number): number => {
  const v = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return clamp(v, 0, 1) * 255;
};

// D65, the sRGB white point.
const WHITE = { x: 0.95047, y: 1.0, z: 1.08883 };

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE.x;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / WHITE.y;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / WHITE.z;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToHex(lab: Lab): string {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const g = (t: number): number => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [g(fx) * WHITE.x, g(fy) * WHITE.y, g(fz) * WHITE.z];
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gr = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return rgbToHex([fromLinear(r), fromLinear(gr), fromLinear(b)]);
}

function toLch(lab: Lab): Lch {
  return {
    l: lab.l,
    c: Math.hypot(lab.a, lab.b),
    h: (Math.atan2(lab.b, lab.a) * 180) / Math.PI,
  };
}

function fromLch(lch: Lch): Lab {
  const radians = (lch.h * Math.PI) / 180;
  return { l: lch.l, a: Math.cos(radians) * lch.c, b: Math.sin(radians) * lch.c };
}

/** The shortest way round from `from` to `to`, travelled `share` of the way. */
function rotateHue(from: number, to: number, share: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return (((from + delta * share) % 360) + 360) % 360;
}

/** WCAG relative luminance, so "is this line still visible" is a number. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(one: string, two: string): number {
  const [high, low] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** How much chroma a background may carry at this lightness. A dark page holds
 *  a deep colour; the same chroma on a pale page is a tinted sheet of paper. */
function chromaCap(lightness: number): number {
  if (lightness >= 70) return 10;
  if (lightness <= 35) return 22;
  return 16;
}

/** The colour direction of these photographs, or null when none of them has a
 *  measured palette — in which case nothing is coloured. */
export function measureDirection(palettes: Array<PhotoPalette | undefined>): ColorDirection | null {
  const usable = palettes.filter((palette): palette is PhotoPalette => Boolean(palette?.colors?.length));
  if (!usable.length) return null;

  let x = 0;
  let y = 0;
  let chromaSum = 0;
  let hueWeight = 0;
  usable.forEach((palette) => {
    palette.colors.forEach((color) => {
      if (color.c < NEUTRAL_CHROMA) return;
      // Area AND chroma: a quarter of the frame in a strong colour says more
      // about the photograph's direction than half of it in a pale one.
      const weight = color.weight * color.c;
      const radians = (color.h * Math.PI) / 180;
      x += Math.cos(radians) * weight;
      y += Math.sin(radians) * weight;
      chromaSum += color.c * weight;
      hueWeight += weight;
    });
  });

  const skins = usable
    .map((palette) => palette.skin?.l)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);

  return {
    hue: hueWeight > 0 ? (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360 : 0,
    chroma: hueWeight > 0 ? chromaSum / hueWeight : 0,
    lightness: usable.reduce((sum, palette) => sum + palette.meanL, 0) / usable.length,
    skinLightness: skins.length ? skins[Math.floor(skins.length / 2)] : null,
    measured: usable.length,
  };
}

/** One designed background, leaned towards these photographs. */
export function tintedBackground(
  designedHex: string,
  chapter: ColorDirection,
  album: ColorDirection = chapter,
): string {
  const designed = toLch(hexToLab(designedHex));

  const drift = clamp((chapter.lightness - album.lightness) * DRIFT_GAIN, -DRIFT_MAX, DRIFT_MAX);
  let lightness = clamp(designed.l + drift, L_MIN, L_MAX);

  const skin = chapter.skinLightness;
  if (skin !== null && Math.abs(lightness - skin) < SKIN_GAP) {
    // Away from the faces, on the side the designer put the page on, and never
    // further than the budget above. A page with nowhere left to go keeps what
    // separation it can reach rather than leaving its own album's character.
    const aim = (down: boolean): number => clamp(
      clamp(down ? skin - SKIN_GAP : skin + SKIN_GAP, lightness - SKIN_PUSH_MAX, lightness + SKIN_PUSH_MAX),
      L_MIN,
      L_MAX,
    );
    const designedSide = aim(designed.l <= skin);
    const otherSide = aim(designed.l > skin);
    lightness = Math.abs(designedSide - skin) >= SKIN_GAP - 0.01
      || Math.abs(designedSide - skin) >= Math.abs(otherSide - skin)
      ? designedSide
      : otherSide;
  }

  const hue = designed.c < DESIGNED_NEUTRAL
    ? chapter.hue
    : rotateHue(designed.h, chapter.hue, BACKGROUND_HUE_PULL);
  const cap = chromaCap(lightness);
  const target = Math.min(chapter.chroma * CHROMA_SHARE, cap);
  const chroma = clamp(
    designed.c * DESIGNED_CHROMA_WEIGHT + target * (1 - DESIGNED_CHROMA_WEIGHT),
    0,
    cap,
  );

  return labToHex(fromLch({ l: lightness, c: chroma, h: hue }));
}

/** A line, a frame or a word, moved with the new background and kept visible
 *  on it. The designed relationship is preserved: what was lighter than the
 *  page stays lighter. */
function tintedDetail(
  designedHex: string,
  backgroundHex: string,
  designedBackgroundHex: string,
  chapter: ColorDirection,
): string {
  const designed = toLch(hexToLab(designedHex));
  const background = toLch(hexToLab(backgroundHex));

  const hue = designed.c < DESIGNED_NEUTRAL
    ? chapter.hue
    : rotateHue(designed.h, chapter.hue, DETAIL_HUE_PULL);
  const chroma = Math.min(designed.c + DETAIL_CHROMA_LIFT, DETAIL_CHROMA_CAP);

  const designedContrast = contrastRatio(designedHex, designedBackgroundHex);
  const required = clamp(
    Math.min(designedContrast, DETAIL_CONTRAST_TARGET),
    DETAIL_CONTRAST_FLOOR,
    DETAIL_CONTRAST_TARGET,
  );

  // Which side of the page it was designed on — and, if that side has run out
  // of room, the other one.
  const lighter = toLch(hexToLab(designedHex)).l >= toLch(hexToLab(designedBackgroundHex)).l;
  const reach = (up: boolean): string | null => {
    const step = up ? 2 : -2;
    let lightness = clamp(designed.l, L_MIN, L_MAX);
    for (let tries = 0; tries <= 48; tries += 1) {
      const candidate = labToHex(fromLch({ l: lightness, c: chroma, h: hue }));
      if (contrastRatio(candidate, backgroundHex) >= required) return candidate;
      const next = lightness + step;
      if (next < L_MIN || next > L_MAX) return null;
      lightness = next;
    }
    return null;
  };

  return reach(lighter)
    ?? reach(!lighter)
    ?? labToHex(fromLch({ l: background.l >= 50 ? L_MIN : L_MAX, c: 0, h: hue }));
}

/** Every colour of one designed page, chosen for the photographs on it.
 *  The returned map is exactly what the photographer's own colour pickers
 *  write, so a hand change afterwards overrides it the ordinary way. */
export function pageColors(
  colors: TemplateColor[],
  backgroundToken: string,
  chapter: ColorDirection | null,
  album: ColorDirection | null = chapter,
): Record<string, string> {
  if (!chapter || !colors.length) return {};
  const designedBackground = colors.find((color) => color.id === backgroundToken)?.value;
  if (!designedBackground) return {};

  const background = tintedBackground(designedBackground, chapter, album ?? chapter);
  const out: Record<string, string> = { [backgroundToken]: background };
  colors.forEach((color) => {
    if (color.id === backgroundToken) return;
    out[color.id] = tintedDetail(color.value, background, designedBackground, chapter);
  });
  return out;
}
