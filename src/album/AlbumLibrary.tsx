import { useState } from 'react';
import { IcBook, IcSparkle } from '../design/Icons';
import type { AlbumSummary } from './albumStorage';
import type { PrintProductProfile } from './model';

interface Props {
  albums: AlbumSummary[];
  profiles: PrintProductProfile[];
  /** The job these albums belong to — an album is never free-floating. */
  projectName: string;
  /** How many frames the project's folders hold; what a new album draws from. */
  photoCount: number;
  photosLoading: boolean;
  onOpen(id: string): void;
  onCreate(name: string, productProfileId: string): void;
  onRename(id: string, name: string): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
}

function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  if (days < 30) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function AlbumLibrary({
  albums, profiles, projectName, photoCount, photosLoading,
  onOpen, onCreate, onRename, onDuplicate, onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /* A second album for the same job is the common case — parents' copy, a
   * smaller size — so the name suggests itself instead of being typed again. */
  function beginCreate() {
    setName(albums.length ? `${projectName} — אלבום ${albums.length + 1}` : projectName);
    setCreating(true);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, profileId || profiles[0].id);
    setName('');
    setCreating(false);
  }

  const source = photosLoading
    ? 'קורא את תיקיות הפרויקט…'
    : photoCount
      ? `${photoCount.toLocaleString('he-IL')} תמונות בתיקיות הפרויקט`
      : 'אין עדיין תמונות בתיקיות הפרויקט';

  return (
    <div className="album-library" data-surface="studio">
      <header className="library-head">
        <div>
          <strong>האלבומים של {projectName}</strong>
          <span>
            {albums.length ? `${albums.length} אלבומים` : 'עוד לא נוצרו אלבומים'} · {source}
          </span>
        </div>
        <button className="library-new" onClick={beginCreate}>
          <IcSparkle size={16} />אלבום חדש
        </button>
      </header>

      {creating && (
        <div className="library-create" role="dialog" aria-label="אלבום חדש">
          <label>
            <span>שם האלבום</span>
            <input
              autoFocus
              value={name}
              placeholder={projectName}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') setCreating(false);
              }}
            />
          </label>
          <label>
            <span>מוצר מודפס</span>
            <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.closedWidthMm}×{profile.closedHeightMm} מ״מ
                </option>
              ))}
            </select>
          </label>
          <div className="library-create-actions">
            <button className="ghost" onClick={() => setCreating(false)}>ביטול</button>
            <button className="primary" onClick={submit} disabled={!name.trim()}>
              יצירה ובחירת תמונות
            </button>
          </div>
        </div>
      )}

      {albums.length ? (
        <div className="library-grid">
          {albums.map((album) => {
            const profile = profiles.find((item) => item.id === album.productProfileId);
            return (
              <article key={album.id} className="library-card">
                <button className="library-open" onClick={() => onOpen(album.id)}>
                  <span className="library-cover"><IcBook size={26} /></span>
                  <b>{album.name}</b>
                  <small>
                    {album.spreadCount} כפולות · {album.placedCount}/{album.photoCount} תמונות שובצו
                  </small>
                  <small className="library-when">
                    {profile?.name ?? 'מוצר לא ידוע'} · עודכן {whenLabel(album.updatedAt)}
                  </small>
                </button>
                <footer className="library-actions">
                  <button onClick={() => {
                    const next = window.prompt('שם חדש לאלבום', album.name);
                    if (next && next.trim()) onRename(album.id, next.trim());
                  }}>שינוי שם</button>
                  <button onClick={() => onDuplicate(album.id)}>שכפול</button>
                  {confirmDelete === album.id ? (
                    <>
                      <button className="danger" onClick={() => { onDelete(album.id); setConfirmDelete(null); }}>
                        למחוק?
                      </button>
                      <button onClick={() => setConfirmDelete(null)}>ביטול</button>
                    </>
                  ) : (
                    <button className="danger" onClick={() => setConfirmDelete(album.id)}>מחיקה</button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : !creating && (
        <div className="library-blank">
          <IcBook size={30} />
          <strong>לפרויקט הזה אין עדיין אלבום</strong>
          <span>
            האלבום מרכיב את עצמו מתמונות הפרויקט — {source}. שום קובץ לא מועתק:
            התמונות נשארות בתיקיות שלהן על הדיסק.
          </span>
          <button className="library-new" onClick={beginCreate}>
            <IcSparkle size={16} />יצירת האלבום הראשון
          </button>
        </div>
      )}
    </div>
  );
}
