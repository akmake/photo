import { useEffect } from 'react';
import SpreadThumb from './SpreadThumb';
import type { AlbumPhoto, AlbumProject, PrintProductProfile } from './model';

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
    <div className="album-preview-overlay" data-surface="studio" role="dialog" aria-modal="true" aria-label="תצוגה מקדימה של האלבום">
      <header>
        <div>
          <strong>{project.name}</strong>
          <span>{project.spreads.length} כפולות · {profile.name}</span>
        </div>
        <button onClick={onClose}>חזרה לעריכה</button>
      </header>
      <div className="album-preview-list">
        {project.spreads.map((spread) => (
          <section key={spread.id} className="album-preview-item">
            <SpreadThumb spread={spread} photos={photos} profile={profile} />
            <small>עמודים {spread.pageStart}–{spread.pageStart + 1}</small>
          </section>
        ))}
      </div>
    </div>
  );
}
