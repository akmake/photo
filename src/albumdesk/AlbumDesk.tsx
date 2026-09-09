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
 * מה שאין כאן בכוונה: פריסה אוטומטית. הצלם ביקש שהוא יניח, ושהמכונה תעזור
 * ולא תחליט. העזרה תיכנס בהמשך כאזהרות (פנים על הקיפול, תמונה כפולה) —
 * לא כהחלטה במקומו.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Frame } from '../api';
import { thumbUrl } from '../api';
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
import './albumdesk.css';

/* יחס העמוד. 1 = ריבועי, שהוא הנפוץ באלבומי חתונה. הכפולה היא פי שניים. */
const PAGE_RATIO = 1;

/* גובה אזור הסכנה של החריץ, כשבר מרוחב העמוד. פנים שנופלות כאן נבלעות
 * בכריכה. מסומן בקו שיער בלבד — סימון לא מכסה תוכן. */
const GUTTER = 0.045;

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

  /* איזה פריים שייך לאיזה מקבץ. נבנה פעם אחת ומשמש גם את המגש וגם את
   * שורת המקבצים. */
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
    if (saved) return saved;
    return { projectId: project.id, spreads: [newSpread()] };
  });

  useEffect(() => {
    const saved = loadDoc(project.id);
    setDoc(saved ?? { projectId: project.id, spreads: [newSpread()] });
    setAt(0);
    setSel(null);
  }, [project.id]);

  useEffect(() => {
    saveDoc(doc);
  }, [doc]);

  const [at, setAt] = useState(0);
  const spread = doc.spreads[Math.min(at, doc.spreads.length - 1)];

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
  const [sel, setSel] = useState<SlotRef | null>(null);

  const mutate = useCallback(
    (fn: (d: AlbumDoc) => void) => {
      setDoc((prev) => {
        const next: AlbumDoc = JSON.parse(JSON.stringify(prev));
        fn(next);
        return next;
      });
    },
    [],
  );

  const pageAt = (d: AlbumDoc, ref: SlotRef): Page => d.spreads[ref.spread][ref.side];

  const setTemplate = (side: PageSide, templateId: string) => {
    mutate((d) => {
      const page = d.spreads[at][side];
      const t = templateById(templateId);
      const kept = page.slots.filter(Boolean) as Placement[];
      page.templateId = templateId;
      /* התמונות שכבר הונחו נשמרות ונכנסות למשבצות החדשות לפי הסדר. החלפת
       * תבנית היא שינוי סידור, לא מחיקה — מי שמדפדף בין וריאציות לא אמור
       * לאבד את מה שהניח. */
      page.slots = t.slots.map((_, i) => kept[i] ?? null);
    });
    setSel(null);
  };

  const dropOn = (ref: SlotRef, payload: DragPayload) => {
    mutate((d) => {
      const target = pageAt(d, ref);
      const incoming = target.slots[ref.slot];
      if (payload.from) {
        /* גרירה ממשבצת למשבצת = החלפת מקומות. זו פעולה שנעשית כל הזמן,
         * ולכן היא הגרירה עצמה ולא תפריט. */
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

  const nudge = (ref: SlotRef, dx: number, dy: number) => {
    mutate((d) => {
      const s = pageAt(d, ref).slots[ref.slot];
      if (!s) return;
      s.fx = Math.max(0, Math.min(100, s.fx + dx));
      s.fy = Math.max(0, Math.min(100, s.fy + dy));
    });
  };

  const zoomBy = (ref: SlotRef, d: number) => {
    mutate((doc2) => {
      const s = pageAt(doc2, ref).slots[ref.slot];
      if (!s) return;
      s.zoom = Math.max(1, Math.min(3, +(s.zoom + d).toFixed(2)));
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

  /* מקלדת: מחיקה על משבצת נבחרת, וחיצים לכוונון עדין של החיתוך. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearSlot(sel);
      } else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(sel, 2, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(sel, -2, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(sel, 0, 2); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(sel, 0, -2); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(sel, 0.1); }
      else if (e.key === '-') { e.preventDefault(); zoomBy(sel, -0.1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const addSpread = () => {
    mutate((d) => {
      d.spreads.splice(at + 1, 0, newSpread());
    });
    setAt((n) => n + 1);
    setSel(null);
  };

  const removeSpread = () => {
    if (doc.spreads.length <= 1) return;
    mutate((d) => {
      d.spreads.splice(at, 1);
    });
    setAt((n) => Math.max(0, n - 1));
    setSel(null);
  };

  /* ------------------------------------------------------------------- rendering */

  if (readFailed) {
    return (
      <div className="ad-fail">
        <h2>לא ניתן לקרוא את תמונות הפרויקט</h2>
        <p>המנוע לא ענה, או שהתיקייה אינה זמינה. אין כאן אלבום ריק — יש קריאה שנכשלה.</p>
        {onBack && <button className="btn" onClick={onBack}>חזרה</button>}
      </div>
    );
  }

  if (!frames) return <div className="ad-wait">טוען את תמונות הפרויקט…</div>;

  if (frames.length === 0) {
    return (
      <div className="ad-fail">
        <h2>אין עדיין תמונות בפרויקט הזה</h2>
        <p>אחרי הייבוא אפשר להרכיב אלבום מהתמונות של {project.client}.</p>
        {onBack && <button className="btn" onClick={onBack}>חזרה</button>}
      </div>
    );
  }

  const remaining = frames.filter((f) => !used.has(f.name)).length;

  return (
    <div className="ad">
      {/* ---------------------------------------------------------- top bar */}
      <header className="ad-bar">
        <div className="ad-bar-side">
          {onBack && (
            <button className="ad-ghost" onClick={onBack}>← חזרה</button>
          )}
          <span className="ad-client">{project.client}</span>
        </div>

        <div className="ad-nav">
          <button
            className="ad-ghost"
            disabled={at === 0}
            onClick={() => { setAt((n) => Math.max(0, n - 1)); setSel(null); }}
          >
            הקודמת
          </button>
          <span className="ad-count">כפולה {at + 1} מתוך {doc.spreads.length}</span>
          <button
            className="ad-ghost"
            disabled={at >= doc.spreads.length - 1}
            onClick={() => { setAt((n) => Math.min(doc.spreads.length - 1, n + 1)); setSel(null); }}
          >
            הבאה
          </button>
        </div>

        <div className="ad-bar-side ad-bar-end">
          <button className="ad-ghost" onClick={addSpread}>+ כפולה</button>
          <button className="ad-ghost" onClick={removeSpread} disabled={doc.spreads.length <= 1}>
            מחק כפולה
          </button>
        </div>
      </header>

      <div className="ad-body">
        {/* ------------------------------------------------------- the tray */}
        <aside className="ad-tray">
          <div className="ad-tray-head">
            <strong>המגש</strong>
            <span className="ad-remaining">{remaining} עוד לא בשימוש</span>
          </div>

          {/* המקבצים. זו הדרך שבה הצלם באמת מחפש: "התמונות של הרכבת". */}
          <div className="ad-batches">
            <button
              className={`ad-chip${trayBatch === 'all' ? ' on' : ''}`}
              onClick={() => setTrayBatch('all')}
            >
              הכול
            </button>
            {batches.map((b) => (
              <button
                key={b.id}
                className={`ad-chip${trayBatch === b.id ? ' on' : ''}`}
                onClick={() => setTrayBatch(b.id)}
              >
                {b.name}
                <span className="ad-chip-n">{(byBatch.get(b.id) ?? []).length}</span>
              </button>
            ))}
            {loose.length > 0 && (
              <button
                className={`ad-chip${trayBatch === 'loose' ? ' on' : ''}`}
                onClick={() => setTrayBatch('loose')}
              >
                ללא מקבץ
                <span className="ad-chip-n">{loose.length}</span>
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
              const at2 = whereUsed(doc, f.name);
              return (
                <div
                  key={f.name}
                  className={`ad-thumb${at2 ? ' is-used' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    const payload: DragPayload = { frame: f.name, path: f.shown, from: null };
                    e.dataTransfer.setData('application/json', JSON.stringify(payload));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={at2 ? `${f.name} — כבר בכפולה ${at2}` : f.name}
                >
                  <img src={thumbUrl(f.shown, 240)} alt="" loading="lazy" draggable={false} />
                  {at2 && <span className="ad-usedtag">כפולה {at2}</span>}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ----------------------------------------------------- the spread */}
        <main className="ad-stage">
          <div className="ad-spread" style={{ aspectRatio: String(2 * PAGE_RATIO) }}>
            {/* בכריכה עברית הספר נפתח מימין, ולכן העמוד הראשון הוא הימני.
              * המכולה היא rtl, ולכן `first` בקוד יושב מימין על המסך. */}
            <PageView
              page={spread.first}
              side="first"
              spreadIndex={at}
              sel={sel}
              onSelect={setSel}
              onDrop={dropOn}
              onNudge={nudge}
              onZoom={zoomBy}
            />
            <PageView
              page={spread.second}
              side="second"
              spreadIndex={at}
              sel={sel}
              onSelect={setSel}
              onDrop={dropOn}
              onNudge={nudge}
              onZoom={zoomBy}
            />

            {/* הקיפול. קו שיער בלבד, ורצועת הסכנה משני צדיו — סימון לא
              * מכסה תוכן, הוא רק אומר איפה הכריכה תבלע פנים. */}
            <div className="ad-fold" aria-hidden>
              <span className="ad-fold-line" />
              <span className="ad-fold-zone" style={{ width: `${GUTTER * 100}%` }} />
            </div>
          </div>

          {/* פקדי המשבצת הנבחרת. קיימים רק כשיש מה לכוונן. */}
          {sel && (
            <div className="ad-slotbar">
              <span className="ad-slotbar-title">חיתוך בתוך המסגרת</span>
              <button className="ad-ghost" onClick={() => zoomBy(sel, -0.1)}>−</button>
              <span className="ad-zoom">
                {Math.round(
                  ((doc.spreads[sel.spread][sel.side].slots[sel.slot]?.zoom ?? 1) as number) * 100,
                )}%
              </span>
              <button className="ad-ghost" onClick={() => zoomBy(sel, 0.1)}>+</button>
              <button className="ad-ghost" onClick={() => resetSlot(sel)}>אפס</button>
              <button className="ad-ghost ad-danger" onClick={() => clearSlot(sel)}>הסר תמונה</button>
              <span className="ad-hint">גרירה בתוך המסגרת מזיזה · גלגלת מקרבת · חיצים לכוונון עדין</span>
            </div>
          )}

          {/* התבניות. לכל עמוד בנפרד, כפי שביקשת — מסודרות לפי מספר
            * תמונות, כי ככה מחפשים אותן: "יש לי שלוש לכפולה הזאת". */}
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
    </div>
  );
}

/* --------------------------------------------------------------------- a page */

function PageView({
  page,
  side,
  spreadIndex,
  sel,
  onSelect,
  onDrop,
  onNudge,
  onZoom,
}: {
  page: Page;
  side: PageSide;
  spreadIndex: number;
  sel: SlotRef | null;
  onSelect: (r: SlotRef) => void;
  onDrop: (r: SlotRef, p: DragPayload) => void;
  onNudge: (r: SlotRef, dx: number, dy: number) => void;
  onZoom: (r: SlotRef, d: number) => void;
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
          />
        );
      })}
      {t.slots.length === 0 && <span className="ad-blank">עמוד ריק</span>}
    </div>
  );
}

/* --------------------------------------------------------------------- a slot
 *
 * זהו המקום שבו נעשית הפעולה השכיחה ביותר באלבום: הזזת התמונה בתוך
 * המסגרת. לכן היא מחווה אחת ישירה על הקנבס — גרירה — ולא דיאלוג.
 *
 * המימוש: `background-size: cover` נותן את המילוי, `background-position`
 * את נקודת המיקוד, ו-`transform-origin` מוצמד לאותה נקודה כך שהזום מתרחש
 * *סביבה*. מה שכיוונת אליו נשאר במקום כשמקרבים.
 */
function Slot({
  rect,
  refr,
  placement,
  selected,
  onSelect,
  onDrop,
  onNudge,
  onZoom,
}: {
  rect: Rect;
  refr: SlotRef;
  placement: Placement | null;
  selected: boolean;
  onSelect: (r: SlotRef) => void;
  onDrop: (r: SlotRef, p: DragPayload) => void;
  onNudge: (r: SlotRef, dx: number, dy: number) => void;
  onZoom: (r: SlotRef, d: number) => void;
}) {
  const [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const style: React.CSSProperties = {
    insetInlineStart: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };

  const onPointerDown = (e: React.PointerEvent) => {
    onSelect(refr);
    if (!placement) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !placement || !box.current) return;
    const w = box.current.clientWidth || 1;
    const h = box.current.clientHeight || 1;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    /* גרירה ימינה מזיזה את התמונה ימינה, כלומר חושפת יותר משמאל —
     * ולכן נקודת המיקוד זזה בכיוון ההפוך. */
    onNudge(refr, (-dx / w) * 100, (-dy / h) * 100);
  };

  const endDrag = () => { drag.current = null; };

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
      draggable={!!placement}
      onDragStart={(e) => {
        if (!placement) return;
        const payload: DragPayload = {
          frame: placement.frame,
          path: placement.path,
          from: refr,
        };
        e.dataTransfer.setData('application/json', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        try {
          const p = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
          if (p && p.frame) onDrop(refr, p);
        } catch {
          /* גרירה ממקור שאינו המגש. מתעלמים בשקט. */
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
        <div
          className="ad-img"
          style={{
            backgroundImage: `url("${thumbUrl(placement.path, 1200)}")`,
            backgroundPosition: `${placement.fx}% ${placement.fy}%`,
            transform: `scale(${placement.zoom})`,
            transformOrigin: `${placement.fx}% ${placement.fy}%`,
          }}
        />
      ) : (
        <span className="ad-slot-hint">גרור תמונה</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- templates */

function TemplateRow({
  label,
  current,
  onPick,
}: {
  label: string;
  current: string;
  onPick: (id: string) => void;
}) {
  const groups = templatesByCount();
  return (
    <div className="ad-trow">
      <span className="ad-trow-label">{label}</span>
      <div className="ad-trow-items">
        {groups.map((g) => (
          <div className="ad-tgroup" key={g.count}>
            <span className="ad-tgroup-n">{g.count === 0 ? 'ריק' : g.count}</span>
            {g.items.map((t) => (
              <button
                key={t.id}
                className={`ad-tmini${current === t.id ? ' on' : ''}`}
                title={t.label}
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
