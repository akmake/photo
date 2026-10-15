import { assessCrop, type CropAssessment } from './cropEngine';
import type {
  AlbumPhoto, AlbumProject, AlbumSpread, LayoutSlot, NormalizedBox, PrintProductProfile,
} from './model';
import type { PreflightIssue } from './preflightEngine';
import type { AlbumTemplate, TextLayer } from './templates/types';
import { paintOrder, textOf } from './templates/library';
import { labOffersSize, labSpecOf } from './labs';

/* WHAT LOOKS WRONG ON PAPER, checked against the lab's own millimetres.
 * Research: docs/RESEARCH-album-print-export.md §1, §2, §13.
 *
 * The existing check (preflightEngine.ts) asks whether the FILE is sound:
 * resolution, a missing photo, a frame across the fold. These ask what the
 * printed book does to it: the lab's blade, the crease, the endpaper glued to
 * the cover. Every issue carries the box it is about, in fractions of the
 * sheet, so the screen can draw a hairline round it — never a fill. */

const pageRange = (spread: AlbumSpread) => `עמודים ${spread.pageStart}–${spread.pageStart + 1}`;

/** Where a photo's faces land on the sheet, in fractions of the sheet. Only
 *  the part of each face that the frame shows. Rotation is ignored: a tilted
 *  collage photo is a designed exception, not a face near a fold. */
export function facesOnSheet(
  photo: AlbumPhoto,
  slot: LayoutSlot,
  crop: CropAssessment,
  sheetAspect: number,
): NormalizedBox[] {
  const faces = photo.analysis?.faces ?? [];
  if (!faces.length) return [];
  let drawn = { x: slot.x, y: slot.y, width: slot.width, height: slot.height };
  let window = crop.crop;
  if (crop.fit === 'contain') {
    const frameAspect = (slot.width / Math.max(0.0001, slot.height)) * sheetAspect;
    const sourceAspect = photo.widthPx / Math.max(1, photo.heightPx);
    if (sourceAspect > frameAspect) {
      const height = slot.height * (frameAspect / sourceAspect);
      drawn = { ...drawn, y: slot.y + (slot.height - height) / 2, height };
    } else {
      const width = slot.width * (sourceAspect / frameAspect);
      drawn = { ...drawn, x: slot.x + (slot.width - width) / 2, width };
    }
    window = { x: 0, y: 0, width: 1, height: 1 };
  }
  const out: NormalizedBox[] = [];
  for (const face of faces) {
    const x0 = drawn.x + ((face.x - window.x) / window.width) * drawn.width;
    const y0 = drawn.y + ((face.y - window.y) / window.height) * drawn.height;
    const x1 = x0 + (face.width / window.width) * drawn.width;
    const y1 = y0 + (face.height / window.height) * drawn.height;
    const cx0 = Math.max(x0, slot.x);
    const cy0 = Math.max(y0, slot.y);
    const cx1 = Math.min(x1, slot.x + slot.width);
    const cy1 = Math.min(y1, slot.y + slot.height);
    /* Less than a fifth of the face in view is a face the crop already
     * removed; the crop check speaks for that one. */
    const shown = ((cx1 - cx0) * (cy1 - cy0)) / Math.max(1e-6, (x1 - x0) * (y1 - y0));
    if (cx1 > cx0 && cy1 > cy0 && shown >= 0.2) {
      out.push({ x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 });
    }
  }
  return out;
}

/** The distance, in mm, from a box to the nearest OUTER edge of the sheet. */
function edgeDistanceMm(box: NormalizedBox, widthMm: number, heightMm: number): number {
  return Math.min(
    box.x * widthMm,
    (1 - box.x - box.width) * widthMm,
    box.y * heightMm,
    (1 - box.y - box.height) * heightMm,
  );
}

/** A frame's gaps to the four outer edges, in mm. */
function frameGapsMm(slot: LayoutSlot, widthMm: number, heightMm: number): number[] {
  return [
    slot.x * widthMm,
    (1 - slot.x - slot.width) * widthMm,
    slot.y * heightMm,
    (1 - slot.y - slot.height) * heightMm,
  ];
}

/** The half of a spread that, in a book opening on a single page, is glued to
 *  the inside of the cover. A Hebrew book opens with its spine on the right:
 *  the first page is the LEFT half, the last page the RIGHT half. */
export function endpaperHalf(
  profile: PrintProductProfile,
  direction: 'rtl' | 'ltr',
  position: 'first' | 'last',
): 'left' | 'right' | null {
  const single = position === 'first' ? profile.startsWith : profile.endsWith;
  if (single !== 'page') return null;
  if (direction === 'rtl') return position === 'first' ? 'right' : 'left';
  return position === 'first' ? 'left' : 'right';
}

interface SheetInput {
  spread: AlbumSpread;
  slots: LayoutSlot[];
  photoIds: string[];
  photoMap: Map<string, AlbumPhoto>;
  template: AlbumTemplate | null;
  profile: PrintProductProfile;
  direction: 'rtl' | 'ltr';
  position: 'first' | 'last' | 'middle' | 'only';
}

