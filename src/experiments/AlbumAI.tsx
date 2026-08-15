/* אלבום חכם — the AI album, built standalone.
 *
 * Deliberately NOT the project's AlbumStudio: that one is wired to a job's
 * frames and its whole layout/proofing machinery. This is the sandbox where the
 * understanding→selection→layout pipeline is built from nothing, on a folder the
 * photographer points at, so it can move fast without touching a real project.
 *
 * It reuses the low-level engine plumbing — pickFolder, listImages, thumb,
 * embed, analyze — and, for the composition itself, the album layout engine in
 * `src/album/`. Building a second layout engine here would be the real mistake:
 * that one already generates and scores candidate compositions. What this file
 * adds is the physical book — the spec the photographer types in, the fold, the
 * bleed, and the resolution of every frame once it is cropped into its slot.
 *
 * The pipeline on the side (docs/RESEARCH-album-ai.md §5) is the roadmap, and it
 * SAYS so: the culling and clustering stages are still empty. Nothing here draws
 * a result it did not compute — an empty folder reads "no photos here", a failed
 * read reads "could not read", and the two are never the same screen
 * (CLAUDE.md §3).
 */

import { useMemo, useState } from 'react';
import {
  analyzeAlbumFrame,
  dedupAlbum,
  embedAlbum,
  listImages,
  pickFolder,
  thumbUrl,
} from '../api';
import { IcChevron, IcFolderOpen, IcSparkle } from '../design/Icons';
import { ALBUM_STYLES, type AlbumStyleId } from '../album/styleEngine';
import type { AlbumPhoto } from '../album/model';
import SpecForm from './SpecForm';
import {
  EMPTY_DRAFT,
  gutterFraction,
  parseSpec,
  spreadSize,
  type PrintSpec,
  type SpecDraft,
} from './printSpec';
import { buildAlbum, type BuiltAlbum, type BuiltFrame } from './albumBuild';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface Stage {
  id: string;
  label: string;
  note: string;
}

/* The pipeline, in the order the research doc lays it out. Two stages are still
 * empty and the rail says so rather than implying a full machine. */
const PIPELINE: Stage[] = [
  { id: 'ingest', label: 'קליטה', note: 'קריאת התיקייה וטביעת אצבע ויזואלית לכל פריים' },
  { id: 'cull', label: 'סינון', note: 'עיניים עצומות, ראש הצידה, טשטוש, חשיפה' },
  { id: 'dedup', label: 'דה-דופ', note: 'איחוד רצפים כמעט-זהים לטובה שבהן' },
  { id: 'cluster', label: 'קיבוץ', note: 'חלוקה לרגעים לפי דמיון וזמן' },
  { id: 'measure', label: 'מדידה', note: 'מידות אמיתיות, פנים ונקודת מוקד לכל פריים' },
  { id: 'layout', label: 'פריסה', note: 'תבנית לפי תוכן, ציר ובדיקת רזולוציה' },
];

// After the selection you pick what to do — not a forced path. Only "בנה אלבום"
// is real today; the rest SAY "בבנייה" rather than dead-end silently.
type AlbumOption = 'album' | 'cleanup' | 'moments' | 'export' | null;

const HUB: { id: Exclude<AlbumOption, null>; label: string; note: string; ready: boolean }[] = [
  { id: 'album', label: 'בנה אלבום', note: 'מידות דפוס ופריסה מעוצבת', ready: true },
  { id: 'cleanup', label: 'ניקוי', note: 'עור, עיניים וכתמים על הסט', ready: false },
  { id: 'moments', label: 'קבץ לרגעים', note: 'חלוקה לפי דמיון וזמן', ready: false },
  { id: 'export', label: 'ייצוא', note: 'חבילת דפוס לדיסק', ready: false },
];

