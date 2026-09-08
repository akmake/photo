/* One frame, full width, and the only two decisions there are:
 * do we want it, and which albums does it go in.
 *
 * The chips are the whole album idea in one control. A heart means "every
 * album" — that is the default and it is nine taps out of ten. Turning a chip
 * off is the exception, and it is handled here, on the frame that prompted it,
 * rather than as three checkboxes on every one of six hundred cells.
 */

import { useEffect, useRef, useState } from 'react';
import type { Album, Item } from './api';
import { Heart } from './Grid';

const SWIPE = 45; // px before a drag counts as "next frame"

export default function Lightbox({
  items,
  index,
  albums,
  locked,
  notice,
  onIndex,
  onClose,
  onSelect,
}: {
  items: Item[];
  index: number;
  albums: Album[];
  locked: boolean;
  notice: string;
  onIndex: (n: number) => void;
  onClose: () => void;
  onSelect: (item: Item, albumIds: string[]) => void;
}) {
  const item = items[index];
  const startX = useRef(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLoaded(false), [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // The document is RTL, so the arrow that points "forward" on screen is
      // the left one. Matching the arrows to the page, not to the array.
      if (e.key === 'ArrowLeft') onIndex(Math.min(items.length - 1, index + 1));
      if (e.key === 'ArrowRight') onIndex(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onIndex, onClose]);

  /* The next frame and the previous one, fetched while this one is being
   * looked at. A swipe that waits for a download reads as a slow gallery. */
  useEffect(() => {
    [index - 1, index + 1].forEach((n) => {
      if (n >= 0 && n < items.length) new Image().src = items[n].preview;
    });
  }, [index, items]);

  if (!item) return null;
  const chosen = item.albumIds.length > 0;
  const all = albums.map((a) => a.id);

  const toggleHeart = () => onSelect(item, chosen ? [] : all);

  const toggleAlbum = (albumId: string) => {
    // Not chosen yet: touching one album is a heart into that album alone.
    if (!chosen) return onSelect(item, [albumId]);
    const next = item.albumIds.includes(albumId)
      ? item.albumIds.filter((a) => a !== albumId)
      : [...item.albumIds, albumId];
    // Every album off is an un-heart. There is no loved-but-nowhere.
    onSelect(item, next);
  };

  return (
    <div className="gal-box" role="dialog" aria-modal="true">
      <button className="gal-x" type="button" onClick={onClose} aria-label="סגור">
        ✕
      </button>
      <div className="gal-counter">
        {index + 1} / {items.length}
      </div>

      <div
        className="gal-stage"
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - startX.current;
          if (Math.abs(dx) < SWIPE) return;
          onIndex(
            dx > 0
              ? Math.max(0, index - 1)
              : Math.min(items.length - 1, index + 1),
          );
        }}
      >
        <img
          key={item.id}
          src={item.preview}
          alt=""
          draggable={false}
          className={loaded ? 'is-loaded' : ''}
          style={{ background: item.color }}
          onLoad={() => setLoaded(true)}
        />
      </div>

      <div className="gal-controls">
        {notice && <p className="gal-notice">{notice}</p>}

        <button
          className={`gal-big-heart${chosen ? ' is-on' : ''}`}
          type="button"
          disabled={locked}
          onClick={toggleHeart}
          aria-pressed={chosen}
        >
          <Heart filled={chosen} />
          <span>{chosen ? 'נבחרה' : 'בחר'}</span>
        </button>

        {albums.length > 1 && (
          <div className="gal-chips">
            {albums.map((album) => {
              const on = item.albumIds.includes(album.id);
              return (
                <button
                  key={album.id}
                  type="button"
                  className={`gal-chip${on ? ' is-on' : ''}`}
                  disabled={locked}
                  aria-pressed={on}
                  onClick={() => toggleAlbum(album.id)}
                >
                  {album.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
