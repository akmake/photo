import { useMemo, useState } from 'react';
import { IcBook, IcCheck, IcChevron, IcGallery, IcSparkle } from '../design/Icons';
import type { AlbumPhoto, PrintProductProfile } from './model';
import type { AlbumCreateInput } from './AlbumLibrary';
import { ALBUM_STYLES } from './styleEngine';

interface Props {
  profiles: PrintProductProfile[];
  photos: AlbumPhoto[];
  /** What the couple chose, per album they were sold. An AlbumPhoto's id is
   *  frameKey(name) and the gallery answers in file names too, so this needs no
   *  translation — the client's choice IS a selection here. Absent when no
   *  gallery was published. See docs/CLIENT-GALLERY.md. */
  clientAlbums?: { name: string; frames: string[] }[];
  onCancel(): void;
  onComplete(input: AlbumCreateInput): void;
}

const STEPS = ['פורמט ומידות', 'בחירת תמונות', 'כיוון פתיחה', 'סגנון האלבום', 'כריכה ושם'];
const COVERS = [
  { id: 'photo', title: 'כריכת תמונה', text: 'תמונה מלאה בחזית' },
  { id: 'linen', title: 'כריכת בד', text: 'מראה שקט ועל־זמני' },
  { id: 'minimal', title: 'כריכה נקייה', text: 'צבע אחיד וטיפוגרפיה' },
];

