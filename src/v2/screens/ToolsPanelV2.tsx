/* The tools panel, built the way a photographer's workbench is built.
 *
 * WHAT CHANGED AND WHY. The panel used to be five hand-written accordions,
 * one per category, each with its sliders typed out by hand. Two costs: a tool
 * added to the catalogue did not appear here until someone remembered to type
 * it in (the manual brush was invisible for exactly that reason), and the
 * screen said nothing about the ORDER the engine works in, so "why did my
 * sharpening change after I moved the colour" had no answer on screen.
 *
 * This panel is built from the catalogue itself, in the engine's own order.
 * Adding a tool anywhere in the product puts it here, in the right place,
 * with its real name and its real controls.
 *
 * ONE TOOL AT A TIME vs ALL OF THEM: the set workbench was deliberately built
 * the first way, and this is the second. The reason is that a photographer
 * correcting one frame does not want a ceremony per slider — Lightroom and
 * Capture One are what their hands know. What the old way protected — "this
 * part is finished, leave it" — is kept by giving every tool its own switch,
 * its own reset, and a dot when it differs from the set.
 *
 * HEAVY TOOLS DO NOT RECOMPUTE MID-DRAG. Skin work, sculpting and background
 * blur run a network per render. Those commit when the slider is RELEASED, so
 * dragging stays smooth and the engine is asked once. Everything else commits
 * as it moves, because it is cheap and the eye wants it live.
 */
import React, { useCallback, useMemo, useState } from 'react';

import type { ToolDef, ToolInstance, ToolMask } from '../../types';
import { MASK_REGIONS, TOOLS, defaultParams, isMaskable, isToolAtDefault } from '../../toolRegistry';

/** The sections, in the order the engine runs them. Names are what a
 *  photographer calls these stages, not what the code calls them. */
const SECTIONS: { id: string; title: string; cats: string[]; icon: React.ReactNode }[] = [
  { id: 'retouch', title: 'ריטוש', cats: ['local-ai'], icon: <IconFace /> },
  { id: 'light', title: 'אור וצבע', cats: ['tone-color', 'raw'], icon: <IconSun /> },
  { id: 'scene', title: 'סצנה', cats: ['scene'], icon: <IconScene /> },
  { id: 'style', title: 'סגנון', cats: ['artistic'], icon: <IconPalette /> },
];

