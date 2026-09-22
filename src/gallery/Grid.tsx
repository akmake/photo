/* The grid of a whole wedding, on a phone.
 *
 * Six hundred <img> tags at once is what makes a proofing gallery feel broken:
 * the browser decodes every one of them, memory climbs, and the scroll stutters
 * exactly while the client is trying to decide. So only the rows that are on
 * screen exist in the DOM — the rest is one tall spacer holding the scrollbar
 * honest.
 *
 * Written by hand rather than pulled in: the whole app has React and nothing
 * else. The positions come from the same justified layout the studio uses.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { justify } from '../components/photo-grid/justify';
import type { Item } from './api';

const GAP = 3;      // photographs, not cards: they nearly touch

/** The row height aimed for: about two rows of portraits on a phone held
 *  upright, more photographs a row as the screen grows. */
function targetFor(width: number) {
  if (width < 420) return 170;
  if (width < 760) return 200;
  if (width < 1100) return 230;
  if (width < 1500) return 250;
  return 270;
}

export default function Grid({
  items,
  onOpen,
  onToggle,
  locked,
}: {
  items: Item[];
  onOpen: (index: number) => void;
  onToggle: (item: Item) => void;
  locked: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [top, setTop] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [viewport, setViewport] = useState(() => window.innerHeight);

  const measure = useCallback(() => {
    const el = host.current;
    if (!el) return;
    /* clientWidth includes the grid's inline padding. Measuring that padded
     * width made every row a few pixels wider than its actual content box and
     * produced a horizontal scrollbar on phones. */
    const style = window.getComputedStyle(el);
    const inlinePadding =
      Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    setWidth(Math.max(0, el.clientWidth - inlinePadding));
    setTop(el.getBoundingClientRect().top + window.scrollY);
    setViewport(window.innerHeight);
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (host.current) observer.observe(host.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    // passive: never let the selection grid be the reason a scroll janks
    const onScroll = () => setScroll(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* JUSTIFIED rows (components/photo-grid/justify.ts, the Google Photos
   * layout): every photograph in its own proportions — the client sees the
   * frame as it was composed, not a square crop of it — rows filling the
   * width exactly, one gap everywhere. */
  const target = targetFor(width || 360);
  const layout = useMemo(
    () => justify(items.map((it) => it.aspect || 1.5), { width: Math.max(1, width), targetHeight: target, gap: GAP }),
    [items, width, target],
  );

  const lo = scroll - top - viewport * 1.2;
  const hi = scroll - top + viewport * 2.2;
  const visible = [];
  for (const row of layout.rows) {
    if (row.y + row.h < lo || row.y > hi) continue;
    for (let index = row.from; index < row.to; index += 1) {
      const item = items[index];
      const box = layout.boxes[index];
      const chosen = item.albumIds.length > 0;
      visible.push(
        <div
          className={`gal-cell${chosen ? ' is-chosen' : ''}`}
          key={item.id}
          style={{ position: 'absolute', insetInlineStart: box.x, top: box.y, width: box.w, height: box.h, background: item.color }}
        >
          <img
            src={item.thumb}
            alt=""
            width={box.w}
            height={box.h}
            decoding="async"
            draggable={false}
            onClick={() => onOpen(index)}
          />
          <button
            className="gal-heart"
            type="button"
            aria-pressed={chosen}
            aria-label={chosen ? 'הסר מהבחירה' : 'בחר תמונה'}
            disabled={locked}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(item);
            }}
          >
            <Heart filled={chosen} />
          </button>
        </div>,
      );
    }
  }

  return (
    <div className="gal-grid" ref={host}>
      <div style={{ position: 'relative', height: layout.height }}>
        {visible}
      </div>
    </div>
  );
}

export function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 20.4 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8A4.7 4.7 0 1 1 19.4 13Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
