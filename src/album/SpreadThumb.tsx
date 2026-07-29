import { assessCrop } from './cropEngine';
import { buildAlbumLayoutCandidates, EMPTY_GENERATED_LAYOUT } from './layoutEngine';
import type {
  AlbumPhoto, AlbumSpread, PhotoFrameSettings, PrintProductProfile,
} from './model';

const DEFAULT_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

interface Props {
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  /** Draw the page numbers over the sheet. */
  showPageNumbers?: boolean;
}

/* One spread drawn small and read-only.
 *
 * The preview overlay and the organise grid both need this, and when it lived
 * in only one of them the two drifted — a crop fixed in the editor would show
 * one way on screen and another in the client's proof. Same geometry, same
 * crop engine, one place. */
export default function SpreadThumb({
  spread, photos, profile, showPageNumbers = true,
}: Props) {
  const candidates = buildAlbumLayoutCandidates(
    spread.photoIds,
    photos,
    profile.closedWidthMm / profile.closedHeightMm,
  );
  const generated = candidates.find((candidate) => candidate.id === spread.layoutId)
    ?? candidates[0]
    ?? EMPTY_GENERATED_LAYOUT;
  const isCustom = spread.customSlots?.length === spread.photoIds.length;
  const slots = isCustom ? spread.customSlots! : generated.slots;
  const photoIds = isCustom ? spread.photoIds : generated.photoIds;

  return (
    <div
      className="album-preview-spread"
      style={{
        background: spread.background,
        aspectRatio: `${profile.spreadWidthMm} / ${profile.spreadHeightMm}`,
      }}
    >
      <div className="album-preview-gutter" />
      {slots.map((slot, index) => {
        const photo = photos.find((item) => item.id === photoIds[index]);
        if (!photo) return null;
        const settings = spread.frameSettings?.[slot.id] ?? DEFAULT_SETTINGS;
        const crop = assessCrop(
          photo, slot, settings, profile.spreadWidthMm / profile.spreadHeightMm,
        );
        return (
          <div
            key={slot.id}
            className="album-preview-frame"
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.width * 100}%`,
              height: `${slot.height * 100}%`,
            }}
          >
            <img
              src={photo.url}
              alt=""
              loading="lazy"
              decoding="async"
              style={{
                objectFit: crop.fit,
                objectPosition: `${crop.positionX}% ${crop.positionY}%`,
                transform: `scale(${crop.fit === 'contain' ? 1 : (settings.zoom ?? 100) / 100})`,
                transformOrigin: `${crop.positionX}% ${crop.positionY}%`,
              }}
            />
          </div>
        );
      })}
      {showPageNumbers && (
        <>
          <span className="preview-page left">{spread.pageStart}</span>
          <span className="preview-page right">{spread.pageStart + 1}</span>
        </>
      )}
    </div>
  );
}
