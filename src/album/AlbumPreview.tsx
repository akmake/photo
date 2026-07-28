import { assessCrop } from './cropEngine';
import {
  buildAlbumLayoutCandidates, EMPTY_GENERATED_LAYOUT,
} from './layoutEngine';
import type {
  AlbumPhoto, AlbumProject, PhotoFrameSettings, PrintProductProfile,
} from './model';

const DEFAULT_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

interface Props {
  project: AlbumProject;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  onClose(): void;
}

export default function AlbumPreview({ project, photos, profile, onClose }: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="album-preview-overlay" role="dialog" aria-modal="true" aria-label="תצוגה מקדימה של האלבום">
      <header>
        <div>
          <strong>{project.name}</strong>
          <span>{project.spreads.length} כפולות · {profile.name}</span>
        </div>
        <button onClick={onClose}>חזרה לעריכה</button>
      </header>
      <div className="album-preview-list">
        {project.spreads.map((spread) => {
          const candidates = buildAlbumLayoutCandidates(
            spread.photoIds,
            photos,
            profile.closedWidthMm / profile.closedHeightMm,
          );
          const generated = candidates.find((candidate) => candidate.id === spread.layoutId)
            ?? candidates[0]
            ?? EMPTY_GENERATED_LAYOUT;
          const slots = spread.customSlots?.length === spread.photoIds.length
            ? spread.customSlots
            : generated.slots;
          const photoIds = spread.customSlots?.length === spread.photoIds.length
            ? spread.photoIds
            : generated.photoIds;
          return (
            <section key={spread.id} className="album-preview-item">
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
                    photo,
                    slot,
                    settings,
                    profile.spreadWidthMm / profile.spreadHeightMm,
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
                <span className="preview-page left">{spread.pageStart}</span>
                <span className="preview-page right">{spread.pageStart + 1}</span>
              </div>
              <small>עמודים {spread.pageStart}–{spread.pageStart + 1}</small>
            </section>
          );
        })}
      </div>
    </div>
  );
}
import { useEffect } from 'react';
