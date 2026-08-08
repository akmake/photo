import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { SECTIONS, STAGES } from './nav';
import type { SectionId, StageId } from './nav';
import {
  IcBook, IcCalendar, IcFilter, IcFlask, IcFolder, IcGallery, IcGear,
  IcHeart, IcHome, IcSliders, IcSparkle, IcUpload, IcUsers,
} from '../design/Icons';

const ICONS: Record<string, (p: { size?: number }) => JSX.Element> = {
  home: IcHome, folder: IcFolder, users: IcUsers, calendar: IcCalendar,
  gear: IcGear, gallery: IcGallery, filter: IcFilter, sliders: IcSliders,
  book: IcBook, upload: IcUpload, heart: IcHeart, lab: IcSparkle,
  flask: IcFlask, compare: IcFilter,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? IcFolder;
  return <C size={size} />;
}

/* The rail carries the business axis and nothing else. It has exactly two
 * widths — labelled and icon-only — because a third state is a preference no
 * one asked for, and it collapses on its own when the work needs the room. */
export function NavRail({
  section,
  onSection,
}: {
  section: SectionId;
  onSection: (s: SectionId) => void;
}) {
  const main = SECTIONS.filter((s) => !s.foot);
  const foot = SECTIONS.filter((s) => s.foot);

  const item = (s: (typeof SECTIONS)[number]) => (
    <button
      key={s.id}
      className={`nav-item ${s.id === section ? 'on' : ''}`}
      onClick={() => onSection(s.id)}
      title={s.label}
      aria-current={s.id === section ? 'page' : undefined}
    >
      <span className="nav-icon"><Icon name={s.icon} /></span>
      <span className="nav-label">{s.label}</span>
    </button>
  );

  return (
    <nav className="rail" aria-label="ניווט ראשי">
      <div className="rail-head">
        <div className="mark" aria-hidden="true">T</div>
        <div className="mark-name">TEZA</div>
      </div>

      <div className="rail-main">
        {main.map(item)}
      </div>

      <div className="rail-actions">
        <button className="rail-search" title="חיפוש" aria-label="חיפוש">
          <IcSearch />
          <span>חיפוש</span>
          <span className="mono key">Ctrl K</span>
        </button>
        {foot.map(item)}
        <button className="nav-item who" title="יוסי">
          <span className="avatar" aria-hidden="true">י</span>
          <span className="user-copy">
            <strong>יוסי</strong>
            <small>החשבון שלי</small>
          </span>
        </button>
      </div>
    </nav>
  );
}

/* THE TOP BAR IS GONE, and this is what replaced it.
 *
 * It held three things: the name of the screen — already stated, larger, in the
 * screen's own header directly below it — plus a search box and an account
 * menu. That is 54px of height on every screen, spent on one duplication and
 * two controls touched once a month. Height is the scarcest axis in a tool that
 * shows photographs.
 *
 * So search and the account moved into the rail, which is where the global axis
 * already lives, and the duplicate title was deleted rather than restyled. The
 * window title carries the "where am I" job instead — that is what a window
 * title is for. */
function IcSearch({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

/** Legacy project tabs. They only render on the routes that still use them —
 *  inside a project this row is replaced by the measure rail. */
export function StageTabs({
  stage,
  onStage,
}: {
  stage: StageId;
  onStage: (s: StageId) => void;
}) {
  return (
    <nav className="stages">
      {STAGES.map((s) => (
        <button
          key={s.id}
          className={`stage-tab ${s.id === stage ? 'on' : ''}`}
          onClick={() => onStage(s.id)}
        >
          <Icon name={s.icon} size={16} />
          <span>{s.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Shell({
  section,
  theme,
  onSection,
  stage,
  onStage,
  title,
  flush,
  bare,
  stages,
  rail = true,
  children,
}: {
  section: SectionId;
  /** The route can live under another rail item while owning a distinct theme. */
  theme?: SectionId;
  onSection: (s: SectionId) => void;
  stage: StageId;
  onStage: (s: StageId) => void;
  title: string;
  flush?: boolean;
  bare?: boolean;
  /** Render the legacy stage tabs. The business screens never do. */
  stages?: boolean;
  /** The business rail. Off inside an editing workspace: while a photograph is
   *  being worked on there is no reason to jump to the calendar, and the strip
   *  of screen it occupies is worth more as the set being edited. */
  rail?: boolean;
  children: ReactNode;
}) {
  // The window title is where "which screen am I on" belongs.
  useEffect(() => {
    document.title = title ? `${title} · TEZA` : 'TEZA';
  }, [title]);

  return (
    <div
      dir="rtl"
      className={`shell shell-section-${theme ?? section} ${flush ? 'shell-workspace' : ''} ${rail ? '' : 'shell-norail'}`}
    >
      {rail && (
      <NavRail
        section={section}
        onSection={onSection}
      />
      )}
      <div className="main">
        {stages && !bare && <StageTabs stage={stage} onStage={onStage} />}
        <div className={`content ${flush ? 'flush' : ''}`}>
          {flush ? children : <div className="sheet">{children}</div>}
        </div>
      </div>
    </div>
  );
}
