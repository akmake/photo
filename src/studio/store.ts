/* The project store.
 *
 * Small on purpose: a module-level list, a listener set, and localStorage. It
 * exists because "פרויקט חדש" has to actually create something and survive a
 * reload — a button that opens a form and then forgets is worse than no button.
 *
 * This is the seam where MongoDB lands later (docs/PRODUCT-UX.md §3.7: the
 * database holds knowledge ABOUT the work, the disk holds the work). Nothing
 * here touches image files.
 */

import { useSyncExternalStore } from 'react';
import type { LearnedColorModel, ProjectRecipe, ToolInstance } from '../types';

/** The stages a job moves through. Every project carries all of them — a shoot
 *  that was not sold with an album can still become one, so the album tool is
 *  reachable from every project. `הכנה` is where the deliverables are chosen;
 *  those choices drive the checklist, not which stages exist. */
export const STAGES = [
  { id: 'setup', label: 'הכנה' },
  { id: 'import', label: 'ייבוא' },
  { id: 'select', label: 'בחירה' },
  { id: 'edit', label: 'עריכה' },
  { id: 'album', label: 'אלבום' },
  { id: 'deliver', label: 'מסירה' },
] as const;

export type StageKey = (typeof STAGES)[number]['id'];

export type ProjectState = 'shoot' | 'work' | 'waiting' | 'done';

export const STATE_LABEL: Record<ProjectState, string> = {
  shoot: 'לפני צילום',
  work: 'בעבודה',
  waiting: 'ממתין ללקוח',
  done: 'הושלם',
};

export interface Project {
  id: string;
  client: string;
  event: string;
  /** dd.mm — the shoot date, not the creation date. */
  date: string;
  location?: string;
  price?: number;
  paid?: number;
  thumb: string;
  /** Crop of the demo frame, so a wall of tiles is not one repeated picture. */
  pos: string;
  /** Index into the project's own stage list. */
  at: number;
  counts: string;
  state: ProjectState;
  /** Chosen in הכנה — whether an album was sold as a deliverable. Drives the
   *  setup checklist. It no longer hides the album stage: the tool is available
   *  in every project, sold or not. */
  hasAlbum: boolean;
  hasGallery: boolean;
  /** Counters — the spine of the project header. */
  imported: number;
  kept: number;
  picked: number;
  rendered: number;
  waitingSince?: string;
  createdAt: string;
}

/** The stages this project shows. Every project gets all of them — the album
 *  tool must be reachable from every project, whether or not one was sold. */
export function stagesOf(_p: Project) {
  return STAGES;
}

