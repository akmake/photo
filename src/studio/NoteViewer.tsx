/* One frame, big, with every note the client left on it.
 *
 * The queue's thumbnail says "somewhere around here". This says exactly where:
 * the photograph at a size a face can be read, each ring numbered in the order
 * the client wrote them — the same numbers the client sees in their gallery,
 * so "number 2" means the same thing on both sides of a phone call.
 */

import { useEffect, useState } from 'react';
import type { GalleryComment } from '../api';
import './note-viewer.css';

export default function NoteViewer({
  frameId,
  src,
  comments,
  isResolved,
  busyId,
  onResolve,
  onClose,
}: {
  frameId: string;
  src: string;
  comments: GalleryComment[];
  isResolved: (c: GalleryComment) => boolean;
  busyId: string | null;
  onResolve: (c: GalleryComment) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const notes = [...comments].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="nv" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="nv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="nv-stage">
          <div className="nv-frame">
            <img src={src} alt="" onLoad={() => setLoaded(true)} className={loaded ? 'is-loaded' : ''} />
            {/* Rings, never filled: a mark that covers what it points at is
                worse than no mark. */}
            {loaded &&
              notes.map((c, n) => (
                <button
                  key={c.id}
                  type="button"
                  className={`nv-pin${active === c.id ? ' is-active' : ''}${isResolved(c) ? ' is-done' : ''}`}
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                  onMouseEnter={() => setActive(c.id)}
                  onMouseLeave={() => setActive(null)}
                  onClick={() => setActive(c.id)}
                  aria-label={`הערה ${n + 1}`}
                >
                  {n + 1}
                </button>
              ))}
          </div>
        </div>

        <aside className="nv-side">
          <div className="nv-head">
            <code className="nv-file">{frameId}</code>
            <button type="button" className="nv-x" onClick={onClose} aria-label="סגור">
              ✕
            </button>
          </div>
          <ol className="nv-list">
            {notes.map((c, n) => {
              const done = isResolved(c);
              return (
                <li
                  key={c.id}
                  className={`nv-note${active === c.id ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                  onMouseEnter={() => setActive(c.id)}
                  onMouseLeave={() => setActive(null)}
                >
                  <b className="nv-n">{n + 1}</b>
                  <div className="nv-body">
                    <p>{c.text}</p>
                    {done ? (
                      <span className="nv-done">טופל ✓</span>
                    ) : (
                      <button
                        type="button"
                        className="nv-resolve"
                        disabled={busyId === c.id}
                        onClick={() => onResolve(c)}
                      >
                        סמן שטופל
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}
