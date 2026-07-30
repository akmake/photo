import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SECTIONS, STAGES } from './nav';
import type { SectionId, StageId } from './nav';
import {
  IcBook, IcCalendar, IcChevron, IcFilter, IcFolder, IcGallery, IcGear,
  IcHeart, IcHome, IcSliders, IcSparkle, IcUpload, IcUsers,
} from '../design/Icons';

const ICONS: Record<string, (p: { size?: number }) => JSX.Element> = {
  home: IcHome, folder: IcFolder, users: IcUsers, calendar: IcCalendar,
  gear: IcGear, gallery: IcGallery, filter: IcFilter, sliders: IcSliders,
  book: IcBook, upload: IcUpload, heart: IcHeart, lab: IcSparkle,
  compare: IcFilter,
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
  compact,
  onCompact,
}: {
  section: SectionId;
  onSection: (s: SectionId) => void;
  compact: boolean;
  onCompact: () => void;
}) {
  const main = SECTIONS.filter((s) => !s.foot);
  const foot = SECTIONS.filter((s) => s.foot);

  const item = (s: (typeof SECTIONS)[number]) => (
    <button
      key={s.id}
      className={`nav-item ${s.id === section ? 'on' : ''}`}
      onClick={() => onSection(s.id)}
      title={compact ? s.label : undefined}
      aria-label={compact ? s.label : undefined}
      aria-current={s.id === section ? 'page' : undefined}
    >
      <Icon name={s.icon} />
      <span>{s.label}</span>
    </button>
  );

  return (
    <nav className="rail" aria-label="ניווט ראשי">
      <div className="rail-head">
        <div className="mark" aria-hidden="true">T</div>
        {!compact && <div className="mark-name">TEZA</div>}
        <button
          className="rail-toggle"
          onClick={onCompact}
          aria-label={compact ? 'הרחב תפריט' : 'כווץ תפריט'}
          title={compact ? 'הרחב תפריט' : 'כווץ תפריט'}
        >
          <IcChevron size={15} />
        </button>
      </div>

      <button className="rail-search" title="חיפוש" aria-label="חיפוש">
        <IcSearch />
        <span>חיפוש</span>
        <span className="mono key">Ctrl K</span>
      </button>

      {main.map(item)}

      <div className="rail-foot">
        {foot.map(item)}
        <button className="nav-item who" title="יוסי">
          <span className="avatar" aria-hidden="true">י</span>
          <span>יוסי</span>
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
  onSection,
  stage,
  onStage,
  title,
  flush,
  bare,
  stages,
  children,
}: {
  section: SectionId;
  onSection: (s: SectionId) => void;
  stage: StageId;
  onStage: (s: StageId) => void;
  title: string;
  flush?: boolean;
  bare?: boolean;
  /** Render the legacy stage tabs. The business screens never do. */
  stages?: boolean;
  children: ReactNode;
}) {
  const [navPreference, setNavPreference] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem('teza.rail.compact');
      return saved === null ? null : saved === 'true';
    } catch {
      return null;
    }
  });
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 1180);

  // The window title is where "which screen am I on" belongs.
  useEffect(() => {
    document.title = title ? `${title} · TEZA` : 'TEZA';
  }, [title]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= 1180);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Deep work takes the room back: the rail collapses on its own inside the
  // canvas screens, and a deliberate preference still wins over that.
  const compact = navPreference ?? Boolean(flush || bare || narrow);

  function toggleCompact() {
    const next = !compact;
    setNavPreference(next);
    try {
      localStorage.setItem('teza.rail.compact', String(next));
    } catch {
      // the preference is optional; the shell works without storage
    }
  }

  return (
    <div
      dir="rtl"
      className={`shell ${compact ? 'shell-compact' : ''} ${flush ? 'shell-workspace' : ''}`}
    >
      <NavRail
        section={section}
        onSection={onSection}
        compact={compact}
        onCompact={toggleCompact}
      />
      <div className="main">
        {stages && !bare && <StageTabs stage={stage} onStage={onStage} />}
        <div className={`content ${flush ? 'flush' : ''}`}>
          {flush ? children : <div className="sheet">{children}</div>}
        </div>
      </div>
    </div>
  );
}
