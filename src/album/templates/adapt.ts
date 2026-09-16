import type { AlbumTemplate, LayerBox, TemplateLayer } from './types';

/* One designed page, fitted to ANY album shape — never stretched.
 *
 * The Vault is the whole library, so a page drawn for a 56×21 spread must also
 * be right on 50×25, 60×30, or any other book. Everything is measured in units
 * of the page HEIGHT, so only the width changes between albums. Each page of
 * the spread (left of the fold, right of the fold) is fitted on its own, which
 * keeps every element on the page it was designed for:
 *
 *   · a stretch of the page covered by decoration (a colour band, a title, a
 *     frame) keeps its real width — the design keeps its proportions;
 *   · a stretch holding only a photo, or empty paper, absorbs the difference —
 *     the photo is re-cropped by the crop engine, never distorted;
 *   · when the page is so narrow that the photo would shrink below MIN_FLEX of
 *     its designed width, the decoration shrinks too, UNIFORMLY (title, lines
 *     and lettering keep their shape), centred on the page's vertical middle.
 *
 * Pure geometry, no React — tested in tests/albumTemplates.test.ts. */

/** The least share of its designed width a photo or empty stretch keeps. */
const MIN_FLEX = 0.3;
/** A layer this wide is a page-wide field of colour: it simply follows the spread. */
const FULL_SPAN = 0.98;
const EPS = 1e-6;
/** SVG units per page height — shared with TemplateLayers. */
const VIEW_HEIGHT = 1000;

interface PageFit {
  /** Breakpoints in the designed page, height units, 0..designed page width. */
  from: number[];
  /** The same breakpoints in the target page. */
  to: number[];
  /** Uniform scale for decoration on this page (≤ 1). */
  scale: number;
}

const heightUnits = (fraction: number, aspect: number) => fraction * aspect;

function isFixed(layer: TemplateLayer): boolean {
  return layer.type !== 'photo' && layer.box.width < FULL_SPAN;
}

function fitPage(template: AlbumTemplate, page: 0 | 1, targetAspect: number): PageFit {
  const designedPage = template.nativeAspect / 2;
  const targetPage = targetAspect / 2;
  const offset = page * designedPage;
  const local = (fraction: number) => Math.min(
    designedPage,
    Math.max(0, heightUnits(fraction, template.nativeAspect) - offset),
  );

  const edges = [0, designedPage];
  template.layers.forEach((layer) => {
    edges.push(local(layer.box.x), local(layer.box.x + layer.box.width));
  });
  const from = edges
    .sort((a, b) => a - b)
    .filter((value, index, all) => index === 0 || value - all[index - 1] > EPS);

  const fixed = template.layers.filter(isFixed).map((layer) => [
    local(layer.box.x), local(layer.box.x + layer.box.width),
  ]);
  const intervals = from.slice(1).map((end, index) => {
    const start = from[index];
    const middle = (start + end) / 2;
    return {
      length: end - start,
      fixed: fixed.some(([a, b]) => a < middle && middle < b),
    };
  });
  const fixedTotal = intervals.filter((i) => i.fixed).reduce((sum, i) => sum + i.length, 0);
  const flexTotal = intervals.filter((i) => !i.fixed).reduce((sum, i) => sum + i.length, 0);

  let fixedScale: number;
  let flexScale: number;
  if (flexTotal < EPS) {
    fixedScale = targetPage / Math.max(EPS, fixedTotal);
    flexScale = 0;
  } else if (fixedTotal + MIN_FLEX * flexTotal <= targetPage + EPS) {
    fixedScale = 1;
    flexScale = (targetPage - fixedTotal) / flexTotal;
  } else {
    fixedScale = targetPage / (fixedTotal + MIN_FLEX * flexTotal);
    flexScale = MIN_FLEX * fixedScale;
  }

  const to = [0];
  intervals.forEach((interval) => {
    to.push(to[to.length - 1] + interval.length * (interval.fixed ? fixedScale : flexScale));
  });
  return { from, to, scale: Math.min(1, fixedScale) };
}

