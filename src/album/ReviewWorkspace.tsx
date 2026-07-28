import { useMemo, useState } from 'react';
import { assessCrop } from './cropEngine';
import { buildAlbumLayoutCandidates, EMPTY_GENERATED_LAYOUT } from './layoutEngine';
import type {
  AlbumPhoto, AlbumProject, PhotoFrameSettings, PrintProductProfile,
  ReviewComment, ReviewVersion,
} from './model';

const DEFAULT_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

interface Props {
  project: AlbumProject;
  photos: AlbumPhoto[];
  profile: PrintProductProfile;
  onUpdate(project: AlbumProject): void;
  onNewVersion(): void;
  onClose(): void;
}

const STATUS_LABELS: Record<ReviewVersion['status'], string> = {
  sent: 'ממתינה לבדיקה',
  'changes-requested': 'נדרשים תיקונים',
  approved: 'מאושרת',
};

export default function ReviewWorkspace({
  project, photos, profile, onUpdate, onNewVersion, onClose,
}: Props) {
  const versions = project.reviewVersions ?? [];
  const version = versions.find((item) => item.id === project.activeReviewVersionId)
    ?? versions[versions.length - 1];
  const [spreadId, setSpreadId] = useState(version?.spreads[0]?.id ?? '');
  const [author, setAuthor] = useState('לקוחה');
  const [commentText, setCommentText] = useState('');

  const spread = version?.spreads.find((item) => item.id === spreadId)
    ?? version?.spreads[0];
  const layout = useMemo(() => {
    if (!spread) return EMPTY_GENERATED_LAYOUT;
    const candidates = buildAlbumLayoutCandidates(
      spread.photoIds,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
    );
    const generated = candidates.find((candidate) => candidate.id === spread.layoutId)
      ?? candidates[0]
      ?? EMPTY_GENERATED_LAYOUT;
    return spread.customSlots?.length === spread.photoIds.length ? {
      ...generated,
      slots: spread.customSlots,
      photoIds: spread.photoIds,
    } : generated;
  }, [photos, profile.closedHeightMm, profile.closedWidthMm, spread]);

  if (!version || !spread) return null;

  const spreadComments = version.comments.filter((comment) => comment.spreadId === spread.id);
  const openComments = version.comments.filter((comment) => !comment.resolved);

  function updateVersion(patch: Partial<ReviewVersion>) {
    onUpdate({
      ...project,
      reviewVersions: versions.map((item) => (
        item.id === version.id ? { ...item, ...patch } : item
      )),
    });
  }

  function addComment() {
    const text = commentText.trim();
    if (!text) return;
    const comment: ReviewComment = {
      id: `comment-${Date.now()}`,
      spreadId: spread.id,
      author: author.trim() || 'לקוחה',
      text,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    updateVersion({
      comments: [...version.comments, comment],
      status: 'changes-requested',
      approvedAt: undefined,
    });
    setCommentText('');
  }

  function toggleResolved(commentId: string) {
    updateVersion({
      comments: version.comments.map((comment) => comment.id === commentId ? {
        ...comment,
        resolved: !comment.resolved,
        resolvedAt: !comment.resolved ? new Date().toISOString() : undefined,
      } : comment),
    });
  }

  function approve() {
    if (openComments.length) return;
    updateVersion({
      status: 'approved',
      approvedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="review-workspace" role="dialog" aria-modal="true" aria-label="אישור אלבום">
      <header className="review-header">
        <div>
          <strong>אישור אלבום · גרסה {version.number}</strong>
          <span className={`review-status ${version.status}`}>{STATUS_LABELS[version.status]}</span>
          <span className="review-local-note">מצב מקומי · קישור חיצוני יופעל רק לאחר חיבור אחסון מאובטח</span>
        </div>
        <div className="review-header-actions">
          <select
            value={version.id}
            onChange={(event) => onUpdate({ ...project, activeReviewVersionId: event.target.value })}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                גרסה {item.number} · {STATUS_LABELS[item.status]}
              </option>
            ))}
          </select>
          <button onClick={onNewVersion}>גרסה חדשה מהעיצוב הנוכחי</button>
          <button onClick={onClose}>חזרה לעורך</button>
        </div>
      </header>

      <div className="review-body">
        <nav className="review-spread-list" aria-label="כפולות לבדיקה">
          {version.spreads.map((item) => {
            const count = version.comments.filter(
              (comment) => comment.spreadId === item.id && !comment.resolved,
            ).length;
            return (
              <button
                key={item.id}
                className={item.id === spread.id ? 'on' : ''}
                onClick={() => setSpreadId(item.id)}
              >
                <span>עמודים {item.pageStart}–{item.pageStart + 1}</span>
                {count > 0 && <b>{count}</b>}
              </button>
            );
          })}
        </nav>

        <main className="review-canvas">
          <div
            className="review-spread"
            style={{
              background: spread.background,
              aspectRatio: `${profile.spreadWidthMm} / ${profile.spreadHeightMm}`,
            }}
          >
            <div className="review-gutter" />
            {layout.slots.map((slot, index) => {
              const photo = photos.find((item) => item.id === layout.photoIds[index]);
              if (!photo) return null;
              const settings = spread.frameSettings?.[slot.id] ?? DEFAULT_SETTINGS;
              const crop = assessCrop(
                photo,
                slot,
                settings,
                profile.spreadWidthMm / profile.spreadHeightMm,
              );
              return (
                <div
                  key={slot.id}
                  className="review-frame"
                  style={{
                    left: `${slot.x * 100}%`,
                    top: `${slot.y * 100}%`,
                    width: `${slot.width * 100}%`,
                    height: `${slot.height * 100}%`,
                  }}
                >
                  <img
                    src={photo.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{
                      objectFit: crop.fit,
                      objectPosition: `${crop.positionX}% ${crop.positionY}%`,
                      transform: `scale(${crop.fit === 'contain' ? 1 : (settings.zoom ?? 100) / 100})`,
                      transformOrigin: `${crop.positionX}% ${crop.positionY}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <span>עמודים {spread.pageStart}–{spread.pageStart + 1} · גרסה קפואה</span>
        </main>

        <aside className="review-comments">
          <div className="review-comments-head">
            <strong>הערות לכפולה</strong>
            <span>{spreadComments.filter((comment) => !comment.resolved).length} פתוחות</span>
          </div>
          <div className="review-comment-list">
            {spreadComments.map((comment) => (
              <article key={comment.id} className={comment.resolved ? 'resolved' : ''}>
                <div>
                  <strong>{comment.author}</strong>
                  <time>{new Date(comment.createdAt).toLocaleDateString('he-IL')}</time>
                </div>
                <p>{comment.text}</p>
                <button onClick={() => toggleResolved(comment.id)}>
                  {comment.resolved ? 'פתיחת ההערה מחדש' : 'סימון כטופלה'}
                </button>
              </article>
            ))}
            {!spreadComments.length && <div className="review-no-comments">אין הערות לכפולה הזאת.</div>}
          </div>
          <div className="review-comment-form">
            <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="שם" />
            <textarea
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder="מה צריך לשנות בכפולה?"
            />
            <button disabled={!commentText.trim()} onClick={addComment}>הוספת הערה</button>
          </div>
          <div className="review-decision">
            <span>{openComments.length ? `${openComments.length} הערות פתוחות באלבום` : 'אין הערות פתוחות'}</span>
            <button
              className="request-changes"
              onClick={() => updateVersion({ status: 'changes-requested', approvedAt: undefined })}
            >
              בקשת תיקונים
            </button>
            <button className="approve" disabled={openComments.length > 0} onClick={approve}>
              אישור האלבום
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
