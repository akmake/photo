import { assessCrop } from './cropEngine';
import { buildAlbumLayoutCandidates } from './layoutEngine';
import type { AlbumPhoto, AlbumProject, PrintProductProfile } from './model';

export interface PreflightIssue {
  id: string;
  severity: 'blocker' | 'warning' | 'info';
  code: string;
  title: string;
  detail: string;
  spreadId?: string;
  photoId?: string;
  target: 'spread' | 'cover' | 'profile' | 'review';
}

export function runAlbumPreflight(
  project: AlbumProject,
  photos: AlbumPhoto[],
  profile: PrintProductProfile,
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
  const approved = (project.reviewVersions ?? [])
    .filter((version) => version.status === 'approved')
    .slice(-1)[0];

  if (!profile.verified || profile.colorProfile.trim().toLowerCase() !== 'srgb') {
    issues.push({
      id: 'profile-not-ready',
      severity: 'blocker',
      code: 'PROFILE_NOT_READY',
      title: 'פרופיל הדפוס אינו מוכן',
      detail: 'יש לאמת מפרט sRGB כתוב של בית הדפוס.',
      target: 'profile',
    });
  }
  if (!approved || JSON.stringify(approved.spreads) !== JSON.stringify(project.spreads)) {
    issues.push({
      id: 'approval-missing',
      severity: 'blocker',
      code: 'APPROVAL_MISSING',
      title: 'העיצוב הנוכחי לא אושר',
      detail: 'יש ליצור גרסת הגהה ולאשר אותה ללא הערות פתוחות.',
      target: 'review',
    });
  }

  if (!profile.coverSpec.verified) {
    issues.push({
      id: 'cover-spec-unverified',
      severity: 'blocker',
      code: 'COVER_SPEC_UNVERIFIED',
      title: 'מפרט הכריכה והשדרה לא אומת',
      detail: 'רוחב השדרה חייב להגיע מתבנית בית הדפוס.',
      target: 'cover',
    });
  }
  if (!project.cover?.frontPhotoId) {
    issues.push({
      id: 'cover-front-missing',
      severity: 'blocker',
      code: 'COVER_FRONT_MISSING',
      title: 'חסרה תמונת חזית',
      detail: 'יש לשבץ תמונה או לבחור עיצוב כריכה ללא תמונה.',
      target: 'cover',
    });
  }
  if (!project.cover?.title.trim()) {
    issues.push({
      id: 'cover-title-missing',
      severity: 'warning',
      code: 'COVER_TITLE_MISSING',
      title: 'הכריכה ללא כותרת',
      detail: 'אפשר להמשיך רק אם זו החלטה עיצובית מכוונת.',
      target: 'cover',
    });
  }

  project.spreads.forEach((spread) => {
    const candidates = buildAlbumLayoutCandidates(
      spread.photoIds,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
    );
    const generated = candidates.find((candidate) => candidate.id === spread.layoutId)
      ?? candidates[0];
    const slots = spread.customSlots?.length === spread.photoIds.length
      ? spread.customSlots
      : generated?.slots ?? [];
    const photoIds = spread.customSlots?.length === spread.photoIds.length
      ? spread.photoIds
      : generated?.photoIds ?? spread.photoIds;

    if (!photoIds.length) {
      issues.push({
        id: `empty-${spread.id}`,
        severity: 'warning',
        code: 'EMPTY_SPREAD',
        title: `כפולה ${spread.pageStart}–${spread.pageStart + 1} ריקה`,
        detail: 'יש לשבץ תמונות או למחוק את הכפולה.',
        spreadId: spread.id,
        target: 'spread',
      });
    }

    slots.forEach((slot, index) => {
      const photoId = photoIds[index];
      const photo = photoMap.get(photoId);
      if (!photo || !photo.url) {
        issues.push({
          id: `missing-${spread.id}-${index}`,
          severity: 'blocker',
          code: 'PHOTO_MISSING',
          title: 'קובץ תמונה חסר',
          detail: `עמודים ${spread.pageStart}–${spread.pageStart + 1}, מסגרת ${index + 1}.`,
          spreadId: spread.id,
          photoId,
          target: 'spread',
        });
        return;
      }
      if (photo.analysis?.status !== 'ready') {
        issues.push({
          id: `analysis-${spread.id}-${photo.id}`,
          severity: 'blocker',
          code: 'ANALYSIS_PENDING',
          title: 'התמונה לא נותחה',
          detail: `${photo.name} דורשת ניתוח לפני בדיקת חיתוך.`,
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
        });
      }
      const crop = assessCrop(
        photo,
        slot,
        spread.frameSettings?.[slot.id],
        profile.spreadWidthMm / profile.spreadHeightMm,
      );
      if (!crop.safe) {
        issues.push({
          id: `crop-${spread.id}-${photo.id}-${index}`,
          severity: 'blocker',
          code: 'UNSAFE_CROP',
          title: 'חיתוך מסוכן',
          detail: crop.warnings.join(' · '),
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
        });
      }
      const widthInches = slot.width * profile.spreadWidthMm / 25.4;
      const heightInches = slot.height * profile.spreadHeightMm / 25.4;
      const ppi = Math.floor(Math.min(
        photo.widthPx * crop.crop.width / Math.max(0.01, widthInches),
        photo.heightPx * crop.crop.height / Math.max(0.01, heightInches),
      ));
      if (ppi < profile.minPpi) {
        issues.push({
          id: `ppi-${spread.id}-${photo.id}-${index}`,
          severity: 'blocker',
          code: 'LOW_PPI',
          title: `רזולוציה נמוכה · ${ppi} PPI`,
          detail: `${photo.name} מתחת לסף ${profile.minPpi} PPI.`,
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
        });
      } else if (ppi < profile.targetPpi) {
        issues.push({
          id: `ppi-warning-${spread.id}-${photo.id}-${index}`,
          severity: 'warning',
          code: 'PPI_BELOW_TARGET',
          title: `מתחת ליעד · ${ppi} PPI`,
          detail: `הקובץ מעל הסף החוסם אך מתחת ליעד ${profile.targetPpi} PPI.`,
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
        });
      }
      const outside = slot.x < 0 || slot.y < 0 || slot.x + slot.width > 1 || slot.y + slot.height > 1;
      const crossesGutter = slot.x < 0.5 && slot.x + slot.width > 0.5 && !slot.allowCrossGutter;
      if (outside || crossesGutter) {
        issues.push({
          id: `geometry-${spread.id}-${index}`,
          severity: 'blocker',
          code: outside ? 'FRAME_OUTSIDE' : 'GUTTER_CROSSING',
          title: outside ? 'מסגרת מחוץ לכפולה' : 'מסגרת חוצה קיפול',
          detail: `עמודים ${spread.pageStart}–${spread.pageStart + 1}, מסגרת ${index + 1}.`,
          spreadId: spread.id,
          photoId: photo.id,
          target: 'spread',
        });
      }
    });

    slots.forEach((slot, index) => {
      slots.slice(index + 1).forEach((other, otherIndex) => {
        const width = Math.min(slot.x + slot.width, other.x + other.width)
          - Math.max(slot.x, other.x);
        const height = Math.min(slot.y + slot.height, other.y + other.height)
          - Math.max(slot.y, other.y);
        if (width > 0.003 && height > 0.003) {
          issues.push({
            id: `overlap-${spread.id}-${index}-${otherIndex}`,
            severity: 'blocker',
            code: 'FRAME_OVERLAP',
            title: 'מסגרות חופפות',
            detail: `עמודים ${spread.pageStart}–${spread.pageStart + 1}.`,
            spreadId: spread.id,
            target: 'spread',
          });
        }
      });
    });
  });

  return issues;
}
