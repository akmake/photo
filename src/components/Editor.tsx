import { useEffect, useRef, useState } from 'react';
import type { Photo, Recipe, ParamValues } from '../types';
import {
  getTool,
  getInstance,
  defaultRecipe,
  isToolAtDefault,
  updateToolParams,
  setToolEnabled,
} from '../toolRegistry';
import { applyToneColor } from '../imageEngine';
import { applyAiTool } from '../api';

const MAX_PREVIEW = 1400;

interface Props {
  photo: Photo;
  recipe: Recipe;
  onRecipeChange: (r: Recipe) => void;
  onApplyToSelected: () => void;
  selectedCount: number;
}

function loadImageData(src: string, w: number, h: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = reject;
    img.src = src;
  });
}

export default function Editor({
  photo,
  recipe,
  onRecipeChange,
  onApplyToSelected,
  selectedCount,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<ImageData | null>(null); // preview-scale original
  const aiBaseRef = useRef<ImageData | null>(null); // image after AI tools (null = original)
  const aiKeyRef = useRef<string>('');

  const [showOriginal, setShowOriginal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInfo, setAiInfo] = useState<string | null>(null);

  const toneDef = getTool('tone-color');
  const toneInst = getInstance(recipe, 'tone-color');
  const skinDef = getTool('skin');
  const skinInst = getInstance(recipe, 'skin');

  // The cache key for the AI stage (which AI tools + params are active).
  function aiKey(): string {
    return skinInst.enabled ? `skin:${skinInst.params.strength}` : 'none';
  }

  function draw() {
    const canvas = canvasRef.current;
    const orig = originalRef.current;
    if (!canvas || !orig) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (showOriginal) {
      ctx.putImageData(orig, 0, 0);
      return;
    }
    const base = aiBaseRef.current ?? orig;
    if (!toneInst.enabled || isToolAtDefault(toneInst)) {
      ctx.putImageData(base, 0, 0);
      return;
    }
    const copy = new ImageData(
      new Uint8ClampedArray(base.data),
      base.width,
      base.height,
    );
    applyToneColor(copy.data, toneInst.params);
    ctx.putImageData(copy, 0, 0);
  }

  // Recompute the AI stage (runs enabled AI tools on the original via the engine).
  async function ensureAiStage(): Promise<void> {
    const key = aiKey();
    if (key === aiKeyRef.current) return;

    if (!skinInst.enabled) {
      aiBaseRef.current = null; // base is the original
      aiKeyRef.current = key;
      setAiInfo(null);
      return;
    }

    setAiBusy(true);
    const t0 = performance.now();
    try {
      const orig = originalRef.current!;
      const res = await applyAiTool('skin', photo.url, skinInst.params);
      aiBaseRef.current = await loadImageData(res.image, orig.width, orig.height);
      aiKeyRef.current = key;
      const ms = Math.round(performance.now() - t0);
      const cov = Math.round((res.meta?.skinCoverage ?? 0) * 100);
      setAiInfo(`✓ עור זוהה: ${cov}% · ${ms}ms`);
    } catch {
      aiBaseRef.current = null;
      aiKeyRef.current = 'none';
      setAiInfo('✗ מנוע ה-AI לא זמין');
    } finally {
      setAiBusy(false);
    }
  }

  // Load the image once per photo, capture original pixels, draw.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aiBaseRef.current = null;
    aiKeyRef.current = '';
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
      draw();
    };
    img.src = photo.url;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.url]);

  // Pipeline: on any recipe / before-after change, refresh the AI stage
  // (debounced — it hits the engine) then draw the global tools on top.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    if (aiKey() === aiKeyRef.current) {
      draw(); // only global / before-after changed — instant
      return;
    }
    draw(); // show current state while the engine works
    const timer = setTimeout(async () => {
      await ensureAiStage();
      if (!cancelled) draw();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, showOriginal, loading]);

  function setToneParam(id: string, value: number) {
    const patch: ParamValues = { [id]: value };
    onRecipeChange(updateToolParams(recipe, 'tone-color', patch));
  }

  return (
    <div className="editor">
      <div className="canvas-wrap">
        {loading && <div className="loading">טוען…</div>}
        <canvas ref={canvasRef} className="preview-canvas" />
        <div className="canvas-name">
          {photo.name}
          {skinInst.enabled && <span className="ai-tag">AI</span>}
        </div>
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
          {/* Global tool: tone & color */}
          <div className="section-head">{toneDef.label}</div>
          {toneDef.params.map((spec) => {
            const val = toneInst.params[spec.id];
            const active = val !== spec.default;
            return (
              <div className={`tool ${active ? 'active' : ''}`} key={spec.id}>
                <div className="tool-row">
                  <label>{spec.label}</label>
                  <span className="val">{val}</span>
                </div>
                <input
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={val}
                  onChange={(e) => setToneParam(spec.id, Number(e.target.value))}
                  onDoubleClick={() => setToneParam(spec.id, spec.default)}
                />
              </div>
            );
          })}

          {/* AI tool: skin — a first-class citizen of the recipe */}
          <div className="ai-section">
            <div className="section-head ai">
              <span>✨ {skinDef.label}</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={skinInst.enabled}
                  onChange={(e) =>
                    onRecipeChange(setToolEnabled(recipe, 'skin', e.target.checked))
                  }
                />
                <span className="slider-sw" />
              </label>
            </div>
            {skinInst.enabled && (
              <>
                <div className="tool active">
                  <div className="tool-row">
                    <label>{skinDef.params[0].label}</label>
                    <span className="val">{skinInst.params.strength}</span>
                  </div>
                  <input
                    type="range"
                    min={skinDef.params[0].min}
                    max={skinDef.params[0].max}
                    step={skinDef.params[0].step}
                    value={skinInst.params.strength}
                    onChange={(e) =>
                      onRecipeChange(
                        updateToolParams(recipe, 'skin', {
                          strength: Number(e.target.value),
                        }),
                      )
                    }
                  />
                </div>
                {(aiBusy || aiInfo) && (
                  <div className="ai-info">{aiBusy ? 'מעבד…' : aiInfo}</div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="tool-actions">
          <button className="secondary" onClick={() => onRecipeChange(defaultRecipe())}>
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
