/* רצפים וקבוצות עריכה — one working surface for dividing a shoot.
 *
 * Built to docs/new/mik.md. The old מקבצים screen was a pool that shrank: mark,
 * name, and the frames LEFT — which made the first pass fast and every
 * correction after it a rebuild (פרק, then mark again). Here the division is
 * live data that is always open to change:
 *
 *   strip        every group as a tile, plus כל התמונות and ללא שיוך. Always
 *                there; clicking one makes it active. No open/close.
 *   timeline     the day, with each group as a segment sized by DURATION and a
 *                notch at every real pause in shooting.
 *   sheet        the active group's photographs, dense, virtualised.
 *   selection    checkbox first; Shift/Ctrl are shortcuts, never the interface.
 *
 * Two groupings, one UI (spec §2). `kind` picks which record the same gestures
 * write to — story moments or edit groups — and the words on screen follow it.
 * The rules live in ../groups.ts and are tested there; every change goes
 * through applyGroups, so each is one undo step and one write.
 *
 * Suggestions are PROPOSALS (spec §190). The engine's contiguous runs become
 * dotted cuts between thumbnails; nothing enters project.json until the
 * photographer accepts.
 */

import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { Frame } from '../../api';
import { albumMoments, embedAlbum } from '../../api';
import * as G from '../groups';
import type { Group, GroupKind, RecipeChoice, SuggestedBoundary } from '../groups';
import {
  applyGroups, groupStateOf, newGroupId, redoGroups, retrySave, undoGroups,
  useDiskFault, useGroupHistory, useGroupState, useProjectFiles,
} from '../store';
import { useSetPreview } from '../preview';
import { IcCheck, IcUndo } from '../../design/Icons';
import './GroupWorkspace.css';

/* ------------------------------------------------------------------ words */

const WORDS = {
  story: {
    title: 'רצפים', one: 'רצף', many: 'רצפים', none: 'ללא שיוך',
    moveTo: 'העברה לרצף', remove: 'הוצא מהרצף', removed: 'הוצאו מהרצף',
    create: 'רצף חדש', createVerb: 'יצירת רצף', createCta: 'צור והעבר',
    split: 'פצל רצף', merge: 'מזג עם…', del: 'מחק רצף', unnamed: 'רצף ללא שם',
    plus: '+ רצף', empty: 'הרצף ריק', suggest: 'הצע רצפים', nameField: 'שם הרצף',
  },
  edit: {
    title: 'קבוצות עריכה', one: 'קבוצה', many: 'קבוצות', none: 'ללא קבוצה',
    moveTo: 'העברה לקבוצה', remove: 'הוצא מהקבוצה', removed: 'הוצאו מהקבוצה',
    create: 'קבוצה חדשה', createVerb: 'יצירת קבוצת עריכה', createCta: 'צור והעבר',
    split: 'פצל קבוצה', merge: 'מזג עם…', del: 'מחק קבוצה', unnamed: 'קבוצה ללא שם',
    plus: '+ קבוצה', empty: 'הקבוצה ריקה', suggest: 'הצע קבוצות', nameField: 'שם הקבוצה',
  },
} as const;

type Words = (typeof WORDS)[GroupKind];

/* ------------------------------------------------------------------ units */

type View = 'all' | 'none' | string;
type Size = 's' | 'm' | 'l';

/** Target cell width per density. At 1920 these give roughly 11 / 8 / 5 a row
 *  (spec §29), and medium never drops under 6 (§302). */
const TARGET: Record<Size, number> = { s: 128, m: 196, l: 288 };
const GAP = 6;
const SEP_H = 34;
/** A silence this long is worth a notch on the timeline (spec §84). */
const NOTCH_SECONDS = 20 * 60;
const EMBED_CHUNK = 8;

const count = (n: number) => n.toLocaleString('he-IL');

function clock(shot: number, seconds = false): string {
  if (!shot) return '';
  return new Date(shot * 1000).toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  });
}

function spanOf(list: Frame[]): string {
  const timed = list.filter((f) => f.shot);
  if (!timed.length) return '';
  const a = clock(timed[0].shot);
  const b = clock(timed[timed.length - 1].shot);
  return a === b ? a : `${a}–${b}`;
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* a per-viewer convenience only */ }
}

/* ---------------------------------------------------------------- layout */

type Row =
  | { type: 'sep'; key: string; top: number; h: number; gid: string | null }
  | { type: 'cells'; key: string; top: number; h: number; items: Frame[]; start: number };

function buildRows(
  visible: Frame[],
  cols: number,
  cell: number,
  separate: boolean,
  ownerOf: (f: Frame) => string | null,
) {
  const rows: Row[] = [];
  const where = new Map<string, number>();
  let top = 0;
  let i = 0;
  while (i < visible.length) {
    let end = visible.length;
    if (separate) {
      const owner = ownerOf(visible[i]);
      end = i + 1;
      while (end < visible.length && ownerOf(visible[end]) === owner) end += 1;
      rows.push({ type: 'sep', key: `sep-${visible[i].name}`, top, h: SEP_H, gid: owner });
      top += SEP_H;
    }
    for (let s = i; s < end; s += cols) {
      const items = visible.slice(s, Math.min(s + cols, end));
      for (const f of items) where.set(f.name, rows.length);
      rows.push({ type: 'cells', key: `r-${items[0].name}`, top, h: cell + GAP, items, start: s });
      top += cell + GAP;
    }
    i = end;
  }
  return { rows, where, total: top };
}

