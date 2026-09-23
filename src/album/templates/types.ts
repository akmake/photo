import type { FrameRole, PhotoOrientation } from '../model';

/* A designed album page, described as separate layers instead of a picture.
 *
 * The Vault (הכספת) must never be imported as background images: every photo,
 * line, colour and word on a page stays its own editable thing, so the same
 * design can carry any photographer's photos in any colours. A definition is
 * fixed library data; what a spread changes lives in SpreadTemplateInstance.
 * The library itself is generated from the InDesign source by
 * tools/album_templates/idml_to_templates.py. */

/** Fractions of the whole spread — 0..1 on both axes, top-left origin. */
export interface LayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Vector artwork in viewBox units: page height = 1000, width = 1000 × aspect. */
export interface LayerOutline {
  d: string;
  fillRule: 'nonzero' | 'evenodd';
  /** [scaleX, scaleY, translateX, translateY] in viewBox units — set when the
   *  page is fitted to an album shape other than the designed one. */
  transform?: [number, number, number, number];
}

interface BaseLayer {
  id: string;
  name: string;
  /** Paint order. Higher paints over lower. */
  zIndex: number;
  box: LayerBox;
  opacity?: number;
  /** CSS mix-blend-mode, e.g. 'soft-light'. */
  blendMode?: string;
  /** Degrees, clockwise, around the box centre. */
  rotation?: number;
}

/** The photo fades out along a line, as InDesign's gradient feather. Points
 *  and stops are fractions of the photo frame. */
export interface PhotoFeather {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: { offset: number; opacity: number }[];
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
  feather?: PhotoFeather;
  flipX?: boolean;
  flipY?: boolean;
  /** Corner radius, in spread heights. */
  radius?: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  defaultText: string;
  direction?: 'rtl' | 'ltr';
  /** Stand-in font until the designer's font file is added. */
  fontFamily: string;
  fontWeight: number;
  /** Canva-style character controls for text the photographer adds. */
  italic?: boolean;
  underline?: boolean;
  strikeThrough?: boolean;
  /** Em units, so tracking scales with the selected type size. */
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  effect?: 'none' | 'shadow' | 'outline' | 'lift';
  animation?: 'none' | 'fade' | 'rise' | 'typewriter';
  /** Fraction of the spread height. */
  fontSize: number;
  lineHeight: number;
  align: 'start' | 'center' | 'end';
  verticalAlign: 'top' | 'middle' | 'bottom';
  colorToken: string;
  /** The designer's own lettering as vector outlines, drawn — in the layer's
   *  colour — for as long as the text is unchanged. */
  outline?: LayerOutline;
  /** The designer's font this layer stands in for. */
  sourceFont?: string;
  /** A literal colour, for text the photographer added. */
  color?: string;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'polyline' | 'path';
  /** polyline only — fractions of the spread, in drawing order. */
  points?: [number, number][];
  /** path only. */
  outline?: LayerOutline;
  fillToken?: string;
  strokeToken?: string;
  /** Fraction of the spread height. */
  strokeWidth?: number;
  /** A frame line around a fading photo fades with it. */
  feather?: PhotoFeather;
  /** rect only — corner radius, in spread heights. */
  radius?: number;
  /** Literal colours, for shapes the photographer added (not page colours). */
  strokeColor?: string;
  fillColor?: string;
  /** path only, on added elements — the artwork's own bounds in its source
   *  viewBox units; the artwork is scaled to fill ox without distortion. */
  outlineBox?: { x: number; y: number; width: number; height: number };
  /** rect only — a soft drop shadow, 0–100. */
  shadow?: number;
}

/** A picture element the photographer imported (a transparent PNG, SVG…). */
export interface ImageLayer extends BaseLayer {
  type: 'image';
  /** Id in the element library (elementStore.ts). */
  assetId: string;
}

export type TemplateLayer = PhotoLayer | TextLayer | ShapeLayer | ImageLayer;

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
  source: 'vault-pdf' | 'vault-idml';
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
  /** photo place id → where the photographer dragged or resized it, as
   *  fractions of this spread. Absent = as designed. */
  places?: Record<string, LayerBox>;
  /** photo place id → how that photo fades. Absent = as designed. */
  fades?: Record<string, PhotoFade>;
  /** photo place id → rotation, flip, corners, border, shadow, order. */
  styles?: Record<string, PlaceStyle>;
  /** Photo places the photographer added to this spread. */
  addedPlaces?: PhotoLayer[];
  /** Designed photo places the photographer removed from this spread. */
  removedPlaces?: string[];
  /** Elements the photographer added: text, shapes, Vault artwork, imports. */
  addedLayers?: Array<ShapeLayer | TextLayer | ImageLayer>;
}

/** The photographer's styling of one photo place — see placeStyles.ts. */
export interface PlaceStyle {
  /** Degrees, clockwise. */
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Corner radius, in spread heights. */
  radius?: number;
  /** Border width, in spread heights. */
  border?: number;
  borderColor?: string;
  /** 0–100. */
  shadow?: number;
  zIndex?: number;
}

/** How one photo fades — see fades.ts. */
export interface PhotoFade {
  side: 'none' | 'left' | 'right' | 'top' | 'bottom';
  /** 'background' dissolves into the page; 'blend' reaches over the neighbouring
   *  photo on that side and dissolves into it. */
  mode: 'background' | 'blend';
  /** 0–100; 50 is the designed length. */
  softness: number;
  /** 0 (solid) – 100 (invisible). */
  transparency: number;
}
