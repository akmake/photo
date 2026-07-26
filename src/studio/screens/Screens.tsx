/* The screens around the editor.
 *
 * These describe work this build does not perform yet. Each one carries a
 * visible "demo data" note, because a screen that shows invented numbers as if
 * they were real is worse than an empty screen — the photographer would plan
 * against them.
 */

import { CLIENTS, PROJECT } from '../demo';
import type { StageId } from '../nav';
import {
  IcCheckCircle, IcFilter, IcGallery, IcHeart, IcSparkle, IcUpload,
} from '../../design/Icons';

function DemoNote({ what }: { what: string }) {
  return (
    <div className="demo-note">
      <IcSparkle size={16} />
      <span>נתוני דמה — {what} עדיין לא מחובר למנוע.</span>
    </div>
  );
}

function Head({ title, sub, action }: { title: string; sub: string; action?: JSX.Element }) {
  return (
    <div className="screen-head">
      <div>
        <h2>{title}</h2>
        <div className="card-sub">{sub}</div>
      </div>
      {action}
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="stat">
      <b>{typeof n === 'number' ? n.toLocaleString('he-IL') : n}</b>
      <span>{label}</span>
    </div>
  );
}

function Tiles({ n }: { n: number }) {
  return (
    <div className="tile-grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="tile">
          <IcGallery size={26} />
        </div>
      ))}
    </div>
  );
}

export function GalleryUpload() {
  return (
    <>
      <Head
        title="העלאת גלריה"
        sub="העלאת קבצי המקור מהצילום"
        action={<button className="btn btn-primary"><IcUpload size={17} />העלאת תמונות</button>}
      />
      <DemoNote what="ההעלאה" />
      <div className="stat-row">
        <Stat n={PROJECT.originals} label="תמונות בגלריה" />
        <Stat n="RAW + JPG" label="סוגי קבצים" />
        <Stat n="42.6 GB" label="נפח" />
        <Stat n={PROJECT.shootDate} label="תאריך צילום" />
      </div>
      <section className="card card-pad">
        <div className="card-title">תצוגה מקדימה</div>
        <div style={{ marginTop: 14 }}>
          <Tiles n={12} />
        </div>
      </section>
    </>
  );
}

export function GalleryCull() {
  const kept = PROJECT.afterCull;
  const dropped = PROJECT.originals - kept;
  return (
    <>
      <Head
        title="סינון גלריה"
        sub="הסרת כפולות, עיניים עצומות ותמונות לא חדות"
        action={<button className="btn btn-primary"><IcFilter size={17} />הרצת סינון</button>}
      />
      <DemoNote what="הסינון האוטומטי" />
      <div className="stat-row">
        <Stat n={PROJECT.originals} label="נכנסו" />
        <Stat n={kept} label="נותרו" />
        <Stat n={dropped} label="הוסרו" />
        <Stat n={`${Math.round((dropped / PROJECT.originals) * 100)}%`} label="שיעור סינון" />
      </div>
      <section className="card card-pad">
        <div className="card-title">מה הוסר</div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>סיבה</th><th>כמות</th></tr>
          </thead>
          <tbody>
            <tr><td>כפולות כמעט־זהות</td><td>318</td></tr>
            <tr><td>עיניים עצומות</td><td>142</td></tr>
            <tr><td>חוסר חדות</td><td>96</td></tr>
            <tr><td>חשיפה קיצונית</td><td>40</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

export function GalleryPicked() {
  return (
    <>
      <Head
        title="תמונות שנבחרו"
        sub="הבחירה של הלקוחה מתוך הגלריה"
        action={<button className="btn"><IcHeart size={17} />ייצוא רשימה</button>}
      />
      <DemoNote what="בחירת הלקוחה" />
      <div className="stat-row">
        <Stat n={PROJECT.clientPicked} label="נבחרו" />
        <Stat n={PROJECT.afterCull} label="הוצגו" />
        <Stat n="12.05.2024" label="תאריך בחירה" />
        <Stat n="הושלם" label="סטטוס" />
      </div>
      <section className="card card-pad">
        <div className="card-title">הנבחרות</div>
        <div style={{ marginTop: 14 }}>
          <Tiles n={16} />
        </div>
      </section>
    </>
  );
}

export function AlbumDesign() {
  return (
    <>
      <Head title="עיצוב אלבום" sub="פריסת דפים והרכבת האלבום" />
      <DemoNote what="עיצוב האלבום" />
      <section className="card card-pad">
        <div className="card-title">פריסות</div>
        <div style={{ marginTop: 14 }}>
          <Tiles n={8} />
        </div>
      </section>
    </>
  );
}

export function Clients() {
  return (
    <>
      <Head title="לקוחות" sub="כל הפרויקטים והלקוחות בסטודיו" />
      <DemoNote what="ניהול הלקוחות" />
      <section className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>לקוחה</th><th>סוג אירוע</th><th>תאריך</th>
              <th>תמונות</th><th>שלב</th>
            </tr>
          </thead>
          <tbody>
            {CLIENTS.map((c) => (
              <tr key={c.name}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{c.event}</td>
                <td>{c.date}</td>
                <td>{c.photos.toLocaleString('he-IL')}</td>
                <td>
                  <span className={`pill ${c.state === 'done' ? 'pill-ok' : 'pill-run'}`}>
                    {c.state === 'done' && <IcCheckCircle size={13} />}
                    {c.stage}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function Home() {
  return (
    <>
      <Head title="דף הבית" sub="מבט על על הסטודיו" />
      <DemoNote what="לוח המחוונים" />
      <div className="stat-row">
        <Stat n={5} label="פרויקטים פעילים" />
        <Stat n={3} label="ממתינים לבחירת לקוחה" />
        <Stat n={1} label="בעיבוד" />
        <Stat n={2} label="לאלבום" />
      </div>
      <section className="card card-pad">
        <div className="card-title">פרויקטים אחרונים</div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>לקוחה</th><th>אירוע</th><th>שלב</th></tr>
          </thead>
          <tbody>
            {CLIENTS.slice(0, 4).map((c) => (
              <tr key={c.name}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{c.event}</td>
                <td>
                  <span className={`pill ${c.state === 'done' ? 'pill-ok' : 'pill-run'}`}>
                    {c.stage}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function Simple({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <Head title={title} sub={sub} />
      <DemoNote what={title} />
      <section className="card card-pad" style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <IcSparkle size={30} />
          <div style={{ marginTop: 10 }}>המסך הזה יבנה בשלב הבא.</div>
        </div>
      </section>
    </>
  );
}

export const STAGE_SCREENS: Partial<Record<StageId, () => JSX.Element>> = {
  'gallery-upload': GalleryUpload,
  'gallery-cull': GalleryCull,
  'gallery-picked': GalleryPicked,
  'album-design': AlbumDesign,
};
