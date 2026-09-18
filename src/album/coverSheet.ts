import type { AlbumCover, AlbumProject, AlbumSpread, PrintProductProfile } from './model';
import type { AlbumTemplate, SpreadTemplateInstance, TemplateLayer } from './templates/types';
import { fittedTemplate, findTemplate, withInstance } from './templates/library.ts';

/* The cover is a designed sheet, like any other page in the album.
 *
 * It used to be seven fields — a colour, two photographs, two crops and three
 * lines of text — edited on a screen of its own. That screen could not carry a
 * single one of the tools the album designer has, and not because they were
 * hidden from it: a page made of seven fields has no layers, so there is
 * nothing for "bring forward", "add a frame" or "choose a font" to act on. The
 * cover was the one page of the book that could not be designed.
 *
 * So the cover became a sheet: back, spine and front on one piece of paper, in
 * the order it is printed, holding the same `templateInstance` a spread holds.
 * From that moment every tool in the designer works on it for free — elements,
 * artwork, lettering, frames, shadows, fades, guides, colours — and the export
 * draws it with the same renderer as every other page.
 *
 * The one thing a cover has that a spread does not is the SPINE: the strip of
 * board between back and front, whose width comes from the printed product and
 * not from the design. So the page it starts on is built here, from the
 * product's own measurements, rather than taken from the Vault. Any Vault page
 * can be placed on it afterwards — `adapt.ts` fits a design to any shape, and
 * a cover is simply a wider one.
 */

/** `activeSpreadId` when the cover is the sheet being designed. No spread can
 *  collide with it: a spread's id is always `spread-<time>`. */
export const COVER_SHEET_ID = 'cover';

/** The page a cover starts on, before any design from the Vault is placed. */
export const COVER_TEMPLATE_ID = 'cover-plain';
const COVER_TEMPLATE_VERSION = 1;

export const DEFAULT_COVER_BACKGROUND = '#eee6db';

/** Relative luminance, per WCAG — a cover on cream paper needs dark lettering
 *  and the same cover in charcoal needs light. The photographer changes it
 *  like any other page colour; this only decides what it opens as. */
