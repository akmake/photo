import { useMemo, useRef, useState } from 'react';
import { BASIC_ELEMENTS, vaultElements, type ElementDef } from './elements';
import { elementUrl } from './elementStore';

interface Props {
  myElements: ElementDef[];
  /** False when the spread has no Vault page yet — elements live on a page. */
  enabled: boolean;
  onAdd(element: ElementDef): void;
  onImport(files: FileList): void;
  onRemoveMine(element: ElementDef): void;
}

/* The element library in the spread panel: basics, the Vault's own artwork and
 * the photographer's imports. A click drops the element on the spread. */
export default function ElementsPanel({ myElements, enabled, onAdd, onImport, onRemoveMine }: Props) {
  const [tab, setTab] = useState<'basic' | 'vault' | 'mine'>('basic');
  const input = useRef<HTMLInputElement>(null);
  const vault = useMemo(() => vaultElements(), []);
  const list = tab === 'basic' ? BASIC_ELEMENTS : tab === 'vault' ? vault : myElements;

  return (
    <section className="tpl-panel tpl-elements" aria-label="אלמנטים">
      <strong>אלמנטים</strong>
      <div className="tpl-tabs" role="tablist">
        {([['basic', 'בסיס'], ['vault', `מהכספת · ${vault.length}`], ['mine', `שלי · ${myElements.length}`]] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'on' : ''} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>
      {!enabled && <small>בחר קודם עמוד מהכספת לכפולה — האלמנטים מתווספים אליו.</small>}
      {tab === 'mine' && (
        <>
          <button className="tpl-open-gallery" onClick={() => input.current?.click()}>＋ ייבוא אלמנטים (PNG / SVG / WebP שקופים)</button>
          <input
            ref={input}
            type="file"
            accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) onImport(event.target.files);
              event.target.value = '';
            }}
          />
          {!myElements.length && <small>עוד לא יובאו אלמנטים. הם יישמרו במחשב ויהיו זמינים בכל אלבום.</small>}
        </>
      )}
      <div className="tpl-element-grid">
        {list.map((element) => (
          <div key={element.id} className="tpl-element-cell">
            <button
              className="tpl-element"
              disabled={!enabled}
              title={element.name}
              onClick={() => onAdd(element)}
            >
              <ElementThumb element={element} />
            </button>
            {element.group === 'mine' && (
              <button className="tpl-element-remove" title="הסרה מהספרייה" onClick={() => onRemoveMine(element)}>×</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ElementThumb({ element }: { element: ElementDef }) {
  if (element.kind === 'path' && element.d && element.bounds) {
    const b = element.bounds;
    const pad = Math.max(b.width, b.height) * 0.08;
    return (
      <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`} aria-hidden="true">
        <path
          d={element.d}
          fill={element.fill ? 'currentColor' : 'none'}
          stroke={element.stroke ? 'currentColor' : undefined}
          strokeWidth={element.strokeWidth ? Math.max(b.width, b.height) * 0.02 : undefined}
        />
      </svg>
    );
  }
  if (element.kind === 'text') {
    return <span className="tpl-element-text" style={{ fontFamily: element.fontFamily }}>{element.text}</span>;
  }
  if (element.kind === 'image' && element.assetId) {
    const url = elementUrl(element.assetId);
    return url ? <img src={url} alt="" draggable={false} /> : <span className="tpl-element-text">חסר</span>;
  }
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      {element.kind === 'line' && <line x1="4" y1="20" x2="36" y2="20" stroke="currentColor" strokeWidth="2" />}
      {element.kind === 'rect' && <rect x="6" y="9" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="2" />}
      {element.kind === 'ellipse' && <ellipse cx="20" cy="20" rx="14" ry="12" fill="none" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}
