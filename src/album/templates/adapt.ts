import type { AlbumTemplate, TemplateLayer } from './types';

/* One designed page, fitted to ANY album shape.
 *
 * The background, bands, frames and lettering exist to lift the photo. So on
 * an album of another shape the PHOTO keeps the share of the spread it has in
 * the design — the crop engine re-crops it around the faces, it is never
 * distorted — and everything around it keeps its own share too:
 *
 *   · photos and colour fields keep their position and size as fractions of
 *     the spread (they may change shape; a photo is re-cropped, a band is
 *     simply a band);
 *   · lettering, lines and ellipses must keep their shape, so they scale
 *     uniformly by how much the spread narrowed, anchored to where they sit.
 *
 * Pure geometry, no React — tested in tests/albumTemplates.test.ts. */

/** SVG units per page height — shared with TemplateLayers. */
const VIEW_HEIGHT = 1000;

/** Adapt one designed page to a spread of `targetAspect` (width ÷ height). */
export function fitTemplate(template: AlbumTemplate, targetAspect: number): AlbumTemplate {
  const designed = template.nativeAspect;
  if (Math.abs(targetAspect / designed - 1) < 1e-4) return template;

  /* Heights are the unit, so only the width changed. A narrower spread shrinks
   * shapes that must not distort; a wider one leaves their size alone. */
  const scale = Math.min(1, targetAspect / designed);
  /** Vertical positions move toward the page middle with the same scale, so a
   *  title stays on the corner of its frame. */
  const scaleY = (y: number) => 0.5 + (y - 0.5) * scale;

  const layers = template.layers.map((layer): TemplateLayer => {
    if (layer.type === 'photo' || (layer.type === 'shape' && layer.shape === 'rect')) {
      return layer;
    }

    const centreX = layer.box.x + layer.box.width / 2;
    const centreY = layer.box.y + layer.box.height / 2;
    const width = (layer.box.width * designed * scale) / targetAspect;
    const height = layer.box.height * scale;
    const box = {
      x: centreX - width / 2,
      y: scaleY(centreY) - height / 2,
      width,
      height,
    };

    if (layer.type === 'text') {
      /* Outline coordinates are designed-spread view units. Map the layer's
       * centre to its new centre and scale around it. */
      const fromX = centreX * designed * VIEW_HEIGHT;
      const toX = centreX * targetAspect * VIEW_HEIGHT;
      const fromY = centreY * VIEW_HEIGHT;
      const toY = scaleY(centreY) * VIEW_HEIGHT;
      return {
        ...layer,
        box,
        fontSize: layer.fontSize * scale,
        outline: layer.outline && {
          ...layer.outline,
          transform: [scale, scale, toX - fromX * scale, toY - fromY * scale],
        },
      };
    }

    return {
      ...layer,
      box,
      strokeWidth: layer.strokeWidth === undefined ? undefined : layer.strokeWidth * scale,
      points: layer.points?.map(([px, py]) => [
        centreX + ((px - centreX) * designed * scale) / targetAspect,
        scaleY(centreY) + (py - centreY) * scale,
      ] as [number, number]),
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
