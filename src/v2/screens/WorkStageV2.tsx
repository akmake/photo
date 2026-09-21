/* שלב העבודה — the photographer decides what stays and what goes to the client.
 *
 * The engine (engine/triage.py) only SUGGESTS, and only against a twin: a frame
 * is proposed for removal when the same pose, shot again, is better — eyes open
 * where these are shut, sharp where this is soft. Flawless repeats are offered
 * as duplicates of the recommended frame. Nothing leaves the set until the
 * photographer says so, and his decision (project.json `cull`) is never
 * overwritten by a new analysis.
 *
 * Built for speed the way professional culling tools are judged: the picture
 * is on screen instantly, one key decides, the next frame follows, and every
 * suggestion shows its twin so the reason is visible, not asserted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl, triageSet } from '../../api';
import type { Frame, TriageFrame, TriageResult } from '../../api';
import {
  batchOfFrame, frameKey, setCull, useBatches, useCull, useProjectFiles,
} from '../../studio/store';
import type { CullDecision, Project } from '../../studio/store';
import './stages-v2.css';
import './work-stage-v2.css';

type Filter = 'all' | 'remove' | 'duplicate' | 'rejected' | 'unread';

const POLL_MS = 3000;
const REASON_WORDS: Record<string, string> = {
  'eyes-shut': 'עיניים עצומות',
  soft: 'פחות חדה',
  duplicate: 'כמעט זהה',
  blown: 'הפריים שרוף',
  dark: 'הפריים חשוך',
  unread: 'לא ניתן לקרוא',
};

/** When a keyboard event carries no physical key (some input paths leave
 *  `code` empty), the letter decides — in English and on the Hebrew layout,
 *  where the same keys type ס ל ו ב ז. */
const KEY_TO_CODE: Record<string, string> = {
  x: 'KeyX', X: 'KeyX', 'ס': 'KeyX',
  k: 'KeyK', K: 'KeyK', 'ל': 'KeyK',
  u: 'KeyU', U: 'KeyU', 'ו': 'KeyU',
  c: 'KeyC', C: 'KeyC', 'ב': 'KeyC',
  z: 'KeyZ', Z: 'KeyZ', 'ז': 'KeyZ',
};