export function sheetChecks(input: SheetInput): PreflightIssue[] {
  const { spread, slots, photoIds, photoMap, template, profile, direction } = input;
  const issues: PreflightIssue[] = [];
  const widthMm = profile.spreadWidthMm;
  const heightMm = profile.spreadHeightMm;
  const aspect = widthMm / Math.max(1, heightMm);
  const trim = profile.trimInsideMm ?? 0;
  const safe = profile.safeMarginMm;
  const foldHalf = profile.gutterRiskMm / Math.max(1, widthMm);

  slots.forEach((slot, index) => {
    const photo = photoMap.get(photoIds[index] ?? '');
    if (!photo) return;
    const crop = assessCrop(photo, slot, spread.frameSettings?.[slot.id], aspect);
    facesOnSheet(photo, slot, crop, aspect).forEach((face, faceIndex) => {
      const crossesCentre = face.x < 0.5 && face.x + face.width > 0.5;
      const inBand = face.x < 0.5 + foldHalf && face.x + face.width > 0.5 - foldHalf;
      if (inBand) {
        issues.push({
          id: `face-fold-${spread.id}-${index}-${faceIndex}`,
          severity: crossesCentre ? 'blocker' : 'warning',
          code: crossesCentre ? 'FACE_ON_FOLD' : 'FACE_NEAR_FOLD',
          title: crossesCentre ? 'פנים על קו הקיפול' : 'פנים קרובות לקיפול',
          detail: `${photo.name} · ${pageRange(spread)} · קו הקיפול עובר ${crossesCentre ? 'דרך הפנים' : `פחות מ-${profile.gutterRiskMm} מ״מ מהפנים`} ונראה על הנייר.`,
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
          box: face,
        });
      }
      const distance = edgeDistanceMm(face, widthMm, heightMm);
      if (distance < safe) {
        const cut = distance < trim;
        issues.push({
          id: `face-edge-${spread.id}-${index}-${faceIndex}`,
          severity: cut ? 'blocker' : 'warning',
          code: cut ? 'FACE_IN_TRIM' : 'FACE_NEAR_EDGE',
          title: cut ? 'פנים בתוך אזור החיתוך' : 'פנים קרובות לקצה',
          detail: cut
            ? `${photo.name} · ${pageRange(spread)} · המעבדה חותכת ${trim} מ״מ מהקצה, והפנים ${Math.max(0, distance).toFixed(1)} מ״מ ממנו.`
            : `${photo.name} · ${pageRange(spread)} · ${Math.max(0, distance).toFixed(1)} מ״מ מהקצה; האזור הבטוח הוא ${safe} מ״מ.`,
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
          box: face,
        });
      }
    });

    /* A frame that ALMOST meets the edge. After the blade drifts a millimetre
     * the strip of paper beside it is visibly uneven — it reads as a mistake,
     * not as a margin. Either touch the edge or stand clearly away from it. */
    const nearLimit = Math.max(3, trim + 3);
    const near = frameGapsMm(slot, widthMm, heightMm)
      .filter((gap) => gap > 0.3 && gap < nearLimit);
    if (near.length) {
      issues.push({
        id: `frame-near-edge-${spread.id}-${index}`,
        severity: 'warning',
        code: 'FRAME_NEAR_EDGE',
        title: 'מסגרת כמעט נוגעת בקצה',
        detail: `${pageRange(spread)}, מסגרת ${index + 1} · ${Math.min(...near).toFixed(1)} מ״מ מהקצה. אחרי החיתוך הפס ייראה לא אחיד — להצמיד לקצה או להרחיק ל-${nearLimit} מ״מ ומעלה.`,
        spreadId: spread.id,
        photoId: photo.id,
        target: 'spread',
        box: { x: slot.x, y: slot.y, width: slot.width, height: slot.height },
      });
    }
  });

  /* Words: never in the lab's cut, never in the crease. */
  if (template && spread.templateInstance) {
    const instance = spread.templateInstance;
    const texts = [
      ...paintOrder(template).filter((layer): layer is TextLayer => layer.type === 'text'),
      ...(instance.addedLayers ?? []).filter((layer): layer is TextLayer => layer.type === 'text'),
    ];
    texts.forEach((layer) => {
      if (!textOf(instance, layer).trim()) return;
      const box = layer.box;
      const distance = edgeDistanceMm(box, widthMm, heightMm);
      const onFold = box.x < 0.5 + foldHalf && box.x + box.width > 0.5 - foldHalf;
      if (distance < safe || onFold) {
        issues.push({
          id: `text-${spread.id}-${layer.id}`,
          severity: distance < trim ? 'blocker' : 'warning',
          code: onFold ? 'TEXT_ON_FOLD' : 'TEXT_NEAR_EDGE',
          title: onFold ? 'טקסט על הקיפול' : 'טקסט מחוץ לאזור הבטוח',
          detail: `${pageRange(spread)} · "${textOf(instance, layer).slice(0, 30)}" · ${onFold ? 'הקיפול עובר דרך הטקסט' : `${Math.max(0, distance).toFixed(1)} מ״מ מהקצה; האזור הבטוח ${safe} מ״מ`}.`,
          spreadId: spread.id,
          target: 'spread',
          box,
        });
      }
    });
  }

  /* The endpaper: in a book that opens on a single page, half of the first
   * spread (and of the last) is glued to the cover and never seen. */
  (['first', 'last'] as const).forEach((position) => {
    if (input.position !== position && input.position !== 'only') return;
    const half = endpaperHalf(profile, direction, position);
    if (!half) return;
    const used = slots.some((slot, index) => {
      if (!photoIds[index]) return false;
      return half === 'left' ? slot.x < 0.48 : slot.x + slot.width > 0.52;
    });
    if (used) {
      issues.push({
        id: `endpaper-${position}-${spread.id}`,
        severity: 'blocker',
        code: 'ENDPAPER_USED',
        title: position === 'first' ? 'תמונה על דף הפתיחה המודבק' : 'תמונה על דף הסיום המודבק',
        detail: `האלבום ${position === 'first' ? 'נפתח' : 'נסגר'} בעמוד בודד: החצי ה${half === 'left' ? 'שמאלי' : 'ימני'} של ${pageRange(spread)} מודבק לכריכה ולא ייראה.`,
        spreadId: spread.id,
        target: 'spread',
        box: { x: half === 'left' ? 0 : 0.5, y: 0, width: 0.5, height: 1 },
      });
    }
  });

  return issues;
}

