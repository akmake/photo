import PhotoGrid from '../../components/photo-grid/PhotoGrid';
import { useDims } from '../../components/photo-grid/useDims';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EDIT_WIDTH, cloudStatus, importCloudFrame, importFrame, initProject, listImages, pickFolder,
  prepareFrames, triageSet,
} from '../../api';
import type { CloudEntry, CloudProvider, CloudProviderStatus } from '../../api';
import {
  PHOTO_STATUS, folderNameOf, framesOf, getWorkspaceRoot, reloadFrames, setPhotoStatus,
  setWorkspaceRoot, updateProject, useProjectFiles, useStatuses,
} from '../../studio/store';
import type { Project, PhotoStatus } from '../../studio/store';
import { useSetPreview } from '../../studio/preview';
import CloudImportV2 from './CloudImportV2';
import { CloudLogo, DiskSourceIcon } from '../BrandLogos';
import './import-redesign.css';
import './import-frame.css';

type Source = 'disk' | CloudProvider;

const SOURCE_NAME: Record<Source, string> = {
  disk: 'המחשב',
  google: 'Google Drive',
  dropbox: 'Dropbox',
};

/** The work stage's analysis starts the moment the set is in, in the engine's
 *  low-priority background process — so by the time the photographer reaches
 *  סינון the suggestions are there. Failing here is not an error to show:
 *  the work stage asks again and says so itself if the engine cannot answer. */