function mapLocal(fit: PageFit, value: number): number {
  const { from, to } = fit;
  if (value <= from[0]) return to[0];
  for (let i = 1; i < from.length; i += 1) {
    if (value <= from[i] + EPS) {
      const span = from[i] - from[i - 1];
      const t = span < EPS ? 0 : (value - from[i - 1]) / span;
      return to[i - 1] + t * (to[i] - to[i - 1]);
    }
  }
  return to[to.length - 1];
}

/** Adapt one designed page to a spread of `targetAspect` (width ÷ height). */
export function fitTemplate(template: AlbumTemplate, targetAspect: number): AlbumTemplate {
  const designed = template.nativeAspect;
  if (Math.abs(targetAspect / designed - 1) < 1e-4) return template;

  const fits = [fitPage(template, 0, targetAspect), fitPage(template, 1, targetAspect)] as const;
  const designedPage = designed / 2;
  const targetPage = targetAspect / 2;

  /** Page of a point, given in height units of the designed spread. */
  const pageOf = (h: number): 0 | 1 => (h < designedPage ? 0 : 1);
  /** Designed spread (height units) → target spread (height units). */
  const mapH = (h: number, page: 0 | 1 = pageOf(h - EPS)) => (
    page * targetPage + mapLocal(fits[page], h - page * designedPage)
  );
  /** Scale a vertical fraction about the page's middle. */
  const scaleY = (y: number, scale: number) => 0.5 + (y - 0.5) * scale;

  const layers = template.layers.map((layer): TemplateLayer => {
    const x0 = heightUnits(layer.box.x, designed);
    const x1 = heightUnits(layer.box.x + layer.box.width, designed);
    const page = pageOf((x0 + x1) / 2);
    const scale = fits[page].scale;

    if (layer.type === 'photo' || (layer.type === 'shape' && layer.shape === 'rect')) {
      if (layer.box.width >= FULL_SPAN) return layer;
      const left = mapH(x0, pageOf(x0 + EPS));
      const right = mapH(x1, pageOf(x1 - EPS));
      const box: LayerBox = { ...layer.box, x: left / targetAspect, width: (right - left) / targetAspect };
      if (layer.type === 'shape' && scale < 1) {
        const top = layer.box.y <= EPS ? 0 : scaleY(layer.box.y, scale);
        const bottom = layer.box.y + layer.box.height >= 1 - EPS
          ? 1
          : scaleY(layer.box.y + layer.box.height, scale);
        box.y = top;
        box.height = bottom - top;
      }
      return { ...layer, box };
    }

    /* Lettering, lines and ellipses keep their shape: anchor the left edge
     * where the page fit puts it, then scale uniformly. */
    const left = mapH(x0, pageOf(x0 + EPS));
    const box: LayerBox = {
      x: left / targetAspect,
      y: scaleY(layer.box.y, scale),
      width: ((x1 - x0) * scale) / targetAspect,
      height: layer.box.height * scale,
    };
    const moveX = (fraction: number) => (
      left + (heightUnits(fraction, designed) - x0) * scale
    ) / targetAspect;

    if (layer.type === 'text') {
      return {
        ...layer,
        box,
        fontSize: layer.fontSize * scale,
        outline: layer.outline && {
          ...layer.outline,
          transform: [
            scale,
            scale,
            VIEW_HEIGHT * (left - x0 * scale),
            (VIEW_HEIGHT / 2) * (1 - scale),
          ],
        },
      };
    }
    return {
      ...layer,
      box,
      strokeWidth: layer.strokeWidth === undefined ? undefined : layer.strokeWidth * scale,
      points: layer.points?.map(([px, py]) => [moveX(px), scaleY(py, scale)] as [number, number]),
    };
  });

  return { ...template, nativeAspect: targetAspect, layers };
}

const cache = new WeakMap<AlbumTemplate, Map<number, AlbumTemplate>>();

/** `fitTemplate`, remembered per template and album shape — every thumbnail
 *  of an album asks for the same few fits. */
export function fittedTemplate(template: AlbumTemplate, targetAspect: number): AlbumTemplate {
  const key = Math.round(targetAspect * 10000);
  let byAspect = cache.get(template);
  if (!byAspect) {
    byAspect = new Map();
    cache.set(template, byAspect);
  }
  let fitted = byAspect.get(key);
  if (!fitted) {
    fitted = fitTemplate(template, targetAspect);
    byAspect.set(key, fitted);
  }
  return fitted;
}
