import { useEffect, useState } from 'react';
import { Shell } from './studio/Shell';
import { SECTION_TO_STAGE } from './studio/nav';
import type { SectionId, StageId } from './studio/nav';
import { PROJECT } from './studio/demo';
import ClientStatus from './studio/screens/ClientStatus';
import GalleryEdit from './studio/screens/GalleryEdit';
import Lab from './lab/Lab';
import Compare from './lab/Compare';
import AlbumStudio from './album/AlbumStudio';
import Today from './studio/screens/Today';
import Projects from './studio/screens/Projects';
import ProjectScreen from './studio/screens/Project';
import ColorMatch from './studio/screens/ColorMatch';
import { getProject } from './studio/store';
import { Clients, STAGE_SCREENS, Simple } from './studio/screens/Screens';

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
};

const LIVE_SECTIONS = new Set<string>([
  'today', 'projects', 'project', 'clients', 'calendar', 'settings',
  // pre-direction workspaces, still reachable until the project screen absorbs them
  'editing', 'albums', 'lab', 'compare',
]);

/** `#/section/stage`, plus `#/project/<id>` for one job — so any screen can be
 *  linked, reloaded and bookmarked. */
function readHash(): { section: SectionId; stage: StageId; id: string; sub: string } {
  // the `#/` is stripped first, so the section is element 0 — not 1
  const [sec, a, b] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = RETIRED[sec] ?? (LIVE_SECTIONS.has(sec) ? (sec as SectionId) : 'today');
  if (section === 'project') {
    return { section, stage: 'client-status', id: a ?? '', sub: b ?? '' };
  }
  return { section, stage: (a as StageId) || 'client-status', id: '', sub: '' };
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

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSection(h.section);
      setStage(h.stage);
      setProjectId(h.id);
      setColorMatch(h.sub === 'color');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const want = section === 'project'
      ? `#/project/${projectId}${colorMatch ? '/color' : ''}`
      : `#/${section}/${stage}`;
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want);
    }
  }, [section, stage, projectId, colorMatch]);

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
    today: () => <Today onSection={goSection} />,
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
  const isAlbum = stage === 'album-design' && !Standalone && !isLab && !isCompare;

  let body: JSX.Element;
  let title = PROJECT.title;

  if (openedProject && colorMatch) {
    body = <ColorMatch onBack={() => setColorMatch(false)} />;
    title = `התאמת צבעים · ${openedProject.client}`;
  } else if (openedProject) {
    body = (
      <ProjectScreen
        project={openedProject}
        onBack={() => goSection('projects')}
        onOpenTool={(what) => {
          if (what === 'color') {
            setColorMatch(true);
            return;
          }
          setStage(what === 'edit' ? 'gallery-edit' : 'album-design');
          setSection(what === 'edit' ? 'editing' : 'albums');
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
  } else if (isAlbum) {
    body = <AlbumStudio />;
    title = 'עיצוב אלבום';
  } else if (stage === 'client-status') {
    body = <ClientStatus onStage={goStage} />;
  } else {
    const S = STAGE_SCREENS[stage];
    body = S ? <S /> : <Simple title="בקרוב" sub="" />;
  }

  return (
    <Shell
      // A project is a place INSIDE projects — the rail stays lit on the list.
      section={section === 'project' ? 'projects' : section}
      onSection={goSection}
      stage={stage}
      onStage={goStage}
      title={title}
      flush={isEditor || isAlbum || isLab || isCompare}
      bare={isAlbum || isLab || isCompare}
      // Only the pre-direction project routes still carry the tab row.
      stages={!Standalone && !openedProject}
    >
      {body}
    </Shell>
  );
}
