import { useState } from 'react';
import { IcBook, IcChevron, IcSparkle } from '../design/Icons';
import type { AlbumSummary } from './albumStorage';
import type { AlbumPhoto, PrintProductProfile } from './model';
import AlbumCreationWizard from './AlbumCreationWizard';

interface Props {
  albums: AlbumSummary[];
  profiles: PrintProductProfile[];
  photos: AlbumPhoto[];
  /** The client's own choice per album, passed through to the wizard so a new
   *  album can start from what the couple picked. */
  clientAlbums?: { name: string; frames: string[] }[];
  /** Back to the project this album belongs to. Absent on the legacy standalone
   *  route, where there is no project to return to. */
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
  albums, profiles, photos, clientAlbums, onBack, onOpen, onCreate, onRename, onDuplicate, onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [widthCm, setWidthCm] = useState((profiles[0]?.closedWidthMm ?? 300) / 10);
  const [heightCm, setHeightCm] = useState((profiles[0]?.closedHeightMm ?? 300) / 10);
  const [styleName, setStyleName] = useState('Fine Art');
  const [background, setBackground] = useState('#f8f6f1');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({
      name: trimmed,
      baseProfileId: profileId || undefined,
      closedWidthMm: Math.round(widthCm * 10),
      closedHeightMm: Math.round(heightCm * 10),
      styleName,
      background,
    });
    setName('');
    setCreating(false);
  }

  const selectedProfile = profiles.find((profile) => (
    profile.closedWidthMm === Math.round(widthCm * 10)
    && profile.closedHeightMm === Math.round(heightCm * 10)
  ));
  const dimensionsValid = widthCm >= 10 && widthCm <= 100 && heightCm >= 10 && heightCm <= 100;

  return (
    <div className="album-library">
      <header className="library-head">
        {onBack && (
          <button className="library-back" onClick={onBack} title="חזרה לפרויקט">
            <IcChevron size={16} style={{ transform: 'rotate(180deg)' }} />
            <span>הפרויקט</span>
          </button>
        )}
        <div>
          <strong>האלבומים שלי</strong>
          <span>{albums.length ? `${albums.length} אלבומים` : 'עוד לא נוצרו אלבומים'}</span>
        </div>
        <button className="library-new" onClick={() => setCreating(true)}>
          <IcSparkle size={16} />אלבום חדש
        </button>
      </header>

      {creating && (
        <AlbumCreationWizard
          profiles={profiles}
          photos={photos}
          clientAlbums={clientAlbums}
          onCancel={() => setCreating(false)}
          onComplete={(input) => {
            onCreate(input);
            setCreating(false);
          }}
        />
      )}

      {false && creating && (
        <div className="library-create-backdrop">
          <section
            className="library-create"
            role="dialog"
            aria-modal="true"
            aria-label="הגדרת אלבום חדש"
          >
            <header>
              <div><strong>אלבום חדש</strong><span>הגדירי את מוצר הדפוס לפני בחירת התמונות</span></div>
              <button onClick={() => setCreating(false)} aria-label="סגירה">×</button>
            </header>

            <div className="library-create-body">
              <label className="library-create-name">
                <span>שם האלבום</span>
                <input
                  autoFocus
                  value={name}
                  placeholder="לדוגמה: מלי כץ — בת מצווה"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                    if (event.key === 'Escape') setCreating(false);
                  }}
                />
              </label>

              <div className="library-create-field">
                <span>סוג אלבום</span>
                <div className="library-create-readonly"><IcBook size={17} /><b>אלבום Layflat</b><small>פתיחה שטוחה</small></div>
              </div>

              <div className="library-create-field library-create-size-field">
                <span>מידות האלבום הסגור</span>
                <div className="library-create-dimensions">
                  <label>
                    <span>רוחב</span>
                    <input
                      type="number"
                      min="10"
                      max="100"
                      step="0.5"
                      value={widthCm}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setWidthCm(next);
                        const match = profiles.find((profile) => (
                          profile.closedWidthMm === Math.round(next * 10)
                          && profile.closedHeightMm === Math.round(heightCm * 10)
                        ));
                        setProfileId(match?.id ?? '');
                      }}
                    />
                    <small>ס״מ</small>
                  </label>
                  <span aria-hidden="true">×</span>
                  <label>
                    <span>גובה</span>
                    <input
                      type="number"
                      min="10"
                      max="100"
                      step="0.5"
                      value={heightCm}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setHeightCm(next);
                        const match = profiles.find((profile) => (
                          profile.closedWidthMm === Math.round(widthCm * 10)
                          && profile.closedHeightMm === Math.round(next * 10)
                        ));
                        setProfileId(match?.id ?? '');
                      }}
                    />
                    <small>ס״מ</small>
                  </label>
                </div>
                <span className="library-create-shortcuts-label">מידות שמורות</span>
                <div className="library-create-sizes">
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      className={
                        profile.closedWidthMm === Math.round(widthCm * 10)
                        && profile.closedHeightMm === Math.round(heightCm * 10) ? 'on' : ''
                      }
                      onClick={() => {
                        setProfileId(profile.id);
                        setWidthCm(profile.closedWidthMm / 10);
                        setHeightCm(profile.closedHeightMm / 10);
                      }}
                    >
                      <b>{profile.closedWidthMm / 10}×{profile.closedHeightMm / 10} ס״מ</b>
                      <small>{profile.closedWidthMm === profile.closedHeightMm ? 'מרובע' : profile.closedWidthMm > profile.closedHeightMm ? 'רוחב' : 'אורך'}</small>
                    </button>
                  ))}
                </div>
              </div>

              <label>
                <span>סגנון עיצוב</span>
                <select value={styleName} onChange={(event) => setStyleName(event.target.value)}>
                  <option>Fine Art</option>
                  <option>נקי ומודרני</option>
                  <option>קלאסי</option>
                </select>
              </label>

              <div className="library-create-field">
                <span>רקע ברירת מחדל</span>
                <div className="library-create-palette">
                  {['#f8f6f1', '#f4efe7', '#e9e2d8', '#c9bfb2', '#222326'].map((color) => (
                    <button
                      key={color}
                      className={background === color ? 'on' : ''}
                      style={{ background: color }}
                      onClick={() => setBackground(color)}
                      aria-label={`רקע ${color}`}
                    />
                  ))}
                </div>
              </div>

              <div className="library-create-summary">
                <span>{selectedProfile ? 'פרופיל שמור' : 'מידה מותאמת חדשה'}</span>
                <strong>{selectedProfile?.name ?? `אלבום ${widthCm}×${heightCm} ס״מ`}</strong>
                <small>
                  {selectedProfile
                    ? `${selectedProfile?.targetPpi} PPI · ${selectedProfile?.outputFormat.toUpperCase()} · ${selectedProfile?.verified ? 'פרופיל מאומת' : 'נדרש אימות מול בית הדפוס'}`
                    : 'ייווצר פרופיל הדפסה חדש ויישמר לשימוש עתידי'}
                </small>
              </div>
            </div>

            <footer className="library-create-actions">
              <button className="ghost" onClick={() => setCreating(false)}>ביטול</button>
              <button className="primary" onClick={submit} disabled={!name.trim() || !dimensionsValid}>
                יצירת אלבום והוספת תמונות
              </button>
            </footer>
          </section>
        </div>
      )}

      {albums.length ? (
        <div className="library-grid">
          {albums.map((album) => {
            const profile = profiles.find((item) => item.id === album.productProfileId);
            const progress = album.photoCount
              ? Math.min(100, Math.round((album.placedCount / album.photoCount) * 100))
              : 0;
            const isComplete = album.photoCount > 0 && album.placedCount >= album.photoCount;
            return (
              <article key={album.id} className="library-card">
                <button className="library-open" onClick={() => onOpen(album.id)}>
                  <span className="library-preview" aria-hidden="true">
                    <span className="library-album-object">
                      <i className="library-album-pages" />
                      <i className="library-album-spine" />
                      <span className="library-album-mark"><IcBook size={19} /></span>
                      <small>{album.name}</small>
                    </span>
                  </span>

                  <span className="library-card-body">
                    <span className="library-card-meta">
                      <span className={`library-state ${isComplete ? 'complete' : ''}`}>
                        {isComplete ? 'מוכן להגהה' : 'בעבודה'}
                      </span>
                      <time dateTime={album.updatedAt}>עודכן {whenLabel(album.updatedAt)}</time>
                    </span>
                    <b>{album.name}</b>
                    <span className="library-product">{profile?.name ?? 'מוצר לא ידוע'}</span>
                    <span className="library-card-stats">
                      <span>{album.spreadCount === 1 ? 'כפולה אחת' : `${album.spreadCount} כפולות`}</span>
                      <i aria-hidden="true" />
                      <span>{album.photoCount ? `${album.placedCount} מתוך ${album.photoCount} תמונות שובצו` : 'טרם נבחרו תמונות'}</span>
                    </span>
                    <span className="library-progress-head">
                      <span>התקדמות האלבום</span>
                      <span>{progress}%</span>
                    </span>
                    <span className="library-progress" aria-label={`${progress}% מהתמונות שובצו`}>
                      <i style={{ width: `${progress}%` }} />
                    </span>
                    <span className="library-open-cta">
                      פתיחת האלבום
                      <IcChevron size={14} style={{ transform: 'rotate(180deg)' }} />
                    </span>
                  </span>
                </button>
                <footer className="library-actions">
                  <button
                    className="library-more"
                    aria-label={`פעולות נוספות עבור ${album.name}`}
                    aria-expanded={openMenu === album.id}
                    onClick={() => {
                      setConfirmDelete(null);
                      setOpenMenu((current) => current === album.id ? null : album.id);
                    }}
                  ><i /><i /><i /></button>
                  {openMenu === album.id && (
                    <div className="library-menu" role="menu">
                      <button role="menuitem" onClick={() => {
                        const next = window.prompt('שם חדש לאלבום', album.name);
                        if (next && next.trim()) onRename(album.id, next.trim());
                        setOpenMenu(null);
                      }}>שינוי שם</button>
                      <button role="menuitem" onClick={() => { onDuplicate(album.id); setOpenMenu(null); }}>שכפול אלבום</button>
                      {confirmDelete === album.id ? (
                        <div className="library-delete-confirm">
                          <span>למחוק את האלבום?</span>
                          <button className="danger" onClick={() => {
                            onDelete(album.id);
                            setConfirmDelete(null);
                            setOpenMenu(null);
                          }}>מחיקה</button>
                          <button onClick={() => setConfirmDelete(null)}>ביטול</button>
                        </div>
                      ) : (
                        <button role="menuitem" className="danger" onClick={() => setConfirmDelete(album.id)}>מחיקה</button>
                      )}
                    </div>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : !creating && (
        <div className="library-blank">
          <IcBook size={30} />
          <strong>אין עדיין אלבומים</strong>
          <span>כל אלבום נשמר אצלך במחשב ואפשר לחזור אליו בכל רגע</span>
          <button className="library-new" onClick={() => setCreating(true)}>
            <IcSparkle size={16} />יצירת האלבום הראשון
          </button>
        </div>
      )}
    </div>
  );
}