/** What only the whole book can say. */
export function albumChecks(
  project: AlbumProject,
  profile: PrintProductProfile,
  placed: Array<{ spread: AlbumSpread; photoIds: string[] }>,
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const spec = labSpecOf(profile);

  if (spec && labOffersSize(spec, profile) === false) {
    issues.push({
      id: 'lab-size-not-offered',
      severity: 'blocker',
      code: 'LAB_SIZE_NOT_OFFERED',
      title: `${spec.labName} לא מציעה את הגודל הזה`,
      detail: `${profile.spreadHeightMm / 10}×${profile.spreadWidthMm / 10} ס״מ (גובה × כפולה פתוחה). הגדלים שלה: ${spec.sizesCm.map((size) => `${size.heightCm}×${size.openWidthCm}`).join(' · ')}.`,
      target: 'profile',
    });
  }

  const pages = project.spreads.length * 2;
  if (spec?.maxPages && pages > spec.maxPages) {
    issues.push({
      id: 'lab-too-many-pages',
      severity: 'blocker',
      code: 'LAB_TOO_MANY_PAGES',
      title: `יותר מדי עמודים · ${pages} מתוך ${spec.maxPages}`,
      detail: `${spec.labName} · ${spec.productName} עד ${spec.maxPages} עמודים (${spec.maxPages / 2} כפולות).`,
      target: 'profile',
    });
  }

  /* The same photograph twice in one book is almost always a slip. */
  const seen = new Map<string, AlbumSpread[]>();
  placed.forEach(({ spread, photoIds }) => {
    new Set(photoIds.filter(Boolean)).forEach((photoId) => {
      seen.set(photoId, [...(seen.get(photoId) ?? []), spread]);
    });
    const counts = photoIds.filter(Boolean).reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    Object.entries(counts).filter(([, count]) => count > 1).forEach(([photoId]) => {
      issues.push({
        id: `duplicate-in-${spread.id}-${photoId}`,
        severity: 'warning',
        code: 'DUPLICATE_IN_SPREAD',
        title: 'אותה תמונה פעמיים באותה כפולה',
        detail: pageRange(spread),
        spreadId: spread.id,
        photoId,
        target: 'spread',
      });
    });
  });
  seen.forEach((spreads, photoId) => {
    if (spreads.length < 2) return;
    issues.push({
      id: `duplicate-${photoId}`,
      severity: 'warning',
      code: 'DUPLICATE_PHOTO',
      title: 'אותה תמונה מופיעה בכמה כפולות',
      detail: spreads.map(pageRange).join(' · '),
      spreadId: spreads[1].id,
      photoId,
      target: 'spread',
    });
  });

  /* Density — Queensberry's published ceiling for a wedding album is six a
   * spread on average; a family or portrait album breathes at two or three. */
  const filled = placed.filter(({ photoIds }) => photoIds.some(Boolean));
  if (filled.length) {
    const average = filled.reduce((sum, { photoIds }) => sum + photoIds.filter(Boolean).length, 0)
      / filled.length;
    if (average > 6) {
      issues.push({
        id: 'density-high',
        severity: 'info',
        code: 'DENSITY_HIGH',
        title: `צפוף · ${average.toFixed(1)} תמונות לכפולה בממוצע`,
        detail: 'במעבדות המקצועיות הממוצע לאלבום חתונה הוא עד 6 לכפולה, ולמשפחה 2–3. אפשר להוסיף כפולות במקום לדחוס.',
        target: 'spread',
        spreadId: filled[0].spread.id,
      });
    }
  }

  return issues;
}