/* The same thin line icons as the work stage's editor (PhotoEditor.tsx). */
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
function IconFace() { return <Svg><circle cx="12" cy="12" r="9" /><path d="M9 10h.01M15 10h.01" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /></Svg>; }
function IconSun() { return <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>; }
function IconScene() { return <Svg><path d="M3 20l6-9 4 6 3-4 5 7z" /><circle cx="16" cy="6" r="2" /></Svg>; }
function IconPalette() { return <Svg><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7" r="1" /></Svg>; }

/** Tools whose render costs a network pass: commit on release, not per pixel
 *  of slider travel. */
const HEAVY = new Set([
  'skin-retouch', 'skin-cleanup', 'manual-clean', 'contour', 'blush',
  'eye-sparkle', 'hair-tones', 'background-blur', 'face-retouch', 'skin',
]);

/** Driven from the canvas, not from here — it has no sliders of its own. */
const BRUSH_TOOL = 'manual-clean';

/** The hand-drawn region. Its chip does not only set a value — it opens the
 *  brush on the photograph, because a painted mask with nothing painted on it
 *  is a tool switched off. */
const PAINTED = 'painted';

type Props = {
  /** What this frame actually renders with, defaults included. */
  tools: ToolInstance[];
  onParam: (toolId: string, paramId: string, value: number) => void;
  onToggle: (toolId: string, enabled: boolean) => void;
  onReset: (toolId: string) => void;
  /** Opens the painting layer on the photo. */
  onOpenBrush: () => void;
  brushOn: boolean;
  brushStrokes: number;
  /** WHERE EACH TOOL LANDS. `null` clears the mask — the tool goes back to the
   *  whole frame, which is the state with no mask at all rather than a mask
   *  that happens to cover everything. */
  onMask: (toolId: string, mask: ToolMask | null) => void;
  /** Opens the brush on the photograph for THIS tool's painted region. The
   *  same brush as the cleaning one; what it writes into is the difference. */
  onPaintMask: (toolId: string) => void;
  /** Which tool's mask is being painted right now, if any. */
  paintingMask: string | null;
  /** Strokes already painted per tool, for the count on screen. */
  maskStrokes: Record<string, number>;
  /** Whether the frame on screen is still sensor data. Decides whether the
   *  develop step is offered at all — see `rawOnly`. */
  isRaw?: boolean;
  /** The cleaning brush's actions on this frame, oldest first — each one can
   *  be taken back on its own instead of undoing everything after it. */
  brushActions?: { id: string }[];
  onDeleteAction?: (id: string) => void;
  /** The action under the pointer in the list, shown on the photograph. */
  onHoverAction?: (id: string | null) => void;
  objectMode?: 'select' | 'add' | 'subtract' | null;
  objectSelected?: boolean;
  objectBusy?: boolean;
  objectError?: string | null;
  onObjectMode?: (mode: 'select' | 'add' | 'subtract' | null) => void;
  onObjectApply?: () => void;
  onObjectClear?: () => void;
};

export default function ToolsPanelV2({
  tools, onParam, onToggle, onReset, onOpenBrush, brushOn, brushStrokes,
  onMask, onPaintMask, paintingMask, maskStrokes, isRaw = false,
  brushActions = [], onDeleteAction, onHoverAction,
  objectMode = null, objectSelected = false, objectBusy = false, objectError = null,
  onObjectMode, onObjectApply, onObjectClear,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // One stage of the work at a time, the way the Photos editor shows a tab.
  const [tab, setTab] = useState<string>(() => {
    try { return localStorage.getItem('tz-tp-tab') || 'light'; } catch { return 'light'; }
  });
  /* A value being dragged on a heavy tool. It is what the slider shows until
   * the finger comes off, and only then does it become the recipe. */
  const [draft, setDraft] = useState<Record<string, number>>({});

  const instOf = useCallback(
    (id: string) => tools.find((t) => t.toolId === id),
    [tools],
  );

  /** A retired tool is offered to nobody, but a frame that still CARRIES one
   *  has to keep showing it — otherwise a photograph renders with a tool the
   *  screen swears is not there. */
  const visible = useMemo(() => {
    const shown = TOOLS.filter((def) => {
      if (def.id === 'pixel-color') return false;      // a fitted look, not sliders
      // The develop step reaches the decoder, and a JPEG has already been
      // through one. Shown anyway if THIS frame carries it with a value: a
      // recipe made on the raw set and applied to a JPEG must not go silently
      // invisible while it is still in the recipe.
      if (def.rawOnly && !isRaw) {
        const inst = instOf(def.id);
        if (!inst || !inst.enabled || isToolAtDefault(inst)) return false;
      }
      if (!def.legacy) return true;
      const inst = instOf(def.id);
      return Boolean(inst && inst.enabled && !isToolAtDefault(inst));
    });
    return shown.sort((a, b) => a.order - b.order);
  }, [instOf, isRaw]);

  const sections = SECTIONS
    .map((s) => ({ ...s, defs: visible.filter((d) => s.cats.includes(d.category)) }))
    .filter((s) => s.defs.length > 0);
  const current = sections.find((s) => s.id === tab) ?? sections[0];
  const pickTab = (id: string) => {
    setTab(id);
    try { localStorage.setItem('tz-tp-tab', id); } catch { /* per-viewer only */ }
  };
  // How many tools in each tab are doing something on this frame.
  const activeIn = (defs: ToolDef[]) => defs.filter((d) => {
    const inst = instOf(d.id);
    return Boolean(inst?.enabled && !isToolAtDefault(inst));
  }).length;

  const valueOf = (def: ToolDef, paramId: string, fallback: number) => {
    const key = `${def.id}.${paramId}`;
    if (key in draft) return draft[key];
    const v = instOf(def.id)?.params?.[paramId];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };

  const commit = (def: ToolDef, paramId: string) => {
    const key = `${def.id}.${paramId}`;
    if (!(key in draft)) return;
    const v = draft[key];
    setDraft((d) => {
      const { [key]: _gone, ...rest } = d;
      return rest;
    });
    onParam(def.id, paramId, v);
  };

  const change = (def: ToolDef, paramId: string, v: number) => {
    if (HEAVY.has(def.id)) setDraft((d) => ({ ...d, [`${def.id}.${paramId}`]: v }));
    else onParam(def.id, paramId, v);
  };

  return (
    <div className="tz-tp">
      <nav className="tz-tp-tabs" role="tablist" aria-label="שלבי העריכה">
        {sections.map((s) => {
          const n = activeIn(s.defs);
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={current?.id === s.id}
              className={`tz-tp-tab${current?.id === s.id ? ' is-on' : ''}`}
              onClick={() => pickTab(s.id)}
            >
              <span className="tz-tp-tab-icon">{s.icon}</span>
              <span>{s.title}</span>
              {n > 0 && <i className="tz-tp-tab-n" title={`${n} כלים פעילים`}>{n}</i>}
            </button>
          );
        })}
      </nav>

      <div className="tz-tp-modules">
        {current && [current].map((s) => (
          <React.Fragment key={s.id}>
            {s.defs.filter((def) => def.id !== BRUSH_TOOL).map((def) => {
              const inst = instOf(def.id);
              const on = Boolean(inst?.enabled);
              const isOpen = open[def.id] ?? false;
              const changed = Boolean(inst && !isToolAtDefault(inst));
              const brush = def.id === BRUSH_TOOL;
              return (
                <section
                  key={def.id}
                  className={`tz-tp-mod ${isOpen ? '' : 'closed'} ${on ? '' : 'off'}`}
                >
                  <header className="tz-tp-head">
                    <button
                      type="button"
                      className="tz-tp-name"
                      onClick={() => setOpen((o) => ({ ...o, [def.id]: !isOpen }))}
                      aria-expanded={isOpen}
                    >
                      <span className="tz-tp-chev">⌄</span>
                      <span>{def.label}</span>
                      {brush && brushStrokes > 0 && (
                        <span className="tz-tp-count">{brushStrokes}</span>
                      )}
                    </button>
                    <span className={`tz-tp-dot ${changed ? '' : 'idle'}`}
                      title={changed ? 'שונה בתמונה הזו' : undefined} />
                    {!brush && def.id !== 'object-remove' && (
                      <button
                        type="button"
                        className="tz-tp-icon"
                        title="החזר לברירת המחדל"
                        onClick={() => onReset(def.id)}
                      >
                        ↺
                      </button>
                    )}
                    {def.id !== 'object-remove' && <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      className="tz-tp-switch"
                      title={on ? 'כבה' : 'הפעל'}
                      onClick={() => onToggle(def.id, !on)}
                    />}
                  </header>

                  {isOpen && (
                    <div className="tz-tp-body">
                      {def.id === 'object-remove' ? (
                        <div className="tz-tp-object">
                          <p className="tz-tp-note">בחרו אובייקט בתמונה, בדקו את המסכה ותקנו אותה לפני ההסרה. השלמת אדם או בעל חיים מוסתר עדיין דורשת בדיקה מקרוב.</p>
                          <button type="button" className="tz-tp-brush" disabled={objectBusy}
                            onClick={() => onObjectMode?.(objectMode === 'select' ? null : 'select')}>
                            {objectMode === 'select' ? 'בטל בחירה' : 'בחר בלחיצה על התמונה'}
                          </button>
                          {objectSelected && <>
                            <div className="tz-tp-mask-chips">
                              <button type="button" className={`tz-tp-chip ${objectMode === 'add' ? 'on' : ''}`}
                                onClick={() => onObjectMode?.(objectMode === 'add' ? null : 'add')}>הוסף למסכה</button>
                              <button type="button" className={`tz-tp-chip ${objectMode === 'subtract' ? 'on' : ''}`}
                                onClick={() => onObjectMode?.(objectMode === 'subtract' ? null : 'subtract')}>החסר מהמסכה</button>
                            </div>
                            <button type="button" className="tz-tp-brush" disabled={objectBusy} onClick={onObjectApply}>הסר אובייקט</button>
                            <button type="button" className="tz-tp-brush sm" onClick={onObjectClear}>נקה בחירה</button>
                          </>}
                          {objectBusy && <p role="status">מזהה אובייקט…</p>}
                          {objectError && <p role="alert">{objectError}</p>}
                        </div>
                      ) : brush ? (
                        <>
                          <p className="tz-tp-note">
                            מציירים על הלכלוך או הריר בתמונה והוא נעלם. גלגלת העכבר משנה
                            את גודל המברשת.
                          </p>
                          <button
                            type="button"
                            className={`tz-tp-brush ${brushOn ? 'active' : ''}`}
                            onClick={onOpenBrush}
                          >
                            {brushOn ? 'סגור את המברשת' : 'פתח את המברשת על התמונה'}
                          </button>
                          {brushActions.length > 0 && (
                            <ol className="tz-tp-actions" onMouseLeave={() => onHoverAction?.(null)}>
                              {brushActions.map((a, i) => (
                                <li key={a.id} onMouseEnter={() => onHoverAction?.(a.id)}>
                                  <span className="tz-tp-action-n">{i + 1}</span>
                                  <span className="tz-tp-action-name">ניקוי {i + 1}</span>
                                  <button
                                    type="button"
                                    className="tz-tp-icon"
                                    title="מחק את הפעולה הזו בלבד"
                                    aria-label={`מחק ניקוי ${i + 1}`}
                                    onClick={() => { onHoverAction?.(null); onDeleteAction?.(a.id); }}
                                  >
                                    ✕
                                  </button>
                                </li>
                              ))}
                            </ol>
                          )}
                        </>
                      ) : (
                        def.params.map((spec) => {
                          const v = valueOf(def, spec.id, spec.default);
                          const isToggle = spec.min === 0 && spec.max === 1 && spec.step === 1;
                          return (
                            <div
                              key={spec.id}
                              className={`tz-tp-row ${v !== spec.default ? 'changed' : ''}${isToggle ? ' is-toggle' : ''}`}
                              style={isToggle ? undefined : {
                                '--tp-from': `${((Math.min(v, spec.min < 0 ? 0 : spec.min) - spec.min) / (spec.max - spec.min)) * 100}%`,
                                '--tp-to': `${((Math.max(v, spec.min < 0 ? 0 : spec.min) - spec.min) / (spec.max - spec.min)) * 100}%`,
                              } as React.CSSProperties}
                            >
                              <label htmlFor={`${def.id}-${spec.id}`}>{spec.label}</label>
                              {isToggle ? (
                                <input
                                  id={`${def.id}-${spec.id}`}
                                  type="checkbox"
                                  checked={v === 1}
                                  onChange={(e) => onParam(def.id, spec.id, e.target.checked ? 1 : 0)}
                                />
                              ) : (
                                <>
                                  <input
                                    className="tz-tp-val"
                                    type="number"
                                    value={v}
                                    min={spec.min}
                                    max={spec.max}
                                    step={spec.step}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (Number.isFinite(n)) onParam(def.id, spec.id, n);
                                    }}
                                  />
                                  <input
                                    id={`${def.id}-${spec.id}`}
                                    type="range"
                                    value={v}
                                    min={spec.min}
                                    max={spec.max}
                                    step={spec.step}
                                    onChange={(e) => change(def, spec.id, Number(e.target.value))}
                                    onPointerUp={() => commit(def, spec.id)}
                                    onKeyUp={() => commit(def, spec.id)}
                                    onBlur={() => commit(def, spec.id)}
                                    /* Back to where it started, the way every
                                     * editor does it. */
                                    onDoubleClick={() => onParam(def.id, spec.id, spec.default)}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                      {!brush && isMaskable(def) && (() => {
                        const mask = inst?.mask;
                        const painting = paintingMask === def.id;
                        const painted = maskStrokes[def.id] ?? 0;
                        /* Changing the region keeps what was painted: he picks
                         * "clothes", looks, goes back to his brush strokes. */
                        const pick = (region: string | null) => {
                          if (!region) return onMask(def.id, null);
                          onMask(def.id, { ...(mask ?? {}), region });
                          if (region === PAINTED) onPaintMask(def.id);
                        };
                        return (
                          <div className="tz-tp-mask">
                            <div className="tz-tp-mask-chips">
                              <span className="tz-tp-mask-lbl">על מה זה חל</span>
                              <button
                                type="button"
                                className={`tz-tp-chip ${mask ? '' : 'on'}`}
                                onClick={() => pick(null)}
                              >
                                כל התמונה
                              </button>
                              {MASK_REGIONS.map((rg) => (
                                <button
                                  key={rg.id}
                                  type="button"
                                  className={`tz-tp-chip ${mask?.region === rg.id ? 'on' : ''}`}
                                  onClick={() => pick(rg.id)}
                                >
                                  {rg.label}
                                  {rg.id === PAINTED && painted > 0 && (
                                    <i className="tz-tp-chip-n">{painted}</i>
                                  )}
                                </button>
                              ))}
                            </div>

                            {mask && (
                              <div className="tz-tp-mask-fine">
                                {mask.region === PAINTED && (
                                  <button
                                    type="button"
                                    className={`tz-tp-brush sm ${painting ? 'active' : ''}`}
                                    onClick={() => onPaintMask(def.id)}
                                  >
                                    {painting ? 'סיימתי לצבוע' : 'צבע על התמונה'}
                                  </button>
                                )}
                                <label className="tz-tp-mask-inv">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(mask.invert)}
                                    onChange={(e) =>
                                      onMask(def.id, { ...mask, invert: e.target.checked })}
                                  />
                                  הכל חוץ מזה
                                </label>
                                <div className="tz-tp-row">
                                  <label htmlFor={`${def.id}-mask-feather`}>ריכוך הקצוות</label>
                                  <input
                                    className="tz-tp-val"
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={mask.feather ?? 0}
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (Number.isFinite(n)) onMask(def.id, { ...mask, feather: n });
                                    }}
                                  />
                                  <input
                                    id={`${def.id}-mask-feather`}
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={mask.feather ?? 0}
                                    onChange={(e) =>
                                      onMask(def.id, { ...mask, feather: Number(e.target.value) })}
                                    onDoubleClick={() => onMask(def.id, { ...mask, feather: 0 })}
                                  />
                                </div>
                              </div>
                            )}

                            {mask?.region === PAINTED && painted === 0 && (
                              <p className="tz-tp-note warn">
                                עוד לא צבעת כלום, ולכן הכלי לא נוגע בתמונה.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {!brush && HEAVY.has(def.id) && (
                        <p className="tz-tp-note">מחושב כשמשחררים את המחוון</p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export { defaultParams };