/** First row whose bottom is below `y`. */
function firstRowAt(rows: Row[], y: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rows[mid].h < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* ----------------------------------------------------------------- state */

type MenuState =
  | { kind: 'frame'; x: number; y: number; name: string }
  | { kind: 'group'; x: number; y: number; id: string }
  | { kind: 'header'; x: number; y: number };

type PopState =
  | { type: 'move'; x: number; y: number; above: boolean; names: string[] }
  | { type: 'new'; x: number; y: number; above: boolean; names: string[] }
  | { type: 'split'; x: number; y: number; above: boolean; groupId: string; from: string }
  | { type: 'merge'; x: number; y: number; above: boolean; source: string };

type DialogState =
  | { type: 'delete'; id: string }
  | { type: 'mergeRecipe'; source: string; target: string }
  | { type: 'help' };

type Suggest = {
  ordered: string[];
  boundaries: SuggestedBoundary[];
  shown: boolean;
  unread: number;
  visualOnly: boolean;
};

type Analysis =
  | { phase: 'embed'; done: number; total: number }
  | { phase: 'group' }
  | { phase: 'error'; text: string }
  | { phase: 'note'; text: string }
  | null;

type DragPayload = { type: 'frames'; names: string[] } | { type: 'group'; id: string };

type CellEvent = 'click' | 'check' | 'dbl' | 'menu' | 'dragstart' | 'dragend' | 'split' | 'cutAccept' | 'cutReject';

/* ============================================================ the screen */

export default function GroupWorkspace({ projectId }: { projectId: string }) {
  const { frames: rawFrames, ready } = useProjectFiles(projectId);
  const state = useGroupState(projectId);
  const history = useGroupHistory(projectId);
  const diskFault = useDiskFault(projectId);
  const preview = useSetPreview(projectId);

  const [kind, setKind] = useState<GroupKind>(() => readPref('teza.groups.kind', ['story', 'edit'] as const, 'story'));
  const [size, setSize] = useState<Size>(() => readPref('teza.groups.size', ['s', 'm', 'l'] as const, 'm'));
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pop, setPop] = useState<PopState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[] | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; undo: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hinted, setHinted] = useState(() => readPref('teza.groups.hinted', ['1', '0'] as const, '0') === '1');
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  const W: Words = WORDS[kind];

  /* ---- data ---- */

  // Capture time ascending; frames with no time at the end, by name (spec §141).
  const frames = useMemo(() => {
    const timed = rawFrames.filter((f) => f.shot > 0).sort((a, b) => a.shot - b.shot || a.name.localeCompare(b.name));
    const untimed = rawFrames.filter((f) => !f.shot).sort((a, b) => a.name.localeCompare(b.name));
    return [...timed, ...untimed];
  }, [rawFrames]);
  const byName = useMemo(() => new Map(frames.map((f) => [f.name, f])), [frames]);

  const groups = useMemo(() => G.groupsOf(state, kind), [state, kind]);
  const assign = kind === 'edit' ? state.assign : state.momentAssign!;
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const ownerOf = useCallback(
    (f: Frame): string | null => {
      const g = assign[f.name];
      return g && groupIds.has(g) ? g : null;
    },
    [assign, groupIds],
  );
  const members = useMemo(() => {
    const m = new Map<string | null, Frame[]>([[null, []]]);
    for (const g of groups) m.set(g.id, []);
    for (const f of frames) m.get(ownerOf(f))!.push(f);
    return m;
  }, [frames, groups, ownerOf]);
  const unassigned = members.get(null)!;

  const activeGroup = view !== 'all' && view !== 'none' ? groups.find((g) => g.id === view) ?? null : null;
  useEffect(() => {
    if (view !== 'all' && view !== 'none' && !groupIds.has(view)) setView('all');
  }, [view, groupIds]);

  const inView = view === 'all' ? frames : view === 'none' ? unassigned : members.get(view) ?? [];
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? inView.filter((f) => f.name.toLowerCase().includes(q)) : inView),
    [inView, q],
  );
  const indexOf = useMemo(() => new Map(visible.map((f, i) => [f.name, i])), [visible]);
  const nameOf = (id: string | null) => (id === null ? W.none : groups.find((g) => g.id === id)?.name ?? W.unnamed);
  const chrono = (names: Iterable<string>) => {
    const set = new Set(names);
    return frames.filter((f) => set.has(f.name)).map((f) => f.name);
  };

  /* ---- layout ---- */

  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragPayload | null>(null);
  const [height, setHeight] = useState(680);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  // The workspace owns the viewport below where it starts: the strip scrolls
  // sideways, the sheet scrolls down, the page does not scroll (spec §181).
  useLayoutEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      const top = Math.max(el.getBoundingClientRect().top, 0);
      setHeight(Math.max(560, Math.round(window.innerHeight - top - 20)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const hasSheet = ready && frames.length > 0;
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSheet, view === 'all' || visible.length > 0]);

  const target = TARGET[size];
  const cols = Math.max(1, Math.floor((box.w + GAP) / (target + GAP)));
  const cell = box.w ? Math.floor((box.w - GAP * (cols - 1)) / cols) : target;
  const separate = view === 'all' && groups.length > 0 && !q;
  const layout = useMemo(
    () => buildRows(visible, cols, cell, separate, ownerOf),
    [visible, cols, cell, separate, ownerOf],
  );

  // Render the viewport plus 1.5 viewports either side — the prefetch (§157).
  const over = Math.max(box.h, 400) * 1.5;
  const firstRow = firstRowAt(layout.rows, scrollTop - over);
  let lastRow = firstRow;
  while (lastRow < layout.rows.length && layout.rows[lastRow].top < scrollTop + box.h + over) lastRow += 1;
  const windowRows = layout.rows.slice(firstRow, lastRow);

  const thumbPx = cell <= 150 ? 240 : cell <= 230 ? 360 : 520;
  const warmKey = windowRows.map((r) => r.key).join('|');
  useEffect(() => {
    const paths: string[] = [];
    for (const r of windowRows) if (r.type === 'cells') for (const f of r.items) paths.push(f.path);
    if (paths.length) preview.warm(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmKey, preview.graded]);

  const scrollRaf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => setScrollTop(sheetRef.current?.scrollTop ?? 0));
  };

  /* Per-view scroll memory: back to A lands where A was left (spec §184). */
  const scrolls = useRef(new Map<string, number>());
  const switchView = useCallback((next: View) => {
    const el = sheetRef.current;
    if (el) scrolls.current.set(`${kind}:${view}`, el.scrollTop);
    // A selection made in one group must not ride along into another (§164).
    setSelected(new Set());
    setAnchor(null);
    setFocus(null);
    setView(next);
  }, [kind, view]);
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const y = scrolls.current.get(`${kind}:${view}`) ?? 0;
    el.scrollTop = y;
    setScrollTop(y);
  }, [view, kind]);

  const scrollToName = (name: string) => {
    const el = sheetRef.current;
    const r = layout.where.get(name);
    if (!el || r === undefined) return;
    const row = layout.rows[r];
    const headroom = separate ? SEP_H : 0;
    if (row.top - headroom < el.scrollTop) el.scrollTop = Math.max(0, row.top - headroom);
    else if (row.top + row.h > el.scrollTop + el.clientHeight) el.scrollTop = row.top + row.h - el.clientHeight;
  };

  useEffect(() => {
    if (!pendingJump || !layout.where.has(pendingJump)) return;
    scrollToName(pendingJump);
    setFocus(pendingJump);
    setPendingJump(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, layout]);

  /* ---- feedback ---- */

  const say = (text: string, undo = true) => setToast({ id: Date.now(), text, undo });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (selected.size && !hinted) {
      setHinted(true);
      writePref('teza.groups.hinted', '1');
    }
  }, [selected.size, hinted]);

  /* ---- operations: every one is one applyGroups ---- */

  const clearSelection = () => {
    setSelected(new Set());
    setAnchor(null);
  };
  const closeFloats = () => {
    setPop(null);
    setMenu(null);
  };
  const now = () => new Date().toISOString();

  function move(names: string[], targetId: string | null) {
    if (!names.length) return;
    const ok = applyGroups(projectId, targetId ? W.moveTo : W.remove, (s) => G.moveFrames(s, kind, names, targetId));
    clearSelection();
    closeFloats();
    if (!ok) return;
    const n = names.length === 1 ? 'תמונה אחת' : `${count(names.length)} תמונות`;
    say(targetId ? `${n} הועברו ל„${nameOf(targetId)}”` : `${n} ${W.removed}`);
  }

  function create(names: string[], name: string) {
    const id = newGroupId(kind);
    const clean = name.trim() || W.unnamed;
    const after = activeGroup?.id ?? null;
    applyGroups(projectId, W.createVerb, (s) => {
      const at = G.insertIndex(G.groupsOf(s, kind), G.assignOf(s, kind), frames, names, after);
      return G.createGroup(s, kind, { id, name: clean, createdAt: now() }, names, at);
    });
    closeFloats();
    if (!names.length) {
      switchView(id);
      say(`נוצר ${W.one} ריק „${clean}”`);
      return;
    }
    clearSelection();
    say(`נוצר ${W.one} „${clean}” · ${count(names.length)} תמונות`);
  }

  function split(groupId: string, from: string, name: string) {
    const ordered = (members.get(groupId) ?? []).map((f) => f.name);
    const id = newGroupId(kind);
    const clean = name.trim() || W.unnamed;
    const ok = applyGroups(projectId, W.split, (s) =>
      G.splitGroup(s, kind, groupId, ordered, from, { id, name: clean, createdAt: now() }));
    closeFloats();
    if (ok) say(`„${nameOf(groupId)}” פוצל · נוצר „${clean}”`);
  }

  function merge(source: string, targetId: string, recipe?: RecipeChoice) {
    if (kind === 'edit' && recipe === undefined && G.recipesDiffer(state, source, targetId)) {
      closeFloats();
      setDialog({ type: 'mergeRecipe', source, target: targetId });
      return;
    }
    const sourceName = nameOf(source);
    const ok = applyGroups(projectId, 'מיזוג', (s) =>
      G.mergeGroups(s, kind, source, targetId, { keepName: 'source', recipe: recipe ?? 'target' }));
    closeFloats();
    setDialog(null);
    if (!ok) return;
    if (view === source) switchView(targetId);
    say(`„${sourceName}” ו„${nameOf(targetId)}” מוזגו`);
  }

  function remove(id: string) {
    const name = nameOf(id);
    applyGroups(projectId, W.del, (s) => G.deleteGroup(s, kind, id));
    setDialog(null);
    if (view === id) switchView('none');
    say(`„${name}” נמחק · התמונות ${W.none}`);
  }

  function rename(id: string, name: string) {
    setRenaming(null);
    applyGroups(projectId, 'שינוי שם', (s) => G.renameGroup(s, kind, id, name, W.unnamed));
  }

  function reorder(ids: string[]) {
    if (applyGroups(projectId, 'שינוי סדר', (s) => G.reorderGroups(s, kind, ids))) say('הסדר נשמר');
  }

  function setCover(id: string, frame: string) {
    if (applyGroups(projectId, 'תמונת שער', (s) => G.setCover(s, kind, id, frame))) {
      say(`תמונת השער של „${nameOf(id)}” עודכנה`);
    }
    closeFloats();
  }

  function undo() {
    const label = undoGroups(projectId);
    if (label) say(`בוטל: ${label}`, false);
    else if (history.undo) say('אי אפשר לבטל: החלוקה השתנתה ממסך אחר בינתיים.', false);
  }

  function redo() {
    const label = redoGroups(projectId);
    if (label) say(`בוצע שוב: ${label}`, false);
  }

  function copyEditGroups() {
    const before = G.groupsOf(groupStateOf(projectId), 'story').length;
    applyGroups(projectId, 'העתקת קבוצות עריכה', (s) =>
      G.copyEditGroupsAsMoments(s, () => ({ id: newGroupId('story'), createdAt: now() })));
    const made = G.groupsOf(groupStateOf(projectId), 'story').length - before;
    closeFloats();
    say(made ? `נוצרו ${count(made)} רצפים מקבוצות העריכה` : 'כל התמונות של קבוצות העריכה כבר ברצפים', made > 0);
  }

  /* ---- suggestions ---- */

  const stopAnalysis = useRef(false);
  useEffect(() => () => { stopAnalysis.current = true; }, []);

  async function suggestNow() {
    closeFloats();
    const scope = inView;
    if (scope.length < 2) {
      setAnalysis({ phase: 'note', text: 'צריך לפחות שתי תמונות כדי להציע גבולות.' });
      return;
    }
    stopAnalysis.current = false;
    setSuggest(null);
    setAnalysis({ phase: 'embed', done: 0, total: scope.length });
    try {
      const read = new Set<string>();
      for (let start = 0; start < scope.length; start += EMBED_CHUNK) {
        if (stopAnalysis.current) { setAnalysis(null); return; }
        const chunk = scope.slice(start, start + EMBED_CHUNK);
        const r = await embedAlbum(chunk.map((f) => f.path));
        for (const x of r.results) if (x.ok) read.add(x.path);
        setAnalysis({ phase: 'embed', done: start + chunk.length, total: scope.length });
      }
      if (stopAnalysis.current) { setAnalysis(null); return; }
      const usable = scope.filter((f) => read.has(f.path));
      if (!usable.length) {
        setAnalysis({ phase: 'error', text: 'המנוע לא הצליח לקרוא אף תמונה, אז אין הצעה.' });
        return;
      }
      setAnalysis({ phase: 'group' });
      const res = await albumMoments(usable.map((f) => f.path), usable.map((f) => f.shot));
      if (stopAnalysis.current) { setAnalysis(null); return; }
      const nameByPath = new Map(usable.map((f) => [f.path, f.name]));
      const runs = res.moments.map((m) => m.map((p) => nameByPath.get(p)).filter((n): n is string => !!n));
      const boundaries = G.boundariesFromRuns(runs, frames, res.timeGap, groupStateOf(projectId).rejectedBoundaries ?? []);
      setSuggest({
        ordered: usable.map((f) => f.name),
        boundaries,
        shown: true,
        unread: scope.length - usable.length,
        visualOnly: !res.usedTime,
      });
      setAnalysis(boundaries.length ? null : { phase: 'note', text: 'לא נמצאו גבולות מוצעים בתמונות האלה.' });
    } catch (e) {
      setAnalysis({
        phase: 'error',
        text: e instanceof TypeError
          ? 'המנוע לא עונה (127.0.0.1:8756). לא נוצרה הצעה.'
          : `ההצעה נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  function makeRun(run: string[]) {
    return { id: newGroupId(kind), name: clock(byName.get(run[0])?.shot ?? 0) || W.unnamed, createdAt: now() };
  }

  function acceptAll() {
    if (!suggest) return;
    const before = G.groupsOf(groupStateOf(projectId), kind).length;
    const cuts = new Set(suggest.boundaries.map((b) => b.afterFrame));
    applyGroups(projectId, 'קבלת הצעות', (s) => G.applyCuts(s, kind, suggest.ordered, cuts, frames, makeRun));
    const made = G.groupsOf(groupStateOf(projectId), kind).length - before;
    setSuggest(null);
    say(`נוצרו ${count(made)} ${W.many} מההצעה`);
  }

  function acceptOne(b: SuggestedBoundary) {
    const after = byName.get(b.afterFrame);
    const owner = after ? ownerOf(after) : null;
    if (!owner) return;
    const ordered = (members.get(owner) ?? []).map((f) => f.name);
    applyGroups(projectId, W.split, (s) => G.applyCuts(s, kind, ordered, new Set([b.afterFrame]), frames, makeRun));
    setSuggest((cur) => (cur ? { ...cur, boundaries: cur.boundaries.filter((x) => x !== b) } : cur));
    say(`„${nameOf(owner)}” פוצל לפי ההצעה`);
  }

  function rejectOne(b: SuggestedBoundary) {
    applyGroups(projectId, 'דחיית הצעה', (s) => G.rejectBoundary(s, b.afterFrame));
    setSuggest((cur) => (cur ? { ...cur, boundaries: cur.boundaries.filter((x) => x !== b) } : cur));
  }

  const cutBefore = useMemo(
    () => (suggest?.shown ? new Map(suggest.boundaries.map((b) => [b.beforeFrame, b])) : null),
    [suggest],
  );

  /* ---- floating UI anchors ---- */

  const anchorOf = (el: Element, above = false) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: above ? r.top - 6 : r.bottom + 6, above };
  };
  const centre = () => ({ x: window.innerWidth / 2 - 150, y: window.innerHeight - 90, above: true });

  const selectionNames = () => chrono(selected);

  const openMove = (names: string[], at = centre()) => { setMenu(null); setPop({ type: 'move', ...at, names }); };
  const openNew = (names: string[], at = centre()) => { setMenu(null); setPop({ type: 'new', ...at, names }); };

  /* ---- selection ---- */

  const toggle = (name: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  const range = (from: string, to: string, base: Set<string>) => {
    const a = indexOf.get(from);
    const b = indexOf.get(to);
    if (a === undefined || b === undefined) return base;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next = new Set(base);
    for (let k = lo; k <= hi; k += 1) next.add(visible[k].name);
    return next;
  };

  /* ---- live handlers: stable callbacks for memoised cells ---- */

  const live = useRef({
    cell: (_t: CellEvent, _n: string, _e: React.SyntheticEvent) => {},
    key: (_e: KeyboardEvent) => {},
  });

  live.current.cell = (type, name, e) => {
    const me = e as React.MouseEvent;
    switch (type) {
      case 'click':
        setMenu(null);
        if (me.shiftKey && anchor) {
          setSelected((prev) => range(anchor, name, me.ctrlKey || me.metaKey ? prev : new Set()));
        } else if (me.ctrlKey || me.metaKey || selected.size) {
          toggle(name);
          setAnchor(name);
        } else {
          setAnchor(name);
        }
        setFocus(name);
        return;
      case 'check':
        toggle(name);
        setAnchor(name);
        setFocus(name);
        return;
      case 'dbl':
        setPreviewName(name);
        return;
      case 'menu':
        me.preventDefault();
        setPop(null);
        setMenu({ kind: 'frame', x: me.clientX, y: me.clientY, name });
        return;
      case 'dragstart': {
        const de = e as React.DragEvent;
        let names: string[];
        if (selected.has(name)) {
          names = selectionNames();
        } else {
          // Dragging an unselected frame drags only it, and it becomes the
          // selection — no guessing what a mixed drag meant (spec §61).
          names = [name];
          setSelected(new Set([name]));
          setAnchor(name);
        }
        dragRef.current = { type: 'frames', names };
        de.dataTransfer.effectAllowed = 'move';
        de.dataTransfer.setData('text/plain', names.join('\n'));
        if (ghostRef.current) {
          ghostRef.current.textContent = names.length === 1 ? 'תמונה אחת' : `${count(names.length)} תמונות`;
          de.dataTransfer.setDragImage(ghostRef.current, 14, 14);
        }
        return;
      }
      case 'dragend':
        dragRef.current = null;
        setDropTarget(null);
        setDropBefore(null);
        return;
      case 'split': {
        const f = byName.get(name);
        const owner = f ? ownerOf(f) : null;
        if (!owner) return;
        setMenu(null);
        setPop({ type: 'split', ...anchorOf(e.currentTarget as Element), groupId: owner, from: name });
        return;
      }
      case 'cutAccept':
      case 'cutReject': {
        const b = cutBefore?.get(name);
        if (!b) return;
        if (type === 'cutAccept') acceptOne(b);
        else rejectOne(b);
      }
    }
  };

  const onCell = useCallback((t: CellEvent, n: string, e: React.SyntheticEvent) => live.current.cell(t, n, e), []);

  live.current.key = (e) => {
    const t = e.target as HTMLElement | null;
    if (e.key === 'Escape') {
      // Escape closes the innermost thing first (spec §124).
      if (menu) setMenu(null);
      else if (renaming) setRenaming(null);
      else if (pop) setPop(null);
      else if (dialog) setDialog(null);
      else if (previewName) setPreviewName(null);
      else if (compare) setCompare(null);
      else if (selected.size) clearSelection();
      else return;
      e.preventDefault();
      return;
    }
    if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const root = rootRef.current;
    const active = document.activeElement;
    if (!root || !(root.contains(active) || active === document.body)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (dialog || pop || menu) return;

    if (previewName) {
      const i = indexOf.get(previewName);
      if (i === undefined) return;
      if (e.key === 'ArrowLeft' && i < visible.length - 1) { e.preventDefault(); setPreviewName(visible[i + 1].name); }
      if (e.key === 'ArrowRight' && i > 0) { e.preventDefault(); setPreviewName(visible[i - 1].name); }
      if (e.code === 'Space') { e.preventDefault(); toggle(previewName); }
      return;
    }
    if (compare) return;

    if (mod && e.code === 'KeyA') {
      if (sheetRef.current?.contains(active) || active === sheetRef.current) {
        e.preventDefault();
        setSelected(new Set(visible.map((f) => f.name)));
      }
      return;
    }
    if (e.key === '?') { setDialog({ type: 'help' }); return; }
    if (e.key === 'F2' && activeGroup) { e.preventDefault(); setRenaming(activeGroup.id); return; }
    if (mod || e.altKey) return;

    // In RTL the next frame is to the LEFT; the timeline's order is untouched.
    const steps: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: cols, ArrowUp: -cols };
    const step = steps[e.key];
    if (step !== undefined) {
      if (!visible.length) return;
      e.preventDefault();
      const cur = focus ? indexOf.get(focus) ?? -1 : -1;
      const nextName = visible[Math.max(0, Math.min(visible.length - 1, cur === -1 ? 0 : cur + step))].name;
      if (e.shiftKey) {
        const from = anchor ?? focus ?? nextName;
        setSelected((prev) => range(from, nextName, new Set(prev)));
        if (!anchor) setAnchor(from);
      } else if (!selected.size) {
        setAnchor(nextName);
      }
      setFocus(nextName);
      scrollToName(nextName);
      return;
    }
    if (e.code === 'Space' && focus) { e.preventDefault(); toggle(focus); setAnchor(focus); return; }
    if (e.key === 'Enter' && focus) { e.preventDefault(); setPreviewName(focus); return; }
    if (e.code === 'KeyM' && selected.size) { e.preventDefault(); openMove(selectionNames()); return; }
    if (e.code === 'KeyN' && selected.size) { e.preventDefault(); openNew(selectionNames()); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => live.current.key(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- rectangle selection on empty sheet space (spec §41–42) ---- */

  const rubber = useRef<{
    x0: number; y0: number; cx: number; cy: number; base: Set<string>; moved: boolean; raf: number;
  } | null>(null);

  const hitTest = (x0: number, x1: number, y0: number, y1: number) => {
    const [xa, xb] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [ya, yb] = y0 < y1 ? [y0, y1] : [y1, y0];
    const hits: string[] = [];
    for (const row of layout.rows) {
      if (row.type !== 'cells' || row.top > yb || row.top + cell < ya) continue;
      row.items.forEach((f, c) => {
        const from = c * (cell + GAP);
        if (from < xb && from + cell > xa) hits.push(f.name);
      });
    }
    return hits;
  };
  const liveHit = useRef(hitTest);
  liveHit.current = hitTest;

  function onSheetPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    sheetRef.current?.focus({ preventScroll: true });
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.gw-cell, .gw-sep, button')) return;
    const sheet = sheetRef.current!;
    const r = sheet.getBoundingClientRect();
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    rubber.current = {
      x0: r.right - e.clientX,
      y0: e.clientY - r.top + sheet.scrollTop,
      cx: e.clientX,
      cy: e.clientY,
      base: additive ? new Set(selected) : new Set(),
      moved: false,
      raf: 0,
    };
    if (!additive) clearSelection();
    setMenu(null);

    const update = () => {
      const st = rubber.current;
      const el = sheetRef.current;
      if (!st || !el) return;
      const box2 = el.getBoundingClientRect();
      if (st.cy < box2.top + 36) el.scrollTop -= 16;
      else if (st.cy > box2.bottom - 36) el.scrollTop += 16;
      const x1 = box2.right - st.cx;
      const y1 = st.cy - box2.top + el.scrollTop;
      if (st.moved) {
        setRect({ x0: st.x0, y0: st.y0, x1, y1 });
        const hits = liveHit.current(st.x0, x1, st.y0, y1);
        const next = new Set(st.base);
        for (const h of hits) next.add(h);
        setSelected(next);
      }
      st.raf = requestAnimationFrame(update);
    };
    const onMove = (ev: PointerEvent) => {
      const st = rubber.current;
      if (!st) return;
      st.cx = ev.clientX;
      st.cy = ev.clientY;
      if (!st.moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 4) st.moved = true;
    };
    const onUp = () => {
      if (rubber.current) cancelAnimationFrame(rubber.current.raf);
      rubber.current = null;
      setRect(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    rubber.current.raf = requestAnimationFrame(update);
  }

  /* ---- strip drag & drop ---- */

  function onStripDragOver(e: React.DragEvent) {
    const d = dragRef.current;
    const strip = stripRef.current;
    if (!d || !strip) return;
    const r = strip.getBoundingClientRect();
    if (e.clientX < r.left + 56) strip.scrollLeft -= 18;
    else if (e.clientX > r.right - 56) strip.scrollLeft += 18;
    if (d.type !== 'group') return;
    e.preventDefault();
    const tiles = [...strip.querySelectorAll<HTMLElement>('[data-group-tile]')];
    let idx = tiles.length;
    for (let i = 0; i < tiles.length; i += 1) {
      const tr = tiles[i].getBoundingClientRect();
      // RTL: earlier tiles sit to the right; right of a tile's middle = before it.
      if (e.clientX > tr.left + tr.width / 2) { idx = i; break; }
    }
    setDropBefore(idx);
  }

  function onStripDrop(e: React.DragEvent) {
    const d = dragRef.current;
    if (!d || d.type !== 'group' || dropBefore === null) return;
    e.preventDefault();
    const ids = groups.map((g) => g.id);
    const from = ids.indexOf(d.id);
    let to = dropBefore;
    ids.splice(from, 1);
    if (from < to) to -= 1;
    ids.splice(to, 0, d.id);
    dragRef.current = null;
    setDropBefore(null);
    reorder(ids);
  }

  const frameDropProps = (key: string, onDrop: (names: string[]) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragRef.current?.type !== 'frames') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: () => { if (dropTarget === key) setDropTarget(null); },
    onDrop: (e: React.DragEvent) => {
      const d = dragRef.current;
      if (d?.type !== 'frames') return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = null;
      setDropTarget(null);
      onDrop(d.names);
    },
  });

  /* ------------------------------------------------------------ render */

  if (!ready) {
    return (
      <div className="gw gw-loading" dir="rtl" aria-busy="true">
        <div className="gw-skel-strip">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</div>
        <div className="gw-skel-grid">{Array.from({ length: 18 }, (_, i) => <i key={i} />)}</div>
      </div>
    );
  }

  if (!frames.length) {
    return (
      <p className="gw-empty-project" dir="rtl">
        אין עדיין תמונות בפרויקט. אחרי הייבוא אפשר לחלק אותן ל{W.many}.
      </p>
    );
  }

  const hidden = selected.size - visible.filter((f) => selected.has(f.name)).length;
  const selNames = selected.size ? selectionNames() : [];
  const selOwners = new Set(selNames.map((n) => {
    const f = byName.get(n);
    return f ? ownerOf(f) : null;
  }));
  const selCommon = selOwners.size === 1 ? [...selOwners][0] : undefined;
  const selAnyAssigned = [...selOwners].some((o) => o !== null);
  const single = selNames.length === 1 ? byName.get(selNames[0]) : undefined;
  const singleOwner = single ? ownerOf(single) : null;
  const busy = analysis?.phase === 'embed' || analysis?.phase === 'group';
  const firstRun = groups.length === 0 && !suggest && !busy;
  const viewTitle = view === 'all' ? 'כל התמונות' : view === 'none' ? W.none : activeGroup?.name ?? '';
  const menuFrameNames = menu?.kind === 'frame'
    ? (selected.has(menu.name) ? selNames : [menu.name])
    : [];

  return (
    <div
      className={`gw ${selected.size ? 'gw-selecting' : ''}`}
      dir="rtl"
      ref={rootRef}
      style={{ height }}
    >
      {/* ---- header ---- */}
      <header className="gw-head">
        <div className="gw-modes" role="radiogroup" aria-label="סוג החלוקה">
          {(['story', 'edit'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => {
                if (k === kind) return;
                stopAnalysis.current = true;
                setKind(k);
                writePref('teza.groups.kind', k);
                setSuggest(null);
                setAnalysis(null);
                setView('all');
                clearSelection();
                setFocus(null);
              }}
            >
              {WORDS[k].title}
            </button>
          ))}
        </div>
        <p className="gw-stats">
          <span className="mono">{count(frames.length)}</span> תמונות
          <i aria-hidden>·</i>
          <span className="mono">{count(groups.length)}</span> {W.many}
          <i aria-hidden>·</i>
          <span className="mono">{count(unassigned.length)}</span> {W.none}
        </p>
        <div className="gw-head-actions">
          <input
            type="search"
            className="gw-search"
            placeholder="חיפוש שם קובץ"
            aria-label="חיפוש לפי שם קובץ"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="gw-icon"
            onClick={undo}
            disabled={!history.undo}
            title={history.undo ? `בטל: ${history.undo} (Ctrl+Z)` : 'אין מה לבטל'}
            aria-label={history.undo ? `בטל: ${history.undo}` : 'בטל'}
          >
            <IcUndo size={16} />
          </button>
          <button
            type="button"
            className="gw-icon gw-redo"
            onClick={redo}
            disabled={!history.redo}
            title={history.redo ? `בצע שוב: ${history.redo} (Ctrl+Shift+Z)` : 'אין מה לבצע שוב'}
            aria-label={history.redo ? `בצע שוב: ${history.redo}` : 'בצע שוב'}
          >
            <IcUndo size={16} />
          </button>
          <button
            type="button"
            className="gw-icon gw-more"
            aria-label="פעולות נוספות"
            onClick={(e) => { setPop(null); setMenu({ kind: 'header', ...anchorOf(e.currentTarget) }); }}
          >
            ⋯
          </button>
        </div>
      </header>

      {diskFault && (
        <div className="gw-fault" role="alert">
          <span>השינויים מוצגים במסך אך לא נשמרו לדיסק. <bdi>{diskFault}</bdi></span>
          <button type="button" className="btn" onClick={() => retrySave(projectId)}>נסה שוב</button>
        </div>
      )}

      {/* ---- the strip ---- */}
      <nav
        className="gw-strip"
        ref={stripRef}
        aria-label={W.many}
        onDragOver={onStripDragOver}
        onDrop={onStripDrop}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropBefore(null); }}
      >
        <button
          type="button"
          className={`gw-tile gw-tile-view ${view === 'all' ? 'on' : ''}`}
          onClick={() => switchView('all')}
          aria-pressed={view === 'all'}
        >
          <span className="gw-tile-mosaic gw-tile-all" aria-hidden>
            {frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 4)) === 0).slice(0, 4).map((f) => (
              <img key={f.name} src={preview.url(f.path, 160)} alt="" loading="lazy" draggable={false} />
            ))}
          </span>
          <span className="gw-tile-foot">
            <span className="gw-tile-name">כל התמונות</span>
            <span className="gw-tile-count mono">{count(frames.length)}</span>
            <bdi dir="ltr" className="gw-tile-span mono">{spanOf(frames)}</bdi>
          </span>
        </button>

        <button
          type="button"
          className={`gw-tile gw-tile-view ${view === 'none' ? 'on' : ''} ${unassigned.length ? '' : 'dim'} ${dropTarget === 'none' ? 'drop' : ''}`}
          onClick={() => switchView('none')}
          aria-pressed={view === 'none'}
          {...frameDropProps('none', (names) => move(names, null))}
        >
          <span className="gw-tile-mosaic" aria-hidden>
            {unassigned.slice(0, 4).map((f) => (
              <img key={f.name} src={preview.url(f.path, 160)} alt="" loading="lazy" draggable={false} />
            ))}
          </span>
          <span className="gw-tile-foot">
            <span className="gw-tile-name">{W.none}</span>
            <span className="gw-tile-count mono">{count(unassigned.length)}</span>
          </span>
        </button>

        {groups.map((g, i) => (
          <GroupTile
            key={g.id}
            group={g}
            members={members.get(g.id) ?? []}
            active={view === g.id}
            dropping={dropTarget === g.id}
            dropBefore={dropBefore === i}
            dropAfter={dropBefore === groups.length && i === groups.length - 1}
            renaming={renaming === g.id}
            graded={kind === 'edit' && (state.recipe.perBatch[g.id] ?? []).some((t) => t.enabled)}
            words={W}
            coverUrl={(p) => preview.url(p, 360)}
            onSelect={() => { if (view !== g.id) switchView(g.id); }}
            onMenu={(el) => { setPop(null); setMenu({ kind: 'group', id: g.id, ...anchorOf(el) }); }}
            onContext={(x, y) => { setPop(null); setMenu({ kind: 'group', id: g.id, x, y }); }}
            onRenameStart={() => setRenaming(g.id)}
            onRename={(name) => rename(g.id, name)}
            onRenameCancel={() => setRenaming(null)}
            onDragStart={(e) => {
              dragRef.current = { type: 'group', id: g.id };
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', g.name);
            }}
            onDragEnd={() => { dragRef.current = null; setDropBefore(null); setDropTarget(null); }}
            dropProps={frameDropProps(g.id, (names) => move(names, g.id))}
          />
        ))}

        <button
          type="button"
          className={`gw-tile-plus ${dropTarget === 'plus' ? 'drop' : ''}`}
          onClick={(e) => openNew([], anchorOf(e.currentTarget))}
          {...frameDropProps('plus', (names) => {
            const el = stripRef.current?.querySelector('.gw-tile-plus');
            openNew(names, el ? anchorOf(el) : centre());
          })}
        >
          {W.plus}
        </button>
      </nav>

      <Timeline
        frames={frames}
        ownerOf={ownerOf}
        groups={groups}
        active={view}
        onJump={(name) => {
          const f = byName.get(name);
          if (!f) return;
          if (!indexOf.has(name)) {
            setQuery('');
            switchView(view === 'none' || view === 'all' ? 'all' : ownerOf(f) ?? 'none');
          }
          setPendingJump(name);
        }}
        nameOf={nameOf}
      />

      {/* ---- toolbar ---- */}
      <div className="gw-toolbar">
        <div className="gw-view-title">
          <strong>{viewTitle}</strong>
          <span className="mono">{count(inView.length)}</span>
          {activeGroup && <bdi dir="ltr" className="mono gw-span">{spanOf(inView)}</bdi>}
          {q && <span className="gw-filtered">· מוצגות <span className="mono">{count(visible.length)}</span></span>}
        </div>

        <div className="gw-suggest" aria-live="polite">
          {analysis?.phase === 'embed' && (
            <>
              <span className="mono">
                {analysis.done === 0 ? 'טוען את מודל הזיהוי…' : `קורא ${count(analysis.done)} / ${count(analysis.total)}`}
              </span>
              <button type="button" className="btn" onClick={() => { stopAnalysis.current = true; }}>עצור</button>
            </>
          )}
          {analysis?.phase === 'group' && <span>מחפש גבולות…</span>}
          {analysis?.phase === 'error' && <span className="gw-error">{analysis.text}</span>}
          {analysis?.phase === 'note' && <span>{analysis.text}</span>}
          {suggest && suggest.boundaries.length > 0 && (
            <>
              <span>
                <span className="mono">{count(suggest.boundaries.length)}</span> גבולות מוצעים
                {suggest.unread > 0 && <> · <span className="mono">{count(suggest.unread)}</span> לא נקראו</>}
                {suggest.visualOnly && <> · לפי מראה בלבד</>}
              </span>
              <button type="button" className="btn" onClick={() => setSuggest({ ...suggest, shown: !suggest.shown })}>
                {suggest.shown ? 'הסתר' : 'הצג'}
              </button>
              <button type="button" className="btn btn-primary" onClick={acceptAll}>קבל הכל</button>
              <button type="button" className="gw-link" onClick={() => setSuggest(null)}>נקה</button>
            </>
          )}
          {!busy && !firstRun && !(suggest && suggest.boundaries.length) && (
            <button type="button" className="btn" onClick={suggestNow} title="המערכת מציעה גבולות בין התמונות המוצגות. שום דבר לא נשמר עד שתאשר.">
              {W.suggest}
            </button>
          )}
        </div>

        <div className="gw-sizes" role="radiogroup" aria-label="גודל תמונות">
          {(['s', 'm', 'l'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={size === s}
              className={size === s ? 'on' : ''}
              onClick={() => { setSize(s); writePref('teza.groups.size', s); }}
            >
              {s === 's' ? 'קטן' : s === 'm' ? 'בינוני' : 'גדול'}
            </button>
          ))}
        </div>
      </div>

      {firstRun && (
        <section className="gw-first">
          <div>
            <h3>{kind === 'story' ? 'התחל לחלק את יום הצילום' : 'חלק את הצילום לפי אור'}</h3>
            <p>
              {kind === 'story'
                ? 'בחר תמונות וצור מהן רצף, או בקש הצעה אוטומטית.'
                : 'בחר תמונות שצולמו באותו אור וצור מהן קבוצת עריכה, או בקש הצעה.'}
            </p>
          </div>
          <div className="gw-first-actions">
            <button type="button" className="btn btn-primary" onClick={suggestNow}>{W.suggest}</button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                sheetRef.current?.focus();
                const first = visible[0];
                if (first) { setFocus(first.name); setAnchor(first.name); setSelected(new Set([first.name])); }
              }}
            >
              בחר ידנית
            </button>
          </div>
        </section>
      )}

      {!hinted && !firstRun && (
        <p className="gw-hint">בחר תמונה. Shift בוחר טווח.</p>
      )}

      {/* ---- the contact sheet ---- */}
      <div
        className="gw-sheet"
        ref={sheetRef}
        tabIndex={0}
        role="grid"
        aria-label={`${viewTitle} · ${count(visible.length)} תמונות`}
        aria-multiselectable="true"
        onScroll={onScroll}
        onPointerDown={onSheetPointerDown}
      >
        {visible.length === 0 ? (
          <div className="gw-sheet-empty">
            {q ? (
              <p>אין תמונות שהשם שלהן מכיל „{query}”.</p>
            ) : activeGroup ? (
              <>
                <strong>{W.empty}</strong>
                <p>גרור לכאן תמונות או בחר תמונות מ{W.one} אחר.</p>
              </>
            ) : (
              <p>אין תמונות {W.none}.</p>
            )}
          </div>
        ) : (
          <div className="gw-sheet-inner" style={{ height: layout.total }}>
            {windowRows.map((row) => {
              if (row.type === 'sep') {
                const list = members.get(row.gid) ?? [];
                return (
                  <div key={row.key} className="gw-sep" style={{ top: row.top, height: row.h }}>
                    <button
                      type="button"
                      className="gw-sep-name"
                      onClick={() => switchView(row.gid ?? 'none')}
                    >
                      {nameOf(row.gid)}
                    </button>
                    <span className="mono">{count(list.length)}</span>
                  </div>
                );
              }
              return (
                <div key={row.key} className="gw-row" style={{ top: row.top, height: row.h, gap: GAP }}>
                  {row.items.map((f, c) => {
                    const i = row.start + c;
                    const prev = i > 0 ? visible[i - 1] : undefined;
                    const owner = ownerOf(f);
                    const sameAsPrev = !!prev && ownerOf(prev) === owner;
                    const b = cutBefore?.get(f.name);
                    const cut = b && prev && prev.name === b.afterFrame ? b : undefined;
                    const group = owner ? groups.find((g) => g.id === owner) : undefined;
                    return (
                      <Cell
                        key={f.name}
                        f={f}
                        size={cell}
                        url={preview.url(f.path, thumbPx)}
                        pending={preview.pending(f.path)}
                        selected={selected.has(f.name)}
                        focused={focus === f.name}
                        cover={!!group && view === owner && group.cover === f.name}
                        splittable={!q && sameAsPrev && owner !== null && !cut}
                        cutStrength={cut?.strength}
                        cutTitle={cut ? (cut.gapMinutes
                          ? `הצעה: פער של ${cut.gapMinutes} דקות ושינוי בסצנה`
                          : 'הצעה: שינוי משמעותי בסצנה') : undefined}
                        cutActionable={!!cut && sameAsPrev && owner !== null}
                        onEvent={onCell}
                      />
                    );
                  })}
                </div>
              );
            })}
            {rect && (
              <div
                className="gw-rect"
                style={{
                  right: Math.min(rect.x0, rect.x1),
                  top: Math.min(rect.y0, rect.y1),
                  width: Math.abs(rect.x1 - rect.x0),
                  height: Math.abs(rect.y1 - rect.y0),
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* ---- selection toolbar ---- */}
      {selected.size > 0 && (
        <div className="gw-selbar" role="toolbar" aria-label="פעולות על הבחירה">
          <span className="gw-selcount">
            <b className="mono">{count(selected.size)}</b> נבחרו
            {hidden > 0 && <> · <span className="mono">{count(hidden)}</span> מוסתרות</>}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(e) => openMove(selNames, anchorOf(e.currentTarget, true))}
            aria-label={`העבר ${count(selNames.length)} תמונות`}
          >
            העבר אל ▾
          </button>
          <button type="button" className="btn" onClick={(e) => openNew(selNames, anchorOf(e.currentTarget, true))}>
            {W.create}
          </button>
          {selAnyAssigned && (
            <button type="button" className="btn" onClick={() => move(selNames, null)}>{W.remove}</button>
          )}
          {single && singleOwner && (
            <button type="button" className="btn" onClick={() => setCover(singleOwner, single.name)}>קבע כתמונת שער</button>
          )}
          {selNames.length >= 2 && selNames.length <= 4 && (
            <button type="button" className="btn" onClick={() => setCompare(selNames)}>השווה</button>
          )}
          {visible.some((f) => !selected.has(f.name)) && (
            <button type="button" className="gw-link" onClick={() => setSelected(new Set(visible.map((f) => f.name)))}>
              בחר את כל {count(visible.length)} המוצגות
            </button>
          )}
          <button type="button" className="gw-icon gw-selclose" onClick={clearSelection} aria-label="נקה בחירה">×</button>
        </div>
      )}

      {toast && (
        <div className="gw-toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo && history.undo && (
            <button type="button" className="gw-link" onClick={() => { setToast(null); undo(); }}>בטל</button>
          )}
        </div>
      )}

      <div className="gw-ghost" ref={ghostRef} aria-hidden />

      {/* ---- menus ---- */}
      {menu?.kind === 'header' && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="פעולות נוספות" items={[
          { label: W.suggest, onSelect: () => { setMenu(null); void suggestNow(); }, disabled: busy },
          ...(kind === 'story' && state.batches.length
            ? [{ label: 'העתק קבוצות עריכה כרצפים', onSelect: copyEditGroups }]
            : []),
          { label: 'קיצורי מקלדת', hint: '?', onSelect: () => { setMenu(null); setDialog({ type: 'help' }); } },
        ]} />
      )}

      {menu?.kind === 'frame' && (() => {
        const f = byName.get(menu.name);
        const owner = f ? ownerOf(f) : null;
        const names = menuFrameNames;
        const plural = names.length > 1;
        return (
          <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="פעולות על תמונה" items={[
            { label: 'פתח', hint: 'Enter', onSelect: () => { setMenu(null); setPreviewName(menu.name); } },
            { label: plural ? `העבר ${count(names.length)} תמונות אל…` : 'העבר אל…', hint: 'M', onSelect: () => openMove(names, { x: menu.x, y: menu.y, above: false }) },
            { label: plural ? `${W.create} מהבחירה` : `${W.create} מהתמונה`, hint: 'N', onSelect: () => openNew(names, { x: menu.x, y: menu.y, above: false }) },
            ...(names.some((n) => { const x = byName.get(n); return x ? ownerOf(x) !== null : false; })
              ? [{ label: W.remove, onSelect: () => move(names, null) }] : []),
            ...(!plural && owner ? [{ label: 'קבע כתמונת שער', onSelect: () => setCover(owner, menu.name) }] : []),
            ...(anchor && anchor !== menu.name && indexOf.has(anchor)
              ? [{ label: 'בחר עד כאן', onSelect: () => { setSelected((prev) => range(anchor, menu.name, new Set(prev))); setMenu(null); } }]
              : []),
            ...(selNames.length >= 2 && selNames.length <= 4 && selected.has(menu.name)
              ? [{ label: 'השווה', onSelect: () => { setMenu(null); setCompare(selNames); } }] : []),
            { label: 'מידע', onSelect: () => { setMenu(null); setPreviewName(menu.name); } },
          ]} />
        );
      })()}

      {menu?.kind === 'group' && (() => {
        const g = groups.find((x) => x.id === menu.id);
        if (!g) return null;
        const list = members.get(g.id) ?? [];
        const focusFrame = focus ? byName.get(focus) : undefined;
        const focusIn = !!focusFrame && ownerOf(focusFrame) === g.id;
        const canSplit = focusIn && list[0]?.name !== focus;
        return (
          <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={`פעולות על ${g.name}`} items={[
            { label: 'שינוי שם', hint: 'F2', onSelect: () => { setMenu(null); setRenaming(g.id); } },
            { label: 'קבע תמונת שער', disabled: !focusIn, hint: focusIn ? undefined : 'סמן תמונה בקבוצה', onSelect: () => setCover(g.id, focus!) },
            { label: W.split, disabled: !canSplit, hint: canSplit ? undefined : 'סמן את התמונה שממנה לפצל', onSelect: () => setPop({ type: 'split', x: menu.x, y: menu.y, above: false, groupId: g.id, from: focus! }) },
            { label: W.merge, disabled: groups.length < 2, onSelect: () => { setMenu(null); setPop({ type: 'merge', x: menu.x, y: menu.y, above: false, source: g.id }); } },
            { label: 'בחר את כל התמונות', disabled: !list.length, onSelect: () => {
              setMenu(null);
              if (view !== g.id) switchView(g.id);
              setTimeout(() => setSelected(new Set(list.map((f) => f.name))), 0);
            } },
            { label: W.del, danger: true, onSelect: () => { setMenu(null); setDialog({ type: 'delete', id: g.id }); } },
          ]} />
        );
      })()}

      {/* ---- popovers ---- */}
      {pop?.type === 'move' && (
        <MovePopover
          x={pop.x} y={pop.y} above={pop.above}
          names={pop.names}
          groups={groups}
          current={pop.names === selNames ? selCommon : (() => {
            const owners = new Set(pop.names.map((n) => { const x = byName.get(n); return x ? ownerOf(x) : null; }));
            return owners.size === 1 ? [...owners][0] : undefined;
          })()}
          words={W}
          countOf={(id) => members.get(id)?.length ?? 0}
          onPick={(id) => move(pop.names, id)}
          onClose={() => setPop(null)}
        />
      )}

      {pop?.type === 'new' && (
        <NamePopover
          x={pop.x} y={pop.y} above={pop.above}
          title={pop.names.length ? `${W.create} · ${count(pop.names.length)} תמונות` : `${W.create} ריק`}
          field={W.nameField}
          initial={pop.names.length ? clock(byName.get(chrono(pop.names)[0])?.shot ?? 0) : ''}
          cta={pop.names.length ? W.createCta : 'צור'}
          onSubmit={(name) => create(chrono(pop.names), name)}
          onClose={() => setPop(null)}
        />
      )}

      {pop?.type === 'split' && (
        <NamePopover
          x={pop.x} y={pop.y} above={pop.above}
          title={`${W.split} · מכאן והלאה`}
          field={`שם ה${W.one} החדש`}
          initial={clock(byName.get(pop.from)?.shot ?? 0)}
          cta="פצל כאן"
          onSubmit={(name) => split(pop.groupId, pop.from, name)}
          onClose={() => setPop(null)}
        />
      )}

      {pop?.type === 'merge' && (
        <MergePopover
          x={pop.x} y={pop.y} above={pop.above}
          source={pop.source}
          groups={groups}
          countOf={(id) => members.get(id)?.length ?? 0}
          onPick={(targetId) => merge(pop.source, targetId)}
          onClose={() => setPop(null)}
        />
      )}

      {/* ---- dialogs ---- */}
      {dialog?.type === 'delete' && (() => {
        const g = groups.find((x) => x.id === dialog.id);
        if (!g) return null;
        const n = members.get(g.id)?.length ?? 0;
        const hasLook = kind === 'edit' && (state.recipe.perBatch[g.id] ?? []).length > 0;
        return (
          <Dialog
            title={kind === 'edit' ? 'למחוק את קבוצת העריכה?' : 'למחוק את הרצף?'}
            onClose={() => setDialog(null)}
            actions={[
              { label: W.del, danger: true, onSelect: () => remove(g.id) },
              { label: 'ביטול', onSelect: () => setDialog(null) },
            ]}
          >
            <p>
              {n === 1 ? 'התמונה תחזור' : `${count(n)} התמונות יחזרו`} ל{W.none}.
              {hasLook && ' עריכת הצבע הייחודית לקבוצה הזו תימחק.'}
            </p>
          </Dialog>
        );
      })()}

      {dialog?.type === 'mergeRecipe' && (
        <Dialog
          title="לשתי הקבוצות יש עריכות שונות. איזו עריכה לשמור?"
          onClose={() => setDialog(null)}
          actions={[
            { label: `עריכת „${nameOf(dialog.source)}”`, onSelect: () => merge(dialog.source, dialog.target, 'source') },
            { label: `עריכת „${nameOf(dialog.target)}”`, onSelect: () => merge(dialog.source, dialog.target, 'target') },
            { label: 'בלי עריכה ייחודית', onSelect: () => merge(dialog.source, dialog.target, 'none') },
            { label: 'ביטול', onSelect: () => setDialog(null) },
          ]}
        >
          <p>התמונות של שתי הקבוצות יאוחדו לקבוצה אחת עם עריכה אחת.</p>
        </Dialog>
      )}

      {dialog?.type === 'help' && (
        <Dialog title="קיצורי מקלדת" onClose={() => setDialog(null)} actions={[{ label: 'סגור', onSelect: () => setDialog(null) }]}>
          <dl className="gw-keys">
            {[
              ['← →', 'תמונה הבאה / הקודמת'],
              ['↑ ↓', 'שורה למעלה / למטה'],
              ['Space', 'בחר או בטל את התמונה המסומנת'],
              ['Shift + חצים', 'הרחב בחירה'],
              ['Shift + לחיצה', 'בחר טווח'],
              ['Ctrl + לחיצה', 'הוסף או הוצא תמונה אחת'],
              ['Ctrl + A', 'בחר את כל התמונות המוצגות'],
              ['M', 'העבר אל…'],
              ['N', `${W.create} מהבחירה`],
              ['Enter', 'תצוגה גדולה'],
              ['F2', 'שינוי שם'],
              ['Ctrl + Z', 'בטל'],
              ['Ctrl + Shift + Z', 'בצע שוב'],
              ['Esc', 'סגור / נקה בחירה'],
            ].map(([k, v]) => (
              <div key={k}><dt><kbd dir="ltr">{k}</kbd></dt><dd>{v}</dd></div>
            ))}
          </dl>
        </Dialog>
      )}

      {previewName && (() => {
        const f = byName.get(previewName);
        const i = indexOf.get(previewName);
        if (!f || i === undefined) return null;
        const owner = ownerOf(f);
        return (
          <div className="gw-overlay" role="dialog" aria-label={f.name} onClick={() => setPreviewName(null)}>
            <figure className="gw-preview" onClick={(e) => e.stopPropagation()}>
              <img src={preview.url(f.path, 1600)} alt="" />
              <figcaption>
                <bdi dir="ltr" className="mono">{f.name}</bdi>
                <bdi dir="ltr" className="mono">{clock(f.shot, true) || 'ללא זמן'}</bdi>
                <span>{nameOf(owner)}</span>
                <span className="mono">{count(i + 1)} / {count(visible.length)}</span>
                <button
                  type="button"
                  className={`btn ${selected.has(f.name) ? 'btn-primary' : ''}`}
                  aria-pressed={selected.has(f.name)}
                  onClick={() => toggle(f.name)}
                >
                  {selected.has(f.name) ? 'נבחרה' : 'בחר'} <kbd>Space</kbd>
                </button>
                <button type="button" className="btn" disabled={i === 0} onClick={() => setPreviewName(visible[i - 1].name)}>הקודמת</button>
                <button type="button" className="btn" disabled={i === visible.length - 1} onClick={() => setPreviewName(visible[i + 1].name)}>הבאה</button>
                <button type="button" className="gw-icon" onClick={() => setPreviewName(null)} aria-label="סגור">×</button>
              </figcaption>
            </figure>
          </div>
        );
      })()}

      {compare && (
        <div className="gw-overlay" role="dialog" aria-label="השוואה" onClick={() => setCompare(null)}>
          <div className={`gw-compare n${compare.length}`} onClick={(e) => e.stopPropagation()}>
            {compare.map((n) => {
              const f = byName.get(n);
              if (!f) return null;
              return (
                <figure key={n}>
                  <img src={preview.url(f.path, 1200)} alt="" />
                  <figcaption>
                    <bdi dir="ltr" className="mono">{f.name}</bdi>
                    <span>{nameOf(ownerOf(f))}</span>
                    <button
                      type="button"
                      className="gw-link"
                      onClick={() => {
                        toggle(n);
                        setCompare((c) => (c && c.length > 2 ? c.filter((x) => x !== n) : null));
                      }}
                    >
                      הוצא מהבחירה
                    </button>
                  </figcaption>
                </figure>
              );
            })}
            <button type="button" className="gw-icon gw-compare-close" onClick={() => setCompare(null)} aria-label="סגור">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================= parts */

interface CellProps {
  f: Frame;
  size: number;
  url: string;
  pending: boolean;
  selected: boolean;
  focused: boolean;
  cover: boolean;
  splittable: boolean;
  cutStrength?: 'strong' | 'medium';
  cutTitle?: string;
  cutActionable: boolean;
  onEvent: (t: CellEvent, name: string, e: React.SyntheticEvent) => void;
}

const Cell = memo(function Cell({
  f, size, url, pending, selected, focused, cover, splittable, cutStrength, cutTitle, cutActionable, onEvent,
}: CellProps) {
  const time = clock(f.shot, true);
  return (
    <div
      className={`gw-cell${selected ? ' sel' : ''}${focused ? ' focus' : ''}${pending ? ' pending' : ''}`}
      style={{ width: size, height: size }}
      role="gridcell"
      aria-selected={selected}
      title={`${f.name} · ${time || 'ללא זמן'}`}
      draggable
      onClick={(e) => onEvent('click', f.name, e)}
      onDoubleClick={(e) => onEvent('dbl', f.name, e)}
      onContextMenu={(e) => onEvent('menu', f.name, e)}
      onDragStart={(e) => onEvent('dragstart', f.name, e)}
      onDragEnd={(e) => onEvent('dragend', f.name, e)}
    >
      <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />
      {!f.shot && <span className="gw-badge">ללא זמן</span>}
      {cover && <span className="gw-badge gw-badge-cover">שער</span>}
      <button
        type="button"
        className="gw-check"
        role="checkbox"
        aria-checked={selected}
        aria-label={`בחר ${f.name}`}
        onClick={(e) => { e.stopPropagation(); onEvent('check', f.name, e); }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {selected && <IcCheck size={12} />}
      </button>
      {splittable && (
        <button
          type="button"
          className="gw-split"
          onClick={(e) => { e.stopPropagation(); onEvent('split', f.name, e); }}
          onDoubleClick={(e) => e.stopPropagation()}
          title="פצל כאן: התמונה הזו והבאות אחריה יעברו לקבוצה חדשה"
        >
          <span>פצל כאן</span>
        </button>
      )}
      {cutStrength && (
        <div className={`gw-cut ${cutStrength}`} title={cutTitle}>
          <span className="gw-cut-chip">
            הצעה
            {cutActionable ? (
              <button
                type="button"
                aria-label="קבל את ההצעה ופצל כאן"
                onClick={(e) => { e.stopPropagation(); onEvent('cutAccept', f.name, e); }}
              >
                ✓
              </button>
            ) : null}
            <button
              type="button"
              aria-label="דחה את ההצעה"
              onClick={(e) => { e.stopPropagation(); onEvent('cutReject', f.name, e); }}
            >
              ✕
            </button>
          </span>
        </div>
      )}
    </div>
  );
});

function GroupTile({
  group, members, active, dropping, dropBefore, dropAfter, renaming, graded, words, coverUrl,
  onSelect, onMenu, onContext, onRenameStart, onRename, onRenameCancel, onDragStart, onDragEnd, dropProps,
}: {
  group: Group;
  members: Frame[];
  active: boolean;
  dropping: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  renaming: boolean;
  graded: boolean;
  words: Words;
  coverUrl: (path: string) => string;
  onSelect: () => void;
  onMenu: (el: Element) => void;
  onContext: (x: number, y: number) => void;
  onRenameStart: () => void;
  onRename: (name: string) => void;
  onRenameCancel: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
}) {
  const cover = G.coverOf(group, members);
  const [draft, setDraft] = useState(group.name);
  useEffect(() => { if (renaming) setDraft(group.name); }, [renaming, group.name]);
  const done = useRef(false);

  return (
    <div
      className={`gw-tile gw-tile-group${active ? ' on' : ''}${dropping ? ' drop' : ''}${dropBefore ? ' before' : ''}${dropAfter ? ' after' : ''}${members.length ? '' : ' empty'}`}
      data-group-tile
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
      {...dropProps}
    >
      <button
        type="button"
        className="gw-tile-hit"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`${group.name} · ${members.length} תמונות`}
      >
        <span className="gw-tile-cover" aria-hidden>
          {cover ? <img src={coverUrl(cover.path)} alt="" loading="lazy" draggable={false} /> : <i>{words.empty}</i>}
        </span>
      </button>
      <span className="gw-tile-foot">
        {renaming ? (
          <input
            className="gw-tile-input"
            aria-label={words.nameField}
            value={draft}
            autoFocus
            onFocus={(e) => { done.current = false; e.currentTarget.select(); }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { done.current = true; onRename(draft); }
              if (e.key === 'Escape') { done.current = true; e.stopPropagation(); onRenameCancel(); }
            }}
            onBlur={() => { if (!done.current) onRename(draft); }}
          />
        ) : (
          <span className="gw-tile-name" onDoubleClick={onRenameStart} title="לחיצה כפולה לשינוי שם">
            {graded && <i className="gw-dot" title="לקבוצה יש עריכת צבע" />}
            {group.name}
          </span>
        )}
        <span className="gw-tile-count mono">{count(members.length)}</span>
        <bdi dir="ltr" className="gw-tile-span mono">{spanOf(members)}</bdi>
      </span>
      <button
        type="button"
        className="gw-tile-more"
        aria-label={`פעולות על ${group.name}`}
        onClick={(e) => { e.stopPropagation(); onMenu(e.currentTarget); }}
      >
        ⋯
      </button>
    </div>
  );
}

function Timeline({
  frames, ownerOf, groups, active, onJump, nameOf,
}: {
  frames: Frame[];
  ownerOf: (f: Frame) => string | null;
  groups: Group[];
  active: View;
  onJump: (name: string) => void;
  nameOf: (id: string | null) => string;
}) {
  const timed = useMemo(() => frames.filter((f) => f.shot > 0), [frames]);
  const model = useMemo(() => {
    if (timed.length < 2) return null;
    const t0 = timed[0].shot;
    const t1 = timed[timed.length - 1].shot;
    const span = Math.max(60, t1 - t0);
    const pct = (t: number) => ((t - t0) / span) * 100;
    const order = new Map(groups.map((g, i) => [g.id, i]));
    const runs: { gid: string | null; from: number; to: number; n: number }[] = [];
    for (const f of timed) {
      const gid = ownerOf(f);
      const last = runs[runs.length - 1];
      if (last && last.gid === gid) { last.to = f.shot; last.n += 1; } else runs.push({ gid, from: f.shot, to: f.shot, n: 1 });
    }
    const notches: { at: number; minutes: number }[] = [];
    for (let i = 1; i < timed.length; i += 1) {
      const gap = timed[i].shot - timed[i - 1].shot;
      if (gap >= NOTCH_SECONDS) notches.push({ at: pct((timed[i].shot + timed[i - 1].shot) / 2), minutes: Math.round(gap / 60) });
    }
    const step = span > 6 * 3600 ? 7200 : 3600;
    const ticks: { at: number; label: string }[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push({ at: pct(t), label: clock(t) });
    return { t0, span, pct, runs, notches, ticks, order };
  }, [timed, ownerOf, groups]);

  if (!model) return null;

  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = model.t0 + ((e.clientX - r.left) / r.width) * model.span;
    let best = timed[0];
    for (const f of timed) if (Math.abs(f.shot - t) < Math.abs(best.shot - t)) best = f;
    onJump(best.name);
  };

  return (
    <div className="gw-timeline" dir="ltr" aria-label="ציר הזמן של יום הצילום">
      <div className="gw-tl-bar" onClick={jump} role="presentation">
        {model.runs.map((r, i) => {
          const tone = r.gid === null ? 'none' : r.gid === active ? 'on' : (model.order.get(r.gid) ?? 0) % 2 ? 'b' : 'a';
          return (
            <span
              key={i}
              className={`gw-tl-seg ${tone}`}
              style={{ left: `${model.pct(r.from)}%`, width: `max(3px, ${model.pct(r.to) - model.pct(r.from)}%)` }}
              title={`${nameOf(r.gid)} · ${r.n} תמונות · ${clock(r.from)}–${clock(r.to)}`}
            />
          );
        })}
        {model.notches.map((n, i) => (
          <span key={`n${i}`} className="gw-tl-notch" style={{ left: `${n.at}%` }} title={`הפסקה של ${n.minutes} דקות`} />
        ))}
      </div>
      <div className="gw-tl-ticks" aria-hidden>
        {model.ticks.map((t) => (
          <span key={t.label} style={{ left: `${t.at}%` }} className="mono">{t.label}</span>
        ))}
      </div>
    </div>
  );
}

/* ---- floating layer ---- */

function Floating({
  x, y, above = false, label, onClose, children, className = '',
}: {
  x: number;
  y: number;
  above?: boolean;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = above ? y - r.height : y;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - r.height - 8)),
    });
  }, [x, y, above]);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close.current(); };
    const t = setTimeout(() => window.addEventListener('pointerdown', down, true), 0);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', down, true); };
  }, []);

  return (
    <div
      ref={ref}
      className={`gw-float ${className}`}
      role="dialog"
      aria-label={label}
      dir="rtl"
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' }}
    >
      {children}
    </div>
  );
}

interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

function Menu({ x, y, items, label, onClose }: { x: number; y: number; items: MenuItem[]; label: string; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);
  return (
    <Floating x={x} y={y} label={label} onClose={onClose} className="gw-menu">
      <div
        ref={list}
        role="menu"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
          next?.focus();
        }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={it.onSelect}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ))}
      </div>
    </Floating>
  );
}

function MovePopover({
  x, y, above, names, groups, current, words, countOf, onPick, onClose,
}: {
  x: number;
  y: number;
  above: boolean;
  names: string[];
  groups: Group[];
  /** the one group every moving frame is already in; undefined when mixed */
  current: string | null | undefined;
  words: Words;
  countOf: (id: string | null) => number;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const options = [{ id: null as string | null, name: words.none }, ...groups.map((g) => ({ id: g.id as string | null, name: g.name }))];
  const shown = q.trim() ? options.filter((o) => o.name.includes(q.trim())) : options;
  const n = names.length === 1 ? 'תמונה אחת' : `${count(names.length)} תמונות`;
  return (
    <Floating x={x} y={y} above={above} label={`העבר ${n}`} onClose={onClose} className="gw-pop">
      <p className="gw-pop-title">העבר {n} אל</p>
      <input
        className="gw-pop-input"
        placeholder={`חיפוש ${words.one}`}
        aria-label={`חיפוש ${words.one}`}
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const first = shown.find((o) => o.id !== current);
            if (first) onPick(first.id);
          }
        }}
      />
      <div className="gw-pop-list" role="listbox">
        {shown.map((o) => {
          const isCurrent = o.id === current;
          return (
            <button
              key={o.id ?? '∅'}
              type="button"
              role="option"
              aria-selected={false}
              disabled={isCurrent}
              onClick={() => onPick(o.id)}
              aria-label={`העבר ${n} ל${o.name}`}
            >
              <span>{o.name}</span>
              {isCurrent ? <em>נוכחי</em> : <span className="mono">{count(countOf(o.id))}</span>}
            </button>
          );
        })}
        {!shown.length && <p className="gw-pop-empty">אין {words.one} בשם הזה.</p>}
      </div>
    </Floating>
  );
}

function NamePopover({
  x, y, above, title, field, initial, cta, onSubmit, onClose,
}: {
  x: number;
  y: number;
  above: boolean;
  title: string;
  field: string;
  initial: string;
  cta: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Floating x={x} y={y} above={above} label={title} onClose={onClose} className="gw-pop">
      <p className="gw-pop-title">{title}</p>
      <input
        className="gw-pop-input"
        placeholder={field}
        aria-label={field}
        value={name}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(name); }}
      />
      <div className="gw-pop-actions">
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(name)}>{cta}</button>
        <button type="button" className="btn" onClick={onClose}>ביטול</button>
      </div>
    </Floating>
  );
}

function MergePopover({
  x, y, above, source, groups, countOf, onPick, onClose,
}: {
  x: number;
  y: number;
  above: boolean;
  source: string;
  groups: Group[];
  countOf: (id: string) => number;
  onPick: (target: string) => void;
  onClose: () => void;
}) {
  const i = groups.findIndex((g) => g.id === source);
  const src = groups[i];
  // The neighbours first: merging with the one before or after is the common case.
  const near = [groups[i - 1], groups[i + 1]].filter((g): g is Group => !!g);
  const rest = groups.filter((g) => g.id !== source && !near.includes(g));
  const Row = ({ g, tag }: { g: Group; tag?: string }) => (
    <button type="button" role="option" aria-selected={false} onClick={() => onPick(g.id)}>
      <span>{g.name}{tag && <em> · {tag}</em>}</span>
      <span className="mono">{count(countOf(g.id))}</span>
    </button>
  );
  return (
    <Floating x={x} y={y} above={above} label="מיזוג" onClose={onClose} className="gw-pop">
      <p className="gw-pop-title">למזג את „{src?.name}” עם</p>
      <div className="gw-pop-list" role="listbox">
        {near.map((g) => <Row key={g.id} g={g} tag={groups.indexOf(g) < i ? 'הקודם' : 'הבא'} />)}
        {rest.length > 0 && near.length > 0 && <hr />}
        {rest.map((g) => <Row key={g.id} g={g} />)}
      </div>
      <p className="gw-pop-note">השם „{src?.name}” נשמר. אפשר לבטל.</p>
    </Floating>
  );
}

function Dialog({
  title, children, actions, onClose,
}: {
  title: string;
  children: React.ReactNode;
  actions: MenuItem[];
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.gw-dialog-actions button')?.focus();
  }, []);
  return (
    <div className="gw-overlay" onClick={onClose}>
      <div
        className="gw-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        dir="rtl"
        ref={box}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
        <div className="gw-dialog-actions">
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              className={`btn ${a.danger ? 'btn-danger' : i === 0 ? 'btn-primary' : ''}`}
              onClick={a.onSelect}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
