/* אלבום חכם — the AI album, built standalone.
 *
 * Deliberately NOT the project's AlbumStudio: that one is wired to a job's
 * frames and its whole layout/proofing machinery. This is the sandbox where the
 * understanding→selection→layout pipeline is built from nothing, on a folder the
 * photographer points at, so it can move fast without touching a real project.
 *
 * It reuses the low-level engine plumbing — pickFolder, listImages, thumb,
 * embed, cull, render. The composition does NOT come from `src/album/
 * layoutEngine`: that one sizes each photo to its own aspect and centres it in a
 * box, which produces a contact sheet, not a book. `albumTemplates.ts` holds the
 * drawn vocabulary this album lays out with, and says why.
 *
 * The pipeline on the side (docs/RESEARCH-album-ai.md §5) is the roadmap, and it
 * SAYS so: the clustering stage is still empty. Nothing here draws a result it
 * did not compute — an empty folder reads "no photos here", a failed read reads
 * "could not read", and the two are never the same screen (CLAUDE.md §3).
 */

import { useMemo, useState } from 'react';
import {
  albumIdentities,
  albumMoments,
  cullAlbum,
  dedupAlbum,
  embedAlbum,
  listImages,
  pickFolder,
  renderAlbum,
  renderAlbumPdf,
  thumbUrl,
  type AlbumIdentitiesResult,
  type AlbumMomentsResult,
  type AlbumPdfReport,
  type AlbumRenderManifest,
  type CullResult,
  type RenderFileMeta,
  type RenderSpreadPayload,
} from '../api';
import { IcChevron, IcFolderOpen, IcSparkle } from '../design/Icons';

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
import type { Frame } from './albumTemplates';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface Stage {
  id: string;
  label: string;
  note: string;
}

/* The pipeline, in the order the research doc lays it out. Every stage here now
 * has code behind it; a stage with none would say "בבנייה" rather than borrow a
 * neighbour's progress. */
const PIPELINE: Stage[] = [
  { id: 'ingest', label: 'קליטה', note: 'קריאת התיקייה וטביעת אצבע ויזואלית לכל פריים' },
  { id: 'dedup', label: 'דה-דופ', note: 'איחוד רצפים כמעט-זהים לטובה שבהן' },
  { id: 'cull', label: 'סינון', note: 'עיניים עצומות, ראש מסובב, פוקוס וחשיפה — על הפנים' },
  { id: 'cluster', label: 'קיבוץ', note: 'חלוקה לרגעים לפי דמיון ויזואלי וזמן צילום' },
  { id: 'people', label: 'דמויות', note: 'מי חוזר לאורך האירוע — ומי הנושא שלו' },
  { id: 'curate', label: 'אצירה', note: 'גיבור לכפולה משלו, השאר תומכות' },
  { id: 'layout', label: 'פריסה', note: 'סוג צילום, כיוון מבט, ציר ורזולוציה' },
];

// After the selection you pick what to do — not a forced path. Only "בנה אלבום"
// is real today; the rest SAY "בבנייה" rather than dead-end silently.
type AlbumOption = 'album' | 'cleanup' | 'moments' | 'export' | null;

