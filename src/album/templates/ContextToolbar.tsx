import { useEffect, useRef, useState, type ReactNode } from 'react';

/* The toolbar that appears over the spread when a photo or element is selected —
 * Canva's pattern: a short row of named tools, each opening a small panel right
 * under it, and the actions (duplicate, delete) at the end. Only what belongs
 * to the selected thing is ever on screen. */

export interface ToolbarTool {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick(): void;
  danger?: boolean;
}

export default function ContextToolbar({ name, tools, actions, onDone }: {
  /** What is selected, e.g. "תמונה". */
  name: string;
  tools: ToolbarTool[];
  actions: ToolbarAction[];
  onDone(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  // a click anywhere outside the toolbar closes its panel; Escape too
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (bar.current && !bar.current.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const current = tools.find((tool) => tool.id === open);

  return (
    <div className="ctx-toolbar" ref={bar} onPointerDown={(event) => event.stopPropagation()}>
      <div className="ctx-bar" role="toolbar" aria-label={`כלים ל${name}`}>
        <span className="ctx-name">{name}</span>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={open === tool.id ? 'on' : ''}
            aria-expanded={open === tool.id}
            onClick={(event) => {
              const barBox = bar.current?.getBoundingClientRect();
              const box = event.currentTarget.getBoundingClientRect();
              setAnchor(barBox ? box.left + box.width / 2 - barBox.left : 0);
              setOpen(open === tool.id ? null : tool.id);
            }}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </button>
        ))}
        {actions.length > 0 && <i className="ctx-divider" aria-hidden="true" />}
        {actions.map((action) => (
          <button
            key={action.id}
            className={`ctx-icon ${action.danger ? 'danger' : ''}`}
            title={action.label}
            aria-label={action.label}
            onClick={() => { setOpen(null); action.onClick(); }}
          >
            {action.icon}
          </button>
        ))}
        <i className="ctx-divider" aria-hidden="true" />
        <button className="ctx-done" onClick={onDone}>סיום</button>
      </div>
      {current && (
        <div className="ctx-popover" style={{ '--ctx-anchor': `${anchor}px` } as React.CSSProperties} role="dialog" aria-label={current.label}>
          <header>
            <strong>{current.label}</strong>
            <button onClick={() => setOpen(null)} aria-label="סגירה">×</button>
          </header>
          <div className="ctx-popover-body">{current.content}</div>
        </div>
      )}
    </div>
  );
}

/* Small line icons for the toolbar, drawn in the same 24-unit grid. */
const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

export const ToolIcons = {
  crop: icon(<><path d="M6 2v16h16" /><path d="M2 6h16v16" /></>),
  fade: icon(<><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M13 5v14M16 5v14M19 5v14" strokeDasharray="2 2" /></>),
  rotate: icon(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>),
  frame: icon(<><rect x="3" y="3" width="18" height="18" rx="4" /><rect x="7" y="7" width="10" height="10" rx="1" /></>),
  layers: icon(<><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>),
  text: icon(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
  color: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" /></>),
  opacity: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 21 21 3M3 15 15 3M9 21 21 9" /></>),
  position: icon(<><path d="M12 3v18M3 12h18" /><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>),
  duplicate: icon(<><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>),
  trash: icon(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>),
  unplace: icon(<><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m9 10 6 6M15 10l-6 6" /></>),
};
