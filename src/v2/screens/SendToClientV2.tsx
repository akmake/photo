import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../../studio/store';
import {
  galleryCredentials,
  galleryDelete,
  galleryPublishVersion,
  galleryResolve,
  gallerySetStatus,
  getBrand,
  setBrand,
  clearBrand,
  galleryUnlock,
  galleryLock,
  galleryUpdateAlbums,
  galleryPurgeUnselected,
  galleryStorageStats,
  type GalleryStorageStats,
  type GalleryStorageItem,
  createGallery,
} from '../../api';
import {
  batchOfFrame,
  framesOf,
  notRejected,
  useCull,
  framesInBatch,
  setGalleryLink,
  useBatches,
  useProjectFiles,
} from '../../studio/store';
import type { Frame } from '../../api';
import { publishAll, unlinkGallery, useGalleryWatch, type PublishProgress } from '../../studio/galleryLink';
import { galleryPublicUrl, galleryShareText, openClientGallery } from '../../studio/galleryShare';
import NoteViewer from '../../studio/NoteViewer';
import {
  TzIconSend,
  TzIconCopy,
  TzIconWhatsApp,
  TzIconPlus,
  TzIconMinus,
  TzIconTrash,
  TzIconLock,
  TzIconUnlock,
  TzIconCheckCircle,
  TzIconUpload,
  TzIconLayers,
  TzIconExternal,
  TzIconRefresh,
  TzIconCloud,
  TzIconGear,
  TzIconDownload,
  TzIconFileText,
} from '../TzIcons';
import './stages-v2.css';
import './send-to-client-v2.css';

const ENGINE = 'http://127.0.0.1:8756';

interface DraftAlbum {
  name: string;
  quota: number;
}

/* What the client is asked to choose for, before the photographer edits it.
 * A wedding sells the couple's album and one per family, so it opens with
 * three; every other shoot opens with one album and the photographer adds
 * more if he sold them. Offering "הורי החתן" at a newborn session was the
 * program not knowing what job it was looking at. */

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

interface AlbumPreset {
  id: string;
  label: string;
  icon: string;
  albums: DraftAlbum[];
}

const ALBUM_PRESETS: AlbumPreset[] = [
  {
    id: 'wedding',
    label: 'חתונה קלאסית',
    icon: '💍',
    albums: [
      { name: 'האלבום הראשי (הזוג)', quota: 80 },
      { name: 'אלבום הורי החתן', quota: 40 },
      { name: 'אלבום הורי הכלה', quota: 40 },
    ],
  },
  {
    id: 'barmitzvah',
    label: 'בר / בת מצווה',
    icon: '👑',
    albums: [
      { name: 'אלבום בוק', quota: 40 },
      { name: 'אלבום אירוע', quota: 50 },
      { name: 'תמונות להגדלה', quota: 5 },
    ],
  },
  {
    id: 'brit',
    label: 'ברית / ניובורן',
    icon: '👶',
    albums: [
      { name: 'אלבום דיגיטלי', quota: 35 },
      { name: 'תמונות ממוסגרות', quota: 3 },
    ],
  },
  {
    id: 'family',
    label: 'משפחה / הריון',
    icon: '🌿',
    albums: [
      { name: 'אלבום משפחתי', quota: 30 },
      { name: 'תמונות להגדלה', quota: 2 },
    ],
  },
  {
    id: 'single',
    label: 'אלבום יחיד',
    icon: '📷',
    albums: [{ name: 'האלבום הראשי', quota: 50 }],
  },
];

function defaultAlbums(event: string): DraftAlbum[] {
  if (event.includes('חתונה')) {
    return [
      { name: 'האלבום הראשי (הזוג)', quota: 80 },
      { name: 'אלבום הורי החתן', quota: 40 },
      { name: 'אלבום הורי הכלה', quota: 40 },
    ];
  }
  return [{ name: 'האלבום הראשי', quota: 80 }];
}

