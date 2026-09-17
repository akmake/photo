import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IcBook, IcCheck, IcChevron, IcDownload, IcEye, IcGallery,
  IcSparkle, IcUndo, IcUpload,
} from '../design/Icons';
import type {
  AlbumPhoto, AlbumPhotoAnalysis, AlbumProject, AlbumSpread, LayoutSlot,
  PhotoFitMode, PhotoFrameSettings, PrintProductProfile,
} from './model';
import { FIRST_PRINT_PROFILE, PRINT_PROFILES } from './model';
import {
  buildAlbumLayoutCandidates, EMPTY_GENERATED_LAYOUT, type GeneratedAlbumLayout,
} from './layoutEngine';
import { assessCrop } from './cropEngine';
import {
  applyTemplate, findTemplate, newInstance, photoLayers, spreadTemplate, templateBackground, templateSlots,
} from './templates/library';
import { rankTemplates } from './templates/choose';
import { designFade } from './templates/fades';
import { duplicatePlace, reorderZ } from './templates/placeStyles';
import SpreadPanel from './templates/SpreadPanel';
import ContextToolbar, { ToolIcons } from './templates/ContextToolbar';
import { FONT_CATALOG, FONT_GROUP_LABELS, familyOf, fontStack, type FontEntry } from './templates/fonts';
import { importUserFonts, loadUserFonts } from './templates/userFonts';
import { elementToLayer, type ElementDef } from './templates/elements';
import { importElements, loadMyElements, removeMyElement } from './templates/elementStore';
import { smartGuides, type GuideResult } from './templates/smartGuides';
import SmartGuideOverlay from './templates/SmartGuideOverlay';
import { TemplateDecor, photoFrameStyle, templateZ } from './templates/TemplateLayers';
import TemplatePanel from './templates/TemplatePanel';
import type {
  AlbumTemplate, ImageLayer, LayerBox, PhotoFade, PlaceStyle, ShapeLayer, SpreadTemplateInstance, TextLayer,
} from './templates/types';
import { analyzeAlbumPhoto } from '../api';
import { exportAlbumForPrint, exportAlbumProof } from './exportEngine';
import {
  buildAlbumFromGroups, buildAutomaticAlbum, constrainGroupsToSessions,
} from './albumFlow';
import { ALBUM_STYLES } from './styleEngine';
import AlbumPhotoPicker from './AlbumPhotoPicker';
import {
  deleteAlbum, duplicateAlbum, listAlbums, loadAlbum, renameAlbum, saveAlbum, storePhotoBlob,
  type AlbumSummary,
} from './albumStorage';
import AlbumPreview from './AlbumPreview';
import ReviewWorkspace from './ReviewWorkspace';
import CoverEditor from './CoverEditor';
import PreflightPanel from './PreflightPanel';
import AlbumOverview from './AlbumOverview';
import AlbumLibrary, { type AlbumCreateInput } from './AlbumLibrary';
import { clientAlbumsOf } from '../studio/galleryLink';
import { useProjectFiles } from '../studio/store';
import type { Project as StudioProject } from '../studio/store';
import { framesToPool, enrichPool } from './projectPool';
import { runAlbumPreflight, type PreflightIssue } from './preflightEngine';
import { detectAlbumSessions, oneSession } from './sessionEngine';
// 3,000 lines of album styling, loaded with the album and not before. This file
// is the ONLY way into the album folder from outside it, so importing the sheet
// here covers every album component. The sheet carries no global or element
// selectors — .album-*, .library-*, .organize-*, .review-*, .cover-*,
// .preflight-*, .tl-*, .abm-* — and all of those classes are used only by files
// under src/album, so arriving late changes nothing anywhere else.
import './album.css';
import './album-redesign.css';

const DEMO_PHOTOS_BASE: AlbumPhoto[] = [
  { id: 'p1', name: 'רגע עם הסוס', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.58, y: 0.45 } },
  { id: 'p2', name: 'פורטרט בחוץ', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.5, y: 0.34 } },
  { id: 'p3', name: 'רגע סתווי', url: '/demo/a.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.48, y: 0.44 } },
  { id: 'p4', name: 'דיוקן נבחר', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.54, y: 0.32 } },
  { id: 'p5', name: 'פריים רחב', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.63, y: 0.45 } },
  { id: 'p6', name: 'פרט משלים', url: '/demo/a.jpg', orientation: 'square', widthPx: 1400, heightPx: 1400, focalPoint: { x: 0.5, y: 0.5 } },
  { id: 'p7', name: 'רגע טבעי', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.58, y: 0.46 } },
  { id: 'p8', name: 'דיוקן עם סוס', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.52, y: 0.34 } },
  { id: 'p9', name: 'מבט מהצד', url: '/demo/a.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.56, y: 0.47 } },
  { id: 'p10', name: 'רגע שקט', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.5, y: 0.36 } },
  { id: 'p11', name: 'פריים לסיום', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.62, y: 0.46 } },
  { id: 'p12', name: 'תמונה משלימה', url: '/demo/a.jpg', orientation: 'square', widthPx: 1400, heightPx: 1400, focalPoint: { x: 0.5, y: 0.5 } },
];

const DEMO_ANALYSIS: Record<string, AlbumPhotoAnalysis> = {
  '/demo/a.jpg': {
    status: 'ready',
    faces: [{ x: 0.50331, y: 0.32614, width: 0.13707, height: 0.16908 }],
    subject: { x: 0.32474, y: 0.34063, width: 0.3177, height: 0.44688 },
    focalPoint: { x: 0.54978, y: 0.44903 },
    sharpnessScore: 0.486,
    qualityScore: 0.5926,
    analyzedBy: 'mediapipe-local-v1',
  },
  '/demo/b.jpg': {
    status: 'ready',
    faces: [{ x: 0.47894, y: 0.30108, width: 0.13497, height: 0.24971 }],
    subject: { x: 0.3, y: 0.08441, width: 0.44531, height: 0.91559 },
    focalPoint: { x: 0.54048, y: 0.455 },
    sharpnessScore: 0.7496,
    qualityScore: 0.8047,
    analyzedBy: 'mediapipe-local-v1',
  },
  '/demo/c.jpg': {
    status: 'ready',
    faces: [{ x: 0.50345, y: 0.32609, width: 0.13718, height: 0.16897 }],
    subject: { x: 0.28605, y: 0.33984, width: 0.35756, height: 0.44688 },
    focalPoint: { x: 0.54524, y: 0.44875 },
    sharpnessScore: 0.8443,
    qualityScore: 0.8238,
    analyzedBy: 'mediapipe-local-v1',
  },
};

const DEMO_PHOTOS: AlbumPhoto[] = DEMO_PHOTOS_BASE.map((photo) => ({
  ...photo,
  widthPx: photo.url.endsWith('/b.jpg') ? 5472 : 3648,
  heightPx: photo.url.endsWith('/b.jpg') ? 3648 : 5472,
  orientation: photo.url.endsWith('/b.jpg') ? 'landscape' : 'portrait',
  focalPoint: DEMO_ANALYSIS[photo.url].focalPoint,
  analysis: DEMO_ANALYSIS[photo.url],
}));

const INITIAL_SPREADS: AlbumSpread[] = [
  { id: 's1', pageStart: 2, layoutId: 'balanced', photoIds: ['p1'], background: '#f4efe7', locked: false, status: 'draft' },
  { id: 's2', pageStart: 4, layoutId: 'balanced', photoIds: ['p2', 'p3'], background: '#f8f6f1', locked: false, status: 'draft' },
  { id: 's3', pageStart: 6, layoutId: 'balanced', photoIds: ['p4', 'p5', 'p6', 'p7', 'p8'], background: '#f5efe7', locked: false, status: 'draft' },
  { id: 's4', pageStart: 8, layoutId: 'balanced', photoIds: [], background: '#e9e2d8', locked: false, status: 'draft' },
  { id: 's5', pageStart: 10, layoutId: 'balanced', photoIds: [], background: '#f8f6f1', locked: false, status: 'draft' },
];

type PhotoTrayFilter = 'current' | 'unused' | 'all';
interface PersonalLayout {
  id: string;
  name: string;
  photoCount: number;
  pageAspect: number;
  slots: LayoutSlot[];
}

const DEFAULT_FRAME_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

const INITIAL_PROJECT: AlbumProject = {
  id: 'album-mali',
  projectId: null,
  name: 'מלי כץ — בת מצווה',
  productProfileId: FIRST_PRINT_PROFILE.id,
  styleName: 'Fine Art',
  spreads: INITIAL_SPREADS,
  activeSpreadId: 's3',
};

function orientationFor(width: number, height: number): AlbumPhoto['orientation'] {
  const ratio = width / height;
  if (ratio > 1.12) return 'landscape';
  if (ratio < 0.88) return 'portrait';
  return 'square';
}

