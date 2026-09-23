import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Album, Item } from './api';
import { Heart } from './Grid';

const INTERVAL_MS = 4000;

export default function Slideshow({
  items,
  albums,
  onClose,
  onSelect,
}: {
  items: Item[];
  albums: Album[];
  onClose: () => void;
  onSelect: (item: Item, albumIds: string[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<number>();

  const current = items[index];
  const chosen = current ? current.albumIds.length > 0 : false;
  const allAlbumIds = albums.map((a) => a.id);

  const next = useCallback(() => {
    setLoaded(false);
    setIndex((i) => (i + 1) % items.length);
  }, [items.length]);

  const prev = useCallback(() => {
    setLoaded(false);
    setIndex((i) => (i - 1 + items.length) % items.length);
  }, [items.length]);

  // Preload next slide
  useEffect(() => {
    const nextIdx = (index + 1) % items.length;
    if (items[nextIdx]) {
      new Image().src = items[nextIdx].preview;
    }
  }, [index, items]);

  // Timer loop
  useEffect(() => {
    if (!playing) {
      window.clearInterval(timerRef.current);
      return;
    }
    timerRef.current = window.setInterval(next, INTERVAL_MS);
    return () => window.clearInterval(timerRef.current);
  }, [playing, next]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'ArrowRight') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, next, prev]);

  if (!current) return null;

  return (
    <div className="gal-slideshow-overlay" role="dialog" aria-modal="true">
      {/* Top progress bar indicating slide time */}
      <div className="gal-slideshow-progress-track">
        <div
          key={index + (playing ? '-play' : '-pause')}
          className={`gal-slideshow-progress-bar ${playing ? 'animate' : ''}`}
          style={{ animationDuration: `${INTERVAL_MS}ms` }}
        />
      </div>

      {/* Top bar controls */}
      <div className="gal-slideshow-top">
        <div className="gal-slideshow-counter">
          {index + 1} / {items.length}
        </div>
        <div className="gal-slideshow-actions">
          <button
            type="button"
            className="gal-slideshow-btn"
            onClick={() => setPlaying((p) => !p)}
            title={playing ? 'השהה (רווח)' : 'הפעל (רווח)'}
          >
            {playing ? '❚❚ השהה' : '▶ המשך'}
          </button>
          <button
            type="button"
            className="gal-slideshow-btn close"
            onClick={onClose}
            title="סגור מצגת (Esc)"
          >
            ✕ יציאה
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="gal-slideshow-stage">
        <img
          key={current.id}
          src={current.preview}
          alt=""
          className={`gal-slideshow-img ${loaded ? 'is-loaded' : ''}`}
          style={{ background: current.color }}
          onLoad={() => setLoaded(true)}
        />
      </div>

      {/* Bottom Floating Bar */}
      <div className="gal-slideshow-bottom">
        <button
          type="button"
          className="gal-slideshow-nav-btn prev"
          onClick={prev}
          title="הקודמת (חץ ימינה)"
        >
          →
        </button>

        <button
          type="button"
          className={`gal-slideshow-heart ${chosen ? 'active' : ''}`}
          onClick={() => onSelect(current, chosen ? [] : allAlbumIds)}
        >
          <Heart filled={chosen} />
          <span>{chosen ? 'נבחרה לאלבום' : 'בחר תמונה זו'}</span>
        </button>

        <button
          type="button"
          className="gal-slideshow-nav-btn next"
          onClick={next}
          title="הבאה (חץ שמאלה)"
        >
          ←
        </button>
      </div>
    </div>
  );
}
