/* התיקיות של הפרויקט, והתמונות שבתוכן.
 *
 * A project points at folders on disk — often several (ceremony, party, second
 * shooter) — and nothing is ever copied. The list of folders and each frame's
 * status are all this screen owns; what exists is whatever is on the disk, read
 * fresh every time the screen opens. A cached copy of a folder listing is a
 * copy that goes stale the first time the photographer moves a file in Explorer.
 *
 * The thumbnails come from the engine (GET /thumb), because the browser cannot
 * read D:\Shoots\... and the whole product rests on the files staying there.
 *
 * Status defaults to חומר גלם and stays there unless the photographer says
 * otherwise. Most frames in a shoot never need an individual decision; a tool
 * that demands one on 1,800 files is inventing work.
 */

import { useCallback, useEffect, useState } from 'react';
import { listImages, thumbUrl } from '../../api';
import {
  PHOTO_STATUS, addFolder, removeFolder, setPhotoStatus, useFolders, useStatuses,
} from '../store';
import type { PhotoStatus, ProjectFolder } from '../store';
import { IcFolderOpen, IcCheckCircle } from '../../design/Icons';

interface FolderFiles {
  folder: ProjectFolder;
  files: string[];
  error?: string;
  loading: boolean;
}

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export default function ProjectFiles({
  projectId,
  onPickOriginal,
}: {
  projectId: string;
  /** Hand a frame to the colour-match screen as the "before" of the pair. */
  onPickOriginal?: (path: string, folderPath: string) => void;
}) {
  const folders = useFolders(projectId);
  const statuses = useStatuses();

  const [loaded, setLoaded] = useState<Record<string, FolderFiles>>({});
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFolder = useCallback(async (folder: ProjectFolder) => {
    setLoaded((m) => ({ ...m, [folder.id]: { folder, files: [], loading: true } }));
    try {
      const r = await listImages(folder.path);
      setLoaded((m) => ({ ...m, [folder.id]: { folder, files: r.files, loading: false } }));
    } catch (e) {
      setLoaded((m) => ({
        ...m,
        [folder.id]: {
          folder,
          files: [],
          loading: false,
          error: e instanceof Error ? e.message : 'לא ניתן לקרוא את התיקייה',
        },
      }));
    }
  }, []);

  useEffect(() => {
    folders.forEach((f) => {
      if (!loaded[f.id]) readFolder(f);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders]);

  const add = useCallback(async () => {
    const clean = path.trim();
    if (!clean) return;
    setAdding(true);
    setError(null);
    try {
      const r = await listImages(clean);
      const folder = addFolder(projectId, r.folder, r.count);
      setPath('');
      readFolder(folder);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'התיקייה לא נמצאה');
    } finally {
      setAdding(false);
    }
  }, [path, projectId, readFolder]);

  const total = Object.values(loaded).reduce((n, f) => n + f.files.length, 0);

  return (
    <div className="pf">
      <div className="pf-add">
        <label className="cm-field">
          <span>הוסף תיקייה לפרויקט</span>
          <input
            className="field mono"
            dir="ltr"
            value={path}
            placeholder="D:\Shoots\2026-07-24\ceremony"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </label>
        <button className="btn btn-primary" onClick={add} disabled={!path.trim() || adding}>
          <IcFolderOpen size={16} />
          {adding ? 'קורא…' : 'הוסף'}
        </button>
      </div>

      {error && <p className="cm-error">{error}</p>}

      {folders.length === 0 ? (
        <p className="pf-empty">
          לפרויקט אין עדיין תיקיות. הדבק נתיב לתיקייה על המחשב — התמונות נשארות שם,
          המערכת רק מצביעה עליהן.
        </p>
      ) : (
        <>
          <p className="pf-total">
            <IcCheckCircle size={15} />
            <b className="mono">{folders.length}</b> תיקיות ·
            <b className="mono">{total.toLocaleString('he-IL')}</b> תמונות
          </p>

          {folders.map((folder) => {
            const state = loaded[folder.id];
            const files = state?.files ?? [];
            const counts = files.reduce(
              (acc, f) => {
                const s = statuses[f] ?? 'raw';
                acc[s] += 1;
                return acc;
              },
              { raw: 0, working: 0, ready: 0 } as Record<PhotoStatus, number>,
            );

            return (
              <section className="pf-folder" key={folder.id}>
                <div className="pf-folder-bar">
                  <h3>{folder.name}</h3>
                  <span className="pf-path mono" dir="ltr">{folder.path}</span>
                  <span className="pf-counts mono">
                    {files.length.toLocaleString('he-IL')}
                    {counts.working > 0 && <i className="c-working"> · {counts.working} בטיפול</i>}
                    {counts.ready > 0 && <i className="c-ready"> · {counts.ready} מוכנות</i>}
                  </span>
                  <button className="pf-drop" onClick={() => removeFolder(projectId, folder.id)}>
                    הסר
                  </button>
                </div>

                {state?.loading && <p className="pf-note">קורא את התיקייה…</p>}
                {state?.error && <p className="cm-error">{state.error}</p>}

                <div className="pf-grid">
                  {files.map((file) => {
                    const status = statuses[file] ?? 'raw';
                    return (
                      <figure className={`pf-shot s-${status}`} key={file}>
                        <img src={thumbUrl(file, 320)} alt="" loading="lazy" />
                        <figcaption className="mono" dir="ltr">{baseName(file)}</figcaption>
                        <div className="pf-status">
                          {PHOTO_STATUS.map((s) => (
                            <button
                              key={s.id}
                              className={s.id === status ? 'on' : ''}
                              onClick={() => setPhotoStatus(file, s.id)}
                              title={s.label}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                        {onPickOriginal && (
                          <button
                            className="pf-use"
                            onClick={() => onPickOriginal(file, folder.path)}
                          >
                            בחר כמקור
                          </button>
                        )}
                      </figure>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
