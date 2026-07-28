import type { AlbumPhoto, LayoutSlot, NormalizedBox, PhotoFrameSettings } from './model';

export interface CropAssessment {
  fit: 'contain' | 'cover';
  positionX: number;
  positionY: number;
  crop: NormalizedBox;
  safe: boolean;
  retainedPercent: number;
  warnings: string[];
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

  if (requestedFit === 'contain') {
    return {
      fit: 'contain', positionX: 50, positionY: 50,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      safe: true, retainedPercent: 100, warnings: [],
    };
  }

  let cropWidth = 1;
  let cropHeight = 1;
  if (sourceAspect > frameAspect) cropWidth = frameAspect / sourceAspect;
  else cropHeight = sourceAspect / frameAspect;
  const zoom = clamp(settings?.zoom ?? 100, 100, 300) / 100;
  cropWidth /= zoom;
  cropHeight /= zoom;

  const focal = photo.analysis?.focalPoint ?? photo.focalPoint ?? { x: 0.5, y: 0.5 };
  const requestedX = requestedFit === 'smart'
    ? focal.x
    : (settings?.positionX ?? focal.x * 100) / 100;
  const requestedY = requestedFit === 'smart'
    ? focal.y
    : (settings?.positionY ?? focal.y * 100) / 100;
  const x = clamp(requestedX - cropWidth / 2, 0, 1 - cropWidth);
  const y = clamp(requestedY - cropHeight / 2, 0, 1 - cropHeight);
  const crop = { x, y, width: cropWidth, height: cropHeight };
  const faces = photo.analysis?.faces ?? [];
  const faceRetention = faces.map((box) => intersectionRatio(box, crop));
  const subjectRetention = photo.analysis?.subject
    ? intersectionRatio(photo.analysis.subject, crop)
    : 1;
  const retained = Math.min(1, subjectRetention, ...faceRetention);
  const warnings: string[] = [];
  if (faceRetention.some((value) => value < 0.985)) warnings.push('החיתוך פוגע בפנים');
  if (subjectRetention < 0.9) warnings.push('חלק מהדמות יוצא מהמסגרת');
  if (!photo.analysis || photo.analysis.status !== 'ready') warnings.push('התמונה עדיין לא נותחה');

  const safe = warnings.length === 0;
  if (requestedFit === 'smart' && !safe) {
    return {
      fit: 'contain', positionX: 50, positionY: 50,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      safe: true, retainedPercent: 100,
      warnings: ['מילוי חכם נמנע מחיתוך מסוכן'],
    };
  }

  return {
    fit: 'cover',
    positionX: clamp((x + cropWidth / 2) * 100, 0, 100),
    positionY: clamp((y + cropHeight / 2) * 100, 0, 100),
    crop,
    safe,
    retainedPercent: Math.round(retained * 100),
    warnings,
  };
}
