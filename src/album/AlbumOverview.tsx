import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { IcGallery } from '../design/Icons';
import { groupsFromCuts } from './albumFlow';
import type { AlbumPhoto, AlbumProject, PrintProductProfile } from './model';
import type { PreflightIssue } from './preflightEngine';
import SpreadThumb from './SpreadThumb';

interface Props {
  project: AlbumProject;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  issues: PreflightIssue[];
  timelineOpen: boolean;
  initialScrollTop: number;
  onTimelineOpen(open: boolean): void;
  onScrollTop(top: number): void;
  onSelectSpread(index: number): void;
  onOpenSpread(index: number): void;
  onReorderSpreads(from: number, to: number): void;
  onChangeGroups(groups: string[][]): void;
  onCycleLayout(index: number, direction: 1 | -1): void;
  onAddPhotos(): void;
  onAddSpread(): void;
  onRemoveSpread(index: number): void;
}

export default function AlbumOverview({
  project, photos, profile, issues, timelineOpen, initialScrollTop,
  onTimelineOpen, onScrollTop, onSelectSpread, onOpenSpread, onReorderSpreads,
  onChangeGroups, onCycleLayout, onAddPhotos, onAddSpread, onRemoveSpread,
}: Props) {
  const bookRef = useRef<HTMLDivElement>(null);
  const spreadRefs = useRef(new Map<string, HTMLElement>());
  const [dragSpread, setDragSpread] = useState<number | null>(null);
  const [overSpread, setOverSpread] = useState<number | null>(null);
  const [dragPhoto, setDragPhoto] = useState<string | null>(null);
  const [overPhoto, setOverPhoto] = useState<string | null>(null);
  const [hoveredSpread, setHoveredSpread] = useState<number | null>(null);
  const [menuSpread, setMenuSpread] = useState<number | null>(null);

  const order = useMemo(() => project.spreads.flatMap((spread) => spread.photoIds), [project.spreads]);
  const known = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const used = useMemo(() => new Set(order), [order]);
  const sessionById = useMemo(
    () => new Map((project.sessions ?? []).map((session) => [session.id, session])),
    [project.sessions],
  );
  const sessionByPhoto = useMemo(
    () => new Map((project.sessions ?? []).flatMap((session) => (
      session.photoIds.map((id) => [id, session.id] as const)
    ))),
    [project.sessions],
  );
  const unplaced = useMemo(() => photos.filter((photo) => !used.has(photo.id)), [photos, used]);
  const cuts = useMemo(() => {
    const result = new Set<number>();
    let cursor = 0;
    project.spreads.slice(0, -1).forEach((spread) => {
      cursor += spread.photoIds.length;
      if (cursor > 0 && cursor < order.length) result.add(cursor);
    });
    return result;
  }, [order.length, project.spreads]);
  const spreadOfPhoto = useMemo(() => {
    const map = new Map<string, number>();
    project.spreads.forEach((spread, index) => spread.photoIds.forEach((id) => map.set(id, index)));
    return map;
  }, [project.spreads]);

  useEffect(() => {
    if (bookRef.current) bookRef.current.scrollTop = initialScrollTop;
  }, []);

  useEffect(() => {
    const node = spreadRefs.current.get(project.activeSpreadId);
    if (!node || !bookRef.current) return;
    const host = bookRef.current.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (rect.top < host.top + 16 || rect.bottom > host.bottom - 16) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [project.activeSpreadId]);

  function reorderPhoto(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromSession = sessionByPhoto.get(fromId);
    const toSession = sessionByPhoto.get(toId);
    if (fromSession && toSession && fromSession !== toSession) return;
    const next = [...order];
    const from = next.indexOf(fromId);
    if (from < 0) return;
    next.splice(from, 1);
    const to = next.indexOf(toId);
    next.splice(to < 0 ? next.length : to, 0, fromId);
    const sizes = project.spreads.map((spread) => spread.photoIds.length);
    let cursor = 0;
    onChangeGroups(sizes.map((size) => {
      const group = next.slice(cursor, cursor + size);
      cursor += size;
      return group;
    }).filter((group) => group.length));
  }

  function toggleCut(index: number) {
    const nextCuts = new Set(cuts);
    if (nextCuts.has(index)) nextCuts.delete(index);
    else nextCuts.add(index);
    onChangeGroups(groupsFromCuts(order, [...nextCuts]));
  }

  return (
    <section className={`album-overview${timelineOpen ? '' : ' timeline-collapsed'}`} aria-label="האלבום כולו">
      <div
        className="album-book"
        ref={bookRef}
        onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="album-book-column">
          {project.spreads.map((spread, index) => {
            const spreadIssues = issues.filter((issue) => issue.spreadId === spread.id);
            const blockers = spreadIssues.filter((issue) => issue.severity === 'blocker').length;
            const selected = spread.id === project.activeSpreadId;
            const session = spread.sessionId ? sessionById.get(spread.sessionId) : undefined;
            return (
              <Fragment key={spread.id}>
              {spread.sessionStart && session && (
                <div className="album-session-divider">
                  <span>{session.label}</span>
                  <small>{session.photoIds.length} תמונות · פרק עצמאי</small>
                </div>
              )}
              <article
                ref={(node) => { if (node) spreadRefs.current.set(spread.id, node); else spreadRefs.current.delete(spread.id); }}
                className={`album-book-spread${selected ? ' selected' : ''}${dragSpread === index ? ' dragging' : ''}${overSpread === index && dragSpread !== index ? ' drop-target' : ''}`}
                onMouseEnter={() => setHoveredSpread(index)}
                onMouseLeave={() => setHoveredSpread(null)}
              >
                <header>
                  <span><strong>כפולה {String(index + 1).padStart(2, '0')}</strong> · עמודים {spread.pageStart}–{spread.pageStart + 1}</span>
                  <div className="album-spread-hover-actions">
                    {blockers > 0 && <button className="album-issue-link" onClick={() => onOpenSpread(index)}>{blockers} {blockers === 1 ? 'בעיה' : 'בעיות'}</button>}
                    {spreadIssues.length > blockers && <span className="album-warning-dot" title={`${spreadIssues.length - blockers} אזהרות`} />}
                    {spread.locked && <span title="הכפולה נעולה">🔒</span>}
                    <button className="album-spread-edit" onClick={() => onOpenSpread(index)}>עריכה</button>
                    <button
                      className="album-icon-button album-spread-grip"
                      draggable
                      onDragStart={() => setDragSpread(index)}
                      onDragEnd={() => { setDragSpread(null); setOverSpread(null); }}
                      aria-label="גרור לשינוי סדר"
                      title="גרור לשינוי סדר"
                    >⋮⋮</button>
                    <button className="album-icon-button" aria-label={`פעולות כפולה ${index + 1}`} onClick={() => setMenuSpread(menuSpread === index ? null : index)}>•••</button>
                    {menuSpread === index && (
                      <div className="album-context-menu album-spread-menu" role="menu">
                        <button role="menuitem" onClick={() => { onCycleLayout(index, 1); setMenuSpread(null); }}>פריסה אחרת</button>
                        <button role="menuitem" className="danger" onClick={() => { onRemoveSpread(index); setMenuSpread(null); }}>מחיקת כפולה</button>
                      </div>
                    )}
                  </div>
                </header>
                <button
                  className="album-book-spread-canvas"
                  onClick={() => onSelectSpread(index)}
                  onDoubleClick={() => onOpenSpread(index)}
                  onDragOver={(event) => { if (dragSpread !== null) { event.preventDefault(); setOverSpread(index); } }}
                  onDrop={(event) => { event.preventDefault(); if (dragSpread !== null) onReorderSpreads(dragSpread, index); setDragSpread(null); setOverSpread(null); }}
                  aria-pressed={selected}
                  aria-label={`כפולה ${index + 1}, עמודים ${spread.pageStart} עד ${spread.pageStart + 1}. לחץ לבחירה, לחץ פעמיים לעריכה`}
                >
                  {spread.photoIds.length ? (
                    <SpreadThumb spread={spread} photos={photos} profile={profile} styleName={project.styleName} showPageNumbers={false} />
                  ) : (
                    <span className="album-empty-spread"><strong>כפולה ריקה</strong><small>בחר תמונות מהפס</small></span>
                  )}
                </button>
              </article>
              </Fragment>
            );
          })}
          <button className="album-add-spread-inline" onClick={onAddSpread}>＋ כפולה</button>
        </div>
      </div>

      <aside className="album-overview-timeline" aria-label="רצף תמונות">
        <header>
          <div><strong>תמונות</strong><span>{order.length}</span></div>
          {!timelineOpen && <span>{order.length} תמונות · {project.spreads.length} כפולות</span>}
          <button className="album-quiet-button" onClick={onAddPhotos}>＋ תמונות</button>
          <button className="album-icon-button" onClick={() => onTimelineOpen(!timelineOpen)} aria-label={timelineOpen ? 'כווץ את פס התמונות' : 'פתח את פס התמונות'}>{timelineOpen ? '⌄' : '⌃'}</button>
        </header>
        {timelineOpen && (
          <div className="album-timeline-scroll">
            {order.map((id, index) => {
              const photo = known.get(id);
              const gap = index + 1;
              const isCut = cuts.has(gap);
              const nextId = order[index + 1];
              const isSessionBoundary = Boolean(nextId)
                && sessionByPhoto.get(id) !== sessionByPhoto.get(nextId);
              const isHighlighted = hoveredSpread === spreadOfPhoto.get(id);
              return (
                <div className="album-timeline-run" key={id}>
                  <button
                    className={`album-timeline-photo${dragPhoto === id ? ' dragging' : ''}${overPhoto === id ? ' over' : ''}${isHighlighted ? ' highlighted' : ''}`}
                    draggable
                    onDragStart={() => setDragPhoto(id)}
                    onDragEnd={() => { setDragPhoto(null); setOverPhoto(null); }}
                    onDragOver={(event) => { event.preventDefault(); setOverPhoto(id); }}
                    onDrop={(event) => { event.preventDefault(); if (dragPhoto) reorderPhoto(dragPhoto, id); setDragPhoto(null); setOverPhoto(null); }}
                    onClick={() => { const target = spreadOfPhoto.get(id); if (target !== undefined) onSelectSpread(target); }}
                    title={photo?.name ?? id}
                    aria-label={`${photo?.name ?? id}, כפולה ${(spreadOfPhoto.get(id) ?? 0) + 1}`}
                  >
                    {photo ? <img src={photo.url} alt="" loading="lazy" draggable={false} /> : <span>?</span>}
                  </button>
                  {index < order.length - 1 && (
                    <button
                      className={`album-timeline-cut${isCut ? ' active' : ''}${isSessionBoundary ? ' session-boundary' : ''}`}
                      onClick={() => { if (!isSessionBoundary) toggleCut(gap); }}
                      disabled={isSessionBoundary}
                      aria-label={isSessionBoundary ? 'גבול בין סשנים' : isCut ? 'אחד את הכפולות' : 'פצל לכפולה חדשה'}
                      title={isSessionBoundary ? 'גבול קבוע בין סשנים' : isCut ? 'אחד את הכפולות' : 'פצל לכפולה חדשה'}
                    ><span>{isSessionBoundary ? 'סשן' : isCut ? '' : '+'}</span></button>
                  )}
                </div>
              );
            })}
            {unplaced.length > 0 && (
              <div className="album-unplaced">
                <span>לא שובצו · {unplaced.length}</span>
                {unplaced.slice(0, 12).map((photo) => <button key={photo.id} title={photo.name} onClick={onAddPhotos}><img src={photo.url} alt="" loading="lazy" /></button>)}
              </div>
            )}
            {!order.length && <button className="album-timeline-empty" onClick={onAddPhotos}><IcGallery size={18} /> בחר תמונות כדי להתחיל את הספר</button>}
          </div>
        )}
      </aside>
    </section>
  );
}
