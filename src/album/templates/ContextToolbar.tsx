import { useEffect, useRef, useState, type ReactNode } from 'react';

/* The tools of whatever is selected — a photograph, a text, an element.
 *
 * One horizontal bar across the top of the canvas, the way Canva does it,
 * because that is the program these photographers already know.
 *
 * It lived here once before and was moved to the side panel, for a real
 * reason: it was a row of TABS, and opening one dropped a tall panel over the
 * very spread it was adjusting. The side panel fixed the covering and paid for
 * it twice over — the controls ended up far from the photograph, and every
 * adjustment cost two clicks, one to guess the category and one to reach the
 * control.
 *
 * Canva's answer, and now ours: the controls the photographer actually reaches
 * for live IN the bar, spelled out, nothing to open. Only the rare ones get a
 * button, and each opens a small popover anchored under itself — a few
 * centimetres of the canvas edge, not a panel across the spread. */

export interface ToolbarMenu {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  /** Popover width in px. The default fits a label and a slider. */
  width?: number;
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick(): void;
  danger?: boolean;
}

export default function ContextToolbar({ name, inline, menus, actions, onDone }: {
  /** What is selected, e.g. "תמונה". */
  name: string;
  /** Controls spelled out in the bar itself — no click to reach them. */
  inline?: ReactNode;
  menus: ToolbarMenu[];
  actions: ToolbarAction[];
  onDone(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  /* Anything outside the bar closes the popover — including the spread itself,
   * so one click gets the photographer back to dragging the photograph. */
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // the selection changed under us and took its menu with it
  useEffect(() => {
    if (open && !menus.some((menu) => menu.id === open)) setOpen(null);
  }, [menus, open]);

  return (
    /* No "you have selected a photograph" label: the controls in the bar say
     * what is selected better than the word does, and the width they save is
     * width the spread gets. Canva does not label it either. */
    <div className="ctx-bar" ref={bar} role="toolbar" aria-label={`כלי ${name}`}>
      {inline && <div className="ctx-bar-inline">{inline}</div>}

      {menus.length > 0 && <span className="ctx-bar-sep" aria-hidden="true" />}

      {menus.map((menu) => (
        <div className="ctx-menu" key={menu.id}>
          <button
            className={menu.id === open ? 'on' : ''}
            aria-expanded={menu.id === open}
            onClick={() => setOpen(open === menu.id ? null : menu.id)}
          >
            {menu.icon}
            <span>{menu.label}</span>
          </button>
          {menu.id === open && (
            <div
              className="ctx-pop"
              style={{ width: menu.width ?? 268 }}
              role="dialog"
              aria-label={menu.label}
            >
              {menu.content}
            </div>
          )}
        </div>
      ))}

      <span className="ctx-bar-spacer" />

      {actions.map((action) => (
        <button
          key={action.id}
          className={`ctx-bar-action ${action.danger ? 'danger' : ''}`}
          title={action.label}
          aria-label={action.label}
          onClick={action.onClick}
        >
          {action.icon}
        </button>
      ))}

      <button className="ctx-done" onClick={onDone}>סיום</button>
    </div>
  );
}

/* ---------------------------------------------------------------- furniture */

/** A number with − and +, as Canva sizes type. A slider cannot land on 48pt. */
export function ToolbarStepper({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange(next: number): void;
}) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const round = (next: number) => Math.round(next * 1000) / 1000;
  return (
    <span className="ctx-step" title={label}>
      <button
        type="button"
        aria-label={`${label} — הקטנה`}
        disabled={value <= min}
        onClick={() => onChange(round(clamp(value - step)))}
      >
        −
      </button>
      <input
        type="number"
        dir="ltr"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(round(clamp(next)));
        }}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {suffix && <em>{suffix}</em>}
      <button
        type="button"
        aria-label={`${label} — הגדלה`}
        disabled={value >= max}
        onClick={() => onChange(round(clamp(value + step)))}
      >
        +
      </button>
    </span>
  );
}

/** One choice out of a few, all of them visible. */
export function ToolbarSegment<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange(next: T): void;
}) {
  return (
    <span className="ctx-seg" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className={id === value ? 'on' : ''}
          aria-pressed={id === value}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

/** A colour, shown as the colour itself — no label needed. */
export function ToolbarColor({ label, value, onChange, onDone }: {
  label: string;
  value: string;
  onChange(next: string): void;
  onDone?(): void;
}) {
  return (
    <span className="ctx-color" title={label}>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onDone}
      />
    </span>
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
