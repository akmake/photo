/* THE TOUR ENGINE.
 *
 * One layer over the whole app: the screen darkens except for the thing being
 * explained, and a bubble beside it says what it is. Two kinds of step:
 *
 *  - a TELLING step has "הבא". Everything, the lit thing included, is behind
 *    glass — a stray click cannot walk the app away from the tour.
 *  - a DOING step ("עכשיו לחץ…") lets clicks through to the lit thing, and only
 *    to it, and moves on by itself when the result appears on screen. The click
 *    is the next button. That is the difference between reading a manual and
 *    learning by hand, and it is why the tour watches the screen instead of
 *    counting clicks.
 *
 * THE SCREEN IS THE TRUTH. The tour never assumes the app followed it: every
 * frame it looks for what the step points at. If the photographer closed the
 * form halfway, the step's target is gone, and the tour walks back to the last
 * step whose target IS on screen — it does not sit there pointing at nothing.
 *
 * Content lives in tours.ts; this file knows nothing about any screen. */

import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Tour, TourStep } from './types';
import { tourById, tourForScreen } from './tours';
import { hasSeen, markSeen } from './seen';
import './tour.css';

interface TourApi {
  /** Plays a tour from its first step. */
  start: (id: string) => void;
  /** The "?" button: the tour of the screen the photographer is on. */
  startScreenTour: () => void;
  /** The tour that "?" would play here, if one is written. */
  screenTour: Tour | undefined;
  active: boolean;
}

const TourContext = createContext<TourApi>({
  start: () => {},
  startScreenTour: () => {},
  screenTour: undefined,
  active: false,
});

export function useTour(): TourApi {
  return useContext(TourContext);
}

/** A screen on its way in (a lazy chunk) gets this long to show what a step
 *  points at before the tour decides the screen is somewhere else. */
const FIND_PATIENCE_MS = 1500;
/** A situation step (optional) is skipped faster: it is either there or not. */
const OPTIONAL_PATIENCE_MS = 350;
/** What was on screen and vanished: the photographer moved. */
const LOST_PATIENCE_MS = 450;

