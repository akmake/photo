import type { AlbumSpread, LayoutSlot } from '../model';
import type {
  AlbumTemplate, PhotoLayer, SpreadTemplateInstance, TemplateLayer, TextLayer,
} from './types';
import { P004_SUBTITLE_OUTLINE, P004_TITLE_OUTLINE } from './vaultOutlines.ts';
import { fittedTemplate } from './adapt.ts';

export { fitTemplate, fittedTemplate } from './adapt.ts';

/* The template library — designed pages rebuilt as layers, and the few pure
 * rules every screen uses to read them. No React here, so the rules are
 * testable without a browser (tests/albumTemplates.test.ts). */

/** The Vault's page size in PDF points: a 560×210 mm spread. */
const VAULT_WIDTH_PT = 1587.4;
const VAULT_HEIGHT_PT = 595.276;
const VAULT_ASPECT = VAULT_WIDTH_PT / VAULT_HEIGHT_PT;

/** A point measured in the source PDF (origin bottom-left) → spread fractions. */
const fromPdf = (x: number, y: number): [number, number] => [
  x / VAULT_WIDTH_PT,
  1 - y / VAULT_HEIGHT_PT,
];

/* Page 4: one photo across the fold, a colour band with a two-line title and an
 * open frame. Geometry and colours measured from the PDF drawing commands. */
export const VAULT_PAGE_4: AlbumTemplate = {
  schemaVersion: 1,
  id: 'vault-p004',
  version: 1,
  name: 'הכספת · עמוד 4',
  source: 'vault-pdf',
  sourcePage: 4,
  nativeAspect: VAULT_ASPECT,
  photoCount: 1,
  backgroundToken: 'background',
  colors: [
    { id: 'background', label: 'רקע', value: '#251c11' },
    { id: 'band', label: 'פס צבע', value: '#b28858' },
    { id: 'ink', label: 'טקסט ומסגרת', value: '#ffffff' },
  ],
  layers: [
    {
      type: 'shape',
      id: 'band',
      name: 'פס צבע',
      zIndex: 1,
      shape: 'rect',
      box: { x: 0.0717, y: 0, width: 0.1672, height: 1 },
      fillToken: 'band',
    },
    {
      type: 'photo',
      id: 'hero',
      name: 'תמונה',
      zIndex: 2,
      box: { x: 0.3131, y: 0, width: 0.5759, height: 1 },
      role: 'hero',
      preferred: ['landscape'],
      allowCrossGutter: true,
    },
    {
      type: 'text',
      id: 'title',
      name: 'כותרת',
      zIndex: 3,
      box: { x: 0.12, y: 0.419, width: 0.0978, height: 0.0475 },
      defaultText: 'ליהנות',
      fontFamily: "'Rubik', 'Segoe UI', sans-serif",
      fontWeight: 700,
      fontSize: 0.056,
      lineHeight: 1,
      align: 'start',
      verticalAlign: 'middle',
      colorToken: 'ink',
      outline: { d: P004_TITLE_OUTLINE, fillRule: 'nonzero' },
      sourceFont: 'גופן הכותרת של המעצב',
    },
    {
      type: 'text',
      id: 'subtitle',
      name: 'שורה בכתב יד',
      zIndex: 3,
      box: { x: 0.08, y: 0.4721, width: 0.1154, height: 0.0985 },
      defaultText: 'מכל רגע',
      fontFamily: "'Amatic SC', 'Segoe Script', cursive",
      fontWeight: 700,
      fontSize: 0.1,
      lineHeight: 1,
      align: 'start',
      verticalAlign: 'middle',
      colorToken: 'ink',
      outline: { d: P004_SUBTITLE_OUTLINE, fillRule: 'nonzero' },
      sourceFont: 'גופן כתב היד של המעצב',
    },
    {
      type: 'shape',
      id: 'frame',
      name: 'מסגרת פתוחה',
      zIndex: 3,
      shape: 'polyline',
      box: { x: 0.093, y: 0.4571, width: 0.1139, height: 0.1214 },
      points: [
        fromPdf(225.5129, 323.1463),
        fromPdf(147.6349, 323.1463),
        fromPdf(147.6349, 250.8953),
        fromPdf(328.4189, 250.8953),
        fromPdf(328.4189, 287.0213),
      ],
      strokeToken: 'ink',
      strokeWidth: 3 / VAULT_HEIGHT_PT,
    },
  ],
};

