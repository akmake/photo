import { useMemo, useState } from 'react';
import { IcBook, IcChevron, IcSparkle } from '../design/Icons';
import type { AlbumSummary } from './albumStorage';
import type { AlbumPhoto, PrintProductProfile } from './model';
import { smallUrl } from './projectPool';
import { STANDARD_PRINT_PROFILES } from './model';

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
  /* A new album is one of the standard sizes, or a size typed in. Older sizes
   * stay in `profiles` only so existing albums keep theirs. */
  const standardProfiles = STANDARD_PRINT_PROFILES
    .map((standard) => profiles.find((profile) => profile.id === standard.id) ?? standard);
  const defaultProfile = standardProfiles[0];
  const defaultSource = clientAlbums.length ? 'client-0' : 'all';
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState(defaultProfile?.id ?? '');
  const [source, setSource] = useState(defaultSource);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  /* The album as it sits CLOSED, like every other size in the product. This
   * field used to ask for the spread and quietly halve it, so the same album
   * was 56 here and 28 in the resize panel. */
  const [customWidthCm, setCustomWidthCm] = useState(28);
  const [customHeightCm, setCustomHeightCm] = useState(21);
  const isCustom = profileId === 'custom';
  const customValid = customWidthCm >= 10 && customWidthCm <= 100 && customHeightCm >= 10 && customHeightCm <= 100;

  const selectedProfile = standardProfiles.find((profile) => profile.id === profileId) ?? defaultProfile;
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
    if (!cleanName || !selectedProfile || (isCustom && !customValid)) return;
    const clientIndex = source.startsWith('client-') ? Number(source.slice(7)) : -1;
    const selectedPhotoIds = source === 'all'
      ? photos.map((photo) => photo.id)
      : clientIndex >= 0
        ? clientAlbums[clientIndex]?.frames ?? []
        : [];
    onCreate({
      name: cleanName,
      baseProfileId: selectedProfile.id,
      closedWidthMm: isCustom ? Math.round(customWidthCm * 10) : selectedProfile.closedWidthMm,
      closedHeightMm: isCustom ? Math.round(customHeightCm * 10) : selectedProfile.closedHeightMm,
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
        <main className="album-library-grid">
          {albums.map((album) => {
            const profile = profiles.find((item) => item.id === album.productProfileId);
            const isLegacy = projectScoped && !album.projectId;
            /* Only a photograph the album genuinely places, and only one the
             * project still holds. No stand-in, no borrowed picture. */
            const cover = album.coverPhotoId
              ? photos.find((photo) => photo.id === album.coverPhotoId)
              : undefined;
            return (
              <div
                className="album-card"
                key={album.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(album.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(album.id); }}
              >
                <div className="album-card-img-wrap">
                  {cover?.url ? (
                    <img className="album-card-img" src={smallUrl(cover.url)} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div className="album-card-img album-card-img-empty">
                      <span><IcBook size={26} /></span>
                      <small>טרם שובצו תמונות</small>
                    </div>
                  )}
                  <div className="album-card-img-overlay" />

                  <div className="album-card-badges">
                    <span className={`album-card-badge${isLegacy ? ' is-legacy' : ''}`}>
                      <span className="album-card-dot" />
                      {isLegacy ? 'אלבום ישן' : 'טיוטה'}
                    </span>
                    {profile && (
                      <span className="album-card-size-badge" dir="ltr">
                        {profile.closedWidthMm / 10}×{profile.closedHeightMm / 10} ס״מ
                      </span>
                    )}
                  </div>

                  <div className="album-card-menu">
                    <button
                      type="button"
                      className="album-card-menu-btn"
                      aria-label={`פעולות נוספות עבור ${album.name}`}
                      aria-expanded={openMenu === album.id}
                      onClick={(event) => { event.stopPropagation(); setOpenMenu((current) => current === album.id ? null : album.id); }}
                    >•••</button>
                    {openMenu === album.id && (
                      <div className="album-context-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                        <button role="menuitem" onClick={() => startRename(album)}>שינוי שם</button>
                        <button role="menuitem" onClick={() => { onDuplicate(album.id); setOpenMenu(null); }}>שכפול</button>
                        <button role="menuitem" className="danger" onClick={() => { setDeleteId(album.id); setOpenMenu(null); }}>מחיקה</button>
                      </div>
                    )}
                  </div>

                  <time className="album-card-when" dateTime={album.updatedAt}>עודכן {whenLabel(album.updatedAt)}</time>

                  <div className="album-card-hover-action">
                    <span>פתח אלבום</span>
                    <IcChevron size={14} style={{ transform: 'rotate(180deg)' }} />
                  </div>
                </div>

                <div className="album-card-body">
                  <div className="album-card-title-row">
                    <h3>{album.name}</h3>
                    <span className="album-card-arrow" aria-hidden="true"><IcChevron size={16} style={{ transform: 'rotate(180deg)' }} /></span>
                  </div>

                  <div className="album-card-stats">
                    <div><span className="album-card-stat-val">{album.spreadCount}</span><span className="album-card-stat-lbl">כפולות</span></div>
                    <div><span className="album-card-stat-val">{album.photoCount}</span><span className="album-card-stat-lbl">תמונות</span></div>
                    <div>
                      <span className={`album-card-stat-val${album.photoCount && album.placedCount >= album.photoCount ? ' is-done' : ''}`}>
                        {album.placedCount}
                      </span>
                      <span className="album-card-stat-lbl">שובצו</span>
                    </div>
                  </div>
                </div>
              </div>
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
                <span>גודל האלבום</span>
                <select value={isCustom ? 'custom' : selectedProfile?.id ?? ''} onChange={(event) => setProfileId(event.target.value)}>
                  {standardProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {`${profile.closedWidthMm / 10}×${profile.closedHeightMm / 10} ס״מ`}
                    </option>
                  ))}
                  <option value="custom">מידה אחרת…</option>
                </select>
              </label>
              {isCustom && (
                <div className="album-create-size">
                  <label>
                    <span>רוחב</span>
                    <input type="number" min="10" max="100" step="0.5" value={customWidthCm} onChange={(event) => setCustomWidthCm(Number(event.target.value))} />
                  </label>
                  <i aria-hidden="true">×</i>
                  <label>
                    <span>גובה</span>
                    <input type="number" min="10" max="100" step="0.5" value={customHeightCm} onChange={(event) => setCustomHeightCm(Number(event.target.value))} />
                  </label>
                  <small>{customValid ? 'ס״מ · האלבום סגור' : 'רוחב וגובה 10–100 ס״מ'}</small>
                </div>
              )}
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
              <button className="album-primary-button" disabled={!name.trim() || !selectedProfile || (isCustom && !customValid)} onClick={submit}><IcSparkle size={15} /> צור אלבום</button>
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