export default function AlbumCreationWizard({ profiles, photos, clientAlbums, onCancel, onComplete }: Props) {
  const first = profiles[0];
  const [step, setStep] = useState(1);
  const [profileId, setProfileId] = useState(first?.id ?? '');
  const [widthCm, setWidthCm] = useState((first?.closedWidthMm ?? 300) / 10);
  const [heightCm, setHeightCm] = useState((first?.closedHeightMm ?? 300) / 10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openingDirection, setOpeningDirection] = useState<'rtl' | 'ltr'>('rtl');
  const [styleName, setStyleName] = useState('Fine Art');
  const [coverStyle, setCoverStyle] = useState<'photo' | 'linen' | 'minimal'>('photo');
  const [background, setBackground] = useState('#f8f6f1');
  const [name, setName] = useState('');
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedProfile = profiles.find((profile) => (
    profile.closedWidthMm === Math.round(widthCm * 10)
    && profile.closedHeightMm === Math.round(heightCm * 10)
  ));
  const previewPhotos = (selectedIds.length
    ? selectedIds.map((id) => photos.find((photo) => photo.id === id)).filter(Boolean)
    : photos).slice(0, 6) as AlbumPhoto[];
  const dimensionsValid = widthCm >= 10 && widthCm <= 100 && heightCm >= 10 && heightCm <= 100;
  const canContinue = step === 1 ? dimensionsValid : step === 2 ? selectedIds.length > 0 : step === 5 ? name.trim().length > 0 : true;

  function chooseProfile(profile: PrintProductProfile) {
    setProfileId(profile.id);
    setWidthCm(profile.closedWidthMm / 10);
    setHeightCm(profile.closedHeightMm / 10);
  }

  function updateDimension(kind: 'width' | 'height', value: number) {
    const nextWidth = kind === 'width' ? value : widthCm;
    const nextHeight = kind === 'height' ? value : heightCm;
    setWidthCm(nextWidth);
    setHeightCm(nextHeight);
    const match = profiles.find((profile) => (
      profile.closedWidthMm === Math.round(nextWidth * 10)
      && profile.closedHeightMm === Math.round(nextHeight * 10)
    ));
    setProfileId(match?.id ?? '');
  }

  function togglePhoto(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((photoId) => photoId !== id)
      : [...current, id]);
  }

  function finish() {
    if (!canContinue) return;
    onComplete({
      name: name.trim(),
      baseProfileId: profileId || undefined,
      closedWidthMm: Math.round(widthCm * 10),
      closedHeightMm: Math.round(heightCm * 10),
      styleName,
      background,
      selectedPhotoIds: selectedIds,
      openingDirection,
      coverStyle,
    });
  }

  return (
    <div className="album-wizard" dir="rtl">
      <header className="album-wizard-top">
        <button className="album-wizard-close" onClick={onCancel} aria-label="יציאה מאשף יצירת האלבום">×</button>
        <nav className="album-wizard-steps" aria-label="שלבי יצירת האלבום">
          {STEPS.map((label, index) => {
            const number = index + 1;
            return (
              <div className={`album-wizard-step${step === number ? ' active' : ''}${step > number ? ' done' : ''}`} key={label}>
                <span>{step > number ? <IcCheck size={13} /> : number}</span>
                <b>{label}</b>
                {index < STEPS.length - 1 && <i />}
              </div>
            );
          })}
        </nav>
      </header>

      <main className="album-wizard-main">
        {step === 1 && (
          <section className="album-wizard-stage">
            <div className="album-wizard-copy">
              <span className="album-wizard-kicker">שלב 1 מתוך 5</span>
              <h1>איזה אלבום אנחנו יוצרים?</h1>
              <p>בחרו פורמט ומידה. ההחלטה הזו קובעת את פרופורציות כל הכפולות באלבום.</p>
              <div className="album-wizard-specs">
                <span><IcBook size={16} /><b>{widthCm}×{heightCm} ס״מ</b> מידה סגורה</span>
                <span><IcGallery size={16} /><b>{photos.length}</b> תמונות זמינות בפרויקט</span>
              </div>
              <div className="album-wizard-dimensions">
                <label><span>רוחב</span><input type="number" min="10" max="100" step="0.5" value={widthCm} onChange={(event) => updateDimension('width', Number(event.target.value))} /><small>ס״מ</small></label>
                <i>×</i>
                <label><span>גובה</span><input type="number" min="10" max="100" step="0.5" value={heightCm} onChange={(event) => updateDimension('height', Number(event.target.value))} /><small>ס״מ</small></label>
              </div>
            </div>
            <BookPreview photos={previewPhotos} background={background} direction={openingDirection} />
            <div className="album-wizard-options album-wizard-formats">
              {profiles.map((profile) => (
                <button key={profile.id} className={selectedProfile?.id === profile.id ? 'selected' : ''} onClick={() => chooseProfile(profile)}>
                  <AlbumShape width={profile.closedWidthMm} height={profile.closedHeightMm} />
                  <span><b>{profile.closedWidthMm / 10}×{profile.closedHeightMm / 10}</b><small>{profile.closedWidthMm === profile.closedHeightMm ? 'מרובע' : profile.closedWidthMm > profile.closedHeightMm ? 'רוחב' : 'אורך'}</small></span>
                </button>
              ))}
              {!selectedProfile && <button className="selected custom"><AlbumShape width={widthCm} height={heightCm} /><span><b>{widthCm}×{heightCm}</b><small>מידה מותאמת</small></span></button>}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="album-wizard-stage album-wizard-photo-stage">
            <div className="album-wizard-section-head">
              <div><span className="album-wizard-kicker">שלב 2 מתוך 5</span><h1>אילו תמונות נכנסות לספר?</h1><p>בחרו לפי הסדר שבו תרצו להתחיל את הסיפור. ניתן לשנות את הסדר אחר כך.</p></div>
              <div className="album-wizard-selection-count"><strong>{selectedIds.length}</strong><span>מתוך {photos.length}</span></div>
              <div className="album-wizard-selection-actions">
                {/* The couple already did this work. Starting from their answer
                    is the whole reason the gallery feeds back into the project
                    instead of sitting in a browser tab somewhere. */}
                {clientAlbums?.map((album) => {
                  const known = new Set(photos.map((p) => p.id));
                  const frames = album.frames.filter((f) => known.has(f));
                  if (!frames.length) return null;
                  return (
                    <button key={album.name} onClick={() => setSelectedIds(frames)}>
                      בחירת הלקוח · {album.name} ({frames.length})
                    </button>
                  );
                })}
                <button onClick={() => setSelectedIds(photos.map((photo) => photo.id))}>בחירת הכול</button><button onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>ניקוי</button></div>
            </div>
            <div className="album-wizard-photo-grid">
              {photos.map((photo) => {
                const index = selectedIds.indexOf(photo.id);
                const selected = selectedSet.has(photo.id);
                return <button key={photo.id} className={selected ? 'selected' : ''} onClick={() => togglePhoto(photo.id)} aria-pressed={selected} aria-label={`${selected ? 'הסר' : 'בחר'} ${photo.name}`}><img src={photo.url} alt={photo.name} /><span>{selected ? index + 1 : <IcCheck size={14} />}</span></button>;
              })}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="album-wizard-stage album-wizard-choice-stage">
            <div className="album-wizard-section-head centered"><span className="album-wizard-kicker">שלב 3 מתוך 5</span><h1>לאיזה כיוון הספר נפתח?</h1><p>באלבום עברי החזית נמצאת מימין. אפשר לבחור פתיחה לועזית לפי הצורך.</p></div>
            <div className="album-wizard-big-choices">
              <button className={openingDirection === 'rtl' ? 'selected' : ''} onClick={() => setOpeningDirection('rtl')}><BookDirection rtl /><b>פתיחה מימין</b><span>עברית · מומלץ</span></button>
              <button className={openingDirection === 'ltr' ? 'selected' : ''} onClick={() => setOpeningDirection('ltr')}><BookDirection /><b>פתיחה משמאל</b><span>לועזית</span></button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="album-wizard-stage album-wizard-choice-stage">
            <div className="album-wizard-section-head centered"><span className="album-wizard-kicker">שלב 4 מתוך 5</span><h1>מה האופי של האלבום?</h1><p>זו נקודת הפתיחה לעיצוב. בתוך האלבום תוכלו לדייק כל כפולה בנפרד.</p></div>
            <div className="album-wizard-style-choices">
              {ALBUM_STYLES.map((style, index) => <button key={style.id} className={styleName === style.id ? 'selected' : ''} onClick={() => setStyleName(style.id)}><StylePreview variant={index} photos={previewPhotos} /><b>{style.label}</b><span>{style.description}</span></button>)}
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="album-wizard-stage album-wizard-final-stage">
            <div className="album-wizard-copy">
              <span className="album-wizard-kicker">שלב 5 מתוך 5</span>
              <h1>נותנים לאלבום זהות</h1>
              <p>בחרו כיוון לכריכה ותנו שם שאפשר לזהות מיד בספריית האלבומים.</p>
              <label className="album-wizard-name"><span>שם האלבום</span><input autoFocus value={name} placeholder="לדוגמה: משפחת כהן — קיץ 2026" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && finish()} /></label>
              <div className="album-wizard-palette"><span>צבע בסיס</span>{['#f8f6f1', '#f4efe7', '#e9e2d8', '#c9bfb2', '#222326'].map((color) => <button key={color} className={background === color ? 'selected' : ''} style={{ background: color }} onClick={() => setBackground(color)} aria-label={`צבע ${color}`} />)}</div>
            </div>
            <CoverPreview photos={previewPhotos} background={background} style={coverStyle} name={name} />
            <div className="album-wizard-options album-wizard-cover-options">
              {COVERS.map((cover) => <button key={cover.id} className={coverStyle === cover.id ? 'selected' : ''} onClick={() => setCoverStyle(cover.id as typeof coverStyle)}><span className={`cover-dot ${cover.id}`} /><span><b>{cover.title}</b><small>{cover.text}</small></span></button>)}
            </div>
          </section>
        )}
      </main>

      <footer className="album-wizard-footer">
        <button className="album-wizard-secondary" onClick={() => step === 1 ? onCancel() : setStep((current) => current - 1)}><IcChevron size={15} />{step === 1 ? 'ביטול' : 'חזרה'}</button>
        <div><span>שלב {step} מתוך 5</span><i><b style={{ width: `${step * 20}%` }} /></i></div>
        <button className="album-wizard-next" disabled={!canContinue} onClick={() => step === 5 ? finish() : setStep((current) => current + 1)}>{step === 5 ? <><IcSparkle size={16} />יצירת האלבום</> : <>לשלב הבא<IcChevron size={15} style={{ transform: 'rotate(180deg)' }} /></>}</button>
      </footer>
    </div>
  );
}

