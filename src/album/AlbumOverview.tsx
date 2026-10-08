import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { IcGallery } from '../design/Icons';

import type { AlbumPhoto, AlbumProject, PrintProductProfile } from './model';
import type { PreflightIssue } from './preflightEngine';
import { coverSheetOf, coverTemplateOf } from './coverSheet';
import SpreadThumb from './SpreadThumb';

interface Props {
  project: AlbumProject;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  issues: PreflightIssue[];
  initialScrollTop: number;
  onScrollTop(top: number): void;
  onSelectSpread(index: number): void;
  onOpenSpread(index: number): void;
  onReorderSpreads(from: number, to: number): void;
  onCycleLayout(index: number, direction: 1 | -1): void;
  onAddPhotos(): void;
  onAddSpread(): void;
  onRemoveSpread(index: number): void;
  onOpenCover(): void;
}

export default function AlbumOverview({
  project, photos, profile, issues, initialScrollTop,
  onScrollTop, onSelectSpread, onOpenSpread, onReorderSpreads,
  onCycleLayout, onAddPhotos, onAddSpread, onRemoveSpread,
  onOpenCover,
}: Props) {
  const bookRef = useRef<HTMLDivElement>(null);
  const spreadRefs = useRef(new Map<string, HTMLElement>());
  const [dragSpread, setDragSpread] = useState<number | null>(null);
  const [overSpread, setOverSpread] = useState<number | null>(null);
  const [menuSpread, setMenuSpread] = useState<number | null>(null);

  const sessionById = useMemo(
    () => new Map((project.sessions ?? []).map((session) => [session.id, session])),
    [project.sessions],
  );
  /* The flat cover, laid out as it is printed: back, spine, front. In a Hebrew
   * album the front is on the right, so the strip is drawn left-to-right and
   * the order is reversed for a book that opens the other way. */
  const coverZones = useMemo(() => {
    const spec = profile.coverSpec;
    const side = Math.max(1, (spec.totalWidthMm - spec.spineWidthMm) / 2);
    const total = side * 2 + spec.spineWidthMm;
    const front = { kind: 'front' as const, share: (side / total) * 100 };
    const back = { kind: 'back' as const, share: (side / total) * 100 };
    const spine = { kind: 'spine' as const, share: (spec.spineWidthMm / total) * 100 };
    return (project.openingDirection ?? 'rtl') === 'rtl'
      ? [back, spine, front]
      : [front, spine, back];
  }, [profile.coverSpec, project.openingDirection]);
  /* The cover uses the editor's renderer. Each zone opens its design view. */
  const coverSheet = useMemo(() => coverSheetOf(project, profile), [project, profile]);
  const coverDesign = useMemo(
    () => coverTemplateOf(coverSheet, profile, project.openingDirection ?? 'rtl'),
    [coverSheet, profile, project.openingDirection],
  );
  const coverHasPhotos = coverSheet.photoIds.some(Boolean);
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

  return (
    <section className="album-overview" aria-label="האלבום כולו" data-tour="album-overview">
      <div
        className="album-book"
        ref={bookRef}
        onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="album-book-column">
          <div className="album-overview-actions"><button className="album-quiet-button" onClick={onAddPhotos}><IcGallery size={16} />הוסף תמונות לכפולות</button></div>
          {/* The printed cover comes before the book's interior spreads. */}
          <article className="album-book-cover" data-tour="album-cover">
            <header>
              <span>
                <strong>כריכה</strong>
                {' · '}
                {(profile.coverSpec.totalWidthMm / 10).toFixed(profile.coverSpec.totalWidthMm % 10 ? 1 : 0)}
                ×
                {(profile.coverSpec.totalHeightMm / 10).toFixed(profile.coverSpec.totalHeightMm % 10 ? 1 : 0)}
                {' ס״מ · שדרה '}
                {(profile.coverSpec.spineWidthMm / 10).toFixed(profile.coverSpec.spineWidthMm % 10 ? 1 : 0)}
              </span>
              <div className="album-spread-hover-actions">
                <button className="album-spread-edit" onClick={onOpenCover}>עריכה</button>
              </div>
            </header>
            <div
              className="album-cover-strip"
              style={{
                aspectRatio: `${profile.coverSpec.totalWidthMm} / ${profile.coverSpec.totalHeightMm}`,
                background: project.cover?.background ?? '#f8f6f1',
              }}
            >
              <SpreadThumb
                spread={coverSheet}
                photos={photos}
                profile={profile}
                template={coverDesign}
                widthMm={profile.coverSpec.totalWidthMm}
                heightMm={profile.coverSpec.totalHeightMm}
                showPageNumbers={false}
                showGutter={false}
              />
              <div className="album-cover-zones">
                {coverZones.map((zone) => (zone.kind === 'spine' ? (
                  <div className="album-cover-spine" key="spine" style={{ width: `${zone.share}%` }} />
                ) : (
                  <button
                    key={zone.kind}
                    className="album-cover-zone"
                    style={{ width: `${zone.share}%` }}
                    onClick={onOpenCover}
                    aria-label={zone.kind === 'front'
                      ? 'עריכת חזית הכריכה'
                      : 'עריכת גב הכריכה'}
                  >
                    {!coverHasPhotos && (
                      <span className="album-cover-empty">
                        <strong>{zone.kind === 'front' ? 'חזית' : 'גב'}</strong>
                        <small>לחץ לעיצוב הכריכה</small>
                      </span>
                    )}
                  </button>
                )))}
              </div>
            </div>
          </article>
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
                data-tour="album-spread"
                className={`album-book-spread${selected ? ' selected' : ''}${dragSpread === index ? ' dragging' : ''}${overSpread === index && dragSpread !== index ? ' drop-target' : ''}`}
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
                    <span className="album-empty-spread"><strong>כפולה ריקה</strong><small>לחץ פעמיים לעיצוב הכפולה</small></span>
                  )}
                </button>
              </article>
              </Fragment>
            );
          })}
          <button className="album-add-spread-inline" onClick={onAddSpread} data-tour="album-add-spread">＋ כפולה</button>
        </div>
      </div>


    </section>
  );
}