export default function SendToClientV2({
  project,
  onNext,
  onBack,
  onNavigateToEdit,
  onNavigateToAlbum,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
  onNavigateToEdit?: (frameName?: string) => void;
  onNavigateToAlbum?: () => void;
}) {
  const [showStorageModal, setShowStorageModal] = useState(false);
  const { frames, ready } = useProjectFiles(project.id);
  const watch = useGalleryWatch(project.id);
  const { link, state } = watch;

  return (
    <div className="tz-stage-container">
      {/* Top Stage Header */}
      <section className="tz-stage-header">
        <div className="tz-stage-header-copy">
          <div className="tz-stage-tag">שלב 4 · שלח ללקוח</div>
          <h1>גלריית בחירה אישית ללקוח</h1>
          <p>
            יצירת קישור מעוצב ומאובטח עבור <strong>{project.client}</strong>. הלקוח מסמן את התמונות לאלבומים השונים ומעיר הערות ישירות מהנייד או המחשב,
            והבחירה מסתנכרנת ישירות לכאן.
          </p>
        </div>

        <div className="tz-stage-actions">
          <button
            className="tz-btn-projects-secondary"
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setShowStorageModal(true)}
            title="צפה בכל הגלריות שבאחסון ונצל אפשרויות לפינוי מקום"
          >
            <TzIconCloud size={16} />
            <span>ניהול אחסון וגלריות</span>
          </button>
          {onBack && (
            <button
              className="tz-btn-projects-secondary"
              type="button"
              onClick={onBack}
            >
              ← חזרה לסשנים
            </button>
          )}
          {onNext && (
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={onNext}
            >
              המשך לעריכה ←
            </button>
          )}
        </div>
      </section>

      {!ready ? (
        <div className="tz-sc-card">
          <p style={{ margin: 0, color: '#71717a' }}>טוען את נתוני הפרויקט והקבצים...</p>
        </div>
      ) : !link ? (
        <CreateGalleryFlow
          projectId={project.id}
          clientName={project.client}
          event={project.event}
          frames={frames}
        />
      ) : (
        <LiveGalleryFlow
          projectId={project.id}
          clientName={project.client}
          frames={frames}
          watch={watch}
          state={state}
          link={link}
          onNavigateToEdit={onNavigateToEdit}
          onNavigateToAlbum={onNavigateToAlbum}
        />
      )}

      {showStorageModal && (
        <StorageManagerModal
          isOpen={showStorageModal}
          onClose={() => setShowStorageModal(false)}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   BEFORE GALLERY CREATED (STEP-BY-STEP PUBLISH)
   ========================================================================== */

function CreateGalleryFlow({
  projectId,
  clientName,
  event,
  frames,
}: {
  projectId: string;
  clientName: string;
  event: string;
  frames: Frame[];
}) {
  const batches = useBatches(projectId);
  const [source, setSource] = useState<string>('all');
  const [albums, setAlbums] = useState<DraftAlbum[]>(() => defaultAlbums(event ?? ''));
  const [galleryTitle, setGalleryTitle] = useState<string>(() =>
    clientName ? `${clientName}${event ? ` - ${event}` : ''}` : 'גלריית בחירה',
  );
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  /* What the photographer took out in סינון never reaches the client.
   * Undecided frames go: a suggestion is not a decision. */
  const cull = useCull(projectId);
  const going = useMemo(() => notRejected(projectId, frames), [projectId, frames, cull]);
  const takenOut = frames.length - going.length;
  const chosenFrames = useMemo(
    () => notRejected(projectId, source === 'all' ? frames : framesInBatch(projectId, source)),
    [source, frames, projectId, cull],
  );

  const totalQuota = useMemo(
    () => albums.reduce((acc, a) => acc + (a.quota || 0), 0),
    [albums],
  );

  const handleCreate = useCallback(async () => {
    setError(null);
    const clean = albums
      .map((a) => ({ name: a.name.trim(), quota: Math.max(1, a.quota | 0) }))
      .filter((a) => a.name);

    if (!clean.length) return setError('יש להגדיר לפחות אלבום אחד לבחירה');
    if (!chosenFrames.length) return setError('אין תמונות זמינות לפרסום במקור שנבחר');

    try {
      const made = await createGallery(projectId, galleryTitle.trim() || clientName || 'גלריה', clean);
      setOneTimePassword(made.password);

      const out = await publishAll(
        made.id,
        chosenFrames.map((f) => {
          const groupId = batchOfFrame(projectId, f.name);
          return {
            path: f.path,
            name: f.name,
            groupId,
            groupName: batches.find((batch) => batch.id === groupId)?.name,
          };
        }),
        setProgress,
      );

      setGalleryLink(projectId, {
        galleryId: made.id,
        slug: made.slug,
        username: made.username,
        password: made.password,
        createdAt: Date.now(),
        published: out.done,
        unpublished: out.failed.map((f) => f.name),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'יצירת הגלריה נכשלה');
    }
  }, [albums, batches, chosenFrames, clientName, projectId]);

  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="tz-sc-progress-card">
        <div className="tz-sc-card-header">
          <div className="tz-sc-card-title-wrap">
            <h3 className="tz-sc-card-title">
              <TzIconUpload size={20} />
              מפרסם תמונות לגלריית הלקוח
            </h3>
            <p className="tz-sc-card-desc">
              התמונות מומרות לתצוגה קלה ומאובטחת ועולות לשרת הגלריה...
            </p>
          </div>
          <span className="tz-sc-status-pill active">{pct}% הושלמו</span>
        </div>

        <div className="tz-sc-progress-bar-bg">
          <div className="tz-sc-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="tz-sc-progress-meta">
          <span>
            הועלו {progress.done} מתוך {progress.total} תמונות
          </span>
          {oneTimePassword && (
            <span>
              סיסמת גישה שנוצרה: <strong>{oneTimePassword}</strong>
            </span>
          )}
        </div>

        {progress.failed.length > 0 && (
          <div style={{ background: '#fef2f2', padding: 12, borderRadius: 10, color: '#ef4444', fontSize: 13 }}>
            {progress.failed.length} תמונות לא עלו. בדוק את חיבור הרשת.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tz-sc-container">
      <div className="tz-sc-grid-2col">
        {/* Left Column: Source & Albums */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Card 1: Source */}
          <div className="tz-sc-card">
            <div className="tz-sc-card-header">
              <div className="tz-sc-card-title-wrap">
                <h3 className="tz-sc-card-title">
                  <TzIconLayers size={18} />
                  מקור התמונות לגלריה
                </h3>
                <p className="tz-sc-card-desc">
                  בחר אילו תמונות יפורסמו לבחירת הלקוח. המקור נשאר שמור אצלך, לגלריה עולות רק גרסאות תצוגה מוגנות.
                </p>
              </div>
            </div>

            {takenOut > 0 && (
              <p className="tz-sc-card-desc">
                {takenOut.toLocaleString('he-IL')} תמונות שהוצאו בסינון לא יעלו לגלריה.
              </p>
            )}

            <div className="tz-sc-source-pills">
              <button
                type="button"
                className={`tz-sc-source-pill ${source === 'all' ? 'active' : ''}`}
                onClick={() => setSource('all')}
              >
                כל תמונות הפרויקט
                <span className="tz-sc-pill-badge">{going.length}</span>
              </button>

              {batches.map((b) => {
                const count = notRejected(projectId, framesInBatch(projectId, b.id)).length;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`tz-sc-source-pill ${source === b.id ? 'active' : ''}`}
                    onClick={() => setSource(b.id)}
                  >
                    {b.name}
                    <span className="tz-sc-pill-badge">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card 2: Albums & Quotas */}
          <div className="tz-sc-card">
            <div className="tz-sc-card-header">
              <div className="tz-sc-card-title-wrap">
                <h3 className="tz-sc-card-title">
                  <TzIconSend size={18} />
                  הגדרת שם הגלריה ומכסות האלבומים
                </h3>
                <p className="tz-sc-card-desc">
                  התאם את שם הגלריה והאלבומים לבחירת הלקוח. המערכת תאכוף את המכסה ותאפשר בחירה נפרדת לכל אלבום.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#27272a' }}>
                שם הגלריה / האירוע (יוצג ללקוח בכניסה ובקישור):
              </label>
              <input
                type="text"
                className="tz-sc-title-input"
                value={galleryTitle}
                onChange={(e) => setGalleryTitle(e.target.value)}
                placeholder="לדוגמה: יובל ודניאל - חתונת צהריים"
              />
            </div>

            <div className="tz-sc-presets-wrap">
              <span className="tz-sc-presets-label">חבילות אלבומים נפוצות לבחירה מהירה:</span>
              <div className="tz-sc-presets-list">
                {ALBUM_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="tz-sc-preset-pill"
                    onClick={() => setAlbums(p.albums.map((a) => ({ ...a })))}
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="tz-sc-albums-list">
              {albums.map((album, i) => (
                <div key={i} className="tz-sc-album-row">
                  <input
                    type="text"
                    className="tz-sc-album-name-input"
                    value={album.name}
                    placeholder="שם האלבום (לדוגמה: הזוג)"
                    onChange={(e) =>
                      setAlbums((list) =>
                        list.map((a, n) => (n === i ? { ...a, name: e.target.value } : a)),
                      )
                    }
                  />

                  <div className="tz-sc-stepper">
                    <button
                      type="button"
                      className="tz-sc-step-btn"
                      title="-5 תמונות"
                      onClick={() =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: Math.max(1, (a.quota || 0) - 5) } : a,
                          ),
                        )
                      }
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      className="tz-sc-step-btn"
                      title="-1 תמונה"
                      onClick={() =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: Math.max(1, (a.quota || 0) - 1) } : a,
                          ),
                        )
                      }
                    >
                      <TzIconMinus size={13} />
                    </button>

                    <input
                      type="number"
                      min={1}
                      className="tz-sc-step-val"
                      value={album.quota}
                      onChange={(e) =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: Number(e.target.value) || 0 } : a,
                          ),
                        )
                      }
                    />
                    <span className="tz-sc-step-label">תמונות</span>

                    <button
                      type="button"
                      className="tz-sc-step-btn"
                      title="+1 תמונה"
                      onClick={() =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: (a.quota || 0) + 1 } : a,
                          ),
                        )
                      }
                    >
                      <TzIconPlus size={13} />
                    </button>
                    <button
                      type="button"
                      className="tz-sc-step-btn"
                      title="+5 תמונות"
                      onClick={() =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: (a.quota || 0) + 5 } : a,
                          ),
                        )
                      }
                    >
                      +5
                    </button>
                  </div>

                  <button
                    type="button"
                    className="tz-sc-del-btn"
                    title="הסר אלבום"
                    onClick={() => setAlbums((list) => list.filter((_, n) => n !== i))}
                  >
                    <TzIconTrash size={15} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="tz-sc-add-album-btn"
                onClick={() => setAlbums((l) => [...l, { name: '', quota: 40 }])}
              >
                <TzIconPlus size={15} />
                הוסף אלבום נוסף לבחירה
              </button>
            </div>

            <div className="tz-sc-quota-summary">
              <span>סה״כ מכסת בחירה ללקוח:</span>
              <strong>{totalQuota} תמונות ב-{albums.length} אלבומים</strong>
            </div>

            {error && (
              <div style={{ background: '#fef2f2', padding: 12, borderRadius: 10, color: '#ef4444', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="button"
              className="tz-sc-publish-btn"
              onClick={handleCreate}
              disabled={!chosenFrames.length}
            >
              <TzIconSend size={18} />
              צור גלריה ופרסם {chosenFrames.length} תמונות ל{clientName}
            </button>
          </div>
        </div>

        {/* Right Column: Studio Brand */}
        <div>
          <StudioBrandCard />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   LIVE GALLERY FLOW (ONCE PUBLISHED)
   ========================================================================== */

function LiveGalleryFlow({
  projectId,
  clientName,
  frames,
  watch,
  state,
  link,
  onNavigateToEdit,
  onNavigateToAlbum,
}: {
  projectId: string;
  clientName: string;
  frames: Frame[];
  watch: ReturnType<typeof useGalleryWatch>;
  state: ReturnType<typeof useGalleryWatch>['state'];
  link: NonNullable<ReturnType<typeof useGalleryWatch>['link']>;
  onNavigateToEdit?: (frameName?: string) => void;
  onNavigateToAlbum?: () => void;
}) {
  const [password, setPassword] = useState<string | null>(link.password ?? null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waMode, setWaMode] = useState<'invite' | 'reminder' | 'updated'>('invite');
  const batches = useBatches(projectId);
  const [resending, setResending] = useState<PublishProgress | null>(null);
  const unpublished = link.unpublished ?? [];

  const [editingAlbums, setEditingAlbums] = useState(false);
  const [draftAlbums, setDraftAlbums] = useState<DraftAlbum[]>(() =>
    (state?.gallery.albums || []).map((a) => ({ name: a.name, quota: a.quota })),
  );
  const [copiedLightroom, setCopiedLightroom] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeNotice, setPurgeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!editingAlbums && state?.gallery.albums) {
      setDraftAlbums(state.gallery.albums.map((a) => ({ name: a.name, quota: a.quota })));
    }
  }, [state?.gallery.albums, editingAlbums]);

  const handleCopyLightroom = () => {
    const ids = (state?.selection || []).map((s) => s.frameId);
    if (!ids.length) return;
    void navigator.clipboard.writeText(ids.join(', ')).then(() => {
      setCopiedLightroom(true);
      setTimeout(() => setCopiedLightroom(false), 2500);
    });
  };

  const handleDownloadReport = () => {
    if (!state) return;
    const lines = [
      `דוח בחירות תמונות - ${clientName}`,
      `תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}`,
      `סטטוס: ${isLocked ? 'נעול לבחירה' : 'בחירה פעילה'}`,
      `סה״כ תמונות שנבחרו: ${state.selection.length}`,
      '--------------------------------------------------',
    ];
    for (const alb of state.gallery.albums) {
      const inAlb = state.selection
        .filter((s) => s.albumIds.includes(alb.id))
        .map((s) => s.frameId);
      lines.push(`\n[${alb.name}] - ${inAlb.length} מתוך מכסה של ${alb.quota}:`);
      inAlb.forEach((f, idx) => lines.push(`  ${idx + 1}. ${f}`));
    }
    if (state.comments.length) {
      lines.push('\n--------------------------------------------------');
      lines.push(`הערות ובקשות תיקון מיוחדות (${state.comments.length}):`);
      state.comments.forEach((c, idx) => {
        lines.push(`  #${idx + 1} בתמונה ${c.frameId}: ${c.text} ${c.resolvedAt ? '(טופל ✓)' : '(פתוח)'}`);
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `${clientName || 'גלריה'}-בחירות.txt`;
    a.click();
    URL.revokeObjectURL(dlUrl);
  };

  const handlePurgeUnselected = async () => {
    if (!confirm('האם לפנות מקום באחסון ולמחוק את כל התמונות שלא נבחרו על ידי הלקוח?\nהתמונות שנבחרו והערות הלקוח יישארו בגלריה ללא פגע.')) {
      return;
    }
    setPurging(true);
    setPurgeNotice(null);
    try {
      const res = await galleryPurgeUnselected(link.galleryId);
      setPurgeNotice(`פונתה כמות של ${formatBytes(res.freedBytes)} (${res.purgedCount} תמונות שלא נבחרו נמחקו מהענן)`);
      watch.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'פינוי תמונות נכשל');
    } finally {
      setPurging(false);
    }
  };

  /* Send again only what did not arrive. What is still failing afterwards
   * stays on the link, named; what arrived is counted in. */
  const resend = async () => {
    const wanted = new Set(unpublished);
    const retry = frames.filter((f) => wanted.has(f.name));
    const gone = unpublished.filter((name) => !retry.some((f) => f.name === name));
    setResending({ done: 0, total: retry.length, failed: [] });
    try {
      const out = await publishAll(
        link.galleryId,
        retry.map((f) => {
          const groupId = batchOfFrame(projectId, f.name);
          return {
            path: f.path,
            name: f.name,
            groupId,
            groupName: batches.find((batch) => batch.id === groupId)?.name,
          };
        }),
        setResending,
      );
      setGalleryLink(projectId, {
        ...link,
        published: link.published + out.done,
        // A file no longer in the folder cannot be sent; it stays named.
        unpublished: [...out.failed.map((f) => f.name), ...gone],
      });
    } finally {
      setResending(null);
    }
  };

  const url = galleryPublicUrl(link.slug);
  const accessPassword = password || link.password || '';

  const waText = useMemo(() => {
    if (!url || !accessPassword) return '';
    if (waMode === 'reminder') {
      const totalPicked = state?.selection?.length ?? 0;
      const totalQuota = state?.gallery?.albums?.reduce((a, b) => a + (b.quota || 0), 0) ?? 0;
      return [
        `היי ${clientName}, מה שלומכם?`,
        totalQuota > 0
          ? `תזכורת חמה: קישור הגלריה שלכם ממתין להמשך בחירת התמונות (${totalPicked}/${totalQuota} תמונות נבחרו עד כה).`
          : 'תזכורת חמה: קישור הגלריה שלכם ממתין לבחירת התמונות לאלבומים.',
        'נשמח לעזור בכל שאלה כדי שנוכל להתקדם לעיצוב האלבום!',
        url,
        `שם משתמש: ${link.username}`,
        `סיסמה: ${accessPassword}`,
      ].join('\n');
    }
    if (waMode === 'updated') {
      return [
        `היי ${clientName}, חדשות מעולות!`,
        'עדכנו עבורכם בגלריה גרסאות חדשות ומלוטשות לתמונות עם התיקונים שביקשתם.',
        'מוזמנים להיכנס לצפות (יש כפתור השוואה בלחיצה מול המקור):',
        url,
        `שם משתמש: ${link.username}`,
        `סיסמה: ${accessPassword}`,
      ].join('\n');
    }
    return galleryShareText(clientName, url, link.username, accessPassword);
  }, [clientName, url, link.username, accessPassword, waMode, state]);

  const copyLink = () => {
    if (!url || !accessPassword) return;
    void navigator.clipboard.writeText(waText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  };

  const whatsappUrl = waText
    ? `https://api.whatsapp.com/send?text=${encodeURIComponent(waText)}`
    : null;

  const reissue = async () => {
    setBusy(true);
    try {
      const out = await galleryCredentials(link.galleryId);
      setGalleryLink(projectId, { ...link, username: out.username, password: out.password });
      setPassword(out.password);
    } finally {
      setBusy(false);
    }
  };

  const removeGallery = async () => {
    if (!confirm('האם למחוק את הגלריה? הקישור של הלקוח יפסיק לעבוד והתמונות יוסרו משרת התצוגה.'))
      return;
    setBusy(true);
    try {
      await galleryDelete(link.galleryId);
      unlinkGallery(projectId);
    } finally {
      setBusy(false);
    }
  };

  const status = state?.gallery.status ?? 'active';
  const isLocked = Boolean(state?.gallery.lockedAt);
  const isImported = Boolean(link.importedAt);

  return (
    <div className="tz-sc-container">
      {/* Live Header Bar */}
      <div className="tz-sc-live-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {status === 'frozen' ? (
            <span className="tz-sc-status-pill frozen">הגלריה מוקפאת — הקישור אינו זמין</span>
          ) : isImported ? (
            <span className="tz-sc-status-pill active">
              <span className="tz-sc-pulse-dot" />
              הבחירה הושלמה ויובאה לפרויקט
            </span>
          ) : isLocked ? (
            <span className="tz-sc-status-pill locked">
              <span className="tz-sc-pulse-dot" />
              הלקוח סיים לבחור (נעול)
            </span>
          ) : (
            <span className="tz-sc-status-pill active">
              <span className="tz-sc-pulse-dot" />
              הגלריה באוויר וממתינה לבחירת הלקוח
            </span>
          )}
        </div>

        <div className="tz-sc-live-actions">
          {status === 'active' ? (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void gallerySetStatus(link.galleryId, 'frozen').then(watch.refresh)}
            >
              <TzIconLock size={14} />
              הקפא גישה
            </button>
          ) : (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void gallerySetStatus(link.galleryId, 'active').then(watch.refresh)}
            >
              <TzIconUnlock size={14} />
              החזר גישה
            </button>
          )}

          {isLocked ? (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void galleryUnlock(link.galleryId).then(watch.refresh)}
              title="פתח מחדש את הגלריה לביצוע שינויים על ידי הלקוח"
            >
              <TzIconUnlock size={14} />
              פתח בחירה מחדש
            </button>
          ) : (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void galleryLock(link.galleryId).then(watch.refresh)}
              title="נעל את הבחירה באופן ידני"
            >
              <TzIconLock size={14} />
              נעל בחירה ידנית
            </button>
          )}

          <button
            type="button"
            className="tz-sc-subtle-btn danger"
            disabled={busy}
            onClick={removeGallery}
          >
            <TzIconTrash size={14} />
            מחק גלריה
          </button>
        </div>
      </div>

      {/* Quick Tools & Operations Bar */}
      <div className="tz-sc-quick-tools">
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#52525b' }}>פעולות מהירות לצלם:</span>

        {state && state.selection.length > 0 && (
          <>
            <button
              type="button"
              className="tz-sc-quick-tool-btn"
              onClick={handleCopyLightroom}
              title="העתק רשימת שמות קבצים שנבחרו לחיפוש מהיר בלייטרום או Finder"
            >
              <TzIconCopy size={14} />
              {copiedLightroom ? 'הועתק ללוח! ✓' : 'העתק שמות ללייטרום 📋'}
            </button>

            <button
              type="button"
              className="tz-sc-quick-tool-btn"
              onClick={handleDownloadReport}
              title="הורד דוח טקסט מסודר של כל הבחירות לפי אלבום"
            >
              <TzIconDownload size={14} />
              דוח בחירות (TXT) 📄
            </button>

            <button
              type="button"
              className="tz-sc-quick-tool-btn"
              disabled={purging}
              onClick={handlePurgeUnselected}
              title="מחק מהאחסון רק את התמונות שהלקוח לא בחר כדי לפנות נפח ענן יקר"
            >
              <span>🧹</span>
              {purging ? 'מפנה מקום...' : 'פנה תמונות שלא נבחרו'}
            </button>
          </>
        )}

        <button
          type="button"
          className="tz-sc-quick-tool-btn"
          onClick={() => {
            setDraftAlbums((state?.gallery.albums || []).map((a) => ({ name: a.name, quota: a.quota })));
            setEditingAlbums(!editingAlbums);
          }}
          title="ערוך והתאם את מכסות האלבומים או הוסף אלבום נוסף"
        >
          <TzIconGear size={14} />
          {editingAlbums ? 'סגור עריכת אלבומים' : 'ערוך אלבומים ומכסות'}
        </button>
      </div>

      {purgeNotice && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: 12, borderRadius: 10, color: '#065f46', fontSize: 13, fontWeight: 600 }}>
          {purgeNotice}
        </div>
      )}

      {/* Frames that never reached the gallery. The client cannot see them,
          and until now nothing said so once the upload screen had gone. */}
      {(unpublished.length > 0 || resending) && (
        <div className="tz-sc-unpublished" aria-live="polite">
          {resending ? (
            <span>
              שולח שוב {resending.done.toLocaleString('he-IL')} מתוך {resending.total.toLocaleString('he-IL')}…
            </span>
          ) : (
            <>
              <div className="tz-sc-unpublished-head">
                <span>
                  <b>{unpublished.length.toLocaleString('he-IL')} תמונות לא עלו לגלריה</b> — הלקוח לא רואה אותן.
                </span>
                <button type="button" className="tz-btn-projects-primary" onClick={resend}>
                  שלח שוב את {unpublished.length.toLocaleString('he-IL')} שלא עלו
                </button>
              </div>
              <ul>
                {unpublished.map((name) => (
                  <li key={name} dir="ltr">
                    {name}
                    {!frames.some((f) => f.name === name) && <span> · לא נמצא בתיקייה</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="tz-sc-grid-2col">
        {/* Left Column: Share Card & Meters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Card 1: Direct Share & WhatsApp (Matching TEZA AI Reference) */}
          <div className="tz-sc-share-card">
            <div className="tz-sc-card-header">
              <div className="tz-sc-card-title-wrap">
                <h3 className="tz-sc-card-title">קישור ישיר לגלריה</h3>
                <p className="tz-sc-card-desc">
                  שתף את הגלריה בלחיצה אחת ישירות לוואטסאפ של {clientName} או העתק את הקישור.
                </p>
              </div>
            </div>

            <div className="tz-sc-link-row">
              <span className="tz-sc-url-text">
                {url || 'קישור ציבורי יחובר בעת פרסום שרת הגלריות'}
              </span>
              <button
                type="button"
                className={`tz-sc-copy-btn ${copied ? 'copied' : ''}`}
                onClick={copyLink}
                disabled={!url || !accessPassword}
              >
                {copied ? <TzIconCheckCircle size={15} /> : <TzIconCopy size={15} />}
                {copied ? 'הועתק!' : 'העתק קישור'}
              </button>
              <button
                type="button"
                className="tz-sc-subtle-btn"
                title="ראה בדיוק מה הלקוח רואה"
                onClick={() => openClientGallery(link.slug, url)}
              >
                <TzIconExternal size={14} />
                ראה כלקוח
              </button>
            </div>

            {whatsappUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="tz-sc-wa-tabs">
                  <button
                    type="button"
                    className={`tz-sc-wa-tab ${waMode === 'invite' ? 'active' : ''}`}
                    onClick={() => setWaMode('invite')}
                  >
                    הזמנה ראשונה
                  </button>
                  <button
                    type="button"
                    className={`tz-sc-wa-tab ${waMode === 'reminder' ? 'active' : ''}`}
                    onClick={() => setWaMode('reminder')}
                  >
                    תזכורת בחירה
                  </button>
                  <button
                    type="button"
                    className={`tz-sc-wa-tab ${waMode === 'updated' ? 'active' : ''}`}
                    onClick={() => setWaMode('updated')}
                  >
                    עדכון תיקונים (v2)
                  </button>
                </div>

                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="tz-sc-whatsapp-btn"
                >
                  <TzIconWhatsApp size={20} />
                  {waMode === 'invite'
                    ? `שלח הזמנה ופרטי כניסה בוואטסאפ ל${clientName}`
                    : waMode === 'reminder'
                    ? `שלח תזכורת בחירה בוואטסאפ ל${clientName}`
                    : `שלח הודעת עדכון תיקונים בוואטסאפ ל${clientName}`}
                </a>
              </div>
            ) : (
              <p className="tz-sc-card-desc">
                התצוגה המקומית זמינה לבדיקה. שליחה ללקוח תופעל לאחר חיבור כתובת הגלריה הציבורית.
              </p>
            )}

            <div className="tz-sc-creds-row">
              <div className="tz-sc-creds-values">
                <span>משתמש: <code>{link.username}</code></span>
                {accessPassword && <span>סיסמה: <code>{accessPassword}</code></span>}
              </div>
              <button
                type="button"
                className="tz-sc-subtle-btn"
                disabled={busy}
                onClick={reissue}
              >
                <TzIconRefresh size={13} />
                הנפק פרטים מחדש
              </button>
            </div>
          </div>

          {/* Card 2: Live Album Selection Progress & Dynamic Editor */}
          {state && state.gallery.albums.length > 0 && (
            <div className="tz-sc-card">
              <div className="tz-sc-card-header">
                <div className="tz-sc-card-title-wrap">
                  <h3 className="tz-sc-card-title">
                    <span>התקדמות בחירת האלבומים</span>
                  </h3>
                  <p className="tz-sc-card-desc">
                    מעקב חי אחר כמות התמונות שסומנו על ידי הלקוח בכל אלבום.
                  </p>
                </div>

                <button
                  type="button"
                  className="tz-sc-subtle-btn"
                  onClick={() => {
                    setDraftAlbums((state.gallery.albums || []).map((a) => ({ name: a.name, quota: a.quota })));
                    setEditingAlbums(!editingAlbums);
                  }}
                >
                  <TzIconGear size={14} />
                  {editingAlbums ? 'סגור עריכה' : 'ערוך אלבומים ומכסות'}
                </button>
              </div>

              {editingAlbums ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#71717a' }}>
                    באפשרותך לעדכן שמות אלבומים, להגדיל או להקטין מכסות, או להוסיף אלבום נוסף שהלקוח רכש.
                  </p>
                  <div className="tz-sc-albums-list">
                    {draftAlbums.map((a, i) => (
                      <div key={i} className="tz-sc-album-row">
                        <input
                          type="text"
                          className="tz-sc-album-name-input"
                          value={a.name}
                          onChange={(e) =>
                            setDraftAlbums((l) =>
                              l.map((it, n) => (n === i ? { ...it, name: e.target.value } : it)),
                            )
                          }
                        />
                        <div className="tz-sc-stepper">
                          <button
                            type="button"
                            className="tz-sc-step-btn"
                            title="-5"
                            onClick={() =>
                              setDraftAlbums((l) =>
                                l.map((it, n) => (n === i ? { ...it, quota: Math.max(1, it.quota - 5) } : it)),
                              )
                            }
                          >
                            -5
                          </button>
                          <button
                            type="button"
                            className="tz-sc-step-btn"
                            title="-1"
                            onClick={() =>
                              setDraftAlbums((l) =>
                                l.map((it, n) => (n === i ? { ...it, quota: Math.max(1, it.quota - 1) } : it)),
                              )
                            }
                          >
                            <TzIconMinus size={13} />
                          </button>

                          <input
                            type="number"
                            min={1}
                            className="tz-sc-step-val"
                            value={a.quota}
                            onChange={(e) =>
                              setDraftAlbums((l) =>
                                l.map((it, n) => (n === i ? { ...it, quota: Number(e.target.value) || 1 } : it)),
                              )
                            }
                          />
                          <span className="tz-sc-step-label">תמונות</span>

                          <button
                            type="button"
                            className="tz-sc-step-btn"
                            title="+1"
                            onClick={() =>
                              setDraftAlbums((l) =>
                                l.map((it, n) => (n === i ? { ...it, quota: it.quota + 1 } : it)),
                              )
                            }
                          >
                            <TzIconPlus size={13} />
                          </button>
                          <button
                            type="button"
                            className="tz-sc-step-btn"
                            title="+5"
                            onClick={() =>
                              setDraftAlbums((l) =>
                                l.map((it, n) => (n === i ? { ...it, quota: it.quota + 5 } : it)),
                              )
                            }
                          >
                            +5
                          </button>
                        </div>
                        <button
                          type="button"
                          className="tz-sc-del-btn"
                          disabled={draftAlbums.length <= 1}
                          title="הסר אלבום"
                          onClick={() => setDraftAlbums((l) => l.filter((_, n) => n !== i))}
                        >
                          <TzIconTrash size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="tz-sc-add-album-btn"
                      onClick={() =>
                        setDraftAlbums((l) => [...l, { name: 'אלבום נוסף', quota: 30 }])
                      }
                    >
                      <TzIconPlus size={15} />
                      הוסף אלבום נוסף
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button
                      type="button"
                      className="tz-btn-projects-primary"
                      onClick={async () => {
                        const clean = draftAlbums
                          .map((a) => ({ name: a.name.trim(), quota: Math.max(1, a.quota | 0) }))
                          .filter((a) => a.name);
                        if (!clean.length) return alert('חייב להיות לפחות אלבום אחד');
                        await galleryUpdateAlbums(link.galleryId, clean);
                        setEditingAlbums(false);
                        watch.refresh();
                      }}
                    >
                      שמור שינויים באלבומים ✓
                    </button>
                    <button
                      type="button"
                      className="tz-btn-projects-secondary"
                      onClick={() => setEditingAlbums(false)}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              ) : (
                <div className="tz-sc-meters-grid">
                  {state.gallery.albums.map((album) => {
                    const used = state.counts[album.id] ?? 0;
                    const isFull = used >= album.quota;
                    const pct = Math.min(100, Math.round((used / album.quota) * 100));

                    return (
                      <div key={album.id} className={`tz-sc-meter-card ${isFull ? 'full' : ''}`}>
                        <div className="tz-sc-meter-top">
                          <span>{album.name}</span>
                          <span className="tz-sc-meter-counts">
                            {used} / {album.quota}
                          </span>
                        </div>
                        <div className="tz-sc-meter-bar">
                          <div className="tz-sc-meter-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Card 3: Client Selections Imported */}
          {link.importedAt && (
            <div className="tz-sc-imported-card">
              <div className="tz-sc-imported-copy">
                <TzIconCheckCircle size={22} />
                <span>
                  הבחירה נשמרה בהצלחה ותופיע בעריכה לפי <strong>הסשנים המקוריים</strong>!
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {onNavigateToEdit && (
                  <button
                    type="button"
                    className="tz-btn-projects-primary"
                    onClick={() => onNavigateToEdit()}
                  >
                    עבור לעריכת התמונות שנבחרו ←
                  </button>
                )}
                {onNavigateToAlbum && (
                  <button
                    type="button"
                    className="tz-btn-projects-secondary"
                    onClick={onNavigateToAlbum}
                  >
                    פתח באלבום החכם ←
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Card 4: Client Feedback / Pinpoint Notes Queue */}
          {/* Notes arrive while the client is still choosing, so the queue
              does not wait for the lock. */}
          {state && (
            <ClientFeedbackQueue
              projectId={projectId}
              state={state}
              link={link}
              onNavigateToEdit={onNavigateToEdit}
            />
          )}
        </div>

        {/* Right Column: Studio Brand Preview */}
        <div>
          <StudioBrandCard />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   CLIENT COMMENTS & PINPOINTS QUEUE
   ========================================================================== */

function ClientFeedbackQueue({
  projectId,
  state,
  link,
  onNavigateToEdit,
}: {
  projectId: string;
  state: NonNullable<ReturnType<typeof useGalleryWatch>['state']>;
  link: NonNullable<ReturnType<typeof useGalleryWatch>['link']>;
  onNavigateToEdit?: (frameName?: string) => void;
}) {
  const frames = framesOf(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState<string | null>(null);

  const openComments = state.comments.filter((c) => !c.resolvedAt && !done[c.id]);

  if (!state.comments.length) return null;

  const resolve = async (id: string) => {
    setBusy(id);
    try {
      await galleryResolve(link.galleryId, id);
      setDone((d) => ({ ...d, [id]: true }));
    } finally {
      setBusy(null);
    }
  };

  const openFrame = opened ? frames.find((f) => f.name === opened) : undefined;

  return (
    <div className="tz-sc-comments-card">
      <div className="tz-sc-card-header">
        <div className="tz-sc-card-title-wrap">
          <h3 className="tz-sc-card-title">
            הערות ובקשות מיוחדות מהלקוח
            <span className="tz-sc-pill-badge">{openComments.length} פתוחות</span>
          </h3>
          <p className="tz-sc-card-desc">
            הלקוח סימן נקודות ספציפיות על התמונות וצירף הערות לעריכה.
          </p>
        </div>
      </div>

      <div className="tz-sc-comments-list">
        {state.comments.map((comment) => {
          const frame = frames.find((f) => f.name === comment.frameId);
          const resolved = Boolean(comment.resolvedAt) || done[comment.id];

          return (
            <div key={comment.id} className={`tz-sc-comment-row ${resolved ? 'done' : ''}`}>
              <div
                className="tz-sc-comment-thumb"
                role={frame ? 'button' : undefined}
                title={frame ? 'פתח בגדול עם כל ההערות' : undefined}
                style={frame ? { cursor: 'zoom-in' } : undefined}
                onClick={frame ? () => setOpened(comment.frameId) : undefined}
              >
                {frame ? (
                  <span className="tz-sc-comment-fit">
                    <img
                      src={`${ENGINE}/thumb?path=${encodeURIComponent(frame.shown)}&w=160`}
                      alt=""
                    />
                    <i
                      className="tz-sc-pin-dot"
                      style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
                    />
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#a1a1aa', padding: 4 }}>לא נמצא</span>
                )}
              </div>

              <div className="tz-sc-comment-content">
                <span className="tz-sc-comment-file">{comment.frameId}</span>
                <p className="tz-sc-comment-text">{comment.text}</p>

                <div className="tz-sc-comment-actions">
                  {frame && onNavigateToEdit && (
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      style={{ color: 'var(--tz-brand)', fontWeight: 600 }}
                      onClick={() => onNavigateToEdit(frame.name)}
                      title="עבור לעריכת תמונה זו בסטודיו"
                    >
                      ערוך בסטודיו ←
                    </button>
                  )}

                  {!resolved && (
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      disabled={busy === comment.id}
                      onClick={() => resolve(comment.id)}
                    >
                      סמן שטופל ✓
                    </button>
                  )}

                  {frame?.edited && (
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      style={{ color: 'var(--tz-brand)' }}
                      disabled={busy === comment.id}
                      onClick={async () => {
                        const itemId = state.selection.find(
                          (s) => s.frameId === comment.frameId,
                        )?.itemId;
                        if (!itemId) return;
                        setBusy(comment.id);
                        try {
                          await galleryPublishVersion(link.galleryId, itemId, frame.shown);
                          await galleryResolve(link.galleryId, comment.id);
                          setDone((d) => ({ ...d, [comment.id]: true }));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      שלח גרסה מעודכנת ללקוח
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {openFrame && (
        <NoteViewer
          frameId={openFrame.name}
          src={`${ENGINE}/thumb?path=${encodeURIComponent(openFrame.shown)}&w=1800`}
          comments={state.comments.filter((c) => c.frameId === openFrame.name)}
          isResolved={(c) => Boolean(c.resolvedAt) || Boolean(done[c.id])}
          busyId={busy}
          onResolve={(c) => resolve(c.id)}
          onClose={() => setOpened(null)}
          onEdit={(frameId) => {
            setOpened(null);
            onNavigateToEdit?.(frameId);
          }}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   STUDIO BRAND CARD
   ========================================================================== */

function StudioBrandCard() {
  const [logo, setLogo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBrand()
      .then((b) => setLogo(b.logo))
      .catch(() => setError('לא ניתן לקרוא את הלוגו'))
      .finally(() => setLoaded(true));
  }, []);

  const handlePickLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
        fr.readAsDataURL(file);
      });
      const out = await setBrand(data, file.name);
      setLogo(out.logo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'העלאת הלוגו נכשלה');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="tz-sc-card">
      <div className="tz-sc-card-header">
        <div className="tz-sc-card-title-wrap">
          <h3 className="tz-sc-card-title">מיתוג ולוגו הסטודיו</h3>
          <p className="tz-sc-card-desc">
            הלוגו שלך מופיע בכניסה ובראש הגלריה של הלקוח, מעניק מראה יוקרתי ומקצועי.
          </p>
        </div>
      </div>

      <div className="tz-sc-brand-grid">
        <div className="tz-sc-swatches">
          <div className="tz-sc-swatch light" title="תצוגה על רקע בהיר">
            {logo ? <img src={logo} alt="לוגו בהיר" /> : <span className="tz-sc-swatch-empty">רקע בהיר</span>}
          </div>
          <div className="tz-sc-swatch dark" title="תצוגה על רקע כהה">
            {logo ? <img src={logo} alt="לוגו כהה" /> : <span className="tz-sc-swatch-empty">רקע כהה</span>}
          </div>
        </div>

        <div className="tz-sc-brand-actions">
          <label className="tz-sc-upload-label">
            <TzIconUpload size={15} />
            {busy ? 'מעלה לוגו...' : logo ? 'החלף לוגו' : 'העלה לוגו סטודיו'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={busy}
              onChange={(e) => void handlePickLogo(e.target.files?.[0])}
            />
          </label>

          {logo && (
            <button
              type="button"
              className="tz-sc-remove-brand-btn"
              disabled={busy}
              onClick={() => void clearBrand().then(() => setLogo(null))}
            >
              הסר
            </button>
          )}
        </div>

        <p className="tz-sc-brand-tip">
          מומלץ להעלות קובץ PNG עם רקע שקוף. כך הלוגו ייראה חד ומדויק על כל רקע ומכשיר.
        </p>

        {error && (
          <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   STORAGE & GALLERY LIFECYCLE MANAGEMENT MODAL
   ========================================================================== */

function StorageManagerModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<GalleryStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await galleryStorageStats();
      setStats(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadStats();
      setActionNotice(null);
    }
  }, [isOpen, loadStats]);

  if (!isOpen) return null;

  const handlePurge = async (g: GalleryStorageItem) => {
    if (!confirm(`האם לפנות תמונות שלא נבחרו מגלריית "${g.name}"?\nהתמונות שנבחרו יישארו שמורות וזמינות.`)) {
      return;
    }
    setBusyAction(g.id);
    try {
      const res = await galleryPurgeUnselected(g.id);
      setActionNotice(`פונתה כמות של ${formatBytes(res.freedBytes)} מגלריית "${g.name}" (${res.purgedCount} תמונות נמחקו)`);
      void loadStats();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'הפעולה נכשלה');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleFreeze = async (g: GalleryStorageItem) => {
    setBusyAction(g.id);
    try {
      const nextStatus = g.status === 'frozen' ? 'active' : 'frozen';
      await gallerySetStatus(g.id, nextStatus);
      void loadStats();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (g: GalleryStorageItem) => {
    if (!confirm(`האם למחוק לחלוטין את גלריית "${g.name}"?\nכל התמונות, הקבצים וההערות יימחקו לצמיתות מהשרת.`)) {
      return;
    }
    setBusyAction(g.id);
    try {
      await galleryDelete(g.id);
      setActionNotice(`גלריית "${g.name}" נמחקה והאחסון פונה בהצלחה.`);
      void loadStats();
    } finally {
      setBusyAction(null);
    }
  };

  const pct = stats && stats.storageLimitBytes
    ? Math.min(100, Math.round((stats.totalBytes / stats.storageLimitBytes) * 100))
    : 0;

  return (
    <div className="tz-sc-modal-overlay" onClick={onClose}>
      <div className="tz-sc-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="tz-sc-modal-header">
          <div className="tz-sc-modal-title">
            <TzIconCloud size={22} />
            <span>ניהול שטח אחסון וגלריות ענן</span>
          </div>
          <button type="button" className="tz-sc-modal-close" onClick={onClose} title="סגור">
            ✕
          </button>
        </div>

        <div className="tz-sc-modal-body">
          {actionNotice && (
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: 12, borderRadius: 10, color: '#065f46', fontSize: 13, fontWeight: 600 }}>
              {actionNotice}
            </div>
          )}

          {/* Storage Bar Overview */}
          {stats && (
            <div className="tz-sc-storage-overview">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>
                  נפח אחסון בשימוש: {formatBytes(stats.totalBytes)} מתוך {formatBytes(stats.storageLimitBytes)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: pct > 85 ? '#dc2626' : '#059669' }}>
                  {pct}% מנוצל
                </span>
              </div>
              <div className="tz-sc-storage-bar-wrap">
                <div
                  className={`tz-sc-storage-bar-fill ${pct > 90 ? 'danger' : pct > 70 ? 'warning' : ''}`}
                  style={{ width: `${Math.max(3, pct)}%` }}
                />
              </div>
              <div className="tz-sc-storage-meta-grid">
                <div className="tz-sc-storage-stat">
                  <span className="tz-sc-storage-stat-label">סה״כ גלריות</span>
                  <span className="tz-sc-storage-stat-val">{stats.totalGalleries}</span>
                </div>
                <div className="tz-sc-storage-stat">
                  <span className="tz-sc-storage-stat-label">גלריות פעילות</span>
                  <span className="tz-sc-storage-stat-val" style={{ color: '#059669' }}>{stats.activeGalleries}</span>
                </div>
                <div className="tz-sc-storage-stat">
                  <span className="tz-sc-storage-stat-label">גלריות מוקפאות/בארכיון</span>
                  <span className="tz-sc-storage-stat-val" style={{ color: '#d97706' }}>
                    {stats.totalGalleries - stats.activeGalleries}
                  </span>
                </div>
                <div className="tz-sc-storage-stat">
                  <span className="tz-sc-storage-stat-label">סה״כ תמונות בענן</span>
                  <span className="tz-sc-storage-stat-val">
                    {stats.galleries.reduce((acc, g) => acc + g.photoCount, 0)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Galleries Table */}
          {loading ? (
            <p style={{ color: '#71717a', fontSize: 13 }}>טוען נתוני אחסון וגלריות...</p>
          ) : !stats || stats.galleries.length === 0 ? (
            <p style={{ color: '#71717a', fontSize: 13 }}>טרם נוצרו גלריות באחסון.</p>
          ) : (
            <div className="tz-sc-table-wrap">
              <table className="tz-sc-storage-table">
                <thead>
                  <tr>
                    <th>שם הגלריה</th>
                    <th>תאריך</th>
                    <th>תמונות / בחירות</th>
                    <th>שטח באחסון</th>
                    <th>סטטוס</th>
                    <th>ניהול מקום</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.galleries.map((g) => {
                    const dateStr = g.createdAt
                      ? new Date(g.createdAt * 1000).toLocaleDateString('he-IL')
                      : '—';
                    const hasUnselected = g.photoCount > g.chosenCount && g.chosenCount > 0;
                    const isBusy = busyAction === g.id;

                    return (
                      <tr key={g.id}>
                        <td>
                          <strong>{g.name}</strong>
                        </td>
                        <td>{dateStr}</td>
                        <td>
                          <span>{g.chosenCount} / {g.photoCount} נבחרו</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{formatBytes(g.bytes)}</span>
                        </td>
                        <td>
                          {g.status === 'frozen' ? (
                            <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 12 }}>מוקפאת</span>
                          ) : g.lockedAt ? (
                            <span style={{ color: '#059669', fontWeight: 600, fontSize: 12 }}>ננעלה ✓</span>
                          ) : (
                            <span style={{ color: '#2563eb', fontWeight: 600, fontSize: 12 }}>פעילה</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {hasUnselected && (
                              <button
                                type="button"
                                className="tz-sc-quick-tool-btn"
                                disabled={isBusy}
                                onClick={() => handlePurge(g)}
                                title="מחק תמונות שלא נבחרו כדי לפנות מקום"
                              >
                                🧹 פנה לא-נבחרים
                              </button>
                            )}
                            <button
                              type="button"
                              className="tz-sc-quick-tool-btn"
                              disabled={isBusy}
                              onClick={() => handleToggleFreeze(g)}
                              title={g.status === 'frozen' ? 'החזר גישה לגלריה' : 'הקפא גישה לגלריה'}
                            >
                              {g.status === 'frozen' ? 'החזר' : 'הקפא'}
                            </button>
                            <button
                              type="button"
                              className="tz-sc-quick-tool-btn"
                              style={{ color: '#dc2626' }}
                              disabled={isBusy}
                              onClick={() => handleDelete(g)}
                              title="מחק גלריה זו לצמיתות"
                            >
                              <TzIconTrash size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
