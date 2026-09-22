/* עריכה — the photograph edited in place, laid out the way the Windows Photos
 * editor is: the tools along the top (חיתוך · התאמה · סנן · סימון · מחק ·
 * רקע), the picture in the middle, the controls of the chosen tool in a panel
 * at the side, "שמור" and "ביטול" in the corner.
 *
 * Nothing here is a second editing system. Every control writes a step of the
 * project's own recipe on THIS photograph's layer (store.setFrameStep), so an
 * edit made here is the same edit the editing stage shows and the export
 * delivers. The picture is the engine's render of that recipe.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderRecipeAtPath, Superseded, thumbUrl } from '../../api';
import type { Frame } from '../../api';
import { effectiveRecipe, setFrameStep } from '../../studio/store';
import type { ToolInstance } from '../../types';
import { defaultParams, getTool } from '../../toolRegistry';
import './photo-editor.css';

export type EditorTab = 'crop' | 'adjust' | 'filter' | 'markup' | 'erase' | 'background';

const TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'crop', label: 'חיתוך', icon: <IconCrop /> },
  { id: 'adjust', label: 'התאמה', icon: <IconSun /> },
  { id: 'filter', label: 'סנן', icon: <IconFilter /> },
  { id: 'markup', label: 'סימון', icon: <IconPen /> },
  { id: 'erase', label: 'מחק', icon: <IconEraser /> },
  { id: 'background', label: 'רקע', icon: <IconBackground /> },
];

/* ---- התאמה: each slider is one parameter of an existing engine tool. */
interface Control {
  id: string;
  label: string;
  icon: React.ReactNode;
  tool: string;
  param: string;
  min: number;
  max: number;
}

const ADJUST: { title: string; controls: Control[] }[] = [
  {
    title: 'בהיר',
    controls: [
      // Brightness moves the middle of the tone curve — the ends stay put,
      // which is what a brightness control does and exposure does not.
      { id: 'brightness', label: 'בהירות', icon: <IconSun />, tool: 'curves', param: 'lumaMids', min: -100, max: 100 },
      { id: 'exposure', label: 'חשיפה', icon: <IconExposure />, tool: 'tone-color', param: 'exposure', min: -100, max: 100 },
      { id: 'contrast', label: 'ניגודיות', icon: <IconContrast />, tool: 'tone-color', param: 'contrast', min: -100, max: 100 },
      { id: 'highlights', label: 'הבלטות', icon: <IconHighlights />, tool: 'tone-color', param: 'highlights', min: -100, max: 100 },
      { id: 'shadows', label: 'צללים', icon: <IconShadows />, tool: 'tone-color', param: 'shadows', min: -100, max: 100 },
      { id: 'vignette', label: 'וינייטה', icon: <IconVignette />, tool: 'vignette', param: 'amount', min: 0, max: 100 },
    ],
  },
  {
    title: 'צבע',
    controls: [
      { id: 'saturation', label: 'רוויה', icon: <IconDrop />, tool: 'tone-color', param: 'saturation', min: -100, max: 100 },
      { id: 'temperature', label: 'חום', icon: <IconThermo />, tool: 'tone-color', param: 'temperature', min: -100, max: 100 },
      { id: 'tint', label: 'גוון', icon: <IconDrop />, tool: 'tone-color', param: 'tint', min: -100, max: 100 },
      { id: 'sharpen', label: 'חדות', icon: <IconDiamond />, tool: 'sharpen', param: 'amount', min: 0, max: 100 },
    ],
  },
];

/** The draft: per tool, the params this session has set. */
type Draft = Record<string, Record<string, number>>;

