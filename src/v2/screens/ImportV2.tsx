import React, { useCallback, useEffect, useState } from 'react';
import {
  importCloudFrame, importFrame, initProject, listImages, pickFolder,
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
  const [cloud, setCloud] = useState<CloudProvider | null>(null);

  useEffect(() => {
    getWorkspaceRoot().then(setRoot).catch(() => setError('המנוע אינו זמין כרגע'));
  }, []);

  useEffect(() => {
    if (frames.length) preview.warm(frames.map((f) => f.path));
  }, [frames.length, preview.graded]);

  const chooseRoot = useCallback(async () => {
    setError(null);
    try {
      const chosen = await pickFolder();
      if (chosen) setRoot(await setWorkspaceRoot(chosen));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן להגדיר את התיקייה');
    }
  }, []);

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

      setBusy(true);
      setDone(0);
      setSkipped(0);
      setTotal(listed.count);

      const home = project.home ?? (await initProject(folderNameOf(project))).home;
      if (!project.home) updateProject(projectId, { home });
      const rawDir = `${home}\\תמונות גלם`;

      let already = 0;
      for (const file of listed.files) {
        try {
          const r = await importFrame(file, rawDir);
          if (r.skipped) already += 1;
        } catch {
          // ignore single frame error
        }
        setDone((n) => n + 1);
        setSkipped(already);
      }
      await reloadFrames(projectId);
      if (project.at < 1) updateProject(projectId, { at: 1, state: 'work' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל');
    } finally {
      setBusy(false);
    }
  }, [project, projectId]);

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