function findTarget(name: string | undefined): HTMLElement | null {
  if (!name) return null;
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function TourProvider({ screen, children }: { screen: string; children: ReactNode }) {
  const [run, setRun] = useState<{ tour: Tour; index: number } | null>(null);
  const runRef = useRef(run);
  runRef.current = run;

  const start = useCallback((id: string) => {
    const tour = tourById(id);
    if (tour && tour.steps.length) setRun({ tour, index: 0 });
  }, []);

  const screenTour = useMemo(() => tourForScreen(screen), [screen]);

  const startScreenTour = useCallback(() => {
    if (screenTour) setRun({ tour: screenTour, index: 0 });
  }, [screenTour]);

  /* A FIRST VISIT plays the screen's tour by itself — on ARRIVAL only. A tour
   * that just ended on this screen must not be followed at once by another one
   * for the same screen; it waits for the next time he walks in. */
  const lastScreen = useRef<string | null>(null);
  useEffect(() => {
    if (lastScreen.current === screen) return;
    lastScreen.current = screen;
    if (runRef.current) return;
    const first = screen === 'today' && !hasSeen('welcome') ? tourById('welcome') : undefined;
    const tour = first ?? (screenTour && !hasSeen(screenTour.id) ? screenTour : undefined);
    if (!tour) return;
    // Let the screen paint first: a tour over a blank frame points at nothing.
    const t = window.setTimeout(() => {
      if (!runRef.current) setRun({ tour, index: 0 });
    }, 700);
    return () => window.clearTimeout(t);
  }, [screen, screenTour]);

  const api = useMemo<TourApi>(
    () => ({ start, startScreenTour, screenTour, active: Boolean(run) }),
    [start, startScreenTour, screenTour, run],
  );

  return (
    <TourContext.Provider value={api}>
      {children}
      {run && (
        <TourLayer
          key={run.tour.id}
          tour={run.tour}
          index={run.index}
          onIndex={(index) => setRun((r) => (r ? { ...r, index } : r))}
          onClose={() => {
            // Skipping is an answer too: "I know this". It is not offered again
            // by itself — the "?" button still plays it on demand.
            markSeen(run.tour.id);
            setRun(null);
          }}
        />
      )}
    </TourContext.Provider>
  );
}

/* ---------------------------------------------------------------- the layer */

interface Box { top: number; left: number; width: number; height: number }

const HOLE_PAD = 8;
const GAP = 14;
const MARGIN = 16;

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

function holeOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const top = Math.max(4, r.top - HOLE_PAD);
  const left = Math.max(4, r.left - HOLE_PAD);
  const bottom = Math.min(window.innerHeight - 4, r.bottom + HOLE_PAD);
  const right = Math.min(window.innerWidth - 4, r.right + HOLE_PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

type Side = 'top' | 'bottom' | 'left' | 'right' | 'free';

interface Placed { top: number; left: number; side: Side; arrow: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/* Beside the target if there is room on a side; otherwise in the corner that
 * covers the least of it. A bubble on top of the very button it explains is the
 * one placement that is always wrong. */
function place(hole: Box, bw: number, bh: number, pref: TourStep['placement']): Placed {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  const room = {
    bottom: vh - (hole.top + hole.height) - GAP - MARGIN,
    top: hole.top - GAP - MARGIN,
    left: hole.left - GAP - MARGIN,
    right: vw - (hole.left + hole.width) - GAP - MARGIN,
  };
  const order: Side[] =
    pref === 'top' ? ['top', 'bottom', 'left', 'right']
      : pref === 'side' ? ['left', 'right', 'bottom', 'top']
        : ['bottom', 'top', 'left', 'right'];

  for (const side of order) {
    if (side === 'bottom' && room.bottom >= bh) {
      const left = clamp(cx - bw / 2, MARGIN, vw - bw - MARGIN);
      return { top: hole.top + hole.height + GAP, left, side, arrow: clamp(cx - left, 22, bw - 22) };
    }
    if (side === 'top' && room.top >= bh) {
      const left = clamp(cx - bw / 2, MARGIN, vw - bw - MARGIN);
      return { top: hole.top - GAP - bh, left, side, arrow: clamp(cx - left, 22, bw - 22) };
    }
    if (side === 'left' && room.left >= bw) {
      const top = clamp(cy - bh / 2, MARGIN, vh - bh - MARGIN);
      return { top, left: hole.left - GAP - bw, side, arrow: clamp(cy - top, 22, bh - 22) };
    }
    if (side === 'right' && room.right >= bw) {
      const top = clamp(cy - bh / 2, MARGIN, vh - bh - MARGIN);
      return { top, left: hole.left + hole.width + GAP, side, arrow: clamp(cy - top, 22, bh - 22) };
    }
  }

  const corners = [
    { top: MARGIN, left: MARGIN },
    { top: MARGIN, left: vw - bw - MARGIN },
    { top: vh - bh - MARGIN, left: MARGIN },
    { top: vh - bh - MARGIN, left: vw - bw - MARGIN },
  ];
  const overlap = (c: { top: number; left: number }) => {
    const w = Math.max(0, Math.min(c.left + bw, hole.left + hole.width) - Math.max(c.left, hole.left));
    const h = Math.max(0, Math.min(c.top + bh, hole.top + hole.height) - Math.max(c.top, hole.top));
    return w * h;
  };
  const best = corners.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
  return { ...best, side: 'free', arrow: 0 };
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((para, i) => (
        <p key={i}>
          {para.split('\n').map((line, j) => (
            <span key={j}>{j > 0 && <br />}{line}</span>
          ))}
        </p>
      ))}
    </>
  );
}

function IcPointer() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M12 10V8.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11v-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4 15.5a1.5 1.5 0 0 1 2.3-1.9L9 16V11" />
    </svg>
  );
}

