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

const EVENTS = ['חתונה', 'בר/בת מצווה', 'צילומי משפחה', 'ניו בורן', 'הריון', 'בוק תדמית', 'צילומי מוצר', 'אירוע'];

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
  const [client, setClient] = useState('');
  const [event, setEvent] = useState('');
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [hasGallery, setGallery] = useState(true);
  const [hasAlbum, setAlbum] = useState(false);
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
    onCreated(
      createProject({
        client,
        event,
        date,
        location,
        price: price ? Number(price) : undefined,
        hasGallery,
        hasAlbum,
      }),
    );
  }

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="פרויקט חדש"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="dialog-head">
            <h2>פרויקט חדש</h2>
            <button type="button" className="dialog-x" onClick={onClose} aria-label="סגור">✕</button>
          </div>

          <div className="dialog-body">
            <label className="fld fld-wide">
              <span>למי?</span>
              <input
                ref={first}
                className="field"
                value={client}
                list="known-clients"
                onChange={(e) => setClient(e.target.value)}
                placeholder="שם הלקוח — קיים או חדש"
                autoComplete="off"
              />
              <datalist id="known-clients">
                {clients.map((c) => <option key={c} value={c} />)}
              </datalist>
              <em>לקוח שאינו קיים ייווצר יחד עם הפרויקט</em>
            </label>

            <label className="fld">
              <span>סוג צילום</span>
              <input
                className="field"
                value={event}
                list="event-types"
                onChange={(e) => setEvent(e.target.value)}
                placeholder="חתונה, משפחה…"
                autoComplete="off"
              />
              <datalist id="event-types">
                {EVENTS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>

            <label className="fld">
              <span>תאריך הצילום</span>
              <input className="field" value={date} onChange={(e) => setDate(e.target.value)} placeholder="dd.mm" />
            </label>

            <label className="fld">
              <span>מיקום</span>
              <input className="field" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="אופציונלי" />
            </label>

            <label className="fld">
              <span>מחיר מוסכם</span>
              <input className="field" value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} placeholder="₪" />
            </label>

            {/* These two decide which stages the project even has. */}
            <fieldset className="fld fld-wide deliver">
              <span>מה מוסרים?</span>
              <div className="checks">
                <label>
                  <input type="checkbox" checked={hasGallery} onChange={(e) => setGallery(e.target.checked)} />
                  גלריה לבחירת הלקוח
                </label>
                <label>
                  <input type="checkbox" checked={hasAlbum} onChange={(e) => setAlbum(e.target.checked)} />
                  אלבום מודפס
                </label>
              </div>
              <em>אפשר לשנות בכל שלב. פרויקט בלי אלבום לא יציג שלב אלבום.</em>
            </fieldset>
          </div>

          <div className="dialog-foot">
            <button type="button" className="btn" onClick={onClose}>ביטול</button>
            <button type="submit" className="btn btn-primary" disabled={!ready}>
              צור ופתח
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