export const TEMPLATE_LIBRARY: AlbumTemplate[] = [VAULT_PAGE_4];

export function findTemplate(id: string): AlbumTemplate | undefined {
  return TEMPLATE_LIBRARY.find((template) => template.id === id);
}

/** Designs a spread with this many photos can take. Every design fits every
 *  album shape — see adapt.ts. */
export function templatesFor(photoCount: number): AlbumTemplate[] {
  return TEMPLATE_LIBRARY.filter((template) => template.photoCount === photoCount);
}

export function photoLayers(template: AlbumTemplate): PhotoLayer[] {
  return template.layers.filter((layer): layer is PhotoLayer => layer.type === 'photo');
}

/** The template's photo places in the shape every existing photo tool reads:
 *  placing, swapping, cropping and the crop/PPI checks all keep working. */
export function templateSlots(template: AlbumTemplate): LayoutSlot[] {
  return photoLayers(template).map((layer) => ({
    id: layer.id,
    x: layer.box.x,
    y: layer.box.y,
    width: layer.box.width,
    height: layer.box.height,
    role: layer.role,
    preferred: layer.preferred,
    allowCrossGutter: layer.allowCrossGutter,
  }));
}

/** Non-photo layers split around the photos, each side in paint order. */
export function layerBands(template: AlbumTemplate): {
  below: TemplateLayer[];
  above: TemplateLayer[];
} {
  const photoZ = Math.min(...photoLayers(template).map((layer) => layer.zIndex), Infinity);
  const others = template.layers
    .filter((layer) => layer.type !== 'photo')
    .sort((a, b) => a.zIndex - b.zIndex);
  return {
    below: others.filter((layer) => layer.zIndex < photoZ),
    above: others.filter((layer) => layer.zIndex >= photoZ),
  };
}

export function newInstance(template: AlbumTemplate): SpreadTemplateInstance {
  return {
    templateId: template.id,
    templateVersion: template.version,
    colors: {},
    texts: {},
  };
}

/* A token the template does not define is a defect in the library, not a
 * colour choice — paint it unmistakably instead of falling back to black. */
const MISSING_COLOR = '#ff00ff';

export function colorOf(
  template: AlbumTemplate,
  instance: SpreadTemplateInstance,
  token: string,
): string {
  return instance.colors[token]
    ?? template.colors.find((color) => color.id === token)?.value
    ?? MISSING_COLOR;
}

export function templateBackground(
  template: AlbumTemplate,
  instance: SpreadTemplateInstance,
): string {
  return colorOf(template, instance, template.backgroundToken);
}

export function textOf(instance: SpreadTemplateInstance, layer: TextLayer): string {
  return instance.texts[layer.id] ?? layer.defaultText;
}

/** The designer's lettering is shown exactly as drawn until the words change. */
export function usesSourceLettering(instance: SpreadTemplateInstance, layer: TextLayer): boolean {
  return Boolean(layer.outline) && textOf(instance, layer) === layer.defaultText;
}

/** The template placed on this spread, already fitted to the album's shape — or
 *  null when there is none, or when its design is no longer in the library
 *  (preflight reports that case). */
export function spreadTemplate(spread: AlbumSpread, spreadAspect: number): AlbumTemplate | null {
  if (!spread.templateInstance) return null;
  const template = findTemplate(spread.templateInstance.templateId);
  return template ? fittedTemplate(template, spreadAspect) : null;
}

/** What changes on a spread when a design is placed on it. The spread keeps its
 *  photos in order; the generated or hand-made layout gives way to the design. */
export function applyTemplate(spread: AlbumSpread, template: AlbumTemplate): Partial<AlbumSpread> {
  return {
    templateInstance: newInstance(template),
    photoIds: Array.from(
      { length: template.photoCount },
      (_, index) => spread.photoIds[index] ?? '',
    ),
    customSlots: undefined,
    frameSettings: {},
  };
}
