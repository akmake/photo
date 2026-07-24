import { useCallback, useMemo, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import type { Photo, Recipe } from './types';
import { defaultRecipe, isRecipeActive, cloneRecipe } from './toolRegistry';
import Editor from './components/Editor';

// webkitdirectory / directory aren't in the standard React input typings.
const dirProps = {
  webkitdirectory: '',
  directory: '',
  multiple: true,
} as unknown as InputHTMLAttributes<HTMLInputElement>;

let idCounter = 0;

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      prev.map((p) =>
        selected.has(p.id) ? { ...p, recipe: cloneRecipe(recipe) } : p,
      ),
    );
  }, [openPhoto, selected]);

  if (photos.length === 0) {
    return <EmptyState onFolder={loadFolder} />;
  }

  const editedCount = photos.filter((p) => isRecipeActive(p.recipe)).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Signet<span> · עורך תמונות</span>
        </div>
        <div className="topbar-meta">
          {photos.length} תמונות · {editedCount} נערכו · {selected.size} מסומנות
        </div>
        <label className="load-more">
          טען תיקייה
          <input
            type="file"
            {...dirProps}
            hidden
            onChange={(e) => e.target.files && loadFolder(e.target.files)}
          />
        </label>
      </header>

      <div className="body">
        <main className="stage">
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
        </main>

        <nav className="filmstrip">
          {photos.map((p) => (
            <Thumb
              key={p.id}
              photo={p}
              open={p.id === openId}
              selected={selected.has(p.id)}
              onOpen={() => setOpenId(p.id)}
              onToggle={() => toggleSelect(p.id)}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

function Thumb({
  photo,
  open,
  selected,
  onOpen,
  onToggle,
}: {
  photo: Photo;
  open: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const edited = isRecipeActive(photo.recipe);
  return (
    <div
      className={`thumb ${open ? 'open' : ''} ${selected ? 'selected' : ''}`}
      onClick={onOpen}
      title={photo.name}
    >
      <img src={photo.url} alt={photo.name} loading="lazy" />
      {edited && <span className="badge">נערך</span>}
      <button
        className="check"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label="סמן לאצווה"
      >
        {selected ? '✓' : ''}
      </button>
    </div>
  );
}

function EmptyState({ onFolder }: { onFolder: (f: FileList) => void }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-logo">SIGNET</div>
        <h1>עורך התמונות</h1>
        <p>טעני תיקיית תמונות, בני מתכון עריכה על תמונה אחת, והחילי אותו על כל השאר.</p>
        <label className="primary big">
          בחרי תיקייה
          <input
            type="file"
            {...dirProps}
            hidden
            onChange={(e) => e.target.files && onFolder(e.target.files)}
          />
        </label>
        <p className="hint">🔒 התמונות נשארות אצלך במחשב — שום דבר לא עולה לאינטרנט.</p>
      </div>
    </div>
  );
}
