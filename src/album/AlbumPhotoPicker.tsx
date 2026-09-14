import { useMemo, useState } from 'react';
import { IcCheck, IcGallery } from '../design/Icons';
import type { AlbumPhoto } from './model';

interface Props {
  photos: AlbumPhoto[];
  albumName: string;
  existingPhotoIds?: string[];
  onCancel(): void;
  onContinue(photoIds: string[]): void;
}

export default function AlbumPhotoPicker({
  photos, albumName, existingPhotoIds = [], onCancel, onContinue,
}: Props) {
  const existing = useMemo(() => new Set(existingPhotoIds), [existingPhotoIds]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<'available' | 'all'>('available');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visible = useMemo(
    () => filter === 'all' ? photos : photos.filter((photo) => !existing.has(photo.id)),
    [existing, filter, photos],
  );

  function toggle(photoId: string) {
    if (existing.has(photoId)) return;
    setSelectedIds((current) => current.includes(photoId)
      ? current.filter((id) => id !== photoId)
      : [...current, photoId]);
  }

  return (
    <div className="album-modal-backdrop album-picker-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="album-photo-picker" role="dialog" aria-modal="true" aria-labelledby="album-picker-title" dir="rtl" onKeyDown={(event) => event.key === 'Escape' && onCancel()}>
        <header>
          <div>
            <h2 id="album-picker-title">הוספת תמונות לאלבום</h2>
            <p>{photos.length} תמונות בפרויקט · {existing.size} כבר באלבום</p>
          </div>
          <button className="album-icon-button" onClick={onCancel} aria-label="סגירה">×</button>
        </header>

        <div className="album-picker-toolbar">
          <div role="group" aria-label="סינון תמונות">
            <button className={filter === 'available' ? 'on' : ''} onClick={() => setFilter('available')}>לא באלבום</button>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>הכול</button>
          </div>
          <button className="album-quiet-button" disabled={!visible.some((photo) => !existing.has(photo.id))} onClick={() => setSelectedIds(visible.filter((photo) => !existing.has(photo.id)).map((photo) => photo.id))}>בחר הכול</button>
        </div>

        <main className="album-picker-grid-new">
          {visible.map((photo) => {
            const isExisting = existing.has(photo.id);
            const isSelected = selected.has(photo.id);
            return (
              <button
                key={photo.id}
                className={`${isSelected ? 'selected' : ''}${isExisting ? ' existing' : ''}`}
                disabled={isExisting}
                onClick={() => toggle(photo.id)}
                aria-pressed={isSelected}
                aria-label={isExisting ? `${photo.name}, כבר באלבום` : `${isSelected ? 'הסר' : 'בחר'} ${photo.name}`}
                title={photo.name}
              >
                <img src={photo.url} alt="" loading="lazy" decoding="async" />
                <span className="album-picker-check" aria-hidden="true">{isExisting ? 'באלבום' : isSelected ? <IcCheck size={14} /> : ''}</span>
              </button>
            );
          })}
          {!visible.length && (
            <div className="album-picker-empty-new"><IcGallery size={24} /><strong>אין תמונות שלא שובצו</strong></div>
          )}
        </main>

        <footer>
          <span><strong>{selectedIds.length} נבחרו</strong><small>{albumName}</small></span>
          <div><button className="album-quiet-button" onClick={onCancel}>ביטול</button><button className="album-primary-button" disabled={!selectedIds.length} onClick={() => onContinue(selectedIds)}>הוסף {selectedIds.length || ''} תמונות</button></div>
        </footer>
      </section>
    </div>
  );
}