export default function PhotoEditor({
  projectId,
  frame,
  name,
  onClose,
}: {
  projectId: string;
  frame: Frame;
  name: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<EditorTab>('adjust');
  const [draft, setDraft] = useState<Draft>({});
  const [image, setImage] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  // What the frame renders through now — the starting point of every slider.
  const saved = useMemo(() => effectiveRecipe(projectId, name).filter((t) => t.enabled), [projectId, name]);

  const stepFor = useCallback((toolId: string, params: Record<string, number>): ToolInstance => {
    const current = saved.find((t) => t.toolId === toolId);
    const base = current?.params ?? defaultParams(getTool(toolId));
    return { ...(current ?? {}), toolId, enabled: true, params: { ...base, ...params } };
  }, [saved]);

  const recipe = useMemo(() => {
    const touched = Object.keys(draft);
    const kept = saved.filter((t) => !touched.includes(t.toolId));
    return [...kept, ...touched.map((id) => stepFor(id, draft[id]))];
  }, [draft, saved, stepFor]);

  const valueOf = useCallback((c: Control) => {
    const d = draft[c.tool]?.[c.param];
    if (typeof d === 'number') return d;
    const s = saved.find((t) => t.toolId === c.tool)?.params[c.param];
    return typeof s === 'number' ? Math.max(c.min, Math.min(c.max, s)) : 0;
  }, [draft, saved]);

  const setValue = useCallback((c: Control, v: number) => {
    setDraft((prev) => ({ ...prev, [c.tool]: { ...(prev[c.tool] ?? {}), [c.param]: v } }));
  }, []);

  /* ---- the picture: the engine's render of the recipe, sized to the screen.
   * The last finished render stays up while the next is made — no flash. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const width = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth * (window.devicePixelRatio || 1) : 1600;
    return Math.min(2400, Math.max(1200, Math.round(w * 0.7)));
  }, []);

  useEffect(() => {
    let alive = true;
    renderRecipeAtPath(frame.path, saved, width)
      .then((r) => { if (alive) { setBefore(r.image); setImage((cur) => cur ?? r.image); } })
      .catch((e) => { if (alive && !(e instanceof Superseded)) setFault(e instanceof Error ? e.message : 'הרינדור נכשל'); });
    return () => { alive = false; };
  }, [frame.path, saved, width]);

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!Object.keys(draft).length) return undefined;
    window.clearTimeout(timer.current);
    let alive = true;
    timer.current = window.setTimeout(() => {
      setBusy(true);
      renderRecipeAtPath(frame.path, recipe, width, false, 'ws-editor')
        .then((r) => { if (alive) { setImage(r.image); setFault(null); } })
        .catch((e) => { if (alive && !(e instanceof Superseded)) setFault(e instanceof Error ? e.message : 'הרינדור נכשל'); })
        .finally(() => { if (alive) setBusy(false); });
    }, 90);
    return () => { alive = false; window.clearTimeout(timer.current); };
  }, [draft, frame.path, recipe, width]);

  const dirty = Object.keys(draft).length > 0;

  const save = useCallback(() => {
    for (const toolId of Object.keys(draft)) setFrameStep(projectId, name, stepFor(toolId, draft[toolId]));
    onClose();
  }, [draft, name, onClose, projectId, stepFor]);

  const cancel = useCallback(() => {
    if (dirty && !window.confirm('לצאת בלי לשמור את השינויים?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); e.stopImmediatePropagation(); save(); }
    };
    // Capture: the screens underneath must not see these keys while editing.
    window.addEventListener('keydown', onKey, true);
    const swallow = (e: KeyboardEvent) => { if (!(e.target as HTMLElement)?.closest?.('.tz-pe')) e.stopImmediatePropagation(); };
    window.addEventListener('keydown', swallow, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keydown', swallow, true); };
  }, [cancel, save]);

  const shown = showBefore ? before : image;

  return (
    <div className="tz-pe" dir="rtl" role="dialog" aria-modal="true" aria-label="עריכת תמונה">
      <header className="tz-pe-top">
        <div className="tz-pe-top-side">
          <span className="tz-pe-name" dir="ltr">{name}</span>
        </div>
        <nav className="tz-pe-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tz-pe-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tz-pe-tab-icon" aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="tz-pe-top-side is-end">
          <button type="button" className="tz-pe-btn" onClick={cancel}>ביטול</button>
          <button type="button" className="tz-pe-btn is-primary" onClick={save} disabled={!dirty}>שמור</button>
        </div>
      </header>

      <div className="tz-pe-body">
        <main className="tz-pe-stage" ref={stageRef}>
          {shown ? (
            <img src={shown} alt={name} draggable={false} />
          ) : (
            <img src={thumbUrl(frame.path, 1600)} alt={name} draggable={false} className="is-waiting" />
          )}
          {busy && <span className="tz-pe-busy" aria-label="מעבד" />}
          {fault && <p className="tz-pe-fault">לא ניתן להציג את העריכה: {fault}</p>}
          {dirty && before && (
            <button
              type="button"
              className={`tz-pe-before${showBefore ? ' is-on' : ''}`}
              onPointerDown={() => setShowBefore(true)}
              onPointerUp={() => setShowBefore(false)}
              onPointerLeave={() => setShowBefore(false)}
              title="לחץ והחזק כדי לראות לפני"
            >
              לפני
            </button>
          )}
        </main>

        <aside className="tz-pe-panel">
          {tab === 'adjust' && ADJUST.map((sec) => (
            <section key={sec.title} className="tz-pe-sec">
              <h3>{sec.title}</h3>
              {sec.controls.map((c) => (
                <Slider key={c.id} control={c} value={valueOf(c)} onChange={(v) => setValue(c, v)} />
              ))}
            </section>
          ))}
          {tab !== 'adjust' && (
            <p className="tz-pe-soon">הלשונית הזו נבנית עכשיו.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Slider({ control, value, onChange }: { control: Control; value: number; onChange: (v: number) => void }) {
  const zero = control.min < 0 ? 0 : control.min;
  const pct = ((value - control.min) / (control.max - control.min)) * 100;
  const zeroPct = ((zero - control.min) / (control.max - control.min)) * 100;
  return (
    <label className="tz-pe-slider" onDoubleClick={() => onChange(zero)} title="לחיצה כפולה מאפסת">
      <span className="tz-pe-slider-head">
        <span className="tz-pe-slider-icon" aria-hidden>{control.icon}</span>
        <span className="tz-pe-slider-label">{control.label}</span>
        <output>{Math.round(value)}</output>
      </span>
      <span className="tz-pe-range" dir="ltr">
        <i
          className="tz-pe-range-fill"
          style={{ left: `${Math.min(pct, zeroPct)}%`, width: `${Math.abs(pct - zeroPct)}%` }}
        />
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={control.label}
        />
      </span>
    </label>
  );
}

/* ---- icons: thin line drawings, currentColor, 18px */
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconCrop() { return <Svg><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></Svg>; }
function IconSun() { return <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>; }
function IconFilter() { return <Svg><path d="M9 3h6v4l-1 2v10a2 2 0 0 1-4 0V9L9 7z" /><path d="M9 7h6" /></Svg>; }
function IconPen() { return <Svg><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /><path d="M14 20h6" /></Svg>; }
function IconEraser() { return <Svg><path d="M7 21h10" /><path d="M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z" /><path d="M9 11l4 4" /></Svg>; }
function IconBackground() { return <Svg><path d="M3 9l6-6M3 15L15 3M3 21L21 3M9 21l12-12M15 21l6-6" /></Svg>; }
function IconExposure() { return <Svg><circle cx="12" cy="12" r="9" /><path d="M5.6 18.4L18.4 5.6" /><path d="M8 8.5h3M9.5 7v3M13.5 15.5h3" /></Svg>; }
function IconContrast() { return <Svg><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></Svg>; }
function IconHighlights() { return <Svg><circle cx="12" cy="12" r="9" /><path d="M7 7l2 2M12 5v3M17 7l-2 2" /></Svg>; }
function IconShadows() { return <Svg><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18" /><path d="M14 7h4M14 11h6M14 15h5" /></Svg>; }
function IconVignette() { return <Svg><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="12" r="5" /></Svg>; }
function IconDrop() { return <Svg><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" /></Svg>; }
function IconThermo() { return <Svg><path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z" /></Svg>; }
function IconDiamond() { return <Svg><path d="M6 3h12l3 6-9 12L3 9z" /><path d="M3 9h18M12 21L8 9l4-6 4 6z" /></Svg>; }
