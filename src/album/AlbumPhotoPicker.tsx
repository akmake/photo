import { useMemo, useState } from 'react';
import { IcCheck, IcChevron, IcGallery, IcSparkle } from '../design/Icons';
import type { AlbumPhoto } from './model';

interface Props {
  photos: AlbumPhoto[];
  albumName: string;
  initialSelectedIds?: string[];
  onCancel(): void;
  onContinue(photoIds: string[]): void;
}

export default function AlbumPhotoPicker({
  photos,
  albumName,
  initialSelectedIds = [],
  onCancel,
  onContinue,
}: Props) {
  const knownIds = useMemo(() => new Set(photos.map((photo) => photo.id)), [photos]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (
    initialSelectedIds.filter((id, index, all) => knownIds.has(id) && all.indexOf(id) === index)
  ));
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(photoId: string) {
    setSelectedIds((current) => (
      current.includes(photoId)
        ? current.filter((id) => id !== photoId)
        : [...current, photoId]
    ));
  }

  return (
    <div className="album-picker" dir="rtl">
      <header className="album-picker-head">
        <button className="album-picker-back" onClick={onCancel}>
          <IcChevron size={15} /> חזרה
        </button>
        <div className="album-picker-heading">
          <h1>בחירת תמונות לאלבום</h1>
          <p>{albumName} · בוחרים רק את התמונות שייכנסו לספר</p>
        </div>
        <div className="album-picker-actions">
          <button
            className="album-picker-text-button"
            onClick={() => setSelectedIds(photos.map((photo) => photo.id))}
            disabled={!photos.length || selectedIds.length === photos.length}
          >
            בחירת הכול
          </button>
          <button
            className="album-picker-text-button"
            onClick={() => setSelectedIds([])}
            disabled={!selectedIds.length}
          >
            ניקוי בחירה
          </button>
        </div>
      </header>

      <main className="album-picker-main">
        <div className="album-picker-summary">
          <div><strong>{selectedIds.length}</strong><span>נבחרו מתוך {photos.length}</span></div>
          <p>סדר הבחירה יקבע את רצף התמונות הראשוני. תמיד אפשר לשנות אותו בשלב הבא.</p>
        </div>

        {photos.length ? (
          <div className="album-picker-grid">
            {photos.map((photo) => {
              const position = selectedIds.indexOf(photo.id);
              const isSelected = selected.has(photo.id);
              return (
                <button
                  key={photo.id}
                  className={`album-picker-photo${isSelected ? ' selected' : ''}`}
                  onClick={() => toggle(photo.id)}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? 'הסר' : 'בחר'} ${photo.name}`}
                >
                  <span className="album-picker-image">
                    <img src={photo.url} alt={photo.name} loading="lazy" decoding="async" />
                    <span className="album-picker-check" aria-hidden="true">
                      {isSelected ? (position + 1) : <IcCheck size={14} />}
                    </span>
                  </span>
                  <span className="album-picker-name" title={photo.name}>{photo.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="album-picker-empty">
            <IcGallery size={32} />
            <strong>אין תמונות בפרויקט</strong>
            <span>חזרו לפרויקט והוסיפו תמונות לפני יצירת האלבום.</span>
          </div>
        )}
      </main>

      <footer className="album-picker-footer">
        <div className="album-picker-footer-count">
          <strong>{selectedIds.length} תמונות</strong>
          <span>{selectedIds.length ? 'מוכנות לחלוקה לכפולות' : 'בחרו לפחות תמונה אחת'}</span>
        </div>
        <button
          className="album-picker-continue"
          disabled={!selectedIds.length}
          onClick={() => onContinue(selectedIds)}
        >
          <IcSparkle size={16} /> המשך לחלוקת האלבום
        </button>
      </footer>
    </div>
  );
}