function TourLayer({
  tour, index, onIndex, onClose,
}: {
  tour: Tour;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const step = tour.steps[index];
  const doing = Boolean(step.waitFor);
  const last = index === tour.steps.length - 1;

  const [hole, setHole] = useState<Box | null>(null);
  /* Until the target is found the bubble is held back: it would otherwise
   * flash in the middle and then jump to the button. */
  const [found, setFound] = useState(!step.target);
  const [size, setSize] = useState({ w: 360, h: 220 });
  const bubble = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const direction = useRef<1 | -1>(1);

  /* The parent hands down fresh callbacks on every render; the watch below
   * must not restart for that, so it reads them through refs. */
  const handlers = useRef({ onIndex, onClose });
  handlers.current = { onIndex, onClose };
  const finish = useCallback(() => handlers.current.onClose(), []);

  const go = useCallback((to: number, dir: 1 | -1) => {
    direction.current = dir;
    if (to >= tour.steps.length) { handlers.current.onClose(); return; }
    handlers.current.onIndex(Math.max(0, to));
  }, [tour.steps.length]);

  /* Back goes to the nearest earlier step that can be shown right now — a step
   * whose button is on this screen, or a card that needs none. */
  const backTo = useMemo(() => {
    for (let j = index - 1; j >= 0; j -= 1) {
      const s = tour.steps[j];
      if (!s.target || findTarget(s.target)) return j;
    }
    return -1;
    // Recomputed per step; the screen under a step does not change its past.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tour]);

  /* THE WATCH. Every frame: where is the lit thing now (it scrolls, the window
   * resizes, a panel opens beside it), did the result of a doing-step appear,
   * did the thing vanish. One element measured per frame — cheap. */
  useEffect(() => {
    const entered = performance.now();
    let lastSeen = 0;
    let scrolled = false;
    let raf = 0;
    let done = false;
    // A doing-step advances on the result APPEARING, not on it being there:
    // stepping back onto "open the form" while the form is open must not
    // bounce straight forward again.
    let waitArmed = !findTarget(step.waitFor);
    setFound(!step.target);
    // The light stays where it was until the new target is found, so it GLIDES
    // from one button to the next instead of blinking through the middle.
    if (!step.target) setHole(null);

    const tick = () => {
      if (done) return;
      const now = performance.now();

      if (step.waitFor) {
        const result = findTarget(step.waitFor);
        if (result && waitArmed) { done = true; go(index + 1, 1); return; }
        if (!result) waitArmed = true;
      }

      if (step.target) {
        const el = findTarget(step.target);
        if (el) {
          lastSeen = now;
          if (!scrolled) {
            scrolled = true;
            const r = el.getBoundingClientRect();
            if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
              const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              el.scrollIntoView({ block: 'center', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
            }
          }
          const next = holeOf(el);
          setHole((prev) => (sameBox(prev, next) ? prev : next));
          setFound(true);
        } else {
          const patience = lastSeen
            ? LOST_PATIENCE_MS
            : step.optional ? OPTIONAL_PATIENCE_MS : FIND_PATIENCE_MS;
          if (now - (lastSeen || entered) > patience) {
            done = true;
            if (step.optional) {
              go(index + direction.current, direction.current);
              return;
            }
            // The photographer moved. Back to the latest step that is on screen.
            for (let j = index - 1; j >= 0; j -= 1) {
              if (tour.steps[j].target && findTarget(tour.steps[j].target)) { go(j, -1); return; }
            }
            // Nothing earlier is here either: say it in the middle rather than
            // point at nothing.
            setHole(null);
            setFound(true);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { done = true; cancelAnimationFrame(raf); };
  }, [step, index, tour, go]);

  // The bubble's real size, so it is placed by what it holds, not by a guess.
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  // Keyboard is a shortcut on top of the buttons, never instead of them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement
        && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.key === 'Escape') { finish(); return; }
      if (typing || doing) return;
      // Right-to-left: the next step is to the left.
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index + 1, 1); }
      if (e.key === 'ArrowRight' && backTo >= 0) { e.preventDefault(); go(backTo, -1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, go, index, doing, backTo]);

  // A telling step takes the keyboard; a doing step leaves it where the
  // photographer is typing.
  useEffect(() => {
    if (found && !doing) primary.current?.focus({ preventScroll: true });
  }, [found, doing, step]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centered = !hole;
  const spot: Box = hole ?? { top: vh / 2, left: vw / 2, width: 0, height: 0 };
  const placed: Placed = centered
    ? { top: Math.max(MARGIN, (vh - size.h) / 2), left: Math.max(MARGIN, (vw - size.w) / 2), side: 'free', arrow: 0 }
    : place(spot, size.w, size.h, step.placement);

  /* Glass around the hole. Four panes, so the hole itself stays open for a
   * doing-step; a telling-step adds a fifth pane over the hole. */
  const panes: Box[] = [
    { top: 0, left: 0, width: vw, height: spot.top },
    { top: spot.top + spot.height, left: 0, width: vw, height: Math.max(0, vh - spot.top - spot.height) },
    { top: spot.top, left: 0, width: spot.left, height: spot.height },
    { top: spot.top, left: spot.left + spot.width, width: Math.max(0, vw - spot.left - spot.width), height: spot.height },
  ];
  if (!doing || centered) panes.push(spot);

  const arrowStyle =
    placed.side === 'bottom' ? { top: -7, left: placed.arrow - 7 }
      : placed.side === 'top' ? { bottom: -7, left: placed.arrow - 7 }
        : placed.side === 'left' ? { right: -7, top: placed.arrow - 7 }
          : placed.side === 'right' ? { left: -7, top: placed.arrow - 7 }
            : undefined;

  return createPortal(
    <div className="tour-root" dir="rtl">
      <div
        className={`tour-hole${doing && !centered ? ' is-doing' : ''}${centered ? ' is-centered' : ''}`}
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        aria-hidden="true"
      />
      {panes.map((p, i) => (
        <div key={i} className="tour-pane" style={{ top: p.top, left: p.left, width: p.width, height: p.height }} />
      ))}

      <div
        ref={bubble}
        key={step.id}
        className={`tour-bubble${centered ? ' is-centered' : ''}${found ? '' : ' is-waiting'}`}
        style={{ top: placed.top, left: placed.left }}
        role="dialog"
        aria-modal="false"
        aria-label={`${tour.title}: ${step.title}`}
        aria-live="polite"
      >
        {arrowStyle && <span className="tour-arrow" style={arrowStyle} aria-hidden="true" />}

        <div className="tour-head">
          <span className="tour-kicker">{tour.title}</span>
          <button type="button" className="tour-skip" onClick={finish}>
            {index === 0 ? 'אני מכיר, דלג' : 'סגור הדרכה'}
          </button>
        </div>

        <h3 className="tour-title">{step.title}</h3>
        <div className="tour-body"><Paragraphs text={step.body} /></div>

        {doing && step.doText && (
          <div className="tour-do"><IcPointer /><span>{step.doText}</span></div>
        )}

        <div className="tour-foot">
          <div className="tour-progress" aria-label={`שלב ${index + 1} מתוך ${tour.steps.length}`}>
            <span className="tour-progress-count">{index + 1} / {tour.steps.length}</span>
            <span className="tour-progress-track">
              <span style={{ width: `${((index + 1) / tour.steps.length) * 100}%` }} />
            </span>
          </div>
          <div className="tour-actions">
            {backTo >= 0 && (
              <button type="button" className="tour-btn is-quiet" onClick={() => go(backTo, -1)}>
                הקודם
              </button>
            )}
            {!doing && (
              <button ref={primary} type="button" className="tour-btn is-primary" onClick={() => go(index + 1, 1)}>
                {last ? 'סיום' : index === 0 && !step.target ? 'בוא נתחיל' : 'הבא'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
