import React, { useCallback, useEffect, useState } from 'react';
import {
  EDIT_WIDTH, importCloudFrame, importFrame, initProject, listImages, pickFolder,
  prepareFrames,
} from '../../api';
import type { CloudEntry, CloudProvider } from '../../api';
import {
  PHOTO_STATUS, folderNameOf, getWorkspaceRoot, reloadFrames, setPhotoStatus,
  setWorkspaceRoot, updateProject, useProjectFiles, useStatuses,
} from '../../studio/store';
import type { Project, PhotoStatus } from '../../studio/store';
import { useSetPreview } from '../../studio/preview';
import {
  TzIconCloud, TzIconFolder, TzIconGallery, TzIconUpload,
} from '../TzIcons';
import CloudImportDialog from '../../studio/screens/CloudImportDialog';
import './import-redesign.css';

export default function ImportV2({
  project,
  onBack,
}: {
  project: Project;
  onBack?: () => void;
}) {
  const projectId = project.id;
  const { frames, ready } = useProjectFiles(projectId);
  const statuses = useStatuses(projectId);
  const preview = useSetPreview(projectId);

  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /* Files that did not make it into the project, by name. A frame that fails
   * to copy used to vanish while the counter moved on as if it had arrived —
   * the photographer would find the hole weeks later, in the album. */
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);
  const [cloud, setCloud] = useState<CloudProvider | null>(null);

  useEffect(() => {
    getWorkspaceRoot().then(setRoot).catch(() => setError('המנוע אינו זמין כרגע'));
  }, []);

  useEffect(() => {
    if (frames.length) preview.warm(frames.map((f) => f.path));
  }, [frames.length, preview.graded]);

  /* THE MINUTES AFTER AN IMPORT ARE NOT WASTED. The moment the set is in, the
   * background preparer starts on it at low priority: thumbnails for the
   * grids, and the one expensive question every retouch tool asks of a frame —
   * where the subject, the skin and the face features are (~15s a frame the
   * first time). By the time the photographer reaches editing, the frames
   * they open are answered already instead of being analysed while they wait.
   * Waits for the import to finish, so it prepares the set and not a
   * half-copied folder. */
  useEffect(() => {
    if (busy || !frames.length) return;
    prepareFrames({ paths: frames.map((f) => f.path), w: EDIT_WIDTH, thumbs: [320] });
  }, [frames.length, busy]);

  const chooseRoot = useCallback(async () => {
    setError(null);
    try {
      const chosen = await pickFolder();
      if (chosen) setRoot(await setWorkspaceRoot(chosen));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן להגדיר את התיקייה');
    }
  }, []);

  /* Copies `files` into the project. Used for a fresh import and for retrying
   * the ones that failed; a file already in the project is skipped by the
   * engine, so a retry never duplicates. */
  const copyIn = useCallback(async (files: string[]) => {
    setError(null);
    setFailed([]);
    setBusy(true);
    setDone(0);
    setSkipped(0);
    setTotal(files.length);
    try {
      const home = project.home ?? (await initProject(folderNameOf(project))).home;
      if (!project.home) updateProject(projectId, { home });
      const rawDir = `${home}\\תמונות גלם`;

      let already = 0;
      const lost: { file: string; error: string }[] = [];
      for (const file of files) {
        try {
          const r = await importFrame(file, rawDir);
          if (r.skipped) already += 1;
        } catch (e) {
          lost.push({ file, error: e instanceof Error ? e.message : 'ההעתקה נכשלה' });
        }
        setDone((n) => n + 1);
        setSkipped(already);
      }
      setFailed(lost);
      await reloadFrames(projectId);
      if (project.at < 1) updateProject(projectId, { at: 1, state: 'work' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל');
    } finally {
      setBusy(false);
    }
  }, [project, projectId]);

  const runImport = useCallback(async () => {
    setError(null);
    try {
      const source = await pickFolder();
      if (!source) return;
      const listed = await listImages(source);
      if (!listed.count) {
        setError(`אין תמונות בתיקייה שנבחרה: ${source}`);
        return;
      }
      await copyIn(listed.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל');
    }
  }, [copyIn]);

  const runCloudImport = useCallback(async (provider: CloudProvider, files: CloudEntry[]) => {
    if (!files.length) return;
    setError(null);
    setBusy(true);
    setDone(0);
    setSkipped(0);
    setTotal(files.length);
    try {
      const home = project.home ?? (await initProject(folderNameOf(project))).home;
      if (!project.home) updateProject(projectId, { home });
      const rawDir = `${home}\\תמונות גלם`;
      let already = 0;
      let failed = 0;
      for (const file of files) {
        try {
          const result = await importCloudFrame(provider, file, rawDir);
          if (result.skipped) already += 1;
        } catch {
          failed += 1;
        }
        setDone((n) => n + 1);
        setSkipped(already);
      }
      await reloadFrames(projectId);
      if (project.at < 1) updateProject(projectId, { at: 1, state: 'work' });
      if (failed) {
        throw new Error(`${failed.toLocaleString('he-IL')} קבצים לא ירדו. אפשר לנסות שוב; קבצים שכבר הועתקו ידולגו.`);
      }
    } finally {
      setBusy(false);
    }
  }, [project, projectId]);

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="tz-import-container">
      {/* 1. Header & Actions */}
      <section className="tz-import-header">
        <div className="tz-import-header-copy">
          <div className="tz-import-tag">ייבוא מהמקור</div>
          <h1>העלאת תמונות וגלריות</h1>
          <p>
            התמונות מועתקות ישירות מכרטיס הזיכרון או מהמחשב אל תיקיית הפרויקט. המקור נשאר שמור ובטוח.
          </p>
        </div>

        <div className="tz-import-actions">
          <button
            className="tz-btn-projects-primary"
            type="button"
            onClick={runImport}
            disabled={busy}
          >
            <TzIconUpload size={16} />
            {busy ? 'מייבא תמונות…' : 'ייבא תמונות מהמחשב / כרטיס'}
          </button>

          <button
            className="tz-btn-projects-sec"
            type="button"
            onClick={() => setCloud('google')}
            disabled={busy}
          >
            <TzIconCloud size={16} /> Google Drive
          </button>

          <button
            className="tz-btn-projects-sec"
            type="button"
            onClick={() => setCloud('dropbox')}
            disabled={busy}
          >
            <TzIconCloud size={16} /> Dropbox
          </button>
        </div>
      </section>

      {/* 2. Destination Info Card */}
      <div className="tz-import-destination-card">
        <div className="tz-import-dest-info">
          <span className="tz-dest-label">נתיב שמירת הפרויקט:</span>
          <code className="tz-dest-path" dir="ltr">
            {project.home ?? root ?? 'טוען נתיב…'}
          </code>
        </div>
        {!project.home && (
          <button className="tz-btn-dest-change" type="button" onClick={chooseRoot} disabled={busy}>
            שנה תיקיית יעד
          </button>
        )}
      </div>

      {/* 3. Live Progress Bar (when copying files) */}
      {busy && (
        <div className="tz-import-progress-card">
          <div className="tz-import-prog-head">
            <strong>מעתיק תמונות לתיקיית הפרויקט…</strong>
            <span className="tz-import-prog-count">
              {done.toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')} ({percent}%)
            </span>
          </div>
          <div className="tz-import-track">
            <div className="tz-import-fill" style={{ width: `${percent}%` }} />
          </div>
          {skipped > 0 && (
            <div className="tz-import-skipped">
              {skipped} תמונות כבר היו קיימות בתיקייה ודולגו
            </div>
          )}
        </div>
      )}

      {/* 4. Error message if any */}
      {error && (
        <div className="tz-import-error-banner">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* 4b. Files that did not arrive — named, and retryable. */}
      {!busy && failed.length > 0 && (
        <div className="tz-import-error-banner tz-import-failed">
          <div className="tz-import-failed-head">
            <span>
              ⚠️ {failed.length.toLocaleString('he-IL')} תמונות לא הועתקו לפרויקט.
              המקור לא נפגע — אפשר לנסות שוב.
            </span>
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={() => copyIn(failed.map((f) => f.file))}
            >
              נסה שוב את {failed.length.toLocaleString('he-IL')} שנכשלו
            </button>
          </div>
          <ul>
            {failed.map((f) => (
              <li key={f.file}>
                <span dir="ltr">{f.file.split(/[\\/]/).pop()}</span>
                <span>{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Cloud Dialog */}
      {cloud && (
        <CloudImportDialog
          provider={cloud}
          onClose={() => setCloud(null)}
          onImport={(files) => runCloudImport(cloud, files)}
        />
      )}

      {/* 6. Files Grid or Empty State */}
      {!ready && (
        <div className="tz-import-empty-box">
          <p>בודק את תיקיית הפרויקט…</p>
        </div>
      )}

      {ready && frames.length === 0 && !busy && (
        <div className="tz-import-empty-box">
          <div className="tz-import-empty-icon">
            <TzIconUpload size={40} />
          </div>
          <h3>טרם יובאו תמונות לפרויקט</h3>
          <p>
            לחץ על הכפתור למעלה ובחר את תיקיית הצילום או את כרטיס ה-SD. הקבצים יועתקו בבטחה
            אל המחשב המקומי של הסטודיו.
          </p>
          <button
            className="tz-btn-projects-primary"
            type="button"
            onClick={runImport}
            style={{ marginTop: '8px' }}
          >
            <TzIconFolder size={16} /> בחר תיקיית תמונות לייבוא
          </button>
        </div>
      )}

      {ready && frames.length > 0 && (
        <section className="tz-import-results">
          <div className="tz-import-results-head">
            <div className="tz-import-results-title">
              <TzIconGallery size={17} />
              <span>תמונות שיובאו לפרויקט ({frames.length.toLocaleString('he-IL')})</span>
            </div>
            {preview.graded && (
              <span className="tz-import-graded-tag">מוצג עם פרופיל צבע של הסט</span>
            )}
          </div>

          <div className="tz-import-grid">
            {frames.map((frame) => {
              const status = (statuses[frame.name] as PhotoStatus) ?? 'raw';
              return (
                <div key={frame.path} className={`tz-frame-card s-${status}`}>
                  <div className="tz-frame-img-wrap">
                    <img
                      src={preview.url(frame.path, 320)}
                      alt={frame.name}
                      loading="lazy"
                      className="tz-frame-img"
                    />
                    {preview.pending(frame.path) && (
                      <span className="tz-frame-pending-badge">טוען…</span>
                    )}
                  </div>
                  <div className="tz-frame-foot">
                    <span className="tz-frame-name" dir="ltr" title={frame.name}>
                      {frame.name}
                    </span>
                    <div className="tz-frame-statuses">
                      {PHOTO_STATUS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`tz-frame-status-btn ${s.id === status ? 'active' : ''}`}
                          onClick={() => setPhotoStatus(projectId, frame.name, s.id)}
                          title={s.label}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
