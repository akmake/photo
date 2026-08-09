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
import { dedupAlbum, embedAlbum, listImages, pickFolder, thumbUrl } from '../api';
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

// The קליטה run — real progress over the set, counted in items. `null` until it
// is started; `done` when every frame carries a vector.
type Ingest = { phase: 'running' | 'done'; done: number; total: number; failed: number };

// The near-duplicate result — clusters of 2+ frames, plus the counts the summary
// line reads off. Held whole so re-rendering never recomputes.
type Dedup = {
  groups: string[][];
  embedded: number;
  duplicateFrames: number;
  missing: number;
  threshold: number;
};

// One HTTP call per chunk so the counter moves and a cancel can land between them.
const INGEST_CHUNK = 8;

export default function AlbumAI({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [folder, setFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ingest, setIngest] = useState<Ingest | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [dedup, setDedup] = useState<Dedup | null>(null);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupError, setDedupError] = useState<string | null>(null);

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
    setIngest(null); // a new folder starts with no fingerprints
    setIngestError(null);
    setDedup(null);
    setDedupError(null);
    try {
      const { files: found } = await listImages(picked);
      setFiles(found);
      setStatus('ready');
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  }

  async function runIngest() {
    setIngestError(null);
    setDedup(null); // fingerprints changed — any earlier grouping is now stale
    setDedupError(null);
    setIngest({ phase: 'running', done: 0, total: files.length, failed: 0 });
    let done = 0;
    let failed = 0;
    try {
      for (let i = 0; i < files.length; i += INGEST_CHUNK) {
        const chunk = files.slice(i, i + INGEST_CHUNK);
        const r = await embedAlbum(chunk);
        done += r.results.length;
        failed += r.results.filter((x) => !x.ok).length;
        setIngest({ phase: 'running', done, total: files.length, failed });
      }
      setIngest({ phase: 'done', done, total: files.length, failed });
    } catch (e) {
      // A 503 here means the model was never fetched — say so, do not pretend the
      // run finished. The partial progress stays on screen.
      setIngestError((e as Error).message);
      setIngest(null);
    }
  }

  async function runDedup() {
    setDedupError(null);
    setDedupRunning(true);
    try {
      const r = await dedupAlbum(files);
      setDedup({
        groups: r.groups,
        embedded: r.embedded,
        duplicateFrames: r.duplicateFrames,
        missing: r.missing.length,
        threshold: r.threshold,
      });
    } catch (e) {
      setDedupError((e as Error).message);
    } finally {
      setDedupRunning(false);
    }
  }

  // Two real stages now — קליטה and דה-דופ. The rest SAY "בבנייה". Each moves
  // ready → running → done, and דה-דופ only unlocks once the fingerprints exist.
  function stageStatus(id: string): { label: string; cls: string } {
    if (id === 'ingest') {
      if (ingest?.phase === 'done') return { label: 'הושלם', cls: 'pill-ok' };
      if (ingest?.phase === 'running') return { label: 'פעיל', cls: 'pill-run' };
      if (status === 'ready' && files.length) return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    if (id === 'dedup') {
      if (dedup) return { label: 'הושלם', cls: 'pill-ok' };
      if (dedupRunning) return { label: 'פעיל', cls: 'pill-run' };
      if (ingest?.phase === 'done') return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    return { label: 'בבנייה', cls: 'pill-idle' };
  }

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
              const st = stageStatus(s.id);
              const live = st.cls === 'pill-run' || st.cls === 'pill-ok';
              return (
                <li key={s.id} className={`albumx-stage ${live ? 'on' : ''}`}>
                  <span className="albumx-step">{i + 1}</span>
                  <div className="albumx-stage-copy">
                    <b>{s.label}</b>
                    <small>{s.note}</small>
                  </div>
                  <span className={`pill ${st.cls}`}>{st.label}</span>
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

              {files.length > 0 && (
                <div className="albumx-ingest">
                  {ingest?.phase === 'done' ? (
                    <p className="albumx-ingest-done">
                      קליטה הושלמה — <b>{ingest.done}</b> פריימים הוטבעו
                      {ingest.failed ? ` · ${ingest.failed} נכשלו` : ''}. הצנרת מוכנה
                      לשלב הבא.
                    </p>
                  ) : ingest?.phase === 'running' ? (
                    <p className="albumx-ingest-run">
                      <span className="dot-live" />
                      קולט… <b>{ingest.done}</b>/{ingest.total}
                    </p>
                  ) : (
                    <button className="btn btn-primary" onClick={runIngest}>
                      <IcSparkle size={16} />
                      הרץ קליטה — טביעת אצבע ויזואלית
                    </button>
                  )}
                  {ingestError && (
                    <p className="albumx-fault mono" dir="ltr">{ingestError}</p>
                  )}
                </div>
              )}

              {ingest?.phase === 'done' && (
                <div className="albumx-ingest">
                  {dedup ? (
                    <p className="albumx-ingest-done">
                      דה-דופ: <b>{dedup.groups.length}</b> קבוצות כפולות ·{' '}
                      <b>{dedup.duplicateFrames}</b> פריימים כפולים ·{' '}
                      <b>{dedup.embedded - dedup.duplicateFrames}</b> ייחודיים
                      {dedup.missing ? ` · ${dedup.missing} לא נקלטו` : ''}.
                    </p>
                  ) : dedupRunning ? (
                    <p className="albumx-ingest-run">
                      <span className="dot-live" />
                      מחפש כפולות…
                    </p>
                  ) : (
                    <button className="btn btn-primary" onClick={runDedup}>
                      <IcSparkle size={16} />
                      מצא כפולות
                    </button>
                  )}
                  {dedupError && (
                    <p className="albumx-fault mono" dir="ltr">{dedupError}</p>
                  )}
                </div>
              )}

              {dedup && dedup.groups.length > 0 && (
                <section className="albumx-groups">
                  {dedup.groups.map((g, i) => (
                    <div key={g[0]} className="albumx-group">
                      <p className="albumx-group-head">
                        כמעט-כפולות <span className="mono">×{g.length}</span>
                        <small>קבוצה {i + 1}</small>
                      </p>
                      <div className="albumx-group-strip">
                        {g.map((f) => (
                          <figure key={f} className="albumx-photo">
                            <img className="print" src={thumbUrl(f, 320)} alt="" loading="lazy" />
                            <figcaption className="mono" dir="ltr">{baseName(f)}</figcaption>
                          </figure>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              )}

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
