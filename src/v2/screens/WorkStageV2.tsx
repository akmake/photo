/* שלב העבודה — the photographer decides what stays and what goes to the client.
 *
 * The whole window, light. A gallery of every photograph, in the batches made
 * in the step before, each in a cell of the same size so portraits and
 * landscapes stand in straight rows; on each cell three quick decisions —
 * keep, not sure, remove — with a key for each. A double-click opens the frame
 * in a viewer the way the Windows Photos app does: fit, zoom, pan, next.
 *
 * The engine (engine/triage.py) only SUGGESTS, and only against a twin: a frame
 * is proposed for removal when the same pose, shot again, is better. The
 * suggestion is a small tag on the photograph, never a decision; his decision
 * (project.json `cull`) is never overwritten by a new analysis.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl, triageSet } from '../../api';
import type { Frame, TriageFrame, TriageResult } from '../../api';
import {
  batchOfFrame, frameKey, setCull, useBatches, useCull, useProjectFiles,
} from '../../studio/store';
import type { CullDecision, Project } from '../../studio/store';
import './work-stage-v2.css';

type Filter = 'all' | 'open' | 'keep' | 'maybe' | 'reject' | 'suggested';

const POLL_MS = 3000;
const REASON_WORDS: Record<string, string> = {
  'eyes-shut': 'עיניים עצומות',
  soft: 'פחות חדה',
  duplicate: 'כמעט זהה',
  blown: 'הפריים שרוף',
  dark: 'הפריים חשוך',
  unread: 'לא ניתן לקרוא',
};

/** When a keyboard event carries no physical key, the letter decides — in
 *  English and on the Hebrew layout. */
const KEY_TO_CODE: Record<string, string> = {
  x: 'KeyX', X: 'KeyX', 'ס': 'KeyX',
  k: 'KeyK', K: 'KeyK', 'ל': 'KeyK',
  p: 'KeyP', P: 'KeyP', 'פ': 'KeyP',
  m: 'KeyM', M: 'KeyM', 'צ': 'KeyM',
  u: 'KeyU', U: 'KeyU', 'ו': 'KeyU',
  z: 'KeyZ', Z: 'KeyZ', 'ז': 'KeyZ',
};

const DECISIONS: { id: CullDecision; label: string; key: string; mark: string }[] = [
  { id: 'keep', label: 'שמור', key: 'K', mark: '✓' },
  { id: 'maybe', label: 'מתלבט', key: 'M', mark: '?' },
  { id: 'reject', label: 'הסר', key: 'X', mark: '✕' },
];

const WORD: Record<CullDecision, string> = { keep: 'נשמרה', maybe: 'מתלבט', reject: 'הוסרה' };

interface Undo {
  frames: string[];
  before: Record<string, CullDecision | undefined>;
  label: string;
}

