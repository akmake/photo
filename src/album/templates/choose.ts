import type { AlbumPhoto } from '../model';
import { fittedTemplate } from './adapt.ts';
import { photoLayers, templatesFor } from './library.ts';
import type { AlbumTemplate } from './types';

/* Which Vault page fits a group of photos, and which photo goes where.
 *
 * The photo is the point of the page, so a page is judged by how whole its
 * photos stay: a portrait forced into a wide place loses most of itself to the
 * crop. Every page with the right number of places is fitted to the album's
 * shape, the photos are assigned to its places so the least is cropped away —
 * big places weigh more, and the strongest photo takes the largest place — and
 * a page used on the last few spreads is pushed down so the book does not
 * repeat itself. Pure: tested in tests/albumTemplates.test.ts. */

export interface TemplateChoice {
  template: AlbumTemplate;
  /** Photo ids in the order of the page's photo places. */
  photoIds: string[];
  score: number;
}

/** Most places a page in the library has. Bigger groups are split. */
export const MAX_PLACES = 10;

const RECENT_PENALTY = 0.35;
const EXHAUSTIVE_LIMIT = 6;

function aspectOf(photo: AlbumPhoto | undefined): number {
  if (!photo?.widthPx || !photo.heightPx) return 1.5;
  return photo.widthPx / photo.heightPx;
}

/** Share of a photo that survives filling a place of `placeAspect`. */
function kept(photoAspect: number, placeAspect: number): number {
  const ratio = photoAspect / placeAspect;
  return Math.min(ratio, 1 / ratio);
}

function permutations(count: number): number[][] {
  if (count <= 1) return [[0]];
  const out: number[][] = [];
  permutations(count - 1).forEach((rest) => {
    for (let at = 0; at <= rest.length; at += 1) {
      out.push([...rest.slice(0, at), count - 1, ...rest.slice(at)]);
    }
  });
  return out;
}
const PERMUTATIONS = new Map<number, number[][]>();
function allOrders(count: number): number[][] {
  if (!PERMUTATIONS.has(count)) PERMUTATIONS.set(count, permutations(count));
  return PERMUTATIONS.get(count)!;
}

/** Rank every page that can hold these photos on a spread of `spreadAspect`. */
export function rankTemplates(
  photoIds: string[],
  photos: AlbumPhoto[],
  spreadAspect: number,
  recentTemplateIds: string[] = [],
): TemplateChoice[] {
  const ids = photoIds.filter(Boolean);
  if (!ids.length) return [];
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const aspects = ids.map((id) => aspectOf(byId.get(id)));
  const quality = ids.map((id) => byId.get(id)?.analysis?.qualityScore ?? 0.7);

  return templatesFor(ids.length).map((designed) => {
    const template = fittedTemplate(designed, spreadAspect);
    const places = photoLayers(template).map((layer) => ({
      aspect: (layer.box.width * spreadAspect) / Math.max(1e-6, layer.box.height),
      area: layer.box.width * layer.box.height,
    }));
    const totalArea = places.reduce((sum, place) => sum + place.area, 0) || 1;
    const largest = places.reduce((best, place, index) => (place.area > places[best].area ? index : best), 0);
    const best = quality.reduce((top, value, index) => (value > quality[top] ? index : top), 0);

    const scoreOf = (order: number[]) => order.reduce((sum, photoIndex, placeIndex) => (
      sum + (places[placeIndex].area / totalArea) * kept(aspects[photoIndex], places[placeIndex].aspect)
    ), 0) + (order[largest] === best ? 0.03 : 0);

    let order: number[];
    if (ids.length <= EXHAUSTIVE_LIMIT) {
      order = allOrders(ids.length).reduce((top, candidate) => (
        scoreOf(candidate) > scoreOf(top) ? candidate : top
      ));
    } else {
      // biggest place first, each takes the photo that loses least in it
      const free = new Set(ids.map((_, index) => index));
      order = Array(places.length).fill(0);
      [...places.keys()]
        .sort((a, b) => places[b].area - places[a].area)
        .forEach((placeIndex) => {
          let pick = [...free][0];
          free.forEach((photoIndex) => {
            if (kept(aspects[photoIndex], places[placeIndex].aspect)
              > kept(aspects[pick], places[placeIndex].aspect)) pick = photoIndex;
          });
          order[placeIndex] = pick;
          free.delete(pick);
        });
    }

    const recent = recentTemplateIds.includes(designed.id) ? RECENT_PENALTY : 0;
    return {
      template: designed,
      photoIds: order.map((photoIndex) => ids[photoIndex]),
      score: scoreOf(order) - recent,
    };
  }).sort((a, b) => b.score - a.score || a.template.sourcePage - b.template.sourcePage);
}

/** A run of photos too long for any page, split into near-equal groups. */
export function splitForLibrary(photoIds: string[]): string[][] {
  if (photoIds.length <= MAX_PLACES) return [photoIds];
  const parts = Math.ceil(photoIds.length / MAX_PLACES);
  const size = Math.ceil(photoIds.length / parts);
  const out: string[][] = [];
  for (let start = 0; start < photoIds.length; start += size) out.push(photoIds.slice(start, start + size));
  return out;
}