const HUB: { id: Exclude<AlbumOption, null>; label: string; note: string; ready: boolean }[] = [
  { id: 'album', label: 'בנה אלבום', note: 'סינון, מידות, פריסה ויצוא לדפוס', ready: true },
  { id: 'cleanup', label: 'ניקוי', note: 'עור, עיניים וכתמים על הסט', ready: false },
  { id: 'moments', label: 'קבץ לרגעים', note: 'חלוקה לפי דמיון וזמן', ready: false },
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

/** The judged frame, in the shape the layout reads — geometry plus the
 *  editorial facts (when it was taken, what kind of shot it is, where it looks). */
function toAlbumPhoto({ path, data }: Judged, principalOf: Map<string, number>): Frame {
  return {
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
    shotTime: data.shotTime,
    shotScale: data.shotScale,
    gaze: data.gaze,
    negativeSpace: data.negativeSpace,
    principalRank: principalOf.has(path) ? (principalOf.get(path) as number) : null,
    analysis: {
      status: 'ready',
      faces: data.faces ?? [],
      subject: data.subject ?? null,
      focalPoint: data.focalPoint,
      sharpnessScore: data.sharpnessScore,
      qualityScore: data.qualityScore,
      analyzedBy: data.analyzedBy,
    },
  };
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
// Culling opens the full file and runs the face model; three at a time keeps the
// engine busy without queueing a hundred requests it will serialise anyway.
const CULL_CHUNK = 3;

/* A frame the judge measured, kept whole so the screen can always show WHY.
 * The verdict is stored, never applied — see `overrides`. */
interface Judged {
  path: string;
  data: CullResult;
}

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
  const [cull, setCull] = useState<Ingest | null>(null);
  const [cullError, setCullError] = useState<string | null>(null);
  const [judged, setJudged] = useState<Judged[]>([]);
  const [moments, setMoments] = useState<AlbumMomentsResult | null>(null);
  const [people, setPeople] = useState<AlbumIdentitiesResult | null>(null);
  // Paths the photographer put back in against the judge's verdict. The machine
  // gets a vote, not the last word.
  const [overrides, setOverrides] = useState<Set<string>>(new Set());

  function resetRun() {
    setIngest(null);
    setIngestError(null);
    setDedup(null);
    setDedupError(null);
    setOption(null);
    setSpec(null);
    setCull(null);
    setCullError(null);
    setJudged([]);
    setMoments(null);
    setPeople(null);
    setOverrides(new Set());
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

  /* סינון — the judgement pass, which is also the geometry pass.
   *
   * One call per frame answers both: is it good enough to print, and what is its
   * shape. The layout cannot be decided without the second half — real pixel
   * dimensions set every PPI check, orientation picks the template, and the focal
   * point decides what survives the crop.
   *
   * A frame that FAILS to be read is a different fact from a frame that was read
   * and rejected. The first is counted as a failure and never placed with guessed
   * dimensions; the second is kept in full, with its reasons, and can be put back. */
  async function runCull(selection: string[]) {
    setCullError(null);
    setCull({ phase: 'running', done: 0, total: selection.length, failed: 0 });
    const out: Judged[] = [];
    let done = 0;
    let failed = 0;

    try {
      for (let i = 0; i < selection.length; i += CULL_CHUNK) {
        const r = await cullAlbum(selection.slice(i, i + CULL_CHUNK));
        for (const item of r.results) {
          done += 1;
          if (!item.ok || !item.data?.widthPx || !item.data.heightPx) {
            failed += 1;
            continue;
          }
          out.push({ path: item.path, data: item.data });
        }
        setCull({ phase: 'running', done, total: selection.length, failed });
      }
      setJudged(out);
      setCull({ phase: 'done', done, total: selection.length, failed });

      // The scenes, straight after the judging: the vectors are already cached
      // and the capture times just came back with the verdicts, so this is the
      // one place both halves exist at once.
      try {
        const kept = out.filter((j) => j.data.verdict === 'keep');
        setMoments(await albumMoments(
          kept.map((j) => j.path),
          kept.map((j) => j.data.shotTime),
        ));
      } catch {
        // A failed split is not a failed run — the book falls back to plain
        // capture order, and the panel says which one it used.
        setMoments(null);
      }

      // Who the album is about. The face vectors were stored during the judging
      // pass, so this only clusters what is already on disk.
      try {
        const kept = out.filter((j) => j.data.verdict === 'keep');
        setPeople(await albumIdentities(
          kept.map((j) => ({ path: j.path, faces: j.data.faces })),
        ));
      } catch {
        setPeople(null);
      }
    } catch (e) {
      setCullError((e as Error).message);
      setCull(null);
    }
  }

  function toggleOverride(path: string) {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
    if (id === 'cull') {
      if (cull?.phase === 'done') return { label: 'הושלם', cls: 'pill-ok' };
      if (cull?.phase === 'running') return { label: 'פעיל', cls: 'pill-run' };
      if (dedup) return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    if (id === 'cluster') {
      if (moments) return { label: 'הושלם', cls: 'pill-ok' };
      if (cull?.phase === 'done') return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    if (id === 'people') {
      if (people) return { label: 'הושלם', cls: 'pill-ok' };
      if (cull?.phase === 'done') return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    // אצירה has no screen of its own: the hero promotion lives inside the build,
    // so it is done exactly when a book exists.
    if (id === 'curate' || id === 'layout') {
      if (spec && photos.length) return { label: 'הושלם', cls: 'pill-ok' };
      if (cull?.phase === 'done') return { label: 'מוכן', cls: '' };
      return { label: 'בבנייה', cls: 'pill-idle' };
    }
    return { label: 'בבנייה', cls: 'pill-idle' };
  }

  const selection = dedup ? selectionOf(files, dedup.groups) : [];
  const rejected = judged.filter((j) => j.data.verdict === 'reject');
  // Memoised together: a fresh array identity here would defeat the build's own
  // memo below and re-run every layout candidate on every keystroke.
  /* Which frames hold a protagonist, and which one. Built from the identity
   * pass; empty when nobody carries enough of the event, which is a real answer
   * for a venue or a product day rather than a failure. */
  const principalOf = useMemo(() => {
    const map = new Map<string, number>();
    (people?.principals ?? []).forEach((person, rank) => {
      person.frames.forEach((path) => {
        if (!map.has(path)) map.set(path, rank);
      });
    });
    return map;
  }, [people]);

  const photos = useMemo(
    () => judged
      .filter((j) => j.data.verdict === 'keep' || overrides.has(j.path))
      .map((j) => toAlbumPhoto(j, principalOf)),
    [judged, overrides, principalOf],
  );
  // Every candidate composition is generated and re-scored in here — it is not a
  // render-cheap call, and only these three inputs can change its answer.
  const album: BuiltAlbum | null = useMemo(
    () => (spec && photos.length
      ? buildAlbum(photos, spec, moments?.moments ?? [])
      : null),
    [spec, photos, moments],
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
                      cull={cull}
                      cullError={cullError}
                      onCull={() => runCull(selection)}
                      rejected={rejected}
                      overrides={overrides}
                      onToggleOverride={toggleOverride}
                      moments={moments}
                      people={people}
                      photos={photos}
                      draft={draft}
                      onDraft={setDraft}
                      onSpec={() => setSpec(parseSpec(draft))}
                      spec={spec}
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
  cull: Ingest | null;
  cullError: string | null;
  onCull: () => void;
  rejected: Judged[];
  overrides: Set<string>;
  onToggleOverride: (path: string) => void;
  moments: AlbumMomentsResult | null;
  people: AlbumIdentitiesResult | null;
  photos: Frame[];
  draft: SpecDraft;
  onDraft: (draft: SpecDraft) => void;
  onSpec: () => void;
  spec: PrintSpec | null;
  album: BuiltAlbum | null;
  onEditSpec: () => void;
}) {
  const {
    selection, cull, cullError, onCull, rejected, overrides, onToggleOverride,
    moments, people, photos, draft, onDraft, onSpec, spec, album, onEditSpec,
  } = props;

  if (cull?.phase !== 'done') {
    return (
      <div className="albumx-gate">
        <p className="albumx-option-lede">
          הבחירה: <b>{selection.length}</b> תמונות. עכשיו כל פריים נשפט ונמדד
          בקריאה אחת — עיניים, זווית ראש, פוקוס וחשיפה <b>על הפנים</b>, ובאותה
          הזדמנות המידות האמיתיות ונקודת המוקד שהפריסה צריכה.
        </p>
        <p className="albumx-note-inline">
          שום דבר לא נמחק ולא זז. פסילה היא תווית עם המספרים שהובילו אליה, ואפשר
          להחזיר כל פריים בלחיצה.
        </p>
        {cull?.phase === 'running' ? (
          <p className="albumx-ingest-run">
            <span className="dot-live" />
            שופט… <b>{cull.done}</b>/{cull.total}
            {cull.failed ? ` · ${cull.failed} נכשלו` : ''}
          </p>
        ) : (
          <button className="btn btn-primary" onClick={onCull}>
            <IcSparkle size={16} />
            סנן ומדוד את הבחירה
          </button>
        )}
        {cullError && <p className="albumx-fault mono" dir="ltr">{cullError}</p>}
      </div>
    );
  }

  const cullPanel = (
    <CullReport
      cull={cull}
      rejected={rejected}
      overrides={overrides}
      onToggleOverride={onToggleOverride}
      kept={photos.length}
      moments={moments}
      people={people}
    />
  );

  if (!photos.length) {
    return (
      <>
        {cullPanel}
        <p className="albumx-note">
          לא נשאר אף פריים לאלבום. אם הפסילות נראות לך שגויות — החזר פריימים
          מהרשימה למעלה.
        </p>
      </>
    );
  }

  if (!spec) {
    return (
      <>
        {cullPanel}
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
      {cullPanel}
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
          <button className="btn btn-flag" onClick={onEditSpec}>שנה מידות</button>
        </div>
      </div>

      <ExportPanel spec={spec} album={album} />

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

/* The סינון report — the rejected frames, each with the reason and the number.
 *
 * This panel is the whole reason the stage is trustworthy. A culler that only
 * says "42 rejected" is asking to be believed; one that shows the frame, names
 * the fault and prints the measurement can be checked, argued with, and
 * overruled — which is exactly what a photographer will want to do the first
 * few times, and the only way the thresholds ever get calibrated. */
function CullReport({
  cull, rejected, overrides, onToggleOverride, kept, moments, people,
}: {
  cull: Ingest;
  rejected: Judged[];
  overrides: Set<string>;
  onToggleOverride: (path: string) => void;
  kept: number;
  moments: AlbumMomentsResult | null;
  people: AlbumIdentitiesResult | null;
}) {
  const [open, setOpen] = useState(false);
  const restored = rejected.filter((j) => overrides.has(j.path)).length;

  return (
    <section className="cullrep">
      <div className="cullrep-head">
        <p className="cullrep-line">
          סינון: <b>{kept}</b> נכנסות · <b>{rejected.length - restored}</b> נפסלו
          {restored ? <> · <b>{restored}</b> הוחזרו ידנית</> : null}
          {cull.failed ? <> · <b>{cull.failed}</b> לא ניתן היה לקרוא</> : null}
        </p>
        {rejected.length > 0 && (
          <button className="btn btn-flag" onClick={() => setOpen(!open)}>
            {open ? 'הסתר את הפסולות' : 'הראה מה נפסל ולמה'}
          </button>
        )}
      </div>

      {cull.failed > 0 && (
        <p className="albumx-note-inline">
          {cull.failed} פריימים לא נקראו כלל — זו תקלת קריאה, לא פסילה. הם לא
          נכנסים לאלבום ולא מופיעים ברשימה למטה.
        </p>
      )}

      <p className="albumx-note-inline">
        {people
          ? (people.principals.length
            ? <>
                האלבום מזהה <b>{people.principals.length}</b> דמויות מרכזיות
                {' '}(מתוך <b>{people.identities.length}</b> אנשים שנמצאו) —
                {' '}הבולטת מופיעה ב-<b>{Math.round((people.principals[0].share ?? 0) * 100)}%</b>
                {' '}מהסט. הן שמקבלות את הכפולות הגדולות.
                {people.unreadableFaces > 0 && (
                  <> {people.unreadableFaces} פנים היו קטנות מכדי לזהות — לא נספרו לאף אחד.</>
                )}
              </>
            : <>לא נמצאה דמות מרכזית — אף אחד לא מופיע בחלק מספיק גדול מהסט. הגיבורים ייבחרו לפי איכות בלבד.</>)
          : 'לא בוצע זיהוי דמויות — הגיבורים ייבחרו לפי איכות בלבד.'}
      </p>

      {/* Which ORDER the book is told in, and by what. A split made without
          timestamps is a weaker split, and saying so costs nothing. */}
      <p className="albumx-note-inline">
        {moments
          ? <>
              הספר מחולק ל-<b>{moments.moments.length}</b> רגעים
              {moments.usedTime
                ? ' — לפי דמיון ויזואלי וזמן צילום מה-EXIF.'
                : ' — לפי דמיון ויזואלי בלבד; לרוב הפריימים אין זמן צילום קריא, אז הסדר חלש יותר.'}
              {' '}כפולה לא חוצה רגע.
            </>
          : 'לא בוצעה חלוקה לרגעים — הספר יסודר לפי זמן צילום בלבד.'}
      </p>

      {open && (
        <div className="cullrep-grid">
          {rejected.map((j) => {
            const back = overrides.has(j.path);
            const main = j.data.faceDetail.length
              ? j.data.faceDetail.reduce((a, b) => (
                a.box.width * a.box.height >= b.box.width * b.box.height ? a : b
              ))
              : null;
            return (
              <figure key={j.path} className={`cullrep-card ${back ? 'back' : ''}`}>
                <img src={thumbUrl(j.path, 420)} alt="" loading="lazy" />
                <figcaption>
                  <p className="cullrep-name mono" dir="ltr">{baseName(j.path)}</p>
                  <div className="cullrep-reasons">
                    {j.data.reasons.map((r) => (
                      <span key={r.code} className={`cullrep-why ${r.hard ? 'hard' : ''}`}>
                        {r.label}
                        {r.value !== null && (
                          <b className="mono" dir="ltr">{r.value.toFixed(2)}</b>
                        )}
                      </span>
                    ))}
                  </div>
                  {main && (
                    <p className="cullrep-nums mono" dir="ltr">
                      face {Math.round(main.faceWidthPx)}px
                      {main.eyeOpenness !== null && ` · eyes ${main.eyeOpenness.toFixed(2)}`}
                      {main.faceSharpness !== null && ` · sharp ${main.faceSharpness.toFixed(2)}`}
                      {main.yaw !== null && ` · yaw ${main.yaw.toFixed(2)}`}
                    </p>
                  )}
                  <button className="cullrep-undo" onClick={() => onToggleOverride(j.path)}>
                    {back ? 'הוצא שוב מהאלבום' : 'החזר לאלבום'}
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* יצוא — the print package.
 *
 * Two gates before a single file is written, and neither is ceremony. The
 * spec must be CONFIRMED against the lab's sheet, because everything here was
 * computed from numbers typed by hand and a transposed digit is an album
 * printed at the wrong size. And the destination is picked by the photographer:
 * the engine never invents a folder to write into.
 */
const RENDER_CHUNK = 2;

function ExportPanel({ spec, album }: { spec: PrintSpec; album: BuiltAlbum }) {
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [manifest, setManifest] = useState<AlbumRenderManifest | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdf, setPdf] = useState<AlbumPdfReport | null>(null);

  const payload: RenderSpreadPayload[] = album.spreads.map((spread) => ({
    frames: spread.frames.map((frame) => ({
      path: frame.photo.sourcePath ?? frame.photo.id,
      slot: {
        x: frame.slot.x,
        y: frame.slot.y,
        width: frame.slot.width,
        height: frame.slot.height,
      },
      focalPoint: frame.photo.analysis?.focalPoint ?? { x: 0.5, y: 0.5 },
    })),
  }));

  async function run() {
    setError(null);
    setManifest(null);

    let outDir: string | null;
    try {
      outDir = await pickFolder();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // A cancelled dialog is an answer, not a failure.
    if (!outDir) return;
    setTarget(outDir);
    setProgress({ done: 0, total: payload.length });

    const files: RenderFileMeta[] = [];
    try {
      for (let i = 0; i < payload.length; i += RENDER_CHUNK) {
        const chunk = payload.slice(i, i + RENDER_CHUNK);
        const last = i + RENDER_CHUNK >= payload.length;
        const result = await renderAlbum(
          spec as unknown as Record<string, number>,
          chunk,
          outDir,
          {
            startIndex: i + 1,
            manifestFiles: files,
            writeManifest: last,
          },
        );
        // Each call returns the accumulated list; keep the engine's copy as
        // the truth so the manifest it finally writes is the one shown here.
        files.length = 0;
        files.push(...result.files);
        setProgress({ done: Math.min(i + chunk.length, payload.length), total: payload.length });
        if (last) setManifest(result);
      }
      setProgress(null);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  async function runPdf() {
    setError(null);
    setPdf(null);
    let outDir: string | null;
    try {
      outDir = await pickFolder();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!outDir) return;
    setPdfBusy(true);
    try {
      setPdf(await renderAlbumPdf(spec as unknown as Record<string, number>, payload, outDir));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <section className="albumx-export">
      {/* Two different products, kept apart on purpose. */}
      <div className="albumx-export-head">
        <div>
          <p className="label">PDF לצפייה</p>
          <p className="albumx-export-lede">
            כל האלבום כמסמך אחד, בגודל הפיזי האמיתי של הספר — לדפדף, להראות
            ללקוח, לשלוח להגהה. <b>זה לא קובץ לבית דפוס</b>: אין סימני חיתוך ואין
            הפרדת תיבות. לזה יש את החבילה למטה.
          </p>
        </div>
      </div>

      {pdfBusy ? (
        <p className="albumx-ingest-run">
          <span className="dot-live" />
          בונה PDF של {album.spreads.length} כפולות…
        </p>
      ) : (
        <button className="btn btn-flag" onClick={runPdf}>
          <IcFolderOpen size={16} />
          שמור PDF לצפייה
        </button>
      )}

      {pdf && (
        <div className="albumx-export-done">
          <p>
            <b>{pdf.pages}</b> עמודים ·{' '}
            {Math.round(pdf.pagePx[0] / pdf.ppi * 25.4)}×
            {Math.round(pdf.pagePx[1] / pdf.ppi * 25.4)} מ״מ לעמוד ·{' '}
            {(pdf.bytes / 1e6).toFixed(1)}MB
            <span className="mono" dir="ltr"> {pdf.path}</span>
          </p>
        </div>
      )}

      <hr className="albumx-export-rule" />

      <div className="albumx-export-head">
        <div>
          <p className="label">חבילת דפוס</p>
          <p className="albumx-export-lede">
            JPEG לכל כפולה, {spec.targetPpi} PPI, sRGB מוטבע, איכות 97 בלי דגימת
            צבע. הכפולות מורכבות במנוע מהקבצים המקוריים — לא מהתצוגה — כך שיש
            דגימה אחת וקידוד אחד.
          </p>
        </div>
      </div>

      <label className="albumx-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          בדקתי את המידות מול דף המפרט של בית הדפוס
          <small>
            הכול כאן חושב מהמספרים שהזנת. ספרה אחת הפוכה = אלבום בגודל הלא נכון.
          </small>
        </span>
      </label>

      {progress ? (
        <p className="albumx-ingest-run">
          <span className="dot-live" />
          מרנדר… <b>{progress.done}</b>/{progress.total} כפולות
        </p>
      ) : (
        <button className="btn btn-primary" disabled={!confirmed} onClick={run}>
          <IcFolderOpen size={16} />
          בחר תיקיית יעד וייצא
        </button>
      )}

      {error && <p className="albumx-fault mono" dir="ltr">{error}</p>}

      {manifest && (
        <div className="albumx-export-done">
          <p>
            נכתבו <b>{manifest.spreads}</b> כפולות + manifest.json אל
            <span className="mono" dir="ltr"> {target}</span>
          </p>
          <p className="albumx-note-inline">
            {manifest.files[0]?.widthPx}×{manifest.files[0]?.heightPx} פיקסלים לכפולה
            (כולל בליד) · {manifest.colorProfile} · {manifest.subsampling}
            {manifest.upscaledFrames > 0 && (
              <span className="albumx-flagged">
                {' '}· {manifest.upscaledFrames} מסגרות הוגדלו מעל גודל המקור
              </span>
            )}
            {manifest.softFrames > 0 && (
              <span className="albumx-flagged">
                {' '}· {manifest.softFrames} מתחת ל-{spec.minPpi} PPI
              </span>
            )}
          </p>
        </div>
      )}
    </section>
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