const SEED: Project[] = [
  { id: 'p1', client: 'משפחת לוי', event: 'צילומי משפחה', date: '24.07', location: 'פארק הירקון', price: 3200, paid: 1600, thumb: '/demo/b.jpg', pos: '50% 40%', at: 3, counts: '96 בסט · 24 נערכו', state: 'work', hasAlbum: false, hasGallery: true, imported: 380, kept: 380, picked: 96, rendered: 24, createdAt: '2026-07-24' },
  { id: 'p2', client: 'רון ומאיה', event: 'חתונה', date: '12.07', location: 'אחוזת הכפר', price: 12500, paid: 6000, thumb: '/demo/c.jpg', pos: '40% 30%', at: 4, counts: '18 כפולות · גרסה 1', state: 'waiting', hasAlbum: true, hasGallery: true, imported: 2140, kept: 1180, picked: 240, rendered: 240, waitingSince: '28.07', createdAt: '2026-07-12' },
  { id: 'p3', client: 'בר מצווה איתי כהן', event: 'אירוע', date: '21.07', location: 'היכל התרבות', price: 5400, paid: 2000, thumb: '/demo/a.jpg', pos: '50% 25%', at: 2, counts: '412 אחרי סינון', state: 'work', hasAlbum: true, hasGallery: true, imported: 1290, kept: 412, picked: 0, rendered: 0, createdAt: '2026-07-21' },
  { id: 'p4', client: 'משפחת ברק', event: 'ניו בורן', date: '18.07', location: 'סטודיו', price: 2400, paid: 2400, thumb: '/demo/b.jpg', pos: '30% 55%', at: 5, counts: '214 קבצים מוכנים', state: 'work', hasAlbum: false, hasGallery: true, imported: 640, kept: 320, picked: 214, rendered: 214, createdAt: '2026-07-18' },
  { id: 'p5', client: 'משפחת אלון', event: 'בוק תדמית', date: '09.07', location: 'תל אביב', price: 4100, paid: 0, thumb: '/demo/a.jpg', pos: '60% 45%', at: 2, counts: '208 אחרי סינון', state: 'waiting', hasAlbum: false, hasGallery: true, imported: 520, kept: 208, picked: 0, rendered: 0, waitingSince: '25.07', createdAt: '2026-07-09' },
  { id: 'p6', client: 'ליאת ואורי', event: 'חתונה', date: '31.07', location: 'גני התערוכה', price: 14000, paid: 4000, thumb: '/demo/c.jpg', pos: '55% 35%', at: 0, counts: 'הצילום מחר', state: 'shoot', hasAlbum: true, hasGallery: true, imported: 0, kept: 0, picked: 0, rendered: 0, createdAt: '2026-06-02' },
  { id: 'p7', client: 'משפחת נחום', event: 'צילומי משפחה', date: '02.08', location: 'הבית', price: 2800, paid: 0, thumb: '/demo/b.jpg', pos: '45% 60%', at: 0, counts: 'טרם יובא', state: 'shoot', hasAlbum: false, hasGallery: true, imported: 0, kept: 0, picked: 0, rendered: 0, createdAt: '2026-07-10' },
  { id: 'p8', client: 'דנה שגב', event: 'הריון', date: '15.07', location: 'סטודיו', price: 1900, paid: 1900, thumb: '/demo/c.jpg', pos: '35% 50%', at: 3, counts: '64 בסט · 64 נערכו', state: 'work', hasAlbum: false, hasGallery: true, imported: 210, kept: 140, picked: 64, rendered: 64, createdAt: '2026-07-15' },
  { id: 'p9', client: 'סטודיו א.ד', event: 'צילומי מוצר', date: '02.07', location: 'סטודיו', price: 2400, paid: 0, thumb: '/demo/a.jpg', pos: '50% 70%', at: 5, counts: 'נמסר · ₪2,400 פתוח', state: 'done', hasAlbum: false, hasGallery: false, imported: 180, kept: 96, picked: 96, rendered: 96, createdAt: '2026-07-02' },
  { id: 'p10', client: 'משפחת גל', event: 'בת מצווה', date: '28.06', location: 'אולמי הגן', price: 6800, paid: 6800, thumb: '/demo/b.jpg', pos: '65% 30%', at: 5, counts: 'נמסר · אלבום הודפס', state: 'done', hasAlbum: true, hasGallery: true, imported: 1420, kept: 720, picked: 180, rendered: 180, createdAt: '2026-06-28' },
  { id: 'p11', client: 'עידן ושירה', event: 'חתונה', date: '14.06', location: 'יקב בנימינה', price: 13200, paid: 13200, thumb: '/demo/c.jpg', pos: '25% 40%', at: 5, counts: 'נמסר · 640 קבצים', state: 'done', hasAlbum: true, hasGallery: true, imported: 2860, kept: 1540, picked: 640, rendered: 640, createdAt: '2026-06-14' },
  { id: 'p12', client: 'משפחת רוזן', event: 'צילומי משפחה', date: '30.05', location: 'חוף פולג', price: 2600, paid: 2600, thumb: '/demo/a.jpg', pos: '40% 65%', at: 5, counts: 'נמסר', state: 'done', hasAlbum: false, hasGallery: true, imported: 410, kept: 240, picked: 88, rendered: 88, createdAt: '2026-05-30' },
];

const KEY = 'teza.projects.v1';

function load(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) && parsed.length ? parsed : SEED;
  } catch {
    return SEED;
  }
}

let projects: Project[] = load();
const listeners = new Set<() => void>();

