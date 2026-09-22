/* PhotoGrid — the one gallery every screen that shows a set of photographs
 * uses. Built the way Google Photos builds its web grid:
 *
 *  - JUSTIFIED rows (justify.ts): each photograph in its own proportions,
 *    portrait beside landscape, rows filling the width exactly, one gap
 *    everywhere. No square crops, no ragged edge, no holes.
 *  - SECTIONS with a sticky title (a batch, a moment, a day), each laid out on
 *    its own so a section always starts on a fresh row.
 *  - ONLY WHAT IS ON SCREEN IS IN THE PAGE. Positions are computed, not
 *    measured; tiles are absolutely placed and created just before they
 *    scroll into view, so a set of thousands scrolls like a set of twenty.
 *  - The right thumbnail for the tile: its width on screen, in device
 *    pixels, rounded up to one of three sizes the engine already caches.
 *  - A tile fades in over 100ms onto a neutral placeholder of its own shape.
 *
 * What a tile SAYS (a decision, a count, a mark) is the screen's business and
 * comes in through `renderOverlay`. The grid only knows where things go.
 */

import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { justify } from './justify';
import type { JustifiedLayout } from './justify';
import './photo-grid.css';

export interface GridItem {
  id: string;
  /** width / height as the photograph stands. Unknown = 1.5 until it loads. */
  aspect?: number;
  /** The thumbnail URL for a tile this many device pixels wide. */
  src: (width: number) => string;
  alt?: string;
}

export interface GridSection {
  id: string;
  title?: React.ReactNode;
  items: GridItem[];
}

export interface TileState {
  current: boolean;
  selected: boolean;
  hovered: boolean;
  width: number;
  height: number;
}

export interface PhotoGridHandle {
  /** Bring a photograph into view (nearest edge, not recentred). */
  reveal: (id: string) => void;
  /** The photograph above / below this one, by position on screen. */
  neighbor: (id: string, dir: 'up' | 'down') => string | null;
  scrollToTop: () => void;
}

const THUMBS = [320, 640, 1280];
const HEADER_H = 48;
const SECTION_GAP = 28;

function pickThumb(px: number): number {
  for (const t of THUMBS) if (px <= t * 1.08) return t;
  return THUMBS[THUMBS.length - 1];
}

