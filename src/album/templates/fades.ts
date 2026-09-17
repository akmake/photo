import type {
  AlbumTemplate, LayerBox, PhotoFade, PhotoFeather, PhotoLayer, TemplateLayer,
} from './types';

/* How a photo fades — chosen per photo, on any page.
 *
 *   · side: which edge fades (or none);
 *   · mode: 'background' — the edge dissolves into the page, as the Vault
 *     draws it; 'blend' — the photo reaches over the neighbouring photo on that
 *     side and dissolves INTO it, so no background shows between the two;
 *   · softness: how long the transition is (50 = as designed), always on a
 *     smooth curve rather than a straight ramp;
 *   · transparency: how see-through the whole photo is.
 *
 * A frame line drawn around a fading photo fades with it, as in InDesign.
 * Pure — tested in tests/albumTemplates.test.ts. */

const SMOOTH_STEPS = 12;

/** Frame-local feather for a fade of `length` (in page heights) on `side`. */
function featherFor(side: PhotoFade['side'], length: number, box: LayerBox, aspect: number): PhotoFeather | undefined {
  if (side === 'none') return undefined;
  const across = side === 'left' || side === 'right' ? box.width * aspect : box.height;
  const share = Math.max(0.02, Math.min(1, length / Math.max(1e-6, across)));
  // opaque at `from`, transparent at `to`, in frame fractions
  const [x1, y1, x2, y2] = side === 'left' ? [share, 0.5, 0, 0.5]
    : side === 'right' ? [1 - share, 0.5, 1, 0.5]
      : side === 'top' ? [0.5, share, 0.5, 0] : [0.5, 1 - share, 0.5, 1];
  const stops = Array.from({ length: SMOOTH_STEPS + 1 }, (_, i) => {
    const t = i / SMOOTH_STEPS;
    return { offset: Number(t.toFixed(4)), opacity: Number((1 - t * t * (3 - 2 * t)).toFixed(4)) };
  });
  return { x1, y1, x2, y2, stops };
}

/** The fade the designer drew on this photo, as settings. */
export function designFade(designed: PhotoLayer | undefined): PhotoFade {
  const transparency = Math.round((1 - (designed?.opacity ?? 1)) * 100);
  const f = designed?.feather;
  if (!f) return { side: 'none', mode: 'background', softness: 50, transparency };
  const dx = f.x2 - f.x1;
  const dy = f.y2 - f.y1;
  const side: PhotoFade['side'] = Math.abs(dx) >= Math.abs(dy)
    ? (dx < 0 ? 'left' : 'right')
    : (dy < 0 ? 'top' : 'bottom');
  return { side, mode: 'background', softness: 50, transparency };
}

/** Designed fade length in page heights, or a sensible length for a photo the
 *  designer did not fade. */
function baseLength(designed: PhotoLayer | undefined, box: LayerBox, aspect: number, side: PhotoFade['side']): number {
  const f = designed?.feather;
  const across = side === 'left' || side === 'right' ? box.width * aspect : box.height;
  if (f && designed) {
    const horizontal = Math.abs(f.x2 - f.x1) >= Math.abs(f.y2 - f.y1);
    const drawn = horizontal ? Math.abs(f.x2 - f.x1) * designed.box.width * aspect : Math.abs(f.y2 - f.y1) * designed.box.height;
    if (drawn > 0.01) return drawn;
  }
  return across * 0.35;
}

function softnessFactor(softness: number): number {
  const s = Math.max(0, Math.min(100, softness));
  return s <= 50 ? 0.3 + 0.7 * (s / 50) : 1 + 1.5 * ((s - 50) / 50);
}

const hugs = (frame: LayerBox, photo: LayerBox) => {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.012;
  return near(frame.x, photo.x) && near(frame.y, photo.y)
    && near(frame.x + frame.width, photo.x + photo.width) && near(frame.y + frame.height, photo.y + photo.height);
};

