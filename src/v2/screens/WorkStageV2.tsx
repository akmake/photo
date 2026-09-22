/* סינון — the photographer decides what stays and what goes to the client.
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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { previewUrl, registerRecipe, shotInfo, thumbUrl, triageSet } from '../../api';
import type { Frame, ShotInfo, TriageFrame, TriageResult } from '../../api';
import {
  activeSteps, batchOfFrame, frameKey, setCull, useBatches, useCull, useProjectFiles, useRecipe,
} from '../../studio/store';
import type { CullDecision, Project } from '../../studio/store';
import PhotoEditor from './PhotoEditor';
import PhotoGrid from '../../components/photo-grid/PhotoGrid';
import type { GridItem, GridSection, PhotoGridHandle } from '../../components/photo-grid/PhotoGrid';
import { useDims } from '../../components/photo-grid/useDims';
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
  const [editing, setEditing] = useState(false);
  // Several frames at once: Ctrl adds one, Shift takes the run between.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [compare, setCompare] = useState<string[] | null>(null);
  const [compareActive, setCompareActive] = useState(0);

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

  /* ---- bursts: consecutive frames the engine calls near-identical (one twin
   * group) fold into ONE cell — the recommended frame on top, the count on
   * its corner. Opened, the burst lies inline, tinted as one family. */
  const [stacking, setStacking] = useState(true);
  const [openStacks, setOpenStacks] = useState<Set<string>>(() => new Set());
  const layout = useMemo(() => groups.map((g) => {
    const items: { key: string; names: string[]; cover: string }[] = [];
    let i = 0;
    while (i < g.names.length) {
      const t = byName.get(g.names[i])?.twins;
      if (stacking && t != null) {
        let j = i;
        while (j < g.names.length && byName.get(g.names[j])?.twins === t) j += 1;
        const names = g.names.slice(i, j);
        if (names.length > 1) {
          const cover = names.find((n) => byName.get(n)?.star) ?? names[0];
          items.push({ key: `${g.id}:${t}:${names[0]}`, names, cover });
          i = j;
          continue;
        }
      }
      items.push({ key: g.names[i], names: [g.names[i]], cover: g.names[i] });
      i += 1;
    }
    return { ...g, items };
  }), [groups, byName, stacking]);

  const flat = useMemo(() => layout.flatMap((g) => g.items.flatMap((it) => (
    it.names.length > 1 && !openStacks.has(it.key) ? [it.cover] : it.names
  ))), [layout, openStacks]);

  /* ---- what the grid is handed: per section, the frames shown (a closed
   * burst shows its cover), each with its proportions and its thumbnail —
   * the frame's own edit when it has one. */
  const dims = useDims(useMemo(() => frames.map((f) => f.path), [frames]));
  const editedKeys = useEditedKeys(projectId);
  const stackOf = useMemo(() => {
    const m = new Map<string, { count: number; open: boolean; first: boolean; onToggle: () => void }>();
    for (const g of layout) {
      for (const it of g.items) {
        if (it.names.length < 2) continue;
        const open = openStacks.has(it.key);
        const shown = open ? it.names : [it.cover];
        shown.forEach((n, idx) => m.set(n, { count: it.names.length, open, first: idx === 0, onToggle: () => toggleStackRef.current(it.key) }));
      }
    }
    return m;
  }, [layout, openStacks]);
  const gridSections = useMemo<GridSection[]>(() => layout.map((g) => ({
    id: g.id,
    title: g.title ? <><span>{g.title}</span><em className="tz-ws-pg-count">{g.names.length.toLocaleString('he-IL')} תמונות</em></> : undefined,
    items: g.items.flatMap((it) => (it.names.length > 1 && !openStacks.has(it.key) ? [it.cover] : it.names))
      .map((n): GridItem | null => {
        const f = frameByName.get(n);
        if (!f) return null;
        const key = editedKeys.get(n);
        return {
          id: n,
          alt: n,
          aspect: dims.get(f.path),
          src: (w) => (key ? previewUrl(f.path, w, key) : thumbUrl(f.path, w)),
        };
      })
      .filter((x): x is GridItem => Boolean(x)),
  })), [layout, openStacks, frameByName, dims, editedKeys]);

  const toggleStackRef = useRef<(key: string) => void>(() => undefined);
  const toggleStack = useCallback((key: string) => {
    setOpenStacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  toggleStackRef.current = toggleStack;

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
  const gridRef = useRef<PhotoGridHandle | null>(null);
  const [size, setSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('tz-ws-size')) || 220; } catch { return 220; }
  });
  useEffect(() => { try { localStorage.setItem('tz-ws-size', String(size)); } catch { /* per-viewer only */ } }, [size]);

  const bring = useCallback((n: string) => {
    // A frame folded inside a closed burst is opened first, then shown.
    for (const g of layout) {
      const it = g.items.find((x) => x.names.length > 1 && x.names.includes(n) && x.cover !== n);
      if (it && !openStacks.has(it.key)) setOpenStacks((prev) => new Set(prev).add(it.key));
    }
    setSel(n);
    requestAnimationFrame(() => requestAnimationFrame(() => gridRef.current?.reveal(n)));
  }, [layout, openStacks]);

  /** Up and down follow the rows as they are laid out on screen. */
  const moveVertical = useCallback((dir: 'up' | 'down') => {
    if (!sel) return;
    const n = gridRef.current?.neighbor(sel, dir);
    if (n) bring(n);
  }, [bring, sel]);

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

  /* ---- selecting several */
  const select = useCallback((n: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e && (e.ctrlKey || e.metaKey)) {
      setPicked((prev) => {
        const next = new Set(prev);
        if (!next.size && sel && sel !== n) next.add(sel);
        if (next.has(n)) next.delete(n); else next.add(n);
        return next;
      });
      anchor.current = n;
    } else if (e?.shiftKey) {
      const from = flat.indexOf(anchor.current ?? sel ?? n);
      const to = flat.indexOf(n);
      if (from >= 0 && to >= 0) setPicked(new Set(flat.slice(Math.min(from, to), Math.max(from, to) + 1)));
    } else {
      setPicked(new Set());
      anchor.current = n;
    }
    setSel(n);
  }, [flat, sel]);

  // Picked frames that left the view (a filter, a folded burst) drop out.
  useEffect(() => {
    setPicked((prev) => {
      const next = new Set([...prev].filter((n) => flat.includes(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [flat]);

  const pickedList = useMemo(() => flat.filter((n) => picked.has(n)), [flat, picked]);

  /** One decision for everything picked — or for the one frame, and move on. */
  const act = useCallback((decision: CullDecision) => {
    if (pickedList.length > 1) {
      decide(pickedList, decision, `${pickedList.length.toLocaleString('he-IL')} תמונות · ${WORD[decision]}`);
      return;
    }
    if (sel) decideOne(sel, decision);
  }, [decide, decideOne, pickedList, sel]);

  const openCompare = useCallback(() => {
    const names = pickedList.length >= 2
      ? pickedList.slice(0, 4)
      : sel && flat[flat.indexOf(sel) + 1] ? [sel, flat[flat.indexOf(sel) + 1]] : null;
    if (!names) return;
    setCompare(names);
    setCompareActive(0);
  }, [flat, pickedList, sel]);

  /* ---- the keyboard, by key POSITION so the Hebrew layout works the same. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const code = e.code || KEY_TO_CODE[e.key] || e.key;
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); undoLast(); return; }
      if ((e.ctrlKey || e.metaKey) && code === 'KeyA' && !viewer && !compare) {
        e.preventDefault(); setPicked(new Set(flat)); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Side by side: the keys act on the frame in focus, and stay there.
      if (compare) {
        const n = compare[compareActive];
        const on = (d: CullDecision) => { e.preventDefault(); decide([n], cull[n] === d ? null : d, `${n} · ${cull[n] === d ? 'ההחלטה בוטלה' : WORD[d]}`); };
        switch (code) {
          case 'Escape': case 'KeyC': e.preventDefault(); setCompare(null); break;
          case 'ArrowLeft': e.preventDefault(); setCompareActive((i) => Math.min(compare.length - 1, i + 1)); break;
          case 'ArrowRight': e.preventDefault(); setCompareActive((i) => Math.max(0, i - 1)); break;
          case 'KeyK': case 'KeyP': case 'Digit1': on('keep'); break;
          case 'KeyM': case 'Digit2': on('maybe'); break;
          case 'KeyX': case 'Delete': case 'Digit3': on('reject'); break;
          default:
        }
        return;
      }
      switch (code) {
        case 'Escape':
          if (viewer) { e.preventDefault(); setViewer(false); } else if (picked.size) { e.preventDefault(); setPicked(new Set()); }
          break;
        case 'KeyC': if (!viewer) { e.preventDefault(); openCompare(); } break;
        case 'Enter': if (sel && !viewer) { e.preventDefault(); setViewer(true); } break;
        case 'ArrowLeft': e.preventDefault(); step(1); break;
        case 'ArrowRight': e.preventDefault(); step(-1); break;
        case 'ArrowDown': e.preventDefault(); if (viewer) step(1); else moveVertical('down'); break;
        case 'ArrowUp': e.preventDefault(); if (viewer) step(-1); else moveVertical('up'); break;
        case 'KeyK': case 'KeyP': case 'Digit1': if (sel) { e.preventDefault(); if (viewer) decideOne(sel, 'keep'); else act('keep'); } break;
        case 'KeyM': case 'Digit2': if (sel) { e.preventDefault(); if (viewer) decideOne(sel, 'maybe'); else act('maybe'); } break;
        case 'KeyX': case 'Delete': case 'Digit3': if (sel) { e.preventDefault(); if (viewer) decideOne(sel, 'reject'); else act('reject'); } break;
        case 'KeyU': case 'Backspace': {
          const names = !viewer && pickedList.length > 1 ? pickedList : sel && cull[sel] ? [sel] : [];
          if (names.length) { e.preventDefault(); decide(names, null, names.length > 1 ? `${names.length} תמונות · ההחלטה בוטלה` : `${names[0]} · ההחלטה בוטלה`); }
          break;
        }
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, moveVertical, compare, compareActive, cull, decide, decideOne, flat, openCompare, picked, pickedList, sel, step, undoLast, viewer]);

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
            <button type="button" className="tz-ws-back" onClick={onBack} title="חזרה לסשנים">
              <span aria-hidden>→</span> סשנים
            </button>
          )}
          <div className="tz-ws-title">
            <b>סינון</b>
            <span>{[project.client, project.event].filter(Boolean).join(' · ')}</span>
          </div>
        </div>

        <nav className="tz-ws-filters" aria-label="תצוגה">
          {FILTERS.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              className={`tz-ws-filter is-${id}${filter === id ? ' is-on' : ''}`}
              onClick={() => { setFilter(id); gridRef.current?.scrollToTop(); }}
            >
              {label}<i>{n.toLocaleString('he-IL')}</i>
            </button>
          ))}
        </nav>

        <div className="tz-ws-top-side is-end">
          <button
            type="button"
            className={`tz-ws-stacking${stacking ? ' is-on' : ''}`}
            onClick={() => setStacking((v) => !v)}
            title="רצפים של תמונות כמעט זהות — בערימה אחת או פרושים"
          >
            {stacking ? 'רצפים מקובצים' : 'רצפים פרושים'}
          </button>
          <label className="tz-ws-size" title="גודל התמונות בגלריה">
            <span aria-hidden>▫</span>
            <input type="range" min={120} max={440} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="גודל התמונות" />
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
          <button type="button" role="tab" aria-selected={batch === 'all'} className={batch === 'all' ? 'is-on' : ''} onClick={() => { setBatch('all'); gridRef.current?.scrollToTop(); }}>
            כל הסשנים<i>{frames.length.toLocaleString('he-IL')}</i>
          </button>
          {batches.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={batch === b.id} className={batch === b.id ? 'is-on' : ''} onClick={() => { setBatch(b.id); gridRef.current?.scrollToTop(); }}>
              {b.name}<i>{(batchCounts[b.id] ?? 0).toLocaleString('he-IL')}</i>
            </button>
          ))}
          {batchCounts.none > 0 && (
            <button type="button" role="tab" aria-selected={batch === 'none'} className={batch === 'none' ? 'is-on' : ''} onClick={() => { setBatch('none'); gridRef.current?.scrollToTop(); }}>
              ללא מקבץ<i>{batchCounts.none.toLocaleString('he-IL')}</i>
            </button>
          )}
        </div>
      )}

      <div className="tz-ws-feed">
        {!ready ? (
          <p className="tz-ws-empty">טוען את תיקיית הפרויקט…</p>
        ) : (
          <PhotoGrid
            ref={gridRef}
            className="tz-ws-pg"
            sections={gridSections}
            targetHeight={size}
            onZoom={(dir) => setSize((v) => Math.round(Math.max(120, Math.min(440, v * (dir > 0 ? 1.14 : 1 / 1.14)))))}
            currentId={sel}
            isSelected={(id) => picked.has(id)}
            onItemClick={(id, e) => select(id, e)}
            onItemDoubleClick={(id) => { setSel(id); setViewer(true); }}
            onToggleSelect={(id) => select(id, { ctrlKey: true, metaKey: false, shiftKey: false })}
            tileClass={(item) => {
              const d = cull[item.id];
              const st = stackOf.get(item.id);
              return `${d ? `is-${d}` : ''}${st ? (st.open ? ' in-stack' : ' is-stack') : ''}`;
            }}
            renderOverlay={(item, state) => (
              <TileOverlay
                name={item.id}
                triage={byName.get(item.id)}
                decision={cull[item.id]}
                twin={twinOf(byName.get(item.id), frameByName)}
                stack={stackOf.get(item.id)}
                show={state.hovered || state.current}
                small={state.width < 150}
                onDecide={(d) => (picked.has(item.id) && pickedList.length > 1 ? act(d) : decideOne(item.id, d))}
                onTwin={(t) => bring(t)}
              />
            )}
            empty={emptyLine(filter, pending)}
            header={bulk.length > 0 ? (
              <div className="tz-ws-bulkbar">
                <span>המערכת מציעה להסיר {bulk.length.toLocaleString('he-IL')} תמונות שיש להן תאומה טובה יותר.</span>
                <button type="button" onClick={() => decide(bulk, 'reject', `${bulk.length} תמונות הוסרו`)}>הסר את כולן</button>
              </div>
            ) : null}
            footer={flat.length ? (
              <p className="tz-ws-end">
                {flat.length.toLocaleString('he-IL')} תמונות בתצוגה · חצים למעבר · K שמור · M מתלבט · X הסר · לחיצה כפולה או Enter לתצוגה גדולה · Ctrl/Shift לבחירת כמה · C להשוואה
              </p>
            ) : null}
          />
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
          projectId={projectId}
          onEdit={() => setEditing(true)}
          frame={frameByName.get(sel)!}
          faces={byName.get(sel)?.faces ?? []}
          neighbors={[flat[flat.indexOf(sel) + 1], flat[flat.indexOf(sel) - 1], flat[flat.indexOf(sel) + 2]]
            .map((n) => (n ? frameByName.get(n)?.path : undefined))
            .filter((p): p is string => Boolean(p))}
          name={sel}
          position={flat.indexOf(sel)}
          total={flat.length}
          decision={cull[sel]}
          onClose={() => setViewer(false)}
          onStep={step}
          onDecide={(d) => decideOne(sel, d)}
        />
      )}

      {editing && sel && frameByName.get(sel) && (
        <PhotoEditor
          projectId={projectId}
          frame={frameByName.get(sel)!}
          name={sel}
          onClose={() => setEditing(false)}
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

function TileOverlay({
  name, triage, decision, twin, stack, show, small, onDecide, onTwin,
}: {
  name: string;
  triage?: TriageFrame;
  decision?: CullDecision;
  twin: { name: string; frame: Frame } | null;
  stack?: { count: number; open: boolean; first: boolean; onToggle: () => void };
  show: boolean;
  small: boolean;
  onDecide: (d: CullDecision) => void;
  onTwin: (name: string) => void;
}) {
  const suggestion = !decision && (triage?.suggestion === 'remove' || triage?.suggestion === 'duplicate') ? triage : null;
  const reason = suggestion?.reasons.find((r) => r.code !== 'duplicate') ?? suggestion?.reasons[0];
  const why = suggestion && reason
    ? `${suggestion.suggestion === 'remove' ? 'מוצע להסיר' : 'כפולה'} · ${REASON_WORDS[reason.code] ?? reason.label}${twin ? ' — לחץ לתאומה' : ''}`
    : '';
  return (
    <>
      {decision && <span className={`tz-ws-pg-mark is-${decision}`}>{WORD[decision]}</span>}
      {!decision && suggestion && (
        <button
          type="button"
          className={`tz-ws-pg-flag is-${suggestion.suggestion}`}
          title={why}
          aria-label={why}
          onClick={(e) => { e.stopPropagation(); if (twin) onTwin(twin.name); }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {suggestion.suggestion === 'remove' ? '!' : '≈'}
        </button>
      )}
      {!decision && !suggestion && triage?.star && !stack && <span className="tz-ws-pg-star" title="המומלצת מהרצף">★</span>}
      {stack && (stack.first || !stack.open) && (
        <button
          type="button"
          className={`tz-ws-pg-stack${stack.open ? ' is-open' : ''}`}
          onClick={(e) => { e.stopPropagation(); stack.onToggle(); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={stack.open ? 'קפל את הרצף' : `פתח את הרצף — ${stack.count} תמונות כמעט זהות`}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden><rect x="7" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 7v12a2 2 0 0 0 2 2h12" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          {stack.count}
        </button>
      )}
      <div className={`tz-ws-pg-bar${show ? ' is-on' : ''}`} onDoubleClick={(e) => e.stopPropagation()}>
        {!small && <span className="tz-ws-pg-name" dir="ltr">{name}</span>}
        <Decide decision={decision} onDecide={onDecide} compact />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the viewer
 * The Windows Photos grammar: the name on top, the picture fitted, zoom along
 * the bottom with a slider and a percentage, the wheel zooms, a drag pans,
 * a double-click jumps between fit and actual size. */

/* Large previews already decoded, by URL — so moving back and forth is instant
 * and the screen never shows a half-loaded or stretched picture. */
const decoded = new Map<string, { w: number; h: number }>();
function preload(src: string): Promise<{ w: number; h: number }> {
  const known = decoded.get(src);
  if (known) return Promise.resolve(known);
  const im = new Image();
  im.src = src;
  return im.decode().then(() => {
    const size = { w: im.naturalWidth, h: im.naturalHeight };
    decoded.set(src, size);
    if (decoded.size > 40) decoded.delete(decoded.keys().next().value as string);
    return size;
  });
}

function Viewer({
  projectId, onEdit, frame, faces, neighbors, name, position, total, decision, onClose, onStep, onDecide,
}: {
  projectId: string;
  onEdit: () => void;
  frame: Frame;
  faces: TriageFrame['faces'];
  neighbors: string[];
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
  // What is ON SCREEN: the previous photograph stays until the next one is
  // fully decoded, then the two swap in one frame.
  const [shown, setShown] = useState<{ src: string; w: number; h: number } | null>(null);
  const natural = shown;
  const [zoom, setZoom] = useState(1); // 1 = fit
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [facesOn, setFacesOn] = useState(true);
  // The faces belong to the picture on screen, not to the one still loading.
  const [shownFaces, setShownFaces] = useState<TriageFrame['faces']>([]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The photograph as it is now — with this frame's own edit when it has one.
  const src = useEditedSrc(projectId, name, frame.path, 2400);
  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    preload(src)
      .then((size) => { if (alive) { setZoom(1); setShown({ src, ...size }); setShownFaces(faces); } })
      .catch(() => { if (alive) { setZoom(1); setShown({ src, w: 1500, h: 1000 }); setShownFaces(faces); } });
    // The frames either side, ready before he gets there.
    for (const p of neighbors) void preload(thumbUrl(p, 2400)).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

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

  // Where to scroll once the new zoom is laid out — applied after React has
  // drawn the larger canvas, never before (a scroll set earlier is clamped to
  // the old, smaller size and lands at the corner).
  const pendingScroll = useRef<((el: HTMLDivElement) => void) | null>(null);
  useLayoutEffect(() => {
    const el = stageRef.current;
    const f = pendingScroll.current;
    pendingScroll.current = null;
    if (el && f) f(el);
  }, [zoom]);

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
    pendingScroll.current = (st) => {
      st.scrollLeft = ox * st.scrollWidth - px;
      st.scrollTop = oy * st.scrollHeight - py;
    };
    setZoom(z);
  }, [maxZoom]);

  /** Zoom straight onto one face: its height about half the window. */
  const zoomToFace = useCallback((b: { x: number; y: number; width: number; height: number }) => {
    const el = stageRef.current;
    if (!el) return;
    const z = Math.max(1, Math.min(maxZoom, (box.h * 0.5) / Math.max(1, b.height * fitH)));
    pendingScroll.current = (st) => {
      const wN = fitW * z; const hN = fitH * z;
      const cw = Math.max(wN + pad * 2, box.w); const ch = Math.max(hN + pad * 2, box.h);
      st.scrollLeft = (cw - wN) / 2 + (b.x + b.width / 2) * wN - box.w / 2;
      st.scrollTop = (ch - hN) / 2 + (b.y + b.height / 2) * hN - box.h / 2;
    };
    if (z === zoom) { pendingScroll.current(el); pendingScroll.current = null; } else setZoom(z);
  }, [box, fitH, fitW, maxZoom, zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.code === 'KeyF' || e.key === 'כ') { e.preventDefault(); setFacesOn((v) => !v); }
      if (e.code === 'KeyE' || e.key === 'ק') { e.preventDefault(); onEdit(); }
      if (e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); zoomTo(zoom * 1.25); }
      if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomTo(zoom / 1.25); }
      if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); zoomTo(1); }
      if (e.code === 'Space') { e.preventDefault(); zoomTo(zoom > 1 ? 1 : actual); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actual, onEdit, zoom, zoomTo]);

  return (
    <div className={`tz-ws-viewer${decision ? ` is-${decision}` : ''}`} role="dialog" aria-modal="true" aria-label="תצוגה מלאה">
      <header className="tz-ws-v-top">
        <button type="button" className="tz-ws-v-edit" onClick={onEdit} title="עריכה (E)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="14" height="14" rx="2" /><path d="M13 21l1.5-4.5L21 10l-3-3-6.5 6.5L7 15" />
          </svg>
          ערוך
        </button>
        <div className="tz-ws-v-name">
          <b dir="ltr">{name}</b>
          <span>{(position + 1).toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')}</span>
        </div>
        <button type="button" className="tz-ws-v-icon is-close" onClick={onClose} aria-label="סגור (Esc)" title="סגור (Esc)">✕</button>
      </header>

      <div className="tz-ws-v-body">
      <div
        className={`tz-ws-v-stage${zoom > 1 ? ' is-zoomed' : ''}`}
        ref={stageRef}
        dir="ltr"
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
          {shown && (
            <img
              src={shown.src}
              alt={name}
              draggable={false}
              style={{ width: w, height: h }}
              onDoubleClick={(e) => zoomTo(zoom > 1 ? 1 : actual, e.clientX, e.clientY)}
            />
          )}
        </div>
      </div>

      {facesOn && shown && shownFaces.length > 0 && (
        <aside className="tz-ws-v-faces" aria-label="הפנים בתמונה">
          <h3>הפנים בתמונה <span>{shownFaces.length.toLocaleString('he-IL')}</span></h3>
          <FaceList src={shown.src} aspect={shown.w / shown.h} faces={shownFaces} onPick={zoomToFace} />
          <p className="tz-ws-v-faces-hint">לחיצה על פנים — הגדלה אליהן · F הסתר</p>
        </aside>
      )}
      </div>

      <button type="button" className="tz-ws-v-nav is-prev" disabled={position <= 0} onClick={() => onStep(-1)} aria-label="הקודמת">›</button>
      <button type="button" className="tz-ws-v-nav is-next" disabled={position >= total - 1} onClick={() => onStep(1)} aria-label="הבאה">‹</button>

      <footer className="tz-ws-v-bottom">
        {shown ? <ShotLine path={frame.path} /> : <span className="tz-ws-shot" />}
                <Decide decision={decision} onDecide={onDecide} />
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
          {shownFaces.length > 0 && (
            <button type="button" className={facesOn ? 'is-on' : ''} onClick={() => setFacesOn((v) => !v)} title="הפנים מקרוב (F)">פנים</button>
          )}
        </div>
      </footer>
    </div>
  );
}

/* Every face in the frame, enlarged — the check a photographer otherwise makes
 * by zooming into each face in turn. Cropped from the picture already on
 * screen, so nothing new is fetched. The eyes are read by the engine's own
 * blink score: 0.65 and up is a closure; a lowered gaze reads 0.42–0.6 and is
 * deliberately left unlabelled. */
const EYES_SHUT = 0.65;
const EYES_OPEN = 0.25;

function FaceList({
  src, aspect, faces, onPick,
}: {
  src: string;
  aspect: number;
  faces: TriageFrame['faces'];
  onPick: (box: TriageFrame['faces'][number]['box']) => void;
}) {
  const shown = faces
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, 12);
  return (
    <div className="tz-ws-v-facelist">
      {shown.map((f) => {
        // A square window around the face, in the picture's own proportions.
        const side = Math.max(f.box.width, f.box.height / aspect) * 1.6;
        const w = Math.min(1, side);
        const h = Math.min(1, side * aspect);
        const cx = f.box.x + f.box.width / 2;
        const cy = f.box.y + f.box.height / 2;
        const x = Math.max(0, Math.min(1 - w, cx - w / 2));
        const y = Math.max(0, Math.min(1 - h, cy - h / 2));
        const shut = typeof f.blink === 'number' && f.blink >= EYES_SHUT;
        const open = typeof f.blink === 'number' && f.blink <= EYES_OPEN;
        return (
          <button
            key={f.i}
            type="button"
            className={`tz-ws-v-face${shut ? ' is-shut' : ''}`}
            onClick={() => onPick(f.box)}
            title="הגדל לפנים האלה"
          >
            <span
              style={{
                backgroundImage: `url("${src}")`,
                backgroundSize: `${100 / w}% ${100 / h}%`,
                backgroundPosition: `${w < 1 ? (x / (1 - w)) * 100 : 0}% ${h < 1 ? (y / (1 - h)) * 100 : 0}%`,
              }}
            />
            {shut && <em>עיניים עצומות</em>}
            {open && <i title="עיניים פתוחות">✓</i>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ side by side
 * Two to four frames, each as large as the window allows, in one row. The
 * one in focus is framed; the keys decide it and stay on it — comparing is
 * about choosing between these, not moving on. */
function Compare({
  names, frames, cull, active, onActive, onDecide, onClose,
}: {
  names: string[];
  frames: Map<string, Frame>;
  cull: Record<string, CullDecision>;
  active: number;
  onActive: (i: number) => void;
  onDecide: (name: string, d: CullDecision) => void;
  onClose: () => void;
}) {
  return (
    <div className="tz-ws-compare" role="dialog" aria-modal="true" aria-label="השוואה">
      <header className="tz-ws-v-top">
        <button type="button" className="tz-ws-v-icon" onClick={onClose} aria-label="סגור (Esc)" title="סגור (Esc)">✕</button>
        <div className="tz-ws-v-name"><b>השוואה</b><span>{names.length} תמונות · חצים לבחירה · K / M / X להחלטה</span></div>
        <span className="tz-ws-v-spacer" />
      </header>
      <div className="tz-ws-compare-row" style={{ gridTemplateColumns: `repeat(${names.length}, minmax(0, 1fr))` }}>
        {names.map((n, i) => {
          const f = frames.get(n);
          const d = cull[n];
          return (
            <figure key={n} className={`tz-ws-compare-cell${i === active ? ' is-active' : ''}${d ? ` is-${d}` : ''}`} onClick={() => onActive(i)}>
              <div className="tz-ws-compare-img">
                {f && <img src={thumbUrl(f.path, 1600)} alt={n} draggable={false} />}
              </div>
              <figcaption>
                <span dir="ltr">{n}</span>
                <Decide decision={d} onDecide={(dd) => { onActive(i); onDecide(n, dd); }} compact />
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

/** The shooting details on one line, in the order a photographer reads them. */
function ShotLine({ path }: { path: string }) {
  const [info, setInfo] = useState<{ path: string; data: ShotInfo | null } | null>(null);
  useEffect(() => {
    let alive = true;
    shotInfo(path)
      .then((data) => { if (alive) setInfo({ path, data }); })
      .catch(() => { if (alive) setInfo({ path, data: null }); });
    return () => { alive = false; };
  }, [path]);
  if (!info || info.path !== path) return <span className="tz-ws-shot" />;
  if (!info.data) return <span className="tz-ws-shot is-fault">לא ניתן לקרוא את פרטי הצילום</span>;
  const d = info.data;
  const parts = [d.shutter, d.aperture, d.iso ? `ISO ${d.iso}` : '', d.focal, d.bias].filter(Boolean) as string[];
  if (!parts.length && !d.camera) return <span className="tz-ws-shot">אין פרטי צילום בקובץ</span>;
  return (
    <span className="tz-ws-shot" dir="ltr" title={[d.camera, d.lens].filter(Boolean).join(' · ')}>
      {parts.map((p) => <b key={p}>{p}</b>)}
      {d.lens && <em>{d.lens}</em>}
    </span>
  );
}

/** Recipe keys for every frame that has its own edit — so a grid can ask the
 *  engine for the edited thumbnail by URL without a hook per tile. */
function useEditedKeys(projectId: string): Map<string, string> {
  const recipe = useRecipe(projectId);
  const [, bump] = useState(0);
  const wanted = useMemo(() => {
    const out: [string, string, ToolInstanceLike[]][] = [];
    for (const [name, own] of Object.entries(recipe.perFrame)) {
      if (!own?.some((t) => t.enabled)) continue;
      const steps = activeSteps(projectId, name);
      out.push([name, JSON.stringify(steps), steps]);
    }
    return out;
  }, [recipe, projectId]);
  useEffect(() => {
    let alive = true;
    const todo = wanted.filter(([, sig]) => !keyCache.has(sig));
    if (!todo.length) return undefined;
    Promise.all(todo.map(([, sig, steps]) => registerRecipe(steps as never).then((k) => { keyCache.set(sig, k); }).catch(() => undefined)))
      .then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [wanted]);
  const m = new Map<string, string>();
  for (const [name, sig] of wanted) {
    const k = keyCache.get(sig);
    if (k) m.set(frameKey(name), k);
  }
  return m;
}
type ToolInstanceLike = { toolId: string };

/** The picture to show for a frame: its own edit when it has one (rendered by
 *  the engine under the recipe's key), otherwise the file. Null while the key
 *  is being asked for, so a caller can keep what is on screen until then. */
const keyCache = new Map<string, string>();
function useEditedSrc(projectId: string, name: string, path: string, width: number): string | null {
  const recipe = useRecipe(projectId);
  const own = recipe.perFrame[frameKey(name)];
  const steps = useMemo(
    () => (own && own.some((t) => t.enabled) ? activeSteps(projectId, name) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, projectId, name],
  );
  const sig = steps ? JSON.stringify(steps) : '';
  const [key, setKey] = useState<string | null>(() => (sig ? keyCache.get(sig) ?? null : ''));
  useEffect(() => {
    if (!sig) { setKey(''); return undefined; }
    const known = keyCache.get(sig);
    if (known) { setKey(known); return undefined; }
    let alive = true;
    setKey(null);
    registerRecipe(steps!)
      .then((k) => { keyCache.set(sig, k); if (alive) setKey(k); })
      .catch(() => { if (alive) setKey(''); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  if (key === null) return null;
  return key ? previewUrl(path, width, key) : thumbUrl(path, width);
}
