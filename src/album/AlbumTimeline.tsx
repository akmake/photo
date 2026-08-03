/* יצירת אלבום — the book, not the config strip.
 *
 * Two surfaces, the way SmartAlbums and Fundy both landed on it:
 *   · the BOOK (top)  — big spreads stacked vertically, judged the way a printed
 *                       album is judged. Click a spread to design it; click the
 *                       divider between two spreads to merge them.
 *   · the STRIP (bottom) — every photo in sequence. Drag to reorder, click a gap
 *                       to split a spread, click a cut to merge.
 *
 * A "cut" is a boundary BEFORE a photo index (1..n-1). The whole album is a
 * function of the sequence and the cuts; nothing is written until "בנה אלבום".
 */

import { useEffect, useMemo, useState } from 'react';
import { autoCuts, buildAlbumFromGroups, groupsFromCuts } from './albumFlow';
import type { AlbumPhoto, AlbumSpread, PrintProductProfile } from './model';
import SpreadThumb from './SpreadThumb';
import { IcBook, IcGallery, IcSparkle, IcUpload } from '../design/Icons';

interface Props {
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  initialOrder?: string[];
  onBuild(spreads: AlbumSpread[]): void;
  onDesignSpread(spreads: AlbumSpread[], index: number): void;
  onCancel(): void;
  onAddPhotos(): void;
}

