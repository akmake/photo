import { VAULT_AS_DRAWN } from './library.ts';
import type { ImageLayer, ShapeLayer, TextLayer } from './types';

/* The element library: things the photographer can drop on any spread.
 *
 *   · from the Vault — every ornament, lettering and line the designer drew,
 *     lifted off its page as clean vector artwork (never with a background);
 *   · basics — a text box, a line, a rectangle, an ellipse;
 *   · imported — transparent PNG / SVG / WebP files (elementStore.ts).
 *
 * An element becomes a layer on the spread, placed on the right-hand page and
 * sized in page heights so it keeps its proportions on any album. Pure. */

export interface ElementDef {
  id: string;
  name: string;
  group: 'vault' | 'basic' | 'mine' | 'icons';
  kind: 'path' | 'text' | 'rect' | 'ellipse' | 'line' | 'image';
  /** path: artwork and its bounds in its source viewBox units. */
  d?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  fill?: string;
  stroke?: string;
  /** In page heights. */
  strokeWidth?: number;
  text?: string;
  fontFamily?: string;
  /** In page heights. */
  fontSize?: number;
  fontWeight?: number;
  /** Words to find the element by in search. */
  keywords?: string;
  /** image: element library id, and width ÷ height. */
  assetId?: string;
  aspect?: number;
}

const VIEW_HEIGHT = 1000;

/** Rough bounds of an SVG path from its numbers — enough to frame a thumbnail
 *  and to scale the artwork into a box. */
export function pathBounds(d: string): { x: number; y: number; width: number; height: number } | null {
  const numbers = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
  if (numbers.length < 2) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    x0 = Math.min(x0, numbers[i]); x1 = Math.max(x1, numbers[i]);
    y0 = Math.min(y0, numbers[i + 1]); y1 = Math.max(y1, numbers[i + 1]);
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

let vaultCache: ElementDef[] | null = null;

/** Every piece of artwork and text in the Vault, once each. */
export function vaultElements(): ElementDef[] {
  if (vaultCache) return vaultCache;
  const seen = new Set<string>();
  const out: ElementDef[] = [];
  for (const template of VAULT_AS_DRAWN) {
    for (const layer of template.layers) {
      /* Every ornament the pages no longer carry is offered here — the large
       * ones too. They used to be skipped as page-wide artwork; now that a
       * page arrives bare, skipping one would mean the photographer could
       * never put it back. */
      if (layer.type === 'shape' && layer.shape === 'path' && layer.outline && layer.box.width < 0.98) {
        const bounds = pathBounds(layer.outline.d);
        if (!bounds) continue;
        const key = `${layer.outline.d.length}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: `vault-${template.id}-${layer.id}`,
          name: `קישוט · עמוד ${template.sourcePage}`,
          group: 'vault',
          kind: 'path',
          d: layer.outline.d,
          bounds,
          fill: layer.fillToken ? template.colors.find((c) => c.id === layer.fillToken)?.value : undefined,
          stroke: layer.strokeToken ? template.colors.find((c) => c.id === layer.strokeToken)?.value : undefined,
          strokeWidth: layer.strokeWidth,
        });
      }
      if (layer.type === 'text') {
        const key = `text:${layer.defaultText}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: `vault-${template.id}-${layer.id}`,
          name: layer.defaultText,
          group: 'vault',
          kind: 'text',
          text: layer.defaultText,
          fontFamily: layer.fontFamily,
          fill: template.colors.find((c) => c.id === layer.colorToken)?.value,
        });
      }
    }
  }
  vaultCache = out;
  return out;
}

