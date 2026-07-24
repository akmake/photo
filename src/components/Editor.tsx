import { useEffect, useRef, useState } from 'react';
import type { Photo, Recipe, ToolInstance } from '../types';
import {
  getTool,
  defaultRecipe,
  isToolAtDefault,
  updateToolParams,
  setToolEnabled,
  activeTools,
  orderedInstances,
} from '../toolRegistry';
import { applyGlobalTool } from '../imageEngine';
import { applyAiTool } from '../api';
import StyleBar from './StyleBar';

const MAX_PREVIEW = 1200;

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
  const originalRef = useRef<ImageData | null>(null);
  const aiBaseRef = useRef<ImageData | null>(null);
  const aiKeyRef = useRef<string>('');

  const [showOriginal, setShowOriginal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInfo, setAiInfo] = useState<string | null>(null);
  const [renderMs, setRenderMs] = useState(0);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['tone-color']));

  // Every enabled AI tool, in pipeline order. They chain through the engine.
  const enabledAi = orderedInstances(recipe).filter(
    (i) => getTool(i.toolId).kind === 'ai' && i.enabled,
  );

  function aiKey(): string {
    if (enabledAi.length === 0) return 'none';
    return enabledAi.map((i) => `${i.toolId}:${JSON.stringify(i.params)}`).join('|');
  }

  // The render pipeline: AI stage (cached) → global tools in order.
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
    const t0 = performance.now();
    const base = aiBaseRef.current ?? orig;
    const globals = activeTools(recipe).filter(
      (i) => getTool(i.toolId).kind === 'global',
    );
    let img: ImageData = base;
    for (const inst of globals) {
      img = applyGlobalTool(inst.toolId, img, inst.params);
    }
    ctx.putImageData(img, 0, 0);
    setRenderMs(Math.round(performance.now() - t0));
  }

  async function ensureAiStage(): Promise<void> {
    const key = aiKey();
    if (key === aiKeyRef.current) return;

    if (enabledAi.length === 0) {
      aiBaseRef.current = null;
      aiKeyRef.current = key;
      setAiInfo(null);
      return;
    }
    setAiBusy(true);
    const t0 = performance.now();
    try {
      const orig = originalRef.current!;
      // chain each AI tool's output into the next
      let current = photo.url;
      const notes: string[] = [];
      for (const inst of enabledAi) {
        const res = await applyAiTool(inst.toolId, current, inst.params);
        current = res.image;
        const metaKey = res.meta ? Object.keys(res.meta)[0] : undefined;
        if (res.meta && metaKey) {
          notes.push(
            `${getTool(inst.toolId).label} ${Math.round(res.meta[metaKey] * 100)}%`,
          );
        }
      }
      aiBaseRef.current = await loadImageData(current, orig.width, orig.height);
      aiKeyRef.current = key;
      setAiInfo(`✓ ${notes.join(' · ')} · ${Math.round(performance.now() - t0)}ms`);
    } catch {
      aiBaseRef.current = null;
      aiKeyRef.current = 'none';
      setAiInfo('✗ מנוע ה-AI לא זמין');
    } finally {
      setAiBusy(false);
    }
  }

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

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    if (aiKey() === aiKeyRef.current) {
      draw();
      return;
    }
    draw();
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

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isActive(inst: ToolInstance): boolean {
    const def = getTool(inst.toolId);
    return def.kind === 'ai' ? inst.enabled : !isToolAtDefault(inst);
  }

  return (
    <div className="editor">
      <div className="canvas-wrap">
        {loading && <div className="loading">טוען…</div>}
        <canvas ref={canvasRef} className="preview-canvas" />
        <div className="canvas-name">
          {photo.name}
          {enabledAi.length > 0 && <span className="ai-tag">AI</span>}
          {renderMs > 0 && <span className="ms">{renderMs}ms</span>}
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

        <StyleBar recipe={recipe} onApply={onRecipeChange} />

        {/* Every tool is rendered generically from the registry. */}
        <div className="tools">
          {orderedInstances(recipe).map((inst) => {
            const def = getTool(inst.toolId);
            const open = openGroups.has(def.id);
            const active = isActive(inst);
            return (
              <div className={`tool-group ${active ? 'on' : ''}`} key={def.id}>
                <div className="group-head" onClick={() => toggleGroup(def.id)}>
                  <span className="caret">{open ? '▾' : '▸'}</span>
                  <span className="group-title">
                    {def.kind === 'ai' ? '✨ ' : ''}
                    {def.label}
                  </span>
                  {def.kind === 'ai' ? (
                    <label className="switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={inst.enabled}
                        onChange={(e) =>
                          onRecipeChange(setToolEnabled(recipe, def.id, e.target.checked))
                        }
                      />
                      <span className="slider-sw" />
                    </label>
                  ) : (
                    active && <span className="dot" />
                  )}
                </div>

                {open && (
                  <div className="group-body">
                    {def.params.map((spec) => {
                      const val = inst.params[spec.id];
                      const on = val !== spec.default;
                      return (
                        <div className={`tool ${on ? 'active' : ''}`} key={spec.id}>
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
                            onChange={(e) =>
                              onRecipeChange(
                                updateToolParams(recipe, def.id, {
                                  [spec.id]: Number(e.target.value),
                                }),
                              )
                            }
                            onDoubleClick={() =>
                              onRecipeChange(
                                updateToolParams(recipe, def.id, {
                                  [spec.id]: spec.default,
                                }),
                              )
                            }
                          />
                        </div>
                      );
                    })}
                    {def.kind === 'ai' && inst.enabled && (aiBusy || aiInfo) && (
                      <div className="ai-info">{aiBusy ? 'מעבד…' : aiInfo}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
