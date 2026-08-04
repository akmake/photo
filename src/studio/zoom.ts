/* Zoom and pan over a photograph.
 *
 * Fit-to-screen is for choosing a frame. It is useless for judging one: skin
 * texture, a healed blemish and a sharpening halo all live at the pixel level,
 * and at fit a 20MP frame is showing you roughly one pixel in twenty. A tool
 * that can only be seen at fit is a tool being taken on trust.
 *
 * MODELLED ON `src/lab/Lab.tsx`, which solved this first and is still the only
 * other implementation. It is not shared code yet: the lab's version is
 * entangled with the brush overlay's coordinate mapping, and pulling it apart
 * without a browser to check the result is how a working screen breaks. The
 * duplication is deliberate and temporary — when the lab is next touched, this
 * is the version to keep.
 *
 * Two conventions worth stating, both inherited because they are right:
 *
 *   `zoom` is a multiple of FIT, not of the file. So 1 always means "the whole
 *   picture", whatever the frame's dimensions, and `actual` converts to a true
 *   1:1 using the measured fit scale.
 *
 *   The wheel listener is attached NATIVELY. React's onWheel is passive, so it
 *   cannot preventDefault, and the page scrolls instead of the image zooming.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAX_ZOOM = 16;

export interface ZoomPan {
  /** Put on the element that receives the wheel and the drag. */
  stageRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Put on the <img>, so its natural size can be measured. */
  imgRef: React.MutableRefObject<HTMLImageElement | null>;
  /** Put on the element that actually moves. */
  style: React.CSSProperties;
  zoom: number;
  /** Zoom as a percentage of 1:1 — what a person expects to read. */
  percent: number;
  fit: () => void;
  actual: () => void;
  /** True once panning is possible, so the cursor can say so. */
  pannable: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}

export function useZoomPan(resetKey?: unknown): ZoomPan {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /** How much the browser already shrank the image to fit. Needed to turn
   *  "×2 of fit" into an honest "100%". */
  const [fitScale, setFitScale] = useState(1);

  const fit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const actual = useCallback(() => {
    setZoom(fitScale > 0 ? 1 / fitScale : 1);
    setPan({ x: 0, y: 0 });
  }, [fitScale]);

  // A different photograph starts at fit. Keeping the previous pan would drop
  // the next frame somewhere arbitrary in its own corner.
  useEffect(() => { fit(); }, [resetKey, fit]);

  useLayoutEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.parentElement;
      if (!box || el.naturalWidth === 0) return;
      // object-fit: contain — the image fills whichever axis runs out first
      setFitScale(
        Math.min(box.clientWidth / el.naturalWidth, box.clientHeight / el.naturalHeight),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [resetKey]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      // Zoom about the POINTER, not the centre. Zooming about the centre means
      // chasing the thing you are looking at back into view after every step.
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        const k = next / z;
        setPan((p) => (next === 1
          ? { x: 0, y: 0 }
          : { x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
        return next;
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [resetKey]);

  // 0 fits, 1 goes to 1:1 — the two every editor binds, in the same places.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === '0') fit();
      if (e.key === '1') actual();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, actual]);

  return {
    stageRef,
    imgRef,
    style: {
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      // No transition. A comparison you have to wait for is not a comparison,
      // and an eased zoom makes a 1:1 check feel like it is lying to you.
      transformOrigin: 'center center',
    },
    zoom,
    percent: Math.round(zoom * fitScale * 100),
    fit,
    actual,
    pannable: zoom > 1,
    onPointerDown: (e) => {
      if (zoom <= 1) return;
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
    },
    onPointerUp: () => { drag.current = null; },
  };
}