interface Placed {
  item: GridItem;
  section: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const PhotoGrid = React.forwardRef<PhotoGridHandle, {
  sections: GridSection[];
  /** The row height the layout aims for, in CSS pixels. */
  targetHeight?: number;
  gap?: number;
  currentId?: string | null;
  isSelected?: (id: string) => boolean;
  onItemClick?: (id: string, e: React.MouseEvent) => void;
  onItemDoubleClick?: (id: string) => void;
  /** The round check at the tile's corner, as in Google Photos. */
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  renderOverlay?: (item: GridItem, state: TileState) => React.ReactNode;
  /** Extra class per tile, for states the screen owns (a decision, a dim). */
  tileClass?: (item: GridItem) => string;
  empty?: React.ReactNode;
  /** Something above the sections, scrolled with them (a notice, a bar). */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Ctrl + wheel: bigger (+1) or smaller (-1) photographs, as in Photos. */
  onZoom?: (dir: 1 | -1) => void;
}>(function PhotoGrid({
  sections, targetHeight = 220, gap = 4, currentId, isSelected, onItemClick, onItemDoubleClick,
  onToggleSelect, renderOverlay, tileClass, empty, header, footer, className, onZoom,
}, ref) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [viewH, setViewH] = useState(800);
  const [scrollTop, setScrollTop] = useState(0);
  const [headH, setHeadH] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  // Proportions learned from thumbnails when the caller did not know them.
  const [learned, setLearned] = useState<Record<string, number>>({});
  const pendingLearn = useRef<Record<string, number>>({});
  const learnTimer = useRef<number | undefined>(undefined);

  /* The room, measured once and on every resize — layout waits for the
   * resize to settle, the way Photos does, so dragging a window edge does
   * not relayout a thousand tiles per pixel. */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let t: number | undefined;
    const measure = () => {
      setWidth(el.clientWidth);
      setViewH(el.clientHeight);
      setHeadH(headRef.current?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(() => { window.clearTimeout(t); t = window.setTimeout(measure, 120); });
    ro.observe(el);
    if (headRef.current) ro.observe(headRef.current);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrollTop(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Not passive: Ctrl+wheel must not zoom the whole page instead.
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !zoomRef.current) return;
      e.preventDefault();
      zoomRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const innerW = Math.max(0, width - 2 * 16);

  /* ---- the layout: every section justified on its own, stacked */
  const { placed, height, sectionTops, layouts } = useMemo(() => {
    const out: Placed[] = [];
    const tops: { y: number; title: React.ReactNode; id: string }[] = [];
    const lays: { layout: JustifiedLayout; y0: number; start: number }[] = [];
    let y = 0;
    sections.forEach((sec, si) => {
      if (!sec.items.length) return;
      if (si > 0 && out.length) y += SECTION_GAP;
      if (sec.title) { tops.push({ y, title: sec.title, id: sec.id }); y += HEADER_H; }
      const layout = justify(
        sec.items.map((it) => it.aspect ?? learned[it.id] ?? 1.5),
        { width: innerW, targetHeight, gap },
      );
      lays.push({ layout, y0: y, start: out.length });
      for (const b of layout.boxes) {
        out.push({ item: sec.items[b.i], section: si, x: b.x, y: y + b.y, w: b.w, h: b.h });
      }
      y += layout.height;
    });
    return { placed: out, height: y, sectionTops: tops, layouts: lays };
  }, [sections, innerW, targetHeight, gap, learned]);

  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    placed.forEach((p, i) => m.set(p.item.id, i));
    return m;
  }, [placed]);

  /* ---- what is on screen, with a screen and a half either side */
  const top = scrollTop - headH;
  const lo = top - viewH * 1.5;
  const hi = top + viewH * 2.5;
  const visible = useMemo(() => placed.filter((p) => p.y + p.h >= lo && p.y <= hi), [placed, lo, hi]);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  useImperativeHandle(ref, () => ({
    reveal: (id: string) => {
      const el = scrollRef.current;
      const i = indexOf.get(id);
      if (!el || i === undefined) return;
      const p = placed[i];
      const y0 = p.y + headH;
      const pad = 24;
      if (y0 - pad < el.scrollTop) el.scrollTo({ top: Math.max(0, y0 - pad - HEADER_H) });
      else if (y0 + p.h + pad > el.scrollTop + el.clientHeight) el.scrollTo({ top: y0 + p.h + pad - el.clientHeight });
    },
    neighbor: (id: string, dir: 'up' | 'down') => {
      const i = indexOf.get(id);
      if (i === undefined) return null;
      const p = placed[i];
      const cx = p.x + p.w / 2;
      // The nearest tile in the next row that way, by horizontal centre.
      const rowsY = [...new Set(placed.map((q) => q.y))].sort((a, b) => a - b);
      const r = rowsY.indexOf(p.y);
      const ny = rowsY[dir === 'down' ? r + 1 : r - 1];
      if (ny === undefined) return null;
      let best: Placed | null = null;
      let bestD = Infinity;
      for (const q of placed) {
        if (q.y !== ny) continue;
        const d = Math.abs(q.x + q.w / 2 - cx);
        if (d < bestD) { bestD = d; best = q; }
      }
      return best?.item.id ?? null;
    },
    scrollToTop: () => scrollRef.current?.scrollTo({ top: 0 }),
  }), [indexOf, placed, headH]);

  const learn = useCallback((id: string, w: number, h: number) => {
    if (!w || !h) return;
    pendingLearn.current[id] = w / h;
    window.clearTimeout(learnTimer.current);
    learnTimer.current = window.setTimeout(() => {
      const add = pendingLearn.current;
      pendingLearn.current = {};
      setLearned((prev) => ({ ...prev, ...add }));
    }, 250);
  }, []);

  const hasAny = placed.length > 0;
  // The sticky title for where the eye is: the last section starting above.
  const stuck = [...sectionTops].reverse().find((s) => s.y <= top + 1);

  return (
    <div className={`tz-pg${className ? ` ${className}` : ''}`} ref={scrollRef}>
      <div ref={headRef}>{header}</div>
      {!hasAny ? (
        <div className="tz-pg-empty">{empty}</div>
      ) : (
        <div className="tz-pg-canvas" style={{ height, marginInline: 16 }}>
          {sectionTops.map((s) => (
            <div key={s.id} className="tz-pg-title" style={{ top: s.y, height: HEADER_H }}>{s.title}</div>
          ))}
          {stuck && top > stuck.y + 4 && (
            <div className="tz-pg-title is-stuck" style={{ top: top, height: HEADER_H }}>{stuck.title}</div>
          )}
          {visible.map((p) => {
            const id = p.item.id;
            const current = id === currentId;
            const selected = Boolean(isSelected?.(id));
            const state: TileState = { current, selected, hovered: hovered === id, width: p.w, height: p.h };
            return (
              <figure
                key={id}
                className={`tz-pg-tile${current ? ' is-current' : ''}${selected ? ' is-selected' : ''}${tileClass ? ` ${tileClass(p.item)}` : ''}`}
                style={{ insetInlineStart: p.x, top: p.y, width: p.w, height: p.h }}
                onClick={(e) => onItemClick?.(id, e)}
                onDoubleClick={() => onItemDoubleClick?.(id)}
                onMouseEnter={() => setHovered(id)}
                onMouseLeave={() => setHovered((h) => (h === id ? null : h))}
                onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
              >
                <Thumb
                  src={p.item.src(pickThumb(p.w * dpr))}
                  alt={p.item.alt ?? ''}
                  onSize={p.item.aspect ? undefined : (w, h) => learn(id, w, h)}
                />
                {onToggleSelect && (
                  <button
                    type="button"
                    className="tz-pg-check"
                    aria-pressed={selected}
                    aria-label={selected ? 'בטל בחירה' : 'בחר'}
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(id, e); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
                {renderOverlay?.(p.item, state)}
              </figure>
            );
          })}
        </div>
      )}
      {footer}
    </div>
  );
});

export default PhotoGrid;

/** The image, faded in when it has arrived; the tile's own colour until then. */
function Thumb({ src, alt, onSize }: { src: string; alt: string; onSize?: (w: number, h: number) => void }) {
  const [loaded, setLoaded] = useState(false);
  const shown = useRef(src);
  // A bigger thumbnail for the same tile keeps the smaller one up until ready.
  useEffect(() => { if (shown.current !== src) { shown.current = src; } }, [src]);
  return (
    <img
      className={`tz-pg-img${loaded ? ' is-loaded' : ''}`}
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onLoad={(e) => { setLoaded(true); onSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); }}
    />
  );
}
