import type { AlbumPhoto, LayoutSlot, NormalizedBox, PhotoFrameSettings } from './model';

export interface CropAssessment {
  fit: 'contain' | 'cover';
  positionX: number;
  positionY: number;
  crop: NormalizedBox;
  safe: boolean;
  retainedPercent: number;
  warnings: string[];
  /** The photo does not reach every edge of the frame, so the page shows through. */
  letterboxed: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function intersectionRatio(box: NormalizedBox, crop: NormalizedBox): number {
  const x0 = Math.max(box.x, crop.x);
  const y0 = Math.max(box.y, crop.y);
  const x1 = Math.min(box.x + box.width, crop.x + crop.width);
  const y1 = Math.min(box.y + box.height, crop.y + crop.height);
  const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return overlap / Math.max(0.000001, box.width * box.height);
}

function unionBox(boxes: NormalizedBox[]): NormalizedBox | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/* Slide a crop window of `size` along one axis so it holds [tMin, tMax] — the
 * faces we must not cut — preferring to sit centred on `preferred`.
 *
 * When the target is LARGER than the window there is nothing to save by
 * sliding, so the preferred centre wins and the caller's warning does the rest. */
function placeWindow(size: number, tMin: number, tMax: number, preferred: number): number {
  const limit = Math.max(0, 1 - size);
  let lo = 0;
  let hi = limit;
  const needLo = tMax - size; // any earlier and the target's far edge falls out
  const needHi = tMin; //        any later and the target's near edge falls out
  if (needLo <= needHi) {
    lo = clamp(needLo, 0, limit);
    hi = clamp(needHi, 0, limit);
    if (lo > hi) {
      lo = 0;
      hi = limit;
    }
  }
  return clamp(preferred - size / 2, lo, hi);
}

export function assessCrop(
  photo: AlbumPhoto,
  slot: LayoutSlot,
  settings?: PhotoFrameSettings,
  spreadAspect = 2,
): CropAssessment {
  const sourceAspect = Math.max(0.01, photo.widthPx / Math.max(1, photo.heightPx));
  const frameAspect = Math.max(
    0.01,
    slot.width / Math.max(0.001, slot.height) * spreadAspect,
  );
  const requestedFit = settings?.fit ?? 'smart';
  const faces = photo.analysis?.faces ?? [];
  const subject = photo.analysis?.subject;
  const analyzed = photo.analysis?.status === 'ready';

  if (requestedFit === 'contain') {
    return {
      fit: 'contain', positionX: 50, positionY: 50,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      safe: true, retainedPercent: 100,
      letterboxed: Math.abs(sourceAspect - frameAspect) > 0.01,
      warnings: [],
    };
  }

  let cropWidth = 1;
  let cropHeight = 1;
  if (sourceAspect > frameAspect) cropWidth = frameAspect / sourceAspect;
  else cropHeight = sourceAspect / frameAspect;
  const zoom = clamp(settings?.zoom ?? 100, 100, 300) / 100;
  cropWidth = Math.min(1, cropWidth / zoom);
  cropHeight = Math.min(1, cropHeight / zoom);

  const focal = photo.analysis?.focalPoint ?? photo.focalPoint ?? { x: 0.5, y: 0.5 };
  let x: number;
  let y: number;

  if (requestedFit === 'smart') {
    /* Smart PROTECTS, it does not surrender. Dropping to `contain` here would
     * letterbox the photo behind the photographer's back and leave her with the
     * position controls greyed out — the frame stays full and we move the
     * window instead, then say honestly what the crop cost. */
    const target = unionBox(faces) ?? subject ?? null;
    if (target) {
      x = placeWindow(cropWidth, target.x, target.x + target.width, focal.x);
      y = placeWindow(cropHeight, target.y, target.y + target.height, focal.y);
    } else {
      x = clamp(focal.x - cropWidth / 2, 0, 1 - cropWidth);
      y = clamp(focal.y - cropHeight / 2, 0, 1 - cropHeight);
    }
  } else {
    const requestedX = (settings?.positionX ?? focal.x * 100) / 100;
    const requestedY = (settings?.positionY ?? focal.y * 100) / 100;
    x = clamp(requestedX - cropWidth / 2, 0, 1 - cropWidth);
    y = clamp(requestedY - cropHeight / 2, 0, 1 - cropHeight);
  }

  const crop = { x, y, width: cropWidth, height: cropHeight };
  const faceRetention = faces.map((box) => intersectionRatio(box, crop));
  const subjectRetention = subject ? intersectionRatio(subject, crop) : 1;
  const retained = Math.min(1, subjectRetention, ...faceRetention);

  /* A detector's face box is approximate, so shaving a hairline off it is not a
   * cut face. Flag only a loss the photographer would actually see in print. */
  const warnings: string[] = [];
  if (faceRetention.some((value) => value < 0.92)) warnings.push('החיתוך פוגע בפנים');
  if (subjectRetention < 0.75) warnings.push('חלק מהדמות יוצא מהמסגרת');
  const safe = warnings.length === 0;

  /* Not being analyzed yet is a caveat about our confidence, not a fault in the
   * crop — it must not paint the frame as unsafe. */
  if (!analyzed) warnings.push('התמונה עדיין לא נותחה — המיקוד לפי מרכז התמונה');

  return {
    fit: 'cover',
    positionX: clamp((x + cropWidth / 2) * 100, 0, 100),
    positionY: clamp((y + cropHeight / 2) * 100, 0, 100),
    crop,
    safe,
    retainedPercent: Math.round(retained * 100),
    letterboxed: false,
    warnings,
  };
}