/** The neighbouring photo on `side`, if any: sharing the row or column, nearest. */
function neighbour(photo: PhotoLayer, side: PhotoFade['side'], photos: PhotoLayer[]): PhotoLayer | undefined {
  const b = photo.box;
  const candidates = photos.filter((other) => other !== photo && !other.rotation).filter((other) => {
    const o = other.box;
    const rowShared = o.y < b.y + b.height && o.y + o.height > b.y;
    const columnShared = o.x < b.x + b.width && o.x + o.width > b.x;
    if (side === 'left') return rowShared && o.x + o.width / 2 < b.x;
    if (side === 'right') return rowShared && o.x + o.width / 2 > b.x + b.width;
    if (side === 'top') return columnShared && o.y + o.height / 2 < b.y;
    return columnShared && o.y + o.height / 2 > b.y + b.height;
  });
  const distance = (other: PhotoLayer) => {
    const o = other.box;
    if (side === 'left') return b.x - (o.x + o.width);
    if (side === 'right') return o.x - (b.x + b.width);
    if (side === 'top') return b.y - (o.y + o.height);
    return o.y - (b.y + b.height);
  };
  return candidates.sort((p, q) => distance(p) - distance(q))[0];
}

/**
 * Apply every photo's fade settings to a page already fitted to the album.
 * `designed` is the same page as drawn (for the designer's fade lengths).
 */
export function withFades(
  page: AlbumTemplate,
  designed: AlbumTemplate,
  fades: Record<string, PhotoFade> | undefined,
): AlbumTemplate {
  const aspect = page.nativeAspect;
  const designedById = new Map(designed.layers.map((layer) => [layer.id, layer]));
  const photos = page.layers.filter((layer): layer is PhotoLayer => layer.type === 'photo');
  const settings = new Map(photos.map((photo) => [
    photo.id,
    fades?.[photo.id] ?? designFade(designedById.get(photo.id) as PhotoLayer | undefined),
  ]));
  if (!fades || !Object.keys(fades).length) {
    // designed fades still get the smooth curve
    const smooth = photos.some((photo) => photo.feather);
    if (!smooth) return page;
  }

  const next = new Map<string, TemplateLayer>(page.layers.map((layer) => [layer.id, layer]));
  const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top', none: 'none' } as const;

  for (const photo of photos) {
    const fade = settings.get(photo.id)!;
    const designedPhoto = designedById.get(photo.id) as PhotoLayer | undefined;
    let box = photo.box;
    let zIndex = photo.zIndex;
    const length = baseLength(designedPhoto, photo.box, aspect, fade.side) * softnessFactor(fade.softness);
    let side = fade.side;

    if (fade.side !== 'none' && fade.mode === 'blend' && !photo.rotation) {
      const other = neighbour(photo, fade.side, photos);
      const otherFade = other && settings.get(other.id);
      const mutual = other && otherFade?.mode === 'blend' && otherFade.side === opposite[fade.side];
      if (other && mutual && other.zIndex > photo.zIndex) {
        side = 'none'; // the photo above does the blending; this one stays whole underneath
      } else if (other) {
        const o = other.box;
        // reach across the gap and `length` into the neighbour
        const reachX = length / aspect;
        if (fade.side === 'left') {
          const left = Math.max(o.x, o.x + o.width - reachX);
          box = { ...box, x: left, width: box.x + box.width - left };
        } else if (fade.side === 'right') {
          const right = Math.min(o.x + o.width, o.x + reachX);
          box = { ...box, width: right - box.x };
        } else if (fade.side === 'top') {
          const top = Math.max(o.y, o.y + o.height - length);
          box = { ...box, y: top, height: box.y + box.height - top };
        } else {
          const bottom = Math.min(o.y + o.height, o.y + length);
          box = { ...box, height: bottom - box.y };
        }
        if (zIndex <= other.zIndex) zIndex = other.zIndex + 0.5;
      }
    }

    const feather = featherFor(side, length, box, aspect);
    const opacity = fade.transparency > 0 ? 1 - fade.transparency / 100 : undefined;
    next.set(photo.id, { ...photo, box, zIndex, feather, opacity });

    // the frame line drawn around this photo follows it and fades with it
    if (!photo.rotation) {
      const frame = page.layers.find((layer) => layer.type === 'shape' && layer.shape === 'rect'
        && !layer.fillToken && layer.strokeToken && hugs(layer.box, photo.box));
      if (frame && frame.type === 'shape') {
        next.set(frame.id, { ...frame, box, zIndex: Math.max(frame.zIndex, zIndex + 0.25), feather, opacity });
      }
    }
  }

  return { ...page, layers: page.layers.map((layer) => next.get(layer.id)!) };
}