// The album's SELECTION: every unique frame, plus one representative from each
// near-dup burst. The rest are demoted, not deleted — reversible by design.
function selectionOf(files: string[], groups: string[][]): string[] {
  const demoted = new Set(groups.flatMap((g) => g.slice(1)));
  return files.filter((f) => !demoted.has(f));
}

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
// Measuring opens the full file and runs the face model; three at a time keeps
// the engine busy without queueing a hundred requests it will serialise anyway.
const MEASURE_CHUNK = 3;

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
  const [option, setOption] = useState<AlbumOption>(null);

  // — the physical book —
  const [draft, setDraft] = useState<SpecDraft>(EMPTY_DRAFT);
  const [spec, setSpec] = useState<PrintSpec | null>(null);
  const [style, setStyle] = useState<AlbumStyleId>(ALBUM_STYLES[0].id);
  const [measure, setMeasure] = useState<Ingest | null>(null);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);

  function resetRun() {
    setIngest(null);
    setIngestError(null);
    setDedup(null);
    setDedupError(null);
    setOption(null);
    setSpec(null);
    setMeasure(null);
    setMeasureError(null);
    setPhotos([]);
  }

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
    resetRun();
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

  /* מדידה — the geometry pass.
   *
   * The layout cannot be decided without it: the real pixel dimensions set every
   * PPI check, the orientation picks the template, and the focal point decides
   * what survives the crop. A frame that fails here is DROPPED from the album and
   * counted — it is never placed with guessed dimensions. */
  async function runMeasure(selection: string[]) {
    setMeasureError(null);
    setMeasure({ phase: 'running', done: 0, total: selection.length, failed: 0 });
    const measured: AlbumPhoto[] = [];
    let done = 0;
    let failed = 0;

    try {
      for (let i = 0; i < selection.length; i += MEASURE_CHUNK) {
        const chunk = selection.slice(i, i + MEASURE_CHUNK);
        const results = await Promise.all(chunk.map(async (path) => {
          try {
            return { path, data: await analyzeAlbumFrame(path) };
          } catch {
            return { path, data: null };
          }
        }));

        for (const { path, data } of results) {
          done += 1;
          if (!data || !data.widthPx || !data.heightPx) {
            failed += 1;
            continue;
          }
          measured.push({
            id: path,
            name: baseName(path),
            url: thumbUrl(path, 1400),
            orientation: data.widthPx > data.heightPx
              ? 'landscape'
              : data.widthPx < data.heightPx ? 'portrait' : 'square',
            widthPx: data.widthPx,
            heightPx: data.heightPx,
            focalPoint: data.focalPoint,
            sourcePath: path,
            analysis: {
              status: 'ready',
              faces: data.faces ?? [],
              subject: data.subject ?? null,
              focalPoint: data.focalPoint,
              sharpnessScore: data.sharpnessScore,
              qualityScore: data.qualityScore,
              analyzedBy: data.analyzedBy,
            },
          });
        }
        setMeasure({ phase: 'running', done, total: selection.length, failed });
      }
      setPhotos(measured);
      setMeasure({ phase: 'done', done, total: selection.length, failed });
    } catch (e) {
      setMeasureError((e as Error).message);
      setMeasure(null);
    }
  }

  // Each stage moves ready → running → done. A stage with no code behind it says
  // "בבנייה" and never borrows a neighbour's progress.
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
    if (id === 'measure') {
      if (measure?.phase === 'done') return { label: 'הושלם', cls: 'pill-ok' };
      if (measure?.phase === 'running') return { label: 'פעיל', cls: 'pill-run' };
      if (dedup) return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    if (id === 'layout') {
      if (spec && photos.length) return { label: 'הושלם', cls: 'pill-ok' };
      if (measure?.phase === 'done') return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    return { label: 'בבנייה', cls: 'pill-idle' };
  }

  const selection = dedup ? selectionOf(files, dedup.groups) : [];
  // Every candidate composition is generated and re-scored in here — it is not a
  // render-cheap call, and only these three inputs can change its answer.
  const album: BuiltAlbum | null = useMemo(
    () => (spec && photos.length ? buildAlbum(photos, spec, style) : null),
    [spec, photos, style],
  );

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

              {dedup && !option && (
                <section className="albumx-hub">
                  <p className="label">אחרי הבחירה — בחר מה לעשות</p>
                  <div className="albumx-hub-grid">
                    {HUB.map((o) => (
                      <button
                        key={o.id}
                        className="albumx-hub-card"
                        onClick={() => setOption(o.id)}
                      >
                        <b>{o.label}</b>
                        <small>{o.note}</small>
                        {!o.ready && <span className="albumx-hub-soon">בבנייה</span>}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {option && (
                <section className="albumx-option">
                  <button className="albumx-back" onClick={() => setOption(null)}>
                    <IcChevron size={18} />
                    <span>חזרה לבחירה</span>
                  </button>

                  {option !== 'album' ? (
                    <p className="albumx-note">
                      {HUB.find((o) => o.id === option)?.label} — בבנייה. עוד לא בניתי את
                      השלב הזה; חוזרים לבחירה בינתיים.
                    </p>
                  ) : (
                    <AlbumBuilder
                      selection={selection}
                      measure={measure}
                      measureError={measureError}
                      onMeasure={() => runMeasure(selection)}
                      photos={photos}
                      draft={draft}
                      onDraft={setDraft}
                      onSpec={() => setSpec(parseSpec(draft))}
                      spec={spec}
                      style={style}
                      onStyle={setStyle}
                      album={album}
                      onEditSpec={() => setSpec(null)}
                    />
                  )}
                </section>
              )}

              {!option && dedup && dedup.groups.length > 0 && (
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

              {!option && (files.length === 0 ? (
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
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* The build screen: measure → spec → book. Three gates in order, because each
 * one genuinely needs the one before it. */
function AlbumBuilder(props: {
  selection: string[];
  measure: Ingest | null;
  measureError: string | null;
  onMeasure: () => void;
  photos: AlbumPhoto[];
  draft: SpecDraft;
  onDraft: (draft: SpecDraft) => void;
  onSpec: () => void;
  spec: PrintSpec | null;
  style: AlbumStyleId;
  onStyle: (style: AlbumStyleId) => void;
  album: BuiltAlbum | null;
  onEditSpec: () => void;
}) {
  const {
    selection, measure, measureError, onMeasure, photos,
    draft, onDraft, onSpec, spec, style, onStyle, album, onEditSpec,
  } = props;

  if (measure?.phase !== 'done') {
    return (
      <div className="albumx-gate">
        <p className="albumx-option-lede">
          הבחירה: <b>{selection.length}</b> תמונות. לפני פריסה צריך למדוד כל פריים —
          מידות אמיתיות בפיקסלים, פנים ונקודת מוקד. בלי זה אי אפשר לדעת מה שורד
          חיתוך ומה יוצא רך בדפוס.
        </p>
        {measure?.phase === 'running' ? (
          <p className="albumx-ingest-run">
            <span className="dot-live" />
            מודד… <b>{measure.done}</b>/{measure.total}
            {measure.failed ? ` · ${measure.failed} נכשלו` : ''}
          </p>
        ) : (
          <button className="btn btn-primary" onClick={onMeasure}>
            <IcSparkle size={16} />
            מדוד את הבחירה
          </button>
        )}
        {measureError && <p className="albumx-fault mono" dir="ltr">{measureError}</p>}
      </div>
    );
  }

  if (!photos.length) {
    return (
      <p className="albumx-note">
        אף פריים לא נמדד בהצלחה — {measure.failed} כשלונות מתוך {measure.total}. זו
        תקלה, לא סט ריק. ודא שהמנוע רץ ונסה שוב.
      </p>
    );
  }

  if (!spec) {
    return (
      <>
        {measure.failed > 0 && (
          <p className="albumx-note">
            {measure.failed} פריימים לא נמדדו ולכן לא ייכנסו לאלבום. נמדדו{' '}
            <b>{photos.length}</b>.
          </p>
        )}
        <SpecForm draft={draft} onChange={onDraft} onSubmit={onSpec} />
      </>
    );
  }

  if (!album) return <p className="albumx-note">אין מספיק נתונים לבנות כפולות.</p>;

  const size = spreadSize(spec);
  const band = gutterFraction(spec);
  const safeX = spec.safeMarginMm / size.trimWidthMm;
  const safeY = spec.safeMarginMm / size.trimHeightMm;

  return (
    <div className="albumx-built">
      <div className="albumx-built-head">
        <div>
          <p className="albumx-option-lede">
            <b>{photos.length}</b> תמונות ב-<b>{album.spreads.length}</b> כפולות ·{' '}
            <span className="mono" dir="ltr">
              {size.trimWidthMm}×{size.trimHeightMm}mm
            </span>{' '}
            · בליד {spec.bleedMm} · ציר {spec.gutterMm} · יעד {spec.targetPpi} PPI
          </p>
          <p className="albumx-built-sub">
            {album.softFrames > 0 ? (
              <span className="albumx-flagged">
                {album.softFrames} מסגרות מתחת ל-{spec.minPpi} PPI — יצאו רכות בדפוס
              </span>
            ) : (
              <span className="albumx-okline">כל המסגרות עומדות ב-{spec.minPpi} PPI</span>
            )}
            {album.facesOnFold > 0 && (
              <span className="albumx-flagged"> · {album.facesOnFold} פנים קרובות לציר</span>
            )}
          </p>
        </div>

        <div className="albumx-built-controls">
          <label className="albumx-style">
            <span className="label">סגנון</span>
            <select value={style} onChange={(e) => onStyle(e.target.value as AlbumStyleId)}>
              {ALBUM_STYLES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-flag" onClick={onEditSpec}>שנה מידות</button>
        </div>
      </div>

      <div className="albumx-book">
        {album.spreads.map((spread) => (
          <article key={spread.number} className="albumx-spread-wrap">
            <header className="albumx-spread-head">
              <span className="albumx-page-no mono">{spread.number}</span>
              <span className="albumx-spread-name">{spread.layoutName}</span>
              {spread.warnings.map((w) => (
                <span key={w} className="albumx-warn">{w}</span>
              ))}
            </header>

            <div
              className="albumx-spread"
              dir="ltr"
              style={{ aspectRatio: `${size.trimWidthMm} / ${size.trimHeightMm}` }}
            >
              {spread.frames.map((frame) => (
                <SpreadFrame key={frame.slot.id} frame={frame} />
              ))}

              {/* Guides sit ABOVE the photos as hairlines only — they mark the
                  physical page without hiding a single pixel of it. */}
              <span
                className="albumx-safe"
                style={{ inset: `${safeY * 100}% ${safeX * 100}%` }}
              />
              {band > 0 && (
                <span
                  className="albumx-gutterband"
                  style={{ left: `${(0.5 - band) * 100}%`, width: `${band * 200}%` }}
                />
              )}
              <span className="albumx-fold" />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SpreadFrame({ frame }: { frame: BuiltFrame }) {
  const { photo, slot, resolution, faceOnFold } = frame;
  const focal = photo.analysis?.focalPoint ?? { x: 0.5, y: 0.5 };
  const flagged = !resolution.ok || faceOnFold;

  return (
    <div
      className={`albumx-slot ${flagged ? 'flag' : ''}`}
      style={{
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        width: `${slot.width * 100}%`,
        height: `${slot.height * 100}%`,
      }}
      title={`${photo.name} · ${resolution.widthMm}×${resolution.heightMm}mm · ${resolution.ppi} PPI`}
    >
      <img
        src={thumbUrl(photo.sourcePath ?? photo.id, 900)}
        alt=""
        loading="lazy"
        style={{ objectPosition: `${focal.x * 100}% ${focal.y * 100}%` }}
      />
      {flagged && (
        <span className="albumx-slot-flag mono" dir="ltr">
          {!resolution.ok ? `${resolution.ppi} PPI` : 'fold'}
        </span>
      )}
    </div>
  );
}