/** Ready-made text styles, as in Canva's text panel. */
export const TEXT_PRESETS: ElementDef[] = [
  { id: 'text-heading', name: 'כותרת', group: 'basic', kind: 'text', text: 'כותרת', fontFamily: "'Frank Ruhl Libre', serif", fontSize: 0.09, fontWeight: 700, fill: '#ffffff' },
  { id: 'text-subheading', name: 'כותרת משנה', group: 'basic', kind: 'text', text: 'כותרת משנה', fontFamily: "'Heebo', sans-serif", fontSize: 0.05, fontWeight: 400, fill: '#ffffff' },
  { id: 'text-body', name: 'טקסט', group: 'basic', kind: 'text', text: 'טקסט רגיל', fontFamily: "'Assistant', sans-serif", fontSize: 0.032, fontWeight: 400, fill: '#ffffff' },
  { id: 'text-script', name: 'כתב יד', group: 'basic', kind: 'text', text: 'Forever', fontFamily: "'Great Vibes', cursive", fontSize: 0.1, fontWeight: 400, fill: '#ffffff' },
  { id: 'text-hebrew-hand', name: 'כתב יד עברי', group: 'basic', kind: 'text', text: 'רגעים של אושר', fontFamily: "'Amatic SC', cursive", fontSize: 0.09, fontWeight: 700, fill: '#ffffff' },
];

export const BASIC_ELEMENTS: ElementDef[] = [
  { id: 'basic-line', name: 'קו', group: 'basic', kind: 'line', stroke: '#ffffff', strokeWidth: 0.004 },
  { id: 'basic-rect', name: 'מלבן', group: 'basic', kind: 'rect', stroke: '#ffffff', strokeWidth: 0.004 },
  { id: 'basic-ellipse', name: 'עיגול', group: 'basic', kind: 'ellipse', stroke: '#ffffff', strokeWidth: 0.004 },
];

/** A layer for `element`, centred on the right-hand page of a spread of
 *  `aspect`, above everything on it. */
export function elementToLayer(
  element: ElementDef,
  aspect: number,
  topZ: number,
  stamp: number,
): ShapeLayer | TextLayer | ImageLayer {
  const id = `el-${stamp}`;
  const zIndex = topZ + 1;
  const place = (widthHeights: number, heightHeights: number) => ({
    x: 0.75 - widthHeights / aspect / 2,
    y: 0.5 - heightHeights / 2,
    width: widthHeights / aspect,
    height: heightHeights,
  });

  if (element.kind === 'path' && element.d && element.bounds) {
    const ratio = element.bounds.width / element.bounds.height;
    const height = Math.min(0.22, 0.5 / Math.max(1, ratio));
    return {
      type: 'shape', shape: 'path', id, name: element.name, zIndex,
      box: place(height * ratio, height),
      outline: { d: element.d, fillRule: 'nonzero' },
      outlineBox: element.bounds,
      fillColor: element.fill,
      strokeColor: element.stroke,
      strokeWidth: element.strokeWidth,
    };
  }
  if (element.kind === 'text') {
    const size = element.fontSize ?? 0.06;
    return {
      type: 'text', id, name: 'טקסט', zIndex,
      box: place(Math.min(0.9, Math.max(0.25, (element.text ?? '').length * size * 0.55)), size * 1.6),
      defaultText: element.text ?? 'טקסט',
      direction: /[֐-׿]/.test(element.text ?? '') ? 'rtl' : 'ltr',
      fontFamily: element.fontFamily ?? "'Rubik', sans-serif",
      fontWeight: element.fontWeight ?? 400,
      fontSize: size,
      lineHeight: 1.2,
      align: 'center',
      verticalAlign: 'middle',
      colorToken: '',
      color: element.fill ?? '#ffffff',
    };
  }
  if (element.kind === 'image' && element.assetId) {
    const ratio = element.aspect ?? 1;
    const height = Math.min(0.3, 0.5 / Math.max(1, ratio));
    return { type: 'image', id, name: element.name, zIndex, box: place(height * ratio, height), assetId: element.assetId };
  }
  if (element.kind === 'line') {
    const box = place(0.4, 0.002);
    return {
      type: 'shape', shape: 'polyline', id, name: 'קו', zIndex, box,
      points: [[box.x, 0.5], [box.x + box.width, 0.5]],
      strokeColor: element.stroke, strokeWidth: element.strokeWidth,
    };
  }
  return {
    type: 'shape',
    shape: element.kind === 'ellipse' ? 'ellipse' : 'rect',
    id, name: element.name, zIndex,
    box: place(0.3, 0.3),
    strokeColor: element.stroke,
    strokeWidth: element.strokeWidth,
  };
}

/** SVG viewBox units per page height, shared with the renderer. */
export const ELEMENT_VIEW_HEIGHT = VIEW_HEIGHT;
