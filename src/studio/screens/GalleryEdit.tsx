/* The one stage this build actually performs.
 *
 * Everything here runs on the photographer's real files: global tools live in
 * the browser for instant slider feedback, AI tools go to the local Python
 * sidecar. Nothing leaves the machine.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import type { Photo, Recipe } from '../../types';
import { cloneRecipe, defaultRecipe, isRecipeActive } from '../../toolRegistry';
import Editor from '../../components/Editor';
import { IcCheck, IcFolderOpen, IcGallery, IcSparkle } from '../../design/Icons';

const dirProps = {
  webkitdirectory: '',
  directory: '',
  multiple: true,
} as unknown as InputHTMLAttributes<HTMLInputElement>;

let idCounter = 0;

// Sample frames served from public/demo, so the editor can be opened without a
// folder picker. Dev only — the picker is the real entry point.
const DEMO = ['/demo/b.jpg', '/demo/c.jpg', '/demo/a.jpg'];

export default function GalleryEdit() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function loadDemo() {
    const imgs = DEMO.map((url) => ({
      id: `p${idCounter++}`,
      name: url.split('/').pop()!,
      url,
      recipe: defaultRecipe(),
    }));
    setPhotos(imgs);
    setOpenId(imgs[0].id);
  }

  // `#/editing/gallery-edit/demo` opens straight into the sample set — used to
  // check the stage without a folder picker.
  useEffect(() => {
    if (import.meta.env.DEV && window.location.hash.endsWith('/demo')) loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPhoto = useMemo(
    () => photos.find((p) => p.id === openId) ?? null,
    [photos, openId],
  );

  const loadFolder = useCallback((files: FileList) => {
    const imgs: Photo[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
      imgs.push({
        id: `p${idCounter++}`,
        name: file.name,
        url: URL.createObjectURL(file),
        recipe: defaultRecipe(),
      });
    }
    if (imgs.length === 0) return;
    setPhotos(imgs);
    setOpenId(imgs[0].id);
    setSelected(new Set());
  }, []);

  const updateRecipe = useCallback((id: string, recipe: Recipe) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, recipe } : p)));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyToSelected = useCallback(() => {
    if (!openPhoto) return;
    const recipe = openPhoto.recipe;
    setPhotos((prev) =>
      prev.map((p) => (selected.has(p.id) ? { ...p, recipe: cloneRecipe(recipe) } : p)),
    );
  }, [openPhoto, selected]);

  if (photos.length === 0) {
    return (
      <div className="edit-empty" data-surface="studio">
        <div className="edit-empty-card">
          <span className="edit-empty-ico">
            <IcGallery size={30} />
          </span>
          <h2>עיבוד גלריה</h2>
          <p>
            טעני את התמונות שנבחרו, בני מתכון עריכה על תמונה אחת,
            והחילי אותו על כל השאר.
          </p>
          <label className="btn btn-primary" style={{ height: 44, padding: '0 26px' }}>
            <IcFolderOpen size={18} />
            בחרי תיקייה
            <input
              type="file"
              {...dirProps}
              hidden
              onChange={(e) => e.target.files && loadFolder(e.target.files)}
            />
          </label>
          {import.meta.env.DEV && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={loadDemo}>
                טעני תמונות לדוגמה
              </button>
            </div>
          )}
          <div className="edit-empty-note">
            🔒 התמונות נשארות במחשב שלך — שום דבר לא עולה לאינטרנט.
          </div>
        </div>
      </div>
    );
  }

  const edited = photos.filter((p) => isRecipeActive(p.recipe)).length;

  return (
    <div className="edit-stage" data-surface="studio">
      <div className="edit-bar">
        <div className="edit-counts">
          <span>{photos.length} תמונות</span>
          <i />
          <span>{edited} נערכו</span>
          <i />
          <span>{selected.size} מסומנות</span>
        </div>
        <div className="row">
          <button
            className="btn btn-ghost"
            onClick={() => setSelected(new Set(photos.map((p) => p.id)))}
          >
            סמני הכל
          </button>
          <label className="btn">
            <IcFolderOpen size={17} />
            טעני תיקייה
            <input
              type="file"
              {...dirProps}
              hidden
              onChange={(e) => e.target.files && loadFolder(e.target.files)}
            />
          </label>
        </div>
      </div>

      <div className="edit-body">
        {openPhoto && (
          <Editor
            key={openPhoto.id}
            photo={openPhoto}
            recipe={openPhoto.recipe}
            onRecipeChange={(r) => updateRecipe(openPhoto.id, r)}
            onApplyToSelected={applyToSelected}
            selectedCount={selected.size}
          />
        )}
      </div>

      <nav className="filmstrip scroll-y">
        {photos.map((p) => {
          const isEdited = isRecipeActive(p.recipe);
          return (
            <div
              key={p.id}
              className={`thumb ${p.id === openId ? 'open' : ''} ${
                selected.has(p.id) ? 'selected' : ''
              }`}
              onClick={() => setOpenId(p.id)}
              title={p.name}
            >
              <img src={p.url} alt={p.name} loading="lazy" />
              {isEdited && (
                <span className="thumb-badge">
                  <IcSparkle size={11} />
                </span>
              )}
              <button
                className="thumb-check"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(p.id);
                }}
                aria-label="סמני לאצווה"
              >
                {selected.has(p.id) && <IcCheck size={13} />}
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