function startTriage(projectId: string) {
  const paths = framesOf(projectId).map((f) => f.path);
  if (paths.length) void triageSet(paths, true).catch(() => undefined);
}

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
  const dims = useDims(useMemo(() => frames.map((f) => f.path), [frames]));

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
  /* Where the copy in progress comes from — its mark rides on the progress. */
  const [from, setFrom] = useState<Source>('disk');
  /* Each cloud's state, asked up front, so the source card says "not set up
   * here" or "connected" before he clicks — not after a dialog opens. Null
   * while asking; a failed ask leaves the cards saying nothing about state. */
  const [clouds, setClouds] = useState<Record<CloudProvider, CloudProviderStatus> | null>(null);
  const askClouds = useCallback(() => {
    cloudStatus().then(setClouds).catch(() => setClouds(null));
  }, []);
  useEffect(() => { askClouds(); }, [askClouds]);

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
      startTriage(projectId);
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
      setFrom('disk');
      await copyIn(listed.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייבוא נכשל');
    }
  }, [copyIn]);

  const runCloudImport = useCallback(async (provider: CloudProvider, files: CloudEntry[]) => {
    if (!files.length) return;
    setError(null);
    setFrom(provider);
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
      startTriage(projectId);
      if (project.at < 1) updateProject(projectId, { at: 1, state: 'work' });
      if (failed) {
        throw new Error(`${failed.toLocaleString('he-IL')} קבצים לא ירדו. אפשר לנסות שוב; קבצים שכבר הועתקו ידולגו.`);
      }
    } finally {
      setBusy(false);
    }
  }, [project, projectId]);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const counts = useMemo(() => {
    const c = { raw: 0, working: 0, ready: 0 };
    for (const f of frames) {
      const st = (statuses[f.name] as PhotoStatus) ?? 'raw';
      if (st in c) c[st as keyof typeof c] += 1;
    }
    return c;
  }, [frames, statuses]);

  const cloudNote = (p: CloudProvider) => {
    const st = clouds?.[p];
    if (!st) return 'תיקייה מהענן · קריאה בלבד';
    if (!st.configured) return 'לא מוגדר בהתקנה הזו';
    if (st.connected) return 'מחובר · בוחרים תיקייה';
    return 'חיבור חד־פעמי · קריאה בלבד';
  };

  /* Everything above the photographs rides INSIDE the gallery's own scroll,
   * so the screen has one scrollbar and the pictures fill the window. */
  const chrome = (
    <div className="fo-im-head">
      <div className="fo-im-sources" data-tour="import-actions">
        <button
          type="button"
          className="fo-im-src is-disk"
          onClick={runImport}
          disabled={busy}
          data-tour="import-from-disk"
        >
          <span className="fo-im-src-mark is-disk"><DiskSourceIcon size={22} /></span>
          <span className="fo-im-src-copy">
            <strong>מהמחשב או מכרטיס זיכרון</strong>
            <small>בוחרים תיקייה, והתמונות מועתקות לפרויקט</small>
          </span>
          <span className="fo-im-src-go" aria-hidden>←</span>
        </button>
        {(['google', 'dropbox'] as CloudProvider[]).map((p) => {
          const st = clouds?.[p];
          return (
            <button
              key={p}
              type="button"
              className={`fo-im-src${st && !st.configured ? ' is-off' : ''}${st?.connected ? ' is-on' : ''}`}
              onClick={() => setCloud(p)}
              disabled={busy}
            >
              <span className="fo-im-src-mark"><CloudLogo provider={p} size={24} /></span>
              <span className="fo-im-src-copy">
                <strong dir="ltr">{SOURCE_NAME[p]}</strong>
                <small>
                  {st?.connected && <span className="fo-dot" style={{ background: 'var(--fo-green)' }} />}
                  {cloudNote(p)}
                </small>
              </span>
              <span className="fo-im-src-go" aria-hidden>←</span>
            </button>
          );
        })}
      </div>

      <div className="fo-im-dest" data-tour="import-destination">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        <span className="fo-im-dest-label">התמונות נשמרות ב־</span>
        <code className="fo-mono fo-im-dest-path" dir="ltr" title={project.home ?? root ?? ''}>
          {project.home ? `${project.home}\\תמונות גלם` : root ?? 'טוען נתיב…'}
        </code>
        <span className="fo-im-dest-note">המקור לא משתנה — רק מועתק</span>
        {!project.home && (
          <button className="fo-im-link" type="button" onClick={chooseRoot} disabled={busy}>
            שנה תיקיית יעד
          </button>
        )}
      </div>

      {busy && (
        <div className="fo-im-progress" data-tour="import-progress">
          <span className="fo-im-progress-mark">
            {from === 'disk' ? <DiskSourceIcon size={18} /> : <CloudLogo provider={from} size={18} />}
          </span>
          <div className="fo-im-progress-body">
            <div className="fo-im-progress-head">
              <strong>מעתיק מ־<bdi dir={from === 'disk' ? 'rtl' : 'ltr'}>{SOURCE_NAME[from]}</bdi> לתיקיית הפרויקט…</strong>
              <span className="fo-mono">{done.toLocaleString('en-US')} / {total.toLocaleString('en-US')} · {percent}%</span>
            </div>
            <div className="fo-im-track"><i style={{ width: `${percent}%` }} /></div>
            {skipped > 0 && (
              <span className="fo-im-skipped">{skipped.toLocaleString('en-US')} תמונות כבר היו בפרויקט ודולגו</span>
            )}
          </div>
        </div>
      )}

      {error && <div className="fo-im-error" role="alert">{error}</div>}

      {/* Files that did not arrive — named, and retryable. */}
      {!busy && failed.length > 0 && (
        <div className="fo-im-error is-list" data-tour="import-failed">
          <div className="fo-im-failed-head">
            <span>
              {failed.length.toLocaleString('en-US')} תמונות לא הועתקו לפרויקט. המקור לא נפגע — אפשר לנסות שוב.
            </span>
            <button className="fo-btn is-primary" type="button" onClick={() => copyIn(failed.map((f) => f.file))}>
              נסה שוב את {failed.length.toLocaleString('en-US')} שנכשלו
            </button>
          </div>
          <ul>
            {failed.map((f) => (
              <li key={f.file}>
                <span dir="ltr" className="fo-mono">{f.file.split(/[\\/]/).pop()}</span>
                <span>{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready && frames.length > 0 && (
        <div className="fo-im-results" data-tour="import-results">
          <strong>בפרויקט</strong>
          <span className="fo-mono fo-im-results-n">{frames.length.toLocaleString('en-US')}</span>
          <span className="fo-im-legend">
            <span><i className="is-raw" />חומר גלם <b className="fo-mono">{counts.raw.toLocaleString('en-US')}</b></span>
            <span><i className="is-working" />בטיפול <b className="fo-mono">{counts.working.toLocaleString('en-US')}</b></span>
            <span><i className="is-ready" />מוכן <b className="fo-mono">{counts.ready.toLocaleString('en-US')}</b></span>
          </span>
          <span className="fo-im-spacer" />
          {preview.graded && <span className="fo-im-graded">מוצג עם פרופיל הצבע של הסט</span>}
          <span className="fo-im-hint">ריחוף על תמונה — לשנות את המצב שלה</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="tz-import-screen fo-im">
      {/* The same gallery as everywhere: justified, in true proportions — and
        * here it IS the screen: it holds the whole area and the only scroll. */}
      <PhotoGrid
        className="tz-import-pg"
        header={chrome}
        sections={[{
          id: 'imported',
          items: frames.map((frame) => ({
            id: frame.name,
            alt: frame.name,
            aspect: dims.get(frame.path),
            src: (w: number) => preview.url(frame.path, w),
          })),
        }]}
        targetHeight={190}
        empty={!ready ? (
          <div className="fo-im-empty"><p>בודק את תיקיית הפרויקט…</p></div>
        ) : busy ? null : (
          <div className="fo-im-empty">
            <strong>עוד לא יובאו תמונות לפרויקט</strong>
            <p>בחר מקור למעלה: תיקייה מהמחשב או מכרטיס הזיכרון, או תיקייה מהענן. הקבצים מועתקים לתיקיית הפרויקט, והמקור נשאר כמו שהוא.</p>
          </div>
        )}
        tileClass={(item) => `s-${(statuses[item.id] as PhotoStatus) ?? 'raw'}`}
        renderOverlay={(item, state) => {
          const status = (statuses[item.id] as PhotoStatus) ?? 'raw';
          const path = frames.find((f) => f.name === item.id)?.path ?? '';
          return (
            <>
              {preview.pending(path) && <span className="tz-frame-pending-badge">טוען…</span>}
              <div className={`tz-import-pg-bar${state.hovered ? ' is-on' : ''}`}>
                {state.width > 170 && <span className="tz-import-pg-name" dir="ltr">{item.id}</span>}
                <div className="tz-frame-statuses">
                  {PHOTO_STATUS.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className={`tz-frame-status-btn ${st.id === status ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setPhotoStatus(projectId, item.id, st.id); }}
                      title={st.label}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          );
        }}
      />

      {/* 6. Cloud Dialog */}
      {cloud && (
        <CloudImportV2
          provider={cloud}
          onClose={() => { setCloud(null); askClouds(); }}
          onImport={(files) => runCloudImport(cloud, files)}
        />
      )}
    </div>
  );
}
