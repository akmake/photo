/* The project store — and the line down the middle of it.
 *
 * There are two kinds of knowledge in this product, and they do not live in the
 * same place:
 *
 *   THE BUSINESS   clients, money, dates, which jobs are open. It crosses
 *                  projects, belongs to no folder, and lives here in
 *                  localStorage today and MongoDB later.
 *
 *   THE FILES      batches, which frame is in which, statuses, the recipe.
 *                  It is ABOUT a specific set of photographs, so it lives in
 *                  `project.json` INSIDE the project's folder — copy the folder
 *                  to another machine and the work comes with it; uninstall the
 *                  software and nothing is lost.
 *
 * The disk half used to live in localStorage too, which meant the files were on
 * D:\ and everything anyone knew about them was in a browser profile. Clearing
 * the browser threw away the batches, the grades and the statuses of every
 * job on the machine while leaving every photograph untouched.
 *
 * Reads are synchronous against an in-memory mirror; writes update the mirror,
 * notify, and persist on a short debounce. A screen must never wait on a disk
 * round trip to render a list it already has.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  initProject, projectFrames, projectState, workspaceRoot,
} from '../api';
import type { Frame, ProjectMemory } from '../api';
import type { LearnedColorModel, ProjectRecipe, Batch, ToolInstance } from '../types';

/** The stages a job moves through. Every project carries all of them — a shoot
 *  that was not sold with an album can still become one, so the album tool is
 *  reachable from every project. `הכנה` is where the deliverables are chosen;
 *  those choices drive the checklist, not which stages exist. */
export const STAGES = [
  { id: 'setup', label: 'הכנה' },
  { id: 'import', label: 'ייבוא' },
  { id: 'batches', label: 'מקבצים' },
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
  /** The project's folder on disk: `<root>/<name>/`. Absent until the first
   *  import creates it — a project can exist before its shoot has happened. */
  home?: string;
}

/** The stages this project shows. Every project gets all of them — the album
 *  tool must be reachable from every project, whether or not one was sold. */
export function stagesOf(_p: Project) {
  return STAGES;
}

/* The business starts EMPTY. There is no seed data: a project exists because the
 * photographer created it, and every counter it carries is real. The key is v2
 * so any demo seed persisted under v1 is left behind on first load. */
const KEY = 'teza.projects.v2';

