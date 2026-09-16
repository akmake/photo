import type { AlbumSpread, LayoutSlot } from '../model';
import type {
  AlbumTemplate, PhotoLayer, SpreadTemplateInstance, TemplateLayer, TextLayer,
} from './types';
import { VAULT_TEMPLATES } from './vaultLibrary.ts';
import { fittedTemplate } from './adapt.ts';

export { fitTemplate, fittedTemplate } from './adapt.ts';

/* The template library — the Vault's pages rebuilt as layers (generated from
 * the InDesign source into vaultLibrary.ts), and the few pure rules every
 * screen uses to read them. No React here, so the rules are testable without a
 * browser (tests/albumTemplates.test.ts). */

/** The whole library. The Vault is every design the product offers. */
export const TEMPLATE_LIBRARY: AlbumTemplate[] = VAULT_TEMPLATES;

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
