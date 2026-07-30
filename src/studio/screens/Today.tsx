/* "היום" — the landing screen.
 *
 * WHAT WENT WRONG THE FIRST TWO TIMES, and why this is a different screen and
 * not a restyle of the last one:
 *
 * A queue of five sentences cannot hold a 1400px screen. Stretched to fill, it
 * produced two enormous half-empty boxes; left unstretched, it left the bottom
 * two thirds of the window blank. Either way the screen read as broken, and no
 * amount of spacing or contrast was going to fix a composition with nothing in
 * it.
 *
 * So the screen carries THE WORK ITSELF. Below the short "needs you" strip sits
 * the desk: every active job as a frame from that shoot, its stage, and its
 * counts. That is what a photographer opens the application to see, it is the
 * only content there is enough of to hold the space, and it is made of
 * photographs — which is the one material this product has and a generic admin
 * panel does not.
 *
 * Order in the queue is by real urgency, not recency: a waiting CLIENT outranks
 * money, money outranks a deadline.
 */

import type { SectionId } from '../nav';
import { IcCamera, IcCalendar } from '../../design/Icons';

type Urgency = 'client' | 'money' | 'deadline';

interface QueueItem {
  /** What happened. One short sentence, and it is the loudest thing in the row. */
  verb: string;
  /** Everything else on ONE muted line: who, how many, when. Spreading these
   *  across separate columns is what made the rows unreadable — the eye had to
   *  cross two empty gaps to assemble a single fact. */
  line: string;
  action: string;
  thumb: string;
  urgency: Urgency;
}

const QUEUE: QueueItem[] = [
  {
    verb: 'משפחת לוי סיימו לבחור 96 תמונות',
    line: 'צילומי משפחה · מתוך 380 · לפני שעה',
    action: 'התחל לערוך',
    thumb: '/demo/b.jpg',
    urgency: 'client',
  },
  {
    verb: 'רון ומאיה ביקשו 4 תיקונים באלבום',
    line: 'חתונה · גרסה 1 · אתמול 21:40',
    action: 'פתח את הכפולה',
    thumb: '/demo/c.jpg',
    urgency: 'client',
  },
  {
    verb: 'הגלריה של איתי כהן מוכנה ולא נשלחה',
    line: 'בר מצווה · 412 תמונות · ממתין 3 ימים',
    action: 'שלח ללקוח',
    thumb: '/demo/a.jpg',
    urgency: 'client',
  },
  {
    verb: 'סטודיו א.ד חייבים ₪2,400',
    line: 'צילומי מוצר · נמסר לפני 21 יום',
    action: 'פתח את הלקוח',
    thumb: '/demo/c.jpg',
    urgency: 'money',
  },
  {
    verb: 'הרינדור של משפחת ברק הסתיים · 3 נכשלו',
    line: 'ניו בורן · 214 קבצים · הבוקר 07:12',
    action: 'פתח את המסירה',
    thumb: '/demo/b.jpg',
    urgency: 'deadline',
  },
];

/* A project's stages, as the measure the whole product uses. `at` is the stage
 * the job is standing on; everything before it is done. */
const STAGE_LABELS = ['ייבוא', 'בחירה', 'עריכה', 'אלבום', 'מסירה'];

interface Job {
  client: string;
  event: string;
  date: string;
  thumb: string;
  at: number;
  counts: string;
  waiting?: string;
}

const JOBS: Job[] = [
  {
    client: 'משפחת לוי',
    event: 'צילומי משפחה',
    date: '24.07',
    thumb: '/demo/b.jpg',
    at: 2,
    counts: '96 בסט · 24 נערכו',
  },
  {
    client: 'רון ומאיה',
    event: 'חתונה',
    date: '12.07',
    thumb: '/demo/c.jpg',
    at: 3,
    counts: '18 כפולות · גרסה 1',
    waiting: 'ממתין ללקוח',
  },
  {
    client: 'בר מצווה איתי כהן',
    event: 'אירוע',
    date: '21.07',
    thumb: '/demo/a.jpg',
    at: 1,
    counts: '412 אחרי סינון',
  },
  {
    client: 'משפחת ברק',
    event: 'ניו בורן',
    date: '18.07',
    thumb: '/demo/b.jpg',
    at: 4,
    counts: '214 קבצים מוכנים',
  },
  {
    client: 'סטודיו א.ד',
    event: 'צילומי מוצר',
    date: '02.07',
    thumb: '/demo/c.jpg',
    at: 4,
    counts: 'נמסר · ₪2,400 פתוח',
  },
  {
    client: 'ליאת ואורי',
    event: 'חתונה',
    date: '31.07',
    thumb: '/demo/a.jpg',
    at: 0,
    counts: 'הצילום מחר',
  },
  {
    client: 'משפחת נחום',
    event: 'צילומי משפחה',
    date: '02.08',
    thumb: '/demo/b.jpg',
    at: 0,
    counts: 'טרם יובא',
  },
  {
    client: 'דנה שגב',
    event: 'הריון',
    date: '15.07',
    thumb: '/demo/c.jpg',
    at: 2,
    counts: '64 בסט · 64 נערכו',
  },
  {
    client: 'משפחת אלון',
    event: 'בוק תדמית',
    date: '09.07',
    thumb: '/demo/a.jpg',
    at: 1,
    counts: '208 אחרי סינון',
    waiting: 'ממתין ללקוח',
  },
];

