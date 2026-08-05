/* ייבוא — the moment the shoot becomes the project's own.
 *
 * Importing COPIES. The photographs are read off the card or the folder the
 * photographer points at and written into `<project>/תמונות גלם/`, and the
 * source is never touched. That is not a detail: the common source is a memory
 * card, and a card gets formatted. A product whose model is "we point at where
 * your files happen to be" loses the whole job the first time that happens.
 *
 * The copy runs one file at a time, on purpose. The endpoint would loop over
 * three hundred happily, but then the screen could only say "working" — and 300
 * RAW frames is minutes. A counter in ITEMS is the difference between waiting
 * and deciding the program has hung.
 *
 * Re-importing the same card is a normal accident, not an error: a frame whose
 * name AND size already match is skipped and reported as such.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  importCloudFrame, importFrame, initProject, listImages, pickFolder,
} from '../../api';
import type { CloudEntry, CloudProvider } from '../../api';
import {
  PHOTO_STATUS, folderNameOf, getWorkspaceRoot, reloadFrames, setPhotoStatus,
  setWorkspaceRoot, updateProject, useProjectFiles, useStatuses,
} from '../store';
import type { Project } from '../store';
import { useSetPreview } from '../preview';
import type { PhotoStatus } from '../store';
import { IcFolderOpen, IcCheckCircle, IcCloud } from '../../design/Icons';
import CloudImportDialog from './CloudImportDialog';

export default function ProjectFiles({ project }: { project: Project }) {
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
    getWorkspaceRoot().then(setRoot).catch(() => setError('המנוע אינו זמין'));
  }, []);

  /* Render the set ahead of the scroll. The engine takes it LIFO, so whatever
   * the photographer opens next still jumps the queue. */
  useEffect(() => {
    if (frames.length) preview.warm(frames.map((f) => f.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length, preview.graded]);

  /* Asked ONCE for the installation. A photographer keeps their shoots in one
   * place; asking per project would be asking the same question 200 times. */
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
      if (!source) return; // cancelled — an answer, not a failure
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
          /* one unreadable frame must not take the card down with it */
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
          /* one remote frame must not cancel the rest of the folder */
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

  /* ONE action. The folder this button opens is the folder the photographs are
   * IN — the only folder the photographer is thinking about when they arrive
   * here. Where the project itself gets saved has a sensible default and is
   * stated below, not asked before. */
  return (
    <div className="pf">
      <div className="pf-add">
        <button className="btn btn-primary" onClick={runImport} disabled={busy}>
          <IcFolderOpen size={16} />
          {busy ? 'מייבא…' : 'ייבא תמונות'}
        </button>
        <button className="btn pf-cloud-button" onClick={() => setCloud('google')} disabled={busy}>
          <IcCloud size={16} />
          Google Drive
        </button>
        <button className="btn pf-cloud-button" onClick={() => setCloud('dropbox')} disabled={busy}>
          <IcCloud size={16} />
          Dropbox
        </button>
        <span className="pf-add-note">
          בחר את התיקייה או הכרטיס שבהם התמונות. הן יועתקו אל הפרויקט — המקור לא
          ייגע, אפשר לפרמט את הכרטיס אחר כך.
        </span>
      </div>

      <p className="pf-home">
        <span>{project.home ? 'הפרויקט נשמר ב־' : 'הפרויקטים נשמרים ב־'}</span>
        <b className="mono" dir="ltr">{project.home ?? root ?? '…'}</b>
        {!project.home && (
          <button className="pf-where" onClick={chooseRoot} disabled={busy}>
            שנה מיקום
          </button>
        )}
      </p>

      {cloud && (
        <CloudImportDialog
          provider={cloud}
          onClose={() => setCloud(null)}
          onImport={(files) => runCloudImport(cloud, files)}
        />
      )}

      {busy && (
        <div className="dlv-progress">
          <div className="dlv-bar">
            <span style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
          </div>
          <span className="mono">
            {done.toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')}
          </span>
          {skipped > 0 && <span className="mono">· {skipped} כבר היו כאן</span>}
        </div>
      )}

      {error && <p className="cm-error">{error}</p>}

      {!ready && <p className="pf-note">קורא את התיקייה…</p>}

      {ready && frames.length === 0 && !busy ? (
        <p className="pf-empty">
          עוד לא יובאו תמונות. הצבע על התיקייה או על הכרטיס — הקבצים יועתקו אל
          תיקיית הפרויקט, והמקור יישאר כפי שהוא.
        </p>
      ) : (
        frames.length > 0 && (
          <>
            <p className="pf-total">
              <IcCheckCircle size={15} />
              <b className="mono">{frames.length.toLocaleString('he-IL')}</b> תמונות בפרויקט
              {preview.graded && (
                <i className="pf-graded">
                  · מוצג עם המראה של הסט
                </i>
              )}
            </p>

            {/* Never let the screen quietly show raw frames while claiming the
              * edit — that is the confusion the recipe exists to remove. */}
            {preview.stale && (
              <p className="cm-error">
                המנוע אינו זמין, ולכן מוצגים הקבצים המקוריים ולא הסט הערוך.
              </p>
            )}

            <div className="pf-grid">
              {frames.map((frame) => {
                const status = (statuses[frame.name] as PhotoStatus) ?? 'raw';
                return (
                  <figure className={`pf-shot s-${status}`} key={frame.path}>
                    <img src={preview.url(frame.path, 320)} alt="" loading="lazy" />
                    {preview.pending(frame.path) && <i className="pf-pending">המראה נטען…</i>}
                    <figcaption className="mono" dir="ltr">{frame.name}</figcaption>
                    <div className="pf-status">
                      {PHOTO_STATUS.map((s) => (
                        <button
                          key={s.id}
                          className={s.id === status ? 'on' : ''}
                          onClick={() => setPhotoStatus(projectId, frame.name, s.id)}
                          title={s.label}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </figure>
                );
              })}
            </div>
          </>
        )
      )}
    </div>
  );
}
