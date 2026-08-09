/* פרויקט חדש.
 *
 * ONE required field: who it is for. A photographer closing a wedding on the
 * phone will not walk a five-step wizard, and everything else — location,
 * price, deliverables — can be filled in הכנה or never. So the form opens with
 * the name focused and the primary action live the moment it has a value.
 *
 * The client field completes against clients already on file, because a
 * returning client is the most valuable asset in the business and retyping the
 * name is how one client quietly becomes two.
 *
 * This is one of the few dialogs the product allows (docs/DESIGN-DIRECTION.md
 * §17): it interrupts to take a single decision, and it is dismissible.
 */

import { useEffect, useRef, useState } from 'react';
import { createProject, knownClients } from '../store';
import type { Project } from '../store';
import { ALBUM_STYLES } from '../../album/styleEngine';

const EVENTS = ['חתונה', 'בר/בת מצווה', 'צילומי משפחה', 'ניו בורן', 'הריון', 'בוק תדמית', 'צילומי מוצר', 'אירוע'];
const COVER_STYLES = [
  { id: 'photo', label: 'כריכת תמונה' },
  { id: 'linen', label: 'כריכת בד' },
  { id: 'minimal', label: 'נקייה' },
] as const;

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function NewProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [client, setClient] = useState('');
  const [event, setEvent] = useState('');
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [hasGallery, setGallery] = useState(true);
  const [hasAlbum, setAlbum] = useState(false);
  const [albumWidth, setAlbumWidth] = useState('30');
  const [albumHeight, setAlbumHeight] = useState('30');
  const [albumStyle, setAlbumStyle] = useState('Fine Art');
  const [coverStyle, setCoverStyle] = useState<'photo' | 'linen' | 'minimal'>('photo');
  /* createProject refuses when the database is unreachable, because the only
   * thing it could do then is add a row to the in-memory mirror — which looks
   * exactly like success and is gone on the next reload. The refusal has to
   * reach the photographer, or the dialog just closes on a project that was
   * never created. */
  const [failed, setFailed] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clients = knownClients();
  const ready = client.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    if (step === 1) {
      setStep(2);
      return;
    }
    try {
      onCreated(
        createProject({
          client,
          event,
          date,
          location,
          price: price ? Number(price) : undefined,
          hasGallery,
          hasAlbum,
          albumPlan: hasAlbum ? {
            closedWidthCm: Number(albumWidth) || 30,
            closedHeightCm: Number(albumHeight) || 30,
            styleName: albumStyle,
            coverStyle,
          } : undefined,
        }),
      );
    } catch (err) {
      // The dialog STAYS OPEN, holding everything that was typed. Closing on a
      // failure would look like it worked and lose the form as well.
      setFailed((err as Error).message);
    }
  }

  return (
    <div className="project-create-overlay">
      <div className="project-create" role="dialog" aria-modal="true" aria-label="פרויקט חדש">
        <form onSubmit={submit}>
          <header className="project-create-header">
            <button type="button" onClick={onClose} aria-label="סגור">×</button>
            <div className="project-create-steps" aria-label={`שלב ${step} מתוך 2`}>
              <span className={step === 1 ? 'is-active' : 'is-done'}><b>1</b> הצילום</span>
              <i />
              <span className={step === 2 ? 'is-active' : ''}><b>2</b> תוצרים ותשלום</span>
            </div>
          </header>

          <div className="project-create-body">
            <aside>
              <span>פרויקט חדש</span>
              <h2>{step === 1 ? 'למי מצלמים?' : 'מה יוצא מהפרויקט?'}</h2>
              <p>{step === 1
                ? 'נתחיל מהפרטים שמגדירים את העבודה. את התמונות נוסיף מיד לאחר יצירת הפרויקט.'
                : 'בחר את התוצרים וסגור את הצד העסקי. אפשר לשנות את הכול גם בהמשך.'}</p>
              {step === 2 && (
                <div className="project-create-summary">
                  <small>הפרויקט עבור</small>
                  <strong>{client}</strong>
                  <span>{[event, date, location].filter(Boolean).join(' · ')}</span>
                </div>
              )}
            </aside>

            <section className="project-create-form">
              {step === 1 ? (
                <>
                  <label className="project-create-field is-wide">
                    <span>שם הלקוח</span>
                    <input ref={first} value={client} list="known-clients" onChange={(e) => setClient(e.target.value)} placeholder="לקוח קיים או חדש" autoComplete="off" />
                    <small>לקוח חדש ייווצר אוטומטית יחד עם הפרויקט</small>
                    <datalist id="known-clients">{clients.map((name) => <option key={name} value={name} />)}</datalist>
                  </label>
                  <label className="project-create-field is-wide">
                    <span>סוג הצילום</span>
                    <input value={event} list="event-types" onChange={(e) => setEvent(e.target.value)} placeholder="משפחה, חתונה, תדמית…" autoComplete="off" />
                    <datalist id="event-types">{EVENTS.map((name) => <option key={name} value={name} />)}</datalist>
                  </label>
                  <label className="project-create-field">
                    <span>תאריך</span>
                    <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="dd.mm" />
                  </label>
                  <label className="project-create-field">
                    <span>מיקום</span>
                    <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="אופציונלי" />
                  </label>
                </>
              ) : (
                <>
                  <label className="project-create-field is-wide">
                    <span>מחיר מוסכם</span>
                    <input value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} placeholder="₪ 0" />
                  </label>
                  <fieldset className="project-create-deliverables">
                    <legend>מה מוסרים ללקוח?</legend>
                    <label className={hasGallery ? 'is-selected' : ''}>
                      <input type="checkbox" checked={hasGallery} onChange={(e) => setGallery(e.target.checked)} />
                      <span><strong>גלריה לבחירה</strong><small>הלקוח יוכל לבחור תמונות בקישור אישי</small></span>
                    </label>
                    <label className={hasAlbum ? 'is-selected' : ''}>
                      <input type="checkbox" checked={hasAlbum} onChange={(e) => setAlbum(e.target.checked)} />
                      <span><strong>אלבום מודפס</strong><small>יופיע שלב אלבום כחלק מתהליך העבודה</small></span>
                    </label>
                    {hasAlbum && (
                      <div className="project-create-album-plan">
                        <div className="project-create-size-grid">
                          <label>
                            <span>רוחב סגור</span>
                            <input value={albumWidth} inputMode="decimal" onChange={(e) => setAlbumWidth(e.target.value.replace(/[^\d.]/g, ''))} />
                            <small>ס״מ</small>
                          </label>
                          <label>
                            <span>גובה סגור</span>
                            <input value={albumHeight} inputMode="decimal" onChange={(e) => setAlbumHeight(e.target.value.replace(/[^\d.]/g, ''))} />
                            <small>ס״מ</small>
                          </label>
                        </div>
                        <label className="project-create-select">
                          <span>סגנון פתיחה</span>
                          <select value={albumStyle} onChange={(event) => setAlbumStyle(event.target.value)}>
                            {ALBUM_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
                          </select>
                        </label>
                        <div className="project-create-cover-choice" role="group" aria-label="סוג כריכה">
                          {COVER_STYLES.map((cover) => (
                            <button
                              type="button"
                              key={cover.id}
                              className={coverStyle === cover.id ? 'is-selected' : ''}
                              onClick={() => setCoverStyle(cover.id)}
                            >
                              {cover.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <label className="is-selected is-fixed">
                      <input type="checkbox" checked readOnly />
                      <span><strong>קבצים סופיים</strong><small>כל פרויקט מסתיים במסירת הקבצים</small></span>
                    </label>
                  </fieldset>
                </>
              )}
            </section>
          </div>

          {failed && <div className="project-create-fault" role="alert">הפרויקט לא נוצר — {failed}</div>}

          <footer className="project-create-footer">
            <button type="button" className="is-quiet" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? 'ביטול' : 'חזרה'}</button>
            <button type="submit" className="is-primary" disabled={!ready}>{step === 1 ? 'המשך לפרטי המסירה' : 'יצירת הפרויקט'}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
