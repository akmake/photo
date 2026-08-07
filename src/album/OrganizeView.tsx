import { useState } from 'react';
import SpreadThumb from './SpreadThumb';
import { IcGallery, IcSparkle } from '../design/Icons';
import type { AlbumPhoto, AlbumProject, PrintProductProfile } from './model';
import type { PreflightIssue } from './preflightEngine';

interface Props {
  project: AlbumProject;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  issues: PreflightIssue[];
  onOpenSpread(spreadId: string): void;
  onReorder(from: number, to: number): void;
  onAddSpread(): void;
  onAddPhotos(): void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'טיוטה',
  review: 'בהגהה',
  approved: 'מאושרת',
};

/* The album-level view: every spread at once, in order.
 *
 * This is the home of the module, not the single-spread editor. A photographer
 * judges an album by its rhythm — where the heavy pages fall, whether two
 * portrait spreads sit back to back — and that is invisible when you can only
 * ever see one spread at a time. */
export default function OrganizeView({
  project, photos, profile, issues, onOpenSpread, onReorder, onAddSpread, onAddPhotos,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const issuesBySpread = new Map<string, PreflightIssue[]>();
  issues.forEach((issue) => {
    if (!issue.spreadId) return;
    const list = issuesBySpread.get(issue.spreadId) ?? [];
    list.push(issue);
    issuesBySpread.set(issue.spreadId, list);
  });

  const placed = new Set(project.spreads.flatMap((spread) => spread.photoIds));
  const unplaced = photos.filter((photo) => !placed.has(photo.id)).length;

  function drop(to: number) {
    if (dragIndex !== null && dragIndex !== to) onReorder(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  }

  /* A brand-new album has no photos, and the tray that holds them lives in the
   * spread editor — so from here there was no way in at all. The album view has
   * to own the first step of the album. */
  if (!photos.length) {
    return (
      <div className="album-organize">
        <div className="organize-blank">
          <IcGallery size={30} />
          <strong>האלבום עוד ריק</strong>
          <span>בחרי את התמונות שייכנסו לאלבום — אפשר תמיד להוסיף ולהחליף אחר כך</span>
          <button className="organize-import" onClick={onAddPhotos}>הוספת תמונות</button>
        </div>
      </div>
    );
  }

  return (
    <div className="album-organize">
      <div className="organize-head">
        <div>
          <strong>{project.spreads.length} כפולות</strong>
          <span>
            {photos.length} תמונות · {unplaced ? `${unplaced} טרם שובצו` : 'כולן שובצו'}
          </span>
        </div>
        <button className="organize-add" onClick={onAddSpread}>+ כפולה</button>
      </div>

      <div className="organize-grid">
        {project.spreads.map((spread, index) => {
          const spreadIssues = issuesBySpread.get(spread.id) ?? [];
          const blockers = spreadIssues.filter((issue) => issue.severity === 'blocker').length;
          const warnings = spreadIssues.length - blockers;
          return (
            <article
              key={spread.id}
              className={[
                'organize-card',
                spread.id === project.activeSpreadId ? 'current' : '',
                dragIndex === index ? 'dragging' : '',
                overIndex === index && dragIndex !== index ? 'drop-target' : '',
              ].filter(Boolean).join(' ')}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              onDragOver={(event) => { event.preventDefault(); setOverIndex(index); }}
              onDrop={(event) => { event.preventDefault(); drop(index); }}
            >
              <button
                className="organize-open"
                onClick={() => onOpenSpread(spread.id)}
                aria-label={`עריכת עמודים ${spread.pageStart}–${spread.pageStart + 1}`}
              >
                <SpreadThumb
                  spread={spread}
                  photos={photos}
                  profile={profile}
                  styleName={project.styleName}
                  showPageNumbers={false}
                />
              </button>
              <footer className="organize-meta">
                <b>עמודים {spread.pageStart}–{spread.pageStart + 1}</b>
                <span className={`organize-status ${spread.status}`}>
                  {STATUS_LABEL[spread.status] ?? spread.status}
                </span>
                {spread.photoIds.length === 0 && <em className="organize-empty-tag">ריקה</em>}
                {blockers > 0 && <em className="organize-flag blocker">{blockers === 1 ? 'בעיה חוסמת' : `${blockers} חוסמות`}</em>}
                {blockers === 0 && warnings > 0 && <em className="organize-flag warn">{warnings === 1 ? 'אזהרה' : `${warnings} אזהרות`}</em>}
              </footer>
            </article>
          );
        })}
      </div>

      {!project.spreads.length && (
        <div className="organize-blank">
          <IcGallery size={26} />
          <strong>אין עדיין כפולות</strong>
          <span>הוסיפי כפולה כדי להתחיל לבנות את האלבום</span>
        </div>
      )}

      <p className="organize-hint">
        <IcSparkle size={15} />
        לחיצה על כפולה פותחת אותה לעריכה · גררי כפולה כדי לשנות את סדר הסיפור
      </p>
    </div>
  );
}
