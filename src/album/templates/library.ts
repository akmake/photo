import type { AlbumSpread, LayoutSlot } from '../model';
import type {
  AlbumTemplate, LayerBox, PhotoLayer, SpreadTemplateInstance, TemplateLayer, TextLayer,
} from './types';
import { VAULT_TEMPLATES } from './vaultLibrary.ts';
import { fittedTemplate } from './adapt.ts';
import { withFades } from './fades.ts';
import { withPlaceStyles, withStructure } from './placeStyles.ts';

export { fitTemplate, fittedTemplate } from './adapt.ts';

/* The template library — the Vault's pages rebuilt as layers (generated from
 * the InDesign source into vaultLibrary.ts), and the few pure rules every
 * screen uses to read them. No React here, so the rules are testable without a
 * browser (tests/albumTemplates.test.ts). */

/* THE DESIGNS ARRIVE WITHOUT THEIR DRAWN ORNAMENTS.
 *
 * A Vault page's structure — the photo places, the frames, the bands, the
 * rules and the words — IS the design and stays. The free-drawn artwork laid
 * over it is decoration, and decoration is the photographer's to add: every
 * one of these ornaments is offered, one by one, in the elements panel.
 *
 * Taken off here and not out of the generated file, because that file is
 * generated from the InDesign source and must stay faithful to it — and
 * because the elements panel reads VAULT_AS_DRAWN to offer them. */
function isDrawnOrnament(layer: TemplateLayer): boolean {
  return layer.type === 'shape' && (layer.shape === 'path' || layer.shape === 'polyline');
}

function withoutOrnaments(template: AlbumTemplate): AlbumTemplate {
  const layers = template.layers.filter((layer) => !isDrawnOrnament(layer));
  if (layers.length === template.layers.length) return template;
  /* A swatch that paints nothing is a control that lies: a page keeps only the
   * colours something left on it still uses. */
  const used = new Set<string>([template.backgroundToken]);
  for (const layer of layers) {
    if (layer.type === 'shape') {
      if (layer.fillToken) used.add(layer.fillToken);
      if (layer.strokeToken) used.add(layer.strokeToken);
    }
    if (layer.type === 'text') used.add(layer.colorToken);
  }
  return { ...template, layers, colors: template.colors.filter((color) => used.has(color.id)) };
}

/** The Vault exactly as the designer drew it, ornaments included. Only the
 *  element library reads this — to lift those ornaments off and offer them. */
export const VAULT_AS_DRAWN: AlbumTemplate[] = VAULT_TEMPLATES;

/** The whole library as the album uses it. The Vault is every design the
 *  product offers, each one without its drawn ornaments. */
export const TEMPLATE_LIBRARY: AlbumTemplate[] = VAULT_TEMPLATES.map(withoutOrnaments);

const BY_ID = new Map(TEMPLATE_LIBRARY.map((template) => [template.id, template]));

/** Page 4 — the page the template system was first built and checked against. */
export const VAULT_PAGE_4: AlbumTemplate = BY_ID.get('vault-p004')!;

export function findTemplate(id: string): AlbumTemplate | undefined {
  return BY_ID.get(id);
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

/** Every layer in paint order, bottom first. */
export function paintOrder(template: AlbumTemplate): TemplateLayer[] {
  return [...template.layers].sort((a, b) => a.zIndex - b.zIndex);
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
  if (!template) return null;
  return withInstance(fittedTemplate(template, spreadAspect), spread.templateInstance, template);
}

/** A design with everything ONE sheet changed about it laid over it: the places
 *  moved, the fades, the styling, the elements added and the ones taken away.
 *
 *  Split out of `spreadTemplate` because the cover is a designed sheet too and
 *  its page is not a library page — it is built from the product's own spine
 *  and size. Both roads must go through the same edits, or a photographer's
 *  move would apply on a spread and be ignored on the cover. */
export function withInstance(
  fitted: AlbumTemplate,
  instance: SpreadTemplateInstance,
  /** The design as the library holds it — what a fade measures against. */
  designed: AlbumTemplate = fitted,
): AlbumTemplate {
  const structured = withStructure(fitted, instance.addedPlaces, instance.removedPlaces, instance.addedLayers);
  const placed = withPlaceEdits(structured, instance.places);
  const faded = withFades(placed, designed, instance.fades);
  return withPlaceStyles(faded, instance.styles);
}

/** A photo place the photographer moved or resized, applied to the page. A
 *  frame line drawn around that photo in the design goes with it. */
export function withPlaceEdits(
  template: AlbumTemplate,
  places: Record<string, LayerBox> | undefined,
): AlbumTemplate {
  if (!places || !Object.keys(places).length) return template;
  const moves = photoLayers(template)
    .filter((layer) => places[layer.id])
    .map((layer) => ({ from: layer.box, to: places[layer.id] }));
  const near = (a: number, b: number) => Math.abs(a - b) < 0.012;
  const hugs = (frame: LayerBox, photo: LayerBox) => near(frame.x, photo.x) && near(frame.y, photo.y)
    && near(frame.x + frame.width, photo.x + photo.width) && near(frame.y + frame.height, photo.y + photo.height);
  const layers = template.layers.map((layer) => {
    if (layer.type === 'photo' && places[layer.id]) return { ...layer, box: places[layer.id] };
    if (layer.type !== 'shape' || layer.shape !== 'rect' || layer.fillToken) return layer;
    const move = moves.find(({ from }) => hugs(layer.box, from));
    if (!move) return layer;
    const sx = move.to.width / move.from.width;
    const sy = move.to.height / move.from.height;
    return {
      ...layer,
      box: {
        x: move.to.x + (layer.box.x - move.from.x) * sx,
        y: move.to.y + (layer.box.y - move.from.y) * sy,
        width: layer.box.width * sx,
        height: layer.box.height * sy,
      },
    };
  });
  return { ...template, layers };
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
