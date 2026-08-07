import { Suspense, lazy, useEffect, useState } from 'react';
import { Shell } from './studio/Shell';
import { SECTION_TO_STAGE } from './studio/nav';
import type { SectionId, StageId } from './studio/nav';
import type { LabView } from './lab/LabSection';
import Today from './studio/screens/Today';
import Projects from './studio/screens/Projects';
import ProjectScreen from './studio/screens/Project';
import Clients from './studio/screens/Clients';
import { useStudio } from './studio/store';
import { STAGE_SCREENS, Simple, CannotRead, StillReading } from './studio/screens/Screens';

/* The business screens above are eager: one of them is always what the app opens
 * on, so deferring them would only add a flash.
 *
 * Everything below is a WORKSPACE — entered by a deliberate act, never the first
 * thing on screen — so it is fetched when it is actually opened. Statically
 * imported, this set dragged roughly fourteen thousand lines into the first
 * paint: AlbumStudio alone is the sole door into the album folder (18 files,
 * ~8,400 lines), Lab is another 1,500, and Editor pulls imageEngine's 1,300.
 * None of it is needed to render היום, and in dev every one of those modules is
 * a separate request the browser waits on before the app appears. */
const GalleryEdit = lazy(() => import('./studio/screens/GalleryEdit'));
/* The lab's own shell. It holds both halves — the bench and the reader — and
 * keeps each of them behind its own lazy boundary, so this one import does not
 * pull both into a single chunk. */
const LabSection = lazy(() => import('./lab/LabSection'));
const AlbumStudio = lazy(() => import('./album/AlbumStudio'));
const ColorMatch = lazy(() => import('./studio/screens/ColorMatch'));
/* The bench — the lab, on a frame of the project. It is the primary way to edit
 * a photograph now. SetWorkbench below is kept and still reachable: it holds
 * the batch strip, applying to a whole batch and the pipeline-order warning,
 * and nothing was deleted to make room. */
const ProjectBench = lazy(() => import('./studio/screens/ProjectBench'));
const SetWorkbench = lazy(() => import('./studio/screens/SetWorkbench'));

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
  // The reader is a view INSIDE the lab now, not a section of its own. An old
  // #/compare tab lands on it rather than on an empty bench.
  compare: 'lab',
};

const LIVE_SECTIONS = new Set<string>([
  'today', 'projects', 'project', 'clients', 'calendar', 'lab', 'settings',
  // pre-direction workspaces, still reachable until the project screen absorbs them
  'editing', 'albums',
]);

/** `#/section/stage`, plus `#/project/<id>` for one job and `#/lab/<view>` for
 *  the two halves of the lab — so any screen can be linked, reloaded and
 *  bookmarked. */
