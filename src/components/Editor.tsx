import { useEffect, useRef, useState } from 'react';
import type { Photo, Recipe, ToolId } from '../types';
import { TOOLS, emptyRecipe, isRecipeEmpty } from '../toolDefs';
import { applyRecipe } from '../imageEngine';

const MAX_PREVIEW = 1400;

interface Props {
  photo: Photo;
  recipe: Recipe;
  onRecipeChange: (r: Recipe) => void;
  onApplyToSelected: () => void;
  selectedCount: number;
}

export default function Editor({
  photo,
  recipe,
  onRecipeChange,
  onApplyToSelected,
  selectedCount,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<ImageData | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load the image and capture its original pixels once per photo.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, MAX_PREVIEW / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      originalRef.current = ctx.getImageData(0, 0, w, h);
      setLoading(false);
    };
    img.src = photo.url;
    return () => {
      cancelled = true;
    };
  }, [photo.url]);

  // Redraw whenever the recipe or before/after toggle changes.
  useEffect(() => {
    if (loading) return;
    const canvas = canvasRef.current;
    const orig = originalRef.current;
    if (!canvas || !orig) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (showOriginal || isRecipeEmpty(recipe)) {
      ctx.putImageData(orig, 0, 0);
      return;
    }
    const copy = new ImageData(
      new Uint8ClampedArray(orig.data),
      orig.width,
      orig.height,
    );
    applyRecipe(copy.data, recipe);
    ctx.putImageData(copy, 0, 0);
  }, [recipe, showOriginal, loading]);

  function setTool(id: ToolId, value: number) {
    onRecipeChange({ ...recipe, [id]: value });
  }

  return (
    <div className="editor">
      <div className="canvas-wrap">
        {loading && <div className="loading">טוען…</div>}
        <canvas ref={canvasRef} className="preview-canvas" />
        <div className="canvas-name">{photo.name}</div>
      </div>

      <aside className="tool-panel">
        <div className="tool-panel-header">
          <h2>מתכון עריכה</h2>
          <button
            className="ghost"
            onMouseDown={() => setShowOriginal(true)}
            onMouseUp={() => setShowOriginal(false)}
            onMouseLeave={() => setShowOriginal(false)}
          >
            לפני / אחרי
          </button>
        </div>

        <div className="tools">
          {TOOLS.map((t) => {
            const active = recipe[t.id] !== t.default;
            return (
              <div className={`tool ${active ? 'active' : ''}`} key={t.id}>
                <div className="tool-row">
                  <label>{t.label}</label>
                  <span className="val">{recipe[t.id]}</span>
                </div>
                <input
                  type="range"
                  min={t.min}
                  max={t.max}
                  step={t.step}
                  value={recipe[t.id]}
                  onChange={(e) => setTool(t.id, Number(e.target.value))}
                  onDoubleClick={() => setTool(t.id, t.default)}
                />
              </div>
            );
          })}
        </div>

        <div className="tool-actions">
          <button className="secondary" onClick={() => onRecipeChange(emptyRecipe())}>
            איפוס
          </button>
          <button
            className="primary"
            disabled={selectedCount === 0}
            onClick={onApplyToSelected}
          >
            החל על המסומנות ({selectedCount})
          </button>
        </div>
      </aside>
    </div>
  );
}
