/* אלבום חכם — the AI album, built standalone.
 *
 * Deliberately NOT the project's AlbumStudio: that one is wired to a job's
 * frames and its whole layout/proofing machinery. This is the sandbox where the
 * understanding→selection→layout pipeline is built from nothing, on a folder the
 * photographer points at, so it can move fast without touching a real project.
 *
 * It reuses only the low-level engine plumbing — pickFolder, listImages, thumb —
 * never a project tool. The pixels stay on disk; the engine serves the
 * thumbnails.
 *
 * The pipeline on the side (docs/RESEARCH-album-ai.md §5) is the roadmap, and it
 * SAYS so: only קליטה is real today. Nothing here draws a result it did not
 * compute — an empty folder reads "no photos here", a failed read reads "could
 * not read", and the two are never the same screen (CLAUDE.md §3).
 */

import { useState } from 'react';
import { listImages, pickFolder, thumbUrl } from '../api';
import { IcChevron, IcFolderOpen, IcSparkle } from '../design/Icons';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface Stage {
  id: string;
  label: string;
  note: string;
}

/* The seven-agent pipeline, minus the person-head that only exists once there is
 * data to train it. Order follows the research doc. */
const PIPELINE: Stage[] = [
  { id: 'ingest', label: 'קליטה', note: 'קריאת התיקייה וטביעת אצבע ויזואלית לכל פריים' },
  { id: 'cull', label: 'סינון', note: 'עיניים עצומות, ראש הצידה, טשטוש, חשיפה' },
  { id: 'dedup', label: 'דה-דופ', note: 'איחוד רצפים כמעט-זהים לטובה שבהן' },
  { id: 'cluster', label: 'קיבוץ', note: 'חלוקה לרגעים לפי דמיון וזמן' },
  { id: 'curate', label: 'אצירה', note: 'גיבור ותומכות לכל רגע' },
  { id: 'layout', label: 'פריסה', note: 'סידור לכפולות מעוצבות' },
];

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export default function AlbumAI({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [folder, setFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    let picked: string | null;
    try {
      picked = await pickFolder();
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
      return;
    }
    // A cancelled dialog is an answer, not a failure — leave the screen as it was.
    if (!picked) return;
    setFolder(picked);
    setStatus('loading');
    setError(null);
    try {
      const { files: found } = await listImages(picked);
      setFiles(found);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  }

  // Only the first stage lights up, and only once a folder is actually read.
  // The rest wear "בבנייה" because they are — no invented progress.
  const activeStage = status === 'ready' && files.length ? 'ingest' : null;

  return (
    <div className="albumx">
      <header className="albumx-top">
        <button className="albumx-back" onClick={onBack}>
          <IcChevron size={18} />
          <span>כלים בניסיון</span>
        </button>

        <div className="albumx-title">
          <span className="albumx-mark"><IcSparkle size={18} /></span>
          <h1>אלבום חכם</h1>
          <span className="albumx-flag">ניסיוני</span>
        </div>

        <button className="btn btn-primary albumx-choose" onClick={choose}>
          <IcFolderOpen size={17} />
          {folder ? 'תיקייה אחרת' : 'בחר תיקיית תמונות'}
        </button>
      </header>

      <div className="albumx-body">
        <aside className="albumx-rail">
          <p className="label">הצנרת</p>
          <ol className="albumx-stages">
            {PIPELINE.map((s, i) => {
              const on = s.id === activeStage;
              return (
                <li key={s.id} className={`albumx-stage ${on ? 'on' : ''}`}>
                  <span className="albumx-step">{i + 1}</span>
                  <div className="albumx-stage-copy">
                    <b>{s.label}</b>
                    <small>{s.note}</small>
                  </div>
                  <span className={`pill ${on ? 'pill-run' : 'pill-idle'}`}>
                    {on ? 'פעיל' : 'בבנייה'}
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>

        <main className="albumx-main scroll-y">
          {status === 'idle' && (
            <div className="albumx-empty rise">
              <span className="albumx-empty-mark"><IcSparkle size={30} /></span>
              <h2>נתחיל מתיקיית תמונות</h2>
              <p>
                בחר תיקייה מהדיסק. המנוע יקרא את התמונות מקומית — שום תמונה לא עוזבת
                את המחשב — ומכאן נבנה, שלב אחרי שלב, את הצנרת שמימין.
              </p>
              <button className="btn btn-primary" onClick={choose}>
                <IcFolderOpen size={17} />
                בחר תיקיית תמונות
              </button>
            </div>
          )}

          {status === 'loading' && (
            <p className="albumx-note">קורא את התיקייה…</p>
          )}

          {status === 'error' && (
            <div className="albumx-empty">
              <h2>לא ניתן לקרוא את התיקייה</h2>
              {error && <p className="albumx-fault mono" dir="ltr">{error}</p>}
              <p>
                זו תקלת קריאה, לא תיקייה ריקה — שום דבר לא נמחק. ודא שהמנוע המקומי
                רץ (הפעל <code>dev.bat</code>) ונסה שוב.
              </p>
              <button className="btn btn-flag" onClick={choose}>נסה שוב</button>
            </div>
          )}

          {status === 'ready' && (
            <div className="rise">
              <div className="albumx-folderbar">
                <div className="albumx-folder">
                  <p className="label">תיקייה</p>
                  <p className="albumx-path mono" dir="ltr">{folder}</p>
                </div>
                <p className="albumx-count">
                  <b className="figure">{files.length}</b> תמונות
                </p>
              </div>

              {files.length === 0 ? (
                <p className="albumx-note">לא נמצאו תמונות בתיקייה הזאת.</p>
              ) : (
                <div className="albumx-shelf">
                  {files.map((f) => (
                    <figure key={f} className="albumx-photo">
                      <img className="print" src={thumbUrl(f, 320)} alt="" loading="lazy" />
                      <figcaption className="mono" dir="ltr">{baseName(f)}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
