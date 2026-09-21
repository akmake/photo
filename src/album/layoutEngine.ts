import type { AlbumLayoutTemplate, AlbumPhoto, LayoutSlot } from './model';
import { assessCrop } from './cropEngine';
import { getAlbumStyle } from './styleEngine';

export interface GeneratedAlbumLayout extends AlbumLayoutTemplate {
  photoIds: string[];
  explanation: string;
  score: number;
  warnings: string[];
}

/** Information that belongs to the story around a spread, rather than to a
 * template.  Keeping it explicit prevents a visual style from silently turning
 * into a fixed 1/2/3/4-photo recipe. */
export interface AlbumLayoutContext {
  sessionStart?: boolean;
  sessionEnd?: boolean;
  spreadIndex?: number;
  spreadCount?: number;
  previousLayoutId?: string;
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

/* The original generator composed each PAGE independently. That is useful for
 * dense catalogues, but it cannot create the editorial spreads photographers
 * expect from a finished story: a cinematic opener, a quiet duet, or one hero
 * balanced by two supporting frames. These candidates use the whole spread as
 * their canvas, while still going through the same crop-safety scoring as every
 * other layout. They are deterministic, so every user gets the same quality
 * from the same ordered selection. */
function storyGeometry(
  count: number,
  variant: 'primary' | 'mirror' = 'primary',
): Array<Pick<LayoutSlot, 'x' | 'y' | 'width' | 'height' | 'role' | 'allowCrossGutter'>> {
  if (count === 1) {
    return [{ x: 0, y: 0, width: 1, height: 1, role: 'hero', allowCrossGutter: true }];
  }
  if (count === 2 && variant === 'mirror') {
    return [
      { x: 0.04, y: 0.08, width: 0.57, height: 0.84, role: 'hero', allowCrossGutter: true },
      { x: 0.65, y: 0.22, width: 0.30, height: 0.56, role: 'support' },
    ];
  }
  if (count === 2) {
    return [
      { x: 0.04, y: 0.08, width: 0.44, height: 0.84, role: 'hero' },
      { x: 0.52, y: 0.08, width: 0.44, height: 0.84, role: 'hero' },
    ];
  }
  if (count === 3 && variant === 'mirror') {
    return [
      { x: 0.04, y: 0.08, width: 0.31, height: 0.40, role: 'support' },
      { x: 0.04, y: 0.52, width: 0.31, height: 0.40, role: 'support' },
      { x: 0.39, y: 0.06, width: 0.57, height: 0.88, role: 'hero', allowCrossGutter: true },
    ];
  }
  if (count === 3) {
    return [
      { x: 0.04, y: 0.06, width: 0.57, height: 0.88, role: 'hero', allowCrossGutter: true },
      { x: 0.65, y: 0.08, width: 0.31, height: 0.40, role: 'support' },
      { x: 0.65, y: 0.52, width: 0.31, height: 0.40, role: 'support' },
    ];
  }
  if (count === 4) {
    return [
      { x: 0.025, y: 0.025, width: 0.469, height: 0.469, role: 'support' },
      { x: 0.506, y: 0.025, width: 0.469, height: 0.469, role: 'support' },
      { x: 0.025, y: 0.506, width: 0.469, height: 0.469, role: 'support' },
      { x: 0.506, y: 0.506, width: 0.469, height: 0.469, role: 'support' },
    ];
  }
  return [];
}

function buildStoryCandidate(
  photoIds: string[],
  photosById: Map<string, AlbumPhoto>,
  pageAspect: number,
  variant: 'primary' | 'mirror',
): GeneratedAlbumLayout | null {
  const geometry = storyGeometry(photoIds.length, variant);
  if (!geometry.length) return null;
  const id = photoIds.length === 1
    ? 'story-opener'
    : photoIds.length === 2
      ? variant === 'mirror' ? 'story-focus' : 'story-duet'
      : photoIds.length === 3
        ? variant === 'mirror' ? 'story-hero-right' : 'story-hero-left'
        : 'story-grid';
  const names: Record<string, string> = {
    'story-opener': 'פתיחת סיפור',
    'story-duet': 'זוג שקט',
    'story-focus': 'ראשית ומשלים',
    'story-hero-left': 'רגע מוביל משמאל',
    'story-hero-right': 'רגע מוביל מימין',
    'story-grid': 'רצף ארבע',
  };
  const slots: LayoutSlot[] = geometry.map((slot, index) => ({
    ...slot,
    id: `${id}-${index}`,
    preferred: [photosById.get(photoIds[index])?.orientation ?? 'landscape'],
  }));
  const checks = slots.map((slot, index) => {
    const photo = photosById.get(photoIds[index]);
    return photo
      ? assessCrop(photo, slot, { fit: 'smart', positionX: 50, positionY: 50 }, pageAspect * 2)
      : null;
  });
  const unsafe = checks.filter((check) => check && !check.safe).length;
  /* An intentional cross-gutter frame is allowed, a face on the fold is not.
   * Project detected face centres through the chosen smart crop into spread
   * coordinates and let the mirrored candidate win when it protects them. */
  const foldRisk = slots.some((slot, index) => {
    if (!slot.allowCrossGutter) return false;
    const photo = photosById.get(photoIds[index]);
    const crop = checks[index]?.crop;
    if (!photo || !crop) return false;
    return (photo.analysis?.faces ?? []).some((face) => {
      const faceCenter = face.x + face.width / 2;
      const inFrame = (faceCenter - crop.x) / Math.max(0.001, crop.width);
      const onSpread = slot.x + inFrame * slot.width;
      return Math.abs(onSpread - 0.5) < 0.035;
    });
  });
  const unanalyzed = photoIds.filter(
    (photoId) => photosById.get(photoId)?.analysis?.status !== 'ready',
  ).length;
  const score = Math.round(Math.max(
    0,
    Math.min(100, 99 - unsafe * 28 - unanalyzed * 0.6 - (foldRisk ? 24 : 0)),
  ));
  return {
    id,
    name: names[id],
    family: 'story',
    density: photoIds.length <= 2 ? 'airy' : 'balanced',
    photoCount: photoIds.length,
    slots,
    photoIds: [...photoIds],
    explanation: 'פריסת סיפור על הכפולה כולה, עם מוקד ברור וחיתוך מוגן פנים',
    score,
    warnings: [
      ...(unsafe ? [`${unsafe} מסגרות דורשות בדיקת חיתוך`] : []),
      ...(foldRisk ? ['פנים קרובות לקפל המרכזי'] : []),
      ...(unanalyzed ? [`${unanalyzed} תמונות ממתינות לניתוח`] : []),
    ],
  };
}

interface CuratedTemplateDefinition {
  id: string;
  name: string;
  count: number;
  slots: Array<Pick<LayoutSlot, 'x' | 'y' | 'width' | 'height' | 'role'>>;
}

const CURATED_TEMPLATES: CuratedTemplateDefinition[] = [
  {
    id: 'quiet-left', name: 'רגע שקט משמאל', count: 1,
    slots: [{ x: 0.07, y: 0.15, width: 0.38, height: 0.70, role: 'hero' }],
  },
  {
    id: 'quiet-right', name: 'רגע שקט מימין', count: 1,
    slots: [{ x: 0.55, y: 0.15, width: 0.38, height: 0.70, role: 'hero' }],
  },
  {
    id: 'one-left-high', name: 'קטנה שמאל למעלה', count: 1,
    slots: [{ x: 0.07, y: 0.08, width: 0.34, height: 0.50, role: 'hero' }],
  },
  {
    id: 'one-left-low', name: 'קטנה שמאל למטה', count: 1,
    slots: [{ x: 0.07, y: 0.42, width: 0.34, height: 0.50, role: 'hero' }],
  },
  {
    id: 'one-right-high', name: 'קטנה ימין למעלה', count: 1,
    slots: [{ x: 0.59, y: 0.08, width: 0.34, height: 0.50, role: 'hero' }],
  },
  {
    id: 'one-right-low', name: 'קטנה ימין למטה', count: 1,
    slots: [{ x: 0.59, y: 0.42, width: 0.34, height: 0.50, role: 'hero' }],
  },
  {
    id: 'one-left-page', name: 'עמוד שמאל תחום', count: 1,
    slots: [{ x: 0.04, y: 0.08, width: 0.42, height: 0.84, role: 'hero' }],
  },
  {
    id: 'one-right-page', name: 'עמוד ימין תחום', count: 1,
    slots: [{ x: 0.54, y: 0.08, width: 0.42, height: 0.84, role: 'hero' }],
  },
  {
    id: 'inset-pair', name: 'זוג תחום', count: 2,
    slots: [
      { x: 0.06, y: 0.12, width: 0.40, height: 0.76, role: 'hero' },
      { x: 0.54, y: 0.12, width: 0.40, height: 0.76, role: 'hero' },
    ],
  },
  {
    id: 'staggered-pair', name: 'זוג מדורג', count: 2,
    slots: [
      { x: 0.05, y: 0.08, width: 0.49, height: 0.68, role: 'hero' },
      { x: 0.62, y: 0.36, width: 0.32, height: 0.52, role: 'support' },
    ],
  },
  {
    id: 'pair-stack-left', name: 'זוג בשמאל', count: 2,
    slots: [
      { x: 0.07, y: 0.10, width: 0.37, height: 0.35, role: 'support' },
      { x: 0.07, y: 0.55, width: 0.37, height: 0.35, role: 'support' },
    ],
  },
  {
    id: 'pair-stack-right', name: 'זוג בימין', count: 2,
    slots: [
      { x: 0.56, y: 0.10, width: 0.37, height: 0.35, role: 'support' },
      { x: 0.56, y: 0.55, width: 0.37, height: 0.35, role: 'support' },
    ],
  },
  {
    id: 'pair-low', name: 'זוג נמוך', count: 2,
    slots: [
      { x: 0.08, y: 0.48, width: 0.36, height: 0.40, role: 'support' },
      { x: 0.56, y: 0.48, width: 0.36, height: 0.40, role: 'support' },
    ],
  },
  {
    id: 'pair-high', name: 'זוג גבוה', count: 2,
    slots: [
      { x: 0.08, y: 0.12, width: 0.36, height: 0.40, role: 'support' },
      { x: 0.56, y: 0.12, width: 0.36, height: 0.40, role: 'support' },
    ],
  },
  {
    id: 'pair-diagonal', name: 'זוג אלכסוני', count: 2,
    slots: [
      { x: 0.07, y: 0.10, width: 0.36, height: 0.52, role: 'hero' },
      { x: 0.57, y: 0.38, width: 0.36, height: 0.52, role: 'support' },
    ],
  },
  {
    id: 'pair-diagonal-reverse', name: 'זוג אלכסוני הפוך', count: 2,
    slots: [
      { x: 0.07, y: 0.38, width: 0.36, height: 0.52, role: 'support' },
      { x: 0.57, y: 0.10, width: 0.36, height: 0.52, role: 'hero' },
    ],
  },
  {
    id: 'inset-triptych', name: 'שלישייה אנכית', count: 3,
    slots: [
      { x: 0.04, y: 0.12, width: 0.28, height: 0.76, role: 'support' },
      { x: 0.36, y: 0.12, width: 0.28, height: 0.76, role: 'support' },
      { x: 0.68, y: 0.12, width: 0.28, height: 0.76, role: 'support' },
    ],
  },
  {
    id: 'quiet-three-right', name: 'שתיים ורגע מימין', count: 3,
    slots: [
      { x: 0.06, y: 0.10, width: 0.36, height: 0.35, role: 'support' },
      { x: 0.06, y: 0.55, width: 0.36, height: 0.35, role: 'support' },
      { x: 0.56, y: 0.18, width: 0.38, height: 0.64, role: 'hero' },
    ],
  },
  {
    id: 'quiet-three-left', name: 'רגע משמאל ושתיים', count: 3,
    slots: [
      { x: 0.06, y: 0.18, width: 0.38, height: 0.64, role: 'hero' },
      { x: 0.58, y: 0.10, width: 0.36, height: 0.35, role: 'support' },
      { x: 0.58, y: 0.55, width: 0.36, height: 0.35, role: 'support' },
    ],
  },
  {
    id: 'three-row-high', name: 'שלישייה עליונה', count: 3,
    slots: [
      { x: 0.06, y: 0.12, width: 0.27, height: 0.42, role: 'support' },
      { x: 0.365, y: 0.12, width: 0.27, height: 0.42, role: 'support' },
      { x: 0.67, y: 0.12, width: 0.27, height: 0.42, role: 'support' },
    ],
  },
  {
    id: 'three-row-low', name: 'שלישייה תחתונה', count: 3,
    slots: [
      { x: 0.06, y: 0.46, width: 0.27, height: 0.42, role: 'support' },
      { x: 0.365, y: 0.46, width: 0.27, height: 0.42, role: 'support' },
      { x: 0.67, y: 0.46, width: 0.27, height: 0.42, role: 'support' },
    ],
  },
  {
    id: 'three-staggered', name: 'שלישייה מדורגת', count: 3,
    slots: [
      { x: 0.05, y: 0.10, width: 0.34, height: 0.40, role: 'support' },
      { x: 0.33, y: 0.52, width: 0.34, height: 0.40, role: 'support' },
      { x: 0.61, y: 0.10, width: 0.34, height: 0.40, role: 'support' },
    ],
  },
  {
    id: 'three-left-column', name: 'עמודה משמאל וזוג', count: 3,
    slots: [
      { x: 0.06, y: 0.11, width: 0.34, height: 0.78, role: 'hero' },
      { x: 0.56, y: 0.15, width: 0.38, height: 0.30, role: 'support' },
      { x: 0.56, y: 0.55, width: 0.38, height: 0.30, role: 'support' },
    ],
  },
  {
    id: 'three-right-column', name: 'זוג ועמודה מימין', count: 3,
    slots: [
      { x: 0.06, y: 0.15, width: 0.38, height: 0.30, role: 'support' },
      { x: 0.06, y: 0.55, width: 0.38, height: 0.30, role: 'support' },
      { x: 0.60, y: 0.11, width: 0.34, height: 0.78, role: 'hero' },
    ],
  },
  {
    id: 'three-centre-focus', name: 'מוקד מרכזי', count: 3,
    slots: [
      { x: 0.06, y: 0.30, width: 0.27, height: 0.40, role: 'support' },
      { x: 0.365, y: 0.12, width: 0.27, height: 0.76, role: 'hero' },
      { x: 0.67, y: 0.30, width: 0.27, height: 0.40, role: 'support' },
    ],
  },
  {
    id: 'portrait-four', name: 'ארבעה פורטרטים', count: 4,
    slots: [
      { x: 0.04, y: 0.14, width: 0.21, height: 0.72, role: 'support' },
      { x: 0.275, y: 0.14, width: 0.21, height: 0.72, role: 'support' },
      { x: 0.515, y: 0.14, width: 0.21, height: 0.72, role: 'support' },
      { x: 0.75, y: 0.14, width: 0.21, height: 0.72, role: 'support' },
    ],
  },
  {
    id: 'hero-three-inset', name: 'מובילה ושלוש', count: 4,
    slots: [
      { x: 0.05, y: 0.10, width: 0.40, height: 0.80, role: 'hero' },
      { x: 0.56, y: 0.08, width: 0.38, height: 0.24, role: 'support' },
      { x: 0.56, y: 0.38, width: 0.38, height: 0.24, role: 'support' },
      { x: 0.56, y: 0.68, width: 0.38, height: 0.24, role: 'support' },
    ],
  },
  {
    id: 'four-row-high', name: 'ארבע עליונות', count: 4,
    slots: [
      { x: 0.05, y: 0.14, width: 0.20, height: 0.42, role: 'support' },
      { x: 0.285, y: 0.14, width: 0.20, height: 0.42, role: 'support' },
      { x: 0.515, y: 0.14, width: 0.20, height: 0.42, role: 'support' },
      { x: 0.75, y: 0.14, width: 0.20, height: 0.42, role: 'support' },
    ],
  },
  {
    id: 'four-row-low', name: 'ארבע תחתונות', count: 4,
    slots: [
      { x: 0.05, y: 0.44, width: 0.20, height: 0.42, role: 'support' },
      { x: 0.285, y: 0.44, width: 0.20, height: 0.42, role: 'support' },
      { x: 0.515, y: 0.44, width: 0.20, height: 0.42, role: 'support' },
      { x: 0.75, y: 0.44, width: 0.20, height: 0.42, role: 'support' },
    ],
  },
  {
    id: 'four-two-pages', name: 'זוג מול זוג', count: 4,
    slots: [
      { x: 0.06, y: 0.10, width: 0.38, height: 0.35, role: 'support' },
      { x: 0.06, y: 0.55, width: 0.38, height: 0.35, role: 'support' },
      { x: 0.56, y: 0.10, width: 0.38, height: 0.35, role: 'support' },
      { x: 0.56, y: 0.55, width: 0.38, height: 0.35, role: 'support' },
    ],
  },
  {
    id: 'four-corners', name: 'ארבע פינות', count: 4,
    slots: [
      { x: 0.05, y: 0.08, width: 0.30, height: 0.34, role: 'support' },
      { x: 0.05, y: 0.58, width: 0.30, height: 0.34, role: 'support' },
      { x: 0.65, y: 0.08, width: 0.30, height: 0.34, role: 'support' },
      { x: 0.65, y: 0.58, width: 0.30, height: 0.34, role: 'support' },
    ],
  },
  {
    id: 'five-editorial', name: 'חמישייה מערכתית', count: 5,
    slots: [
      { x: 0.05, y: 0.10, width: 0.40, height: 0.36, role: 'support' },
      { x: 0.05, y: 0.54, width: 0.40, height: 0.36, role: 'support' },
      { x: 0.55, y: 0.08, width: 0.40, height: 0.25, role: 'support' },
      { x: 0.55, y: 0.375, width: 0.40, height: 0.25, role: 'support' },
      { x: 0.55, y: 0.67, width: 0.40, height: 0.25, role: 'support' },
    ],
  },
  {
    id: 'five-row', name: 'חמישה ברצף', count: 5,
    slots: [
      { x: 0.035, y: 0.18, width: 0.17, height: 0.64, role: 'support' },
      { x: 0.225, y: 0.18, width: 0.17, height: 0.64, role: 'support' },
      { x: 0.415, y: 0.18, width: 0.17, height: 0.64, role: 'support' },
      { x: 0.605, y: 0.18, width: 0.17, height: 0.64, role: 'support' },
      { x: 0.795, y: 0.18, width: 0.17, height: 0.64, role: 'support' },
    ],
  },
  {
    id: 'five-hero-grid', name: 'מובילה ורביעייה', count: 5,
    slots: [
      { x: 0.05, y: 0.12, width: 0.40, height: 0.76, role: 'hero' },
      { x: 0.55, y: 0.12, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.77, y: 0.12, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.55, y: 0.54, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.77, y: 0.54, width: 0.18, height: 0.34, role: 'support' },
    ],
  },
  {
    id: 'five-hero-grid-reverse', name: 'רביעייה ומובילה', count: 5,
    slots: [
      { x: 0.05, y: 0.12, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.27, y: 0.12, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.05, y: 0.54, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.27, y: 0.54, width: 0.18, height: 0.34, role: 'support' },
      { x: 0.55, y: 0.12, width: 0.40, height: 0.76, role: 'hero' },
    ],
  },
  {
    id: 'five-centre', name: 'מוקד וחמישה', count: 5,
    slots: [
      { x: 0.05, y: 0.14, width: 0.20, height: 0.30, role: 'support' },
      { x: 0.05, y: 0.56, width: 0.20, height: 0.30, role: 'support' },
      { x: 0.32, y: 0.12, width: 0.36, height: 0.76, role: 'hero' },
      { x: 0.75, y: 0.14, width: 0.20, height: 0.30, role: 'support' },
      { x: 0.75, y: 0.56, width: 0.20, height: 0.30, role: 'support' },
    ],
  },
  {
    id: 'six-gallery', name: 'גלריית שש', count: 6,
    slots: [
      { x: 0.04, y: 0.09, width: 0.28, height: 0.37, role: 'support' },
      { x: 0.36, y: 0.09, width: 0.28, height: 0.37, role: 'support' },
      { x: 0.68, y: 0.09, width: 0.28, height: 0.37, role: 'support' },
      { x: 0.04, y: 0.54, width: 0.28, height: 0.37, role: 'support' },
      { x: 0.36, y: 0.54, width: 0.28, height: 0.37, role: 'support' },
      { x: 0.68, y: 0.54, width: 0.28, height: 0.37, role: 'support' },
    ],
  },
  {
    id: 'six-columns', name: 'שש עמודות', count: 6,
    slots: [
      { x: 0.025, y: 0.18, width: 0.14, height: 0.64, role: 'support' },
      { x: 0.187, y: 0.18, width: 0.14, height: 0.64, role: 'support' },
      { x: 0.349, y: 0.18, width: 0.14, height: 0.64, role: 'support' },
      { x: 0.511, y: 0.18, width: 0.14, height: 0.64, role: 'support' },
      { x: 0.673, y: 0.18, width: 0.14, height: 0.64, role: 'support' },
      { x: 0.835, y: 0.18, width: 0.14, height: 0.64, role: 'support' },
    ],
  },
  {
    id: 'six-two-pages', name: 'שלוש מול שלוש', count: 6,
    slots: [
      { x: 0.06, y: 0.07, width: 0.38, height: 0.25, role: 'support' },
      { x: 0.06, y: 0.375, width: 0.38, height: 0.25, role: 'support' },
      { x: 0.06, y: 0.68, width: 0.38, height: 0.25, role: 'support' },
      { x: 0.56, y: 0.07, width: 0.38, height: 0.25, role: 'support' },
      { x: 0.56, y: 0.375, width: 0.38, height: 0.25, role: 'support' },
      { x: 0.56, y: 0.68, width: 0.38, height: 0.25, role: 'support' },
    ],
  },
  {
    id: 'six-hero-five', name: 'מובילה וחמישה', count: 6,
    slots: [
      { x: 0.05, y: 0.10, width: 0.40, height: 0.80, role: 'hero' },
      { x: 0.55, y: 0.07, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.77, y: 0.07, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.55, y: 0.375, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.77, y: 0.375, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.66, y: 0.68, width: 0.18, height: 0.25, role: 'support' },
    ],
  },
  {
    id: 'six-hero-five-reverse', name: 'חמישה ומובילה', count: 6,
    slots: [
      { x: 0.16, y: 0.07, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.05, y: 0.375, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.27, y: 0.375, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.05, y: 0.68, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.27, y: 0.68, width: 0.18, height: 0.25, role: 'support' },
      { x: 0.55, y: 0.10, width: 0.40, height: 0.80, role: 'hero' },
    ],
  },
  {
    id: 'six-staggered', name: 'שש מדורגות', count: 6,
    slots: [
      { x: 0.04, y: 0.10, width: 0.27, height: 0.32, role: 'support' },
      { x: 0.365, y: 0.18, width: 0.27, height: 0.32, role: 'support' },
      { x: 0.69, y: 0.10, width: 0.27, height: 0.32, role: 'support' },
      { x: 0.04, y: 0.58, width: 0.27, height: 0.32, role: 'support' },
      { x: 0.365, y: 0.50, width: 0.27, height: 0.32, role: 'support' },
      { x: 0.69, y: 0.58, width: 0.27, height: 0.32, role: 'support' },
    ],
  },
];

function buildCuratedCandidate(
  definition: CuratedTemplateDefinition,
  photoIds: string[],
  photosById: Map<string, AlbumPhoto>,
): GeneratedAlbumLayout {
  return {
    id: definition.id,
    name: definition.name,
    family: 'curated',
    density: photoIds.length <= 2 ? 'airy' : photoIds.length >= 5 ? 'rich' : 'balanced',
    photoCount: photoIds.length,
    slots: definition.slots.map((slot, index) => ({
      ...slot,
      id: `${definition.id}-${index}`,
      preferred: [photosById.get(photoIds[index])?.orientation ?? 'landscape'],
    })),
    photoIds: [...photoIds],
    explanation: 'תבנית מערכתית תחומה עם שוליים מכוונים',
    score: 0,
    warnings: [],
  };
}

interface ContentProfile {
  count: number;
  portraitShare: number;
  landscapeShare: number;
  orientationConsistency: number;
  qualityAverage: number;
  qualityRange: number;
  firstQuality: number;
  lastQuality: number;
  strongestIndex: number;
}

function contentProfile(photoIds: string[], photosById: Map<string, AlbumPhoto>): ContentProfile {
  const selected = photoIds.map((id) => photosById.get(id)).filter((photo): photo is AlbumPhoto => Boolean(photo));
  const qualities = selected.map((photo) => photo.analysis?.qualityScore ?? 0.72);
  const orientations = selected.map((photo) => photo.orientation);
  const portraitShare = orientations.filter((value) => value === 'portrait').length / Math.max(1, selected.length);
  const landscapeShare = orientations.filter((value) => value === 'landscape').length / Math.max(1, selected.length);
  const orientationConsistency = Math.max(
    portraitShare,
    landscapeShare,
    orientations.filter((value) => value === 'square').length / Math.max(1, selected.length),
  );
  const qualityAverage = qualities.reduce((sum, value) => sum + value, 0) / Math.max(1, qualities.length);
  const strongest = qualities.length ? Math.max(...qualities) : 0.72;
  const weakest = qualities.length ? Math.min(...qualities) : 0.72;
  return {
    count: photoIds.length,
    portraitShare,
    landscapeShare,
    orientationConsistency,
    qualityAverage,
    qualityRange: strongest - weakest,
    firstQuality: qualities[0] ?? 0.72,
    lastQuality: qualities[qualities.length - 1] ?? 0.72,
    strongestIndex: Math.max(0, qualities.indexOf(strongest)),
  };
}

function contextualScore(
  candidate: GeneratedAlbumLayout,
  profile: ContentProfile,
  photosById: Map<string, AlbumPhoto>,
  pageAspect: number,
  styleName: string | undefined,
  context: AlbumLayoutContext,
): GeneratedAlbumLayout {
  const style = getAlbumStyle(styleName);
  const crops = candidate.slots.map((slot, index) => {
    const photo = photosById.get(candidate.photoIds[index]);
    return photo
      ? assessCrop(photo, slot, { fit: 'smart', positionX: 50, positionY: 50 }, pageAspect * 2)
      : null;
  });
  const unsafe = crops.filter((crop) => crop && !crop.safe).length;
  const averageRetention = crops.reduce((sum, crop) => sum + (crop?.retainedPercent ?? 100), 0)
    / Math.max(1, crops.length);
  const analyzedShare = candidate.photoIds.filter(
    (id) => photosById.get(id)?.analysis?.status === 'ready',
  ).length / Math.max(1, candidate.photoIds.length);
  const heroSlot = candidate.slots.findIndex((slot) => slot.role === 'hero');
  const heroQuality = heroSlot >= 0
    ? photosById.get(candidate.photoIds[heroSlot])?.analysis?.qualityScore ?? 0.72
    : profile.qualityAverage;

  let fit = 0;
  let reason = 'פריסה מאוזנת שמתאימה לשילוב הנוכחי';

  if (profile.count === 1) {
    if (candidate.id === 'story-opener') {
      fit += context.sessionStart ? 30 : 20;
      reason = context.sessionStart ? 'פתיחת סשן עם רגע מוביל אחד' : 'רגע יחיד שמקבל את מלוא המשקל';
    } else fit -= 8;
    if (candidate.id === 'quiet-left' || candidate.id === 'quiet-right') {
      fit += context.sessionStart ? 14 : 25;
      reason = context.sessionStart
        ? 'פתיחת סשן שקטה שאינה ממלאת את הדף'
        : 'תמונה יחידה עם שוליים ומרחב נשימה';
    }
  }

  if (profile.count === 2) {
    const hasClearHero = profile.qualityRange >= 0.09;
    if (candidate.id === 'story-focus') {
      fit += hasClearHero && profile.strongestIndex === 0 ? 24 : hasClearHero ? 4 : 10;
      reason = hasClearHero ? 'תמונה מובילה ולצדה תמונה משלימה' : 'זוג עם היררכיה עדינה';
    }
    if (candidate.id === 'story-duet') {
      fit += hasClearHero ? 9 : 23;
      reason = hasClearHero ? 'שתי תמונות קרובות במשקל' : 'שתי תמונות שוות שמספרות רגע משותף';
    }
    if (candidate.id === 'inset-pair') {
      fit += hasClearHero ? 11 : 21;
      reason = 'זוג תחום עם שוליים שווים ומשקל מאוזן';
    }
    if (candidate.id === 'staggered-pair') {
      fit += hasClearHero && profile.strongestIndex === 0 ? 22 : 9;
      reason = 'תמונה מובילה ותמונה משלימה במיקום מדורג';
    }
  }

  if (profile.count === 3) {
    if (candidate.id === 'story-hero-left') {
      fit += profile.firstQuality >= profile.lastQuality ? 25 : 8;
      reason = 'רגע מוביל ואחריו שתי תמונות תומכות';
    }
    if (candidate.id === 'story-hero-right') {
      fit += profile.lastQuality > profile.firstQuality ? 25 : 8;
      reason = 'שתי תמונות מכינות את הרגע המוביל';
    }
    if (candidate.id === 'inset-triptych') {
      fit += profile.orientationConsistency >= 0.66 ? 23 : 11;
      reason = 'שלושה פריימים עקביים מקבלים קצב שווה ותחום';
    }
    if (candidate.id === 'quiet-three-left') {
      fit += profile.strongestIndex === 0 ? 24 : 10;
      reason = 'תמונה מובילה משמאל ושתי תמונות תומכות, כולן עם שוליים';
    }
    if (candidate.id === 'quiet-three-right') {
      fit += profile.strongestIndex === 2 ? 24 : 10;
      reason = 'שתי תמונות תומכות מובילות לתמונה הראשית מימין';
    }
  }

  if (profile.count === 4 && candidate.id === 'story-grid') {
    const coherentSequence = profile.orientationConsistency >= 0.75 && profile.qualityRange <= 0.28;
    fit += coherentSequence ? 26 : 6;
    reason = coherentSequence
      ? 'רצף עקבי של ארבעה פריימים מצדיק כפולה צפופה'
      : 'ארבע תמונות בפריסה נקייה, ללא הנחת רצף חזקה';
  }
  if (profile.count === 4 && candidate.id === 'portrait-four') {
    fit += profile.portraitShare >= 0.75 ? 25 : 8;
    reason = 'ארבע תמונות אנכיות מקבלות רוחב, גובה ומרווח אחידים';
  }
  if (profile.count === 4 && candidate.id === 'hero-three-inset') {
    fit += profile.strongestIndex === 0 && profile.qualityRange >= 0.08 ? 23 : 9;
    reason = 'תמונה מובילה תחומה ושלוש תמונות משלימות';
  }
  if (profile.count === 5 && candidate.id === 'five-editorial') {
    fit += profile.orientationConsistency >= 0.6 ? 22 : 14;
    reason = 'חמישה פריימים מחולקים לשני מקצבים עם שוליים קבועים';
  }
  if (profile.count === 6 && candidate.id === 'six-gallery') {
    fit += profile.orientationConsistency >= 0.66 ? 22 : 13;
    reason = 'רצף צפוף מוצדק מקבל רשת של שש עם מרווחים אחידים';
  }

  if (candidate.id === 'portrait-rhythm') {
    fit += Math.round(profile.portraitShare * 20);
    if (profile.portraitShare >= 0.6) reason = 'רוב התמונות אנכיות ולכן נשמר להן גובה';
  }
  if (candidate.id === 'wide-rhythm') {
    fit += Math.round(profile.landscapeShare * 20);
    if (profile.landscapeShare >= 0.6) reason = 'רוב התמונות רחבות ולכן הן מקבלות קצב אופקי';
  }
  if (candidate.id === 'balanced' && profile.orientationConsistency < 0.65) fit += 12;
  if (candidate.id === 'editorial' && profile.count >= 3 && profile.orientationConsistency < 0.75) fit += 13;

  /* Style is a preference, not a density command. It can break a close tie but
   * cannot make a contextually wrong or unsafe template win. */
  const stylePreference = (style.layoutWeights[candidate.id] ?? 0) * 0.35;
  const repeatPenalty = context.previousLayoutId === candidate.id ? 12 : 0;
  const touchesEveryEdge = candidate.slots.some((slot) => (
    slot.x <= 0.001 && slot.y <= 0.001
    && slot.x + slot.width >= 0.999 && slot.y + slot.height >= 0.999
  ));
  const fullBleedPenalty = touchesEveryEdge && !context.sessionStart ? 28 : 0;
  const cropPenalty = unsafe * 34 + Math.max(0, 96 - averageRetention) * 0.45;
  const confidence = analyzedShare * 3;
  const quality = heroQuality * 8 + profile.qualityAverage * 4;
  const score = Math.round(Math.max(0, Math.min(
    100,
    48 + fit + stylePreference + confidence + quality
      - repeatPenalty - fullBleedPenalty - cropPenalty,
  )));

  return {
    ...candidate,
    score,
    explanation: reason,
    warnings: [...new Set([
      ...candidate.warnings,
      ...(unsafe && !candidate.warnings.some((warning) => warning.includes('מסגרות'))
        ? [`${unsafe} מסגרות דורשות בדיקת חיתוך`]
        : []),
    ])],
  };
}

export function buildAlbumLayoutCandidates(
  photoIds: string[],
  photos: AlbumPhoto[],
  pageAspect = 1,
  styleName?: string,
  context: AlbumLayoutContext = {},
): GeneratedAlbumLayout[] {
  const uniquePhotoIds = photoIds.filter((id, index, all) => id && all.indexOf(id) === index);
  if (!uniquePhotoIds.length) return [];

  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const storyCandidates = (['primary', 'mirror'] as const)
    .map((variant) => buildStoryCandidate(uniquePhotoIds, photosById, pageAspect, variant))
    .filter((candidate): candidate is GeneratedAlbumLayout => Boolean(candidate));
  const profile = contentProfile(uniquePhotoIds, photosById);
  const candidates = [
    ...storyCandidates,
    ...CURATED_TEMPLATES
      .filter((definition) => definition.count === uniquePhotoIds.length)
      .map((definition) => buildCuratedCandidate(definition, uniquePhotoIds, photosById)),
    ...CANDIDATES.map((definition) => (
      buildCandidate(definition, uniquePhotoIds, photosById, pageAspect, styleName)
    )),
  ].map((candidate) => contextualScore(
    candidate,
    profile,
    photosById,
    pageAspect,
    styleName,
    context,
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
  explanation: 'בחר תמונות מהמגש כדי ליצור פריסות שמתאימות אליהן',
};
