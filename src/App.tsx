import { useEffect, useState } from 'react';
import { Shell } from './studio/Shell';
import { SECTION_TO_STAGE } from './studio/nav';
import type { SectionId, StageId } from './studio/nav';
import GalleryEdit from './studio/screens/GalleryEdit';
import Lab from './lab/Lab';
import Compare from './lab/Compare';
import Today from './studio/screens/Today';
import Projects from './studio/screens/Projects';
import ProjectScreen from './studio/screens/Project';
import ColorMatch from './studio/screens/ColorMatch';
import { getProject } from './studio/store';
import { Clients, Simple } from './studio/screens/Screens';

/* The rail carries ONE axis — the business. A project's stages live inside the
 * project, because they are only ever true of one project at a time.
 *
 * The `stage` position below is what remains of the old second axis: the
 * pre-direction screens (editor, album, lab) still hang off it, and they keep
 * their tab row until the project screen absorbs them. The business screens
 * never show it. Build order is deliberate — tools last.
 */
/* Routes that were replaced. A tab left open on one of them would keep serving
 * the screen it replaced — which is exactly how a rewrite gets reported as
 * "nothing changed". A retired route resolves to its successor instead of
 * quietly still working. */
const RETIRED: Partial<Record<string, SectionId>> = {
  home: 'today',
  galleries: 'projects',
  culling: 'projects',
  orders: 'today',
  reports: 'today',
  /* The album module moved INSIDE the project, where its photos come from the
   * project's folders. A standalone album route would still open — on an album
   * with no client, no folders and no way back — which is exactly how a
   * rewrite gets reported as "nothing changed". */
  albums: 'projects',
};

const LIVE_SECTIONS = new Set<string>([
  'today', 'projects', 'project', 'clients', 'calendar', 'settings',
  // pre-direction workspaces, still reachable until the project screen absorbs them
  'editing', 'lab', 'compare',
]);

/** `#/section/stage`, plus `#/project/<id>/<stage>` for one job and
 *  `#/project/<id>/album/<albumId>` for one album — so any screen, down to the
 *  album someone spent an hour on, can be linked, reloaded and bookmarked. */
function readHash(): {
  section: SectionId; stage: StageId; id: string; sub: string; albumId: string;
} {
  // the `#/` is stripped first, so the section is element 0 — not 1
  const [sec, a, b, c] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = RETIRED[sec] ?? (LIVE_SECTIONS.has(sec) ? (sec as SectionId) : 'today');
  if (section === 'project') {
    return {
      section,
      stage: 'client-status',
      id: a ?? '',
      sub: b ?? '',
      albumId: b === 'album' ? (c ?? '') : '',
    };
  }
  return { section, stage: (a as StageId) || 'client-status', id: '', sub: '', albumId: '' };
}

/** The top bar states where you are, not what the product is called. */
const SECTION_TITLE: Partial<Record<SectionId, string>> = {
  today: 'היום',
  projects: 'פרויקטים',
  clients: 'לקוחות',
  calendar: 'יומן',
  settings: 'הגדרות',
};

export default function App() {
  const initial = readHash();
  const [section, setSection] = useState<SectionId>(initial.section);
  const [stage, setStage] = useState<StageId>(initial.stage);
  const [projectId, setProjectId] = useState<string>(initial.id);
  const [colorMatch, setColorMatch] = useState(initial.sub === 'color');
  /** Where inside the project we are: a stage name, or an open album. */
  const [projectStage, setProjectStage] = useState<string>(initial.sub);
  const [albumId, setAlbumId] = useState<string | null>(initial.albumId || null);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSection(h.section);
      setStage(h.stage);
      setProjectId(h.id);
      setColorMatch(h.sub === 'color');
      setProjectStage(h.sub);
      setAlbumId(h.albumId || null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let want = `#/${section}/${stage}`;
    if (section === 'project') {
      const tail = colorMatch
        ? '/color'
        : albumId
          ? `/album/${albumId}`
          : projectStage ? `/${projectStage}` : '';
      want = `#/project/${projectId}${tail}`;
    }
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want);
    }
  }, [section, stage, projectId, colorMatch, projectStage, albumId]);

  function openProject(id: string) {
    setProjectId(id);
    setSection('project');
  }

  function goSection(s: SectionId) {
    setSection(s);
    const mapped = SECTION_TO_STAGE[s];
    if (mapped) setStage(mapped);
  }

  function goStage(s: StageId) {
    setStage(s);
    // keep the sidebar honest about where we actually are
    const back = (Object.entries(SECTION_TO_STAGE) as [SectionId, StageId][])
      .find(([, st]) => st === s)?.[0];
    setSection(back ?? 'projects');
  }

  // The business sections render on their own — no stage, no tabs.
  const standalone: Partial<Record<SectionId, () => JSX.Element>> = {
    today: () => <Today onSection={goSection} onOpenProject={openProject} />,
    projects: () => <Projects onOpen={openProject} />,
    clients: Clients,
    calendar: () => <Simple title="יומן" sub="צילומים קרובים ודדליינים" />,
    settings: () => <Simple title="הגדרות" sub="חשבון, מנוי, אחסון ותבניות" />,
  };

  const openedProject = section === 'project' ? getProject(projectId) : undefined;
  const Standalone = openedProject ? undefined : standalone[section];
  // The lab is not a project stage — it opens on its own, full-bleed, and the
  // stage tabs above it stay where they were.
  const isLab = section === 'lab';
  const isCompare = section === 'compare';
  const isEditor = stage === 'gallery-edit' && !Standalone && !isLab && !isCompare;

  let body: JSX.Element;
  let title = 'TEZA';

  if (openedProject && colorMatch) {
    body = <ColorMatch project={openedProject} onBack={() => setColorMatch(false)} />;
    title = `התאמת צבעים · ${openedProject.client}`;
  } else if (openedProject) {
    body = (
      <ProjectScreen
        key={openedProject.id}
        project={openedProject}
        initialStage={(initial.albumId ? 'album' : initial.sub || undefined) as never}
        albumId={albumId}
        onAlbum={setAlbumId}
        onStage={(next) => setProjectStage(next)}
        onBack={() => goSection('projects')}
        onOpenTool={(what) => {
          if (what === 'color') {
            setColorMatch(true);
            return;
          }
          setStage('gallery-edit');
          setSection('editing');
        }}
      />
    );
    title = openedProject.client;
  } else if (isLab) {
    body = <Lab />;
    title = 'מעבדה';
  } else if (isCompare) {
    body = <Compare />;
    title = 'קריאת עריכה';
  } else if (Standalone) {
    body = <Standalone />;
    title = SECTION_TITLE[section] ?? 'TEZA';
  } else if (isEditor) {
    body = <GalleryEdit />;
  } else {
    /* Everything else used to land on demo screens — a client status page and
     * three gallery stages made of invented counts. Those stages belong to a
     * project and now live inside one, so an unrouted stage sends you to the
     * projects list instead of to fiction. */
    body = <Projects onOpen={openProject} />;
    title = 'פרויקטים';
  }

  return (
    <Shell
      // A project is a place INSIDE projects — the rail stays lit on the list.
      section={section === 'project' ? 'projects' : section}
      onSection={goSection}
      stage={stage}
      onStage={goStage}
      title={title}
      // the album now lives inside a project, and the project screen is flush
      flush={isEditor || isLab || isCompare || !!openedProject}
      bare={isLab || isCompare}
      // Only the pre-direction project routes still carry the tab row.
      stages={!Standalone && !openedProject}
    >
      {body}
    </Shell>
  );
}