export default function AlbumStudio({ job, onBack }: {
  /** The project this album belongs to. Its frames ARE the album's photo pool,
   *  served from disk by the engine — nothing is imported or copied. Optional so
   *  the legacy standalone route (#/albums) still renders on its own photos. */
  job?: StudioProject;
  onBack?: () => void;
} = {}) {
  const [project, setProject] = useState(INITIAL_PROJECT);
  // In project mode the pool is the project's frames (seeded by the effect
  // below), so there is nothing to demo. The demo set survives only for the
  // standalone route, which has no project to draw from.
  const [photos, setPhotos] = useState<AlbumPhoto[]>(job ? [] : DEMO_PHOTOS);
  const [historyPast, setHistoryPast] = useState<AlbumProject[]>([]);
  const [historyFuture, setHistoryFuture] = useState<AlbumProject[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  /** Smart guides, measurements and badges while a block is dragged or resized. */
  const [frameGuides, setFrameGuides] = useState<GuideResult | null>(null);
  /* Double-click a frame to reposition the PHOTO inside it (pan + zoom); until
   * then a drag anywhere on the frame moves the frame itself. One frame at a
   * time is in this mode. */
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [photoFilter, setPhotoFilter] = useState<PhotoTrayFilter>('unused');
  const [showGuides, setShowGuides] = useState(false);
  const [notice, setNotice] = useState('הטיוטה נשמרה מקומית');
  const [photoLimit, setPhotoLimit] = useState(60);
  const [isExporting, setIsExporting] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  /* `organize` is the album; `design` is one spread. The module opens on the
   * album, because that is the question a photographer actually asks first. */
  const [mode, setMode] = useState<'organize' | 'design'>('organize');
  /* Null means the library is showing. An album is a saved thing you come back
   * to, so nothing is open until the photographer picks one. */
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>(() => listAlbums(job?.id));
  const [showPreview, setShowPreview] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [overviewScrollTop, setOverviewScrollTop] = useState(0);
  const [pendingSpreadDelete, setPendingSpreadDelete] = useState<number | null>(null);
  const [showAlbumSettings, setShowAlbumSettings] = useState(false);
  const [settingsWidthCm, setSettingsWidthCm] = useState(30);
  const [settingsHeightCm, setSettingsHeightCm] = useState(30);
  const [showCover, setShowCover] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [confirmAutoBuild, setConfirmAutoBuild] = useState(false);
  /** An element the photographer added to the spread (text, shape, artwork, import). */
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [myElements, setMyElements] = useState<ElementDef[]>([]);
  const [userFonts, setUserFonts] = useState<FontEntry[]>([]);
  useEffect(() => {
    let alive = true;
    loadUserFonts()
      .then(({ fonts, failed }) => {
        if (!alive) return;
        setUserFonts(fonts);
        if (failed.length) setNotice(`לא ניתן לטעון ${failed.length} גופנים: ${failed.slice(0, 3).join(', ')}`);
      })
      .catch(() => { if (alive) setNotice('לא ניתן לקרוא את הגופנים שלך'); });
    return () => { alive = false; };
  }, []);  useEffect(() => {
    let alive = true;
    loadMyElements()
      .then(({ elements, missing }) => {
        if (!alive) return;
        setMyElements(elements);
        if (missing.length) setNotice(`לא ניתן לקרוא ${missing.length} אלמנטים מהספרייה: ${missing.slice(0, 3).join(', ')}`);
      })
      .catch(() => { if (alive) setNotice('לא ניתן לקרוא את ספריית האלמנטים'); });
    return () => { alive = false; };
  }, []);

  /* A reused workspace must never carry one project's library or open album
   * into another project. New mounts also pass through here, harmlessly. */
  useEffect(() => {
    setAlbums(listAlbums(job?.id));
    setActiveAlbumId(null);
  }, [job?.id]);
  const [printProfiles, setPrintProfiles] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('album-print-profiles') ?? '[]');
      if (!Array.isArray(saved) || !saved.length) return PRINT_PROFILES;
      /* Saved edits (lab details, verification) survive; the product's own
       * name and size do not — they belong to the built-in definition. */
      const builtIn = PRINT_PROFILES.map((base) => ({
        ...base,
        ...(saved.find((item) => item.id === base.id) ?? {}),
        name: base.name,
        closedWidthMm: base.closedWidthMm,
        closedHeightMm: base.closedHeightMm,
        spreadWidthMm: base.spreadWidthMm,
        spreadHeightMm: base.spreadHeightMm,
      }));
      const custom = saved.filter((item) => !PRINT_PROFILES.some((base) => base.id === item.id));
      return [...builtIn, ...custom];
    } catch {
      return PRINT_PROFILES;
    }
  });
  const [personalLayouts, setPersonalLayouts] = useState<PersonalLayout[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('album-personal-layouts') ?? '[]');
    } catch {
      return [];
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  // The project's frames, loaded from disk on demand. Empty id (standalone
  // route) is a no-op in the store, so this stays an unconditional hook.
  const jobFiles = useProjectFiles(job?.id ?? '');
  // Frames whose analysis has already been dispatched this session, so opening
  // a second album in the same project does not re-analyse the same files.
  const enrichingRef = useRef<Set<string>>(new Set());
  const detectingSessionsRef = useRef<Set<string>>(new Set());
  /* Liveness is per-COMPONENT, not per-effect. Analysis is dispatched from an
   * effect that re-runs whenever the frame list changes identity; tying the
   * "still mounted?" flag to that effect's cleanup meant the first dispatch's
   * results were thrown away the moment the frames notified again, and every
   * photo stayed `pending`. This ref is only ever cleared on real unmount. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const panSession = useRef<{
    slotIndex: number;
    startX: number;
    startY: number;
    positionX: number;
    positionY: number;
    before: AlbumProject;
    moved: boolean;
  } | null>(null);
  /* Direct-manipulation of the FRAME itself — move and resize on the canvas,
   * the way Canva and InDesign do it, so a layout is built by dragging boxes
   * instead of typing four numbers into sliders. */
  type FrameGestureMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  const frameGesture = useRef<{
    mode: FrameGestureMode;
    index: number;
    startX: number;
    startY: number;
    slot: LayoutSlot;
    baseSlots: LayoutSlot[];
    rect: DOMRect;
    before: AlbumProject;
    moved: boolean;
  } | null>(null);
  const suppressFrameClick = useRef(false);

  useEffect(() => {
    if (!activeAlbumId) return undefined;
    let alive = true;
    setIsHydrated(false);
    loadAlbum(activeAlbumId, job?.id)
      .then((saved) => {
        if (!alive) return;
        if (!saved) {
          setNotice('האלבום לא שייך לפרויקט הזה או שאינו קיים');
          setActiveAlbumId(null);
          return;
        }
        setProject(saved.project);
        if (job) {
          const savedById = new Map(saved.photos.map((photo) => [photo.id, photo]));
          setPhotos(framesToPool(jobFiles.frames).map((fresh) => {
            const prior = savedById.get(fresh.id);
            return prior?.analysis?.status === 'ready'
              ? {
                  ...fresh,
                  orientation: prior.orientation,
                  widthPx: prior.widthPx,
                  heightPx: prior.heightPx,
                  focalPoint: prior.focalPoint,
                  analysis: prior.analysis,
                }
              : fresh;
          }));
        } else {
          setPhotos(saved.photos);
        }
        setAlbums(listAlbums(job?.id));
        setNotice(`${saved.project.name} נפתח`);
      })
      .catch(() => setNotice('לא ניתן היה לפתוח את האלבום'))
      .finally(() => {
        if (alive) setIsHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, [activeAlbumId, job?.id]);

  useEffect(() => {
    // autosave belongs to the OPEN album; with none open there is nothing to write
    if (!isHydrated || !activeAlbumId) return undefined;
    const timer = window.setTimeout(() => {
      saveAlbum(project, photos);
      setAlbums(listAlbums(job?.id));
      setNotice('כל השינויים נשמרו אוטומטית');
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeAlbumId, isHydrated, photos, project]);

  /* THE POOL IS THE PROJECT.
   *
   * With an album open under a project, the available photos ARE the project's
   * frames — re-derived here rather than trusted from the saved copy, because
   * the disk is the authority on what still exists. Placement survives a
   * re-derivation because a photo's id is its frame's own file name, which is
   * also what the spreads reference. Analysis already resolved this session is
   * kept so a re-open does not blank the dimensions back to pending.
   *
   * Enrichment (real size, faces, focal point) runs a few frames at a time and
   * only once per frame per session. It is gated on an album being open, so
   * merely browsing the library analyses nothing. */
  useEffect(() => {
    if (!job || !activeAlbumId) return undefined;
    const frames = jobFiles.frames;
    setPhotos((prev) => {
      const prior = new Map(prev.map((photo) => [photo.id, photo]));
      return framesToPool(frames).map((fresh) => {
        const old = prior.get(fresh.id);
        // keep a resolved analysis; take the fresh url in case `shown` changed
        return old && old.analysis?.status === 'ready'
          ? { ...fresh, orientation: old.orientation, widthPx: old.widthPx, heightPx: old.heightPx, focalPoint: old.focalPoint, analysis: old.analysis }
          : fresh;
      });
    });

    // Skip anything already analysed — a saved album reloads with its analysis
    // intact, so re-opening it must not put the engine through 23 scans again.
    const readyIds = new Set(
      photos.filter((photo) => photo.analysis?.status === 'ready').map((photo) => photo.id),
    );
    const toEnrich = framesToPool(frames).filter(
      (photo) => !readyIds.has(photo.id) && !enrichingRef.current.has(photo.id),
    );
    toEnrich.forEach((photo) => enrichingRef.current.add(photo.id));
    if (toEnrich.length) {
      void enrichPool(toEnrich, (enriched) => {
        if (!mountedRef.current) return;
        setPhotos((prev) => prev.map((photo) => (photo.id === enriched.id ? { ...photo, ...enriched } : photo)));
      });
    }
    return undefined;
  }, [job?.id, activeAlbumId, jobFiles.frames]);

  /* The core loop is the keyboard: vertical cycles this spread's candidate
   * layouts, horizontal walks the album. The album reads right-to-left, so
   * LEFT advances — matching the direction the pages actually turn. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Never steal a keystroke that belongs to a field.
      // The target is not always an Element — guard the method, not just null.
      const target = event.target;
      if (target instanceof Element
        && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoProject();
        else undoProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoProject();
        return;
      }
      if (event.altKey || mod) return;
      if (showPhotoPicker || showDelivery || showPreview || showReview || showCover || showPreflight) return;

      switch (event.key) {
        case 'ArrowUp':   event.preventDefault(); cycleLayout(-1); break;
        case 'ArrowDown': event.preventDefault(); cycleLayout(1); break;
        case 'ArrowLeft': event.preventDefault(); setActiveSpread(spreadIndex + 1); break;
        case 'ArrowRight':event.preventDefault(); setActiveSpread(spreadIndex - 1); break;
        case 'Enter':     if (mode === 'organize') { event.preventDefault(); setMode('design'); } break;
        case 'Delete':
        case 'Backspace':
          if (mode === 'design' && selectedElementId) { event.preventDefault(); deleteSelectedElement(); }
          else if (mode === 'design' && selectedSlotIndex !== null) { event.preventDefault(); removeSelectedFramePhoto(); }
          break;
        case 'g':
        case 'G':         if (mode === 'design') { event.preventDefault(); setShowGuides((value) => !value); } break;
        case 'Escape':
          if (cropIndex !== null) setCropIndex(null);
          else if (selectedElementId) setSelectedElementId(null);
          else if (selectedSlotIndex !== null || selectedPhotoId) { setSelectedSlotIndex(null); setSelectedPhotoId(null); }
          else if (mode === 'design') setMode('organize');
          break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const spreadIndex = project.spreads.findIndex((spread) => spread.id === project.activeSpreadId);
  const spread = project.spreads[spreadIndex] ?? project.spreads[0];
  const profile = printProfiles.find((item) => item.id === project.productProfileId)
    ?? FIRST_PRINT_PROFILE;
  const layoutCandidates = useMemo(
    () => buildAlbumLayoutCandidates(
      spread.photoIds,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
      project.styleName,
      {
        sessionStart: spread.sessionStart,
        sessionEnd: Boolean(spread.sessionId)
          && spread.sessionId !== project.spreads[spreadIndex + 1]?.sessionId,
        spreadIndex,
        spreadCount: project.spreads.length,
        previousLayoutId: project.spreads[spreadIndex - 1]?.layoutId,
      },
    ),
    [
      photos, profile.closedHeightMm, profile.closedWidthMm, project.spreads,
      project.styleName, spread.photoIds, spread.sessionId, spread.sessionStart, spreadIndex,
    ],
  );
  const generatedLayout = layoutCandidates.find((candidate) => candidate.id === spread.layoutId)
    ?? layoutCandidates[0]
    ?? EMPTY_GENERATED_LAYOUT;
  /* A Vault page decides where the photos sit. Its photo places are handed to
   * the editor as ordinary slots, so placing, swapping and cropping a photo
   * work exactly as on any other spread. */
  const activeTemplate = spreadTemplate(spread, profile.spreadWidthMm / profile.spreadHeightMm);
  const templatePlaces = activeTemplate ? templateSlots(activeTemplate) : [];
  const templatePhotoLayers = activeTemplate ? photoLayers(activeTemplate) : [];
  const templateZOrder = activeTemplate ? templateZ(activeTemplate) : new Map<string, number>();
  const layout = activeTemplate ? {
    ...generatedLayout,
    id: spread.layoutId,
    name: activeTemplate.name,
    photoCount: activeTemplate.photoCount,
    slots: templatePlaces,
    photoIds: templatePlaces.map((_, index) => spread.photoIds[index] ?? ''),
    explanation: 'עמוד מעוצב מהכספת',
  } : spread.customSlots?.length === spread.photoIds.length ? {
    ...generatedLayout,
    id: spread.layoutId,
    name: 'פריסה אישית',
    slots: spread.customSlots,
    photoIds: spread.photoIds,
    explanation: 'פריסה אישית שנערכה ידנית',
  } : generatedLayout;
  const spreadPaper = activeTemplate && spread.templateInstance
    ? templateBackground(activeTemplate, spread.templateInstance)
    : spread.background;
  /* The photos chosen for THIS album. Undefined on albums made before the
   * choice was kept — those draw from the whole pool, as they always did. */
  const albumPhotos = useMemo(() => {
    if (!project.photoSelection) return photos;
    const chosen = new Set(project.photoSelection);
    return photos.filter((photo) => chosen.has(photo.id));
  }, [photos, project.photoSelection]);
  const usedIds = useMemo(() => new Set(project.spreads.flatMap((item) => item.photoIds).filter(Boolean)), [project.spreads]);
  const currentSpreadIds = useMemo(() => new Set(spread.photoIds), [spread.photoIds]);
  const filteredPhotos = useMemo(() => albumPhotos.filter((photo) => {
    if (photoFilter === 'current') return currentSpreadIds.has(photo.id);
    if (photoFilter === 'unused') return !usedIds.has(photo.id);
    return true;
  }), [albumPhotos, currentSpreadIds, photoFilter, usedIds]);
  const visiblePhotos = filteredPhotos.slice(0, photoLimit);
  const selectedSlot = selectedSlotIndex === null ? null : layout.slots[selectedSlotIndex];
  const selectedFramePhoto = selectedSlotIndex === null
    ? null
    : photos.find((photo) => photo.id === layout.photoIds[selectedSlotIndex]) ?? null;
  const selectedFrameSettings = selectedSlot
    ? spread.frameSettings?.[selectedSlot.id] ?? {
      ...DEFAULT_FRAME_SETTINGS,
      positionX: (selectedFramePhoto?.focalPoint?.x ?? 0.5) * 100,
      positionY: (selectedFramePhoto?.focalPoint?.y ?? 0.5) * 100,
    }
    : null;
  const selectedCrop = selectedSlot && selectedFramePhoto && selectedFrameSettings
    ? assessCrop(
      selectedFramePhoto,
      selectedSlot,
      selectedFrameSettings,
      profile.spreadWidthMm / profile.spreadHeightMm,
    )
    : null;
  const preflightIssues = useMemo(
    () => runAlbumPreflight(project, photos, profile),
    [photos, profile, project],
  );
  const preflight = useMemo(() => ({
    blockers: preflightIssues.filter((issue) => issue.severity === 'blocker').length,
    warnings: preflightIssues.filter((issue) => issue.severity === 'warning').length,
    lowResolution: preflightIssues.filter((issue) => issue.code === 'LOW_PPI').length,
    riskyCrop: preflightIssues.filter((issue) => issue.code === 'UNSAFE_CROP').length,
    waitingAnalysis: preflightIssues.filter((issue) => issue.code === 'ANALYSIS_PENDING').length,
    overlaps: preflightIssues.filter((issue) => issue.code === 'FRAME_OVERLAP').length,
    profileIssues: preflightIssues.filter((issue) => issue.target === 'profile').length,
    approvalIssues: preflightIssues.filter((issue) => issue.target === 'review').length,
    total: preflightIssues.filter((issue) => issue.severity === 'blocker').length,
  }), [preflightIssues]);

  /* Turn the selected story into visual chapters once per album. The detector
   * preserves order and returns boundaries only; layout is then run INSIDE each
   * chapter, which makes it structurally impossible for one spread to mix two
   * sessions. The first spread of every chapter becomes its own opener. */
  useEffect(() => {
    if (!activeAlbumId || project.sessions !== undefined) return undefined;
    const orderedIds = project.spreads.flatMap((candidate) => candidate.photoIds);
    if (!orderedIds.length || detectingSessionsRef.current.has(project.id)) return undefined;
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const selected = orderedIds.map((id) => byId.get(id)).filter((photo): photo is AlbumPhoto => Boolean(photo));
    if (selected.length !== orderedIds.length) return undefined;

    detectingSessionsRef.current.add(project.id);
    const albumId = project.id;
    let detectionFailed = false;
    setNotice('מזהה סשנים ובונה לכל אחד פרק משלו…');
    void detectAlbumSessions(selected)
      .catch(() => {
        detectionFailed = true;
        return oneSession(orderedIds);
      })
      .then((sessions) => {
        if (!mountedRef.current) return;
        setProject((current) => {
          if (current.id !== albumId || current.sessions !== undefined) return current;
          const rebuilt = buildAutomaticAlbum(
            orderedIds,
            photos,
            profile.closedWidthMm / profile.closedHeightMm,
            current.styleName,
            sessions,
          );
          return {
            ...current,
            sessions,
            spreads: rebuilt,
            activeSpreadId: rebuilt[0]?.id ?? current.activeSpreadId,
          };
        });
        setNotice(detectionFailed
          ? 'זיהוי הסשנים לא היה זמין · התמונות נשמרו כסשן אחד ולא עורבבו'
          : sessions.length > 1
            ? `${sessions.length} סשנים זוהו · כל סשן קיבל פרק נפרד`
            : 'האלבום זוהה כסשן אחד רציף');
      });
    return undefined;
  }, [activeAlbumId, photos, profile.closedHeightMm, profile.closedWidthMm, project.id, project.sessions, project.spreads]);

  function commitProject(next: AlbumProject | ((current: AlbumProject) => AlbumProject)) {
    const resolved = typeof next === 'function' ? next(project) : next;
    setHistoryPast((items) => [...items.slice(-49), project]);
    setHistoryFuture([]);
    setProject(resolved);
  }

  function undoProject() {
    const previous = historyPast[historyPast.length - 1];
    if (!previous) return;
    setHistoryPast((items) => items.slice(0, -1));
    setHistoryFuture((items) => [project, ...items].slice(0, 50));
    setProject(previous);
    setSelectedSlotIndex(null);
    setNotice('השינוי האחרון בוטל');
  }

  function redoProject() {
    const next = historyFuture[0];
    if (!next) return;
    setHistoryFuture((items) => items.slice(1));
    setHistoryPast((items) => [...items.slice(-49), project]);
    setProject(next);
    setSelectedSlotIndex(null);
    setNotice('השינוי הוחזר');
  }

  function updateSpread(patch: Partial<AlbumSpread>) {
    commitProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => item.id === spread.id ? { ...item, ...patch } : item),
    }));
    setNotice('השינויים נשמרו');
  }

  function updatePrintProfile(patch: Partial<typeof profile>) {
    const invalidatesCover = patch.closedWidthMm !== undefined
      || patch.closedHeightMm !== undefined
      || patch.spreadWidthMm !== undefined
      || patch.spreadHeightMm !== undefined;
    const next = printProfiles.map((item) => (
      item.id === profile.id ? {
        ...item,
        ...patch,
        coverSpec: patch.coverSpec ?? (
          invalidatesCover ? { ...item.coverSpec, verified: false } : item.coverSpec
        ),
      } : item
    ));
    setPrintProfiles(next);
    localStorage.setItem('album-print-profiles', JSON.stringify(next));
    setNotice('פרופיל הדפוס נשמר במחשב');
  }

  function setActiveSpread(index: number) {
    const next = project.spreads[index];
    if (!next) return;
    setProject((current) => ({ ...current, activeSpreadId: next.id }));
    setSelectedPhotoId(null);
    setSelectedSlotIndex(null);
    setPhotoFilter('current');
    setPhotoLimit(60);
  }

  function addSpread() {
    const next: AlbumSpread = {
      id: `spread-${Date.now()}`,
      pageStart: project.spreads.length * 2 + 2,
      layoutId: 'balanced',
      photoIds: [],
      background: '#f8f6f1',
      locked: false,
      status: 'draft',
      frameSettings: {},
    };
    commitProject((current) => ({
      ...current,
      spreads: [...current.spreads, next],
      activeSpreadId: next.id,
    }));
    setSelectedSlotIndex(null);
    setPhotoFilter('unused');
    setNotice('נוספה כפולה חדשה · בחר כמה תמונות יהיו בה');
  }

  function deleteSpreadAt(index: number) {
    if (project.spreads.length <= 1) {
      setNotice('האלבום חייב להכיל לפחות כפולה אחת');
      return;
    }
    const target = project.spreads[index];
    if (!target) return;
    const remaining = project.spreads
      .filter((item) => item.id !== target.id)
      .map((item, index) => ({ ...item, pageStart: 2 + index * 2 }));
    const nextActive = remaining[Math.min(index, remaining.length - 1)];
    commitProject((current) => ({
      ...current,
      spreads: remaining,
      activeSpreadId: nextActive.id,
    }));
    setSelectedSlotIndex(null);
    setNotice('הכפולה נמחקה; התמונות נשארו במאגר');
  }

  function removeSpreadAt(index: number) {
    const target = project.spreads[index];
    if (!target) return;
    if (target.photoIds.length) {
      setPendingSpreadDelete(index);
      return;
    }
    deleteSpreadAt(index);
  }

  function ensurePrintProfile(
    closedWidthMm: number,
    closedHeightMm: number,
    baseProfileId?: string,
  ): PrintProductProfile {
    const width = Math.max(100, Math.min(1000, Math.round(closedWidthMm)));
    const height = Math.max(100, Math.min(1000, Math.round(closedHeightMm)));
    const existing = printProfiles.find((item) => (
      item.productType === 'layflat'
      && item.closedWidthMm === width
      && item.closedHeightMm === height
    ));
    if (existing) return existing;

    const base = printProfiles.find((item) => item.id === baseProfileId)
      ?? printProfiles[0]
      ?? FIRST_PRINT_PROFILE;
    const custom: PrintProductProfile = {
      ...base,
      id: `custom-layflat-${width}x${height}`,
      name: `אלבום ${(width * 2) / 10}×${height / 10}`,
      labName: 'מידה מותאמת — דורש אימות מול בית הדפוס',
      closedWidthMm: width,
      closedHeightMm: height,
      spreadWidthMm: width * 2,
      spreadHeightMm: height,
      verified: false,
      profileVersion: 'טיוטה',
      coverSpec: {
        ...base.coverSpec,
        totalWidthMm: width * 2 + base.coverSpec.spineWidthMm,
        totalHeightMm: height,
        verified: false,
      },
    };
    const next = [...printProfiles, custom];
    setPrintProfiles(next);
    localStorage.setItem('album-print-profiles', JSON.stringify(next));
    return custom;
  }

  function createAlbum({
    name, baseProfileId, closedWidthMm, closedHeightMm, styleName, background,
    selectedPhotoIds = [], openingDirection = 'rtl', coverStyle = 'photo',
  }: AlbumCreateInput) {
    const selectedProfile = ensurePrintProfile(closedWidthMm, closedHeightMm, baseProfileId);
    const id = `album-${Date.now()}`;
    const initialPhotos = job ? framesToPool(jobFiles.frames) : photos;
    const knownIds = new Set(initialPhotos.map((photo) => photo.id));
    const chosenIds = selectedPhotoIds.filter((photoId) => knownIds.has(photoId));
    /* The photographer builds the book spread by spread. The chosen photos wait
     * in the tray; "בנייה אוטומטית" lays them out only when asked. */
    const initialSpreads: AlbumSpread[] = [{
      id: `spread-${Date.now()}`, pageStart: 2, layoutId: 'balanced', photoIds: [],
      background, locked: false, status: 'draft', frameSettings: {},
    }];    const fresh: AlbumProject = {
      id,
      projectId: job?.id ?? null,
      name,
      productProfileId: selectedProfile.id,
      styleName,
      openingDirection,
      coverStyle,
      spreads: initialSpreads,
      sessions: [],
      photoSelection: chosenIds.length ? chosenIds : undefined,
      activeSpreadId: initialSpreads[0].id,
    };
    saveAlbum(fresh, initialPhotos);
    setAlbums(listAlbums(job?.id));
    setProject(fresh);
    setPhotos(initialPhotos);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSelectedSlotIndex(null);
    setSelectedPhotoId(null);
    setMode('organize');
    setActiveAlbumId(id);
    setShowPhotoPicker(chosenIds.length === 0);
    setNotice(chosenIds.length
      ? `${chosenIds.length} תמונות נבחרו לאלבום · בנה כפולה אחרי כפולה, או בנייה אוטומטית`
      : 'בחר את התמונות שייכנסו לאלבום');
  }

  function openAlbumSettings() {
    setSettingsWidthCm(profile.closedWidthMm / 10);
    setSettingsHeightCm(profile.closedHeightMm / 10);
    setShowAlbumSettings(true);
  }

  function applyAlbumDimensions(widthCm = settingsWidthCm, heightCm = settingsHeightCm) {
    if (widthCm < 10 || widthCm > 100 || heightCm < 10 || heightCm > 100) {
      setNotice('המידות חייבות להיות בין 10 ל־100 ס״מ');
      return;
    }
    const nextProfile = ensurePrintProfile(widthCm * 10, heightCm * 10, profile.id);
    commitProject((current) => ({
      ...current,
      productProfileId: nextProfile.id,
      spreads: current.spreads.map((candidate) => ({
        ...candidate,
        layoutId: 'balanced',
        customSlots: undefined,
        frameSettings: {},
        /* A Vault page stays: it is fitted to the new shape, not dropped. */
      })),
    }));
    setSelectedSlotIndex(null);
    setNotice(`האלבום הותאם למידה ${widthCm}×${heightCm} ס״מ`);
  }

  function applyAlbumStyle(nextStyleName: string) {
    const nonEmptySpreads = project.spreads.filter((candidate) => candidate.photoIds.length > 0);
    if (!nonEmptySpreads.length) {
      commitProject((current) => ({ ...current, styleName: nextStyleName }));
      setNotice(`סגנון ${nextStyleName} יוחל כשיתווספו תמונות`);
      return;
    }
    const hasLockedSpreads = nonEmptySpreads.some((candidate) => candidate.locked);
    const restyled = hasLockedSpreads
      ? buildAlbumFromGroups(
        nonEmptySpreads.map((candidate) => candidate.photoIds),
        photos,
        profile.closedWidthMm / profile.closedHeightMm,
        nextStyleName,
        nonEmptySpreads.map((candidate) => candidate.sessionId),
      )
      : buildAutomaticAlbum(
        nonEmptySpreads.flatMap((candidate) => candidate.photoIds),
        photos,
        profile.closedWidthMm / profile.closedHeightMm,
        nextStyleName,
        project.sessions,
      );
    let generatedIndex = 0;
    commitProject((current) => ({
      ...current,
      styleName: nextStyleName,
      activeSpreadId: hasLockedSpreads
        ? current.activeSpreadId
        : restyled[0]?.id ?? current.activeSpreadId,
      spreads: hasLockedSpreads ? current.spreads.map((candidate) => {
        if (!candidate.photoIds.length) return candidate;
        const styled = restyled[generatedIndex++];
        if (!styled || candidate.locked) return candidate;
        return {
          ...styled,
          id: candidate.id,
          pageStart: candidate.pageStart,
          locked: candidate.locked,
          status: candidate.status,
        };
      }) : restyled,
    }));
    setSelectedSlotIndex(null);
    setSelectedPhotoId(null);
    setNotice(hasLockedSpreads
      ? `סגנון ${nextStyleName} הוחל · כפולות נעולות נשמרו`
      : `סגנון ${nextStyleName} בנה מחדש את קצב האלבום ל־${restyled.length} כפולות`);
  }

  function closeAlbum() {
    // flush before leaving; the autosave debounce may not have fired yet
    if (activeAlbumId && isHydrated) saveAlbum(project, photos);
    setAlbums(listAlbums(job?.id));
    setActiveAlbumId(null);
    setSelectedSlotIndex(null);
    setSelectedPhotoId(null);
    setMode('organize');
  }

  /** Reorder by dropping one spread onto another's slot, from the organise grid. */
  function reorderSpread(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const sourceSession = project.spreads[from]?.sessionId;
    const targetSession = project.spreads[to]?.sessionId;
    if (sourceSession && targetSession && sourceSession !== targetSession) {
      setNotice('כל סשן נשאר באזור שלו · אפשר לשנות סדר בתוך הסשן');
      return;
    }
    const reordered = [...project.spreads];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    commitProject((current) => ({
      ...current,
      // page numbers are a function of position, never stored independently
      spreads: reordered.map((item, index) => ({
        ...item,
        pageStart: 2 + index * 2,
        sessionStart: Boolean(item.sessionId)
          && item.sessionId !== reordered[index - 1]?.sessionId,
      })),
    }));
    setNotice('סדר הכפולות עודכן');
  }

  /** Keep the album live while the overview changes cuts or photo order.
   * Unchanged spreads retain their identity and manual work; a same-sized
   * positional spread also keeps its geometry while receiving the new order. */
  function changeAlbumGroups(groups: string[][]) {
    const clean = groups.filter((group) => group.length > 0);
    if (!clean.length) return;
    const constrained = constrainGroupsToSessions(clean, project.sessions);
    const generated = buildAlbumFromGroups(
      constrained.groups,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
      project.styleName,
      constrained.sessionIds,
    );
    const usedOld = new Set<string>();
    const samePhotos = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    const next = generated.map((candidate, index) => {
      const exact = project.spreads.find((old) => !usedOld.has(old.id) && samePhotos(old.photoIds, constrained.groups[index]));
      const positional = project.spreads[index];
      const old = exact ?? (
        positional && !usedOld.has(positional.id) && positional.photoIds.length === constrained.groups[index].length
          ? positional
          : undefined
      );
      if (!old) return candidate;
      usedOld.add(old.id);
      return {
        ...old,
        photoIds: constrained.groups[index],
        sessionId: candidate.sessionId,
        sessionStart: candidate.sessionStart,
        pageStart: 2 + index * 2,
      };
    });
    const activeStillExists = next.some((candidate) => candidate.id === project.activeSpreadId);
    commitProject((current) => ({
      ...current,
      spreads: next,
      activeSpreadId: activeStillExists ? current.activeSpreadId : next[0].id,
    }));
  }

  /** Photos join the album's tray; placing them is the photographer's call. */
  function addToAlbumPhotos(photoIds: string[]) {
    const current = project.photoSelection ?? project.spreads.flatMap((item) => item.photoIds).filter(Boolean);
    const next = [...new Set([...current, ...photoIds])];
    const added = next.length - current.length;
    commitProject((album) => ({ ...album, photoSelection: next }));
    setPhotoFilter('unused');
    setNotice(added ? `${added} תמונות נוספו לאלבום` : 'התמונות כבר באלבום');
  }

  /** Lay out every chosen photo on Vault pages. Replaces the spreads, so it asks
   *  first when any photo is already placed. */
  function autoBuildAlbum(confirmed = false) {
    const pool = (project.photoSelection ?? photos.map((photo) => photo.id))
      .filter((id) => photos.some((photo) => photo.id === id));
    if (!pool.length) {
      setNotice('אין תמונות באלבום — הוסף תמונות לפני בנייה אוטומטית');
      return;
    }
    if (!confirmed && project.spreads.some((item) => item.photoIds.some(Boolean))) {
      setConfirmAutoBuild(true);
      return;
    }
    setConfirmAutoBuild(false);
    const spreads = buildAutomaticAlbum(
      pool, photos, profile.closedWidthMm / profile.closedHeightMm, project.styleName,
    );
    commitProject((album) => ({
      ...album,
      spreads,
      sessions: undefined,
      activeSpreadId: spreads[0]?.id ?? album.activeSpreadId,
    }));
    setSelectedSlotIndex(null);
    setNotice(`האלבום נבנה אוטומטית · ${spreads.length} כפולות · אפשר לבטל ב-Ctrl+Z`);
  }

  function addPhotosToAlbum(photoIds: string[]) {
    const used = new Set(project.spreads.flatMap((candidate) => candidate.photoIds));
    const added = photoIds.filter((id, index, all) => !used.has(id) && all.indexOf(id) === index);
    setShowPhotoPicker(false);
    if (!added.length) return;
    const existingPhotoIds = project.spreads.flatMap((candidate) => candidate.photoIds);
    const existingSessions = project.sessions?.length
      ? project.sessions
      : oneSession(existingPhotoIds);
    const newSession = {
      id: `session-${Date.now()}`,
      label: `סשן ${existingSessions.length + 1}`,
      photoIds: added,
    };
    const additions = buildAutomaticAlbum(
      added,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
      project.styleName,
      [newSession],
    );
    const hasOnlyEmptySpread = project.spreads.length === 1 && project.spreads[0].photoIds.length === 0;
    const base = hasOnlyEmptySpread ? [] : project.spreads;
    const next = [...base, ...additions].map((candidate, index) => ({ ...candidate, pageStart: 2 + index * 2 }));
    commitProject((current) => ({
      ...current,
      spreads: next,
      sessions: [...existingSessions, newSession],
      activeSpreadId: additions[0]?.id ?? current.activeSpreadId,
    }));
    setNotice(`${added.length} תמונות נוספו`);
  }

  function createReviewVersion() {
    const versions = project.reviewVersions ?? [];
    const version = {
      id: `review-${Date.now()}`,
      number: Math.max(0, ...versions.map((item) => item.number)) + 1,
      createdAt: new Date().toISOString(),
      status: 'sent' as const,
      spreads: JSON.parse(JSON.stringify(project.spreads)) as AlbumSpread[],
      cover: project.cover ? JSON.parse(JSON.stringify(project.cover)) : undefined,
      comments: [],
    };
    commitProject({
      ...project,
      reviewVersions: [...versions, version],
      activeReviewVersionId: version.id,
    });
    setShowReview(true);
    setNotice(`נוצרה גרסת הגהה ${version.number}`);
  }

  function openReviewWorkspace() {
    const versions = project.reviewVersions ?? [];
    if (!versions.length) {
      createReviewVersion();
      return;
    }
    const activeId = project.activeReviewVersionId ?? versions[versions.length - 1].id;
    if (activeId !== project.activeReviewVersionId) {
      setProject({ ...project, activeReviewVersionId: activeId });
    }
    setShowReview(true);
  }

  function navigateFromPreflight(issue: PreflightIssue) {
    setShowPreflight(false);
    if (issue.target === 'spread' && issue.spreadId) {
      setProject((current) => ({ ...current, activeSpreadId: issue.spreadId! }));
      setSelectedSlotIndex(null);
      setNotice(issue.title);
      return;
    }
    if (issue.target === 'cover') {
      setShowCover(true);
      return;
    }
    if (issue.target === 'profile') {
      setShowProfileEditor(true);
      setNotice(issue.detail);
      return;
    }
    if (issue.target === 'review') openReviewWorkspace();
  }

  function addFrame() {
    if (blockTemplateGeometry()) return;
    // Base BOTH lists on the layout currently on screen so `customSlots.length`
    // and `photoIds.length` always match — otherwise the spread silently falls
    // back to a generated layout and the new frame vanishes. That mismatch was
    // why adding a second and third frame "did nothing".
    const slots = layout.slots.map((s) => ({ ...s }));
    const ids = [...layout.photoIds];
    const next: LayoutSlot = {
      id: `frame-${Date.now()}`,
      // dropped near the middle, offset so a second one does not hide the first
      x: 0.36 + (slots.length % 4) * 0.05,
      y: 0.28 + (slots.length % 4) * 0.05,
      width: 0.3,
      height: 0.34,
      role: 'support',
      preferred: [],
    };
    updateSpread({
      layoutId: `custom-${Date.now()}`,
      customSlots: [...slots, next],
      photoIds: [...ids, ''],
    });
    setSelectedSlotIndex(slots.length);
    setCropIndex(null);
    setNotice('מסגרת נוספה — גרור אותה, שנה גודל בפינות, או שים אותה על מסגרת אחרת');
  }

  function removeFrame(index: number) {
    if (blockTemplateGeometry()) return;
    if (layout.slots.length <= 1) return;
    const allSlots = layout.slots.filter((_, i) => i !== index);
    updateSpread({
      layoutId: `custom-${Date.now()}`,
      customSlots: allSlots,
      photoIds: layout.photoIds.filter((_, i) => i !== index),
    });
    setSelectedSlotIndex(null);
    setCropIndex(null);
    setNotice('המסגרת הוסרה');
  }

  /* Stacking order IS render order — a later frame paints over an earlier one.
   * Bringing a frame to the front (or back) is how "a photo on a photo" gets the
   * layering the photographer means, instead of whichever one happened to be
   * added last winning. Slot, its photo and its settings move together. */
  function reorderFrame(to: 'front' | 'back') {
    if (blockTemplateGeometry()) return;
    if (selectedSlotIndex === null) return;
    const slots = layout.slots.map((s) => ({ ...s }));
    const ids = [...layout.photoIds];
    const [slot] = slots.splice(selectedSlotIndex, 1);
    const [id] = ids.splice(selectedSlotIndex, 1);
    if (to === 'front') { slots.push(slot); ids.push(id); } else { slots.unshift(slot); ids.unshift(id); }
    updateSpread({ customSlots: slots, photoIds: ids });
    const nextIndex = to === 'front' ? slots.length - 1 : 0;
    setSelectedSlotIndex(nextIndex);
    setNotice(to === 'front' ? 'המסגרת הובאה לחזית' : 'המסגרת נשלחה לאחור');
  }

  function chooseLayout(nextLayout: GeneratedAlbumLayout) {
    updateSpread({
      layoutId: nextLayout.id,
      photoIds: nextLayout.photoIds,
      frameSettings: {},
      customSlots: undefined,
      templateInstance: undefined,
    });
    setSelectedSlotIndex(null);
    setNotice(`הוחלה הפריסה „${nextLayout.name}”`);
  }

  /* The geometry of a Vault page is the designer's. Moving its frames belongs to
   * the layer editor, a later stage — until then say so, instead of quietly
   * turning the page back into a generic layout. */
  function blockTemplateGeometry() {
    if (!activeTemplate) return false;
    setNotice('בעמוד מהכספת עוד אי אפשר להזיז, להוסיף או ליישר מסגרות — זה ייכנס בשלב העורך');
    return true;
  }

  function placeTemplate(template: AlbumTemplate, photoIds?: string[]) {
    updateSpread({
      ...applyTemplate(spread, template),
      layoutId: template.id,
      ...(photoIds ? { photoIds } : null),
    });
    setSelectedSlotIndex(null);
    setCropIndex(null);
    setNotice(`הוצב ${template.name}`);
  }

  function removeTemplate() {
    updateSpread({
      templateInstance: undefined,
      layoutId: 'balanced',
      customSlots: undefined,
      frameSettings: {},
    });
    setSelectedSlotIndex(null);
    setNotice('הכפולה חזרה לפריסה רגילה');
  }

  /* Dragging a colour or typing a word would leave one undo step per pixel or
   * letter. The page follows live; the history receives ONE step — the album as
   * it was before the edit began — when the control is let go. */
  const templateEditBase = useRef<AlbumProject | null>(null);

  function editTemplateInstance(change: (instance: SpreadTemplateInstance) => SpreadTemplateInstance) {
    if (!spread.templateInstance) return;
    if (!templateEditBase.current) templateEditBase.current = project;
    const next = change(spread.templateInstance);
    setProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => (
        item.id === spread.id ? { ...item, templateInstance: next } : item
      )),
    }));
  }

  function endTemplateEdit() {
    const base = templateEditBase.current;
    if (!base) return;
    templateEditBase.current = null;
    setHistoryPast((items) => [...items.slice(-49), base]);
    setHistoryFuture([]);
    setNotice('השינויים נשמרו');
  }

  /* ---- photo tools on a Vault page: rotate, flip, corners, border, shadow,
   * order, duplicate and delete — the spread's own changes ---- */
  const selectedPlace = activeTemplate && selectedSlotIndex !== null
    ? templatePhotoLayers[selectedSlotIndex]
    : undefined;

  function setPlaceStyle(patch: Partial<PlaceStyle>, done = true) {
    if (!selectedPlace) return;
    const id = selectedPlace.id;
    editTemplateInstance((instance) => ({
      ...instance,
      styles: { ...instance.styles, [id]: { ...instance.styles?.[id], ...patch } },
    }));
    if (done) endTemplateEdit();
  }

  function orderPlace(to: 'front' | 'forward' | 'backward' | 'back') {
    if (!selectedPlace || !activeTemplate) return;
    setPlaceStyle({ zIndex: reorderZ(activeTemplate.layers, selectedPlace.id, to) });
    setNotice({ front: 'הובא לחזית', forward: 'הוזז קדימה', backward: 'הוזז אחורה', back: 'נשלח לרקע' }[to]);
  }

  function duplicateSelectedPlace() {
    if (!selectedPlace || !activeTemplate || !spread.templateInstance || selectedSlotIndex === null) return;
    const topZ = Math.max(...activeTemplate.layers.map((layer) => layer.zIndex));
    const copy = duplicatePlace(selectedPlace, topZ, Date.now());
    updateSpread({
      templateInstance: {
        ...spread.templateInstance,
        addedPlaces: [...(spread.templateInstance.addedPlaces ?? []), copy],
        styles: spread.templateInstance.styles?.[selectedPlace.id]
          ? { ...spread.templateInstance.styles, [copy.id]: { ...spread.templateInstance.styles[selectedPlace.id], zIndex: undefined } }
          : spread.templateInstance.styles,
      },
      photoIds: [...layout.photoIds, layout.photoIds[selectedSlotIndex] ?? ''],
    });
    setSelectedSlotIndex(layout.photoIds.length);
    setNotice('המקום שוכפל');
  }

  function deleteSelectedPlace() {
    if (!selectedPlace || !spread.templateInstance || selectedSlotIndex === null) return;
    const id = selectedPlace.id;
    const instance = spread.templateInstance;
    const wasAdded = instance.addedPlaces?.some((place) => place.id === id);
    const drop = <T,>(record: Record<string, T> | undefined) => {
      if (!record) return record;
      const { [id]: _removed, ...rest } = record;
      return rest;
    };
    updateSpread({
      templateInstance: {
        ...instance,
        addedPlaces: wasAdded ? instance.addedPlaces!.filter((place) => place.id !== id) : instance.addedPlaces,
        removedPlaces: wasAdded ? instance.removedPlaces : [...(instance.removedPlaces ?? []), id],
        styles: drop(instance.styles),
        places: drop(instance.places),
        fades: drop(instance.fades),
      },
      photoIds: layout.photoIds.filter((_, index) => index !== selectedSlotIndex),
    });
    setSelectedSlotIndex(null);
    setNotice('המקום נמחק מהכפולה · Ctrl+Z לביטול');
  }

  /* ---- added elements: text, shapes, Vault artwork, imports ---- */
  const addedElements = spread.templateInstance?.addedLayers ?? [];
  const selectedElement = activeTemplate && selectedElementId
    ? activeTemplate.layers.find((layer) => layer.id === selectedElementId && addedElements.some((item) => item.id === layer.id)) as
      ShapeLayer | TextLayer | ImageLayer | undefined
    : undefined;

  function addElement(element: ElementDef) {
    if (!activeTemplate || !spread.templateInstance) {
      setNotice('בחר קודם עמוד מהכספת לכפולה');
      return;
    }
    const topZ = Math.max(...activeTemplate.layers.map((layer) => layer.zIndex), 0);
    const layer = elementToLayer(element, profile.spreadWidthMm / profile.spreadHeightMm, topZ, Date.now());
    updateSpread({
      templateInstance: { ...spread.templateInstance, addedLayers: [...addedElements, layer] },
    });
    setSelectedSlotIndex(null);
    setSelectedElementId(layer.id);
    setNotice(`נוסף ${element.name} · גרור להזיז, פינות לשינוי גודל`);
  }

  function updateElement(id: string, change: (layer: ShapeLayer | TextLayer | ImageLayer) => ShapeLayer | TextLayer | ImageLayer, done = true) {
    editTemplateInstance((instance) => ({
      ...instance,
      addedLayers: (instance.addedLayers ?? []).map((layer) => (layer.id === id ? change(layer) : layer)),
    }));
    if (done) endTemplateEdit();
  }

  /** Move or resize an element; a line's points follow its box. */
  function withBox(layer: ShapeLayer | TextLayer | ImageLayer, box: LayerBox) {
    if (layer.type === 'shape' && layer.points) {
      const from = layer.box;
      const sx = from.width > 1e-6 ? box.width / from.width : 1;
      const sy = from.height > 1e-6 ? box.height / from.height : 1;
      const points = layer.points.map(([px, py]) => [
        box.x + (px - from.x) * sx,
        box.y + (py - from.y) * sy,
      ] as [number, number]);
      return { ...layer, box, points };
    }
    return { ...layer, box };
  }

  function deleteSelectedElement() {
    if (!selectedElementId || !spread.templateInstance) return;
    updateSpread({
      templateInstance: {
        ...spread.templateInstance,
        addedLayers: addedElements.filter((layer) => layer.id !== selectedElementId),
      },
    });
    setSelectedElementId(null);
    setNotice('האלמנט נמחק · Ctrl+Z לביטול');
  }

  function duplicateSelectedElement() {
    if (!selectedElement || !spread.templateInstance || !activeTemplate) return;
    const topZ = Math.max(...activeTemplate.layers.map((layer) => layer.zIndex));
    const source = addedElements.find((layer) => layer.id === selectedElement.id)!;
    const copy = withBox(
      { ...source, id: `el-${Date.now()}`, zIndex: topZ + 1 },
      { ...source.box, x: Math.min(1 - source.box.width, source.box.x + 0.015), y: Math.min(1 - source.box.height, source.box.y + 0.03) },
    );
    updateSpread({ templateInstance: { ...spread.templateInstance, addedLayers: [...addedElements, copy] } });
    setSelectedElementId(copy.id);
    setNotice('האלמנט שוכפל');
  }

  async function importMyElements(files: FileList) {
    const result = await importElements(files);
    const { elements } = await loadMyElements();
    setMyElements(elements);
    const parts = [
      result.added.length ? `יובאו ${result.added.length} אלמנטים` : '',
      result.opaque.length ? `ללא שקיפות (יסתירו את מה שמתחתם): ${result.opaque.join(', ')}` : '',
      ...result.refused.map((item) => `${item.name}: ${item.reason}`),
    ].filter(Boolean);
    setNotice(parts.join(' · ') || 'לא יובא דבר');
  }

  async function importMyFonts(files: FileList) {
    const result = await importUserFonts(files);
    if (result.added.length) setUserFonts((fonts) => [...fonts, ...result.added]);
    const parts = [
      result.added.length ? `נוספו ${result.added.length} גופנים: ${result.added.map((font) => font.family).join(', ')}` : '',
      ...result.refused.map((item) => `${item.name}: ${item.reason}`),
    ].filter(Boolean);
    setNotice(parts.join(' · ') || 'לא נוסף גופן');
  }

  async function removeFromMyElements(element: ElementDef) {
    await removeMyElement(element);
    setMyElements((items) => items.filter((item) => item.id !== element.id));
    setNotice(`${element.name} הוסר מהספרייה · כפולות שהוא כבר נמצא בהן יציגו שהוא חסר`);
  }

  /* dragging and resizing an element, with the same smart guides as photos */
  const elementGesture = useRef<{
    id: string; mode: FrameGestureMode; startX: number; startY: number; box: LayerBox; rect: DOMRect;
    uniform: boolean;
  } | null>(null);

  function beginElementGesture(event: React.PointerEvent<Element>, layer: ShapeLayer | TextLayer | ImageLayer, mode: FrameGestureMode) {
    event.preventDefault();
    event.stopPropagation();
    const sheet = event.currentTarget.closest('.album-spread') as HTMLElement | null;
    if (!sheet) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* released */ }
    setSelectedSlotIndex(null);
    setSelectedElementId(layer.id);
    elementGesture.current = {
      id: layer.id, mode, startX: event.clientX, startY: event.clientY, box: { ...layer.box },
      rect: sheet.getBoundingClientRect(),
      // artwork and pictures keep their shape; boxes and lines may stretch
      uniform: layer.type === 'image' || (layer.type === 'shape' && layer.shape === 'path'),
    };
  }

  function moveElementGesture(event: React.PointerEvent<Element>) {
    const g = elementGesture.current;
    if (!g || !activeTemplate) return;
    const dx = (event.clientX - g.startX) / g.rect.width;
    const dy = (event.clientY - g.startY) / g.rect.height;
    const MIN = 0.01;
    let { x, y, width, height } = g.box;
    const corner = g.mode.length === 2;
    if (g.mode === 'move') {
      x += dx; y += dy;
    } else {
      if (g.mode.endsWith('e')) width = Math.max(MIN, g.box.width + dx);
      if (g.mode.endsWith('w')) { width = Math.max(MIN, g.box.width - dx); x = g.box.x + g.box.width - width; }
      if (g.mode.startsWith('s')) height = Math.max(MIN, g.box.height + dy);
      if (g.mode.startsWith('n')) { height = Math.max(MIN, g.box.height - dy); y = g.box.y + g.box.height - height; }
      // a corner keeps proportions for artwork and pictures, and for anything with Shift
      if (corner && (g.uniform || event.shiftKey)) {
        const scale = Math.max(width / g.box.width, height / g.box.height);
        width = g.box.width * scale; height = g.box.height * scale;
        if (g.mode.endsWith('w')) x = g.box.x + g.box.width - width;
        if (g.mode.startsWith('n')) y = g.box.y + g.box.height - height;
      }
    }
    const guided = smartGuides(g.box, { x, y, width, height }, g.mode, {
      aspect: profile.spreadWidthMm / profile.spreadHeightMm,
      heightMm: profile.spreadHeightMm,
      safeMarginMm: profile.safeMarginMm,
      tolerancePx: 7,
      screenHeightPx: g.rect.height,
      others: activeTemplate.layers.filter((layer) => layer.id !== g.id).map((layer) => layer.box),
      sizeReferences: [],
    }, { snap: !event.altKey, keepRatio: g.uniform && corner });
    setFrameGuides(guided);
    updateElement(g.id, (layer) => withBox(layer, guided.box), false);
  }

  function endElementGesture() {
    if (!elementGesture.current) return;
    elementGesture.current = null;
    setFrameGuides(null);
    endTemplateEdit();
  }

  function beginElementRotate(event: React.PointerEvent<HTMLSpanElement>) {
    if (!selectedElement) return;
    event.preventDefault();
    event.stopPropagation();
    const box = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* released */ }
    rotateSession.current = {
      cx, cy, startAngle: Math.atan2(event.clientY - cy, event.clientX - cx), startRotation: selectedElement.rotation ?? 0,
    };
  }

  function moveElementRotate(event: React.PointerEvent<HTMLSpanElement>) {
    const session = rotateSession.current;
    if (!session || !selectedElementId) return;
    const angle = Math.atan2(event.clientY - session.cy, event.clientX - session.cx);
    let degrees = session.startRotation + ((angle - session.startAngle) * 180) / Math.PI;
    degrees = ((degrees + 540) % 360) - 180;
    if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    else if (!event.altKey && Math.abs(Math.round(degrees / 45) * 45 - degrees) < 4) degrees = Math.round(degrees / 45) * 45;
    updateElement(selectedElementId, (layer) => ({ ...layer, rotation: Math.round(degrees * 10) / 10 }), false);
    setNotice(`סיבוב ${Math.round(degrees)}°`);
  }

  /* rotation handle: angle from the block's centre; snaps to every 45° within
   * 4°, Shift turns in 15° steps, Alt turns freely */
  const rotateSession = useRef<{ cx: number; cy: number; startAngle: number; startRotation: number } | null>(null);

  function beginRotate(event: React.PointerEvent<HTMLSpanElement>) {
    if (!selectedPlace) return;
    event.preventDefault();
    event.stopPropagation();
    const box = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* released */ }
    rotateSession.current = {
      cx, cy,
      startAngle: Math.atan2(event.clientY - cy, event.clientX - cx),
      startRotation: selectedPlace.rotation ?? 0,
    };
  }

  function moveRotate(event: React.PointerEvent<HTMLSpanElement>) {
    const session = rotateSession.current;
    if (!session) return;
    const angle = Math.atan2(event.clientY - session.cy, event.clientX - session.cx);
    let degrees = session.startRotation + ((angle - session.startAngle) * 180) / Math.PI;
    degrees = ((degrees + 540) % 360) - 180;
    if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    else if (!event.altKey) {
      const nearest45 = Math.round(degrees / 45) * 45;
      if (Math.abs(nearest45 - degrees) < 4) degrees = nearest45;
    }
    setPlaceStyle({ rotation: Math.round(degrees * 10) / 10 }, false);
    setNotice(`סיבוב ${Math.round(degrees)}°`);
  }

  function endRotate() {
    if (!rotateSession.current) return;
    rotateSession.current = null;
    endTemplateEdit();
  }

  function updateSelectedSlot(patch: Partial<LayoutSlot>) {
    if (blockTemplateGeometry()) return;
    if (selectedSlotIndex === null) return;
    const next = layout.slots.map((slot, index) => (
      index === selectedSlotIndex ? { ...slot, ...patch } : slot
    ));
    updateSpread({ customSlots: next });
    setNotice('המסגרת נערכה · הפריסה כעת אישית');
  }

  type FrameArrangeAction = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
    | 'width' | 'height' | 'size' | 'horizontal-gap' | 'vertical-gap';

  /** PowerPoint-like whole-selection commands. Until marquee selection lands,
   * the selected frame is the reference and the command applies to every frame
   * on this spread — a visible, deterministic rule instead of hidden snapping. */
  function arrangeFrames(action: FrameArrangeAction) {
    if (blockTemplateGeometry()) return;
    if (selectedSlotIndex === null || layout.slots.length < 2) return;
    const reference = layout.slots[selectedSlotIndex];
    const next = layout.slots.map((slot) => ({ ...slot }));
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    if (action === 'left') {
      next.forEach((slot) => { slot.x = clamp(reference.x, 0, 1 - slot.width); });
    } else if (action === 'center-x') {
      const center = reference.x + reference.width / 2;
      next.forEach((slot) => { slot.x = clamp(center - slot.width / 2, 0, 1 - slot.width); });
    } else if (action === 'right') {
      const right = reference.x + reference.width;
      next.forEach((slot) => { slot.x = clamp(right - slot.width, 0, 1 - slot.width); });
    } else if (action === 'top') {
      next.forEach((slot) => { slot.y = clamp(reference.y, 0, 1 - slot.height); });
    } else if (action === 'center-y') {
      const center = reference.y + reference.height / 2;
      next.forEach((slot) => { slot.y = clamp(center - slot.height / 2, 0, 1 - slot.height); });
    } else if (action === 'bottom') {
      const bottom = reference.y + reference.height;
      next.forEach((slot) => { slot.y = clamp(bottom - slot.height, 0, 1 - slot.height); });
    } else if (action === 'width') {
      next.forEach((slot) => {
        slot.width = Math.min(reference.width, 1);
        slot.x = clamp(slot.x, 0, 1 - slot.width);
      });
    } else if (action === 'height') {
      next.forEach((slot) => {
        slot.height = Math.min(reference.height, 1);
        slot.y = clamp(slot.y, 0, 1 - slot.height);
      });
    } else if (action === 'size') {
      next.forEach((slot) => {
        slot.width = Math.min(reference.width, 1);
        slot.height = Math.min(reference.height, 1);
        slot.x = clamp(slot.x, 0, 1 - slot.width);
        slot.y = clamp(slot.y, 0, 1 - slot.height);
      });
    } else {
      const horizontal = action === 'horizontal-gap';
      const ordered = next.map((slot, index) => ({ slot, index })).sort((a, b) => (
        horizontal ? a.slot.x - b.slot.x : a.slot.y - b.slot.y
      ));
      if (ordered.length < 3) return;
      const first = ordered[0].slot;
      const last = ordered[ordered.length - 1].slot;
      const start = horizontal ? first.x : first.y;
      const end = horizontal ? last.x + last.width : last.y + last.height;
      const occupied = ordered.reduce(
        (sum, item) => sum + (horizontal ? item.slot.width : item.slot.height), 0,
      );
      const gap = Math.max(0, (end - start - occupied) / (ordered.length - 1));
      let cursor = start;
      ordered.forEach(({ slot }) => {
        if (horizontal) slot.x = clamp(cursor, 0, 1 - slot.width);
        else slot.y = clamp(cursor, 0, 1 - slot.height);
        cursor += (horizontal ? slot.width : slot.height) + gap;
      });
    }

    updateSpread({ customSlots: next });
    const labels: Record<FrameArrangeAction, string> = {
      left: 'המסגרות יושרו לשמאל',
      'center-x': 'מרכזי המסגרות יושרו אופקית',
      right: 'המסגרות יושרו לימין',
      top: 'המסגרות יושרו למעלה',
      'center-y': 'מרכזי המסגרות יושרו אנכית',
      bottom: 'המסגרות יושרו למטה',
      width: 'רוחב המסגרות הושווה',
      height: 'גובה המסגרות הושווה',
      size: 'גודל המסגרות הושווה',
      'horizontal-gap': 'המרווח האופקי הושווה',
      'vertical-gap': 'המרווח האנכי הושווה',
    };
    setNotice(`${labels[action]} · הפריסה כעת אישית`);
  }

  function savePersonalLayout() {
    if (blockTemplateGeometry()) return;
    if (!layout.slots.length) return;
    const next: PersonalLayout = {
      id: `personal-${Date.now()}`,
      name: `תבנית אישית ${personalLayouts.length + 1}`,
      photoCount: layout.photoCount,
      pageAspect: profile.closedWidthMm / profile.closedHeightMm,
      slots: layout.slots,
    };
    const all = [...personalLayouts, next];
    setPersonalLayouts(all);
    localStorage.setItem('album-personal-layouts', JSON.stringify(all));
    updateSpread({ layoutId: next.id, customSlots: next.slots });
    setNotice(`נשמרה ${next.name}`);
  }

  function applyPersonalLayout(item: PersonalLayout) {
    updateSpread({
      layoutId: item.id, customSlots: item.slots, frameSettings: {}, templateInstance: undefined,
    });
    setSelectedSlotIndex(null);
    setNotice(`הוחלה ${item.name}`);
  }

  function assignPhotoById(slotIndex: number, photoId: string) {
    const nextIds = [...layout.photoIds];
    const existingIndex = nextIds.indexOf(photoId);
    if (existingIndex >= 0) {
      [nextIds[existingIndex], nextIds[slotIndex]] = [nextIds[slotIndex], nextIds[existingIndex]];
    } else {
      nextIds[slotIndex] = photoId;
    }
    updateSpread({ photoIds: nextIds });
    setSelectedPhotoId(null);
    setSelectedSlotIndex(activeTemplate ? null : slotIndex);
    setNotice('התמונה שובצה במסגרת');
  }

  function assignPhoto(slotIndex: number) {
    if (suppressFrameClick.current) return;
    if (!selectedPhotoId) {
      setSelectedElementId(null);
      setSelectedSlotIndex(slotIndex);
      setCropIndex(null);
      setNotice('גרור להזיז · פינות לשינוי גודל (Shift שומר פרופורציה) · לחיצה כפולה למקם את התמונה');
      return;
    }
    assignPhotoById(slotIndex, selectedPhotoId);
  }

  function beginPhotoDrag(event: React.DragEvent, photoId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-teza-photo', photoId);
    event.dataTransfer.setData('text/plain', photoId);
  }

  function dropPhotoOnFrame(event: React.DragEvent, slotIndex: number) {
    event.preventDefault();
    const photoId = event.dataTransfer.getData('application/x-teza-photo')
      || event.dataTransfer.getData('text/plain');
    if (!photos.some((photo) => photo.id === photoId)) return;
    assignPhotoById(slotIndex, photoId);
  }

  function beginPan(
    event: React.PointerEvent<HTMLButtonElement>,
    slotIndex: number,
    settings: PhotoFrameSettings,
  ) {
    /* Dragging inside the SELECTED frame moves the photo; dragging any other
     * frame still hands the photo to a different slot. Selection is what tells
     * the two apart — the same rule InDesign uses for its content grabber —
     * so there is no mode to switch on first. */
    if (selectedSlotIndex !== slotIndex || settings.fit === 'contain') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panSession.current = {
      slotIndex,
      startX: event.clientX,
      startY: event.clientY,
      positionX: settings.positionX,
      positionY: settings.positionY,
      before: project,
      moved: false,
    };
  }

  function movePan(event: React.PointerEvent<HTMLButtonElement>, slotId: string) {
    const session = panSession.current;
    if (!session) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const positionX = Math.max(
      0,
      Math.min(100, session.positionX - (event.clientX - session.startX) / bounds.width * 100),
    );
    const positionY = Math.max(
      0,
      Math.min(100, session.positionY - (event.clientY - session.startY) / bounds.height * 100),
    );
    session.moved = true;
    setProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => item.id === spread.id ? {
        ...item,
        frameSettings: {
          ...item.frameSettings,
          [slotId]: {
            ...(item.frameSettings?.[slotId] ?? DEFAULT_FRAME_SETTINGS),
            fit: 'cover',
            positionX,
            positionY,
          },
        },
      } : item),
    }));
  }

  function endPan() {
    const session = panSession.current;
    if (session?.moved) {
      suppressFrameClick.current = true;
      window.setTimeout(() => {
        suppressFrameClick.current = false;
      }, 0);
      setHistoryPast((items) => [...items.slice(-49), session.before]);
      setHistoryFuture([]);
      setNotice('מיקום התמונה עודכן');
    }
    panSession.current = null;
  }

  /* ---- move + resize the frame on the canvas (no sliders) ---- */
  function beginFrameGesture(
    event: React.PointerEvent<Element>,
    slotIndex: number,
    mode: FrameGestureMode,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const sheet = (event.currentTarget.closest('.album-spread') as HTMLElement | null);
    if (!sheet) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    frameGesture.current = {
      mode,
      index: slotIndex,
      startX: event.clientX,
      startY: event.clientY,
      slot: { ...layout.slots[slotIndex] },
      baseSlots: layout.slots.map((s) => ({ ...s })),
      rect: sheet.getBoundingClientRect(),
      before: project,
      moved: false,
    };
  }

  function moveFrameGesture(event: React.PointerEvent<Element>) {
    const g = frameGesture.current;
    if (!g) return;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const MIN = 0.06;
    const dx = (event.clientX - g.startX) / g.rect.width;
    const dy = (event.clientY - g.startY) / g.rect.height;
    let { x, y, width, height } = g.slot;
    if (g.mode === 'move') {
      x = g.slot.x + dx;
      y = g.slot.y + dy;
    } else {
      // corner handles move two edges, side handles one
      const east = g.mode.endsWith('e');
      const west = g.mode.endsWith('w');
      const south = g.mode.startsWith('s');
      const north = g.mode.startsWith('n');
      if (east) {
        width = clamp(g.slot.width + dx, MIN, 1 - g.slot.x);
      } else if (west) {
        const nx = clamp(g.slot.x + dx, 0, g.slot.x + g.slot.width - MIN);
        width = g.slot.x + g.slot.width - nx;
        x = nx;
      }
      if (south) {
        height = clamp(g.slot.height + dy, MIN, 1 - g.slot.y);
      } else if (north) {
        const ny = clamp(g.slot.y + dy, 0, g.slot.y + g.slot.height - MIN);
        height = g.slot.y + g.slot.height - ny;
        y = ny;
      }
      if (event.shiftKey && (east || west) && (north || south)) {
        // Shift keeps the frame's proportions, as in Office
        const scale = Math.max(width / g.slot.width, height / g.slot.height);
        width = g.slot.width * scale;
        height = g.slot.height * scale;
        if (!east) x = g.slot.x + g.slot.width - width;
        if (!south) y = g.slot.y + g.slot.height - height;
      }
    }
    /* Alignment, equal spacing, equal size and measurements — against every
     * other block on the page. Alt drags freely, as in design tools. */
    const others = activeTemplate
      ? activeTemplate.layers
        .filter((layer) => layer.id !== g.baseSlots[g.index].id)
        .map((layer) => layer.box)
      : g.baseSlots.filter((_, index) => index !== g.index);
    const guided = smartGuides(g.slot, { x, y, width, height }, g.mode, {
      aspect: profile.spreadWidthMm / profile.spreadHeightMm,
      heightMm: profile.spreadHeightMm,
      safeMarginMm: profile.safeMarginMm,
      tolerancePx: 7,
      screenHeightPx: g.rect.height,
      others,
      sizeReferences: g.baseSlots.filter((_, index) => index !== g.index),
    }, { snap: !event.altKey, keepRatio: event.shiftKey });
    ({ x, y, width, height } = guided.box);
    if (g.mode === 'move') {
      x = clamp(x, 0, 1 - width);
      y = clamp(y, 0, 1 - height);
    }
    setFrameGuides({ ...guided, box: { x, y, width, height } });
    g.moved = true;
    if (activeTemplate && spread.templateInstance) {
      /* On a Vault page the move is kept as this spread's own change to one
       * photo place; the design itself stays untouched. */
      const placeId = g.baseSlots[g.index].id;
      setProject((current) => ({
        ...current,
        spreads: current.spreads.map((item) => (
          item.id === spread.id && item.templateInstance
            ? {
              ...item,
              templateInstance: {
                ...item.templateInstance,
                places: { ...item.templateInstance.places, [placeId]: { x, y, width, height } },
              },
            }
            : item
        )),
      }));
      return;
    }
    const nextSlots = g.baseSlots.map((s, i) => (i === g.index ? { ...s, x, y, width, height } : s));
    setProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => (
        item.id === spread.id ? { ...item, customSlots: nextSlots } : item
      )),
    }));
  }

  function endFrameGesture() {
    const g = frameGesture.current;
    if (g?.moved) {
      suppressFrameClick.current = true;
      window.setTimeout(() => { suppressFrameClick.current = false; }, 0);
      setHistoryPast((items) => [...items.slice(-49), g.before]);
      setHistoryFuture([]);
      setNotice(g.mode === 'move' ? 'המסגרת הוזזה' : 'גודל המסגרת עודכן');
    }
    setFrameGuides(null);
    frameGesture.current = null;
  }

  /** Wheel over the selected frame zooms its photo, the way every canvas tool does. */
  function zoomSelectedFrame(event: React.WheelEvent<HTMLButtonElement>, slotIndex: number) {
    if (selectedSlotIndex !== slotIndex || !selectedFrameSettings) return;
    if (selectedFrameSettings.fit === 'contain') return;
    event.preventDefault();
    const step = event.deltaY > 0 ? -6 : 6;
    const zoom = Math.max(100, Math.min(250, (selectedFrameSettings.zoom ?? 100) + step));
    if (zoom === (selectedFrameSettings.zoom ?? 100)) return;
    // zooming is a manual decision, so it takes the frame off `smart` too
    setFramePosition({ zoom });
  }

  /** Move to another candidate layout for this spread. Wraps at both ends. */
  /** ↑↓ — the next Vault page for this spread's photos, best fits first. */
  function cycleLayout(direction: 1 | -1, targetIndex = spreadIndex) {
    const target = project.spreads[targetIndex];
    if (!target) return;
    const neighbours = project.spreads
      .filter((_, index) => index !== targetIndex && Math.abs(index - targetIndex) <= 3)
      .map((item) => item.templateInstance?.templateId ?? '');
    const candidates = rankTemplates(
      target.photoIds, photos, profile.spreadWidthMm / profile.spreadHeightMm, neighbours,
    );
    if (!candidates.length) {
      setNotice('אין תמונות בכפולה — הוסיפו תמונות כדי לבחור עמוד מהכספת');
      return;
    }
    const current = candidates.findIndex((item) => item.template.id === target.templateInstance?.templateId);
    const next = current === -1
      ? candidates[0]
      : candidates[(current + direction + candidates.length) % candidates.length];
    commitProject((currentProject) => ({
      ...currentProject,
      activeSpreadId: target.id,
      spreads: currentProject.spreads.map((candidate) => candidate.id === target.id
        ? {
          ...candidate,
          layoutId: next.template.id,
          photoIds: next.photoIds,
          customSlots: undefined,
          frameSettings: {},
          templateInstance: newInstance(next.template),
        }
        : candidate),
    }));
    setSelectedSlotIndex(null);
    setNotice(`${next.template.name} · ${candidates.indexOf(next) + 1} מתוך ${candidates.length}`);
  }
  function toggleSelectedPhotoInSpread() {
    if (!selectedPhotoId) return;

    if (selectedSlotIndex !== null) {
      assignPhoto(selectedSlotIndex);
      return;
    }

    const currentIds = [...layout.photoIds];
    /* A photo taken out leaves its place empty — the page keeps its design. A
     * photo added fills an empty place, or, when the page is full, the spread
     * moves to the Vault page that fits the larger group best. */
    if (currentIds.includes(selectedPhotoId) && activeTemplate) {
      currentIds[currentIds.indexOf(selectedPhotoId)] = '';
      updateSpread({ photoIds: currentIds });
      setNotice('התמונה הוצאה מהעמוד');
      setSelectedPhotoId(null);
      setSelectedSlotIndex(null);
      return;
    }
    if (!currentIds.includes(selectedPhotoId)) {
      const empty = activeTemplate ? currentIds.indexOf('') : -1;
      if (empty >= 0) {
        currentIds[empty] = selectedPhotoId;
        updateSpread({ photoIds: currentIds });
        setNotice('התמונה שובצה בעמוד');
      } else {
        const choice = rankTemplates(
          [...currentIds.filter(Boolean), selectedPhotoId],
          photos,
          profile.spreadWidthMm / profile.spreadHeightMm,
        )[0];
        if (!choice) {
          setNotice('אין בכספת עמוד לכל כך הרבה תמונות בכפולה אחת');
          return;
        }
        updateSpread({
          layoutId: choice.template.id,
          photoIds: choice.photoIds,
          customSlots: undefined,
          frameSettings: {},
          templateInstance: newInstance(choice.template),
        });
        setNotice(`התמונה נוספה · ${choice.template.name}`);
      }
      setSelectedPhotoId(null);
      setSelectedSlotIndex(null);
      return;
    }
    if (currentIds.includes(selectedPhotoId)) {
      updateSpread({
        photoIds: currentIds.filter((id) => id !== selectedPhotoId),
        layoutId: 'balanced',
        frameSettings: {},
        customSlots: undefined,
      });
      setNotice('התמונה הוחזרה למאגר');
    } else {
      updateSpread({
        photoIds: [...currentIds, selectedPhotoId],
        layoutId: 'balanced',
        frameSettings: {},
        customSlots: undefined,
      });
      setNotice('התמונה נוספה והכפולה אורגנה מחדש');
    }
    setSelectedPhotoId(null);
    setSelectedSlotIndex(null);
  }

  function updateFrameSettings(patch: Partial<PhotoFrameSettings>) {
    if (!selectedSlot || !selectedFrameSettings) return;
    updateSpread({
      frameSettings: {
        ...spread.frameSettings,
        [selectedSlot.id]: { ...selectedFrameSettings, ...patch },
      },
    });
  }

  /* Position reads as "locked" in `smart` mode only because smart is the one
   * choosing it. The moment she moves it herself she has taken that decision
   * back, so hand her the crop smart had reached and switch to manual — rather
   * than greying the control out and leaving her with no way to fix the frame. */
  function setFramePosition(patch: Partial<PhotoFrameSettings>) {
    if (!selectedFrameSettings) return;
    if (selectedFrameSettings.fit === 'smart') {
      updateFrameSettings({
        fit: 'cover',
        positionX: selectedCrop?.positionX ?? selectedFrameSettings.positionX,
        positionY: selectedCrop?.positionY ?? selectedFrameSettings.positionY,
        ...patch,
      });
      return;
    }
    updateFrameSettings(patch);
  }

  function setFitMode(fit: PhotoFitMode) {
    updateFrameSettings({ fit });
    setNotice(
      fit === 'smart'
        ? 'מילוי חכם שומר על הפנים והדמות'
        : fit === 'contain'
          ? 'התמונה מוצגת במלואה — אין מה להזיז'
          : 'מילוי מסגרת — גררי במסגרת כדי למקם',
    );
  }

  function removeSelectedFramePhoto() {
    if (selectedSlotIndex === null) return;
    if (activeTemplate) {
      updateSpread({
        photoIds: layout.photoIds.map((id, index) => (index === selectedSlotIndex ? '' : id)),
      });
      setSelectedSlotIndex(null);
      setNotice('התמונה הוצאה מהעמוד · המקום נשאר בעיצוב');
      return;
    }
    updateSpread({
      photoIds: layout.photoIds.filter((_, index) => index !== selectedSlotIndex),
      layoutId: 'balanced',
      frameSettings: {},
      customSlots: undefined,
    });
    setSelectedSlotIndex(null);
    setNotice('התמונה הוחזרה למאגר והכפולה אורגנה מחדש');
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const imported: AlbumPhoto[] = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file, index) => {
        const url = URL.createObjectURL(file);
        const id = `import-${Date.now()}-${index}`;
        void storePhotoBlob(id, file).catch(() => {
          setNotice(`לא ניתן היה לשמור את ${file.name} לשחזור`);
        });
        return {
          id,
          name: file.name,
          url,
          storageKey: id,
          orientation: 'landscape',
          widthPx: 0,
          heightPx: 0,
          analysis: {
            status: 'pending',
            faces: [],
            focalPoint: { x: 0.5, y: 0.5 },
            sharpnessScore: 0,
            qualityScore: 0,
            analyzedBy: 'pending',
          },
        };
      });
    imported.forEach((photo) => {
      const img = new Image();
      img.onload = () => {
        setPhotos((current) => current.map((item) => item.id === photo.id
          ? { ...item, widthPx: img.width, heightPx: img.height, orientation: orientationFor(img.width, img.height) }
          : item));
        analyzeAlbumPhoto(photo.url)
          .then((result) => {
            setPhotos((current) => current.map((item) => item.id === photo.id ? {
              ...item,
              widthPx: result.widthPx,
              heightPx: result.heightPx,
              orientation: orientationFor(result.widthPx, result.heightPx),
              focalPoint: result.focalPoint,
              analysis: { ...result, status: 'ready' },
            } : item));
          })
          .catch(() => {
            setPhotos((current) => current.map((item) => item.id === photo.id ? {
              ...item,
              analysis: {
                ...item.analysis!,
                status: 'failed',
                analyzedBy: 'engine-unavailable',
              },
            } : item));
          });
      };
      img.src = photo.url;
    });
    setPhotos((current) => [...current, ...imported]);
    setNotice(`נוספו ${imported.length} תמונות · הניתוח המקומי התחיל`);
  }

  function createExportItems() {
    return project.spreads.map((item) => {
      const candidates = buildAlbumLayoutCandidates(
        item.photoIds,
        photos,
        profile.closedWidthMm / profile.closedHeightMm,
        project.styleName,
      );
      const generated = candidates.find((candidate) => candidate.id === item.layoutId)
        ?? candidates[0]
        ?? EMPTY_GENERATED_LAYOUT;
      return {
        spread: item,
        layout: item.customSlots?.length === item.photoIds.length ? {
          ...generated,
          id: item.layoutId,
          slots: item.customSlots,
          photoIds: item.photoIds,
        } : generated,
      };
    });
  }

  async function handleExportProof() {
    if (isExporting) return;
    setIsExporting(true);
    setNotice('מכין את קבצי ההגהה…');
    try {
      const result = await exportAlbumProof(
        project,
        createExportItems(),
        photos,
        profile,
        (current, total) => setNotice(`מרנדר כפולה ${current} מתוך ${total}…`),
      );
      setNotice(
        `חבילת ההגהה מוכנה · ${result.files} קבצים · ${result.pixelSize.width}×${result.pixelSize.height}px`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('ייצוא ההגהה בוטל');
      } else {
        setNotice(error instanceof Error ? error.message : 'ייצוא ההגהה נכשל');
      }
    } finally {
      setIsExporting(false);
    }
  }

  async function handlePrintExport() {
    if (isExporting || preflight.total > 0) return;
    setIsExporting(true);
    setNotice('מכין חבילת דפוס…');
    try {
      const result = await exportAlbumForPrint(
        project,
        createExportItems(),
        photos,
        profile,
        (current, total) => setNotice(`מייצא לדפוס כפולה ${current} מתוך ${total}…`),
      );
      setNotice(
        `חבילת הדפוס מוכנה · ${result.files} קבצים · ${result.pixelSize.width}×${result.pixelSize.height}px`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('ייצוא הדפוס בוטל');
      } else {
        setNotice(error instanceof Error ? error.message : 'ייצוא הדפוס נכשל');
      }
    } finally {
      setIsExporting(false);
    }
  }

  /* No album open means the library IS the screen — every overlay below this
   * point assumes a loaded project, so this has to come first. */
  if (!activeAlbumId) {
    return (
      <AlbumLibrary
        albums={albums}
        profiles={printProfiles}
        photos={job ? framesToPool(jobFiles.frames) : photos}
        projectName={job?.client}
        projectScoped={Boolean(job)}
        /* What the couple chose, per album they were sold. Kept in project.json
         * by the gallery — an AlbumPhoto's id and a gallery frameId are both
         * the file name, so this crosses over untranslated. */
        clientAlbums={clientAlbumsOf(job?.id)}
        onBack={onBack}
        onOpen={(id) => { setHistoryPast([]); setHistoryFuture([]); setMode('organize'); setActiveAlbumId(id); }}
        onCreate={createAlbum}
        onRename={(id, name) => {
          renameAlbum(id, name);
          setAlbums(listAlbums(job?.id));
        }}
        onDuplicate={(id) => {
          const source = albums.find((item) => item.id === id);
          if (duplicateAlbum(id, `${source?.name ?? 'אלבום'} — עותק`)) setAlbums(listAlbums(job?.id));
        }}
        onDelete={(id) => {
          deleteAlbum(id).then(() => setAlbums(listAlbums(job?.id)));
        }}
      />
    );
  }

  if (showPreview) {
    return (
      <AlbumPreview
        project={project}
        photos={photos}
        profile={profile}
        onClose={() => setShowPreview(false)}
      />
    );
  }

  if (showReview) {
    return (
      <ReviewWorkspace
        project={project}
        photos={photos}
        profile={profile}
        onUpdate={(next) => commitProject(next)}
        onNewVersion={createReviewVersion}
        onClose={() => setShowReview(false)}
      />
    );
  }

  if (showCover) {
    return (
      <CoverEditor
        project={project}
        photos={photos}
        profile={profile}
        onUpdateProject={(next) => commitProject(next)}
        onUpdateProfile={(next) => updatePrintProfile(next)}
        onClose={() => setShowCover(false)}
      />
    );
  }

  if (showPreflight) {
    return (
      <PreflightPanel
        issues={preflightIssues}
        onNavigate={navigateFromPreflight}
        onClose={() => setShowPreflight(false)}
      />
    );
  }

  return (
    <div className="album-studio">
      <header className={`album-topbar ${mode}`}>
        <div className="album-topbar-identity">
          <button className="album-quiet-button" onClick={() => mode === 'design' ? setMode('organize') : closeAlbum()} title={mode === 'design' ? 'חזרה לאלבום' : 'חזרה לאלבומים'}>
            <IcChevron size={15} style={{ transform: 'rotate(180deg)' }} />
            {mode === 'design' ? 'האלבום' : 'האלבומים'}
          </button>
          <div>
            <h1>{mode === 'design' ? `כפולה ${spreadIndex + 1}` : project.name}</h1>
            <span>{mode === 'design' ? `עמודים ${spread.pageStart}–${spread.pageStart + 1}` : `${project.spreads.length} כפולות · ${usedIds.size} תמונות`}</span>
          </div>
          <span className="album-save-copy"><IcCheck size={11} /> {notice}</span>
        </div>

        <div className="album-topbar-actions">
          {(preflight.blockers > 0 || preflight.warnings > 0) && (
            <button className={`album-preflight-alert${preflight.blockers ? ' blocker' : ''}`} onClick={() => setShowPreflight(true)}>
              {preflight.blockers ? `${preflight.blockers} בעיות מונעות ייצוא` : `${preflight.warnings} אזהרות`}
            </button>
          )}
          {mode === 'design' && (
            <div className="album-designer-nav">
              <button className="album-icon-button" onClick={() => setActiveSpread(spreadIndex - 1)} disabled={spreadIndex === 0} aria-label="כפולה קודמת">‹</button>
              <span>{spreadIndex + 1} / {project.spreads.length}</span>
              <button className="album-icon-button" onClick={() => setActiveSpread(spreadIndex + 1)} disabled={spreadIndex === project.spreads.length - 1} aria-label="כפולה הבאה">›</button>
            </div>
          )}
          <button className="album-icon-button" aria-label="ביטול" title="ביטול · Ctrl+Z" onClick={undoProject} disabled={!historyPast.length}><IcUndo size={18} /></button>
          <button className="album-icon-button" aria-label="ביצוע חוזר" title="ביצוע חוזר · Ctrl+Shift+Z" onClick={redoProject} disabled={!historyFuture.length}><IcUndo size={18} style={{ transform: 'scaleX(-1)' }} /></button>
          <button className="album-quiet-button" onClick={() => autoBuildAlbum()} title="פריסת כל תמונות האלבום על עמודי הכספת"><IcSparkle size={16} /> בנייה אוטומטית</button>
          <button className="album-quiet-button" onClick={() => setShowPreview(true)}><IcEye size={16} /> תצוגה</button>
          <div className="album-more-wrap">
            <button className="album-icon-button" aria-label="פעולות נוספות" aria-expanded={showMoreMenu} onClick={() => setShowMoreMenu((value) => !value)}>•••</button>
            {showMoreMenu && (
              <div className="album-context-menu album-topbar-menu" role="menu">
                {mode === 'design' && <button role="menuitem" onClick={() => { setShowGuides((value) => !value); setShowMoreMenu(false); }}>{showGuides ? 'הסתר אזורי דפוס' : 'הצג אזורי דפוס'} · G</button>}
                <button role="menuitem" onClick={() => { openAlbumSettings(); setShowMoreMenu(false); }}>הגדרות אלבום</button>
                <button role="menuitem" onClick={() => { setShowCover(true); setShowMoreMenu(false); }}>כריכה ושדרה</button>
                <button role="menuitem" onClick={() => { setShowPreflight(true); setShowMoreMenu(false); }}>בדיקת דפוס</button>
              </div>
            )}
          </div>
          {mode === 'organize' && <button className="album-primary-button" onClick={() => setShowDelivery(true)}><IcDownload size={16} /> הגהה ומסירה</button>}
        </div>
      </header>

      <div className={`album-workspace ${mode}`}>
        {showAlbumSettings && (
        <div className="album-settings-backdrop">
        <aside className="album-settings-panel">
          <div className="album-panel-title">
            <IcBook size={18} />
            <span>הגדרות אלבום</span>
            <button className="album-settings-close" onClick={() => setShowAlbumSettings(false)} aria-label="סגירה">×</button>
          </div>

          <label className="album-field-label">סוג אלבום</label>
          <select className="album-select" value="layflat" disabled>
            <option value="layflat">בת מצווה — Layflat</option>
          </select>

          <div className="album-field-label">גודל סגור</div>
          <div className="album-dimension-editor">
            <label>
              <span>רוחב בס״מ</span>
              <input
                type="number"
                min="10"
                max="100"
                step="0.5"
                value={settingsWidthCm}
                onChange={(event) => setSettingsWidthCm(Number(event.target.value))}
              />
            </label>
            <span aria-hidden="true">×</span>
            <label>
              <span>גובה בס״מ</span>
              <input
                type="number"
                min="10"
                max="100"
                step="0.5"
                value={settingsHeightCm}
                onChange={(event) => setSettingsHeightCm(Number(event.target.value))}
              />
            </label>
          </div>
          <button className="album-apply-dimensions" onClick={() => applyAlbumDimensions()}>
            החלת המידה
          </button>
          <div className="album-dimension-shortcuts-label">מידות שמורות</div>
          <div className="album-size-options">
            {printProfiles.map((item) => (
              <button
                key={item.id}
                className={item.id === profile.id ? 'on' : ''}
                onClick={() => {
                  const width = item.closedWidthMm / 10;
                  const height = item.closedHeightMm / 10;
                  setSettingsWidthCm(width);
                  setSettingsHeightCm(height);
                  applyAlbumDimensions(width, height);
                }}
              >
                {item.closedWidthMm / 10}×{item.closedHeightMm / 10} ס״מ
                <small>{item.closedWidthMm === item.closedHeightMm ? 'מרובע' : item.closedWidthMm > item.closedHeightMm ? 'רוחב' : 'אורך'}</small>
              </button>
            ))}
          </div>

          <label className="album-field-label">סגנון</label>
          <select className="album-select" value={project.styleName} onChange={(event) => applyAlbumStyle(event.target.value)}>
            {ALBUM_STYLES.map((albumStyle) => (
              <option key={albumStyle.id} value={albumStyle.id}>{albumStyle.label}</option>
            ))}
          </select>
          <small className="album-style-help">
            {ALBUM_STYLES.find((albumStyle) => albumStyle.id === project.styleName)?.description}
            {' · '}שינוי סגנון מסדר מחדש כפולות שאינן נעולות
          </small>

          <div className="album-field-label">רקע הכפולה</div>
          <div className="album-palette">
            {['#f8f6f1', '#f4efe7', '#e9e2d8', '#c9bfb2', '#222326'].map((color) => (
              <button
                key={color}
                className={spreadPaper === color ? 'on' : ''}
                style={{ background: color }}
                /* On a Vault page the background is one of the page's own colours —
                 * writing the legacy field there would change nothing on screen. */
                onClick={() => (activeTemplate && spread.templateInstance
                  ? updateSpread({
                    templateInstance: {
                      ...spread.templateInstance,
                      colors: { ...spread.templateInstance.colors, [activeTemplate.backgroundToken]: color },
                    },
                  })
                  : updateSpread({ background: color }))}
                aria-label={`רקע ${color}`}
              />
            ))}
          </div>

          <div className="album-panel-divider" />
          <div className="album-field-label">תצוגת ייצור</div>
          <label className="album-check">
            <input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} />
            <span>גלישה, חיתוך ואזור בטוח</span>
          </label>
          <label className="album-check">
            <input type="checkbox" checked readOnly />
            <span>סימון מרכז הכפולה</span>
          </label>

          <div className="album-profile-note">
            <strong>{profile.name}</strong>
            <span>{profile.labName}</span>
            <span>{profile.targetPpi} PPI · {profile.outputFormat.toUpperCase()}</span>
            <span className={profile.verified ? 'profile-verified' : 'profile-draft'}>
              {profile.verified ? `מאומת · ${profile.profileVersion}` : 'טיוטה · יצוא דפוס חסום'}
            </span>
            <button onClick={() => setShowProfileEditor((value) => !value)}>
              {showProfileEditor ? 'סגירת הגדרות' : 'הגדרת בית דפוס'}
            </button>
          </div>
          {showProfileEditor && (
            <div className="album-profile-editor">
              <label>
                <span>שם בית הדפוס</span>
                <input
                  value={profile.labName}
                  onChange={(event) => updatePrintProfile({
                    labName: event.target.value,
                    verified: false,
                  })}
                />
              </label>
              <label>
                <span>גרסת המפרט</span>
                <input
                  value={profile.profileVersion}
                  onChange={(event) => updatePrintProfile({
                    profileVersion: event.target.value,
                    verified: false,
                  })}
                />
              </label>
              <div className="profile-grid">
                <label>
                  <span>רוחב כפולה במ״מ</span>
                  <input
                    type="number"
                    min="100"
                    max="2000"
                    value={profile.spreadWidthMm}
                    onChange={(event) => updatePrintProfile({
                      spreadWidthMm: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
                <label>
                  <span>גובה כפולה במ״מ</span>
                  <input
                    type="number"
                    min="100"
                    max="1000"
                    value={profile.spreadHeightMm}
                    onChange={(event) => updatePrintProfile({
                      spreadHeightMm: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
                <label>
                  <span>גלישה במ״מ</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={profile.bleedMm}
                    onChange={(event) => updatePrintProfile({
                      bleedMm: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
                <label>
                  <span>PPI</span>
                  <input
                    type="number"
                    min="150"
                    max="600"
                    value={profile.targetPpi}
                    onChange={(event) => updatePrintProfile({
                      targetPpi: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
              </div>
              <label>
                <span>פרופיל צבע</span>
                <select
                  value={profile.colorProfile}
                  onChange={(event) => updatePrintProfile({
                    colorProfile: event.target.value,
                    verified: false,
                  })}
                >
                  <option>ייקבע מול בית הדפוס</option>
                  <option>sRGB</option>
                  <option>Adobe RGB</option>
                  <option>ICC מותאם</option>
                </select>
              </label>
              <label>
                <span>תבנית שמות</span>
                <input
                  value={profile.namingPattern}
                  onChange={(event) => updatePrintProfile({
                    namingPattern: event.target.value,
                    verified: false,
                  })}
                />
              </label>
              <label className="profile-verify-check">
                <input
                  type="checkbox"
                  checked={profile.verified}
                  disabled={
                    !profile.labName.trim()
                    || !profile.profileVersion.trim()
                    || profile.colorProfile !== 'sRGB'
                    || !profile.namingPattern.includes('{index}')
                  }
                  onChange={(event) => updatePrintProfile({ verified: event.target.checked })}
                />
                <span>בדקתי את הנתונים מול מפרט כתוב של בית הדפוס</span>
              </label>
              {profile.colorProfile !== 'sRGB' && (
                <div className="profile-blocker">
                  יצוא דפוס פעיל כרגע רק ל־sRGB. פרופיל אחר דורש קובץ ICC.
                </div>
              )}
            </div>
          )}
        </aside>
        </div>
        )}

        {mode === 'organize' ? (
          <AlbumOverview
            project={project}
            photos={photos}
            profile={profile}
            issues={preflightIssues}
            timelineOpen={timelineOpen}
            initialScrollTop={overviewScrollTop}
            onTimelineOpen={setTimelineOpen}
            onScrollTop={setOverviewScrollTop}
            onSelectSpread={setActiveSpread}
            onOpenSpread={(index) => {
              setActiveSpread(index);
              setMode('design');
            }}
            onReorderSpreads={reorderSpread}
            onChangeGroups={changeAlbumGroups}
            onCycleLayout={(index, direction) => cycleLayout(direction, index)}
            onAddSpread={addSpread}
            onRemoveSpread={removeSpreadAt}
            onAddPhotos={() => setShowPhotoPicker(true)}
          />
        ) : (
          <>
        <main className="album-center">
          <div
            className="album-canvas-area"
            onClick={(event) => {
              if (event.target === event.currentTarget) { setSelectedSlotIndex(null); setCropIndex(null); setSelectedElementId(null); }
            }}
          >
            {selectedSlot && selectedFrameSettings && (
              <ContextToolbar
                name="תמונה"
                onDone={() => { setSelectedSlotIndex(null); setCropIndex(null); setSelectedPhotoId(null); }}
                tools={[
                  {
                    id: 'crop', label: 'חיתוך ומיקום', icon: ToolIcons.crop,
                    content: (
                      <div className="ctx-stack">
                        <span className="ctx-label">התאמה למקום</span>
              <div className="album-fit-options">
                <button className={selectedFrameSettings.fit === 'smart' ? 'on' : ''} onClick={() => setFitMode('smart')}>חכם</button>
                <button className={selectedFrameSettings.fit === 'cover' ? 'on' : ''} onClick={() => setFitMode('cover')}>מילוי</button>
                <button className={selectedFrameSettings.fit === 'contain' ? 'on' : ''} onClick={() => setFitMode('contain')}>מלא</button>
              </div>
            <label className="album-inspector-section album-zoom-control">
              <span>זום <output>{selectedFrameSettings.zoom ?? 100}%</output></span>
              <input type="range" min="100" max="250" value={selectedFrameSettings.zoom ?? 100} disabled={selectedFrameSettings.fit === 'contain'} onChange={(event) => updateFrameSettings({ zoom: Number(event.target.value) })} />
            </label>
            {selectedCrop?.warnings[0] && <span className="album-crop-state warning">{selectedCrop.warnings[0]}</span>}
              <label className="tpl-fade-slider">
                <span>שמאל ← → ימין <output>{Math.round(selectedCrop?.positionX ?? selectedFrameSettings.positionX)}%</output></span>
                <input
                  type="range" min="0" max="100" step="0.5"
                  value={selectedCrop?.positionX ?? selectedFrameSettings.positionX}
                  disabled={selectedFrameSettings.fit === 'contain'}
                  onChange={(event) => setFramePosition({ positionX: Number(event.target.value) })}
                />
              </label>
              <label className="tpl-fade-slider">
                <span>למעלה ↕ למטה <output>{Math.round(selectedCrop?.positionY ?? selectedFrameSettings.positionY)}%</output></span>
                <input
                  type="range" min="0" max="100" step="0.5"
                  value={selectedCrop?.positionY ?? selectedFrameSettings.positionY}
                  disabled={selectedFrameSettings.fit === 'contain'}
                  onChange={(event) => setFramePosition({ positionY: Number(event.target.value) })}
                />
              </label>
              <button
                className={`tpl-pan-toggle ${cropIndex === selectedSlotIndex ? 'on' : ''}`}
                disabled={!selectedFramePhoto || selectedFrameSettings.fit === 'contain'}
                onClick={() => {
                  if (cropIndex === selectedSlotIndex) { setCropIndex(null); return; }
                  setCropIndex(selectedSlotIndex);
                  setNotice('גרור את התמונה בתוך המקום · גלגלת לזום · Esc לסיום');
                }}
              >
                {cropIndex === selectedSlotIndex ? '✓ סיום גרירת התמונה' : '✥ גרירת התמונה בתוך המקום'}
              </button>
              <small className="album-control-hint">
                {selectedFrameSettings.fit === 'contain'
                  ? 'במצב "מלא" רואים את כל התמונה, ואין מה להזיז — בחר "חכם" או "מילוי"'
                  : 'אם התמונה לא זזה לכיוון מסוים, היא כבר ממלאת אותו — הגדל זום כדי לפנות מקום'}
              </small>
                      </div>
                    ),
                  },
                  ...(!activeTemplate ? [{
                    id: 'geometry', label: 'מיקום וגודל', icon: ToolIcons.position,
                    content: (
                      <div className="ctx-stack">
            <div className="album-inspector-section">
              <span>מיקום וגודל <small>אחוזים מהכפולה</small></span>
              <div className="album-frame-metrics">
                <label><span>X</span><input type="number" min="0" max="100" step="0.1" value={(selectedSlot.x * 100).toFixed(1)} onChange={(event) => updateSelectedSlot({ x: Math.max(0, Math.min(1 - selectedSlot.width, Number(event.target.value) / 100)) })} /></label>
                <label><span>Y</span><input type="number" min="0" max="100" step="0.1" value={(selectedSlot.y * 100).toFixed(1)} onChange={(event) => updateSelectedSlot({ y: Math.max(0, Math.min(1 - selectedSlot.height, Number(event.target.value) / 100)) })} /></label>
                <label><span>רוחב</span><input type="number" min="6" max="100" step="0.1" value={(selectedSlot.width * 100).toFixed(1)} onChange={(event) => updateSelectedSlot({ width: Math.max(0.06, Math.min(1 - selectedSlot.x, Number(event.target.value) / 100)) })} /></label>
                <label><span>גובה</span><input type="number" min="6" max="100" step="0.1" value={(selectedSlot.height * 100).toFixed(1)} onChange={(event) => updateSelectedSlot({ height: Math.max(0.06, Math.min(1 - selectedSlot.y, Number(event.target.value) / 100)) })} /></label>
              </div>
              <small className="album-size-status">
                {layout.slots.filter((slot) => Math.abs(slot.width - selectedSlot.width) < 0.001).length} באותו רוחב · {' '}
                {layout.slots.filter((slot) => Math.abs(slot.height - selectedSlot.height) < 0.001).length} באותו גובה
              </small>
            </div>
            <div className="album-inspector-section">
              <span>יישור וריווח <small>המסגרת המסומנת היא הייחוס</small></span>
              <div className="album-arrange-options">
                <button onClick={() => arrangeFrames('left')}>יישור שמאל</button>
                <button onClick={() => arrangeFrames('center-x')}>מרכז אופקי</button>
                <button onClick={() => arrangeFrames('right')}>יישור ימין</button>
                <button onClick={() => arrangeFrames('top')}>יישור עליון</button>
                <button onClick={() => arrangeFrames('center-y')}>מרכז אנכי</button>
                <button onClick={() => arrangeFrames('bottom')}>יישור תחתון</button>
                <button onClick={() => arrangeFrames('width')}>רוחב אחיד</button>
                <button onClick={() => arrangeFrames('height')}>גובה אחיד</button>
                <button className="wide" onClick={() => arrangeFrames('size')}>גודל זהה</button>
                <button disabled={layout.slots.length < 3} onClick={() => arrangeFrames('horizontal-gap')}>רווח אופקי</button>
                <button disabled={layout.slots.length < 3} onClick={() => arrangeFrames('vertical-gap')}>רווח אנכי</button>
              </div>
            </div>
                      </div>
                    ),
                  }] : []),
                  ...(activeTemplate && spread.templateInstance && selectedSlotIndex !== null && templatePhotoLayers[selectedSlotIndex] ? (() => {
              const placeId = templatePhotoLayers[selectedSlotIndex].id;
              const designed = findTemplate(spread.templateInstance.templateId)?.layers
                .find((layer) => layer.id === placeId);
              const fade = spread.templateInstance.fades?.[placeId]
                ?? designFade(designed?.type === 'photo' ? designed : undefined);
              const setFade = (patch: Partial<PhotoFade>, done = false) => {
                editTemplateInstance((instance) => ({
                  ...instance,
                  fades: { ...instance.fades, [placeId]: { ...fade, ...patch } },
                }));
                if (done) endTemplateEdit();
              };
                    return [{
                      id: 'fade', label: 'מעבר ושקיפות', icon: ToolIcons.fade,
                      content: (
                        <div className="ctx-stack tpl-fade">
                  <div className="tpl-fade-sides" role="group" aria-label="צד המעבר">
                    {([['none', 'ללא'], ['right', 'ימין'], ['left', 'שמאל'], ['top', 'למעלה'], ['bottom', 'למטה']] as const)
                      .map(([side, label]) => (
                        <button key={side} className={fade.side === side ? 'on' : ''} onClick={() => setFade({ side }, true)}>{label}</button>
                      ))}
                  </div>
                  {fade.side !== 'none' && (
                    <div className="tpl-fade-modes" role="group" aria-label="סוג המעבר">
                      <button className={fade.mode === 'background' ? 'on' : ''} onClick={() => setFade({ mode: 'background' }, true)}>נמוג אל הרקע</button>
                      <button className={fade.mode === 'blend' ? 'on' : ''} onClick={() => setFade({ mode: 'blend' }, true)}>מתמזג לתמונה הסמוכה</button>
                    </div>
                  )}
                  {fade.side !== 'none' && (
                    <label className="tpl-fade-slider">
                      <span>רכות <output>{fade.softness}</output></span>
                      <input
                        type="range" min="0" max="100" value={fade.softness}
                        onChange={(event) => setFade({ softness: Number(event.target.value) })}
                        onPointerUp={endTemplateEdit} onKeyUp={endTemplateEdit} onBlur={endTemplateEdit}
                      />
                    </label>
                  )}
                  <label className="tpl-fade-slider">
                    <span>שקיפות <output>{fade.transparency}%</output></span>
                    <input
                      type="range" min="0" max="90" value={fade.transparency}
                      onChange={(event) => setFade({ transparency: Number(event.target.value) })}
                      onPointerUp={endTemplateEdit} onKeyUp={endTemplateEdit} onBlur={endTemplateEdit}
                    />
                  </label>
                        </div>
                      ),
                    }];
                  })() : []),
                  ...(selectedPlace && spread.templateInstance ? (() => {
              const style = spread.templateInstance.styles?.[selectedPlace.id] ?? {};
              const mm = (fraction: number | undefined) => Math.round((fraction ?? 0) * profile.spreadHeightMm * 10) / 10;
              const fromMm = (value: number) => value / profile.spreadHeightMm;
              const rotation = Math.round(selectedPlace.rotation ?? 0);
              const live = { onPointerUp: endTemplateEdit, onKeyUp: endTemplateEdit, onBlur: endTemplateEdit };
                    return [
                      {
                        id: 'rotate', label: 'סיבוב והיפוך', icon: ToolIcons.rotate,
                        content: (
                          <div className="ctx-stack tpl-tools">
                  <label className="tpl-fade-slider">
                    <span>סיבוב <output>{rotation}°</output></span>
                    <input type="range" min="-180" max="180" value={rotation} onChange={(event) => setPlaceStyle({ rotation: Number(event.target.value) }, false)} {...live} />
                  </label>
                  <div className="tpl-tool-row">
                    <button onClick={() => setPlaceStyle({ rotation: ((rotation - 90 + 540) % 360) - 180 })} title="סיבוב 90° נגד כיוון השעון">↺ 90°</button>
                    <button onClick={() => setPlaceStyle({ rotation: ((rotation + 90 + 540) % 360) - 180 })} title="סיבוב 90° עם כיוון השעון">↻ 90°</button>
                    <button onClick={() => setPlaceStyle({ rotation: 0 })}>ישר</button>
                  </div>
                  <div className="tpl-tool-row">
                    <button className={style.flipX ? 'on' : ''} onClick={() => setPlaceStyle({ flipX: !style.flipX })}>⇋ היפוך אופקי</button>
                    <button className={style.flipY ? 'on' : ''} onClick={() => setPlaceStyle({ flipY: !style.flipY })}>⇅ היפוך אנכי</button>
                  </div>
                          </div>
                        ),
                      },
                      {
                        id: 'frame', label: 'פינות, מסגרת וצל', icon: ToolIcons.frame,
                        content: (
                          <div className="ctx-stack tpl-tools">
                  <label className="tpl-fade-slider">
                    <span>פינות מעוגלות <output>{mm(style.radius)} מ״מ</output></span>
                    <input type="range" min="0" max="60" step="0.5" value={mm(style.radius)} onChange={(event) => setPlaceStyle({ radius: fromMm(Number(event.target.value)) }, false)} {...live} />
                  </label>
                  <label className="tpl-fade-slider">
                    <span>מסגרת <output>{mm(style.border)} מ״מ</output></span>
                    <input type="range" min="0" max="15" step="0.5" value={mm(style.border)} onChange={(event) => setPlaceStyle({ border: fromMm(Number(event.target.value)) }, false)} {...live} />
                  </label>
                  {(style.border ?? 0) > 0 && (
                    <label className="tpl-tool-color">
                      <span>צבע המסגרת</span>
                      <input type="color" value={style.borderColor ?? '#ffffff'} onChange={(event) => setPlaceStyle({ borderColor: event.target.value }, false)} onBlur={endTemplateEdit} />
                    </label>
                  )}
                  <label className="tpl-fade-slider">
                    <span>צל <output>{style.shadow ?? 0}</output></span>
                    <input type="range" min="0" max="100" value={style.shadow ?? 0} onChange={(event) => setPlaceStyle({ shadow: Number(event.target.value) }, false)} {...live} />
                  </label>
                          </div>
                        ),
                      },
                      {
                        id: 'order', label: 'סדר', icon: ToolIcons.layers,
                        content: (
                          <div className="ctx-stack tpl-tools">
                            <span className="ctx-label">מה מעל מה</span>
                  <div className="tpl-tool-row">
                    <button onClick={() => orderPlace('front')}>לחזית</button>
                    <button onClick={() => orderPlace('forward')}>קדימה</button>
                    <button onClick={() => orderPlace('backward')}>אחורה</button>
                    <button onClick={() => orderPlace('back')}>לרקע</button>
                  </div>
                          </div>
                        ),
                      },
                    ];
                  })() : []),
                ]}
                actions={[
                  { id: 'unplace', label: 'הוצאת התמונה מהמקום', icon: ToolIcons.unplace, onClick: removeSelectedFramePhoto },
                  ...(selectedPlace ? [
                    { id: 'duplicate', label: 'שכפול המקום', icon: ToolIcons.duplicate, onClick: duplicateSelectedPlace },
                    { id: 'delete', label: 'מחיקת המקום מהכפולה', icon: ToolIcons.trash, onClick: deleteSelectedPlace, danger: true },
                  ] : []),
                ]}
              />
            )}
            {selectedElement && (
              <ContextToolbar
                name={selectedElement.type === 'text' ? 'טקסט' : 'אלמנט'}
                onDone={() => setSelectedElementId(null)}
                tools={[
                  ...(selectedElement.type === 'text' ? [{
                    id: 'text', label: 'טקסט וגופן', icon: ToolIcons.text,
                    content: (
                      <div className="ctx-stack tpl-tools">
              {selectedElement.type === 'text' && (
                <>
                  <label className="tpl-texts">
                    <span>טקסט</span>
                    <textarea
                      dir="auto"
                      rows={2}
                      value={selectedElement.defaultText}
                      onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, defaultText: event.target.value }), false)}
                      onBlur={endTemplateEdit}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </label>
                  <label className="tpl-texts">
                    <span>גופן</span>
                    <select
                      value={familyOf(selectedElement.fontFamily)}
                      style={{ fontFamily: selectedElement.fontFamily }}
                      onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, fontFamily: fontStack(event.target.value) }))}
                    >
                      {(['mine', 'hebrew', 'script', 'latin'] as const).map((group) => {
                        const fonts = group === 'mine' ? userFonts : FONT_CATALOG.filter((font) => font.group === group);
                        if (!fonts.length) return null;
                        return (
                          <optgroup key={group} label={FONT_GROUP_LABELS[group]}>
                            {fonts.map((font) => (
                              <option key={font.family} value={font.family} style={{ fontFamily: `'${font.family}'` }}>{font.label}</option>
                            ))}
                          </optgroup>
                        );
                      })}
                      {![...FONT_CATALOG, ...userFonts].some((font) => font.family === familyOf(selectedElement.fontFamily)) && (
                        <option value={familyOf(selectedElement.fontFamily)}>{familyOf(selectedElement.fontFamily)}</option>
                      )}
                    </select>
                  </label>
                  <label className="tpl-fade-slider">
                    <span>גודל <output>{Math.round(selectedElement.fontSize * profile.spreadHeightMm * 2.835)} pt</output></span>
                    <input
                      type="range" min="0.01" max="0.25" step="0.002" value={selectedElement.fontSize}
                      onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, fontSize: Number(event.target.value) }), false)}
                      onPointerUp={endTemplateEdit} onKeyUp={endTemplateEdit}
                    />
                  </label>
                  <div className="tpl-tool-row">
                    {([['start', 'ימין'], ['center', 'מרכז'], ['end', 'שמאל']] as const).map(([align, label]) => (
                      <button key={align} className={selectedElement.align === align ? 'on' : ''} onClick={() => updateElement(selectedElement.id, (layer) => ({ ...layer, align }))}>{label}</button>
                    ))}
                    <button className={selectedElement.fontWeight >= 700 ? 'on' : ''} onClick={() => updateElement(selectedElement.id, (layer) => (layer.type === 'text' ? { ...layer, fontWeight: layer.fontWeight >= 700 ? 400 : 700 } : layer))}>מודגש</button>
                  </div>
                </>
              )}
                      </div>
                    ),
                  }] : []),
                  ...(selectedElement.type !== 'image' ? [{
                    id: 'color', label: 'צבע', icon: ToolIcons.color,
                    content: (
                      <div className="ctx-stack tpl-tools">
              {(
                <label className="tpl-tool-color">
                  <span>צבע</span>
                  <input
                    type="color"
                    value={selectedElement.type === 'text'
                      ? selectedElement.color ?? '#ffffff'
                      : selectedElement.fillColor ?? selectedElement.strokeColor ?? '#ffffff'}
                    onChange={(event) => updateElement(selectedElement.id, (layer) => {
                      const color = event.target.value;
                      if (layer.type === 'text') return { ...layer, color };
                      if (layer.type === 'shape') {
                        return { ...layer, fillColor: layer.fillColor ? color : undefined, strokeColor: layer.fillColor ? layer.strokeColor : color };
                      }
                      return layer;
                    }, false)}
                    onBlur={endTemplateEdit}
                  />
                </label>
              )}
              {selectedElement.type === 'shape' && selectedElement.shape !== 'path' && (
                <>
                  <label className="tpl-fade-slider">
                    <span>עובי קו <output>{Math.round((selectedElement.strokeWidth ?? 0) * profile.spreadHeightMm * 10) / 10} מ״מ</output></span>
                    <input
                      type="range" min="0" max="0.04" step="0.0005" value={selectedElement.strokeWidth ?? 0}
                      onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, strokeWidth: Number(event.target.value) }), false)}
                      onPointerUp={endTemplateEdit} onKeyUp={endTemplateEdit}
                    />
                  </label>
                  {selectedElement.shape !== 'polyline' && (
                    <label className="tpl-tool-color">
                      <span>מילוי</span>
                      <span className="tpl-tool-row">
                        <input
                          type="color"
                          value={selectedElement.fillColor ?? '#ffffff'}
                          onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, fillColor: event.target.value }), false)}
                          onBlur={endTemplateEdit}
                        />
                        <button onClick={() => updateElement(selectedElement.id, (layer) => (layer.type === 'shape' ? { ...layer, fillColor: undefined } : layer))}>ללא</button>
                      </span>
                    </label>
                  )}
                </>
              )}
                      </div>
                    ),
                  }] : []),
                  {
                    id: 'opacity', label: 'שקיפות', icon: ToolIcons.opacity,
                    content: <div className="ctx-stack tpl-tools">
              <label className="tpl-fade-slider">
                <span>שקיפות <output>{Math.round((1 - (selectedElement.opacity ?? 1)) * 100)}%</output></span>
                <input
                  type="range" min="0" max="90" value={Math.round((1 - (selectedElement.opacity ?? 1)) * 100)}
                  onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, opacity: 1 - Number(event.target.value) / 100 }), false)}
                  onPointerUp={endTemplateEdit} onKeyUp={endTemplateEdit}
                />
              </label>
                    </div>,
                  },
                  {
                    id: 'rotate', label: 'סיבוב', icon: ToolIcons.rotate,
                    content: <div className="ctx-stack tpl-tools">
              <label className="tpl-fade-slider">
                <span>סיבוב <output>{Math.round(selectedElement.rotation ?? 0)}°</output></span>
                <input
                  type="range" min="-180" max="180" value={Math.round(selectedElement.rotation ?? 0)}
                  onChange={(event) => updateElement(selectedElement.id, (layer) => ({ ...layer, rotation: Number(event.target.value) }), false)}
                  onPointerUp={endTemplateEdit} onKeyUp={endTemplateEdit}
                />
              </label>
                    </div>,
                  },
                  {
                    id: 'order', label: 'סדר', icon: ToolIcons.layers,
                    content: <div className="ctx-stack tpl-tools">
                      <span className="ctx-label">מה מעל מה</span>
              <div className="tpl-tool-row">
                {([['front', 'לחזית'], ['forward', 'קדימה'], ['backward', 'אחורה'], ['back', 'לרקע']] as const).map(([to, label]) => (
                  <button key={to} onClick={() => activeTemplate && updateElement(selectedElement.id, (layer) => ({ ...layer, zIndex: reorderZ(activeTemplate.layers, layer.id, to) }))}>{label}</button>
                ))}
              </div>
                    </div>,
                  },
                ]}
                actions={[
                  { id: 'duplicate', label: 'שכפול', icon: ToolIcons.duplicate, onClick: duplicateSelectedElement },
                  { id: 'delete', label: 'מחיקה', icon: ToolIcons.trash, onClick: deleteSelectedElement, danger: true },
                ]}
              />
            )}
            <div
              className={`album-spread ${showGuides ? 'show-guides' : ''} ${activeTemplate ? 'tpl-mode' : ''}`}
              style={{
                background: spreadPaper,
                aspectRatio: `${profile.spreadWidthMm} / ${profile.spreadHeightMm}`,
                '--spread-aspect': profile.spreadWidthMm / profile.spreadHeightMm,
              } as React.CSSProperties}
            >
              <div className="album-page album-page-left" />
              <div className="album-page album-page-right" />
              <div className="album-gutter" />
              {showGuides && <><div className="album-bleed-guide" /><div className="album-safe-guide" /></>}
              {frameGuides && <SmartGuideOverlay guides={frameGuides} />}

              {activeTemplate && spread.templateInstance && (
                <TemplateDecor template={activeTemplate} instance={spread.templateInstance} />
              )}
              {layout.slots.map((slot, slotIndex) => {
                const photoId = layout.photoIds[slotIndex];
                const photo = photos.find((item) => item.id === photoId);
                const frameSettings = spread.frameSettings?.[slot.id] ?? {
                  ...DEFAULT_FRAME_SETTINGS,
                  positionX: (photo?.focalPoint?.x ?? 0.5) * 100,
                  positionY: (photo?.focalPoint?.y ?? 0.5) * 100,
                };
                const crop = photo
                  ? assessCrop(
                    photo,
                    slot,
                    frameSettings,
                    profile.spreadWidthMm / profile.spreadHeightMm,
                  )
                  : null;
                return (
                  <button
                    key={slot.id}
                    className={`album-frame ${slot.role === 'hero' ? 'hero' : ''} ${selectedPhotoId ? 'assignable' : ''} ${selectedSlotIndex === slotIndex ? 'selected' : ''} ${cropIndex === slotIndex ? 'cropping' : ''} ${crop?.letterboxed ? 'letterboxed' : ''} ${activeTemplate ? 'tpl-frame' : ''}`}
                    style={{
                      left: `${slot.x * 100}%`,
                      top: `${slot.y * 100}%`,
                      width: `${slot.width * 100}%`,
                      height: `${slot.height * 100}%`,
                      /* Showing the whole photo is a choice, so what is left over
                       * has to read as the page it sits on — not as a white bar
                       * that looks like the frame failed to fill. */
                      ...(crop?.letterboxed ? { background: spreadPaper } : null),
                      ...(activeTemplate ? {
                        zIndex: templateZOrder.get(templatePhotoLayers[slotIndex].id),
                        ...photoFrameStyle(templatePhotoLayers[slotIndex], profile.spreadWidthMm / profile.spreadHeightMm),
                      } : null),
                    }}
                    onClick={() => assignPhoto(slotIndex)}
                    onDoubleClick={() => {
                      if (!photo) return;
                      setSelectedSlotIndex(slotIndex);
                      setCropIndex(slotIndex);
                      setNotice('גרור למקם את התמונה · גלגלת לזום · לחיצה מחוץ למסגרת לסיום');
                    }}
                    draggable={Boolean(photo) && selectedSlotIndex !== slotIndex}
                    onDragStart={(event) => {
                      if (photo) beginPhotoDrag(event, photo.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => dropPhotoOnFrame(event, slotIndex)}
                    onWheel={(event) => {
                      if (cropIndex === slotIndex) zoomSelectedFrame(event, slotIndex);
                    }}
                    onPointerDown={(event) => {
                      if (cropIndex === slotIndex && photo) beginPan(event, slotIndex, frameSettings);
                      else if (selectedSlotIndex === slotIndex) beginFrameGesture(event, slotIndex, 'move');
                    }}
                    onPointerMove={(event) => {
                      if (cropIndex === slotIndex) movePan(event, slot.id);
                      else moveFrameGesture(event);
                    }}
                    onPointerUp={() => { if (cropIndex === slotIndex) endPan(); else endFrameGesture(); }}
                    onPointerCancel={() => { if (cropIndex === slotIndex) endPan(); else endFrameGesture(); }}
                    aria-label={photo ? `מסגרת עם ${photo.name}` : 'מסגרת ריקה'}
                  >
                    {photo ? (
                      <img
                        src={photo.url}
                        alt={photo.name}
                        style={{
                          objectFit: crop?.fit,
                          objectPosition: `${crop?.positionX ?? 50}% ${crop?.positionY ?? 50}%`,
                          transform: `scale(${(crop?.fit === 'contain' ? 1 : (frameSettings.zoom ?? 100) / 100) * (templatePhotoLayers[slotIndex]?.flipX ? -1 : 1)}, ${(crop?.fit === 'contain' ? 1 : (frameSettings.zoom ?? 100) / 100) * (templatePhotoLayers[slotIndex]?.flipY ? -1 : 1)})`,
                          transformOrigin: `${crop?.positionX ?? 50}% ${crop?.positionY ?? 50}%`,
                        }}
                      />
                    ) : (
                      <span className="album-empty-frame"><IcGallery size={22} />בחר תמונה</span>
                    )}
                    {selectedSlotIndex === slotIndex && cropIndex !== slotIndex && (
                      <>
                        {!activeTemplate && (
                        <span className="album-frame-bar" onPointerDown={(e) => e.stopPropagation()}>
                          <span
                            role="button"
                            tabIndex={0}
                            className="album-frame-z"
                            title="שלח לאחור"
                            onClick={(e) => { e.stopPropagation(); reorderFrame('back'); }}
                          >לאחור</span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="album-frame-z"
                            title="הבא לחזית"
                            onClick={(e) => { e.stopPropagation(); reorderFrame('front'); }}
                          >לחזית</span>
                        </span>
                        )}

                      </>
                    )}
                  </button>
                );
              })}

              {activeTemplate && addedElements.map((item) => {
                const layer = activeTemplate.layers.find((candidate) => candidate.id === item.id) as ShapeLayer | TextLayer | ImageLayer | undefined;
                if (!layer) return null;
                const thin = 0.012;
                return (
                  <div
                    key={`hit-${layer.id}`}
                    className="tpl-hit"
                    title={layer.name}
                    style={{
                      left: `${layer.box.x * 100}%`,
                      top: `${(layer.box.height < thin ? layer.box.y - thin / 2 : layer.box.y) * 100}%`,
                      width: `${layer.box.width * 100}%`,
                      height: `${Math.max(layer.box.height, thin) * 100}%`,
                      zIndex: templateZOrder.get(layer.id),
                      transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                    }}
                    onPointerDown={(event) => beginElementGesture(event, layer, 'move')}
                    onPointerMove={moveElementGesture}
                    onPointerUp={endElementGesture}
                    onPointerCancel={endElementGesture}
                  />
                );
              })}
              {selectedElement && (
                <div
                  className="album-frame-selection element"
                  style={{
                    left: `${selectedElement.box.x * 100}%`,
                    top: `${selectedElement.box.y * 100}%`,
                    width: `${selectedElement.box.width * 100}%`,
                    height: `${selectedElement.box.height * 100}%`,
                    transform: selectedElement.rotation ? `rotate(${selectedElement.rotation}deg)` : undefined,
                  }}
                >
                  <span
                    className="album-frame-rotate"
                    title="סיבוב · Shift בקפיצות של 15°"
                    onPointerDown={beginElementRotate}
                    onPointerMove={moveElementRotate}
                    onPointerUp={endRotate}
                    onPointerCancel={endRotate}
                  />
                  {((selectedElement.type === 'image' || (selectedElement.type === 'shape' && selectedElement.shape === 'path'))
                    ? (['nw', 'ne', 'se', 'sw'] as const)
                    : (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)
                  ).map((h) => (
                    <span
                      key={h}
                      className={`album-frame-handle ${h}`}
                      onPointerDown={(e) => beginElementGesture(e, selectedElement, h)}
                      onPointerMove={moveElementGesture}
                      onPointerUp={endElementGesture}
                      onPointerCancel={endElementGesture}
                    />
                  ))}
                </div>
              )}
              {/* Selection box with resize handles, drawn above the whole page so no
                * frame line, fade or neighbouring layer can hide or clip them. */}
              {selectedSlotIndex !== null && cropIndex !== selectedSlotIndex && layout.slots[selectedSlotIndex] && (
                <div
                  className="album-frame-selection"
                  style={{
                    left: `${layout.slots[selectedSlotIndex].x * 100}%`,
                    top: `${layout.slots[selectedSlotIndex].y * 100}%`,
                    width: `${layout.slots[selectedSlotIndex].width * 100}%`,
                    height: `${layout.slots[selectedSlotIndex].height * 100}%`,
                    transform: activeTemplate && templatePhotoLayers[selectedSlotIndex]?.rotation
                      ? `rotate(${templatePhotoLayers[selectedSlotIndex].rotation}deg)`
                      : undefined,
                  }}
                >
                  {activeTemplate && (
                    <span
                      className="album-frame-rotate"
                      title="סיבוב · Shift בקפיצות של 15°"
                      onPointerDown={beginRotate}
                      onPointerMove={moveRotate}
                      onPointerUp={endRotate}
                      onPointerCancel={endRotate}
                    />
                  )}
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((h) => (
                    <span
                      key={h}
                      className={`album-frame-handle ${h}`}
                      onPointerDown={(e) => beginFrameGesture(e, selectedSlotIndex, h)}
                      onPointerMove={moveFrameGesture}
                      onPointerUp={endFrameGesture}
                      onPointerCancel={endFrameGesture}
                    />
                  ))}
                </div>
              )}

              <div className="album-page-number left">{spread.pageStart}</div>
              <div className="album-page-number right">{spread.pageStart + 1}</div>
            </div>
          </div>

          <section className="album-photo-tray">
            <div className="album-photo-tray-head">
              <div className="album-photo-summary">
                <strong>תמונות</strong>
                <span>{albumPhotos.filter((photo) => !usedIds.has(photo.id)).length} לא שובצו</span>
              </div>
              <div className="album-photo-filters" role="group" aria-label="סינון תמונות">
                {([
                  ['current', 'לכפולה'],
                  ['unused', 'לא שובצו'],
                  ['all', 'הכול'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={photoFilter === value ? 'on' : ''}
                    onClick={() => {
                      setPhotoFilter(value);
                      setPhotoLimit(60);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="album-import" onClick={() => job ? setShowPhotoPicker(true) : fileInput.current?.click()}><IcUpload size={16} />＋ תמונות</button>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
            </div>
            <div className="album-photos">
              {visiblePhotos.map((photo) => (
                <button
                  key={photo.id}
                  className={`album-photo-thumb ${selectedPhotoId === photo.id ? 'selected' : ''}`}
                  /* A place picked on the page, then a photo: it goes straight in. */
                  onClick={() => (selectedSlotIndex !== null && cropIndex === null
                    ? assignPhotoById(selectedSlotIndex, photo.id)
                    : setSelectedPhotoId(selectedPhotoId === photo.id ? null : photo.id))}
                  aria-label={`בחר ${photo.name}`}
                  title={photo.name}
                  draggable
                  onDragStart={(event) => beginPhotoDrag(event, photo.id)}
                >
                  <img src={photo.url} alt="" loading="lazy" decoding="async" />
                  {usedIds.has(photo.id) && (
                    <span
                      className={`album-used ${currentSpreadIds.has(photo.id) ? 'current' : ''}`}
                      title={currentSpreadIds.has(photo.id) ? 'נמצאת בכפולה הנוכחית' : 'כבר שובצה באלבום — עדיין אפשר להשתמש בה שוב'}
                    >
                      <IcCheck size={11} />
                    </span>
                  )}
                </button>
              ))}
              {visiblePhotos.length < filteredPhotos.length && (
                <button
                  className="album-load-more"
                  onClick={() => setPhotoLimit((value) => value + 60)}
                >
                  עוד {Math.min(60, filteredPhotos.length - visiblePhotos.length)} תמונות
                </button>
              )}
              {filteredPhotos.length === 0 && (
                <div className="album-photo-empty">
                  אין תמונות במסנן הזה. אפשר לעבור ל״הכול״ או להוסיף תמונות חדשות.
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="album-layout-panel">
          <>
          <SpreadPanel
            key={spread.id}
            spread={spread}
            photos={photos}
            spreadAspect={profile.spreadWidthMm / profile.spreadHeightMm}
            template={activeTemplate}
            onApply={placeTemplate}
            onCycle={(direction) => cycleLayout(direction)}
            onColor={(token, value) => editTemplateInstance((instance) => ({
              ...instance, colors: { ...instance.colors, [token]: value },
            }))}
            onText={(layerId, value) => editTemplateInstance((instance) => ({
              ...instance, texts: { ...instance.texts, [layerId]: value },
            }))}
            onEditEnd={endTemplateEdit}
            myElements={myElements}
            userFonts={userFonts}
            onAddElement={addElement}
            onImportElements={(files) => { void importMyElements(files); }}
            onRemoveMine={(element) => { void removeFromMyElements(element); }}
            onImportFonts={(files) => { void importMyFonts(files); }}
          />          </>
        </aside>
          </>
        )}
      </div>

      {showPhotoPicker && (
        <AlbumPhotoPicker
          photos={photos}
          albumName={project.name}
          existingPhotoIds={project.photoSelection ?? project.spreads.flatMap((item) => item.photoIds).filter(Boolean)}
          onCancel={() => setShowPhotoPicker(false)}
          onContinue={(ids) => {
            addToAlbumPhotos(ids);
            setShowPhotoPicker(false);
          }}
        />
      )}

      {showDelivery && (
        <div className="album-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowDelivery(false)}>
          <section className="album-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="album-delivery-title">
            <header>
              <div>
                <h2 id="album-delivery-title">הגהה ומסירה</h2>
                <p>מכאן בודקים את הספר, שולחים ללקוח ומפיקים קבצים.</p>
              </div>
              <button className="album-icon-button" onClick={() => setShowDelivery(false)} aria-label="סגירה">×</button>
            </header>
            {(preflight.blockers > 0 || preflight.warnings > 0) && (
              <button className={`album-delivery-status${preflight.blockers ? ' blocker' : ''}`} onClick={() => { setShowDelivery(false); setShowPreflight(true); }}>
                <strong>{preflight.blockers ? `${preflight.blockers} בעיות דורשות טיפול` : `${preflight.warnings} אזהרות לבדיקה`}</strong>
                <span>פתח בדיקת דפוס ←</span>
              </button>
            )}
            <div className="album-delivery-grid">
              <button onClick={() => { setShowDelivery(false); setShowPreview(true); }}>
                <IcEye size={22} /><strong>תצוגה מלאה</strong><span>דפדוף בספר כמו הלקוח</span>
              </button>
              <button onClick={() => { setShowDelivery(false); openReviewWorkspace(); }}>
                <IcCheck size={22} /><strong>שליחה לאישור</strong><span>סבב הערות ואישור לקוח</span>
              </button>
              <button disabled={isExporting} onClick={() => { setShowDelivery(false); void handleExportProof(); }}>
                <IcDownload size={22} /><strong>קבצי הגהה</strong><span>תמונות מוקטנות לשיתוף</span>
              </button>
              <button disabled={isExporting || preflight.blockers > 0} onClick={() => { setShowDelivery(false); void handlePrintExport(); }}>
                <IcDownload size={22} /><strong>חבילת דפוס</strong><span>{preflight.blockers ? 'זמין לאחר תיקון הבעיות' : 'קבצים לפי מפרט בית הדפוס'}</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {confirmAutoBuild && (
        <div className="album-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setConfirmAutoBuild(false)}>
          <section className="album-small-dialog" role="dialog" aria-modal="true" aria-labelledby="album-autobuild-title">
            <h2 id="album-autobuild-title">לבנות את האלבום מחדש?</h2>
            <p>הבנייה האוטומטית תסדר את כל תמונות האלבום מחדש על עמודי הכספת, במקום הכפולות שבנית. אפשר לבטל אחר כך ב-Ctrl+Z.</p>
            <footer>
              <button className="album-quiet-button" onClick={() => setConfirmAutoBuild(false)}>ביטול</button>
              <button className="album-primary-button" onClick={() => autoBuildAlbum(true)}>בנה מחדש</button>
            </footer>
          </section>
        </div>
      )}

      {pendingSpreadDelete !== null && (
        <div className="album-modal-backdrop">
          <section className="album-small-dialog" role="alertdialog" aria-modal="true" aria-labelledby="album-spread-delete-title">
            <h2 id="album-spread-delete-title">למחוק את כפולה {pendingSpreadDelete + 1}?</h2>
            <p>התמונות יחזרו למאגר ולא יימחקו מהפרויקט.</p>
            <footer>
              <button className="album-quiet-button" onClick={() => setPendingSpreadDelete(null)}>ביטול</button>
              <button className="album-danger-button" onClick={() => { deleteSpreadAt(pendingSpreadDelete); setPendingSpreadDelete(null); }}>מחיקת הכפולה</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}