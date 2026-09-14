import { useMemo, useState } from 'react';
import { IcBook, IcChevron, IcSparkle } from '../design/Icons';
import type { AlbumSummary } from './albumStorage';
import type { AlbumPhoto, PrintProductProfile } from './model';

interface Props {
  albums: AlbumSummary[];
  profiles: PrintProductProfile[];
  photos: AlbumPhoto[];
  projectName?: string;
  projectScoped?: boolean;
  clientAlbums?: { name: string; frames: string[] }[];
  onBack?(): void;
  onOpen(id: string): void;
  onCreate(input: AlbumCreateInput): void;
  onRename(id: string, name: string): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
}

export interface AlbumCreateInput {
  name: string;
  baseProfileId?: string;
  closedWidthMm: number;
  closedHeightMm: number;
  styleName: string;
  background: string;
  selectedPhotoIds?: string[];
  openingDirection?: 'rtl' | 'ltr';
  coverStyle?: 'photo' | 'linen' | 'minimal';
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
  albums, profiles, photos, projectName, projectScoped = false, clientAlbums = [], onBack,
  onOpen, onCreate, onRename, onDuplicate, onDelete,
}: Props) {
  const defaultProfile = profiles[0];
  const defaultSource = clientAlbums.length ? 'client-0' : 'all';
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState(defaultProfile?.id ?? '');
  const [source, setSource] = useState(defaultSource);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? defaultProfile;
  const defaultName = useMemo(
    () => `${projectName?.trim() || 'הפרויקט'} — אלבום`,
    [projectName],
  );

  function openCreate() {
    setName(defaultName);
    setProfileId(defaultProfile?.id ?? '');
    setSource(defaultSource);
    setCreating(true);
  }

  function submit() {
    const cleanName = name.trim();
    if (!cleanName || !selectedProfile) return;
    const clientIndex = source.startsWith('client-') ? Number(source.slice(7)) : -1;
    const selectedPhotoIds = source === 'all'
      ? photos.map((photo) => photo.id)
      : clientIndex >= 0
        ? clientAlbums[clientIndex]?.frames ?? []
        : [];
    onCreate({
      name: cleanName,
      baseProfileId: selectedProfile.id,
      closedWidthMm: selectedProfile.closedWidthMm,
      closedHeightMm: selectedProfile.closedHeightMm,
      styleName: 'Fine Art',
      background: '#f8f6f1',
      selectedPhotoIds,
      openingDirection: 'rtl',
      coverStyle: 'photo',
    });
    setCreating(false);
  }

  function startRename(album: AlbumSummary) {
    setOpenMenu(null);
    setRenameId(album.id);
    setRenameValue(album.name);
  }

  function finishRename() {
    const clean = renameValue.trim();
    if (renameId && clean) onRename(renameId, clean);
    setRenameId(null);
  }

  return (
    <div className="album-library album-library-new" dir="rtl">
      <header className="album-library-header">
        <div className="album-library-heading">
          {onBack && (
            <button className="album-quiet-button" onClick={onBack} title="חזרה לפרויקט">
              <IcChevron size={15} style={{ transform: 'rotate(180deg)' }} /> הפרויקט
            </button>
          )}
          <div>
            <h1>אלבומים</h1>
            <span>{albums.length ? `${albums.length} אלבומים` : 'אין עדיין אלבומים'}</span>
          </div>
        </div>
        <button className="album-primary-button" onClick={openCreate}>
          <span aria-hidden="true">＋</span> אלבום חדש
        </button>
      </header>

      {albums.length ? (
        <main className="album-library-list">
          {albums.map((album) => {
            const profile = profiles.find((item) => item.id === album.productProfileId);
            const isLegacy = projectScoped && !album.projectId;
            return (
              <article className="album-library-row" key={album.id}>
                <button className="album-library-row-main" onClick={() => onOpen(album.id)}>
                  <span className="album-library-thumb" aria-hidden="true"><span><IcBook size={22} /></span></span>
                  <span className="album-library-row-copy">
                    <strong>{album.name}</strong>
                    <span>{profile?.name ?? 'מוצר לא ידוע'} · {album.spreadCount} כפולות</span>
                  </span>
                  <span className="album-library-row-state">
                    <b>{isLegacy ? 'אלבום ישן' : 'טיוטה'}</b>
                    <time dateTime={album.updatedAt}>עודכן {whenLabel(album.updatedAt)}</time>
                  </span>
                </button>
                <div className="album-library-row-actions">
                  <button className="album-icon-button" aria-label={`פעולות נוספות עבור ${album.name}`} aria-expanded={openMenu === album.id} onClick={() => setOpenMenu((current) => current === album.id ? null : album.id)}>•••</button>
                  {openMenu === album.id && (
                    <div className="album-context-menu" role="menu">
                      <button role="menuitem" onClick={() => startRename(album)}>שינוי שם</button>
                      <button role="menuitem" onClick={() => { onDuplicate(album.id); setOpenMenu(null); }}>שכפול</button>
                      <button role="menuitem" className="danger" onClick={() => { setDeleteId(album.id); setOpenMenu(null); }}>מחיקה</button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </main>
      ) : (
        <main className="album-library-empty">
          <IcBook size={30} />
          <h2>עדיין אין אלבום לפרויקט הזה</h2>
          <p>צור אלבום מהתמונות שכבר נמצאות בפרויקט.</p>
          <button className="album-primary-button" onClick={openCreate}>צור אלבום</button>
        </main>
      )}

      {creating && (
        <div className="album-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCreating(false)}>
          <section className="album-create-dialog" role="dialog" aria-modal="true" aria-labelledby="album-create-title" onKeyDown={(event) => event.key === 'Escape' && setCreating(false)}>
            <header>
              <div><h2 id="album-create-title">אלבום חדש</h2><p>האלבום ייבנה מיד וייפתח כספר.</p></div>
              <button className="album-icon-button" onClick={() => setCreating(false)} aria-label="סגירה">×</button>
            </header>
            <div className="album-create-fields">
              <label>
                <span>שם האלבום</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} />
              </label>
              <label>
                <span>מוצר</span>
                {profiles.length > 1 ? (
                  <select value={selectedProfile?.id ?? ''} onChange={(event) => setProfileId(event.target.value)}>
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                ) : <span className="album-create-readonly">{selectedProfile?.name ?? 'לא הוגדר מוצר'}</span>}
              </label>
              <fieldset>
                <legend>מקור התמונות</legend>
                {clientAlbums.map((album, index) => (
                  <label key={`${album.name}-${index}`} className="album-radio-row">
                    <input type="radio" name="album-source" checked={source === `client-${index}`} onChange={() => setSource(`client-${index}`)} />
                    <span><strong>{album.name}</strong><small>בחירת הלקוח · {album.frames.length} תמונות</small></span>
                  </label>
                ))}
                <label className="album-radio-row">
                  <input type="radio" name="album-source" checked={source === 'all'} onChange={() => setSource('all')} />
                  <span><strong>כל התמונות בפרויקט</strong><small>{photos.length} תמונות זמינות</small></span>
                </label>
                <label className="album-radio-row">
                  <input type="radio" name="album-source" checked={source === 'manual'} onChange={() => setSource('manual')} />
                  <span><strong>אבחר בעצמי</strong><small>הבחירה תיפתח מיד לאחר היצירה</small></span>
                </label>
              </fieldset>
            </div>
            <footer>
              <button className="album-quiet-button" onClick={() => setCreating(false)}>ביטול</button>
              <button className="album-primary-button" disabled={!name.trim() || !selectedProfile} onClick={submit}><IcSparkle size={15} /> צור אלבום</button>
            </footer>
          </section>
        </div>
      )}

      {renameId && (
        <div className="album-modal-backdrop">
          <section className="album-small-dialog" role="dialog" aria-modal="true" aria-labelledby="album-rename-title">
            <h2 id="album-rename-title">שינוי שם האלבום</h2>
            <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') finishRename(); if (event.key === 'Escape') setRenameId(null); }} />
            <footer><button className="album-quiet-button" onClick={() => setRenameId(null)}>ביטול</button><button className="album-primary-button" onClick={finishRename}>שמירה</button></footer>
          </section>
        </div>
      )}

      {deleteId && (
        <div className="album-modal-backdrop">
          <section className="album-small-dialog" role="alertdialog" aria-modal="true" aria-labelledby="album-delete-title">
            <h2 id="album-delete-title">למחוק את האלבום?</h2>
            <p>האלבום והעיצוב שלו יימחקו. תמונות המקור בפרויקט לא ייפגעו.</p>
            <footer><button className="album-quiet-button" onClick={() => setDeleteId(null)}>ביטול</button><button className="album-danger-button" onClick={() => { onDelete(deleteId); setDeleteId(null); }}>מחיקה</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}
