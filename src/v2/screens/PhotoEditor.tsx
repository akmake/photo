/* עריכה — the photograph edited in place, laid out the way the Windows Photos
 * editor is: the tools along the top (חיתוך · התאמה · סנן · סימון · מחק ·
 * הסרת אובייקט · רקע), the picture in the middle, the controls of the chosen tool in a panel
 * at the side, "שמור" and "ביטול" in the corner.
 *
 * Nothing here is a second editing system. Every control writes a step of the
 * project's own recipe on THIS photograph's layer (store.setFrameStep), so an
 * edit made here is the same edit the editing stage shows and the export
 * delivers. The picture is the engine's render of that recipe
 * (engine/photo_tools.py for crop, filters, background and markup).
 *
 * Where each tab draws matters. Geometry (crop) runs last in the engine and
 * markup after it, so:
 *   - crop shows the frame WITHOUT geometry and turns it live on screen;
 *   - erase and the background brush paint on the frame without geometry,
 *     because their strokes live in the uncut frame's coordinates;
 *   - markup paints on the cut frame, without the markup render under it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoEnhance, renderRecipeAtPath, selectObjectAtPath, Superseded, thumbUrl } from '../../api';
import type { Frame } from '../../api';
import { effectiveRecipe, removeFrameStep, setFrameStep } from '../../studio/store';
import type { ManualStroke, ToolInstance } from '../../types';
import { defaultParams, getTool } from '../../toolRegistry';
import ManualBrush, { DEFAULT_R, MAX_R, MIN_R } from './ManualBrush';
import ObjectPickLayer from './ObjectPickLayer';
import ObjectMaskPreview from './ObjectMaskPreview';
import './photo-editor.css';

export type EditorTab = 'crop' | 'adjust' | 'filter' | 'markup' | 'erase' | 'object' | 'background';

const TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'crop', label: 'חיתוך', icon: <IconCrop /> },
  { id: 'adjust', label: 'התאמה', icon: <IconSun /> },
  { id: 'filter', label: 'סנן', icon: <IconFilter /> },
  { id: 'markup', label: 'סימון', icon: <IconPen /> },
  { id: 'erase', label: 'מחק', icon: <IconEraser /> },
  { id: 'object', label: 'הסרת אובייקט', icon: <IconEraser /> },
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

/* ---- סנן: the looks engine/photo_tools.py knows, in its order. */
const LOOKS = [
  'מקורי', 'ניקוב', 'מוזהב', 'קרינה', 'ניגודיות חמה', 'רגוע', 'מואר קריר', 'קריר בוהק',
  'דרמטי קריר', 'שחור-לבן', 'שחור-לבן קריר', 'שחור-לבן חם', 'שחור-לבן בחדות גבוהה',
  'צריבה', 'סרט', 'ספיה',
];

/* ---- חיתוך: aspect ratios, width over height; null = free, 0 = original. */
const RATIOS: { label: string; r: number | null }[] = [
  { label: 'חינם', r: null },
  { label: 'מקורי', r: 0 },
  { label: 'ריבוע', r: 1 },
  { label: '4:5', r: 4 / 5 },
  { label: '5:4', r: 5 / 4 },
  { label: '2:3', r: 2 / 3 },
  { label: '3:2', r: 3 / 2 },
  { label: '3:4', r: 3 / 4 },
  { label: '4:3', r: 4 / 3 },
  { label: '9:16', r: 9 / 16 },
  { label: '16:9', r: 16 / 9 },
];