export default function Today({ onSection }: { onSection: (s: SectionId) => void }) {
  const now = new Date();
  const day = now.toLocaleDateString('he-IL', { weekday: 'long' });
  const date = now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });

  return (
    <div className="today">
      <header className="today-head">
        <h1>
          {day}
          <span className="today-date">{date}</span>
        </h1>
        <div className="today-shoot">
          <IcCamera size={15} />
          <span>אין צילום היום · הבא <b>מחר 17:00</b></span>
        </div>
      </header>

      <div className="today-top">
        <section aria-label="דורש ממך משהו">
          <div className="sec-bar">
            <h2>דורש ממך משהו</h2>
            <span className="sec-n mono">{QUEUE.length}</span>
          </div>
          <ul className="queue">
            {QUEUE.map((item) => (
              <li key={item.verb}>
                <button className={`q-row u-${item.urgency}`} onClick={() => onSection('projects')}>
                  <img className="q-thumb" src={item.thumb} alt="" loading="lazy" />
                  <span className="q-main">
                    <b>{item.verb}</b>
                    <span className="q-sub">{item.line}</span>
                  </span>
                  <span className="q-action">{item.action}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside aria-label="צילומים קרובים">
          <div className="sec-bar">
            <h2>הקרוב ביותר</h2>
            <button className="sec-link" onClick={() => onSection('calendar')}>
              <IcCalendar size={14} />
              היומן
            </button>
          </div>
          <ul className="up-list">
            <li>
              <button className="up-row" onClick={() => onSection('calendar')}>
                <span className="up-when"><b>מחר</b><span className="mono">31.07</span></span>
                <span className="up-main"><b>ליאת ואורי</b><span>חתונה · גני התערוכה</span></span>
                <span className="up-time mono">17:00</span>
              </button>
            </li>
            <li>
              <button className="up-row" onClick={() => onSection('calendar')}>
                <span className="up-when"><b>שישי</b><span className="mono">02.08</span></span>
                <span className="up-main"><b>משפחת נחום</b><span>משפחה · הבית</span></span>
                <span className="up-time mono">08:30</span>
              </button>
            </li>
            <li>
              <button className="up-row" onClick={() => onSection('calendar')}>
                <span className="up-when"><b>ראשון</b><span className="mono">04.08</span></span>
                <span className="up-main"><b>סטודיו א.ד</b><span>מוצר · סטודיו</span></span>
                <span className="up-time mono">11:00</span>
              </button>
            </li>
            <li>
              <button className="up-row" onClick={() => onSection('calendar')}>
                <span className="up-when"><b>רביעי</b><span className="mono">07.08</span></span>
                <span className="up-main"><b>איתי כהן</b><span>בר מצווה</span></span>
                <span className="up-time mono">18:00</span>
              </button>
            </li>
          </ul>
        </aside>
      </div>

      {/* The desk. This is what actually holds the screen. */}
      <section className="desk" aria-label="העבודות שעל השולחן">
        <div className="sec-bar">
          <h2>על השולחן</h2>
          <span className="sec-n mono">{JOBS.length}</span>
          <button className="sec-link" onClick={() => onSection('projects')}>
            כל הפרויקטים
          </button>
        </div>

        <div className="jobs">
          {JOBS.map((job) => (
            <button key={job.client} className="job" onClick={() => onSection('projects')}>
              <span className="job-frame">
                <img src={job.thumb} alt="" loading="lazy" />
                {job.waiting && <span className="job-wait">{job.waiting}</span>}
              </span>
              <span className="job-name">{job.client}</span>
              <span className="job-meta">
                {job.event}
                <i>·</i>
                <span className="mono">{job.date}</span>
              </span>
              <span className="job-measure" aria-hidden="true">
                {STAGE_LABELS.map((label, i) => (
                  <span
                    key={label}
                    className={`seg ${i < job.at ? 'done' : ''} ${i === job.at ? 'on' : ''}`}
                    title={label}
                  />
                ))}
              </span>
              <span className="job-counts mono">{job.counts}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="today-foot">
        <span><b className="mono">5</b> פרויקטים פעילים</span>
        <i />
        <span><b className="mono">2</b> ממתינים ללקוח</span>
        <i />
        <span><b className="mono">1</b> בעריכה</span>
        <i />
        <span><b className="mono">₪7,800</b> לגבייה</span>
        <span className="build-note">נתוני דמה</span>
      </footer>
    </div>
  );
}
