import type { AlbumLayoutTemplate, AlbumPhoto, LayoutSlot } from './model';
import { assessCrop } from './cropEngine';
import { getAlbumStyle } from './styleEngine';

export interface GeneratedAlbumLayout extends AlbumLayoutTemplate {
  photoIds: string[];
  explanation: string;
  score: number;
  warnings: string[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CandidateDefinition {
  id: string;
  name: string;
  explanation: string;
  split: 'balanced' | 'hero-left' | 'hero-right';
  rowSeed: number;
  order: 'original' | 'landscape-first' | 'portrait-first';
}

function pageBoxes(pageAspect: number, margin: number): { left: Rect; right: Rect; canvasWidth: number } {
  const safeAspect = Math.max(0.58, Math.min(1.8, pageAspect));
  const xMargin = safeAspect * margin;
  return {
    left: { x: xMargin, y: margin, width: safeAspect - xMargin * 2, height: 1 - margin * 2 },
    right: { x: safeAspect + xMargin, y: margin, width: safeAspect - xMargin * 2, height: 1 - margin * 2 },
    canvasWidth: safeAspect * 2,
  };
}

const CANDIDATES: CandidateDefinition[] = [
  {
    id: 'balanced',
    name: 'סיפור מאוזן',
    explanation: 'חלוקה מאוזנת בין שני העמודים תוך שמירה על יחסי המקור',
    split: 'balanced',
    rowSeed: 0,
    order: 'original',
  },
  {
    id: 'hero-left',
    name: 'מובילה משמאל',
    explanation: 'התמונה הראשונה מקבלת עמוד מוביל ושאר הסיפור ממשיך מימין',
    split: 'hero-left',
    rowSeed: 1,
    order: 'original',
  },
  {
    id: 'hero-right',
    name: 'מובילה מימין',
    explanation: 'התמונה הראשונה מקבלת עמוד מוביל ושאר הסיפור נבנה משמאל',
    split: 'hero-right',
    rowSeed: 2,
    order: 'original',
  },
  {
    id: 'wide-rhythm',
    name: 'קצב אופקי',
    explanation: 'התמונות הרחבות מקבלות עדיפות בשורות רחבות',
    split: 'balanced',
    rowSeed: 2,
    order: 'landscape-first',
  },
  {
    id: 'portrait-rhythm',
    name: 'קצב אנכי',
    explanation: 'תמונות אנכיות מקבלות מסגרות גבוהות יותר בלי חיתוך',
    split: 'balanced',
    rowSeed: 1,
    order: 'portrait-first',
  },
  {
    id: 'editorial',
    name: 'עריכה שקטה',
    explanation: 'פחות סימטריה ויותר מרווח נשימה בין קבוצות התמונות',
    split: 'balanced',
    rowSeed: 3,
    order: 'original',
  },
];

function photoAspect(photo: AlbumPhoto | undefined): number {
  if (!photo || !photo.widthPx || !photo.heightPx) return 1.5;
  return Math.max(0.45, Math.min(2.5, photo.widthPx / photo.heightPx));
}

function orderedPhotos(
  photoIds: string[],
  photosById: Map<string, AlbumPhoto>,
  order: CandidateDefinition['order'],
): string[] {
  if (order === 'original') return [...photoIds];
  return [...photoIds].sort((a, b) => {
    const difference = photoAspect(photosById.get(b)) - photoAspect(photosById.get(a));
    return order === 'landscape-first' ? difference : -difference;
  });
}

function rowPatterns(count: number): number[][] {
  if (count <= 0) return [[]];
  if (count === 1) return [[1]];
  if (count === 2) return [[2], [1, 1]];
  if (count === 3) return [[1, 2], [2, 1], [3]];
  if (count === 4) return [[2, 2], [1, 3], [3, 1], [4]];
  if (count === 5) return [[2, 3], [3, 2], [1, 2, 2]];
  if (count === 6) return [[3, 3], [2, 2, 2], [1, 2, 3]];

  const firstRow = Math.ceil(count / 3);
  const secondRow = Math.ceil((count - firstRow) / 2);
  return [[firstRow, secondRow, count - firstRow - secondRow].filter(Boolean)];
}

function layoutRows(
  photoIds: string[],
  box: Rect,
  photosById: Map<string, AlbumPhoto>,
  seed: number,
  gap: number,
): Array<{ photoId: string; rect: Rect }> {
  if (!photoIds.length) return [];

  const patterns = rowPatterns(photoIds.length);
  const counts = patterns[seed % patterns.length];
  const rows: Array<{ ids: string[]; naturalHeight: number; ratios: number[] }> = [];
  let cursor = 0;

  counts.forEach((count) => {
    const ids = photoIds.slice(cursor, cursor + count);
    cursor += count;
    const ratios = ids.map((id) => photoAspect(photosById.get(id)));
    const naturalHeight = (box.width - gap * Math.max(0, ids.length - 1))
      / ratios.reduce((sum, ratio) => sum + ratio, 0);
    rows.push({ ids, naturalHeight, ratios });
  });

  const naturalContentHeight = rows.reduce((sum, row) => sum + row.naturalHeight, 0);
  const availableImageHeight = box.height - gap * Math.max(0, rows.length - 1);
  const scale = Math.min(1, availableImageHeight / naturalContentHeight);
  const contentHeight = naturalContentHeight * scale + gap * Math.max(0, rows.length - 1);
  let y = box.y + (box.height - contentHeight) / 2;
  const placements: Array<{ photoId: string; rect: Rect }> = [];

  rows.forEach((row) => {
    const height = row.naturalHeight * scale;
    const widths = row.ratios.map((ratio) => ratio * height);
    const rowWidth = widths.reduce((sum, width) => sum + width, 0)
      + gap * Math.max(0, widths.length - 1);
    let x = box.x + (box.width - rowWidth) / 2;

    row.ids.forEach((photoId, index) => {
      placements.push({
        photoId,
        rect: { x, y, width: widths[index], height },
      });
      x += widths[index] + gap;
    });
    y += height + gap;
  });

  return placements;
}

function layoutSingle(
  photoId: string,
  box: Rect,
  photo: AlbumPhoto | undefined,
): Array<{ photoId: string; rect: Rect }> {
  const ratio = photoAspect(photo);
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  return [{
    photoId,
    rect: {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    },
  }];
}

function splitPhotos(
  photoIds: string[],
  mode: CandidateDefinition['split'],
): { left: string[]; right: string[] } {
  if (photoIds.length === 1) {
    return mode === 'hero-right'
      ? { left: [], right: photoIds }
      : { left: photoIds, right: [] };
  }

  if (mode === 'hero-left') return { left: photoIds.slice(0, 1), right: photoIds.slice(1) };
  if (mode === 'hero-right') return { left: photoIds.slice(1), right: photoIds.slice(0, 1) };

  const leftCount = Math.ceil(photoIds.length / 2);
  return { left: photoIds.slice(0, leftCount), right: photoIds.slice(leftCount) };
}

function toSlot(
  placement: { photoId: string; rect: Rect },
  index: number,
  photosById: Map<string, AlbumPhoto>,
  largestArea: number,
  canvasWidth: number,
): LayoutSlot {
  const photo = photosById.get(placement.photoId);
  const area = placement.rect.width * placement.rect.height;
  return {
    id: `frame-${placement.photoId}-${index}`,
    x: placement.rect.x / canvasWidth,
    y: placement.rect.y,
    width: placement.rect.width / canvasWidth,
    height: placement.rect.height,
    role: area >= largestArea * 0.92 ? 'hero' : area <= largestArea * 0.48 ? 'detail' : 'support',
    preferred: [photo?.orientation ?? 'landscape'],
    allowCrossGutter: false,
  };
}

function buildCandidate(
  definition: CandidateDefinition,
  photoIds: string[],
  photosById: Map<string, AlbumPhoto>,
  pageAspect: number,
  styleName?: string,
): GeneratedAlbumLayout {
  const style = getAlbumStyle(styleName);
  const pages = pageBoxes(pageAspect, style.margin);
  const ordered = orderedPhotos(photoIds, photosById, definition.order);
  const groups = splitPhotos(ordered, definition.split);
  const left = groups.left.length === 1
    ? layoutSingle(groups.left[0], pages.left, photosById.get(groups.left[0]))
    : layoutRows(groups.left, pages.left, photosById, definition.rowSeed, style.gap);
  const right = groups.right.length === 1
    ? layoutSingle(groups.right[0], pages.right, photosById.get(groups.right[0]))
    : layoutRows(groups.right, pages.right, photosById, definition.rowSeed + 1, style.gap);
  const placements = [...left, ...right];
  const largestArea = Math.max(...placements.map(({ rect }) => rect.width * rect.height), 1);
  const slots = placements.map((placement, index) => (
    toSlot(placement, index, photosById, largestArea, pages.canvasWidth)
  ));
  const checks = slots.map((slot, index) => {
    const photo = photosById.get(placements[index].photoId);
    return photo
      ? assessCrop(photo, slot, { fit: 'smart', positionX: 50, positionY: 50 }, pages.canvasWidth)
      : null;
  });
  const unsafe = checks.filter((check) => check && !check.safe).length;
  const unanalyzed = placements.filter(
    ({ photoId }) => photosById.get(photoId)?.analysis?.status !== 'ready',
  ).length;
  const heroIndex = slots.findIndex((slot) => slot.role === 'hero');
  const heroQuality = heroIndex >= 0
    ? photosById.get(placements[heroIndex].photoId)?.analysis?.qualityScore ?? 0.72
    : 0.72;
  const leftArea = placements.filter(({ rect }) => rect.x < pageAspect)
    .reduce((sum, { rect }) => sum + rect.width * rect.height, 0);
  const rightArea = placements.filter(({ rect }) => rect.x >= pageAspect)
    .reduce((sum, { rect }) => sum + rect.width * rect.height, 0);
  const balance = 1 - Math.min(
    1,
    Math.abs(leftArea - rightArea) / Math.max(0.01, leftArea + rightArea),
  );
  const styleWeight = style.layoutWeights[definition.id] ?? 0;
  const densityPenalty = Math.abs(photoIds.length - style.densityTarget) * 1.2;
  const score = Math.round(Math.max(
    0,
    Math.min(100, 62 + balance * 14 + heroQuality * 12 + styleWeight
      - densityPenalty - unsafe * 20 - unanalyzed * 1.5),
  ));

  return {
    id: definition.id,
    name: definition.name,
    family: 'generated',
    density: photoIds.length <= 2 ? 'airy' : photoIds.length >= 7 ? 'rich' : 'balanced',
    photoCount: photoIds.length,
    slots,
    photoIds: placements.map((placement) => placement.photoId),
    explanation: definition.explanation,
    score,
    warnings: [
      ...(unsafe ? [`${unsafe} מסגרות דורשות בדיקת חיתוך`] : []),
      ...(unanalyzed ? [`${unanalyzed} תמונות ממתינות לניתוח`] : []),
    ],
  };
}

export function buildAlbumLayoutCandidates(
  photoIds: string[],
  photos: AlbumPhoto[],
  pageAspect = 1,
  styleName?: string,
): GeneratedAlbumLayout[] {
  const uniquePhotoIds = photoIds.filter((id, index, all) => id && all.indexOf(id) === index);
  if (!uniquePhotoIds.length) return [];

  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const candidates = CANDIDATES.map((definition) => (
    buildCandidate(definition, uniquePhotoIds, photosById, pageAspect, styleName)
  ));
  const signatures = new Set<string>();

  return candidates.filter((candidate) => {
    const signature = candidate.slots
      .map((slot) => [slot.x, slot.y, slot.width, slot.height].map((value) => value.toFixed(3)).join(':'))
      .join('|');
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    return true;
  }).sort((a, b) => b.score - a.score);
}

export const EMPTY_GENERATED_LAYOUT: GeneratedAlbumLayout = {
  id: 'empty',
  name: 'כפולה ריקה',
  family: 'generated',
  density: 'airy',
  photoCount: 0,
  slots: [],
  photoIds: [],
  score: 0,
  warnings: [],
  explanation: 'בחרי תמונות מהמגש כדי ליצור פריסות שמתאימות אליהן',
};