function readHash(): { section: SectionId; stage: StageId; id: string; sub: string } {
  // the `#/` is stripped first, so the section is element 0 — not 1
  const [sec, a, b] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = RETIRED[sec] ?? (LIVE_SECTIONS.has(sec) ? (sec as SectionId) : 'today');
  if (section === 'project') {
    return { section, stage: 'client-status', id: a ?? '', sub: b ?? '' };
  }
  if (section === 'lab') {
    // `sec === 'compare'` is the retired route arriving; `a === 'compare'` is
    // the current one. Anything else is the bench.
    const view: LabView = sec === 'compare' || a === 'compare' ? 'compare' : 'tools';
    return { section, stage: 'client-status', id: '', sub: view };
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
  // The set's workbench — one tool at a time, on top of the recipe so far.
  const [workbench, setWorkbench] = useState(initial.sub === 'edit');
  // The bench: the lab itself, on a frame of this project.
  const [bench, setBench] = useState(initial.sub === 'bench');
  // The album, on THIS project's photos — a workspace of the project, not a
  // section of its own. It abandoned the project before (setSection('albums')),
  // which is why it had no way back and no access to the project's frames.
  const [album, setAlbum] = useState(initial.sub === 'album');
  // Which half of the lab is showing. Lives here, not inside LabSection, so the
  // hash carries it and a reload comes back to the same screen.
  const [labView, setLabView] = useState<LabView>(
    initial.section === 'lab' && initial.sub === 'compare' ? 'compare' : 'tools',
  );
  /* Which batch a tool was opened FOR. Carried here rather than looked up
   * inside the tool, because the tool is opened from the stage that made the
   * choice — and a tool that guesses its own layer is a tool that writes the
   * dance floor's colour onto the garden. */
  const [batch, setBatch] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSection(h.section);
      setStage(h.stage);
      setProjectId(h.id);
      setColorMatch(h.sub === 'color');
      setWorkbench(h.sub === 'edit');
      setBench(h.sub === 'bench');
      setAlbum(h.sub === 'album');
      if (h.section === 'lab') setLabView(h.sub === 'compare' ? 'compare' : 'tools');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const sub = colorMatch ? '/color' : bench ? '/bench' : workbench ? '/edit' : album ? '/album' : '';
    const want = section === 'project'
      ? `#/project/${projectId}${sub}`
      : section === 'lab'
        ? `#/lab/${labView}`
        : `#/${section}/${stage}`;
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want);
    }
  }, [section, stage, projectId, colorMatch, workbench, bench, album, labView]);

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
    today: () => <Today onSection={goSection} onOpen={openProject} />,
    projects: () => <Projects onOpen={openProject} />,
    clients: () => <Clients onOpen={openProject} />,
    calendar: () => <Simple title="יומן" sub="צילומים קרובים ודדליינים" />,
    settings: () => <Simple title="הגדרות" sub="חשבון, מנוי, אחסון ותבניות" />,
  };

  /* SUBSCRIBED, not read once. The studio used to load synchronously out of
   * localStorage, so a plain getProject() during render always had its answer.
   * It arrives over the engine now, which means a deep link to a project would
   * resolve to nothing on the first render and never re-render when the
   * projects landed. */
  const studio = useStudio();
  const openedProject = section === 'project'
    ? studio.projects.find((p) => p.id === projectId)
    : undefined;
  const Standalone = openedProject ? undefined : standalone[section];
  // The lab is not a project stage — it is its own place in the rail, full-bleed
  // and without the stage tabs, and it carries both of its halves itself.
  const isLab = section === 'lab';
  const isEditor = stage === 'gallery-edit' && !Standalone && !isLab;
  const isAlbum = stage === 'album-design' && !Standalone && !isLab;

  let body: JSX.Element;
  let title = 'TEZA';

  if (openedProject && colorMatch) {
    body = (
      <ColorMatch
        project={openedProject}
        batchId={batch}
        onBack={() => setColorMatch(false)}
      />
    );
    title = `התאמת צבעים · ${openedProject.client}`;
  } else if (openedProject && bench) {
    body = (
      <ProjectBench
        project={openedProject}
        batchId={batch}
        onBack={() => setBench(false)}
      />
    );
    title = `מעבדה · ${openedProject.client}`;
  } else if (openedProject && workbench) {
    body = (
      <SetWorkbench
        project={openedProject}
        batchId={batch}
        onBack={() => setWorkbench(false)}
      />
    );
    title = `עריכה · ${openedProject.client}`;
  } else if (openedProject && album) {
    body = <AlbumStudio job={openedProject} onBack={() => setAlbum(false)} />;
    title = `אלבום · ${openedProject.client}`;
  } else if (openedProject) {
    body = (
      <ProjectScreen
        project={openedProject}
        initialStage={(initial.sub || undefined) as never}
        onBack={() => goSection('projects')}
        onOpenTool={(what, batchId = null) => {
          setBatch(batchId);
          if (what === 'color') {
            setColorMatch(true);
            return;
          }
          if (what === 'bench') {
            // The lab, on this project's frame — the primary way to edit now.
            setBench(true);
            return;
          }
          if (what === 'edit') {
            // The set's own workbench, kept and still reachable.
            setWorkbench(true);
            return;
          }
          // The album is a workspace OF this project — it stays inside the
          // project route and carries its own way back, exactly like the bench.
          // It used to switch section to 'albums', which dropped the project id
          // and left the album an island with no return path and no frames.
          setAlbum(true);
        }}
      />
    );
    title = openedProject.client;
  } else if (isLab) {
    body = <LabSection view={labView} onView={setLabView} />;
    title = labView === 'compare' ? 'קריאת עריכה · מעבדה' : 'מעבדה';
  } else if (Standalone) {
    body = <Standalone />;
    title = SECTION_TITLE[section] ?? 'TEZA';
  } else if (isEditor) {
    body = <GalleryEdit />;
    title = 'עריכת גלריה';
  } else if (isAlbum) {
    body = <AlbumStudio />;
    title = 'עיצוב אלבום';
  } else if (section === 'project') {
    /* A project route with no project behind it. Three different reasons, and
     * they must not share a screen: still reading, could not read, or read fine
     * and this id is genuinely not in the studio. Before this branch existed
     * all three landed on "בקרוב". */
    if (studio.status === 'down') {
      body = <CannotRead what="את הפרויקט" fault={studio.fault} />;
      title = 'לא ניתן לקרוא';
    } else if (studio.status === 'loading') {
      body = <StillReading what="את הפרויקט" />;
      title = 'טוען';
    } else {
      body = (
        <Simple
          title="הפרויקט לא נמצא"
          sub="הקישור מצביע על מזהה שאינו במסד."
        />
      );
      title = 'לא נמצא';
    }
  } else {
    const S = STAGE_SCREENS[stage];
    body = S ? <S /> : <Simple title="בקרוב" sub="" />;
  }

  return (
    <Shell
      // A project is a place INSIDE projects — the rail stays lit on the list.
      section={section === 'project' ? 'projects' : section}
      theme={section}
      onSection={goSection}
      stage={stage}
      onStage={goStage}
      title={title}
      flush={
        isEditor || isAlbum || isLab
        || Boolean(openedProject && (workbench || bench || album))
      }
      // Editing a photograph owns the whole window: the business rail comes off
      // and the strip it used becomes the set being edited. The bench and the
      // album both carry their own way back, so nothing is stranded.
      rail={!(openedProject && (workbench || bench || album))}
      bare={isAlbum || isLab}
      // Only the pre-direction project routes still carry the tab row.
      stages={!Standalone && !openedProject}
    >
      {/* The wait only becomes visible after a beat (see .screen-wait) — a
        * workspace that arrives in 40ms should not flash a loading line. */}
      <Suspense fallback={<div className="screen-wait">טוען…</div>}>
        {body}
      </Suspense>
    </Shell>
  );
}
