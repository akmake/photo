/* One frame, full width.
 *
 * Before the choice is locked it asks two questions: do we want it, and which
 * albums does it go in. The chips are the whole album idea in one control — a
 * heart means "every album", which is nine taps out of ten, and turning a chip
 * off is the exception, handled here on the frame that prompted it rather than
 * as three checkboxes on every one of six hundred cells.
 *
 * After the lock it asks a different question: what needs fixing. Same screen,
 * because it is the same photograph and the couple should not have to learn a
 * second place.
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
  onComment,
  onDone,
}: {
  items: Item[];
  index: number;
  albums: Album[];
  locked: boolean;
  notice: string;
  onIndex: (n: number) => void;
  onClose: () => void;
  onSelect: (item: Item, albumIds: string[]) => void;
  onComment: (item: Item, x: number, y: number, text: string) => Promise<void>;
  onDone: (item: Item, done: boolean) => void;
}) {
  const item = items[index];
  const startX = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setPin(null);
    setText('');
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
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

  /* Where on the photograph they touched, as a fraction of the rendered image
   * — not of the stage, which is letterboxed around it. */
  const place = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!locked) return;
    const box = (e.target as HTMLImageElement).getBoundingClientRect();
    setPin({
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    });
  };

  const send = async () => {
    if (!pin || !text.trim() || sending) return;
    setSending(true);
    try {
      await onComment(item, pin.x, pin.y, text.trim());
      setPin(null);
      setText('');
    } finally {
      setSending(false);
    }
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
        ref={stage}
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
        <div className="gal-frame">
          <img
            key={item.id}
            src={item.preview}
            alt=""
            draggable={false}
            className={loaded ? 'is-loaded' : ''}
            style={{ background: item.color, cursor: locked ? 'crosshair' : 'default' }}
            onLoad={() => setLoaded(true)}
            onClick={place}
          />
          {/* Rings, never filled blobs: a mark that covers what it points at
              is worse than no mark. */}
          {locked &&
            item.notes.map((note) => (
              <i
                key={note.id}
                className="gal-pin is-sent"
                style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%` }}
              />
            ))}
          {pin && (
            <i className="gal-pin" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} />
          )}
        </div>
      </div>

      <div className="gal-controls">
        {notice && <p className="gal-notice">{notice}</p>}

        {!locked ? (
          <>
            <button
              className={`gal-big-heart${chosen ? ' is-on' : ''}`}
              type="button"
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
                      aria-pressed={on}
                      onClick={() => toggleAlbum(album.id)}
                    >
                      {album.name}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="gal-notes">
            {item.version > 1 && (
              <p className="gal-updated">עודכן · גרסה {item.version}</p>
            )}

            {item.notes.map((note) => (
              <p className="gal-note-sent" key={note.id}>
                {note.text}
              </p>
            ))}

            {pin ? (
              <div className="gal-write">
                <textarea
                  value={text}
                  autoFocus
                  rows={2}
                  maxLength={2000}
                  placeholder="מה לתקן כאן?"
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="gal-write-row">
                  <button type="button" className="gal-chip" onClick={() => setPin(null)}>
                    ביטול
                  </button>
                  <button
                    type="button"
                    className="gal-done"
                    disabled={!text.trim() || sending}
                    onClick={send}
                  >
                    {sending ? 'שולח…' : 'שלח לצלם'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="gal-hint">געו במקום בתמונה כדי להעיר עליו</p>
                <button
                  type="button"
                  className={`gal-chip${item.clientDone ? ' is-on' : ''}`}
                  onClick={() => onDone(item, !item.clientDone)}
                >
                  {item.clientDone ? '✓ סיימתי עם התמונה' : 'סיימתי עם התמונה'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