/* ---- סימון */
const INKS = ['#ffffff', '#1f1f1f', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#bf5af2'];

/* ---- רקע */
const BG_COLOURS = ['#ffffff', '#f2efe9', '#d9d9d9', '#1f1f1f', '#c9dff2', '#2f6fd6', '#f6d6d6', '#dfe9d0'];

/** One tool's edits in this session. */
interface Edit {
  params?: Record<string, number>;
  strokes?: ManualStroke[];
  objectSelection?: ToolInstance['objectSelection'] | null;
}
type Edits = Record<string, Edit>;

function strokeId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** How much a straightened picture must grow to still fill its frame —
 *  the same rule engine/photo_tools.straighten_scale applies to the file. */
function straightenScale(w: number, h: number, degrees: number): number {
  const t = (Math.abs(degrees) * Math.PI) / 180;
  return Math.cos(t) + Math.sin(t) * Math.max(w / h, h / w);
}

export default function PhotoEditor({
  projectId,
  frame,
  name,
  onClose,
  initialTab = 'adjust',
}: {
  projectId: string;
  frame: Frame;
  name: string;
  onClose: () => void;
  initialTab?: EditorTab;
}) {
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [edits, setEdits] = useState<Edits>({});
  const [image, setImage] = useState<string | null>(null);
  const [imageFor, setImageFor] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [objectSelecting, setObjectSelecting] = useState(false);
  const [objectDraft, setObjectDraft] = useState<ToolInstance['objectSelection'] | null>(null);
  const [objectPaint, setObjectPaint] = useState<'add' | 'subtract' | null>(null);
  const [objectBusy, setObjectBusy] = useState(false);
  const [objectFault, setObjectFault] = useState<string | null>(null);
  const [objectBox, setObjectBox] = useState<{ w: number; h: number } | null>(null);
  // the click that chose the object, and the "not this" clicks that corrected it
  const objectClicks = useRef<{ at: [number, number]; exclude: Array<[number, number]> } | null>(null);

  // What the frame renders through now — the starting point of every control.
  const saved = useMemo(() => effectiveRecipe(projectId, name).filter((t) => t.enabled), [projectId, name]);

  const stepFor = useCallback((toolId: string, edit: Edit): ToolInstance => {
    const current = saved.find((t) => t.toolId === toolId);
    const base = current?.params ?? defaultParams(getTool(toolId));
    const step: ToolInstance = { ...(current ?? {}), toolId, enabled: true, params: { ...base, ...(edit.params ?? {}) } };
    if (edit.strokes) step.strokes = edit.strokes;
    if (edit.objectSelection) step.objectSelection = edit.objectSelection;
    return step;
  }, [saved]);

  const recipe = useMemo(() => {
    const touched = Object.keys(edits);
    const kept = saved.filter((t) => !touched.includes(t.toolId));
    return [...kept, ...touched.filter((id) => edits[id].objectSelection !== null).map((id) => stepFor(id, edits[id]))];
  }, [edits, saved, stepFor]);

  const paramOf = useCallback((tool: string, param: string, fallback = 0) => {
    const d = edits[tool]?.params?.[param];
    if (typeof d === 'number') return d;
    const s = saved.find((t) => t.toolId === tool)?.params[param];
    if (typeof s === 'number') return s;
    try { return defaultParams(getTool(tool))[param] ?? fallback; } catch { return fallback; }
  }, [edits, saved]);

  const strokesOf = useCallback((tool: string): ManualStroke[] => (
    edits[tool]?.strokes ?? saved.find((t) => t.toolId === tool)?.strokes ?? []
  ), [edits, saved]);

  const setParams = useCallback((tool: string, params: Record<string, number>) => {
    setEdits((prev) => ({ ...prev, [tool]: { ...(prev[tool] ?? {}), params: { ...(prev[tool]?.params ?? {}), ...params } } }));
  }, []);
  const setStrokes = useCallback((tool: string, strokes: ManualStroke[]) => {
    setEdits((prev) => ({ ...prev, [tool]: { ...(prev[tool] ?? {}), strokes } }));
  }, []);

  /* ---- what the stage renders for this tab (see the header) */
  const stageRecipe = useMemo(() => {
    const skip = tab === 'crop' || tab === 'erase' || tab === 'object' || tab === 'background'
      ? ['geometry', 'markup']
      : tab === 'markup' ? ['markup'] : [];
    if (tab === 'object' && (objectSelecting || objectDraft)) skip.push('object-remove');
    return recipe.filter((t) => !skip.includes(t.toolId));
  }, [recipe, tab, objectSelecting, objectDraft]);
  const stageSig = useMemo(() => JSON.stringify(stageRecipe), [stageRecipe]);

  const width = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth * (window.devicePixelRatio || 1) : 1600;
    return Math.min(2400, Math.max(1200, Math.round(w * 0.7)));
  }, []);

  // "לפני": the frame as it was when the editor opened.
  useEffect(() => {
    let alive = true;
    renderRecipeAtPath(frame.path, saved, width)
      .then((r) => { if (alive) setBefore(r.image); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [frame.path, saved, width]);

  // The stage — the last finished render stays up while the next is made.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    let alive = true;
    timer.current = window.setTimeout(() => {
      setBusy(true);
      renderRecipeAtPath(frame.path, JSON.parse(stageSig) as ToolInstance[], width, false, 'ws-editor')
        .then((r) => { if (alive) { setImage(r.image); setImageFor(stageSig); setFault(null); } })
        .catch((e) => { if (alive && !(e instanceof Superseded)) setFault(e instanceof Error ? e.message : 'הרינדור נכשל'); })
        .finally(() => { if (alive) setBusy(false); });
    }, image ? 90 : 0);
    return () => { alive = false; window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.path, stageSig, width]);

  const dirty = Object.keys(edits).length > 0;

  const save = useCallback(() => {
    for (const toolId of Object.keys(edits)) {
      if (edits[toolId].objectSelection === null) removeFrameStep(projectId, name, toolId);
      else setFrameStep(projectId, name, stepFor(toolId, edits[toolId]));
    }
    onClose();
  }, [edits, name, onClose, projectId, stepFor]);

  const cancel = useCallback(() => {
    if (dirty && !window.confirm('לצאת בלי לשמור את השינויים?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range';
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save(); }
      else if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
        if (i >= 0) { e.preventDefault(); setTab(TABS[i].id); }
      }
      // The screens underneath must not see any key while editing.
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancel, save]);

  /* ---- the stage image element, shared by every overlay */
  const imgRef = useRef<HTMLImageElement | null>(null);
  const shown = showBefore && before ? before : image;
  const stale = image !== null && imageFor !== stageSig;
  useEffect(() => {
    const img = imgRef.current;
    if (!img || tab !== 'object') return;
    const measure = () => {
      const rect = img.getBoundingClientRect();
      if (rect.width && rect.height) setObjectBox({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    img.addEventListener('load', measure);
    return () => { observer.disconnect(); img.removeEventListener('load', measure); };
  }, [shown, tab]);

  /* ================================================================ crop */
  const geo = {
    quarter: paramOf('geometry', 'quarter'),
    flipH: paramOf('geometry', 'flipH'),
    flipV: paramOf('geometry', 'flipV'),
    angle: paramOf('geometry', 'angle'),
    cropX: paramOf('geometry', 'cropX'),
    cropY: paramOf('geometry', 'cropY'),
    cropW: paramOf('geometry', 'cropW', 1),
    cropH: paramOf('geometry', 'cropH', 1),
  };
  const [ratio, setRatio] = useState<number | null>(null);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  /* ============================================================== filter */
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [autoOn, setAutoOn] = useState<null | Record<string, number>>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const lookBase = useMemo(() => JSON.stringify(recipe.filter((t) => !['look', 'geometry', 'markup'].includes(t.toolId))), [recipe]);
  useEffect(() => {
    if (tab !== 'filter') return undefined;
    let alive = true;
    setThumbs({});
    const base = JSON.parse(lookBase) as ToolInstance[];
    (async () => {
      for (let i = 0; i < LOOKS.length && alive; i += 1) {
        try {
          const steps = i ? [...base, { toolId: 'look', enabled: true, params: { preset: i, amount: 100 } }] : base;
          const r = await renderRecipeAtPath(frame.path, steps, 240);
          if (alive) setThumbs((prev) => ({ ...prev, [i]: r.image }));
        } catch { /* a missing thumbnail is shown as the photo itself */ }
      }
    })();
    return () => { alive = false; };
  }, [tab, lookBase, frame.path]);

  const toggleAuto = useCallback(async () => {
    if (autoOn) {
      // Put back exactly what was on the sliders before.
      setEdits((prev) => {
        const next = { ...prev };
        const tc = { ...(next['tone-color']?.params ?? {}) };
        for (const k of Object.keys(autoOn)) delete tc[k];
        const restore = autoOn.__prev as unknown as Record<string, number> | undefined;
        next['tone-color'] = { ...(next['tone-color'] ?? {}), params: { ...tc, ...(restore ?? {}) } };
        return next;
      });
      setAutoOn(null);
      return;
    }
    setAutoBusy(true);
    try {
      const p = await autoEnhance(frame.path);
      const prevParams: Record<string, number> = {};
      for (const k of Object.keys(p)) {
        const v = edits['tone-color']?.params?.[k];
        if (typeof v === 'number') prevParams[k] = v;
      }
      setParams('tone-color', p);
      setAutoOn({ ...p, __prev: prevParams as unknown as number });
    } catch (e) {
      setFault(e instanceof Error ? `שיפור אוטומטי: ${e.message}` : 'שיפור אוטומטי נכשל');
    } finally {
      setAutoBusy(false);
    }
  }, [autoOn, edits, frame.path, setParams]);

  /* ============================================================ markup */
  const [ink, setInk] = useState(INKS[2]);
  const [pen, setPen] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const [inkSize, setInkSize] = useState(0.006);

  /* ============================================================= erase */
  const [brushR, setBrushR] = useState(DEFAULT_R);
  const [brushErase, setBrushErase] = useState(false);

  /* A selection stays a draft until "הסר אובייקט" is pressed; the modal's
   * regular Save then records the step on this frame. */
  const objectEdit = edits['object-remove']?.objectSelection;
  const savedObject = saved.find((step) => step.toolId === 'object-remove')?.objectSelection;
  const selectedObject = objectDraft ?? (objectEdit === null ? undefined : objectEdit ?? savedObject);
  const chooseObject = async (x: number, y: number, exclude = false) => {
    const prev = objectClicks.current;
    const clicks = exclude && prev
      ? { at: prev.at, exclude: [...prev.exclude, [x, y] as [number, number]] }
      : { at: [x, y] as [number, number], exclude: [] };
    setObjectBusy(true);
    setObjectFault(null);
    try {
      const result = await selectObjectAtPath(frame.path, clicks.at[0], clicks.at[1], clicks.exclude);
      objectClicks.current = clicks;
      // the engine names what stands behind on its own (object_remove._find_behind)
      const behind = result.behind;
      setObjectDraft({ maskPng: result.maskPng, margin: result.margin, add: [], subtract: [], ...(behind ? { behind } : {}) });
      setObjectPaint(null);
    } catch (error) {
      setObjectFault(error instanceof Error ? error.message : 'בחירת האובייקט נכשלה');
    } finally {
      setObjectBusy(false);
    }
  };
  const startObjectPaint = (mode: 'add' | 'subtract') => {
    setObjectSelecting(false);
    setObjectPaint((current) => current === mode ? null : mode);
    if (!objectDraft && selectedObject) setObjectDraft({ ...selectedObject });
  };
  const applyObject = () => {
    if (!selectedObject) return;
    setEdits((current) => ({ ...current, 'object-remove': { objectSelection: selectedObject } }));
    setObjectDraft(null);
    setObjectPaint(null);
  };
  const clearObject = () => {
    setEdits((current) => ({ ...current, 'object-remove': { objectSelection: null } }));
    setObjectDraft(null);
    setObjectPaint(null);
    setObjectSelecting(false);
  };

  /* ======================================================== background */
  const bgMode = paramOf('background-replace', 'mode');
  const [bgBrush, setBgBrush] = useState<'off' | 'keep' | 'remove'>('off');

  const nearestStroke = (list: ManualStroke[], x: number, y: number) => {
    let best = -1; let bestD = Infinity;
    list.forEach((s, i) => {
      for (const [px, py] of s.points) {
        const d = Math.hypot(px - x, py - y);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return bestD < 0.05 ? best : -1;
  };

  /* ============================================================ render */
  return (
    <div className="tz-pe" dir="rtl" role="dialog" aria-modal="true" aria-label="עריכת תמונה">
      <header className="tz-pe-top">
        <div className="tz-pe-top-side">
          <span className="tz-pe-name" dir="ltr">{name}</span>
        </div>
        <nav className="tz-pe-tabs" role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tz-pe-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
              title={`${t.label} (${i + 1})`}
            >
              <span className="tz-pe-tab-icon" aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="tz-pe-top-side is-end">
          <button
            type="button"
            className="tz-pe-btn is-quiet"
            disabled={!dirty}
            onClick={() => { setEdits({}); setAutoOn(null); setRatio(null); }}
            title="מחזיר את התמונה למצב שבו פתחת אותה"
          >
            איפוס
          </button>
          <button type="button" className="tz-pe-btn" onClick={cancel}>ביטול</button>
          <button type="button" className="tz-pe-btn is-primary" onClick={save} disabled={!dirty}>שמור</button>
        </div>
      </header>

      <div className={`tz-pe-body is-${tab}`}>
        <main className="tz-pe-stage">
          {tab === 'crop' ? (
            <CropStage
              src={image}
              natural={natural}
              onNatural={setNatural}
              geo={geo}
              ratio={ratio}
              onCrop={(c) => setParams('geometry', c)}
            />
          ) : (
            <div className="tz-pe-picture">
              {shown ? (
                <img
                  ref={imgRef}
                  src={shown}
                  alt={name}
                  draggable={false}
                  className={stale ? 'is-stale' : ''}
                  onLoad={(e) => { if (!showBefore) setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }}
                />
              ) : (
                <img ref={imgRef} src={thumbUrl(frame.path, 1600)} alt={name} draggable={false} className="is-waiting" />
              )}
              {tab === 'object' && objectDraft && objectBox && !showBefore && (
                <ObjectMaskPreview selection={objectDraft} width={objectBox.w} height={objectBox.h} />
              )}
              {tab === 'object' && objectSelecting && objectBox && !showBefore && (
                <ObjectPickLayer path={frame.path} width={objectBox.w} height={objectBox.h}
                  className="tz-pe-object-click" busy={objectBusy}
                  onPick={(x, y, exclude) => { void chooseObject(x, y, exclude); }} />
              )}
              {tab === 'object' && objectPaint && selectedObject && !showBefore && (
                <ManualBrush imgRef={imgRef} pending={selectedObject[objectPaint] ?? []}
                  radius={brushR} onRadius={setBrushR} erasing={false}
                  tint={objectPaint === 'add' ? '59, 130, 246' : '255, 180, 50'}
                  onStroke={(stroke) => setObjectDraft({
                    ...selectedObject,
                    [objectPaint]: [...(selectedObject[objectPaint] ?? []), stroke],
                  })}
                  onErase={() => undefined} />
              )}
              {tab === 'erase' && shown && (
                <ManualBrush
                  imgRef={imgRef}
                  pending={stale || busy ? strokesOf('manual-clean') : []}
                  radius={brushR}
                  onRadius={setBrushR}
                  erasing={brushErase}
                  onStroke={(s) => setStrokes('manual-clean', [...strokesOf('manual-clean'), s])}
                  onErase={(x, y) => {
                    const list = strokesOf('manual-clean');
                    const i = nearestStroke(list, x, y);
                    if (i >= 0) setStrokes('manual-clean', list.filter((_, j) => j !== i));
                  }}
                />
              )}
              {tab === 'background' && bgBrush !== 'off' && shown && (
                <ManualBrush
                  imgRef={imgRef}
                  pending={strokesOf('background-replace').filter((s) => s.kind === bgBrush)}
                  radius={brushR}
                  onRadius={setBrushR}
                  erasing={false}
                  tint={bgBrush === 'keep' ? '52, 199, 89' : '10, 132, 255'}
                  onStroke={(s) => {
                    setStrokes('background-replace', [...strokesOf('background-replace'), { ...s, kind: bgBrush }]);
                    if (!bgMode) setParams('background-replace', { mode: 3 });
                  }}
                  onErase={() => undefined}
                />
              )}
              {tab === 'markup' && shown && (
                <MarkupLayer
                  imgRef={imgRef}
                  strokes={strokesOf('markup')}
                  tool={pen}
                  color={ink}
                  size={inkSize}
                  onChange={(list) => setStrokes('markup', list)}
                />
              )}
            </div>
          )}
          {busy && <span className="tz-pe-busy" aria-label="מעבד" />}
          {fault && <p className="tz-pe-fault">לא ניתן להציג את העריכה: {fault}</p>}
          {dirty && before && (tab === 'adjust' || tab === 'filter') && (
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

          {tab === 'crop' && (
            <div className="tz-pe-cropbar">
              <Dial value={geo.angle} onChange={(a) => setParams('geometry', { angle: a })} />
              <div className="tz-pe-cropbar-row">
                <div className="tz-pe-cropbar-side">
                  <button type="button" className="tz-pe-icon" title="סובב שמאלה" onClick={() => setParams('geometry', { quarter: (geo.quarter + 3) % 4, cropX: 0, cropY: 0, cropW: 1, cropH: 1 })}><IconRotateLeft /></button>
                  <button type="button" className="tz-pe-icon" title="סובב ימינה" onClick={() => setParams('geometry', { quarter: (geo.quarter + 1) % 4, cropX: 0, cropY: 0, cropW: 1, cropH: 1 })}><IconRotateRight /></button>
                </div>
                <div className="tz-pe-ratio">
                  <button type="button" className="tz-pe-ratio-btn" onClick={() => setRatioOpen((v) => !v)}>
                    <IconAspect /> {RATIOS.find((x) => x.r === ratio)?.label ?? 'חינם'}
                  </button>
                  {ratioOpen && (
                    <div className="tz-pe-ratio-menu" role="menu">
                      {RATIOS.map((x) => (
                        <button
                          key={x.label}
                          type="button"
                          role="menuitemradio"
                          aria-checked={ratio === x.r}
                          className={ratio === x.r ? 'is-on' : ''}
                          onClick={() => {
                            setRatio(x.r);
                            setRatioOpen(false);
                            if (x.r !== null && natural) {
                              const q = geo.quarter % 2 === 1;
                              const A = q ? natural.h / natural.w : natural.w / natural.h;
                              const R = x.r === 0 ? A : x.r;
                              const cw = A >= R ? R / A : 1;
                              const ch = A >= R ? 1 : A / R;
                              setParams('geometry', { cropW: cw, cropH: ch, cropX: (1 - cw) / 2, cropY: (1 - ch) / 2 });
                            }
                          }}
                        >
                          {x.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="tz-pe-cropbar-side is-end">
                  <button type="button" className={`tz-pe-icon${geo.flipH ? ' is-on' : ''}`} title="היפוך אופקי" onClick={() => setParams('geometry', { flipH: geo.flipH ? 0 : 1 })}><IconFlipH /></button>
                  <button type="button" className={`tz-pe-icon${geo.flipV ? ' is-on' : ''}`} title="היפוך אנכי" onClick={() => setParams('geometry', { flipV: geo.flipV ? 0 : 1 })}><IconFlipV /></button>
                </div>
              </div>
            </div>
          )}
        </main>

        {tab !== 'crop' && (
          <aside className="tz-pe-panel">
            {tab === 'adjust' && ADJUST.map((sec) => (
              <section key={sec.title} className="tz-pe-sec">
                <h3>{sec.title}</h3>
                {sec.controls.map((c) => (
                  <Slider
                    key={c.id}
                    label={c.label}
                    icon={c.icon}
                    min={c.min}
                    max={c.max}
                    value={Math.max(c.min, Math.min(c.max, paramOf(c.tool, c.param)))}
                    onChange={(v) => setParams(c.tool, { [c.param]: v })}
                  />
                ))}
              </section>
            ))}

            {tab === 'filter' && (
              <>
                <button type="button" className={`tz-pe-auto${autoOn ? ' is-on' : ''}`} onClick={() => void toggleAuto()} disabled={autoBusy}>
                  <IconWand /> {autoBusy ? 'מחשב…' : 'שיפור אוטומטי'}
                </button>
                <div className="tz-pe-looks">
                  {LOOKS.map((label, i) => {
                    const on = paramOf('look', 'preset') === i;
                    return (
                      <button key={label} type="button" className={`tz-pe-look${on ? ' is-on' : ''}`} onClick={() => setParams('look', { preset: i, amount: i ? paramOf('look', 'amount', 100) || 100 : 100 })}>
                        <span className="tz-pe-look-img">
                          {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <i />}
                          {on && <b aria-hidden>✓</b>}
                        </span>
                        <span className="tz-pe-look-name">{label}</span>
                      </button>
                    );
                  })}
                </div>
                {paramOf('look', 'preset') > 0 && (
                  <Slider label="עוצמת הסנן" icon={<IconFilter />} min={0} max={100} value={paramOf('look', 'amount', 100)} onChange={(v) => setParams('look', { amount: v })} />
                )}
              </>
            )}

            {tab === 'markup' && (
              <>
                <div className="tz-pe-pens">
                  {([['pen', 'עט', <IconPen key="p" />], ['highlighter', 'מדגש', <IconMarker key="h" />], ['eraser', 'מחק סימון', <IconEraser key="e" />]] as const).map(([id, label, icon]) => (
                    <button key={id} type="button" className={`tz-pe-pen${pen === id ? ' is-on' : ''}`} onClick={() => setPen(id)}>
                      {icon}<span>{label}</span>
                    </button>
                  ))}
                </div>
                {pen !== 'eraser' && (
                  <>
                    <h3 className="tz-pe-h">צבע</h3>
                    <div className="tz-pe-swatches">
                      {INKS.map((c) => (
                        <button key={c} type="button" className={`tz-pe-swatch${ink === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => setInk(c)} aria-label={c} />
                      ))}
                    </div>
                    <Slider label="עובי" icon={<IconDot />} min={1} max={40} value={Math.round(inkSize * 1000)} onChange={(v) => setInkSize(v / 1000)} />
                  </>
                )}
                <div className="tz-pe-row">
                  <button type="button" className="tz-pe-btn" disabled={!strokesOf('markup').length} onClick={() => setStrokes('markup', strokesOf('markup').slice(0, -1))}>בטל אחרון</button>
                  <button type="button" className="tz-pe-btn" disabled={!strokesOf('markup').length} onClick={() => setStrokes('markup', [])}>נקה הכל</button>
                </div>
              </>
            )}

            {tab === 'erase' && (
              <>
                <p className="tz-pe-help">צבע על מה שצריך לצאת מהתמונה — כתם, חוט, אדם ברקע. המערכת בונה מחדש את מה שמתחת.</p>
                <Slider label="גודל מברשת" icon={<IconDot />} min={Math.round(MIN_R * 1000)} max={Math.round(MAX_R * 1000)} value={Math.round(brushR * 1000)} onChange={(v) => setBrushR(v / 1000)} />
                <label className="tz-pe-toggle">
                  <span>הסרת סימון (לחץ על סימון כדי לבטל אותו)</span>
                  <input type="checkbox" checked={brushErase} onChange={(e) => setBrushErase(e.target.checked)} />
                  <i aria-hidden />
                </label>
                <div className="tz-pe-row">
                  <button type="button" className="tz-pe-btn" disabled={!strokesOf('manual-clean').length} onClick={() => setStrokes('manual-clean', strokesOf('manual-clean').slice(0, -1))}>בטל אחרון</button>
                  <button type="button" className="tz-pe-btn" disabled={!strokesOf('manual-clean').length} onClick={() => setStrokes('manual-clean', [])}>נקה הכל</button>
                </div>
              </>
            )}

            {tab === 'object' && (
              <>
                <h3 className="tz-pe-h">הסרת אובייקט</h3>
                <p className="tz-pe-help">העבר את העכבר על התמונה — קו לבן מראה מה ייבחר. לחץ לבחירה. תפס יותר מדי? Alt ולחיצה על מה שלא רצית.</p>
                <button type="button" className={`tz-pe-btn tz-pe-object-action${objectSelecting ? ' is-on' : ''}`}
                  disabled={objectBusy} onClick={() => { setObjectSelecting((v) => !v); setObjectPaint(null); setObjectFault(null); }}>
                  {objectSelecting ? 'בטל בחירה' : 'בחר בלחיצה על התמונה'}
                </button>
                {selectedObject && <>
                  <div className="tz-pe-row">
                    <button type="button" className={`tz-pe-btn${objectPaint === 'add' ? ' is-on' : ''}`}
                      onClick={() => startObjectPaint('add')}>הוסף למסכה</button>
                    <button type="button" className={`tz-pe-btn${objectPaint === 'subtract' ? ' is-on' : ''}`}
                      onClick={() => startObjectPaint('subtract')}>החסר מהמסכה</button>
                  </div>
                  <Slider label="גודל מברשת" icon={<IconDot />} min={Math.round(MIN_R * 1000)} max={Math.round(MAX_R * 1000)} value={Math.round(brushR * 1000)} onChange={(v) => setBrushR(v / 1000)} />
                  <div className="tz-pe-row">
                    <button type="button" className="tz-pe-btn is-primary" onClick={applyObject}>הסר אובייקט</button>
                    <button type="button" className="tz-pe-btn" onClick={clearObject}>נקה בחירה</button>
                  </div>
                  <p className="tz-pe-help">אחרי ההסרה לחץ „שמור” למעלה. אזור מוסתר מורכב עשוי לדרוש בדיקה מקרוב.</p>
                </>}
                {objectBusy && <p role="status" className="tz-pe-help">מזהה אובייקט…</p>}
                {objectFault && <p role="alert" className="tz-pe-help">{objectFault}</p>}
              </>
            )}

            {tab === 'background' && (
              <>
                <div className="tz-pe-bgmodes">
                  {([[3, 'טשטוש'], [1, 'הסר'], [2, 'החלף']] as const).map(([m, label]) => (
                    <button key={m} type="button" className={`tz-pe-bgmode${bgMode === m ? ' is-on' : ''}`} onClick={() => setParams('background-replace', { mode: bgMode === m ? 0 : m })}>
                      <span className={`tz-pe-bgmode-img is-m${m}`} style={{ backgroundImage: `url("${thumbUrl(frame.path, 320)}")` }} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                {bgMode === 3 && (
                  <Slider label="עוצמת טשטוש" icon={<IconBackground />} min={0} max={100} value={paramOf('background-replace', 'amount', 60)} onChange={(v) => setParams('background-replace', { amount: v })} />
                )}
                {bgMode === 1 && <p className="tz-pe-help">הרקע יהפוך ללבן. קבצים שיוצאים ללקוח הם JPEG, שאין בו שקיפות.</p>}
                {bgMode === 2 && (
                  <>
                    <h3 className="tz-pe-h">צבע רקע</h3>
                    <div className="tz-pe-swatches">
                      {BG_COLOURS.map((c) => {
                        const cur = rgbToHex(paramOf('background-replace', 'r', 255), paramOf('background-replace', 'g', 255), paramOf('background-replace', 'b', 255));
                        const [r, g, b] = hexToRgb(c);
                        return <button key={c} type="button" className={`tz-pe-swatch${cur === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => setParams('background-replace', { r, g, b })} aria-label={c} />;
                      })}
                      <label className="tz-pe-swatch is-custom" title="צבע אחר">
                        <input
                          type="color"
                          value={rgbToHex(paramOf('background-replace', 'r', 255), paramOf('background-replace', 'g', 255), paramOf('background-replace', 'b', 255))}
                          onChange={(e) => { const [r, g, b] = hexToRgb(e.target.value); setParams('background-replace', { r, g, b }); }}
                        />
                      </label>
                    </div>
                  </>
                )}
                <div className="tz-pe-divider" />
                <div className="tz-pe-brushrow">
                  <span><IconBrush /> כלי מברשת רקע</span>
                  <label className="tz-pe-switch">
                    <span>{bgBrush === 'off' ? 'כבוי' : 'פועל'}</span>
                    <input type="checkbox" checked={bgBrush !== 'off'} onChange={(e) => setBgBrush(e.target.checked ? 'keep' : 'off')} />
                    <i aria-hidden />
                  </label>
                </div>
                {bgBrush !== 'off' && (
                  <>
                    <div className="tz-pe-seg">
                      <button type="button" className={bgBrush === 'keep' ? 'is-on' : ''} onClick={() => setBgBrush('keep')}>הוסף לנושא</button>
                      <button type="button" className={bgBrush === 'remove' ? 'is-on' : ''} onClick={() => setBgBrush('remove')}>העבר לרקע</button>
                    </div>
                    <Slider label="גודל מברשת" icon={<IconDot />} min={Math.round(MIN_R * 1000)} max={Math.round(MAX_R * 1000)} value={Math.round(brushR * 1000)} onChange={(v) => setBrushR(v / 1000)} />
                  </>
                )}
                <button
                  type="button"
                  className="tz-pe-wide"
                  disabled={!bgMode && !strokesOf('background-replace').length}
                  onClick={() => { setParams('background-replace', { mode: 0 }); setStrokes('background-replace', []); }}
                >
                  אפס רקע
                </button>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/* =================================================================== pieces */

function Slider({
  label, icon, min, max, value, onChange,
}: {
  label: string;
  icon: React.ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const zero = min < 0 ? 0 : min;
  const pct = ((value - min) / (max - min)) * 100;
  const zeroPct = ((zero - min) / (max - min)) * 100;
  return (
    <label className="tz-pe-slider" onDoubleClick={() => onChange(zero)} title="לחיצה כפולה מאפסת">
      <span className="tz-pe-slider-head">
        <span className="tz-pe-slider-icon" aria-hidden>{icon}</span>
        <span className="tz-pe-slider-label">{label}</span>
        <output>{Math.round(value)}</output>
      </span>
      <span className="tz-pe-range" dir="ltr">
        <i className="tz-pe-range-fill" style={{ left: `${Math.min(pct, zeroPct)}%`, width: `${Math.abs(pct - zeroPct)}%` }} />
        <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      </span>
    </label>
  );
}

/** The straighten dial: a ruler of dots that slides under a fixed pointer. */
function Dial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const start = useRef<{ x: number; v: number } | null>(null);
  const PX = 8; // pixels per degree
  return (
    <div
      className="tz-pe-dial"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); start.current = { x: e.clientX, v: value }; }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const v = Math.max(-45, Math.min(45, s.v - (e.clientX - s.x) / PX));
        onChange(Math.round(v * 10) / 10);
      }}
      onPointerUp={() => { start.current = null; }}
      onDoubleClick={() => onChange(0)}
      title="גרור ליישור · לחיצה כפולה מאפסת"
    >
      <output>{`${Math.round(value * 10) / 10}°`}</output>
      <div className="tz-pe-dial-track" dir="ltr">
        <div className="tz-pe-dial-ticks" style={{ transform: `translateX(${-value * PX}px)` }}>
          {Array.from({ length: 91 }, (_, i) => i - 45).map((d) => (
            <i key={d} className={d % 5 === 0 ? 'is-major' : ''} style={{ left: `calc(50% + ${d * PX}px)` }} />
          ))}
        </div>
        <b className="tz-pe-dial-needle" />
      </div>
    </div>
  );
}

/** The crop view: the picture turned live on screen (the engine does the
 *  same to the file), the crop box with its eight handles over it. */
function CropStage({
  src, natural, onNatural, geo, ratio, onCrop,
}: {
  src: string | null;
  natural: { w: number; h: number } | null;
  onNatural: (n: { w: number; h: number }) => void;
  geo: { quarter: number; flipH: number; flipV: number; angle: number; cropX: number; cropY: number; cropW: number; cropH: number };
  ratio: number | null;
  onCrop: (c: { cropX: number; cropY: number; cropW: number; cropH: number }) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setRoom({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const odd = geo.quarter % 2 === 1;
  const nw = natural?.w ?? 3;
  const nh = natural?.h ?? 2;
  const A = odd ? nh / nw : nw / nh; // the turned frame, width over height
  const bw = Math.min(room.w, room.h * A);
  const bh = bw / A;
  const k = straightenScale(bw, bh, geo.angle);
  // The <img> keeps the file's own orientation; the transform turns it.
  const iw = odd ? bh : bw;
  const ih = odd ? bw : bh;
  const transform = `translate(-50%, -50%) rotate(${geo.angle}deg) scale(${k}) scale(${geo.flipH ? -1 : 1}, ${geo.flipV ? -1 : 1}) rotate(${geo.quarter * 90}deg)`;

  const drag = useRef<{ mode: string; x: number; y: number; c: typeof geo } | null>(null);
  const onDown = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, c: { ...geo } };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / bw;
    const dy = (e.clientY - d.y) / bh;
    let { cropX: x, cropY: y, cropW: w, cropH: h } = d.c;
    const MIN = 0.05;
    if (d.mode === 'move') {
      x = Math.max(0, Math.min(1 - w, x + dx));
      y = Math.max(0, Math.min(1 - h, y + dy));
      onCrop({ cropX: x, cropY: y, cropW: w, cropH: h });
      return;
    }
    const left = d.mode.includes('w');
    const right = d.mode.includes('e');
    const top = d.mode.includes('n');
    const bottom = d.mode.includes('s');
    let x0 = x; let y0 = y; let x1 = x + w; let y1 = y + h;
    if (left) x0 = Math.max(0, Math.min(x1 - MIN, x0 + dx));
    if (right) x1 = Math.min(1, Math.max(x0 + MIN, x1 + dx));
    if (top) y0 = Math.max(0, Math.min(y1 - MIN, y0 + dy));
    if (bottom) y1 = Math.min(1, Math.max(y0 + MIN, y1 + dy));
    if (ratio !== null) {
      const R = ratio === 0 ? A : ratio;
      // height in frame fractions for this width, keeping R in pixels
      const widthLed = left || right;
      if (widthLed) {
        let nh2 = ((x1 - x0) * A) / R;
        if (top && !bottom) { y0 = y1 - nh2; } else if (bottom && !top) { y1 = y0 + nh2; } else { const cy = (y0 + y1) / 2; y0 = cy - nh2 / 2; y1 = cy + nh2 / 2; }
        if (y0 < 0 || y1 > 1) {
          const over = Math.max(0, -y0) + Math.max(0, y1 - 1);
          nh2 -= over;
          const nw2 = (nh2 * R) / A;
          if (left && !right) x0 = x1 - nw2; else x1 = x0 + nw2;
          y0 = Math.max(0, y0); y1 = Math.min(1, y0 + nh2); y0 = y1 - nh2;
        }
      } else {
        let nw2 = ((y1 - y0) * R) / A;
        const cx = (x0 + x1) / 2; x0 = cx - nw2 / 2; x1 = cx + nw2 / 2;
        if (x0 < 0 || x1 > 1) {
          nw2 = Math.min(nw2, 1);
          x0 = Math.max(0, Math.min(1 - nw2, x0)); x1 = x0 + nw2;
          const nh2 = (nw2 * A) / R;
          if (top) y0 = y1 - nh2; else y1 = y0 + nh2;
        }
      }
    }
    onCrop({ cropX: x0, cropY: y0, cropW: x1 - x0, cropH: y1 - y0 });
  };
  const onUp = () => { drag.current = null; };

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return (
    <div className="tz-pe-cropwrap" ref={wrapRef}>
      <div className="tz-pe-cropbox" style={{ width: bw, height: bh }} onPointerMove={onMove} onPointerUp={onUp} dir="ltr">
        <div className="tz-pe-crop-clip">
          {src && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{ width: iw, height: ih, transform }}
              onLoad={(e) => onNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          )}
          {/* the shade outside the crop — clipped here so the handles are not */}
          <i
            className="tz-pe-crop-shade"
            style={{ left: `${geo.cropX * 100}%`, top: `${geo.cropY * 100}%`, width: `${geo.cropW * 100}%`, height: `${geo.cropH * 100}%` }}
          />
        </div>
        <div
          className="tz-pe-crop"
          style={{ left: `${geo.cropX * 100}%`, top: `${geo.cropY * 100}%`, width: `${geo.cropW * 100}%`, height: `${geo.cropH * 100}%` }}
          onPointerDown={onDown('move')}
        >
          <i className="tz-pe-thirds" />
          {HANDLES.map((h) => (
            <span key={h} className={`tz-pe-handle is-${h}`} onPointerDown={onDown(h)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** סימון: pen and highlighter strokes drawn over the cut frame, kept in
 *  fractions of it, shown live as vectors until the engine draws them. */
function MarkupLayer({
  imgRef, strokes, tool, color, size, onChange,
}: {
  imgRef: React.RefObject<HTMLImageElement | null>;
  strokes: ManualStroke[];
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  size: number;
  onChange: (s: ManualStroke[]) => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  const [live, setLive] = useState<[number, number][] | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const measure = () => {
      const r = img.getBoundingClientRect();
      const p = img.parentElement?.getBoundingClientRect();
      if (p && r.width) setBox({ left: r.left - p.left, top: r.top - p.top, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    img.addEventListener('load', measure);
    return () => { ro.disconnect(); img.removeEventListener('load', measure); };
  }, [imgRef]);
  if (!box) return null;
  const at = (e: React.PointerEvent): [number, number] => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x * box.w},${y * box.h}`).join(' ');
  return (
    <svg
      className={`tz-pe-markup is-${tool}`}
      style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        const p = at(e);
        if (tool === 'eraser') {
          let best = -1; let bestD = 0.03;
          strokes.forEach((s, i) => s.points.forEach(([x, y]) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < bestD) { bestD = d; best = i; } }));
          if (best >= 0) onChange(strokes.filter((_, i) => i !== best));
          return;
        }
        setLive([p]);
      }}
      onPointerMove={(e) => { if (live) setLive([...live, at(e)]); }}
      onPointerUp={() => {
        if (live && live.length) {
          onChange([...strokes, { id: strokeId(), points: live, r: tool === 'highlighter' ? size * 3 : size, color, kind: tool }]);
        }
        setLive(null);
      }}
    >
      {[...strokes, ...(live ? [{ id: 'live', points: live, r: tool === 'highlighter' ? size * 3 : size, color, kind: tool }] : [])].map((s) => (
        <path
          key={s.id}
          d={s.points.length > 1 ? path(s.points) : `${path(s.points)} l0.01,0`}
          stroke={s.color}
          strokeOpacity={s.kind === 'highlighter' ? 0.43 : 1}
          strokeWidth={Math.max(1, s.r * box.w * 2)}
          strokeLinecap={s.kind === 'highlighter' ? 'butt' : 'round'}
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </svg>
  );
}

/* ---- icons: thin line drawings, currentColor, 18px */
function Svg({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function IconCrop() { return <Svg><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></Svg>; }
function IconSun() { return <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>; }
function IconFilter() { return <Svg><path d="M9 3h6v4l-1 2v10a2 2 0 0 1-4 0V9L9 7z" /><path d="M9 7h6" /></Svg>; }
function IconPen() { return <Svg><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /><path d="M14 20h6" /></Svg>; }
function IconMarker() { return <Svg><path d="M9 15l-3 3v3h3l3-3" /><path d="M9 15l6-12 5 3-7 12z" /></Svg>; }
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
function IconWand() { return <Svg><path d="M4 20L16 8" /><path d="M14 6l4 4" /><path d="M19 2v3M17.5 3.5h3M6 4v2M5 5h2M20 13v2M19 14h2" /></Svg>; }
function IconDot() { return <Svg><circle cx="12" cy="12" r="4" fill="currentColor" /></Svg>; }
function IconBrush() { return <Svg><path d="M20 4L10 14" /><path d="M9 15c-2 0-4 1.5-4 4 0 1-1 2-2 2 2 1 6 1 7-2a3 3 0 0 0-1-4z" /></Svg>; }
function IconAspect() { return <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h3M7 9v3M17 15h-3M17 15v-3" /></Svg>; }
function IconRotateLeft() { return <Svg size={22}><path d="M4 9a8 8 0 1 1 1.5 7" /><path d="M4 4v5h5" /><circle cx="12" cy="12" r="1.5" /></Svg>; }
function IconRotateRight() { return <Svg size={22}><path d="M20 9a8 8 0 1 0-1.5 7" /><path d="M20 4v5h-5" /><circle cx="12" cy="12" r="1.5" /></Svg>; }
function IconFlipH() { return <Svg size={22}><path d="M4 8h16M16 4l4 4-4 4" /><path d="M20 16H4M8 12l-4 4 4 4" /></Svg>; }
function IconFlipV() { return <Svg size={22}><path d="M8 20V4M4 8l4-4 4 4" /><path d="M16 4v16M12 16l4 4 4-4" /></Svg>; }
