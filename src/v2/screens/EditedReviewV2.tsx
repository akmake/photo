/* הסט הערוך — every photograph as it will be delivered, one after another.
 *
 * The editing screen answers "how does THIS frame look while I work on it".
 * This answers the question a photographer asks before sending anything out:
 * "is the whole set finished, and is it consistent?" Each frame is shown
 * through its OWN full recipe (base → batch → its own retouch), large, with
 * the set running along the bottom, a before/after on Space, and the two
 * decisions that matter here: finished, or back to editing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl } from '../../api';
import type { Frame } from '../../api';
import { frameKey, setPhotoStatus, useStatuses } from '../../studio/store';
import { useFramePreview } from '../../studio/preview';
import './edited-review-v2.css';

type Show = 'all' | 'done' | 'todo';

export default function EditedReviewV2({
  projectId,
  frames,
  startAt,
  onClose,
  onEdit,
}: {
  projectId: string;
  frames: Frame[];
  startAt?: string;
  onClose: () => void;
  /** Back to the editing screen, on this frame. */
  onEdit: (name: string) => void;
}) {
  const statuses = useStatuses(projectId);
  const preview = useFramePreview(projectId);
  const [show, setShow] = useState<Show>('all');
  const [grid, setGrid] = useState(false);
  const [before, setBefore] = useState(false);
  const [sel, setSel] = useState<string | null>(startAt ? frameKey(startAt) : null);
  const [aspect, setAspect] = useState(1.5);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const isDone = useCallback((name: string) => statuses[frameKey(name)] === 'ready', [statuses]);
  const list = useMemo(
    () => frames.filter((f) => (show === 'done' ? isDone(f.name) : show === 'todo' ? !isDone(f.name) : true)),
    [frames, show, isDone],
  );
  const doneCount = useMemo(() => frames.filter((f) => isDone(f.name)).length, [frames, isDone]);

  useEffect(() => {
    if (!list.length) { setSel(null); return; }
    if (!sel || !list.some((f) => frameKey(f.name) === sel)) setSel(frameKey(list[0].name));
  }, [list, sel]);

  const index = list.findIndex((f) => frameKey(f.name) === sel);
  const current = index >= 0 ? list[index] : null;

  // Render ahead around where the eye is, not the whole set at once.
  useEffect(() => {
    if (index < 0) return;
    preview.want(list.slice(Math.max(0, index - 6), index + 30));
  }, [index, list, preview]);

  useEffect(() => {
    if (sel) tileRefs.current[sel]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel, grid]);

  const step = useCallback((d: number) => {
    if (!list.length) return;
    const i = Math.max(0, Math.min(list.length - 1, (index < 0 ? 0 : index) + d));
    setSel(frameKey(list[i].name));
  }, [index, list]);

  const toggleDone = useCallback(() => {
    if (!current) return;
    setPhotoStatus(projectId, current.name, isDone(current.name) ? 'working' : 'ready');
  }, [current, isDone, projectId]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.matches('input, textarea, select')) return;
      const k = e.code || e.key;
      if (k === 'Escape') { e.preventDefault(); onClose(); return; }
      if (k === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) setBefore(true); return; }
      if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); step(1); return; }
      if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); step(-1); return; }
      if (k === 'Enter') { e.preventDefault(); toggleDone(); return; }
      if (k === 'KeyE' || e.key === 'e' || e.key === 'ק') { e.preventDefault(); if (current) onEdit(current.name); return; }
      if (k === 'KeyG' || e.key === 'g' || e.key === 'ע') { e.preventDefault(); setGrid((v) => !v); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' || e.key === ' ') setBefore(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [current, onClose, onEdit, step, toggleDone]);

  // The picture is sized in pixels from its own box.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid]);
  const imgW = Math.max(60, Math.floor(Math.min(box.w, (box.h - 4) * aspect)));
  const imgH = Math.floor(imgW / aspect);

  const src = current
    ? (before ? thumbUrl(current.path, 1600) : preview.url(current.path, current.name, 1600))
    : '';
  const waiting = current && !before && preview.pending(current.path, current.name);

  const tile = (f: Frame, big: boolean) => {
    const n = frameKey(f.name);
    return (
      <button
        key={f.path}
        ref={(el) => { tileRefs.current[n] = el; }}
        type="button"
        className={`tz-er-tile${big ? ' is-big' : ''}${n === sel ? ' is-sel' : ''}${isDone(f.name) ? ' is-done' : ''}`}
        onClick={() => setSel(n)}
        onDoubleClick={() => { setSel(n); setGrid(false); }}
        title={f.name}
      >
        <img src={preview.url(f.path, f.name, 320)} alt="" loading="lazy" draggable={false} />
        <i className="tz-er-mark" />
      </button>
    );
  };

  return (
    <div className="tz-er" role="dialog" aria-modal="true" aria-label="הסט הערוך">
      <header className="tz-er-head">
        <strong>הסט הערוך</strong>
        <span className="tz-er-count">
          {doneCount.toLocaleString('he-IL')} מתוך {frames.length.toLocaleString('he-IL')} הסתיימו
          <span className="tz-er-bar"><i style={{ width: `${frames.length ? (doneCount / frames.length) * 100 : 0}%` }} /></span>
        </span>
        <div className="tz-er-filters">
          {([['all', 'הכול'], ['todo', 'עוד לא הסתיימו'], ['done', 'הסתיימו']] as [Show, string][]).map(([id, label]) => (
            <button key={id} type="button" className={`tz-er-filter${show === id ? ' is-on' : ''}`} onClick={() => setShow(id)}>
              {label}
            </button>
          ))}
          <button type="button" className="tz-er-filter" onClick={() => setGrid((v) => !v)}>
            {grid ? 'תמונה גדולה' : 'רשת'} <kbd>G</kbd>
          </button>
        </div>
        {preview.stale && <span className="tz-er-fault">המנוע לא זמין — מוצגות התמונות בלי העריכה</span>}
        <button type="button" className="tz-er-close" onClick={onClose} aria-label="סגור">חזרה לעריכה ✕</button>
      </header>

      {list.length === 0 ? (
        <p className="tz-er-empty">
          {show === 'done' ? 'עוד לא סומנה אף תמונה כגמורה.' : show === 'todo' ? 'כל התמונות הסתיימו.' : 'אין תמונות.'}
        </p>
      ) : grid ? (
        <div className="tz-er-grid">{list.map((f) => tile(f, true))}</div>
      ) : (
        <>
          <div className="tz-er-bar-actions">
            <span className="tz-er-name" dir="ltr">{current?.name}</span>
            <span className="tz-er-state">
              {current && !preview.edited(current.name) ? 'אין עדיין עריכה על התמונה'
                : before ? 'לפני העריכה' : waiting ? 'מכין את העריכה…' : 'אחרי העריכה'}
              {' · '}{current && isDone(current.name) ? <b className="tz-er-ok">הסתיימה ✓</b> : 'עוד לא הסתיימה'}
            </span>
            <span className="tz-er-actions">
              <button type="button" className="tz-er-btn" onMouseDown={() => setBefore(true)} onMouseUp={() => setBefore(false)} onMouseLeave={() => setBefore(false)}>
                לפני <kbd>רווח</kbd>
              </button>
              <button type="button" className="tz-er-btn" onClick={() => current && onEdit(current.name)}>
                ערוך את התמונה <kbd>E</kbd>
              </button>
              <button type="button" className={`tz-er-btn is-main${current && isDone(current.name) ? ' is-on' : ''}`} onClick={toggleDone}>
                {current && isDone(current.name) ? 'החזר לעריכה' : 'סיימתי ✓'} <kbd>Enter</kbd>
              </button>
            </span>
          </div>
          <div className="tz-er-stage" ref={stageRef}>
            {current && (
              <img
                key={src}
                src={src}
                alt=""
                draggable={false}
                style={{ width: imgW, height: imgH }}
                onLoad={(e) => {
                  const im = e.currentTarget;
                  if (im.naturalWidth && im.naturalHeight) setAspect(im.naturalWidth / im.naturalHeight);
                }}
              />
            )}
          </div>
          <div className="tz-er-strip">{list.map((f) => tile(f, false))}</div>
        </>
      )}
      <p className="tz-er-keys">חצים — הבאה/קודמת · רווח — לפני · Enter — סיימתי · E — ערוך · G — רשת · Esc — חזרה</p>
    </div>
  );
}