export default function WorkStageV2({
  project,
  onNext,
  onBack,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const projectId = project.id;
  const { frames, ready } = useProjectFiles(projectId);
  const batches = useBatches(projectId);
  const cull = useCull(projectId);

  const [result, setResult] = useState<TriageResult | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [batch, setBatch] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [viewer, setViewer] = useState(false);

  /* ---- the engine's suggestions: asked once, then polled while it measures.
   * A failed call is said as such; the screen stays fully usable without it. */
  const paths = useMemo(() => frames.map((f) => f.path), [frames]);
  useEffect(() => {
    if (!ready || !paths.length) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (run: boolean) => {
      try {
        const r = await triageSet(paths, run);
        if (!alive) return;
        setResult(r);
        setFault(null);
        if (r.pending.length) timer = setTimeout(() => void ask(false), POLL_MS);
      } catch (e) {
        if (!alive) return;
        setFault(e instanceof Error ? e.message : 'המנוע לא ענה');
        timer = setTimeout(() => void ask(run), POLL_MS * 3);
      }
    };
    void ask(true);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [ready, paths]);

  const byName = useMemo(() => {
    const m = new Map<string, TriageFrame>();
    for (const f of result?.frames ?? []) m.set(f.file, f);
    return m;
  }, [result]);
  const frameByName = useMemo(() => {
    const m = new Map<string, Frame>();
    for (const f of frames) m.set(frameKey(f.name), f);
    return m;
  }, [frames]);

  const suggested = useCallback((n: string) => {
    const s = byName.get(n)?.suggestion;
    return (s === 'remove' || s === 'duplicate') && !cull[n];
  }, [byName, cull]);

  const matches = useCallback((n: string) => {
    const d = cull[n];
    switch (filter) {
      case 'open': return !d;
      case 'keep': case 'maybe': case 'reject': return d === filter;
      case 'suggested': return suggested(n);
      default: return true;
    }
  }, [cull, filter, suggested]);

  /* ---- the order: the batches as he arranged them, capture order inside;
   * frames he did not put in any batch follow, as their own group. */
  const groups = useMemo(() => {
    const names = frames.map((f) => frameKey(f.name));
    const of = new Map(names.map((n) => [n, batchOfFrame(projectId, n)]));
    const out: { id: string; title: string; names: string[] }[] = [];
    for (const b of batches) {
      if (batch !== 'all' && batch !== b.id) continue;
      const inB = names.filter((n) => of.get(n) === b.id && matches(n));
      if (inB.length) out.push({ id: b.id, title: b.name, names: inB });
    }
    if (batch === 'all' || batch === 'none') {
      const loose = names.filter((n) => !of.get(n) && matches(n));
      if (loose.length) out.push({ id: 'none', title: batches.length ? 'ללא מקבץ' : '', names: loose });
    }
    return out;
    // `cull` changes the filtered views; batchOfFrame reads the same store.
  }, [frames, batches, batch, matches, projectId]);

  const flat = useMemo(() => groups.flatMap((g) => g.names), [groups]);

  const batchCounts = useMemo(() => {
    const m: Record<string, number> = { none: 0 };
    for (const f of frames) {
      const b = batchOfFrame(projectId, f.name) ?? 'none';
      m[b] = (m[b] ?? 0) + 1;
    }
    return m;
  }, [frames, projectId]);

  const counts = useMemo(() => {
    const c = { keep: 0, maybe: 0, reject: 0, open: 0, suggested: 0 };
    for (const f of frames) {
      const n = frameKey(f.name);
      const d = cull[n];
      if (d) c[d] += 1; else c.open += 1;
      if (suggested(n)) c.suggested += 1;
    }
    return c;
  }, [frames, cull, suggested]);

  // Keep a selection that still exists in the current view.
  useEffect(() => {
    if (!flat.length) { setSel(null); return; }
    if (!sel || !flat.includes(sel)) setSel(flat[0]);
  }, [flat, sel]);

  /* ---- the grid. The selected frame is the one the keys act on; the grid
   * follows it, so the keyboard alone can walk the whole set. */
  const feedRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [size, setSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('tz-ws-size')) || 220; } catch { return 220; }
  });
  useEffect(() => { try { localStorage.setItem('tz-ws-size', String(size)); } catch { /* per-viewer only */ } }, [size]);

  const bring = useCallback((n: string) => {
    setSel(n);
    requestAnimationFrame(() => cardRefs.current[n]?.scrollIntoView({ block: 'nearest' }));
  }, []);

  /** How many cells a row holds right now — for the up and down arrows. */
  const columns = useCallback(() => {
    const w = feedRef.current?.clientWidth ?? 1200;
    return Math.max(1, Math.floor((w - 32 + 12) / (size + 12)));
  }, [size]);

  /* ---- deciding, with one level of undo that says what it undoes */
  const decide = useCallback((names: string[], decision: CullDecision | null, label: string) => {
    if (!names.length) return;
    const before: Record<string, CullDecision | undefined> = {};
    for (const n of names) before[n] = cull[n];
    setCull(projectId, names, decision);
    setUndo({ frames: names, before, label });
  }, [cull, projectId]);

  const undoLast = useCallback(() => {
    if (!undo) return;
    const back: Record<string, string[]> = { keep: [], maybe: [], reject: [], none: [] };
    for (const n of undo.frames) back[undo.before[n] ?? 'none'].push(n);
    setCull(projectId, back.keep, 'keep');
    setCull(projectId, back.maybe, 'maybe');
    setCull(projectId, back.reject, 'reject');
    setCull(projectId, back.none, null);
    setUndo(null);
  }, [projectId, undo]);

  const step = useCallback((delta: number) => {
    if (!flat.length) return;
    const i = sel ? flat.indexOf(sel) : -1;
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + delta))];
    if (viewer) setSel(next); else bring(next);
  }, [bring, flat, sel, viewer]);

  /** Decide the frame, then move on — pressing the same decision again clears it. */
  const decideOne = useCallback((name: string, decision: CullDecision) => {
    const again = cull[name] === decision;
    decide([name], again ? null : decision, `${name} · ${again ? 'ההחלטה בוטלה' : WORD[decision]}`);
    if (again) return;
    const i = flat.indexOf(name);
    const next = flat[i + 1];
    if (!next) return;
    if (viewer) setSel(next); else bring(next);
  }, [bring, cull, decide, flat, viewer]);

  /* ---- the keyboard, by key POSITION so the Hebrew layout works the same. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const code = e.code || KEY_TO_CODE[e.key] || e.key;
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); undoLast(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (code) {
        case 'Escape': if (viewer) { e.preventDefault(); setViewer(false); } break;
        case 'Enter': if (sel && !viewer) { e.preventDefault(); setViewer(true); } break;
        case 'ArrowLeft': e.preventDefault(); step(1); break;
        case 'ArrowRight': e.preventDefault(); step(-1); break;
        case 'ArrowDown': e.preventDefault(); step(viewer ? 1 : columns()); break;
        case 'ArrowUp': e.preventDefault(); step(viewer ? -1 : -columns()); break;
        case 'KeyK': case 'KeyP': case 'Digit1': if (sel) { e.preventDefault(); decideOne(sel, 'keep'); } break;
        case 'KeyM': case 'Digit2': if (sel) { e.preventDefault(); decideOne(sel, 'maybe'); } break;
        case 'KeyX': case 'Delete': case 'Digit3': if (sel) { e.preventDefault(); decideOne(sel, 'reject'); } break;
        case 'KeyU': case 'Backspace':
          if (sel && cull[sel]) { e.preventDefault(); decide([sel], null, `${sel} · ההחלטה בוטלה`); }
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [columns, cull, decide, decideOne, sel, step, undoLast, viewer]);

  // Returning from the viewer: the feed is where the viewer ended.
  const wasViewer = useRef(false);
  useEffect(() => {
    if (wasViewer.current && !viewer && sel) bring(sel);
    wasViewer.current = viewer;
  }, [viewer, sel, bring]);

  useEffect(() => {
    if (!undo) return undefined;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const analysed = result ? result.frames.length : 0;
  const pending = result ? result.pending.length : frames.length;
  const going = frames.length - counts.reject;
  const bulk = filter === 'suggested' ? flat.filter((n) => suggested(n)) : [];

  const FILTERS: [Filter, string, number][] = [
    ['all', 'הכל', frames.length],
    ['open', 'לא הוחלט', counts.open],
    ['keep', 'נשמרו', counts.keep],
    ['maybe', 'מתלבט', counts.maybe],
    ['reject', 'הוסרו', counts.reject],
    ...(counts.suggested ? [['suggested', 'הצעות המערכת', counts.suggested] as [Filter, string, number]] : []),
  ];

  return (
    <div className="tz-ws" dir="rtl">
      <header className="tz-ws-top">
        <div className="tz-ws-top-side">
          {onBack && (
            <button type="button" className="tz-ws-back" onClick={onBack} title="חזרה למקבצים">
              <span aria-hidden>→</span> מקבצים
            </button>
          )}
          <div className="tz-ws-title">
            <b>שלב העבודה</b>
            <span>{[project.client, project.event].filter(Boolean).join(' · ')}</span>
          </div>
        </div>

        <nav className="tz-ws-filters" aria-label="תצוגה">
          {FILTERS.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              className={`tz-ws-filter is-${id}${filter === id ? ' is-on' : ''}`}
              onClick={() => { setFilter(id); feedRef.current?.scrollTo({ top: 0 }); }}
            >
              {label}<i>{n.toLocaleString('he-IL')}</i>
            </button>
          ))}
        </nav>

        <div className="tz-ws-top-side is-end">
          <label className="tz-ws-size" title="גודל התמונות בגלריה">
            <span aria-hidden>▫</span>
            <input type="range" min={140} max={420} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="גודל התמונות" />
            <span aria-hidden>◻</span>
          </label>
          {fault ? (
            <span className="tz-ws-note is-fault" title={fault}>אין הצעות מהמנוע — אפשר להחליט ידנית</span>
          ) : pending > 0 && frames.length > 0 ? (
            <span className="tz-ws-note">
              מנתח {analysed.toLocaleString('he-IL')}/{frames.length.toLocaleString('he-IL')}
              <span className="tz-ws-meter"><i style={{ width: `${(analysed / frames.length) * 100}%` }} /></span>
            </span>
          ) : null}
          {onNext && (
            <button type="button" className="tz-ws-next" onClick={onNext}>
              לשליחה ללקוח · {going.toLocaleString('he-IL')} ←
            </button>
          )}
        </div>
      </header>

      {batches.length > 0 && (
        <div className="tz-ws-batches" role="tablist" aria-label="מקבץ">
          <button type="button" role="tab" aria-selected={batch === 'all'} className={batch === 'all' ? 'is-on' : ''} onClick={() => { setBatch('all'); feedRef.current?.scrollTo({ top: 0 }); }}>
            כל המקבצים<i>{frames.length.toLocaleString('he-IL')}</i>
          </button>
          {batches.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={batch === b.id} className={batch === b.id ? 'is-on' : ''} onClick={() => { setBatch(b.id); feedRef.current?.scrollTo({ top: 0 }); }}>
              {b.name}<i>{(batchCounts[b.id] ?? 0).toLocaleString('he-IL')}</i>
            </button>
          ))}
          {batchCounts.none > 0 && (
            <button type="button" role="tab" aria-selected={batch === 'none'} className={batch === 'none' ? 'is-on' : ''} onClick={() => { setBatch('none'); feedRef.current?.scrollTo({ top: 0 }); }}>
              ללא מקבץ<i>{batchCounts.none.toLocaleString('he-IL')}</i>
            </button>
          )}
        </div>
      )}

      <div className="tz-ws-feed" ref={feedRef}>
        {!ready ? (
          <p className="tz-ws-empty">טוען את תיקיית הפרויקט…</p>
        ) : flat.length === 0 ? (
          <p className="tz-ws-empty">{emptyLine(filter, pending)}</p>
        ) : (
          <>
            {bulk.length > 0 && (
              <div className="tz-ws-bulkbar">
                <span>המערכת מציעה להסיר {bulk.length.toLocaleString('he-IL')} תמונות שיש להן תאומה טובה יותר.</span>
                <button type="button" onClick={() => decide(bulk, 'reject', `${bulk.length} תמונות הוסרו`)}>הסר את כולן</button>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.id} className="tz-ws-group">
                {g.title && (
                  <h2 className="tz-ws-group-title">{g.title}<span>{g.names.length.toLocaleString('he-IL')} תמונות</span></h2>
                )}
                <div className="tz-ws-grid" style={{ '--ws-cell': `${size}px` } as React.CSSProperties}>
                {g.names.map((n) => {
                  const f = frameByName.get(n);
                  if (!f) return null;
                  return (
                    <Card
                      key={n}
                      name={n}
                      frame={f}
                      triage={byName.get(n)}
                      decision={cull[n]}
                      current={n === sel}
                      twin={twinOf(byName.get(n), frameByName)}
                      cardRef={(el) => { cardRefs.current[n] = el; }}
                      onSelect={() => setSel(n)}
                      onOpen={() => { setSel(n); setViewer(true); }}
                      onDecide={(d) => decideOne(n, d)}
                      onTwin={(t) => bring(t)}
                      big={size > 260}
                    />
                  );
                })}
                </div>
              </section>
            ))}
            <p className="tz-ws-end">
              {flat.length.toLocaleString('he-IL')} תמונות בתצוגה · חצים למעבר · K שמור · M מתלבט · X הסר · לחיצה כפולה או Enter לתצוגה גדולה
            </p>
          </>
        )}
      </div>

      {undo && (
        <div className="tz-ws-toast" role="status">
          <span>{undo.label}</span>
          <button type="button" onClick={undoLast}>בטל</button>
        </div>
      )}

      {viewer && sel && frameByName.get(sel) && (
        <Viewer
          frame={frameByName.get(sel)!}
          name={sel}
          position={flat.indexOf(sel)}
          total={flat.length}
          decision={cull[sel]}
          onClose={() => setViewer(false)}
          onStep={step}
          onDecide={(d) => decideOne(sel, d)}
        />
      )}
    </div>
  );
}

function twinOf(t: TriageFrame | undefined, frames: Map<string, Frame>) {
  const ref = t?.reasons.find((r) => r.ref)?.ref;
  return ref && frames.has(ref) ? { name: ref, frame: frames.get(ref)! } : null;
}

function emptyLine(filter: Filter, pending: number): string {
  if (filter === 'suggested') return pending > 0 ? 'הניתוח עוד רץ — ההצעות יופיעו כאן.' : 'אין הצעות בתצוגה הזו.';
  if (filter === 'open') return 'החלטת על כל התמונות בתצוגה הזו.';
  if (filter === 'keep') return 'עוד לא נשמרה אף תמונה.';
  if (filter === 'maybe') return 'אין תמונות שאתה מתלבט עליהן.';
  if (filter === 'reject') return 'עוד לא הוסרה אף תמונה.';
  return 'אין תמונות בתצוגה הזו.';
}

/* ------------------------------------------------------------ one photograph */