export function isLightPaper(color: string): boolean {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (full.length < 6) return true;
  const channel = (index: number) => {
    const value = parseInt(full.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) > 0.35;
}

export function coverAspect(profile: PrintProductProfile): number {
  const spec = profile.coverSpec;
  return Math.max(0.2, spec.totalWidthMm / Math.max(1, spec.totalHeightMm));
}

/** Where the spine sits on the sheet, as fractions of its width. */
export function spineBand(profile: PrintProductProfile): { start: number; width: number } {
  const spec = profile.coverSpec;
  const width = Math.max(0, Math.min(0.4, spec.spineWidthMm / Math.max(1, spec.totalWidthMm)));
  return { start: (1 - width) / 2, width };
}

/** The plain cover page, built from the product being printed.
 *
 * Laid out the way the sheet is PRINTED — back, spine, front from left to
 * right. A Hebrew album opens from the right, so the front is the right-hand
 * page of this sheet; the designer shows it the same way round, because that
 * is the order the lab receives it in. */
export function plainCoverTemplate(
  profile: PrintProductProfile,
  background: string,
  opening: 'rtl' | 'ltr' = 'rtl',
  /** Is there a photograph under the lettering? */
  overPhoto = false,
): AlbumTemplate {
  const spine = spineBand(profile);
  const page = spine.start;
  /* What the words OPEN as, not what they are: the swatch is right there in
   * the panel. On bare board the lettering has to contrast with the board; the
   * moment a photograph fills the front, white is the one colour that reads on
   * a picture nobody has chosen yet. */
  const ink = overPhoto ? '#ffffff' : isLightPaper(background) ? '#2b2118' : '#ffffff';
  /* A Hebrew album opens from the right, so its front board is the right-hand
   * side of the printed sheet; an album that opens from the left is the mirror
   * of that. The two places keep their order in the layer list either way —
   * back first, front second — because that order is what binds them to the
   * cover's photographs, and a photograph must not jump sides when the
   * direction changes. */
  const frontLeft = opening === 'ltr' ? 0 : spine.start + spine.width;
  const backLeft = opening === 'ltr' ? spine.start + spine.width : 0;

  const layers: TemplateLayer[] = [
    {
      type: 'photo', id: 'back', name: 'גב הכריכה', zIndex: 1,
      box: { x: backLeft, y: 0, width: page, height: 1 },
      role: 'support', preferred: ['landscape', 'portrait'],
    },
    {
      type: 'photo', id: 'front', name: 'חזית הכריכה', zIndex: 2,
      box: { x: frontLeft, y: 0, width: page, height: 1 },
      role: 'hero', preferred: ['portrait', 'landscape'],
    },
    {
      type: 'text', id: 'title', name: 'כותרת', zIndex: 10,
      box: { x: frontLeft + page * 0.11, y: 0.66, width: page * 0.78, height: 0.12 },
      defaultText: '', direction: 'rtl', fontFamily: 'Frank Ruhl Libre', fontWeight: 600,
      fontSize: 0.065, lineHeight: 1.2, align: 'center', verticalAlign: 'middle',
      colorToken: 'ink',
    },
    {
      type: 'text', id: 'subtitle', name: 'כותרת משנה', zIndex: 11,
      box: { x: frontLeft + page * 0.11, y: 0.79, width: page * 0.78, height: 0.07 },
      defaultText: '', direction: 'rtl', fontFamily: 'Assistant', fontWeight: 400,
      fontSize: 0.028, lineHeight: 1.3, align: 'center', verticalAlign: 'middle',
      colorToken: 'ink',
    },
  ];

  /* A spine narrower than about eight millimetres cannot hold readable
   * lettering, and an empty rotated text box in the middle of the sheet is
   * something to bump into, not a feature. The measure is MILLIMETRES of
   * board — as a fraction of the sheet it would depend on how wide the album
   * is, and the same book would grow lettering by being made smaller. */
  if (profile.coverSpec.spineWidthMm >= 8) {
    layers.push({
      type: 'text', id: 'spine', name: 'שדרה', zIndex: 12,
      box: { x: spine.start, y: 0.15, width: spine.width, height: 0.7 },
      rotation: -90,
      defaultText: '', direction: 'rtl', fontFamily: 'Assistant', fontWeight: 500,
      fontSize: 0.026, lineHeight: 1.2, align: 'center', verticalAlign: 'middle',
      colorToken: 'ink',
    });
  }

  return {
    schemaVersion: 1,
    id: COVER_TEMPLATE_ID,
    version: COVER_TEMPLATE_VERSION,
    name: 'כריכה',
    source: 'vault-idml',
    sourcePage: 0,
    nativeAspect: coverAspect(profile),
    photoCount: 2,
    backgroundToken: 'background',
    colors: [
      { id: 'background', label: 'רקע הכריכה', value: background },
      { id: 'ink', label: 'כיתובים', value: ink },
    ],
    layers,
  };
}

const DEFAULT_COVER: AlbumCover = {
  background: DEFAULT_COVER_BACKGROUND,
  title: '',
  subtitle: '',
  spineText: '',
};

/** The cover as a sheet — the saved one, or one built from what the cover was
 *  before it had a design.
 *
 *  Migration is a plain translation and loses nothing: the front and back
 *  photographs become the sheet's two photo places, their crops become its
 *  frame settings, and the three lines of text become its three text layers. */
export function coverSheetOf(project: AlbumProject, profile: PrintProductProfile): AlbumSpread {
  const cover = project.cover ?? DEFAULT_COVER;
  if (cover.sheet) return cover.sheet;

  const instance: SpreadTemplateInstance = {
    templateId: COVER_TEMPLATE_ID,
    templateVersion: COVER_TEMPLATE_VERSION,
    colors: { background: cover.background },
    texts: {
      title: cover.title ?? '',
      subtitle: cover.subtitle ?? '',
      spine: cover.spineText ?? '',
    },
  };
  const frameSettings: AlbumSpread['frameSettings'] = {};
  if (cover.backSettings) frameSettings.back = cover.backSettings;
  if (cover.frontSettings) frameSettings.front = cover.frontSettings;

  return {
    id: COVER_SHEET_ID,
    /* The cover carries no page number: pagination starts inside the book. */
    pageStart: 0,
    layoutId: COVER_TEMPLATE_ID,
    photoIds: [cover.backPhotoId ?? '', cover.frontPhotoId ?? ''],
    background: cover.background,
    locked: false,
    status: 'draft',
    frameSettings,
    templateInstance: instance,
  };
}

/** The cover's page, fitted and with this cover's own edits on it.
 *
 * A design from the Vault is fitted to the cover's shape exactly as it is
 * fitted to any album shape. The plain page is BUILT at the cover's shape, so
 * it is never fitted — fitting it would stretch a spine that is a measurement
 * of board, not a proportion. */
export function coverTemplateOf(
  sheet: AlbumSpread,
  profile: PrintProductProfile,
  opening: 'rtl' | 'ltr' = 'rtl',
): AlbumTemplate | null {
  const instance = sheet.templateInstance;
  if (!instance) return null;
  if (instance.templateId === COVER_TEMPLATE_ID) {
    const background = instance.colors.background ?? sheet.background;
    /* The front board is the second place; the words sit on it. */
    const overPhoto = Boolean(sheet.photoIds[1]);
    return withInstance(plainCoverTemplate(profile, background, opening, overPhoto), instance);
  }
  const template = findTemplate(instance.templateId);
  if (!template) return null;
  return withInstance(fittedTemplate(template, coverAspect(profile)), instance, template);
}

/** The photographer's two cover zones, as places on the sheet. A design from
 *  the Vault has its own places and no notion of front and back, so the zones
 *  only mean anything while the plain cover page is on it. */
export function coverZonePlace(sheet: AlbumSpread, zone: 'front' | 'back'): number | null {
  if (sheet.templateInstance?.templateId !== COVER_TEMPLATE_ID) return null;
  return zone === 'back' ? 0 : 1;
}
