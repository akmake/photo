import { useEffect, useState, type ReactNode } from 'react';

/* The tools of whatever is selected — a photograph, a text, an element.
 *
 * It lives in the side panel, in the place the spread's own tabs occupy when
 * nothing is selected. It used to float across the top of the canvas with its
 * panel dropping over the spread, which put the controls on top of the very
 * photograph they adjust; the spread panel next door says in its own header
 * comment that a selection "replaces this panel with its own tools", and this
 * is that. Same shape as that panel on purpose: a rail of named tools, one
 * open at a time, a line of explanation, and the destructive actions last. */

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
  /* The first tool is open on arrival. Nothing is covered here, so making the
   * photographer click twice to reach the control she came for buys nothing. */
  const [open, setOpen] = useState<string>(tools[0]?.id ?? '');
  const current = tools.find((tool) => tool.id === open) ?? tools[0];

  // the selection changed under us — fall back to the first tool of the new one
  useEffect(() => {
    if (!tools.some((tool) => tool.id === open)) setOpen(tools[0]?.id ?? '');
  }, [tools, open]);

  return (
    <div className="ctx-panel">
      <header className="ctx-panel-head">
        <strong>{name}</strong>
        <button className="ctx-done" onClick={onDone}>סיום</button>
      </header>

      <nav className="ctx-rail" role="tablist" aria-label={`כלים ל${name}`}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            role="tab"
            className={tool.id === current?.id ? 'on' : ''}
            aria-selected={tool.id === current?.id}
            onClick={() => setOpen(tool.id)}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </button>
        ))}
      </nav>

      {current && (
        <div className="ctx-panel-body" role="tabpanel" aria-label={current.label}>
          {current.content}
        </div>
      )}

      {actions.length > 0 && (
        <footer className="ctx-panel-actions">
          {actions.map((action) => (
            <button
              key={action.id}
              className={action.danger ? 'danger' : ''}
              onClick={action.onClick}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </footer>
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