export default function AlbumTimeline({
  photos, profile, initialOrder, onBuild, onDesignSpread, onCancel, onAddPhotos,
}: Props) {
  const pageAspect = profile.closedWidthMm / profile.closedHeightMm;
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  const [order, setOrder] = useState<string[]>(() => {
    const known = new Set(photos.map((p) => p.id));
    const seeded = (initialOrder ?? []).filter((id) => known.has(id));
    const rest = photos.map((p) => p.id).filter((id) => !seeded.includes(id));
    return [...seeded, ...rest];
  });

  useEffect(() => {
    setOrder((prev) => {
      const known = new Set(photos.map((p) => p.id));
      const kept = prev.filter((id) => known.has(id));
      const added = photos.map((p) => p.id).filter((id) => !kept.includes(id));
      if (!added.length && kept.length === prev.length) return prev;
      return [...kept, ...added];
    });
  }, [photos]);

  const [cuts, setCuts] = useState<number[]>(() => autoCuts(order.length));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const groups = useMemo(() => groupsFromCuts(order, cuts), [order, cuts]);
  const spreads = useMemo(
    () => buildAlbumFromGroups(groups, photos, pageAspect),
    [groups, photos, pageAspect],
  );

  const cutSet = useMemo(() => new Set(cuts), [cuts]);
  function splitAt(globalIndex: number) {
    setCuts((prev) => [...new Set([...prev, globalIndex])].sort((a, b) => a - b));
  }
  function mergeAt(globalIndex: number) {
    setCuts((prev) => prev.filter((c) => c !== globalIndex));
  }
  function repace() {
    setCuts(autoCuts(order.length));
  }
  function movePhoto(fromId: string, targetId: string | null) {
    if (fromId === targetId) return;
    setOrder((prev) => {
      const from = prev.indexOf(fromId);
      if (from < 0) return prev;
      const next = [...prev];
      next.splice(from, 1);
      const to = targetId === null ? next.length : next.indexOf(targetId);
      next.splice(to < 0 ? next.length : to, 0, fromId);
      return next;
    });
  }

  if (!photos.length) {
    return (
      <div className="abm">
        <div className="abm-blank">
          <IcGallery size={30} />
          <strong>האלבום עוד ריק</strong>
          <span>בחר את התמונות שייכנסו לאלבום — הן ייפרשו לספר ויתחלקו לכפולות מעצמן.</span>
          <button className="btn btn-primary" onClick={onAddPhotos}>
            <IcUpload size={16} /> הוספת תמונות
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>חזרה</button>
        </div>
      </div>
    );
  }

  // running start index of each group → maps a strip gap to a global cut
  let cursor = 0;
  const groupStart = groups.map((g) => { const s = cursor; cursor += g.length; return s; });
  const spreadOfIndex = (i: number) => {
    let g = 0;
    for (let k = 0; k < groupStart.length; k += 1) if (i >= groupStart[k]) g = k;
    return g;
  };

  return (
    <div className="abm">
      <header className="abm-head">
        <button className="abm-back" onClick={onCancel} aria-label="חזרה לספרייה">
          <span aria-hidden="true">›</span> האלבומים
        </button>
        <div className="abm-title">
          <h1>האלבום</h1>
          <span className="abm-sub">{photos.length} תמונות · {groups.length} כפולות</span>
        </div>
        <span className="abm-spacer" />
        <button className="abm-ghost" onClick={repace} title="החזר את החלוקה לקצב המומלץ">
          <IcSparkle size={15} /> חלק מחדש
        </button>
        <button className="abm-build" onClick={() => onBuild(spreads)}>
          <IcBook size={16} /> בנה אלבום
        </button>
      </header>

      {/* ---------------- the book ---------------- */}
      <div className="abm-book scroll-y">
        <div className="abm-book-col">
          {groups.map((group, gi) => (
            <div className="abm-spread-block" key={`s-${groupStart[gi]}-${group[0] ?? gi}`}>
              {gi > 0 && (
                <div className="abm-merge">
                  <span className="abm-merge-line" />
                  <button
                    className="abm-merge-pill"
                    onClick={() => mergeAt(groupStart[gi])}
                    title="אחד את שתי הכפולות"
                  >
                    <IcSparkle size={13} /> אחד כפולות
                  </button>
                  <span className="abm-merge-line" />
                </div>
              )}

              <div className="abm-spread-label">
                <b>כפולה {gi + 1}</b>
                <span>עמ׳ {spreads[gi].pageStart}–{spreads[gi].pageStart + 1}</span>
                <span className="abm-spacer" />
                <button className="abm-open" onClick={() => onDesignSpread(spreads, gi)}>
                  פתח לעיצוב
                </button>
              </div>

              <button
                className="abm-spread"
                onClick={() => onDesignSpread(spreads, gi)}
                title="פתח את הכפולה לעיצוב"
              >
                <SpreadThumb
                  spread={spreads[gi]}
                  photos={photos}
                  profile={profile}
                  showPageNumbers
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- the strip ---------------- */}
      <div className="abm-strip">
        <div className="abm-strip-head">
          <b>התמונות</b>
          <span className="abm-strip-n">{photos.length}</span>
          <span className="abm-spacer" />
          <span className="abm-strip-hint">גרור לסידור · לחץ בין תמונות לפצל, על הקו לאחד</span>
          <button className="abm-ghost" onClick={onAddPhotos}>
            <IcUpload size={14} /> הוסף
          </button>
        </div>

        <div className="abm-film scroll-x">
          {order.map((id, i) => {
            const photo = byId.get(id);
            const gapIndex = i + 1;
            const isCut = cutSet.has(gapIndex);
            const last = i === order.length - 1;
            return (
              <div className="abm-film-run" key={id}>
                <div
                  className={[
                    'abm-cell',
                    dragId === id ? 'dragging' : '',
                    overId === id && dragId && dragId !== id ? 'over' : '',
                    i === 0 || cutSet.has(i) ? 'spread-start' : '',
                  ].filter(Boolean).join(' ')}
                  draggable
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { e.preventDefault(); setOverId(id); }}
                  onDrop={(e) => { e.preventDefault(); if (dragId) movePhoto(dragId, id); setDragId(null); setOverId(null); }}
                  title={`כפולה ${spreadOfIndex(i) + 1}`}
                >
                  {photo
                    ? <img src={photo.url} alt="" loading="lazy" decoding="async" draggable={false} />
                    : <span className="abm-cell-missing">?</span>}
                </div>

                {!last && (
                  isCut ? (
                    <button
                      className="abm-gap cut"
                      onClick={() => mergeAt(gapIndex)}
                      aria-label="אחד את הכפולות"
                      title="גבול כפולה — לחץ לאיחוד"
                    ><span /></button>
                  ) : (
                    <button
                      className="abm-gap split"
                      onClick={() => splitAt(gapIndex)}
                      aria-label="פצל לכפולה חדשה"
                      title="פצל כאן"
                    ><span /></button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
