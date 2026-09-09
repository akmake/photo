/* שולחן האלבום.
 *
 * הכפולה פתוחה תמיד, והצלם עובד עליה. זהו המסך.
 *
 * הסדר שבו הדברים נבנו הוא הסדר שבו הם באמת קורים כשמרכיבים אלבום:
 *
 *   1. מה עוד לא בשימוש  — בלי זה שמים את אותה תמונה פעמיים ומגלים בדפוס.
 *   2. איזה מקבץ         — מרכיבים כפולה בתוך רגע אחד, לא מתוך 400 תמונות.
 *   3. תבנית לעמוד       — אחרי שיודעים כמה תמונות, לא לפני.
 *   4. הזזה בתוך המסגרת  — הפעולה שנעשית מאות פעמים באלבום אחד.
 *
 * שלוש החלטות שנלמדו מכישלון של הגרסה הראשונה, ושמסבירות למה הקוד נראה כך:
 *
 *   • גרירה בתוך משבצת מלאה = הזזת התמונה, תמיד. העברת תמונה למקום אחר
 *     יוצאת מידית אחיזה בפינה. קודם שניהם ישבו על אותה גרירה, והדפדפן
 *     נתן לגרירה שלו לנצח — כלומר הפעולה הכי שכיחה בכלי פשוט לא עבדה.
 *
 *   • כל שינוי עובר דרך `mutate`, ולכן הכול ניתן לביטול. כלי אלבום בלי
 *     Ctrl+Z אינו כלי עבודה.
 *
 *   • רצועת הכפולות למטה. קצב לא נראה בכפולה בודדת — זו הייתה המסקנה
 *     המרכזית מהמחקר, והמסך הראשון סתר אותה כשהראה כפולה אחת בלבד.
 *
 * מה שאין כאן בכוונה: פריסה אוטומטית. הצלם ביקש שהוא יניח, ושהמכונה
 * תעזור ולא תחליט.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlbumDeskExportSlot, Frame } from '../api';
import { albumDeskExport, pickFolder, thumbUrl } from '../api';
import type { Project } from '../studio/store';
import { batchesOf, framesInBatch, framesOf } from '../studio/store';
import type { Batch } from '../types';
import {
  type AlbumDoc,
  type Page,
  type PageSide,
  type Placement,
  type SlotRef,
  type Spread,
  emptyPage,
  loadDoc,
  newSpreadId,
  place,
  samePlace,
  saveDoc,
  usedFrames,
  whereUsed,
} from './model';
import { DEFAULT_TEMPLATE, type Rect, templateById, templatesByCount } from './templates';
import {
  type AlbumSpec,
  DEFAULT_SPEC,
  SIZE_PRESETS,
  mmOfPageHeight,
  mmOfPageWidth,
  pageCountState,
  pageRatio,
  pagesOfSpreads,
} from './spec';
import './albumdesk.css';

/* כמה פיקסלים העכבר חייב לזוז לפני שזו הזזה ולא לחיצה. בלי זה כל בחירה
 * של משבצת גם מזיזה את התמונה בה. */
const DRAG_SLOP = 3;

const HISTORY_MAX = 60;

interface DragPayload {
  frame: string;
  path: string;
  from: SlotRef | null;
}

function newSpread(): Spread {
  return {
    id: newSpreadId(),
    first: emptyPage(DEFAULT_TEMPLATE, templateById(DEFAULT_TEMPLATE).slots.length),
    second: emptyPage(DEFAULT_TEMPLATE, templateById(DEFAULT_TEMPLATE).slots.length),
  };
}