function load(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let projects: Project[] = load();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function commit(next: Project[]) {
  projects = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    // storage is optional; the session still works without it
  }
  notify();
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

export function updateProject(id: string, patch: Partial<Project>) {
  commit(projects.map((p) => (p.id === id ? { ...p, ...patch } : p)));
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

/** Creates the project and returns it, so the caller can walk straight into it.
 *  A new job starts in הכנה with every counter at zero and no cover frame — there
 *  is nothing to invent, and inventing it is how a screen starts lying. A cover
 *  appears once the shoot's files are imported. */
export function createProject(input: NewProjectInput): Project {
  const project: Project = {
    id: `p${Date.now().toString(36)}`,
    client: input.client.trim(),
    event: input.event.trim() || 'צילום',
    date: input.date,
    location: input.location?.trim() || undefined,
    price: input.price,
    paid: 0,
    thumb: '',
    pos: '50% 50%',
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

/** The folder name a project claims on disk. Client and event, because that is
 *  how a photographer looks for a job in Explorer six months later — not by an
 *  id that means nothing outside this program. */
export function folderNameOf(p: Project): string {
  return [p.client, p.event, p.date].filter(Boolean).join(' — ');
}

/** Every distinct client already on file — a returning client is the most
 *  valuable thing in the business, and typing their name again is how the
 *  history gets split in two. */
export function knownClients(): string[] {
  return [...new Set(projects.map((p) => p.client))].sort((a, b) => a.localeCompare(b, 'he'));
}

/** One client, rolled up from every project that carries their name. This is
 *  DERIVED, never stored: the client screen used to run on a separate demo
 *  array, which is how the same client could read one way in לקוחות and another
 *  in פרויקטים. There is one source of truth — the projects — and a client is
 *  what you get when you group them. */
export interface ClientSummary {
  name: string;
  count: number;
  /** Non-done projects — the ones still needing the photographer. */
  active: number;
  /** Total agreed across all their projects — how much this client is worth. */
  scope: number;
  paid: number;
  /** What they still owe. The number the business is actually run on. */
  open: number;
  lastEvent: string;
  lastDate: string;
  /** Most recent project, so the row opens somewhere real instead of nowhere. */
  latestId: string;
}

export function clientSummaries(list: Project[] = projects): ClientSummary[] {
  const byName = new Map<string, Project[]>();
  for (const p of list) {
    const arr = byName.get(p.client);
    if (arr) arr.push(p);
    else byName.set(p.client, [p]);
  }

  const out: ClientSummary[] = [];
  for (const [name, ps] of byName) {
    const recent = [...ps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const scope = ps.reduce((n, p) => n + (p.price ?? 0), 0);
    const paid = ps.reduce((n, p) => n + (p.paid ?? 0), 0);
    out.push({
      name,
      count: ps.length,
      active: ps.filter((p) => p.state !== 'done').length,
      scope,
      paid,
      open: scope - paid,
      lastEvent: recent[0].event,
      lastDate: recent[0].date,
      latestId: recent[0].id,
    });
  }

  // Money first: who owes the most, then who is worth the most. Operating the
  // business means the client with an open balance is the one you want on top.
  return out.sort((a, b) => b.open - a.open || b.scope - a.scope);
}

export function useClientSummaries(): ClientSummary[] {
  const list = useProjects();
  return useMemo(() => clientSummaries(list), [list]);
}

/* ============================================================ the disk half
 *
 * From here down, everything is ABOUT a folder of photographs and therefore
 * lives in that folder. The mirror below is a cache of `project.json`, not a
 * second copy of the truth: the disk wins on load, and every mutation is on its
 * way back to the disk before the next render finishes.
 */

export type PhotoStatus = 'raw' | 'working' | 'ready';

export const PHOTO_STATUS: { id: PhotoStatus; label: string }[] = [
  { id: 'raw', label: 'חומר גלם' },
  { id: 'working', label: 'בטיפול' },
  { id: 'ready', label: 'מוכן' },
];

export type { Frame };

/** A frame's key in project.json. The absolute path is what every engine call
 *  needs, but it is NOT identity: the folder is built to travel, and a drive
 *  letter that changes must not orphan a batch. */
export function frameKey(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

const EMPTY_STATE: ProjectMemory = {
  version: 1,
  batches: [],
  assign: {},
  statuses: {},
  recipe: { version: 1, base: [], perBatch: {}, perFrame: {} },
};

const states: Record<string, ProjectMemory> = {};
const framesByProject: Record<string, Frame[]> = {};
const loading = new Set<string>();
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** Where the projects live. One answer for the installation, cached here so a
 *  screen can ask without a round trip after the first time. */
let root: string | null = null;
let rootAsked = false;

export async function getWorkspaceRoot(): Promise<string | null> {
  if (!rootAsked) {
    root = await workspaceRoot().catch(() => null);
    rootAsked = true;
  }
  return root;
}

export async function setWorkspaceRoot(folder: string): Promise<string | null> {
  root = await workspaceRoot(folder);
  rootAsked = true;
  notify();
  return root;
}

export function knownRoot(): string | null {
  return root;
}

function stateOf(projectId: string): ProjectMemory {
  return states[projectId] ?? EMPTY_STATE;
}

/** Persist on a debounce. Marking forty photographs into a batch is forty
 *  mutations in a second; forty writes of the same file is how a save ends up
 *  racing itself. */
function save(projectId: string) {
  const project = getProject(projectId);
  if (!project?.home) return;
  clearTimeout(saveTimers[projectId]);
  saveTimers[projectId] = setTimeout(() => {
    projectState(project.home!, states[projectId]).catch(() => {
      /* the mirror still serves this session; the next mutation retries */
    });
  }, 400);
}

function write(projectId: string, next: ProjectMemory) {
  states[projectId] = next;
  notify();
  save(projectId);
}

/** Open a project's folder: create it if needed, read its memory, list its
 *  frames. Safe to call repeatedly — the guard makes a re-render cheap. */
export async function openProject(projectId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project || loading.has(projectId)) return;
  loading.add(projectId);
  try {
    let home = project.home;
    if (!home) {
      if (!(await getWorkspaceRoot())) return; // no root chosen yet — the UI asks
      home = (await initProject(folderNameOf(project))).home;
      updateProject(projectId, { home });
    }
    states[projectId] = await projectState(home);
    const { frames } = await projectFrames(home);
    framesByProject[projectId] = frames;
    notify();
  } finally {
    loading.delete(projectId);
  }
}

/** Re-read the folder. The disk is the authority on what EXISTS, so anything
 *  that changes it — an import, an apply — ends here rather than patching a
 *  list in memory and hoping the two agree. */
export async function reloadFrames(projectId: string): Promise<void> {
  const home = getProject(projectId)?.home;
  if (!home) return;
  const { frames } = await projectFrames(home);
  framesByProject[projectId] = frames;
  updateProject(projectId, { imported: frames.length });
  notify();
}

const NO_FRAMES: Frame[] = [];

export function framesOf(projectId: string): Frame[] {
  return framesByProject[projectId] ?? NO_FRAMES;
}

/** The set, loaded on first use. `ready` is false only while the very first
 *  read is in flight — long enough to say "reading the folder", never long
 *  enough to justify a skeleton. */
export function useProjectFiles(projectId: string): { frames: Frame[]; ready: boolean } {
  const frames = useSyncExternalStore(
    subscribe,
    () => framesByProject[projectId] ?? NO_FRAMES,
    () => framesByProject[projectId] ?? NO_FRAMES,
  );
  const [ready, setReady] = useState(() => projectId in framesByProject);
  useEffect(() => {
    let alive = true;
    setReady(projectId in framesByProject);
    openProject(projectId).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);
  return { frames, ready };
}

/* -------------------------------------------------------------- batches */

export type { Batch };

export function batchesOf(projectId: string): Batch[] {
  return [...stateOf(projectId).batches].sort((a, b) => a.order - b.order);
}

export function useBatches(projectId: string): Batch[] {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return useMemo(
    () => [...state.batches].sort((a, b) => a.order - b.order),
    [state],
  );
}

/** Create a batch and put frames in it in ONE move.
 *
 *  This is the whole interaction: mark a run of photographs, name it, and it
 *  leaves the pool. Splitting it into "make a batch" and then "put things
 *  in it" would be two screens for one thought. */
export function addBatch(projectId: string, name: string, frames: string[] = []): Batch {
  const current = stateOf(projectId);
  const batch: Batch = {
    id: `s${Date.now().toString(36)}`,
    name: name.trim() || 'ללא שם',
    order: current.batches.length,
  };
  const assign = { ...current.assign };
  for (const f of frames) assign[frameKey(f)] = batch.id;
  write(projectId, { ...current, batches: [...current.batches, batch], assign });
  return batch;
}

export function renameBatch(projectId: string, id: string, name: string) {
  const current = stateOf(projectId);
  write(projectId, {
    ...current,
    batches: current.batches.map((s) => (s.id === id ? { ...s, name } : s)),
  });
}

/** Remove a batch. Its frames go back to the pool rather than anywhere
 *  else, and its grade goes with it — a look that belonged to a light that no
 *  longer has a name is a step nobody can find to switch off. */
export function removeBatch(projectId: string, id: string) {
  const current = stateOf(projectId);
  const assign: Record<string, string> = {};
  for (const [name, sid] of Object.entries(current.assign)) {
    if (sid !== id) assign[name] = sid;
  }
  const { [id]: _dropped, ...perBatch } = current.recipe.perBatch;
  write(projectId, {
    ...current,
    batches: current.batches.filter((s) => s.id !== id),
    assign,
    recipe: { ...current.recipe, perBatch },
  });
}

/** Put frames in a batch, or back in the pool with `null`. */
export function assignFrames(projectId: string, frames: string[], batchId: string | null) {
  const current = stateOf(projectId);
  const assign = { ...current.assign };
  for (const f of frames) {
    const key = frameKey(f);
    if (batchId) assign[key] = batchId;
    else delete assign[key];
  }
  write(projectId, { ...current, assign });
}

export function batchOfFrame(projectId: string, frame: string): string | undefined {
  return stateOf(projectId).assign[frameKey(frame)];
}

/** The frames still waiting to be told what they are.
 *
 *  This is what the marking screen shows, and it is the reason the screen
 *  works: it shrinks. "Finished" is a pool with nothing in it, which needs no
 *  counter to read — and no photograph can end up in two batches, because
 *  a frame that has been named has left. */
export function unassignedFrames(projectId: string): Frame[] {
  const { assign } = stateOf(projectId);
  return framesOf(projectId).filter((f) => !assign[f.name]);
}

export function framesInBatch(projectId: string, batchId: string): Frame[] {
  const { assign } = stateOf(projectId);
  return framesOf(projectId).filter((f) => assign[f.name] === batchId);
}

/* ---------------------------------------------------------------- statuses */

export function statusOf(projectId: string, frame: string): PhotoStatus {
  return (stateOf(projectId).statuses[frameKey(frame)] as PhotoStatus) ?? 'raw';
}

export function setPhotoStatus(projectId: string, frame: string, status: PhotoStatus) {
  const current = stateOf(projectId);
  const statuses = { ...current.statuses };
  if (status === 'raw') delete statuses[frameKey(frame)];
  else statuses[frameKey(frame)] = status;
  write(projectId, { ...current, statuses });
}

export function useStatuses(projectId: string): Record<string, string> {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return state.statuses;
}

/* ================================================================ the recipe
 *
 * WHAT THE SET LOOKS LIKE NOW — three layers deep, and the depth is the point.
 *
 * `base` is the project: tools driven by CONTENT — cleanup, skin, noise,
 * sharpening. The same face wants the same treatment wherever it was standing.
 *
 * `perBatch` is the light: the learned colour, white balance, exposure,
 * grading. One grade over a whole wedding is a lie, and this is where that stops
 * being one.
 *
 * `perFrame` is the exception — the single photograph that breaks the rule.
 *
 * Nothing here writes a file. Switching a step off is instant and costs nothing,
 * because the only thing that ever gets written is `תמונות`, and that happens
 * when the photographer applies — from the RAW, through the whole stack, never
 * on top of the previous output.
 */

const EMPTY_RECIPE: ProjectRecipe = { version: 1, base: [], perBatch: {}, perFrame: {} };

export function recipeOf(projectId: string): ProjectRecipe {
  return (stateOf(projectId).recipe as ProjectRecipe) ?? EMPTY_RECIPE;
}

export function useRecipe(projectId: string): ProjectRecipe {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return (state.recipe as ProjectRecipe) ?? EMPTY_RECIPE;
}

/** Strip what cannot mean anything on another frame.
 *
 *  A brush stroke and a set of marked outlines belong to one face in one photo;
 *  carrying them into a step that runs on a whole batch would apply one
 *  frame's geometry to every other frame. The rule is stated in types.ts — this
 *  is where it is enforced, at the one door into the shared layers. */
function shareable(step: ToolInstance): ToolInstance {
  const { selection: _drop, mask, ...rest } = step;
  if (!mask) return rest;
  const { paint: _painted, ...maskRest } = mask;
  return { ...rest, mask: maskRest };
}

function upsert(list: ToolInstance[], step: ToolInstance): ToolInstance[] {
  return list.some((t) => t.toolId === step.toolId)
    ? list.map((t) => (t.toolId === step.toolId ? step : t))
    : [...list, step];
}

/** Put a step on a layer. One entry per tool per layer: applying a look twice
 *  REPLACES it rather than stacking two grades — a set has one look, and "keep
 *  both" is a variations feature, not a side effect.
 *
 *  `batchId` chooses the layer. Passing one is what makes the dance floor
 *  and the garden two different grades instead of an argument. */
export function setStep(projectId: string, step: ToolInstance, batchId?: string | null) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const clean = shareable(step);
  const next: ProjectRecipe = batchId
    ? {
      ...recipe,
      perBatch: {
        ...recipe.perBatch,
        [batchId]: upsert(recipe.perBatch[batchId] ?? [], clean),
      },
    }
    : { ...recipe, base: upsert(recipe.base, clean) };
  write(projectId, { ...current, recipe: next });
}

export function removeStep(projectId: string, toolId: string, batchId?: string | null) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const next: ProjectRecipe = batchId
    ? {
      ...recipe,
      perBatch: {
        ...recipe.perBatch,
        [batchId]: (recipe.perBatch[batchId] ?? []).filter((t) => t.toolId !== toolId),
      },
    }
    : { ...recipe, base: recipe.base.filter((t) => t.toolId !== toolId) };
  write(projectId, { ...current, recipe: next });
}

export function toggleStep(
  projectId: string,
  toolId: string,
  enabled: boolean,
  batchId?: string | null,
) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const flip = (list: ToolInstance[]) =>
    list.map((t) => (t.toolId === toolId ? { ...t, enabled } : t));
  const next: ProjectRecipe = batchId
    ? {
      ...recipe,
      perBatch: {
        ...recipe.perBatch,
        [batchId]: flip(recipe.perBatch[batchId] ?? []),
      },
    }
    : { ...recipe, base: flip(recipe.base) };
  write(projectId, { ...current, recipe: next });
}

/* ---- the frame layer ----
 *
 * One photograph, on its own. This is where the tool-by-tool workbench writes:
 * retouching is judged frame by frame, and a skin setting that flatters one
 * face is not a setting, it is a guess about every other face in the batch.
 *
 * Unlike the shared layers, THIS one may carry a brush stroke and a set of
 * marked spots — they belong to one face in one photograph, which is exactly
 * what this layer is. `shareable()` is deliberately not applied here. */

export function setFrameStep(projectId: string, frame: string, step: ToolInstance) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const key = frameKey(frame);
  write(projectId, {
    ...current,
    recipe: {
      ...recipe,
      perFrame: { ...recipe.perFrame, [key]: upsert(recipe.perFrame[key] ?? [], step) },
    },
  });
}

export function removeFrameStep(projectId: string, frame: string, toolId: string) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const key = frameKey(frame);
  const left = (recipe.perFrame[key] ?? []).filter((t) => t.toolId !== toolId);
  const perFrame = { ...recipe.perFrame };
  // An empty exception list is not an exception. Leaving `{}` behind would make
  // "how many frames differ from the set" count frames that no longer do.
  if (left.length) perFrame[key] = left;
  else delete perFrame[key];
  write(projectId, { ...current, recipe: { ...recipe, perFrame } });
}

/** What this ONE frame carries of its own, ignoring what it inherits. */
export function frameSteps(projectId: string, frame: string): ToolInstance[] {
  return recipeOf(projectId).perFrame[frameKey(frame)] ?? [];
}

function merge(wide: ToolInstance[], narrow: ToolInstance[]): ToolInstance[] {
  if (!narrow.length) return wide;
  const byId = new Map(narrow.map((t) => [t.toolId, t]));
  const merged = wide.map((t) => byId.get(t.toolId) ?? t);
  const extra = narrow.filter((t) => !wide.some((b) => b.toolId === t.toolId));
  return [...merged, ...extra];
}

/** What one frame actually renders through: base, then its batch, then its
 *  own exception. Each layer overrides by toolId, so an exception on three
 *  photographs never has to restate the twelve steps they share with the rest
 *  of the set. The engine sorts by pipeline order anyway, so this order is for
 *  reading, not for correctness. */
export function effectiveRecipe(projectId: string, frame?: string): ToolInstance[] {
  const recipe = recipeOf(projectId);
  let out = recipe.base;
  if (frame) {
    const batch = batchOfFrame(projectId, frame);
    if (batch) out = merge(out, recipe.perBatch[batch] ?? []);
    out = merge(out, recipe.perFrame[frameKey(frame)] ?? []);
  }
  return out;
}

/** What a whole batch renders through — base plus its own light. The set
 *  view keys its previews on this, and `apply` writes files from it. */
export function batchRecipe(projectId: string, batchId?: string | null): ToolInstance[] {
  const recipe = recipeOf(projectId);
  if (!batchId) return recipe.base;
  return merge(recipe.base, recipe.perBatch[batchId] ?? []);
}

/** Steps that will actually run — what the engine keys a preview on. An
 *  all-disabled recipe is the raw frame, and must produce the raw frame's key. */
export function activeSteps(projectId: string, frame?: string): ToolInstance[] {
  return effectiveRecipe(projectId, frame).filter((t) => t.enabled);
}

/** The learned colour look on a batch — or on the project when no batch
 *  is given. */
export function colorStep(
  projectId: string,
  batchId?: string | null,
): LearnedColorModel | undefined {
  return batchRecipe(projectId, batchId).find((t) => t.toolId === 'pixel-color')?.model;
}
