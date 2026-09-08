/* The grid of a whole wedding, on a phone.
 *
 * Six hundred <img> tags at once is what makes a proofing gallery feel broken:
 * the browser decodes every one of them, memory climbs, and the scroll stutters
 * exactly while the client is trying to decide. So only the rows that are on
 * screen exist in the DOM — the rest is one tall spacer holding the scrollbar
 * honest.
 *
 * Written by hand rather than pulled in: the whole app has React and nothing
 * else, and a fixed-size square grid is the one case where virtualising is
 * arithmetic, not a library.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Item } from './api';

const GAP = 3;      // photographs, not cards: they nearly touch
const OVERSCAN = 3; // rows kept alive above and below, so a flick stays fed

function columnsFor(width: number) {
  if (width < 420) return 2;
  if (width < 760) return 3;
  if (width < 1100) return 4;
  if (width < 1500) return 5;
  return 6;
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
    setWidth(el.clientWidth);
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

  const columns = columnsFor(width || 360);
  const cell = width ? (width - GAP * (columns - 1)) / columns : 0;
  const rowHeight = cell + GAP;
  const rows = Math.ceil(items.length / columns);

  const first = Math.max(0, Math.floor((scroll - top) / rowHeight) - OVERSCAN);
  const last = Math.min(
    rows,
    Math.ceil((scroll + viewport - top) / rowHeight) + OVERSCAN,
  );

  const visible = [];
  for (let row = first; row < last; row++) {
    visible.push(
      <div className="gal-row" key={row} style={{ height: cell, gap: GAP }}>
        {items.slice(row * columns, row * columns + columns).map((item, n) => {
          const index = row * columns + n;
          const chosen = item.albumIds.length > 0;
          return (
            <div
              className={`gal-cell${chosen ? ' is-chosen' : ''}`}
              key={item.id}
              style={{ width: cell, height: cell, background: item.color }}
            >
              <img
                src={item.thumb}
                alt=""
                width={cell}
                height={cell}
                loading="lazy"
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
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div className="gal-grid" ref={host}>
      <div style={{ height: Math.max(0, rows * rowHeight - GAP) }}>
        <div style={{ transform: `translateY(${first * rowHeight}px)` }}>
          {visible}
        </div>
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