function Decide({ decision, onDecide, compact }: { decision?: CullDecision; onDecide: (d: CullDecision) => void; compact?: boolean }) {
  return (
    <div className={`tz-ws-decide${compact ? ' is-compact' : ''}`} role="group" aria-label="החלטה">
      {DECISIONS.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`is-${d.id}${decision === d.id ? ' is-on' : ''}`}
          aria-pressed={decision === d.id}
          onClick={(e) => { e.stopPropagation(); onDecide(d.id); }}
          title={`${d.label} (${d.key})`}
        >
          <span aria-hidden>{d.mark}</span>{!compact && <>{d.label}<kbd>{d.key}</kbd></>}
        </button>
      ))}
    </div>
  );
}

function Card({
  name, frame, triage, decision, current, twin, cardRef, onSelect, onOpen, onDecide, onTwin, big,
}: {
  name: string;
  frame: Frame;
  triage?: TriageFrame;
  decision?: CullDecision;
  current: boolean;
  twin: { name: string; frame: Frame } | null;
  cardRef: (el: HTMLElement | null) => void;
  onSelect: () => void;
  onOpen: () => void;
  onDecide: (d: CullDecision) => void;
  onTwin: (name: string) => void;
  big: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const suggestion = !decision && (triage?.suggestion === 'remove' || triage?.suggestion === 'duplicate') ? triage : null;
  const reason = suggestion?.reasons.find((r) => r.code !== 'duplicate') ?? suggestion?.reasons[0];
  const why = suggestion && reason
    ? `${suggestion.suggestion === 'remove' ? 'מוצע להסיר' : 'כפולה'} · ${REASON_WORDS[reason.code] ?? reason.label}${twin ? ' — לחץ לתאומה' : ''}`
    : '';

  return (
    <article
      ref={cardRef}
      className={`tz-ws-cell${current ? ' is-current' : ''}${decision ? ` is-${decision}` : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      aria-selected={current}
    >
      <div className="tz-ws-cell-img">
        <img
          className={loaded ? 'is-loaded' : ''}
          src={thumbUrl(frame.path, big ? 640 : 320)}
          alt={name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
        {suggestion && (
          <button
            type="button"
            className={`tz-ws-flag is-${suggestion.suggestion}`}
            title={why}
            aria-label={why}
            onClick={(e) => { e.stopPropagation(); if (twin) onTwin(twin.name); }}
          >
            {suggestion.suggestion === 'remove' ? '!' : '≈'}
          </button>
        )}
        {triage?.star && !decision && <span className="tz-ws-flag is-star" title="המומלצת מהרצף">★</span>}
      </div>
      <footer className="tz-ws-cell-bar">
        <span className="tz-ws-file" dir="ltr">{name}</span>
        <Decide decision={decision} onDecide={onDecide} compact />
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ the viewer
 * The Windows Photos grammar: the name on top, the picture fitted, zoom along
 * the bottom with a slider and a percentage, the wheel zooms, a drag pans,
 * a double-click jumps between fit and actual size. */

function Viewer({
  frame, name, position, total, decision, onClose, onStep, onDecide,
}: {
  frame: Frame;
  name: string;
  position: number;
  total: number;
  decision?: CullDecision;
  onClose: () => void;
  onStep: (delta: number) => void;
  onDecide: (d: CullDecision) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 1200, h: 800 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1); // 1 = fit
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setZoom(1); setNatural(null); }, [name]);

  const aspect = natural ? natural.w / natural.h : 1.5;
  const pad = 32;
  const fitW = Math.max(40, Math.min(box.w - pad * 2, (box.h - pad * 2) * aspect));
  const fitH = fitW / aspect;
  // Percentages the way Photos shows them: of the file's own pixels.
  const actual = natural ? natural.w / fitW : 2.5;
  const maxZoom = Math.max(4, actual * 2);
  const w = fitW * zoom;
  const h = fitH * zoom;
  const percent = natural ? Math.round((w / natural.w) * 100) : Math.round(zoom * 100);

  // Zoom around a point on screen, so what is under the cursor stays there.
  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const el = stageRef.current;
    const z = Math.max(1, Math.min(maxZoom, next));
    if (!el) { setZoom(z); return; }
    const r = el.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    const ox = (el.scrollLeft + px) / Math.max(1, el.scrollWidth);
    const oy = (el.scrollTop + py) / Math.max(1, el.scrollHeight);
    setZoom(z);
    requestAnimationFrame(() => {
      el.scrollLeft = ox * el.scrollWidth - px;
      el.scrollTop = oy * el.scrollHeight - py;
    });
  }, [maxZoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); zoomTo(zoom * 1.25); }
      if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomTo(zoom / 1.25); }
      if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); zoomTo(1); }
      if (e.code === 'Space') { e.preventDefault(); zoomTo(zoom > 1 ? 1 : actual); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actual, zoom, zoomTo]);

  return (
    <div className={`tz-ws-viewer${decision ? ` is-${decision}` : ''}`} role="dialog" aria-modal="true" aria-label="תצוגה מלאה">
      <header className="tz-ws-v-top">
        <button type="button" className="tz-ws-v-icon" onClick={onClose} aria-label="סגור (Esc)" title="סגור (Esc)">✕</button>
        <div className="tz-ws-v-name">
          <b dir="ltr">{name}</b>
          <span>{(position + 1).toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')}</span>
        </div>
        <span className="tz-ws-v-spacer" />
      </header>

      <div
        className={`tz-ws-v-stage${zoom > 1 ? ' is-zoomed' : ''}`}
        ref={stageRef}
        onWheel={(e) => { e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }}
        onMouseDown={(e) => {
          if (zoom <= 1 || !stageRef.current) return;
          drag.current = { x: e.clientX, y: e.clientY, l: stageRef.current.scrollLeft, t: stageRef.current.scrollTop };
        }}
        onMouseMove={(e) => {
          const d = drag.current; const el = stageRef.current;
          if (!d || !el) return;
          el.scrollLeft = d.l - (e.clientX - d.x);
          el.scrollTop = d.t - (e.clientY - d.y);
        }}
        onMouseUp={() => { drag.current = null; }}
        onMouseLeave={() => { drag.current = null; }}
      >
        <div className="tz-ws-v-canvas" style={{ width: Math.max(w + pad * 2, box.w), height: Math.max(h + pad * 2, box.h) }}>
          <img
            src={thumbUrl(frame.path, 2400)}
            alt={name}
            draggable={false}
            style={{ width: w, height: h }}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onDoubleClick={(e) => zoomTo(zoom > 1 ? 1 : actual, e.clientX, e.clientY)}
          />
        </div>
      </div>

      <button type="button" className="tz-ws-v-nav is-prev" disabled={position <= 0} onClick={() => onStep(-1)} aria-label="הקודמת">›</button>
      <button type="button" className="tz-ws-v-nav is-next" disabled={position >= total - 1} onClick={() => onStep(1)} aria-label="הבאה">‹</button>

      <footer className="tz-ws-v-bottom">
        <div className="tz-ws-v-zoom" dir="ltr">
          <button type="button" onClick={() => zoomTo(zoom / 1.25)} aria-label="הקטן" title="הקטן (-)">−</button>
          <input
            type="range"
            min={1}
            max={maxZoom}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            aria-label="הגדלה"
          />
          <button type="button" onClick={() => zoomTo(zoom * 1.25)} aria-label="הגדל" title="הגדל (+)">+</button>
          <output>{percent}%</output>
          <button type="button" className={zoom === 1 ? 'is-on' : ''} onClick={() => zoomTo(1)} title="התאם לחלון (0)">התאם</button>
          <button type="button" onClick={() => zoomTo(actual)} title="גודל אמיתי (רווח)">100%</button>
        </div>
        <Decide decision={decision} onDecide={onDecide} />
        <span className="tz-ws-v-spacer" />
      </footer>
    </div>
  );
}
