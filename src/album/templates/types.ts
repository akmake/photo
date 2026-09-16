import type { FrameRole, PhotoOrientation } from '../model';

/* A designed album page, described as separate layers instead of a picture.
 *
 * The Vault (הכספת) must never be imported as background images: every photo,
 * line, colour and word on a page stays its own editable thing, so the same
 * design can carry any photographer's photos in any colours. A definition is
 * fixed library data; what a spread changes lives in SpreadTemplateInstance. */

/** Fractions of the whole spread — 0..1 on both axes, top-left origin. */
export interface LayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseLayer {
  id: string;
  name: string;
  /** Paint order. Higher paints over lower. */
  zIndex: number;
  box: LayerBox;
  opacity?: number;
  /** Degrees, clockwise, around the box centre. */
  rotation?: number;
}

/** A place for a photo. Photo layers bind to `spread.photoIds` in the order
 *  they appear in `layers`, so every existing way of placing, swapping and
 *  cropping a photo keeps working on a template page. */
export interface PhotoLayer extends BaseLayer {
  type: 'photo';
  role: FrameRole;
  preferred: PhotoOrientation[];
  /** The design deliberately runs this photo across the fold. */
  allowCrossGutter?: boolean;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  defaultText: string;
  /** Stand-in font used once the text is edited. */
  fontFamily: string;
  fontWeight: number;
  /** Fraction of the spread height. */
  fontSize: number;
  lineHeight: number;
  align: 'start' | 'center' | 'end';
  verticalAlign: 'top' | 'middle' | 'bottom';
  colorToken: string;
  /** The designer's own lettering, taken from the source as vector outlines in
   *  the template's viewBox units. Drawn — in the layer's colour — for as long
   *  as the text is unchanged, so the page matches the design exactly. */
  outline?: {
    d: string;
    fillRule: 'nonzero' | 'evenodd';
    /** [scaleX, scaleY, translateX, translateY] in viewBox units — set when the
     *  page is fitted to an album shape other than the designed one. */
    transform?: [number, number, number, number];
  };
  /** The designer's font this layer stands in for, until the source files
   *  with the real font arrive. */
  sourceFont?: string;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'polyline';
  /** polyline only — fractions of the spread, in drawing order. */
  points?: [number, number][];
  fillToken?: string;
  strokeToken?: string;
  /** Fraction of the spread height. */
  strokeWidth?: number;
}

export type TemplateLayer = PhotoLayer | TextLayer | ShapeLayer;

export interface TemplateColor {
  id: string;
  /** What the photographer sees next to the swatch. */
  label: string;
  value: string;
}

export interface AlbumTemplate {
  schemaVersion: 1;
  id: string;
  /** Bumped whenever the geometry or layers change, so a saved spread can tell
   *  it was made against an older design. */
  version: number;
  name: string;
  source: 'vault-pdf';
  sourcePage: number;
  /** Spread width ÷ height the design was drawn for — or, on a fitted copy,
   *  the album shape it was fitted to. */
  nativeAspect: number;
  photoCount: number;
  /** Token painted behind everything. */
  backgroundToken: string;
  colors: TemplateColor[];
  layers: TemplateLayer[];
}

/** One template placed on one spread, and everything this spread changed. */
export interface SpreadTemplateInstance {
  templateId: string;
  templateVersion: number;
  /** token id → colour. Colours belong to the spread, chosen for its photos. */
  colors: Record<string, string>;
  /** text layer id → text. */
  texts: Record<string, string>;
}
