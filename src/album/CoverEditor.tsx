import { useMemo, useState } from 'react';
import type {
  AlbumCover, AlbumPhoto, AlbumProject, PrintProductProfile,
} from './model';

interface Props {
  project: AlbumProject;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  onUpdateProject(project: AlbumProject): void;
  onUpdateProfile(profile: PrintProductProfile): void;
  onClose(): void;
}

const DEFAULT_COVER: AlbumCover = {
  background: '#eee6db',
  title: 'הרגעים שלנו',
  subtitle: '',
  spineText: '',
};

const DEFAULT_CROP = {
  fit: 'cover' as const,
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

export default function CoverEditor({
  project, photos, profile, onUpdateProject, onUpdateProfile, onClose,
}: Props) {
  const cover = project.cover ?? DEFAULT_COVER;
  const [target, setTarget] = useState<'front' | 'back'>('front');
  const spec = profile.coverSpec;
  const spinePercent = spec.spineWidthMm / spec.totalWidthMm * 100;
  const pagePercent = (100 - spinePercent) / 2;
  const frontPhoto = photos.find((photo) => photo.id === cover.frontPhotoId);
  const backPhoto = photos.find((photo) => photo.id === cover.backPhotoId);
  const activeSettings = (
    target === 'front' ? cover.frontSettings : cover.backSettings
  ) ?? DEFAULT_CROP;
  const shownPhotos = useMemo(() => photos.slice(0, 120), [photos]);

  function updateCover(patch: Partial<AlbumCover>) {
    onUpdateProject({ ...project, cover: { ...cover, ...patch } });
  }

  function assignPhoto(photoId: string, zone = target) {
    updateCover(zone === 'front'
      ? { frontPhotoId: photoId, frontSettings: cover.frontSettings ?? DEFAULT_CROP }
      : { backPhotoId: photoId, backSettings: cover.backSettings ?? DEFAULT_CROP });
  }

  function updateCrop(patch: Partial<typeof DEFAULT_CROP>) {
    const next = { ...activeSettings, ...patch, fit: 'cover' as const };
    updateCover(target === 'front' ? { frontSettings: next } : { backSettings: next });
  }

  function dropPhoto(event: React.DragEvent, zone: 'front' | 'back') {
    event.preventDefault();
    const photoId = event.dataTransfer.getData('application/x-teza-photo')
      || event.dataTransfer.getData('text/plain');
    if (photos.some((photo) => photo.id === photoId)) assignPhoto(photoId, zone);
  }

  function dragPhoto(event: React.DragEvent, photoId: string) {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-teza-photo', photoId);
    event.dataTransfer.setData('text/plain', photoId);
  }

  function updateSpec(patch: Partial<PrintProductProfile['coverSpec']>) {
    onUpdateProfile({
      ...profile,
      coverSpec: { ...spec, ...patch, verified: patch.verified ?? false },
    });
  }

  const safeInsetX = spec.safeMarginMm / spec.totalWidthMm * 100;
  const safeInsetY = spec.safeMarginMm / spec.totalHeightMm * 100;
  const bleedInsetX = spec.bleedMm / spec.totalWidthMm * 100;
  const bleedInsetY = spec.bleedMm / spec.totalHeightMm * 100;

  return (
    <div className="cover-editor" role="dialog" aria-modal="true" aria-label="עורך כריכה">
      <header>
        <div>
          <strong>עיצוב כריכה</strong>
          <span>{profile.name} · גב, שדרה וחזית</span>
        </div>
        <button onClick={onClose}>חזרה לאלבום</button>
      </header>
      <div className="cover-editor-body">
        <aside className="cover-settings">
          <strong>תוכן הכריכה</strong>
          <label>
            <span>כותרת בחזית</span>
            <input value={cover.title} onChange={(event) => updateCover({ title: event.target.value })} />
          </label>
          <label>
            <span>כותרת משנה</span>
            <input value={cover.subtitle} onChange={(event) => updateCover({ subtitle: event.target.value })} />
          </label>
          <label>
            <span>טקסט שדרה</span>
            <input value={cover.spineText} onChange={(event) => updateCover({ spineText: event.target.value })} />
          </label>
          <span className="cover-label">רקע</span>
          <div className="cover-palette">
            {['#f8f6f1', '#eee6db', '#d5c7b8', '#8e7b6a', '#242424'].map((color) => (
              <button
                key={color}
                className={cover.background === color ? 'on' : ''}
                style={{ background: color }}
                onClick={() => updateCover({ background: color })}
                aria-label={`רקע ${color}`}
              />
            ))}
          </div>
          <div className="cover-zone-choice">
            <button className={target === 'front' ? 'on' : ''} onClick={() => setTarget('front')}>בחירת תמונה לחזית</button>
            <button className={target === 'back' ? 'on' : ''} onClick={() => setTarget('back')}>בחירת תמונה לגב</button>
          </div>
          <div className="cover-crop-controls">
            <strong>חיתוך {target === 'front' ? 'החזית' : 'הגב'}</strong>
            <label>
              <span>זום · {activeSettings.zoom ?? 100}%</span>
              <input
                type="range"
                min="100"
                max="250"
                value={activeSettings.zoom ?? 100}
                onChange={(event) => updateCrop({ zoom: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>מיקום אופקי</span>
              <input
                type="range"
                min="0"
                max="100"
                value={activeSettings.positionX}
                onChange={(event) => updateCrop({ positionX: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>מיקום אנכי</span>
              <input
                type="range"
                min="0"
                max="100"
                value={activeSettings.positionY}
                onChange={(event) => updateCrop({ positionY: Number(event.target.value) })}
              />
            </label>
            <button onClick={() => updateCrop(DEFAULT_CROP)}>איפוס חיתוך</button>
          </div>
        </aside>

        <main className="cover-canvas-area">
          <div
            className="cover-canvas"
            style={{
              background: cover.background,
              aspectRatio: `${spec.totalWidthMm} / ${spec.totalHeightMm}`,
            }}
          >
            <button
              className={`cover-photo-zone back ${target === 'back' ? 'selected' : ''}`}
              style={{ left: 0, width: `${pagePercent}%` }}
              onClick={() => setTarget('back')}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropPhoto(event, 'back')}
            >
              {backPhoto ? (
                <img
                  src={backPhoto.url}
                  alt=""
                  style={{
                    objectPosition: `${cover.backSettings?.positionX ?? (backPhoto.focalPoint?.x ?? 0.5) * 100}% ${cover.backSettings?.positionY ?? (backPhoto.focalPoint?.y ?? 0.5) * 100}%`,
                    transform: `scale(${(cover.backSettings?.zoom ?? 100) / 100})`,
                    transformOrigin: `${cover.backSettings?.positionX ?? 50}% ${cover.backSettings?.positionY ?? 50}%`,
                  }}
                />
              ) : <span>גררי תמונה לגב הכריכה</span>}
            </button>
            <div
              className="cover-spine"
              style={{ left: `${pagePercent}%`, width: `${spinePercent}%` }}
            >
              <span>{cover.spineText}</span>
            </div>
            <button
              className={`cover-photo-zone front ${target === 'front' ? 'selected' : ''}`}
              style={{ right: 0, width: `${pagePercent}%` }}
              onClick={() => setTarget('front')}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropPhoto(event, 'front')}
            >
              {frontPhoto ? (
                <img
                  src={frontPhoto.url}
                  alt=""
                  style={{
                    objectPosition: `${cover.frontSettings?.positionX ?? (frontPhoto.focalPoint?.x ?? 0.5) * 100}% ${cover.frontSettings?.positionY ?? (frontPhoto.focalPoint?.y ?? 0.5) * 100}%`,
                    transform: `scale(${(cover.frontSettings?.zoom ?? 100) / 100})`,
                    transformOrigin: `${cover.frontSettings?.positionX ?? 50}% ${cover.frontSettings?.positionY ?? 50}%`,
                  }}
                />
              ) : <span>גררי תמונה לחזית הכריכה</span>}
              <div className="cover-title">
                <strong>{cover.title}</strong>
                {cover.subtitle && <small>{cover.subtitle}</small>}
              </div>
            </button>
            <div
              className="cover-bleed"
              style={{ inset: `${bleedInsetY}% ${bleedInsetX}%` }}
            />
            <div
              className="cover-safe"
              style={{ inset: `${safeInsetY}% ${safeInsetX}%` }}
            />
          </div>
          <div className="cover-legend">
            <span>גב</span><span>שדרה {spec.spineWidthMm} מ״מ</span><span>חזית</span>
          </div>
        </main>

        <aside className="cover-spec-panel">
          <strong>מפרט בית הדפוס</strong>
          <span className={spec.verified ? 'verified' : 'draft'}>
            {spec.verified ? 'מפרט כריכה מאומת' : 'טיוטה · יצוא כריכה חסום'}
          </span>
          <label>
            <span>רוחב כולל במ״מ</span>
            <input type="number" value={spec.totalWidthMm} onChange={(event) => updateSpec({ totalWidthMm: Number(event.target.value) })} />
          </label>
          <label>
            <span>גובה כולל במ״מ</span>
            <input type="number" value={spec.totalHeightMm} onChange={(event) => updateSpec({ totalHeightMm: Number(event.target.value) })} />
          </label>
          <label>
            <span>רוחב שדרה במ״מ</span>
            <input type="number" min="0" value={spec.spineWidthMm} onChange={(event) => updateSpec({ spineWidthMm: Number(event.target.value) })} />
          </label>
          <label>
            <span>גלישה במ״מ</span>
            <input type="number" min="0" value={spec.bleedMm} onChange={(event) => updateSpec({ bleedMm: Number(event.target.value) })} />
          </label>
          <label>
            <span>אזור בטוח במ״מ</span>
            <input type="number" min="0" value={spec.safeMarginMm} onChange={(event) => updateSpec({ safeMarginMm: Number(event.target.value) })} />
          </label>
          <label className="cover-verify">
            <input
              type="checkbox"
              checked={spec.verified}
              disabled={!profile.verified || spec.totalWidthMm <= 0 || spec.totalHeightMm <= 0}
              onChange={(event) => updateSpec({ verified: event.target.checked })}
            />
            <span>המידות והשדרה נבדקו מול תבנית בית הדפוס</span>
          </label>
          {!profile.verified && <div className="cover-blocker">יש לאמת תחילה את פרופיל האלבום.</div>}
        </aside>
      </div>
      <footer className="cover-photo-tray">
        {shownPhotos.map((photo) => (
          <button
            key={photo.id}
            draggable
            onDragStart={(event) => dragPhoto(event, photo.id)}
            onClick={() => assignPhoto(photo.id)}
            title={target === 'front' ? 'שיבוץ בחזית' : 'שיבוץ בגב'}
          >
            <img src={photo.url} alt="" loading="lazy" />
            <span>{photo.name}</span>
          </button>
        ))}
      </footer>
    </div>
  );
}
