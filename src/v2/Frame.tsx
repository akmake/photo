/* THE FRAME: the top bar every screen sits under, the status bar under it, and
 * the quick search. From the FrameOps.dc.html handoff (claude.ai/design),
 * 09.10.2026, which replaced the side rail.
 *
 * Everything shown here is read from the studio. The handoff was a demo full of
 * invented clients, sums and render jobs; where this program has no source for
 * a number yet (background jobs, free disk space), the frame shows nothing
 * rather than a figure no one measured (CLAUDE.md §5). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../studio/store';
import { STATE_LABEL } from '../studio/store';
import { useTour } from '../tour/TourProvider';
import {
  TzIconBell, TzIconFlask, TzIconGear, TzIconHelp, TzIconSliders, TzIconSparkle,
} from './TzIcons';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'frameops_theme';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* A private window: the choice lasts for this session only. */
  }
}

export const BUSINESS_TABS = [
  { id: 'today', label: 'היום' },
  { id: 'projects', label: 'פרויקטים' },
  { id: 'clients', label: 'לקוחות' },
  { id: 'calendar', label: 'יומן' },
] as const;

/* The workshops sit under one tab, כלים, as in the handoff. They are rooms you
 * go to on purpose, not places the day passes through. */
export const TOOL_ITEMS = [
  { id: 'smart-cleanup', label: 'ניקוי חכם', Icon: TzIconSparkle },
  { id: 'lab', label: 'מעבדה', Icon: TzIconSliders },
  { id: 'experiments', label: 'כלים בניסיון', Icon: TzIconFlask },
] as const;

const SCREEN_ITEMS = [
  ...BUSINESS_TABS,
  ...TOOL_ITEMS.map(({ id, label }) => ({ id, label })),
  { id: 'settings', label: 'הגדרות' },
];

function IcPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IcUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function IcSearch({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IcPanel() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function IcCaret() {
  return (
    <svg className="fo-tab-caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The "?" of every screen: replays that screen's tour. Disabled — and says
 *  why — on a screen whose tour is not written yet, rather than doing nothing. */
function HelpButton() {
  const tour = useTour();
  const ready = Boolean(tour.screenTour);
  return (
    <button
      className="fo-icon-btn"
      type="button"
      data-tour="help-button"
      title={ready ? 'הדרכה למסך הזה' : 'ההדרכה למסך הזה עוד לא נכתבה'}
      aria-label="הדרכה למסך הזה"
      disabled={!ready || tour.active}
      onClick={tour.startScreenTour}
    >
      <TzIconHelp size={17} />
    </button>
  );
}

export interface Attention {
  waiting: Project[];
  soon: { project: Project; when: Date }[];
  count: number;
}

export function TopBar({
  activeNav,
  onNav,
  projectCount,
  onNewProject,
  onImport,
  importHint,
  onSearch,
  attention,
  onOpenProject,
  inspector,
  theme,
  onTheme,
}: {
  activeNav: string;
  onNav: (id: string) => void;
  projectCount: number;
  onNewProject: () => void;
  /** Absent when there is no project to import into — the button says so. */
  onImport?: () => void;
  importHint: string;
  onSearch: () => void;
  attention: Attention;
  onOpenProject: (id: string, stage?: string) => void;
  /** The details panel toggle, only on a screen that has one. */
  inspector?: { open: boolean; toggle: () => void } | null;
  theme: Theme;
  onTheme: () => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const toolOn = TOOL_ITEMS.some((t) => t.id === activeNav);

  return (
    <header className="fo-topbar">
      <div className="fo-top-start">
        <button type="button" className="fo-logo" onClick={() => onNav('today')} title="FrameOps — חזרה להיום">
          <img src={`${import.meta.env.BASE_URL}frameops-mark.png`} alt="FrameOps" />
        </button>
        <button type="button" className="fo-btn is-primary" data-tour="projects-new" onClick={onNewProject}>
          <IcPlus />פרויקט חדש
        </button>
        <button type="button" className="fo-btn" onClick={onImport} disabled={!onImport} title={importHint}>
          <IcUpload />ייבוא
        </button>
      </div>

      <nav className="fo-tabs" data-tour="nav-business" aria-label="ניווט ראשי">
        {BUSINESS_TABS.map((tab) => {
          const on = activeNav === tab.id || (tab.id === 'projects' && activeNav === 'project-detail');
          return (
            <button
              key={tab.id}
              type="button"
              className={`fo-tab ${on ? 'is-on' : ''}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => onNav(tab.id)}
            >
              <span className="fo-tab-mark" />
              {tab.label}
              {tab.id === 'projects' && projectCount > 0 && <span className="fo-tab-count">{projectCount}</span>}
            </button>
          );
        })}
        <div className="fo-menu-wrap">
          <button
            type="button"
            className={`fo-tab ${toolOn ? 'is-on' : ''}`}
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((o) => !o)}
          >
            <span className="fo-tab-mark" />
            כלים
            <IcCaret />
          </button>
          {toolsOpen && (
            <>
              <div className="fo-catch" onClick={() => setToolsOpen(false)} />
              <div className="fo-menu" role="menu">
                {TOOL_ITEMS.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className={`fo-menu-item ${activeNav === id ? 'is-on' : ''}`}
                    onClick={() => { setToolsOpen(false); onNav(id); }}
                  >
                    <Icon size={15} />{label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </nav>

      <div className="fo-top-end">
        <button type="button" className="fo-search" data-tour="frame-search" onClick={onSearch}>
          <IcSearch />
          <span className="fo-search-label">חיפוש לקוח, פרויקט, מסך</span>
          <span className="fo-kbd">Ctrl K</span>
        </button>
        <button type="button" className="fo-theme-btn" onClick={onTheme}>
          {theme === 'dark' ? 'מראה בהיר' : 'מראה כהה'}
        </button>
        <HelpButton />
        <div className="fo-menu-wrap">
          <button
            className="fo-icon-btn"
            type="button"
            title={attention.count ? `${attention.count} דברים פתוחים` : 'אין כרגע דבר שממתין לך'}
            onClick={() => setAlerts((open) => !open)}
            aria-expanded={alerts}
          >
            <TzIconBell size={17} />
            {attention.count > 0 && <span className="fo-badge">{attention.count}</span>}
          </button>
          {alerts && (
            <>
              <div className="fo-catch" onClick={() => setAlerts(false)} />
              <div className="tz-alerts fo-alerts" role="dialog" aria-label="מה פתוח">
                <div className="tz-alerts-head">מה מחכה לך</div>
                {attention.count === 0 && (
                  <p className="tz-alerts-none">אין כרגע צילום קרוב ואף לקוח לא ממתין לתשובה.</p>
                )}
                {attention.soon.map(({ project, when }) => (
                  <button
                    key={`s-${project.id}`}
                    type="button"
                    className="tz-alerts-row"
                    onClick={() => { setAlerts(false); onOpenProject(project.id); }}
                  >
                    <strong>{project.event || 'צילום'} — {project.client}</strong>
                    <small>צילום ב־{when.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}</small>
                  </button>
                ))}
                {attention.waiting.map((project) => (
                  <button
                    key={`w-${project.id}`}
                    type="button"
                    className="tz-alerts-row"
                    onClick={() => { setAlerts(false); onOpenProject(project.id, 'send-to-client'); }}
                  >
                    <strong>{project.client}</strong>
                    <small>{project.waitingSince ? `ממתין לאישור מאז ${project.waitingSince}` : 'ממתין לאישור הלקוח'}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {inspector && (
          <button
            type="button"
            className={`fo-icon-btn ${inspector.open ? 'is-on' : ''}`}
            title={inspector.open ? 'הסתר את פאנל הפרטים' : 'הצג את פאנל הפרטים'}
            aria-pressed={inspector.open}
            onClick={inspector.toggle}
          >
            <IcPanel />
          </button>
        )}
        <button
          type="button"
          className={`fo-icon-btn ${activeNav === 'settings' ? 'is-on' : ''}`}
          title="הגדרות"
          aria-label="הגדרות"
          onClick={() => onNav('settings')}
        >
          <TzIconGear size={17} />
        </button>
      </div>
    </header>
  );
}

export function StatusBar({
  status,
  fault,
  saveFault,
  projects,
}: {
  status: 'loading' | 'ready' | 'down';
  fault?: string | null;
  saveFault?: string | null;
  projects: Project[];
}) {
  const photos = projects.reduce((sum, p) => sum + (p.imported || 0), 0);
  const engine =
    status === 'ready' ? { text: 'מנוע מקומי פעיל', color: 'var(--fo-green)' }
    : status === 'loading' ? { text: 'מתחבר למנוע…', color: 'var(--fo-text3)' }
    : { text: 'המנוע לא זמין', color: '#d9534f' };

  return (
    <footer className="fo-statusbar">
      <span className="fo-status-item" title={status === 'down' && fault ? fault : undefined}>
        <span className="fo-dot" style={{ background: engine.color }} />
        {engine.text}
      </span>
      {status === 'ready' && (
        <span className="fo-status-item">
          {projects.length === 1 ? 'פרויקט אחד' : `${projects.length} פרויקטים`}
          {' · '}<span className="fo-mono">{photos.toLocaleString('en-US')}</span> תמונות
        </span>
      )}
      {saveFault && <span className="fo-status-item is-fault">השינוי האחרון לא נשמר — {saveFault}</span>}
    </footer>
  );
}

type Row =
  | { kind: 'project'; id: string; project: Project }
  | { kind: 'screen'; id: string; label: string }
  | { kind: 'new'; id: string };

export function QuickSearch({
  projects,
  onClose,
  onOpenProject,
  onNav,
  onNewProject,
}: {
  projects: Project[];
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onNav: (id: string) => void;
  onNewProject: () => void;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s?: string) => Boolean(s && s.toLowerCase().includes(needle));
    const found = projects.filter((p) => !needle || hit(p.client) || hit(p.event) || hit(p.location));
    const screens = SCREEN_ITEMS.filter((s) => !needle || hit(s.label));
    const out: { title: string; rows: Row[] }[] = [];
    if (found.length) {
      out.push({
        title: 'פרויקטים',
        rows: found.slice(0, 8).map((p) => ({ kind: 'project', id: p.id, project: p })),
      });
    }
    if (screens.length) {
      out.push({ title: 'מסכים', rows: screens.map((s) => ({ kind: 'screen', id: s.id, label: s.label })) });
    }
    out.push({ title: 'פעולות', rows: [{ kind: 'new', id: 'new' }] });
    return out;
  }, [projects, q]);

  const flat = groups.flatMap((g) => g.rows);
  const at = Math.min(cursor, flat.length - 1);

  const run = (row: Row) => {
    onClose();
    if (row.kind === 'project') onOpenProject(row.id);
    else if (row.kind === 'screen') onNav(row.id);
    else onNewProject();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && flat[at]) { e.preventDefault(); run(flat[at]); }
  };

  let index = -1;
  return (
    <div className="fo-cmd-backdrop" onClick={onClose}>
      <div className="fo-cmd" role="dialog" aria-label="חיפוש מהיר" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="fo-cmd-input-row">
          <IcSearch size={15} />
          <input
            ref={input}
            className="fo-cmd-input"
            value={q}
            placeholder="שם לקוח, אירוע, מקום או מסך"
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          />
          <button type="button" className="fo-kbd" onClick={onClose} style={{ background: 'transparent', cursor: 'pointer' }}>ESC</button>
        </div>
        <div className="fo-cmd-list">
          {q.trim() && !groups.some((g) => g.title !== 'פעולות') && (
            <div className="fo-cmd-none">לא נמצא לקוח, פרויקט או מסך בשם "{q.trim()}".</div>
          )}
          {groups.map((g) => (
            <React.Fragment key={g.title}>
              <span className="fo-cmd-group">{g.title}</span>
              {g.rows.map((row) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={`${row.kind}-${row.id}`}
                    type="button"
                    className={`fo-cmd-row ${i === at ? 'is-on' : ''}`}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => run(row)}
                  >
                    {row.kind === 'project' && (
                      <>
                        <span><b>{row.project.client}</b>{row.project.event ? ` · ${row.project.event}` : ''}</span>
                        <small>{[STATE_LABEL[row.project.state], row.project.date].filter(Boolean).join(' · ')}</small>
                      </>
                    )}
                    {row.kind === 'screen' && <span>{row.label}</span>}
                    {row.kind === 'new' && <span>פרויקט חדש</span>}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