function AlbumShape({ width, height }: { width: number; height: number }) {
  const ratio = Math.max(.65, Math.min(1.55, width / height));
  return <span className="album-wizard-shape" style={{ width: `${34 * ratio}px` }}><i /></span>;
}

function BookPreview({ photos, background, direction }: { photos: AlbumPhoto[]; background: string; direction: 'rtl' | 'ltr' }) {
  return <div className="album-wizard-book-scene"><div className={`album-wizard-book ${direction}`} style={{ background }}><div className="page">{photos.slice(0, 3).map((photo) => <img key={photo.id} src={photo.url} alt="" />)}</div><i /><div className="page">{photos.slice(3, 6).map((photo) => <img key={photo.id} src={photo.url} alt="" />)}</div></div><span>תצוגת מוצר · {direction === 'rtl' ? 'פתיחה מימין' : 'פתיחה משמאל'}</span></div>;
}

function BookDirection({ rtl = false }: { rtl?: boolean }) {
  return <span className={`album-wizard-direction ${rtl ? 'rtl' : ''}`}><i /><b /><em>‹</em></span>;
}

function StylePreview({ variant, photos }: { variant: number; photos: AlbumPhoto[] }) {
  return <span className={`album-wizard-style-preview v${variant}`}>{photos.slice(0, variant === 0 ? 2 : variant === 1 ? 4 : 3).map((photo) => <img key={photo.id} src={photo.url} alt="" />)}</span>;
}

function CoverPreview({ photos, background, style, name }: { photos: AlbumPhoto[]; background: string; style: string; name: string }) {
  return <div className="album-wizard-cover-scene"><div className={`album-wizard-cover ${style}`} style={{ background }}>{style === 'photo' && photos[0] && <img src={photos[0].url} alt="" />}<span>{name || 'האלבום שלנו'}</span><i /></div><small>תצוגה מקדימה של הכריכה</small></div>;
}