function commit(next: Project[]) {
  projects = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    // storage is optional; the session still works without it
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProjects(): Project[] {
  return useSyncExternalStore(subscribe, () => projects, () => projects);
}

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export interface NewProjectInput {
  client: string;
  event: string;
  date: string;
  location?: string;
  price?: number;
  hasGallery: boolean;
  hasAlbum: boolean;
}

const FRAMES = ['/demo/b.jpg', '/demo/c.jpg', '/demo/a.jpg'];
const CROPS = ['50% 40%', '40% 30%', '55% 45%', '35% 55%', '60% 35%'];

/** Creates the project and returns it, so the caller can walk straight into it.
 *  A new job starts in הכנה with every counter at zero — there is nothing to
 *  invent, and inventing it is how a screen starts lying. */
export function createProject(input: NewProjectInput): Project {
  const n = projects.length + 1;
  const project: Project = {
    id: `p${Date.now().toString(36)}`,
    client: input.client.trim(),
    event: input.event.trim() || 'צילום',
    date: input.date,
    location: input.location?.trim() || undefined,
    price: input.price,
    paid: 0,
    thumb: FRAMES[n % FRAMES.length],
    pos: CROPS[n % CROPS.length],
    at: 0,
    counts: 'טרם יובא',
    state: 'shoot',
    hasAlbum: input.hasAlbum,
    hasGallery: input.hasGallery,
    imported: 0,
    kept: 0,
    picked: 0,
    rendered: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  commit([project, ...projects]);
  return project;
}

/** Every distinct client already on file — a returning client is the most
 *  valuable thing in the business, and typing their name again is how the
 *  history gets split in two. */
export function knownClients(): string[] {
  return [...new Set(projects.map((p) => p.client))].sort((a, b) => a.localeCompare(b, 'he'));
}

/* ============================================================ folders & photos
 *
 * A project points at FOLDERS on disk — often more than one (ceremony, party,
 * second shooter). The photographs themselves are never copied anywhere: the
 * folder list and each frame's status are the only things this store keeps, and
 * the disk stays the source of truth for what actually exists.
 *
 * Status defaults to "חומר גלם". That is not a placeholder for "unprocessed" —
 * most frames in a shoot never need an individual decision, and forcing the
 * photographer to clear a to-do on 1,800 files would be the tool inventing work.
 * Marking בטיפול / מוכן is opt-in, per frame.
 */

export type PhotoStatus = 'raw' | 'working' | 'ready';

export const PHOTO_STATUS: { id: PhotoStatus; label: string }[] = [
  { id: 'raw', label: 'חומר גלם' },
  { id: 'working', label: 'בטיפול' },
  { id: 'ready', label: 'מוכן' },
];

export interface ProjectFolder {
  id: string;
  path: string;
  name: string;
  count: number;
}

export interface Photo {
  /** The absolute path IS the identity. It is stable, unique, and it is what
   *  every engine call needs anyway — a generated id would only be a second
   *  name for the same thing, and one more thing to keep in sync. */
  id: string;
  path: string;
  name: string;
  folderId: string;
  status: PhotoStatus;
}

const FOLDERS_KEY = 'teza.folders.v1';
const STATUS_KEY = 'teza.photo-status.v1';

function loadMap<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, T>;
  } catch {
    return {};
  }
}

let folders: Record<string, ProjectFolder[]> = loadMap<ProjectFolder[]>(FOLDERS_KEY);
let statuses: Record<string, PhotoStatus> = loadMap<PhotoStatus>(STATUS_KEY);

function saveFolders() {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    /* optional */
  }
  listeners.forEach((fn) => fn());
}

function saveStatuses() {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(statuses));
  } catch {
    /* optional */
  }
  listeners.forEach((fn) => fn());
}

export function foldersOf(projectId: string): ProjectFolder[] {
  return folders[projectId] ?? [];
}

export function useFolders(projectId: string): ProjectFolder[] {
  return useSyncExternalStore(
    subscribe,
    () => folders[projectId] ?? EMPTY_FOLDERS,
    () => folders[projectId] ?? EMPTY_FOLDERS,
  );
}

const EMPTY_FOLDERS: ProjectFolder[] = [];

export function addFolder(projectId: string, path: string, count: number): ProjectFolder {
  const clean = path.trim().replace(/[\/]+$/, '');
  const name = clean.split(/[\/]/).filter(Boolean).pop() ?? clean;
  const existing = (folders[projectId] ?? []).find((f) => f.path === clean);
  const folder: ProjectFolder = existing
    ? { ...existing, count }
    : { id: `f${Date.now().toString(36)}`, path: clean, name, count };
  folders = {
    ...folders,
    [projectId]: existing
      ? (folders[projectId] ?? []).map((f) => (f.path === clean ? folder : f))
      : [...(folders[projectId] ?? []), folder],
  };
  saveFolders();
  return folder;
}

export function removeFolder(projectId: string, folderId: string) {
  folders = {
    ...folders,
    [projectId]: (folders[projectId] ?? []).filter((f) => f.id !== folderId),
  };
  saveFolders();
}

export function statusOf(path: string): PhotoStatus {
  return statuses[path] ?? 'raw';
}

export function setPhotoStatus(path: string, status: PhotoStatus) {
  if (status === 'raw') {
    const { [path]: _drop, ...rest } = statuses;
    statuses = rest;
  } else {
    statuses = { ...statuses, [path]: status };
  }
  saveStatuses();
}

export function useStatuses(): Record<string, PhotoStatus> {
  return useSyncExternalStore(subscribe, () => statuses, () => statuses);
}

