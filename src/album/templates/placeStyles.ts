import type {
  AlbumTemplate, LayerBox, PhotoLayer, PlaceStyle, ShapeLayer, TemplateLayer,
} from './types';

/* The photo tools of Canva and PowerPoint, per photo place on a spread:
 * add or remove a place, rotate, flip, round the corners, a border, a shadow,
 * and the stacking order. Everything is the spread's own change — the Vault
 * page itself never changes. Pure: tested in tests/albumTemplates.test.ts. */

const hugs = (frame: LayerBox, photo: LayerBox) => {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.012;
  return near(frame.x, photo.x) && near(frame.y, photo.y)
    && near(frame.x + frame.width, photo.x + photo.width) && near(frame.y + frame.height, photo.y + photo.height);
};

/** Places added by the photographer join the page; removed ones leave with
 *  the frame line drawn around them. */
export function withStructure(
  page: AlbumTemplate,
  added: PhotoLayer[] | undefined,
  removed: string[] | undefined,
): AlbumTemplate {
  if (!added?.length && !removed?.length) return page;
  const gone = new Set(removed ?? []);
  const goneBoxes = page.layers.filter((layer) => gone.has(layer.id)).map((layer) => layer.box);
  const layers: TemplateLayer[] = page.layers.filter((layer) => {
    if (gone.has(layer.id)) return false;
    if (layer.type === 'shape' && layer.shape === 'rect' && !layer.fillToken && layer.strokeToken) {
      return !goneBoxes.some((box) => hugs(layer.box, box));
    }
    return true;
  });
  return { ...page, layers: [...layers, ...(added ?? [])] };
}

/** Rotation, flip, corners, border, shadow and order, applied to the page. */
export function withPlaceStyles(
  page: AlbumTemplate,
  styles: Record<string, PlaceStyle> | undefined,
): AlbumTemplate {
  if (!styles || !Object.keys(styles).length) return page;
  const aspect = page.nativeAspect;
  const out: TemplateLayer[] = [];
  for (const layer of page.layers) {
    const style = layer.type === 'photo' ? styles[layer.id] : undefined;
    if (!style || layer.type !== 'photo') {
      out.push(layer);
      continue;
    }
    const photo: PhotoLayer = {
      ...layer,
      rotation: style.rotation ?? layer.rotation,
      zIndex: style.zIndex ?? layer.zIndex,
      flipX: style.flipX || undefined,
      flipY: style.flipY || undefined,
      radius: style.radius || undefined,
    };
    const { box } = photo;
    if (style.shadow) {
      const shadow: ShapeLayer = {
        type: 'shape',
        shape: 'rect',
        id: `${layer.id}-shadow`,
        name: 'צל',
        zIndex: photo.zIndex - 0.3,
        box,
        rotation: photo.rotation,
        radius: photo.radius,
        shadow: style.shadow,
      };
      out.push(shadow);
    }
    out.push(photo);
    if (style.border && style.border > 0) {
      // drawn inside the photo edge, so the photo keeps its outer size
      const inset = style.border / 2;
      const border: ShapeLayer = {
        type: 'shape',
        shape: 'rect',
        id: `${layer.id}-border`,
        name: 'מסגרת',
        zIndex: photo.zIndex + 0.3,
        box: {
          x: box.x + inset / aspect,
          y: box.y + inset,
          width: Math.max(0.001, box.width - (2 * inset) / aspect),
          height: Math.max(0.001, box.height - 2 * inset),
        },
        rotation: photo.rotation,
        radius: photo.radius ? Math.max(0, photo.radius - inset) : undefined,
        strokeColor: style.borderColor ?? '#ffffff',
        strokeWidth: style.border,
        feather: photo.feather,
        opacity: photo.opacity,
      };
      out.push(border);
    }
  }
  return { ...page, layers: out };
}

/** A new place copied from `source`, nudged so it does not hide the original. */
export function duplicatePlace(source: PhotoLayer, topZ: number, stamp: number): PhotoLayer {
  const nudge = 0.03;
  return {
    ...source,
    id: `${source.id}-copy-${stamp}`,
    zIndex: topZ + 1,
    box: {
      ...source.box,
      x: Math.min(1 - source.box.width, source.box.x + nudge / 2),
      y: Math.min(1 - source.box.height, source.box.y + nudge),
    },
    feather: undefined,
    allowCrossGutter: true,
  };
}

/** z-index that moves a layer one step or all the way, among `layers`. */
export function reorderZ(
  layers: TemplateLayer[],
  id: string,
  to: 'front' | 'forward' | 'backward' | 'back',
): number {
  const current = layers.find((layer) => layer.id === id)?.zIndex ?? 0;
  const others = layers.filter((layer) => layer.id !== id).map((layer) => layer.zIndex).sort((a, b) => a - b);
  if (!others.length) return current;
  if (to === 'front') return others[others.length - 1] + 1;
  if (to === 'back') return others[0] - 1;
  if (to === 'forward') {
    const above = others.filter((z) => z > current);
    if (!above.length) return current;
    return above.length > 1 ? (above[0] + above[1]) / 2 : above[0] + 1;
  }
  const below = others.filter((z) => z < current).reverse();
  if (!below.length) return current;
  return below.length > 1 ? (below[0] + below[1]) / 2 : below[0] - 1;
}