/** What the reason says about the twin, in the photographer's words. */
function twinLine(code: string): string {
  if (code === 'eyes-shut') return 'באותה תנוחה העיניים פתוחות';
  if (code === 'soft') return 'באותה תנוחה התמונה חדה יותר';
  if (code === 'duplicate') return 'התמונה המומלצת מהרצף';
  return '';
}

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
  const [compare, setCompare] = useState(true);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [aspect, setAspect] = useState(1.5);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusZoom, setFocusZoom] = useState<'fit' | number>('fit');
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* The stage fills the window below wherever the app's chrome ends, measured
   * rather than assumed: the top bar's height is not this screen's to know. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      // Where it starts in the PAGE, not on screen: measured while scrolled,
      // the on-screen top is smaller and the stage came out too tall.
      const scroller = el.closest('.tz-content-scroll') as HTMLElement | null;
      const top = el.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      el.style.setProperty('--tz-ws-top', `${Math.max(0, Math.round(top))}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  });

  /* ---- the engine's answer: asked once with `run`, then polled while the
   * background preparer is still measuring. A failed call is said as such —
   * the screen stays usable without suggestions, and never pretends the set
   * came back clean. */
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

  /* ---- the order the story happened in: analysed frames in capture order,
   * grouped by moment; frames still being read follow, as their own group. */
  const ordered = useMemo(() => {
    const known = (result?.frames ?? []).filter((t) => frameByName.has(t.file));
    const rest = frames
      .map((f) => frameKey(f.name))
      .filter((n) => !byName.has(n));
    return { known, rest };
  }, [result, frames, frameByName, byName]);

  const decisionOf = useCallback((name: string) => cull[name], [cull]);

  const matches = useCallback((name: string) => {
    if (batch !== 'all' && batchOfFrame(projectId, name) !== batch) return false;
    const t = byName.get(name);
    const d = decisionOf(name);
    switch (filter) {
      case 'remove': return t?.suggestion === 'remove' && d !== 'keep';
      case 'duplicate': return t?.suggestion === 'duplicate' && d !== 'keep';
      case 'rejected': return d === 'reject';
      case 'unread': return t?.suggestion === 'unread';
      default: return true;
    }
  }, [batch, byName, decisionOf, filter, projectId]);

  const moments = useMemo(() => {
    const groups: { key: string; title: string; names: string[] }[] = [];
    let cur: { key: string; title: string; names: string[] } | null = null;
    for (const t of ordered.known) {
      if (!matches(t.file)) continue;
      if (!cur || cur.key !== `m${t.moment}`) {
        cur = { key: `m${t.moment}`, title: `רגע ${t.moment + 1}`, names: [] };
        groups.push(cur);
      }
      cur.names.push(t.file);
    }
    const waiting = ordered.rest.filter(matches);
    if (waiting.length) groups.push({ key: 'pending', title: 'עדיין בניתוח', names: waiting });
    return groups;
  }, [ordered, matches]);

  const flat = useMemo(() => moments.flatMap((m) => m.names), [moments]);

  // Keep a selection that still exists in the current view.
  useEffect(() => {
    if (!flat.length) { setSel(null); return; }
    if (!sel || !flat.includes(sel)) setSel(flat[0]);
  }, [flat, sel]);

  /* ---- counts, for the filters and the way forward */
  const counts = useMemo(() => {
    let remove = 0; let duplicate = 0; let rejected = 0; let kept = 0; let unread = 0;
    for (const f of frames) {
      const n = frameKey(f.name);
      const t = byName.get(n);
      const d = cull[n];
      if (d === 'reject') rejected += 1;
      if (d === 'keep') kept += 1;
      if (t?.suggestion === 'remove' && d !== 'keep' && d !== 'reject') remove += 1;
      if (t?.suggestion === 'duplicate' && d !== 'keep' && d !== 'reject') duplicate += 1;
      if (t?.suggestion === 'unread') unread += 1;
    }
    return { remove, duplicate, rejected, kept, unread, going: frames.length - rejected };
  }, [frames, byName, cull]);

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
    const back: Record<string, string[]> = { keep: [], reject: [], none: [] };
    for (const n of undo.frames) back[undo.before[n] ?? 'none'].push(n);
    setCull(projectId, back.keep, 'keep');
    setCull(projectId, back.reject, 'reject');
    setCull(projectId, back.none, null);
    setUndo(null);
  }, [projectId, undo]);

  const step = useCallback((delta: number) => {
    if (!flat.length) return;
    const i = sel ? flat.indexOf(sel) : -1;
    setSel(flat[Math.max(0, Math.min(flat.length - 1, i + delta))]);
  }, [flat, sel]);

  const decideAndAdvance = useCallback((decision: CullDecision | null) => {
    if (!sel) return;
    const words = decision === 'reject' ? 'הוצאה' : decision === 'keep' ? 'נשארת' : 'ההחלטה בוטלה';
    decide([sel], decision, `${sel} · ${words}`);
    // In a filtered view the frame may leave the list; step to what follows it.
    const i = flat.indexOf(sel);
    const next = flat[i + 1] ?? flat[i - 1] ?? null;
    if (decision !== null && next) setSel(next);
  }, [decide, flat, sel]);

  /* ---- the keyboard. By key POSITION (e.code), so the Hebrew layout works
   * the same as the English one. Arrow keys follow the page: in RTL the next
   * frame is to the LEFT. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const code = e.code || KEY_TO_CODE[e.key] || e.key;
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); undoLast(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (code) {
        case 'Escape':
          if (focusOpen) { e.preventDefault(); setFocusOpen(false); }
          break;
        case 'Equal': case 'NumpadAdd':
          if (focusOpen) {
            e.preventDefault();
            setFocusZoom((z) => (z === 'fit' ? 1 : Math.min(1.75, Math.round((z + 0.25) * 100) / 100)));
          }
          break;
        case 'Minus': case 'NumpadSubtract':
          if (focusOpen) {
            e.preventDefault();
            setFocusZoom((z) => (z === 'fit' || z <= 1 ? 'fit' : Math.max(1, Math.round((z - 0.25) * 100) / 100)));
          }
          break;
        case 'Digit0': case 'Numpad0':
          if (focusOpen) { e.preventDefault(); setFocusZoom('fit'); }
          break;
        case 'Space': case 'KeyZ':
          if (focusOpen) {
            e.preventDefault();
            setFocusZoom((z) => (z === 'fit' ? 1 : 'fit'));
          }
          break;
        case 'ArrowLeft': case 'ArrowDown': e.preventDefault(); step(1); break;
        case 'ArrowRight': case 'ArrowUp': e.preventDefault(); step(-1); break;
        case 'KeyX': case 'Delete': e.preventDefault(); decideAndAdvance('reject'); break;
        case 'KeyK': case 'KeyP': case 'Enter': e.preventDefault(); decideAndAdvance('keep'); break;
        case 'KeyU': case 'Backspace': e.preventDefault(); decideAndAdvance(null); break;
        case 'KeyC': e.preventDefault(); setCompare((v) => !v); break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decideAndAdvance, focusOpen, step, undoLast]);

  const selT = sel ? byName.get(sel) : undefined;
  const selFrame = sel ? frameByName.get(sel) : undefined;
  const twinRef = selT?.reasons.find((r) => r.ref)?.ref;
  const twinFrame = twinRef ? frameByName.get(twinRef) : undefined;
  const flaggedFace = selT?.reasons.find((r) => typeof r.face === 'number')?.face;
  const showTwin = Boolean(compare && twinFrame);

  const bulk = filter === 'remove' || filter === 'duplicate'
    ? flat.filter((n) => cull[n] !== 'reject' && cull[n] !== 'keep')
    : [];

  const analysed = result ? result.frames.length : 0;
  const pending = result ? result.pending.length : frames.length;

  // The canvas is sized in pixels from its own box, like the editing screen's.
  const loupeRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = loupeRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: Math.max(200, r.width), h: Math.max(160, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  // Two pictures go side by side or one above the other — whichever lets each
  // be LARGER in this box.
  const fit = (w: number, h: number) => Math.max(40, Math.floor(Math.min(w, (h - 20) * aspect)));
  const sideW = fit((box.w - 16) / 2, box.h);
  const stackW = fit(box.w, (box.h - 16) / 2);
  const stack = showTwin && stackW > sideW;
  const imgW = showTwin ? Math.max(sideW, stackW) : fit(box.w, box.h);
  const imgH = Math.floor(imgW / aspect);

  useEffect(() => {
    if (sel) tileRefs.current[sel]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  useEffect(() => {
    setFocusZoom('fit');
  }, [sel, focusOpen]);

  if (!ready) {
    return <div className="tz-ge-studio-root"><p className="tz-ws-muted">טוען את תיקיית הפרויקט…</p></div>;
  }

  const suggestion = selT && sel && !cull[sel] && (selT.suggestion === 'remove' || selT.suggestion === 'duplicate')
    ? selT : null;
  const mainReason = selT?.reasons.find((r) => r.code !== 'duplicate') ?? selT?.reasons[0];
  const position = sel ? flat.indexOf(sel) : -1;
  const selDecision = sel ? cull[sel] : undefined;
  const frameState = selDecision === 'reject' ? 'is-rejected'
    : selDecision === 'keep' ? 'is-kept'
    : suggestion?.suggestion === 'remove' ? 'is-suggested-remove'
    : suggestion?.suggestion === 'duplicate' ? 'is-suggested-duplicate'
    : selT?.star ? 'is-recommended'
    : 'is-neutral';
  const frameStateLabel = selDecision === 'reject' ? 'הוצאה מהסט'
    : selDecision === 'keep' ? 'נשארת בסט'
    : suggestion?.suggestion === 'remove' ? 'מוצע להסיר'
    : suggestion?.suggestion === 'duplicate' ? 'כפולה לבדיקה'
    : selT?.star ? 'מומלצת מהרצף'
    : selT ? 'אין הערה'
    : 'ממתינה לניתוח';
  const frameReason = suggestion && mainReason
    ? (REASON_WORDS[mainReason.code] ?? mainReason.label)
    : selT?.star ? 'התמונה הטובה ברצף הזה'
    : selT?.suggestion === 'unread' ? 'לא ניתן לקרוא את הקובץ'
    : 'החלטה ידנית של הצלם';

  return (
    <div className={`tz-ge-studio-root tz-ws ${frameState}`} ref={rootRef}>
      {/* 1. TOP BAR — the editing screen's own bar: views on one side, the way on */}
      <header className="tz-ge-top-bar">
        <div className="tz-ge-batch-tabs" role="tablist">
          <span className="tz-ws-bar-title">שלב העבודה</span>
          {([
            ['all', 'כל התמונות', frames.length],
            ['remove', 'מוצע להסיר', counts.remove],
            ['duplicate', 'כפולות', counts.duplicate],
            ['rejected', 'הוצאו', counts.rejected],
            ...(counts.unread ? [['unread', 'לא נקראו', counts.unread] as const] : []),
          ] as [Filter, string, number][]).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`tz-ge-batch-tab ${filter === id ? 'active' : ''}`}
              onClick={() => setFilter(id)}
            >
              <span>{label}</span>
              <span className="tz-ge-batch-pill-badge">{n.toLocaleString('he-IL')}</span>
            </button>
          ))}
          {batches.length > 0 && (
            <select className="tz-ws-batch" value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="מקבץ">
              <option value="all">כל המקבצים</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        <div className="tz-ge-top-actions">
          {onBack && (
            <button type="button" className="tz-sc-subtle-btn" onClick={onBack}>← מקבצים</button>
          )}
          {onNext && (
            <button
              type="button"
              className="tz-btn-projects-primary"
              style={{ padding: '7px 16px', fontSize: 13 }}
              onClick={onNext}
            >
              לשליחה ללקוח · {counts.going.toLocaleString('he-IL')} תמונות ←
            </button>
          )}
        </div>
      </header>

      {/* 2. THE WORKSPACE — deck | canvas | decision, as in editing */}
      <div className="tz-ge-studio-workspace">
        <aside className="tz-ge-slide-deck">
          <div className="tz-ge-deck-header">
            <span>תמונות ({flat.length.toLocaleString('he-IL')})</span>
            <span style={{ fontSize: 11.5, color: '#71717a' }}>לפי רגעים</span>
          </div>
          <div className="tz-ge-deck-scroll">
            {moments.length === 0 && (
              <div className="tz-ws-deck-empty">{emptyLine(filter, pending)}</div>
            )}
            {moments.map((m) => (
              <div key={m.key} className="tz-ws-deck-moment">
                <span className="tz-ws-deck-label">{m.title}</span>
                {m.names.map((n) => {
                  const f = frameByName.get(n);
                  if (!f) return null;
                  const t = byName.get(n);
                  const d = cull[n];
                  const badge = d === 'reject' ? ['הוצאה', 'is-out']
                    : d === 'keep' ? ['נשארת', 'is-kept']
                    : t?.suggestion === 'remove' ? ['מוצע להסיר', 'is-suggest']
                    : t?.suggestion === 'duplicate' ? ['כפולה', 'is-dup']
                    : null;
                  return (
                    <div
                      key={n}
                      ref={(el) => { tileRefs.current[n] = el as unknown as HTMLButtonElement; }}
                      className={`tz-ge-slide-item ${n === sel ? 'active' : ''}${d === 'reject' ? ' tz-ws-out' : ''}`}
                      onClick={() => setSel(n)}
                      role="option"
                      aria-selected={n === sel}
                    >
                      <img className="tz-ge-slide-thumb" src={thumbUrl(f.path, 320)} alt={n} title={n} loading="lazy" />
                      {badge && <span className={`tz-ws-badge ${badge[1]}`}>{badge[0]}</span>}
                      {t?.star && !d && <span className="tz-ws-star" title="התמונה המומלצת מהרצף">★</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        <main className="tz-ge-canvas-stage">
          <div className="tz-ge-canvas-toolbar">
            <div className="tz-ge-canvas-nav">
              <button type="button" className="tz-ge-canvas-nav-btn" disabled={position <= 0} onClick={() => step(-1)} title="הקודמת (חץ ימינה)">›</button>
              <button type="button" className="tz-ge-canvas-nav-btn" disabled={position >= flat.length - 1} onClick={() => step(1)} title="הבאה (חץ שמאלה)">‹</button>
              <span className="tz-ws-counter">
                {position >= 0 ? `${position + 1} / ${flat.length}` : ''}
              </span>
              <span className="tz-ws-file" dir="ltr">{sel ?? ''}</span>
            </div>
            <div className={`tz-ws-frame-state ${frameState}`}>
              <b>{frameStateLabel}</b>
              <span>{frameReason}</span>
            </div>
            {twinFrame && (
              <button type="button" className={`tz-ge-brush-btn ${showTwin ? 'active' : ''}`} onClick={() => setCompare((v) => !v)}>
                {showTwin ? 'הסתר תאומה' : 'השווה לתאומה'} · C
              </button>
            )}
          </div>

          <div className={`tz-ws-canvas${stack ? ' is-stack' : ''}`} ref={loupeRef}>
            {selFrame ? (
              <>
                <figure>
                  <div className="tz-ws-imgbox" style={{ width: imgW, height: imgH }}>
                    <img
                      src={thumbUrl(selFrame.path, 1600)}
                      alt=""
                      draggable={false}
                      onDoubleClick={() => setFocusOpen(true)}
                      onLoad={(e) => {
                        const im = e.currentTarget;
                        if (im.naturalWidth && im.naturalHeight) setAspect(im.naturalWidth / im.naturalHeight);
                      }}
                    />
                    {/* The face the suggestion is about: a hairline, never a fill. */}
                    {typeof flaggedFace === 'number' && selT?.faces[flaggedFace] && (
                      <i
                        className="tz-ws-facebox"
                        style={{
                          left: `${selT.faces[flaggedFace].box.x * 100}%`,
                          top: `${selT.faces[flaggedFace].box.y * 100}%`,
                          width: `${selT.faces[flaggedFace].box.width * 100}%`,
                          height: `${selT.faces[flaggedFace].box.height * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  {showTwin && <figcaption>התמונה הזו</figcaption>}
                </figure>
                {showTwin && twinFrame && (
                  <figure>
                    <div className="tz-ws-imgbox" style={{ width: imgW, height: imgH }}>
                      <img src={thumbUrl(twinFrame.path, 1600)} alt="" draggable={false} />
                    </div>
                    <figcaption>התאומה הטובה יותר · <span dir="ltr">{twinRef}</span></figcaption>
                  </figure>
                )}
              </>
            ) : (
              <p className="tz-ws-canvas-empty">{emptyLine(filter, pending)}</p>
            )}
          </div>

          <div className="tz-ws-decision-dock" aria-label="החלטת תמונה">
            <button type="button" className={`tz-ws-dock-btn is-out${selDecision === 'reject' ? ' is-on' : ''}`} disabled={!selFrame} onClick={() => decideAndAdvance('reject')}>
              <span>×</span>
              <b>הוצא</b>
              <kbd>X</kbd>
            </button>
            <button type="button" className={`tz-ws-dock-btn is-keep${selDecision === 'keep' ? ' is-on' : ''}`} disabled={!selFrame} onClick={() => decideAndAdvance('keep')}>
              <span>✓</span>
              <b>השאר</b>
              <kbd>K</kbd>
            </button>
            <button type="button" className="tz-ws-dock-btn is-clear" disabled={!selFrame || !selDecision} onClick={() => decideAndAdvance(null)}>
              <span>↺</span>
              <b>בטל</b>
              <kbd>U</kbd>
            </button>
          </div>
        </main>

        {/* 3. THE DECISION — where the editing screen keeps its tools */}
        <aside className="tz-ge-tools-panel">
          <div className="tz-ge-panel-head">
            <h2 className="tz-ge-panel-title">בקרת בחירה</h2>
            <span style={{ fontSize: 11.5, color: '#71717a' }}>המערכת מציעה, אתה מחליט</span>
          </div>
          <div className="tz-ws-panel">
            {/* What the tool proposes for the whole set */}
            <section className="tz-ws-sect">
              <h3>המערכת מציעה</h3>
              {fault ? (
                <p className="tz-ws-fault">לא ניתן לקבל הצעות מהמנוע: {fault}. אפשר להחליט ידנית.</p>
              ) : !result ? (
                <p className="tz-ws-muted">פונה למנוע…</p>
              ) : (
                <>
                  {pending > 0 && (
                    <p className="tz-ws-muted tz-ws-progress">
                      מנתח את הצילום · {analysed.toLocaleString('he-IL')} מתוך {frames.length.toLocaleString('he-IL')}
                      <span className="tz-ws-bar"><i style={{ width: `${(analysed / frames.length) * 100}%` }} /></span>
                    </p>
                  )}
                  <div className="tz-ws-stats">
                    <button type="button" className={`tz-ws-stat is-remove${filter === 'remove' ? ' is-on' : ''}`} onClick={() => setFilter('remove')}>
                      <b>{counts.remove.toLocaleString('he-IL')}</b>
                      <span>להסרה</span>
                      <small>יש להן תאומה טובה יותר</small>
                    </button>
                    <button type="button" className={`tz-ws-stat${filter === 'duplicate' ? ' is-on' : ''}`} onClick={() => setFilter('duplicate')}>
                      <b>{counts.duplicate.toLocaleString('he-IL')}</b>
                      <span>כפולות</span>
                      <small>של תמונה מומלצת ★</small>
                    </button>
                  </div>
                  {bulk.length > 0 && (
                    <button type="button" className="tz-ws-bulk" onClick={() => decide(bulk, 'reject', `${bulk.length} הצעות התקבלו`)}>
                      הוצא את כל {bulk.length.toLocaleString('he-IL')} ההצעות שבתצוגה
                    </button>
                  )}
                </>
              )}
            </section>

            {/* What it says about THIS frame, and the decision */}
            {selFrame && (
              <section className="tz-ws-sect">
                <h3>התמונה הזו</h3>
                <div className={`tz-ws-verdict${suggestion?.suggestion === 'remove' ? ' is-remove' : ''}`}>
                  {cull[sel!] ? (
                    <p><b>{cull[sel!] === 'reject' ? 'הוצאה מהסט' : 'נשארת בסט'}</b></p>
                  ) : !selT ? (
                    <p className="tz-ws-muted">עוד לא נותחה.</p>
                  ) : suggestion && mainReason ? (
                    <>
                      <p><b>{suggestion.suggestion === 'remove' ? 'מוצע להסיר' : 'כפולה'} — {REASON_WORDS[mainReason.code] ?? mainReason.label}</b></p>
                      {mainReason.ref && <p className="tz-ws-muted">{twinLine(mainReason.code)}.</p>}
                    </>
                  ) : selT.suggestion === 'unread' ? (
                    <p className="tz-ws-fault">לא ניתן לקרוא את הקובץ.</p>
                  ) : (
                    <p className="tz-ws-muted">{selT.star ? '★ התמונה המומלצת מהרצף שלה.' : 'אין הצעה לתמונה הזו.'}</p>
                  )}
                </div>

                <div className="tz-ws-decide">
                  <button type="button" className={`tz-ws-btn is-out${cull[sel!] === 'reject' ? ' is-on' : ''}`} onClick={() => decideAndAdvance('reject')}>
                    הוצא <kbd>X</kbd>
                  </button>
                  <button type="button" className={`tz-ws-btn is-keep${cull[sel!] === 'keep' ? ' is-on' : ''}`} onClick={() => decideAndAdvance('keep')}>
                    השאר <kbd>K</kbd>
                  </button>
                </div>
                {cull[sel!] && (
                  <button type="button" className="tz-ws-link" onClick={() => decideAndAdvance(null)}>בטל החלטה (U)</button>
                )}
              </section>
            )}

            {selT && selT.faces.length > 0 && selFrame && (
              <section className="tz-ws-sect">
                <h3>הפנים בתמונה</h3>
                <FaceStrip src={thumbUrl(selFrame.path, 1600)} aspect={aspect} faces={selT.faces} flagged={flaggedFace} />
              </section>
            )}

            <p className="tz-ws-keys tz-ws-muted">
              חצים — הבאה/קודמת · X הוצא · K השאר · U בטל · C תאומה · Ctrl+Z ביטול
            </p>
          </div>
        </aside>
      </div>

      {undo && (
        <div className="tz-ws-toast" role="status">
          <span>{undo.label}</span>
          <button type="button" className="tz-ws-link" onClick={undoLast}>בטל</button>
          <button type="button" className="tz-ws-link" onClick={() => setUndo(null)} aria-label="סגור">✕</button>
        </div>
      )}

      {focusOpen && selFrame && (
        <div className={`tz-ws-focus ${frameState}`} role="dialog" aria-modal="true" aria-label="תצוגת תמונה">
          <header className="tz-ws-focus-top">
            <div className="tz-ws-focus-meta">
              <b>{position >= 0 ? `${position + 1} / ${flat.length}` : ''}</b>
              <span dir="ltr">{sel}</span>
            </div>
            <div className={`tz-ws-frame-state ${frameState}`}>
              <b>{frameStateLabel}</b>
              <span>{frameReason}</span>
            </div>
            <div className="tz-ws-focus-tools">
              <button
                type="button"
                onClick={() => setFocusZoom((z) => (z === 'fit' || z <= 1 ? 'fit' : Math.max(1, Math.round((z - 0.25) * 100) / 100)))}
                aria-label="הקטן"
              >−</button>
              <output>{focusZoom === 'fit' ? 'התאם' : `${Math.round(focusZoom * 100)}%`}</output>
              <button
                type="button"
                onClick={() => setFocusZoom((z) => (z === 'fit' ? 1 : Math.min(1.75, Math.round((z + 0.25) * 100) / 100)))}
                aria-label="הגדל"
              >＋</button>
              <button type="button" onClick={() => setFocusZoom(1)} aria-label="מאה אחוז">100%</button>
              <button type="button" onClick={() => setFocusZoom('fit')} aria-label="התאם למסך">התאם</button>
              <button type="button" onClick={() => setFocusOpen(false)} aria-label="סגור">×</button>
            </div>
          </header>

          <div className="tz-ws-focus-stage">
            <button type="button" className="tz-ws-focus-nav prev" disabled={position <= 0} onClick={() => step(-1)} aria-label="תמונה קודמת">›</button>
            <div className="tz-ws-focus-scroll">
              <img
                src={thumbUrl(selFrame.path, 2400)}
                alt=""
                draggable={false}
                className={focusZoom === 'fit' ? 'is-fit' : 'is-zoomed'}
                onDoubleClick={() => setFocusZoom((z) => (z === 'fit' ? 1 : 'fit'))}
                style={{
                  width: focusZoom === 'fit' ? undefined : `min(${Math.round(92 * focusZoom)}vw, ${Math.round(1560 * focusZoom)}px)`,
                }}
              />
            </div>
            <button type="button" className="tz-ws-focus-nav next" disabled={position >= flat.length - 1} onClick={() => step(1)} aria-label="תמונה הבאה">‹</button>
          </div>

          <footer className="tz-ws-focus-actions">
            <button type="button" className={`tz-ws-dock-btn is-out${selDecision === 'reject' ? ' is-on' : ''}`} onClick={() => decideAndAdvance('reject')}>
              <span>×</span>
              <b>הוצא</b>
              <kbd>X</kbd>
            </button>
            <button type="button" className={`tz-ws-dock-btn is-keep${selDecision === 'keep' ? ' is-on' : ''}`} onClick={() => decideAndAdvance('keep')}>
              <span>✓</span>
              <b>השאר</b>
              <kbd>P/K</kbd>
            </button>
            <button type="button" className="tz-ws-dock-btn is-clear" disabled={!selDecision} onClick={() => decideAndAdvance(null)}>
              <span>↺</span>
              <b>בטל</b>
              <kbd>U</kbd>
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

function emptyLine(filter: Filter, pending: number): string {
  if (filter === 'remove') return pending > 0 ? 'הניתוח עוד רץ — ההצעות יופיעו כאן.' : 'אין הצעות להסרה בתצוגה הזו.';
  if (filter === 'duplicate') return pending > 0 ? 'הניתוח עוד רץ — הכפולות יופיעו כאן.' : 'אין כפולות בתצוגה הזו.';
  if (filter === 'rejected') return 'עוד לא הוצאה אף תמונה.';
  return 'אין תמונות בתצוגה הזו.';
}

/** Every face in the frame, enlarged side by side — the view a photographer
 *  otherwise builds by zooming into each face in turn. Cropped from the same
 *  preview the large view shows, so nothing new is fetched. */
function FaceStrip({
  src, aspect, faces, flagged,
}: {
  src: string;
  aspect: number;
  faces: TriageFrame['faces'];
  flagged?: number;
}) {
  const shown = faces
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, 8);
  return (
    <div className="tz-ws-faces" aria-label="הפנים בתמונה">
      {shown.map((f) => {
        // A square window around the face, in the image's own proportions.
        const side = Math.max(f.box.width, f.box.height / aspect) * 1.5;
        const w = Math.min(1, side);
        const h = Math.min(1, side * aspect);
        const cx = f.box.x + f.box.width / 2;
        const cy = f.box.y + f.box.height / 2;
        const x = Math.max(0, Math.min(1 - w, cx - w / 2));
        const y = Math.max(0, Math.min(1 - h, cy - h / 2));
        return (
          <span
            key={f.i}
            className={`tz-ws-face${f.i === flagged ? ' is-flagged' : ''}`}
            style={{
              backgroundImage: `url("${src}")`,
              backgroundSize: `${100 / w}% ${100 / h}%`,
              backgroundPosition: `${w < 1 ? (x / (1 - w)) * 100 : 0}% ${h < 1 ? (y / (1 - h)) * 100 : 0}%`,
            }}
          />
        );
      })}
    </div>
  );
}
