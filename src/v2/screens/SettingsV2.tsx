/* הגדרות.
 *
 * Only what is actually true of this installation: where new projects are
 * created on disk, whether the local engine is answering, and where the
 * records file sits. There is no account here and no subscription, because
 * this product has neither — a screen that offers to manage a plan that does
 * not exist is the same lie as a list of invented clients.
 *
 * "כישלון אינו ביטול" (CLAUDE.md §6). The folder picker can come back empty
 * for two completely different reasons, and they get two different messages:
 * closing the window is nothing, and a picker that broke is something.
 */

import React, { useEffect, useState } from 'react';
import { getWorkspaceRoot, reload, setWorkspaceRoot, useStudio } from '../../studio/store';
import { pickFolder } from '../../api';
import { dbHealth } from '../../db';
import type { DbHealth } from '../../db';
import './today-redesign.css';
import './business-v2.css';

export default function SettingsV2() {
  const { projects, status, fault, saveFault } = useStudio();
  const [root, setRoot] = useState<string | null>(null);
  const [rootRead, setRootRead] = useState(false);
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const where = await getWorkspaceRoot();
      if (alive) { setRoot(where); setRootRead(true); }
    })();
    void (async () => {
      const state = await dbHealth();
      if (alive) setHealth(state);
    })();
    return () => { alive = false; };
  }, []);

  async function chooseFolder() {
    setBusy(true);
    setNote(null);
    setProblem(null);
    try {
      const folder = await pickFolder();
      if (!folder) {
        // Closed the window. Nothing happened, and nothing needs saying loudly.
        setNote('לא נבחרה תיקייה. שום דבר לא השתנה.');
        return;
      }
      const saved = await setWorkspaceRoot(folder);
      setRoot(saved);
      setNote('התיקייה נשמרה. פרויקטים חדשים ייווצרו כאן.');
    } catch (e) {
      // The picker itself failed. This is NOT a cancellation, and reporting it
      // as one is how a button that does nothing becomes impossible to debug.
      setProblem((e as Error).message || 'בחירת התיקייה נכשלה.');
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    setNote(null);
    setProblem(null);
    try {
      setHealth(await dbHealth());
      reload();
      setNote('נבדק מחדש.');
    } finally {
      setBusy(false);
    }
  }

  const records = health?.counts
    ? Object.values(health.counts).reduce((sum, n) => sum + n, 0)
    : null;

  return (
    <div className="tz-biz-container">
      <section className="tz-biz-head">
        <div>
          <div className="tz-biz-eyebrow">המערכת</div>
          <h1>הגדרות</h1>
          <p>איפה נשמרות העבודות שלך, ומה מצב המנוע שרץ על המחשב הזה.</p>
        </div>
      </section>

      {note && <div className="tz-biz-note">{note}</div>}
      {problem && <div className="tz-biz-problem">{problem}</div>}

      <div className="tz-set-grid">
        <div className="tz-card tz-set-block">
          <h2>תיקיית העבודה</h2>
          <p>כאן נפתחת תיקייה לכל פרויקט חדש. התמונות שכבר על הדיסק לא זזות משום מקום.</p>
          <div className="tz-set-value" dir="ltr">
            {!rootRead ? 'בודקים…' : root || '— טרם נבחרה תיקייה —'}
          </div>
          <button className="tz-btn-peach" type="button" onClick={chooseFolder} disabled={busy}>
            {root ? 'בחירת תיקייה אחרת' : 'בחירת תיקייה'}
          </button>
        </div>

        <div className="tz-card tz-set-block">
          <h2>המנוע המקומי</h2>
          <p>התוכנה עובדת מול מנוע שרץ על המחשב הזה בלבד. בלעדיו אין קריאה מהדיסק ואין שמירה.</p>
          <div className="tz-set-rows">
            <div>
              <span>מצב</span>
              <strong className={status === 'ready' ? 'is-good' : status === 'loading' ? '' : 'is-bad'}>
                {status === 'ready' ? 'מחובר' : status === 'loading' ? 'בבדיקה' : 'לא מגיב'}
              </strong>
            </div>
            <div>
              <span>כתובת</span>
              <strong dir="ltr">127.0.0.1:8756</strong>
            </div>
            {fault && (
              <div>
                <span>הסיבה</span>
                <strong className="is-bad">{fault}</strong>
              </div>
            )}
            {saveFault && (
              <div>
                <span>שמירה אחרונה</span>
                <strong className="is-bad">{saveFault}</strong>
              </div>
            )}
          </div>
          <button className="tz-btn-peach" type="button" onClick={recheck} disabled={busy}>
            בדיקה מחדש
          </button>
        </div>

        <div className="tz-card tz-set-block">
          <h2>קובץ הנתונים</h2>
          <p>כל מה שהתוכנה יודעת על העבודה יושב בקובץ אחד. אפשר להעתיק אותו לגיבוי.</p>
          <div className="tz-set-value" dir="ltr">
            {health ? health.uri || '—' : 'בודקים…'}
          </div>
          <div className="tz-set-rows">
            <div>
              <span>פרויקטים</span>
              <strong>{status === 'ready' ? projects.length : '—'}</strong>
            </div>
            <div>
              <span>רשומות בסך הכול</span>
              <strong>{records === null ? '—' : records.toLocaleString('he-IL')}</strong>
            </div>
          </div>
          {health && !health.ok && (
            <div className="tz-biz-problem">{health.error || 'קובץ הנתונים לא נקרא.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