/* ================================================================ the recipe
 *
 * WHAT THE SET LOOKS LIKE NOW — and the reason a tool no longer reopens the
 * raw files.
 *
 * Before this existed, applying a learned colour to a folder wrote 2,000 JPEGs
 * into `<folder>\TEZA` and then forgot the path the moment the screen closed:
 * the destination lived in component state, the store had no concept of an
 * output, and /list-images does not recurse — so the result was invisible to
 * the product that produced it, and the next tool opened the raws again.
 *
 * So the set's state stopped being a place on disk and became a LIST OF WHAT
 * WAS DONE. Applying to the whole set appends a step here — instantly, with no
 * files written — and every screen that shows a frame renders through it. There
 * is nothing to synchronise because there is only one copy of the truth, and
 * changing step 1 does not cost the work done in steps 2 and 3.
 *
 * Files are written once, on delivery, from the original — so a set can be
 * re-graded any number of times without a single re-encode.
 */

const RECIPE_KEY = 'teza.recipes.v1';

const EMPTY_RECIPE: ProjectRecipe = { version: 1, base: [], perFrame: {} };

let recipes: Record<string, ProjectRecipe> = loadMap<ProjectRecipe>(RECIPE_KEY);

function saveRecipes() {
  try {
    localStorage.setItem(RECIPE_KEY, JSON.stringify(recipes));
  } catch {
    /* optional */
  }
  listeners.forEach((fn) => fn());
}

export function recipeOf(projectId: string): ProjectRecipe {
  return recipes[projectId] ?? EMPTY_RECIPE;
}

export function useRecipe(projectId: string): ProjectRecipe {
  return useSyncExternalStore(
    subscribe,
    () => recipes[projectId] ?? EMPTY_RECIPE,
    () => recipes[projectId] ?? EMPTY_RECIPE,
  );
}

/** Strip what cannot mean anything on another frame.
 *
 *  A brush stroke and a set of marked outlines belong to one face in one photo;
 *  carrying them into a step that runs on the whole set would apply one frame's
 *  geometry to every other frame. The rule is already stated in types.ts — this
 *  is where it is enforced, at the one door into `base`. */
function shareable(step: ToolInstance): ToolInstance {
  const { selection: _drop, mask, ...rest } = step;
  if (!mask) return rest;
  const { paint: _painted, ...maskRest } = mask;
  return { ...rest, mask: maskRest };
}

function write(projectId: string, next: ProjectRecipe) {
  recipes = { ...recipes, [projectId]: next };
  saveRecipes();
}

/** Put a step on the whole set. One entry per tool: applying a look twice
 *  REPLACES it rather than stacking two grades on top of each other — a set has
 *  one look, and "keep both" is a variations feature, not a side effect. */
export function setStep(projectId: string, step: ToolInstance) {
  const current = recipeOf(projectId);
  const clean = shareable(step);
  const exists = current.base.some((t) => t.toolId === clean.toolId);
  write(projectId, {
    ...current,
    version: 1,
    base: exists
      ? current.base.map((t) => (t.toolId === clean.toolId ? clean : t))
      : [...current.base, clean],
  });
}

export function removeStep(projectId: string, toolId: string) {
  const current = recipeOf(projectId);
  write(projectId, { ...current, base: current.base.filter((t) => t.toolId !== toolId) });
}

export function toggleStep(projectId: string, toolId: string, enabled: boolean) {
  const current = recipeOf(projectId);
  write(projectId, {
    ...current,
    base: current.base.map((t) => (t.toolId === toolId ? { ...t, enabled } : t)),
  });
}

/** What one frame actually renders through.
 *
 *  `perFrame` overrides `base` by toolId, so an exception on three photographs
 *  never has to restate the twelve steps they share with the rest of the set.
 *  Frame-only tools run after the shared ones; the engine sorts by pipeline
 *  order anyway, so this order is for reading, not for correctness. */
export function effectiveRecipe(projectId: string, path?: string): ToolInstance[] {
  const { base, perFrame } = recipeOf(projectId);
  const overrides = path ? perFrame[path] : undefined;
  if (!overrides?.length) return base;
  const byId = new Map(overrides.map((t) => [t.toolId, t]));
  const merged = base.map((t) => byId.get(t.toolId) ?? t);
  const extra = overrides.filter((t) => !base.some((b) => b.toolId === t.toolId));
  return [...merged, ...extra];
}

/** Steps that will actually run — what the engine keys a preview on. An
 *  all-disabled recipe is the raw frame, and must produce the raw frame's key. */
export function activeSteps(projectId: string, path?: string): ToolInstance[] {
  return effectiveRecipe(projectId, path).filter((t) => t.enabled);
}

/** The learned colour look currently on the set, if there is one. */
export function colorStep(projectId: string): LearnedColorModel | undefined {
  return recipeOf(projectId).base.find((t) => t.toolId === 'pixel-color')?.model;
}