export default function AlbumDesk({
  project,
  onBack,
}: {
  project: Project;
  onBack?: () => void;
}) {
  /* ---------------------------------------------------------- the project's set
   *
   * הקריאה נכשלת ← אומרים "לא ניתן לקרוא". ריק ולא-נקרא אינם אותו דבר,
   * ואסור לכתוב אלבום על תמונות שלא הצלחנו לקרוא. */
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    try {
      setFrames(framesOf(project.id));
      setBatches(batchesOf(project.id));
      setReadFailed(false);
    } catch {
      setFrames(null);
      setReadFailed(true);
    }
  }, [project.id]);

  const byBatch = useMemo(() => {
    const map = new Map<string, Frame[]>();
    for (const b of batches) {
      try {
        map.set(b.id, framesInBatch(project.id, b.id));
      } catch {
        map.set(b.id, []);
      }
    }
    return map;
  }, [batches, project.id]);

  const loose = useMemo(() => {
    if (!frames) return [];
    const assigned = new Set<string>();
    for (const list of byBatch.values()) for (const f of list) assigned.add(f.name);
    return frames.filter((f) => !assigned.has(f.name));
  }, [frames, byBatch]);

  /* ------------------------------------------------------------------ the album */
  const [doc, setDoc] = useState<AlbumDoc>(() => {
    const saved = loadDoc(project.id);
    return saved ?? { projectId: project.id, spec: { ...DEFAULT_SPEC }, spreads: [newSpread()] };
  });

  /* ההיסטוריה. כל `mutate` דוחף את המצב הקודם לעבר ומרוקן את העתיד —
   * הכלל הרגיל של ביטול: פעולה חדשה אחרי ביטול מוחקת את הענף שנזנח. */
  const past = useRef<AlbumDoc[]>([]);
  const future = useRef<AlbumDoc[]>([]);
  const [depth, setDepth] = useState({ back: 0, fwd: 0 });
  const syncDepth = () => setDepth({ back: past.current.length, fwd: future.current.length });

  useEffect(() => {
    const saved = loadDoc(project.id);
    past.current = [];
    future.current = [];
    syncDepth();
    setDoc(saved ?? { projectId: project.id, spec: { ...DEFAULT_SPEC }, spreads: [newSpread()] });
    setAt(0);
    setSel(null);
  }, [project.id]);

  useEffect(() => {
    saveDoc(doc);
  }, [doc]);

  const [at, setAt] = useState(0);
  const [sel, setSel] = useState<SlotRef | null>(null);
  /* הגדרות האלבום פתוחות מעצמן כשהאלבום עוד ריק: זה הצעד הראשון באמת,
   * ולא משהו שנזכרים בו בסוף. */
  const [setup, setSetup] = useState(false);
  /* הקווים המנחים הם עזר, לא התוצאה. אפשר לכבות ולראות את הכפולה נקייה. */
  const [guides, setGuides] = useState(true);

  const clone = (d: AlbumDoc): AlbumDoc => JSON.parse(JSON.stringify(d));

  const mutate = useCallback((fn: (d: AlbumDoc) => void) => {
    setDoc((prev) => {
      past.current.push(prev);
      if (past.current.length > HISTORY_MAX) past.current.shift();
      future.current = [];
      const next = clone(prev);
      fn(next);
      return next;
    });
    syncDepth();
  }, []);

  /* הזזה רציפה (גרירה בתוך מסגרת) לא אמורה לייצר צעד ביטול לכל פיקסל.
   * `coalesce` מצרף לצעד שנפתח בתחילת הגרירה. */
  const coalescing = useRef(false);
  const mutateLive = useCallback((fn: (d: AlbumDoc) => void) => {
    setDoc((prev) => {
      if (!coalescing.current) {
        past.current.push(prev);
        if (past.current.length > HISTORY_MAX) past.current.shift();
        future.current = [];
        coalescing.current = true;
      }
      const next = clone(prev);
      fn(next);
      return next;
    });
  }, []);
  const endLive = useCallback(() => {
    if (coalescing.current) {
      coalescing.current = false;
      syncDepth();
    }
  }, []);

  const undo = useCallback(() => {
    setDoc((cur) => {
      const prev = past.current.pop();
      if (!prev) return cur;
      future.current.push(cur);
      return prev;
    });
    setSel(null);
    syncDepth();
  }, []);

  const redo = useCallback(() => {
    setDoc((cur) => {
      const next = future.current.pop();
      if (!next) return cur;
      past.current.push(cur);
      return next;
    });
    setSel(null);
    syncDepth();
  }, []);

  const setSpec = (patch: Partial<AlbumSpec>) => {
    mutate((d) => {
      d.spec = { ...d.spec, ...patch };
    });
  };

  const spreadIdx = Math.min(at, doc.spreads.length - 1);
  const spread = doc.spreads[spreadIdx];
  const used = useMemo(() => usedFrames(doc), [doc]);

  /* ------------------------------------------------------------------- the tray */
  const [trayBatch, setTrayBatch] = useState<string>('all');
  const [showUsed, setShowUsed] = useState(false);

  const trayFrames = useMemo(() => {
    if (!frames) return [];
    let list: Frame[];
    if (trayBatch === 'all') list = frames;
    else if (trayBatch === 'loose') list = loose;
    else list = byBatch.get(trayBatch) ?? [];
    return showUsed ? list : list.filter((f) => !used.has(f.name));
  }, [frames, trayBatch, byBatch, loose, showUsed, used]);

  /* ------------------------------------------------------------- editing a slot */

  const pageAt = (d: AlbumDoc, ref: SlotRef): Page => d.spreads[ref.spread][ref.side];

  const setTemplate = (side: PageSide, templateId: string) => {
    const page = spread[side];
    const filled = page.slots.filter(Boolean).length;
    const room = templateById(templateId).slots.length;
    if (filled > room) {
      /* תבנית קטנה יותר ממה שכבר מונח. שקט כאן = תמונות שנעלמות בלי
       * שהצלם ידע. שואלים. */
      const ok = window.confirm(
        `לתבנית הזאת ${room} משבצות, ובעמוד יש ${filled} תמונות.\n` +
          `${filled - room} תמונות יורדו מהעמוד. להמשיך?`,
      );
      if (!ok) return;
    }
    mutate((d) => {
      const p = d.spreads[spreadIdx][side];
      const kept = p.slots.filter(Boolean) as Placement[];
      p.templateId = templateId;
      p.slots = templateById(templateId).slots.map((_, i) => kept[i] ?? null);
    });
    setSel(null);
  };

  const dropOn = (ref: SlotRef, payload: DragPayload) => {
    mutate((d) => {
      const target = pageAt(d, ref);
      const incoming = target.slots[ref.slot];
      if (payload.from) {
        const src = pageAt(d, payload.from);
        const moving = src.slots[payload.from.slot];
        src.slots[payload.from.slot] = incoming ?? null;
        target.slots[ref.slot] = moving ?? null;
      } else {
        target.slots[ref.slot] = place(payload.frame, payload.path);
      }
    });
    setSel(ref);
  };

  const clearSlot = (ref: SlotRef) => {
    mutate((d) => {
      pageAt(d, ref).slots[ref.slot] = null;
    });
    setSel(null);
  };

  /* כוונון חיתוך. `live` מבדיל בין גרירה רציפה לבין צעד בודד (חץ, כפתור),
   * כדי שביטול אחד יבטל גרירה שלמה ולא פיקסל אחד. */
  const nudge = (ref: SlotRef, dx: number, dy: number, live = false) => {
    (live ? mutateLive : mutate)((d) => {
      const s = pageAt(d, ref).slots[ref.slot];
      if (!s) return;
      s.fx = Math.max(0, Math.min(100, s.fx + dx));
      s.fy = Math.max(0, Math.min(100, s.fy + dy));
    });
  };

  const zoomBy = (ref: SlotRef, delta: number, live = false) => {
    (live ? mutateLive : mutate)((d) => {
      const s = pageAt(d, ref).slots[ref.slot];
      if (!s) return;
      s.zoom = Math.max(1, Math.min(3, +(s.zoom + delta).toFixed(2)));
    });
  };

  const resetSlot = (ref: SlotRef) => {
    mutate((d) => {
      const s = pageAt(d, ref).slots[ref.slot];
      if (!s) return;
      s.zoom = 1;
      s.fx = 50;
      s.fy = 50;
    });
  };

  /* --------------------------------------------------------------- the spreads */

  const addSpread = () => {
    mutate((d) => d.spreads.splice(spreadIdx + 1, 0, newSpread()));
    setAt(spreadIdx + 1);
    setSel(null);
  };

  const removeSpread = () => {
    if (doc.spreads.length <= 1) return;
    mutate((d) => d.spreads.splice(spreadIdx, 1));
    setAt(Math.max(0, spreadIdx - 1));
    setSel(null);
  };

  /* ---------------------------------------------------------------- export
   *
   * הגיאומטריה נפתרת כאן: התבניות הן של המסך, והמנוע מקבל מלבנים בשברים
   * של הכפולה כולה. בכריכה עברית העמוד הראשון הוא הימני, ולכן על הגיליון
   * (שנקרא משמאל לימין) הוא יושב בחצי הימני.
   */
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ ok: boolean; text: string; notes: string[] } | null>(null);

  const buildPayload = (out: string, dpi: number) => ({
    out,
    dpi,
    spec: { wcm: doc.spec.wcm, hcm: doc.spec.hcm, bleedMm: doc.spec.bleedMm },
    spreads: doc.spreads.map((sp) => {
      const slots: AlbumDeskExportSlot[] = [];
      for (const side of ['first', 'second'] as PageSide[]) {
        const page = sp[side];
        const t = templateById(page.templateId);
        // 'first' = העמוד הימני = החצי הימני של הגיליון.
        const originX = side === 'first' ? 0.5 : 0;
        t.slots.forEach((rect, i) => {
          const pl = page.slots[i];
          if (!pl) return;
          slots.push({
            x: originX + rect.x * 0.5,
            y: rect.y,
            w: rect.w * 0.5,
            h: rect.h,
            path: pl.path,
            zoom: pl.zoom,
            fx: pl.fx,
            fy: pl.fy,
          });
        });
      }
      return { slots };
    }),
  });

  const runExport = async () => {
    setReport(null);
    let out: string | null = null;
    try {
      out = await pickFolder();
    } catch (e) {
      setReport({ ok: false, text: `לא ניתן לפתוח את בחירת התיקייה: ${(e as Error).message}`, notes: [] });
      return;
    }
    /* בחירה שבוטלה אינה שגיאה, ושגיאה אינה ביטול. שתיקה כאן היא הבאג
     * היקר ביותר לאיתור, ולכן שתי הדרכים אומרות משהו. */
    if (!out) {
      setReport({ ok: false, text: 'הייצוא בוטל — לא נבחרה תיקייה.', notes: [] });
      return;
    }
    setBusy(`מייצא ${doc.spreads.length} כפולות ב-300 DPI…`);
    try {
      const res = await albumDeskExport(buildPayload(out, 300));
      setReport({
        ok: true,
        text: `${res.files.length} כפולות נכתבו ל-${res.folder} · ${res.size[0]}×${res.size[1]} פיקסלים ב-${res.dpi} DPI`,
        notes: res.notes ?? [],
      });
    } catch (e) {
      setReport({ ok: false, text: `הייצוא נכשל: ${(e as Error).message}`, notes: [] });
    } finally {
      setBusy(null);
    }
  };

  const placed = useMemo(
    () => doc.spreads.reduce(
      (n, sp) => n + sp.first.slots.filter(Boolean).length + sp.second.slots.filter(Boolean).length,
      0,
    ),
    [doc],
  );

  const moveSpread = (from: number, to: number) => {
    if (from === to || to < 0 || to >= doc.spreads.length) return;
    mutate((d) => {
      const [s] = d.spreads.splice(from, 1);
      d.spreads.splice(to, 0, s);
    });
    setAt(to);
    setSel(null);
  };

  /* ----------------------------------------------------------------- keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === 'PageDown') { e.preventDefault(); setAt((n) => Math.min(doc.spreads.length - 1, n + 1)); setSel(null); return; }
      if (e.key === 'PageUp') { e.preventDefault(); setAt((n) => Math.max(0, n - 1)); setSel(null); return; }

      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSlot(sel); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(sel, 2, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(sel, -2, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(sel, 0, 2); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(sel, 0, -2); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(sel, 0.1); }
      else if (e.key === '-') { e.preventDefault(); zoomBy(sel, -0.1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ------------------------------------------------------------------- render */

  if (readFailed) {
    return (
      <div className="ad-fail">
        <h2>לא ניתן לקרוא את תמונות הפרויקט</h2>
        <p>המנוע לא ענה, או שהתיקייה אינה זמינה. אין כאן אלבום ריק — יש קריאה שנכשלה.</p>
        {onBack && <button className="ad-ghost" onClick={onBack}>חזרה</button>}
      </div>
    );
  }

  if (!frames) return <div className="ad-wait">טוען את תמונות הפרויקט…</div>;

  if (frames.length === 0) {
    return (
      <div className="ad-fail">
        <h2>אין עדיין תמונות בפרויקט הזה</h2>
        <p>אחרי הייבוא אפשר להרכיב אלבום מהתמונות של {project.client}.</p>
        {onBack && <button className="ad-ghost" onClick={onBack}>חזרה</button>}
      </div>
    );
  }

  const remaining = frames.filter((f) => !used.has(f.name)).length;

  return (
    <div className="ad">
      <header className="ad-bar">
        <div className="ad-bar-side">
          {onBack && <button className="ad-ghost" onClick={onBack}>← חזרה</button>}
          <span className="ad-client">{project.client}</span>
        </div>

        <div className="ad-nav">
          <button className="ad-ghost" disabled={depth.back === 0} onClick={undo} title="Ctrl+Z">
            ביטול
          </button>
          <button className="ad-ghost" disabled={depth.fwd === 0} onClick={redo} title="Ctrl+Shift+Z">
            שחזור
          </button>
          <span className="ad-sep" />
          <span className="ad-count">כפולה {spreadIdx + 1} מתוך {doc.spreads.length}</span>
        </div>

        <div className="ad-bar-side ad-bar-end">
          <button
            className={`ad-ghost${guides ? ' on' : ''}`}
            onClick={() => setGuides((g) => !g)}
            title="קווי חיתוך, תחום שקט וחריץ"
          >
            קווים מנחים
          </button>
          <button className={`ad-ghost${setup ? ' on' : ''}`} onClick={() => setSetup((v) => !v)}>
            הגדרות אלבום
          </button>
          <button
            className="ad-ghost ad-export"
            onClick={runExport}
            disabled={!!busy || placed === 0}
            title={placed === 0 ? 'אין עדיין תמונות באלבום' : 'כתיבת הכפולות לדיסק ב-300 DPI'}
          >
            {busy ? 'מייצא…' : 'ייצוא לדפוס'}
          </button>
          <span className="ad-sep" />
          <button className="ad-ghost" onClick={addSpread}>+ כפולה</button>
          <button className="ad-ghost" onClick={removeSpread} disabled={doc.spreads.length <= 1}>
            מחק כפולה
          </button>
        </div>
      </header>

      {(busy || report) && (
        <div className={`ad-report${report && !report.ok ? ' is-bad' : ''}`}>
          <span className="ad-report-text">{busy ?? report?.text}</span>
          {report?.notes?.length ? (
            <ul className="ad-report-notes">
              {report.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : null}
          {!busy && (
            <button className="ad-ghost ad-report-close" onClick={() => setReport(null)}>סגור</button>
          )}
        </div>
      )}

      {setup && (
        <SetupBar
          spec={doc.spec}
          spreads={doc.spreads.length}
          onChange={setSpec}
          onClose={() => setSetup(false)}
        />
      )}

      <div className="ad-body">
        <aside className="ad-tray">
          <div className="ad-tray-head">
            <strong>המגש</strong>
            <span className="ad-remaining">{remaining} עוד לא בשימוש</span>
          </div>

          <div className="ad-batches">
            <button
              className={`ad-chip${trayBatch === 'all' ? ' on' : ''}`}
              onClick={() => setTrayBatch('all')}
            >
              הכול<span className="ad-chip-n">{frames.length}</span>
            </button>
            {batches.map((b) => (
              <button
                key={b.id}
                className={`ad-chip${trayBatch === b.id ? ' on' : ''}`}
                onClick={() => setTrayBatch(b.id)}
              >
                {b.name}<span className="ad-chip-n">{(byBatch.get(b.id) ?? []).length}</span>
              </button>
            ))}
            {loose.length > 0 && (
              <button
                className={`ad-chip${trayBatch === 'loose' ? ' on' : ''}`}
                onClick={() => setTrayBatch('loose')}
              >
                ללא מקבץ<span className="ad-chip-n">{loose.length}</span>
              </button>
            )}
          </div>

          <label className="ad-showused">
            <input
              type="checkbox"
              checked={showUsed}
              onChange={(e) => setShowUsed(e.target.checked)}
            />
            הצג גם תמונות שכבר בשימוש
          </label>

          <div className="ad-thumbs">
            {trayFrames.length === 0 && (
              <p className="ad-empty">
                {showUsed ? 'אין תמונות במקבץ הזה.' : 'כל התמונות במקבץ הזה כבר באלבום.'}
              </p>
            )}
            {trayFrames.map((f) => {
              const where = whereUsed(doc, f.name);
              return (
                <div
                  key={f.name}
                  className={`ad-thumb${where ? ' is-used' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    const payload: DragPayload = { frame: f.name, path: f.shown, from: null };
                    e.dataTransfer.setData('application/json', JSON.stringify(payload));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={where ? `${f.name} — כבר בכפולה ${where}` : f.name}
                >
                  <img src={thumbUrl(f.shown, 240)} alt="" loading="lazy" draggable={false} />
                  {where && <span className="ad-usedtag">כפולה {where}</span>}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="ad-stage">
          <div
            className={`ad-spread${guides ? '' : ' no-guides'}`}
            style={{ aspectRatio: String(2 * pageRatio(doc.spec)) }}
          >
            {/* בכריכה עברית הספר נפתח מימין, ולכן העמוד הראשון הוא הימני.
              * המכולה rtl, ולכן `first` בקוד יושב מימין על המסך. */}
            <PageView
              page={spread.first} side="first" spreadIndex={spreadIdx}
              sel={sel} onSelect={setSel} onDrop={dropOn}
              onNudge={nudge} onZoom={zoomBy} onEndLive={endLive}
            />
            <PageView
              page={spread.second} side="second" spreadIndex={spreadIdx}
              sel={sel} onSelect={setSel} onDrop={dropOn}
              onNudge={nudge} onZoom={zoomBy} onEndLive={endLive}
            />
            {guides && <Guides spec={doc.spec} />}
          </div>

          {sel && (
            <div className="ad-slotbar">
              <span className="ad-slotbar-title">חיתוך בתוך המסגרת</span>
              <button className="ad-ghost" onClick={() => zoomBy(sel, -0.1)}>−</button>
              <span className="ad-zoom">
                {Math.round((doc.spreads[sel.spread][sel.side].slots[sel.slot]?.zoom ?? 1) * 100)}%
              </span>
              <button className="ad-ghost" onClick={() => zoomBy(sel, 0.1)}>+</button>
              <button className="ad-ghost" onClick={() => resetSlot(sel)}>אפס</button>
              <button className="ad-ghost ad-danger" onClick={() => clearSlot(sel)}>הסר תמונה</button>
              <span className="ad-hint">
                גרירה בתוך המסגרת מזיזה · גלגלת מקרבת · חיצים לכוונון · הפינה מעבירה למקום אחר
              </span>
            </div>
          )}

          <div className="ad-templates">
            <TemplateRow
              label="עמוד 1 · ימין"
              current={spread.first.templateId}
              onPick={(id) => setTemplate('first', id)}
            />
            <TemplateRow
              label="עמוד 2 · שמאל"
              current={spread.second.templateId}
              onPick={(id) => setTemplate('second', id)}
            />
          </div>
        </main>
      </div>

      {/* רצועת הכפולות. הספר כולו בשורה אחת — כאן רואים קצב, ורק כאן.
        * גרירה מסדרת מחדש. */}
      <Filmstrip
        doc={doc}
        current={spreadIdx}
        onGo={(i) => { setAt(i); setSel(null); }}
        onMove={moveSpread}
      />
    </div>
  );
}

/* --------------------------------------------------------------------- a page */

function PageView({
  page, side, spreadIndex, sel, onSelect, onDrop, onNudge, onZoom, onEndLive,
}: {
  page: Page;
  side: PageSide;
  spreadIndex: number;
  sel: SlotRef | null;
  onSelect: (r: SlotRef) => void;
  onDrop: (r: SlotRef, p: DragPayload) => void;
  onNudge: (r: SlotRef, dx: number, dy: number, live?: boolean) => void;
  onZoom: (r: SlotRef, d: number, live?: boolean) => void;
  onEndLive: () => void;
}) {
  const t = templateById(page.templateId);
  return (
    <div className={`ad-page${t.bleed ? ' is-bleed' : ''}`}>
      {t.slots.map((rect, i) => {
        const ref: SlotRef = { spread: spreadIndex, side, slot: i };
        return (
          <Slot
            key={i}
            rect={rect}
            refr={ref}
            placement={page.slots[i] ?? null}
            selected={samePlace(sel, ref)}
            onSelect={onSelect}
            onDrop={onDrop}
            onNudge={onNudge}
            onZoom={onZoom}
            onEndLive={onEndLive}
          />
        );
      })}
      {t.slots.length === 0 && <span className="ad-blank">עמוד ריק</span>}
    </div>
  );
}

/* --------------------------------------------------------------------- a slot
 *
 * שתי גרירות שונות חיות כאן, וההפרדה ביניהן היא כל העניין:
 *
 *   • גרירה בתוך המסגרת  → מזיזה את התמונה בחיתוך. הפעולה השכיחה ביותר,
 *                          ולכן היא הישירה. עכבר בלבד, בלי גרירת דפדפן.
 *   • גרירה מהפינה       → מעבירה את התמונה למשבצת אחרת. נדירה יותר,
 *                          ולכן היא זו שמקבלת ידית.
 *
 * בגרסה הראשונה שתיהן ישבו על אותה גרירה; הדפדפן העדיף את שלו, וההזזה
 * בתוך המסגרת פשוט לא עבדה.
 *
 * המימוש של החיתוך: `background-size: cover` נותן את המילוי,
 * `background-position` את נקודת המיקוד, ו-`transform-origin` מוצמד לאותה
 * נקודה — כך שהזום מתרחש סביבה ומה שכיוונת אליו נשאר במקום.
 */
function Slot({
  rect, refr, placement, selected, onSelect, onDrop, onNudge, onZoom, onEndLive,
}: {
  rect: Rect;
  refr: SlotRef;
  placement: Placement | null;
  selected: boolean;
  onSelect: (r: SlotRef) => void;
  onDrop: (r: SlotRef, p: DragPayload) => void;
  onNudge: (r: SlotRef, dx: number, dy: number, live?: boolean) => void;
  onZoom: (r: SlotRef, d: number, live?: boolean) => void;
  onEndLive: () => void;
}) {
  const [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; live: boolean } | null>(null);

  const style: React.CSSProperties = {
    insetInlineStart: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onSelect(refr);
    if (!placement) return;
    box.current?.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, live: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !placement || !box.current) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    /* מתחת לסף זו לחיצה, לא גרירה — אחרת כל בחירת משבצת מזיזה את התמונה. */
    if (!d.live && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    d.live = true;
    d.x = e.clientX;
    d.y = e.clientY;
    const w = box.current.clientWidth || 1;
    const h = box.current.clientHeight || 1;
    /* גרירה ימינה מזיזה את התמונה ימינה, כלומר חושפת יותר משמאל — ולכן
     * נקודת המיקוד זזה בכיוון ההפוך. */
    onNudge(refr, (-dx / w) * 100, (-dy / h) * 100, true);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) {
      box.current?.releasePointerCapture?.(e.pointerId);
      drag.current = null;
      onEndLive();
    }
  };

  return (
    <div
      ref={box}
      className={[
        'ad-slot',
        placement ? 'is-filled' : 'is-empty',
        selected ? 'is-sel' : '',
        over ? 'is-over' : '',
      ].join(' ')}
      style={style}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        try {
          const p = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
          if (p && p.frame) onDrop(refr, p);
        } catch {
          /* גרירה ממקור שאינו המגש או משבצת. מתעלמים בשקט. */
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={(e) => {
        if (!placement) return;
        onZoom(refr, e.deltaY < 0 ? 0.08 : -0.08);
      }}
    >
      {placement ? (
        <>
          <div
            className="ad-img"
            style={{
              backgroundImage: `url("${thumbUrl(placement.path, 1200)}")`,
              backgroundPosition: `${placement.fx}% ${placement.fy}%`,
              transform: `scale(${placement.zoom})`,
              transformOrigin: `${placement.fx}% ${placement.fy}%`,
            }}
          />
          {/* הידית. זו — ורק זו — מעבירה את התמונה למשבצת אחרת. */}
          <span
            className="ad-grip"
            title="גרור כדי להעביר למשבצת אחרת"
            draggable
            onPointerDown={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              const payload: DragPayload = {
                frame: placement.frame,
                path: placement.path,
                from: refr,
              };
              e.dataTransfer.setData('application/json', JSON.stringify(payload));
              e.dataTransfer.effectAllowed = 'move';
            }}
          />
        </>
      ) : (
        <span className="ad-slot-hint">גרור תמונה</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- templates */

function TemplateRow({
  label, current, onPick,
}: {
  label: string;
  current: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="ad-trow">
      <span className="ad-trow-label">{label}</span>
      <div className="ad-trow-items">
        {templatesByCount().map((g) => (
          <div className="ad-tgroup" key={g.count}>
            <span className="ad-tgroup-n">{g.count === 0 ? 'ריק' : g.count}</span>
            {g.items.map((t) => (
              <button
                key={t.id}
                className={`ad-tmini${current === t.id ? ' on' : ''}${t.bleed ? ' is-bleed' : ''}`}
                title={t.bleed ? `${t.label} · עד הקצה` : t.label}
                onClick={() => onPick(t.id)}
              >
                <span className="ad-tmini-page">
                  {t.slots.map((r, i) => (
                    <i
                      key={i}
                      style={{
                        insetInlineStart: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.w * 100}%`,
                        height: `${r.h * 100}%`,
                      }}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- filmstrip
 *
 * הספר כולו בשורה אחת. קצב — איפה עמוס ואיפה נח, איפה תמונה גדולה נושמת
 * ואיפה יש רצף של רשתות — לא נראה בכפולה בודדת, ולכן הוא לא ניתן לעריכה
 * בלי המסך הזה. גרירה מסדרת מחדש.
 */
function Filmstrip({
  doc, current, onGo, onMove,
}: {
  doc: AlbumDoc;
  current: number;
  onGo: (i: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  return (
    <footer className="ad-strip">
      {doc.spreads.map((sp, i) => (
        <button
          key={sp.id}
          className={[
            'ad-strip-item',
            i === current ? 'on' : '',
            overIdx === i && dragFrom !== null && dragFrom !== i ? 'is-over' : '',
          ].join(' ')}
          onClick={() => onGo(i)}
          draggable
          onDragStart={(e) => {
            setDragFrom(i);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
          }}
          onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
          onDragLeave={() => setOverIdx((n) => (n === i ? null : n))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null) onMove(dragFrom, i);
            setDragFrom(null);
            setOverIdx(null);
          }}
          onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
          title={`כפולה ${i + 1}`}
        >
          <span className="ad-strip-spread">
            <MiniPage page={sp.first} />
            <MiniPage page={sp.second} />
            <i className="ad-strip-fold" />
          </span>
          <span className="ad-strip-n">{i + 1}</span>
        </button>
      ))}
    </footer>
  );
}

function MiniPage({ page }: { page: Page }) {
  const t = templateById(page.templateId);
  return (
    <span className="ad-mini">
      {t.slots.map((r, i) => {
        const s = page.slots[i];
        return (
          <i
            key={i}
            className={s ? 'has' : ''}
            style={{
              insetInlineStart: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              backgroundImage: s ? `url("${thumbUrl(s.path, 120)}")` : undefined,
              backgroundPosition: s ? `${s.fx}% ${s.fy}%` : undefined,
            }}
          />
        );
      })}
    </span>
  );
}

/* ---------------------------------------------------------------- guides
 *
 * שלושה קווים, וכולם פיזיים — לא קישוט ולא טעם אישי:
 *
 *   חיתוך  קו הגיליוטינה. מה שמעבר לו לא קיים בספר.
 *   שקט    פרט קריטי מחוץ לתחום הזה נחתך גם בדפוס תקין.
 *   חריץ   מה שנבלע בכריכה. פנים כאן — מתות.
 *
 * הכול קו שיער, בלי מילוי. סימון לא מכסה תוכן, ובמיוחד לא כשמכוונים
 * עליו חיתוך.
 */
function Guides({ spec }: { spec: AlbumSpec }) {
  const bleedX = mmOfPageWidth(spec, spec.bleedMm) * 50; // אחוז מרוחב הכפולה
  const bleedY = mmOfPageHeight(spec, spec.bleedMm) * 100;
  const safeX = mmOfPageWidth(spec, spec.safeMm) * 50;
  const safeY = mmOfPageHeight(spec, spec.safeMm) * 100;
  const gutter = mmOfPageWidth(spec, spec.gutterMm) * 100; // משני צדי הקיפול

  return (
    <div className="ad-guides" aria-hidden>
      {spec.bleedMm > 0 && (
        <span
          className="ad-g ad-g-bleed"
          style={{ inset: `${bleedY}% ${bleedX}%` }}
          data-label="חיתוך"
        />
      )}
      {spec.safeMm > 0 && (
        <span className="ad-g ad-g-safe" style={{ inset: `${safeY}% ${safeX}%` }} />
      )}
      <span className="ad-fold-line" />
      {spec.gutterMm > 0 && (
        <span className="ad-fold-zone" style={{ width: `${gutter}%` }} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- setup bar
 *
 * מה שנמכר ללקוח. הצלם לא פותח כפולה ומתחיל להניח — הוא כבר יודע
 * "30×30, ארבעים עמודים", כי זו ההזמנה. הכפולה על המסך נגזרת מכאן.
 *
 * אין כאן רשימת מעבדות. איני יודע אצל מי הצלם מדפיס, ורשימה מומצאת
 * גרועה יותר משדה ריק.
 */
function SetupBar({
  spec, spreads, onChange, onClose,
}: {
  spec: AlbumSpec;
  spreads: number;
  onChange: (p: Partial<AlbumSpec>) => void;
  onClose: () => void;
}) {
  const pages = pagesOfSpreads(spreads);
  const state = pageCountState(spreads, spec.targetPages);

  const num = (
    label: string,
    unit: string,
    value: number,
    step: number,
    onSet: (n: number) => void,
    title?: string,
  ) => (
    <label className="ad-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onSet(n);
        }}
      />
      <em>{unit}</em>
    </label>
  );

  return (
    <section className="ad-setup">
      <div className="ad-setup-row">
        <span className="ad-setup-title">גודל האלבום</span>
        <div className="ad-presets">
          {SIZE_PRESETS.map((g) => (
            <div className="ad-preset-group" key={g.group}>
              <span className="ad-preset-label">{g.group}</span>
              {g.items.map((it) => {
                const on = spec.wcm === it.wcm && spec.hcm === it.hcm;
                return (
                  <button
                    key={it.label}
                    className={`ad-chip${on ? ' on' : ''}`}
                    onClick={() => onChange({ wcm: it.wcm, hcm: it.hcm })}
                  >
                    {it.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="ad-setup-row">
        {num('רוחב עמוד', 'ס״מ', spec.wcm, 0.5, (n) => onChange({ wcm: n }))}
        {num('גובה עמוד', 'ס״מ', spec.hcm, 0.5, (n) => onChange({ hcm: n }))}
        <span className="ad-sep" />
        {num('חריגה', 'מ״מ', spec.bleedMm, 1, (n) => onChange({ bleedMm: n }),
          'כמה התמונה חורגת מעבר לקו החיתוך')}
        {num('תחום שקט', 'מ״מ', spec.safeMm, 1, (n) => onChange({ safeMm: n }),
          'פרט קריטי חייב להישאר בתוכו')}
        {num('חריץ', 'מ״מ', spec.gutterMm, 1, (n) => onChange({ gutterMm: n }),
          'כמה נבלע בכריכה משני צדי הקיפול')}
        <span className="ad-sep" />
        {num('עמודים שנמכרו', '', spec.targetPages, 2, (n) => onChange({ targetPages: n }))}

        <span className={`ad-pagecount is-${state}`}>
          {pages} עמודים כרגע
          {state === 'short' && ` · חסרים ${spec.targetPages - pages}`}
          {state === 'over' && ` · ${pages - spec.targetPages} מעבר`}
          {state === 'match' && ' · תואם'}
        </span>

        <button className="ad-ghost ad-setup-close" onClick={onClose}>סגור</button>
      </div>
    </section>
  );
}
