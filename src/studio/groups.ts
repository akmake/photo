/* Groups — grouping rules as pure functions.
 *
 *   edit   קבוצת עריכה   a LIGHT. Lives in `batches` / `assign`, and owns a
 *                        colour recipe in `recipe.perBatch`.
 *   story  רצף           a CHAPTER of the day. Lives in `moments` /
 *                        `momentAssign`, and owns nothing but membership.
 *
 * `edit` is the product's canonical grouping. `story` remains in the schema so
 * older projects can be read and migrated without losing their organisation.
 *
 * Everything here takes a ProjectMemory and returns a NEW one. Nothing reads
 * the clock, the disk or React — which is what lets the store keep undo as a
 * pair of snapshots, and lets these rules be tested without a browser
 * (tests/groups.test.ts).
 *
 * Membership is an assignment map keyed by frame NAME, never an array inside
 * the group: a frame cannot be in two groups of one kind by construction, a
 * move is one key, and the folder can change drive letters without orphaning
 * anything.
 */

import type { ProjectMemory, StoryMoment } from '../api';

export type GroupKind = 'story' | 'edit';

export interface Group {
  id: string;
  name: string;
  order: number;
  cover?: string;
  createdAt?: string;
}

/** The only frame facts grouping needs. */
export interface GroupFrame {
  name: string;
  shot: number;
}

/** Existing project.json files predate moments. Fill the gaps instead of
 *  pretending an organisation exists (spec §214). */
export function normalize(state: ProjectMemory): ProjectMemory {
  if (state.moments && state.momentAssign && state.rejectedBoundaries) return state;
  return {
    ...state,
    moments: state.moments ?? [],
    momentAssign: state.momentAssign ?? {},
    rejectedBoundaries: state.rejectedBoundaries ?? [],
  };
}

export function groupsOf(state: ProjectMemory, kind: GroupKind): Group[] {
  const list: Group[] = kind === 'edit' ? state.batches : (state.moments ?? []);
  return [...list].sort((a, b) => a.order - b.order);
}

export function assignOf(state: ProjectMemory, kind: GroupKind): Record<string, string> {
  return kind === 'edit' ? state.assign : (state.momentAssign ?? {});
}

function put(
  state: ProjectMemory,
  kind: GroupKind,
  groups: Group[],
  assign: Record<string, string>,
): ProjectMemory {
  // Orders are rewritten 0..n-1 on every structural change, so "the order" is
  // always exactly the array order and never a sparse set of numbers to sort.
  const numbered = groups.map((g, i) => (g.order === i ? g : { ...g, order: i }));
  if (kind === 'edit') {
    return { ...state, batches: numbered as ProjectMemory['batches'], assign };
  }
  return { ...state, moments: numbered as StoryMoment[], momentAssign: assign };
}

/* ------------------------------------------------------------------ reads */

export function membersOf<F extends GroupFrame>(
  frames: F[],
  assign: Record<string, string>,
  groupId: string | null,
): F[] {
  return frames.filter((f) => (groupId === null ? !assign[f.name] : assign[f.name] === groupId));
}

/** The cover the UI shows: the chosen one while it is still a member, else the
 *  first frame in capture order. A cover that moved away never leaves a broken
 *  reference to clean up (spec §79). */
export function coverOf<F extends GroupFrame>(group: Group, members: F[]): F | undefined {
  if (!members.length) return undefined;
  return members.find((f) => f.name === group.cover) ?? members[0];
}

/** Where a group made from these frames belongs in the strip.
 *
 *  While the photographer has not reordered anything — the strip is still in
 *  capture order — a new group lands where its first frame falls in the day.
 *  Once he has reordered, his order is the truth, and the new group lands
 *  right after the one he is working in (spec §54). */
export function insertIndex<F extends GroupFrame>(
  groups: Group[],
  assign: Record<string, string>,
  frames: F[],
  newFrames: string[],
  afterId: string | null,
): number {
  const shotOf = new Map(frames.map((f) => [f.name, f.shot]));
  const firstShot = (names: string[]) => {
    let min = Infinity;
    for (const n of names) {
      const t = shotOf.get(n);
      if (t !== undefined && t < min) min = t;
    }
    return min;
  };
  const starts = groups.map((g) =>
    firstShot(frames.filter((f) => assign[f.name] === g.id).map((f) => f.name)),
  );
  const known = starts.filter((t) => t !== Infinity);
  const chronological = known.every((t, i) => i === 0 || known[i - 1] <= t);
  if (chronological) {
    const mine = firstShot(newFrames);
    if (mine !== Infinity) {
      const at = starts.findIndex((t) => t !== Infinity && t > mine);
      return at === -1 ? groups.length : at;
    }
  }
  if (afterId) {
    const i = groups.findIndex((g) => g.id === afterId);
    if (i !== -1) return i + 1;
  }
  return groups.length;
}

/* ---------------------------------------------------------------- writes */

export function createGroup(
  state: ProjectMemory,
  kind: GroupKind,
  group: { id: string; name: string; createdAt: string },
  frames: string[],
  at: number,
): ProjectMemory {
  const groups = groupsOf(state, kind);
  const made: Group = kind === 'story'
    ? { id: group.id, name: group.name, order: 0, createdAt: group.createdAt }
    : { id: group.id, name: group.name, order: 0 };
  const next = [...groups];
  next.splice(Math.max(0, Math.min(at, next.length)), 0, made);
  const assign = { ...assignOf(state, kind) };
  for (const f of frames) assign[f] = group.id;
  return put(state, kind, next, assign);
}

/** One move, however many frames — one undo entry, one write (spec §48). */
export function moveFrames(
  state: ProjectMemory,
  kind: GroupKind,
  frames: string[],
  targetId: string | null,
): ProjectMemory {
  const current = assignOf(state, kind);
  const assign = { ...current };
  let changed = false;
  for (const f of frames) {
    if (targetId) {
      if (assign[f] !== targetId) { assign[f] = targetId; changed = true; }
    } else if (f in assign) {
      delete assign[f];
      changed = true;
    }
  }
  if (!changed) return state;
  return put(state, kind, groupsOf(state, kind), assign);
}

/** Frames go back to unassigned; nothing is deleted from disk. For an edit
 *  group the group's own recipe goes with it — and ONLY that group's. */
export function deleteGroup(state: ProjectMemory, kind: GroupKind, id: string): ProjectMemory {
  const assign: Record<string, string> = {};
  for (const [name, gid] of Object.entries(assignOf(state, kind))) {
    if (gid !== id) assign[name] = gid;
  }
  let next = put(state, kind, groupsOf(state, kind).filter((g) => g.id !== id), assign);
  if (kind === 'edit' && id in state.recipe.perBatch) {
    const { [id]: _dropped, ...perBatch } = state.recipe.perBatch;
    next = { ...next, recipe: { ...next.recipe, perBatch } };
  }
  return next;
}

export function renameGroup(
  state: ProjectMemory,
  kind: GroupKind,
  id: string,
  name: string,
  fallback: string,
): ProjectMemory {
  const clean = name.trim() || fallback;
  const groups = groupsOf(state, kind);
  if (!groups.some((g) => g.id === id && g.name !== clean)) return state;
  return put(state, kind, groups.map((g) => (g.id === id ? { ...g, name: clean } : g)), assignOf(state, kind));
}

/** Order only. Membership, names and timestamps are untouched (spec §22). */
export function reorderGroups(state: ProjectMemory, kind: GroupKind, orderedIds: string[]): ProjectMemory {
  const groups = groupsOf(state, kind);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const next: Group[] = [];
  for (const id of orderedIds) {
    const g = byId.get(id);
    if (g) { next.push(g); byId.delete(id); }
  }
  // Anything the caller did not mention keeps its relative place at the end
  // rather than vanishing.
  for (const g of groups) if (byId.has(g.id)) next.push(g);
  if (next.every((g, i) => g.id === groups[i].id)) return state;
  return put(state, kind, next, assignOf(state, kind));
}

export function setCover(state: ProjectMemory, kind: GroupKind, id: string, frame: string): ProjectMemory {
  const groups = groupsOf(state, kind);
  return put(state, kind, groups.map((g) => (g.id === id ? { ...g, cover: frame } : g)), assignOf(state, kind));
}

/** Everything from `fromFrame` onward (in the order given — capture order)
 *  leaves `groupId` for a new group placed right after it (spec §67). */
export function splitGroup(
  state: ProjectMemory,
  kind: GroupKind,
  groupId: string,
  orderedMembers: string[],
  fromFrame: string,
  group: { id: string; name: string; createdAt: string },
): ProjectMemory {
  const at = orderedMembers.indexOf(fromFrame);
  if (at <= 0) return state; // splitting before the first frame is not a split
  const moving = orderedMembers.slice(at);
  const index = groupsOf(state, kind).findIndex((g) => g.id === groupId);
  return createGroup(state, kind, group, moving, index === -1 ? Infinity : index + 1);
}

/** Two edit groups whose looks differ cannot be merged in silence (spec §72). */
export function recipesDiffer(state: ProjectMemory, a: string, b: string): boolean {
  const ra = state.recipe.perBatch[a] ?? [];
  const rb = state.recipe.perBatch[b] ?? [];
  if (!ra.length && !rb.length) return false;
  return JSON.stringify(ra) !== JSON.stringify(rb);
}

export type RecipeChoice = 'source' | 'target' | 'none';

/** `source` folds into `target`; `source` disappears.
 *
 *  Kept: every frame of both, the name of the group the photographer started
 *  from unless he chose the other, the target's cover (spec §71). For edit
 *  groups the caller must say which look survives when they differ. */
export function mergeGroups(
  state: ProjectMemory,
  kind: GroupKind,
  sourceId: string,
  targetId: string,
  opts: { keepName: 'source' | 'target'; recipe?: RecipeChoice },
): ProjectMemory {
  if (sourceId === targetId) return state;
  const groups = groupsOf(state, kind);
  const source = groups.find((g) => g.id === sourceId);
  const target = groups.find((g) => g.id === targetId);
  if (!source || !target) return state;

  const assign = { ...assignOf(state, kind) };
  for (const [name, gid] of Object.entries(assign)) if (gid === sourceId) assign[name] = targetId;
  const name = opts.keepName === 'source' ? source.name : target.name;
  const next = groups
    .filter((g) => g.id !== sourceId)
    .map((g) => (g.id === targetId ? { ...g, name } : g));
  let out = put(state, kind, next, assign);

  if (kind === 'edit') {
    const { [sourceId]: sourceRecipe, ...rest } = state.recipe.perBatch;
    const perBatch = { ...rest };
    const choice = opts.recipe ?? 'target';
    if (choice === 'source') {
      if (sourceRecipe) perBatch[targetId] = sourceRecipe;
      else delete perBatch[targetId];
    } else if (choice === 'none') {
      delete perBatch[targetId];
    }
    out = { ...out, recipe: { ...out.recipe, perBatch } };
  }
  return out;
}

/* ------------------------------------------------------------ suggestions */

export type BoundaryReason = 'time-gap' | 'visual-change';

export interface SuggestedBoundary {
  /** the last frame BEFORE the cut */
  afterFrame: string;
  /** the first frame after it */
  beforeFrame: string;
  reasons: BoundaryReason[];
  strength: 'strong' | 'medium';
  /** minutes of silence across the cut, rounded; 0 when not a gap */
  gapMinutes: number;
}

/** Turn the engine's contiguous runs into cuts between neighbours.
 *
 *  The engine only says "a new scene starts here". Why is recovered from the
 *  frames themselves: a silence longer than the engine's own gap is a time-gap,
 *  anything else was the pictures changing. Both at once is a strong cut.
 *  No embedding score ever reaches the screen (spec §92, §286). */
export function boundariesFromRuns<F extends GroupFrame>(
  runs: string[][],
  frames: F[],
  gapSeconds: number,
  rejected: string[],
): SuggestedBoundary[] {
  const shotOf = new Map(frames.map((f) => [f.name, f.shot]));
  const refused = new Set(rejected);
  const out: SuggestedBoundary[] = [];
  for (let i = 1; i < runs.length; i += 1) {
    const prev = runs[i - 1];
    const cur = runs[i];
    if (!prev.length || !cur.length) continue;
    const afterFrame = prev[prev.length - 1];
    const beforeFrame = cur[0];
    if (refused.has(afterFrame)) continue;
    const gap = (shotOf.get(beforeFrame) ?? 0) - (shotOf.get(afterFrame) ?? 0);
    const timeGap = gap > gapSeconds;
    out.push({
      afterFrame,
      beforeFrame,
      reasons: timeGap ? ['time-gap', 'visual-change'] : ['visual-change'],
      strength: timeGap ? 'strong' : 'medium',
      gapMinutes: timeGap ? Math.round(gap / 60) : 0,
    });
  }
  return out;
}

/** Accept cuts over an ordered stretch of frames, as ONE state change.
 *
 *  The stretch is split at every accepted cut AND wherever membership already
 *  changes, so each run is homogeneous. Then:
 *    · an unassigned run becomes a new group, placed where it falls in the day
 *    · the first run of an existing group stays in it
 *    · every later run of that group is split off into a new group right after
 *  So the same call is "accept all" on a fresh shoot and "split here" inside a
 *  group. */
export function applyCuts<F extends GroupFrame>(
  state: ProjectMemory,
  kind: GroupKind,
  ordered: string[],
  cutsAfter: Set<string>,
  frames: F[],
  make: (run: string[]) => { id: string; name: string; createdAt: string },
): ProjectMemory {
  const assign = assignOf(state, kind);
  const runs: string[][] = [];
  let run: string[] = [];
  let owner: string | null | undefined;
  for (const name of ordered) {
    const m = assign[name] ?? null;
    if (run.length && m !== owner) { runs.push(run); run = []; }
    owner = m;
    run.push(name);
    if (cutsAfter.has(name)) { runs.push(run); run = []; owner = undefined; }
  }
  if (run.length) runs.push(run);

  let s = state;
  const lastPiece = new Map<string, string>();
  for (const r of runs) {
    const m = assign[r[0]] ?? null;
    if (m === null) {
      const meta = make(r);
      const at = insertIndex(groupsOf(s, kind), assignOf(s, kind), frames, r, null);
      s = createGroup(s, kind, meta, r, at);
    } else if (!lastPiece.has(m)) {
      lastPiece.set(m, m);
    } else {
      const meta = make(r);
      const after = groupsOf(s, kind).findIndex((g) => g.id === lastPiece.get(m));
      s = createGroup(s, kind, meta, r, after + 1);
      lastPiece.set(m, meta.id);
    }
  }
  return s;
}

/** Remember a suggested cut the photographer turned down (spec §88). */
export function rejectBoundary(state: ProjectMemory, afterFrame: string): ProjectMemory {
  const list = state.rejectedBoundaries ?? [];
  if (list.includes(afterFrame)) return state;
  return { ...state, rejectedBoundaries: [...list, afterFrame] };
}

/** Starting point on request only (spec §215): each edit group becomes a story
 *  moment with the same name, order and members — for frames not already in a
 *  moment. Never run automatically; the meanings differ. */
export function copyEditGroupsAsMoments(
  state: ProjectMemory,
  make: (batch: Group) => { id: string; createdAt: string },
): ProjectMemory {
  let s = normalize(state);
  const taken = s.momentAssign!;
  for (const batch of groupsOf(s, 'edit')) {
    const members = Object.entries(s.assign)
      .filter(([name, gid]) => gid === batch.id && !taken[name])
      .map(([name]) => name);
    if (!members.length) continue;
    const meta = make(batch);
    s = createGroup(s, 'story', { ...meta, name: batch.name }, members, Infinity);
  }
  return s;
}

/** One-way, additive migration for projects created while story moments were
 * exposed as a separate mode. Existing edit assignments always win. */
export function copyStoryMomentsAsEditGroups(
  state: ProjectMemory,
  make: (moment: Group) => { id: string; createdAt: string },
): ProjectMemory {
  let s = normalize(state);
  const taken = s.assign;
  for (const moment of groupsOf(s, 'story')) {
    const members = Object.entries(s.momentAssign ?? {})
      .filter(([name, gid]) => gid === moment.id && !taken[name])
      .map(([name]) => name);
    if (!members.length) continue;
    const meta = make(moment);
    s = createGroup(s, 'edit', { ...meta, name: moment.name }, members, Infinity);
  }
  return s;
}

/** Cut an ordered list of frames at the accepted boundaries into runs. */
export function runsFromBoundaries(ordered: string[], cutsAfter: Set<string>): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const name of ordered) {
    run.push(name);
    if (cutsAfter.has(name)) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs;
}

/* ---------------------------------------------------------------- history */

/** The part of project.json a group operation can touch. Snapshots of this
 *  are the undo stack (spec §228: the state is small, snapshots are fine). */
export interface GroupSlice {
  batches: ProjectMemory['batches'];
  assign: Record<string, string>;
  moments: StoryMoment[];
  momentAssign: Record<string, string>;
  rejectedBoundaries: string[];
  perBatch: ProjectMemory['recipe']['perBatch'];
}

export function sliceOf(state: ProjectMemory): GroupSlice {
  const s = normalize(state);
  return {
    batches: s.batches,
    assign: s.assign,
    moments: s.moments!,
    momentAssign: s.momentAssign!,
    rejectedBoundaries: s.rejectedBoundaries!,
    perBatch: s.recipe.perBatch,
  };
}

/** True when nothing outside this history has changed the groups since
 *  `slice` was taken. Operations keep references for what they do not touch,
 *  so identity is an exact test. */
export function sliceIsCurrent(state: ProjectMemory, slice: GroupSlice): boolean {
  const s = sliceOf(state);
  return s.batches === slice.batches
    && s.assign === slice.assign
    && s.moments === slice.moments
    && s.momentAssign === slice.momentAssign
    && s.rejectedBoundaries === slice.rejectedBoundaries;
}

/** Put `to` back, touching only the recipe entries that the operation between
 *  `from` and `to` changed. A look graded on another batch in the meantime is
 *  not rolled back by undoing a move here. */
export function restoreSlice(state: ProjectMemory, from: GroupSlice, to: GroupSlice): ProjectMemory {
  const perBatch = { ...state.recipe.perBatch };
  const keys = new Set([...Object.keys(from.perBatch), ...Object.keys(to.perBatch)]);
  for (const k of keys) {
    if (from.perBatch[k] === to.perBatch[k]) continue;
    if (to.perBatch[k] === undefined) delete perBatch[k];
    else perBatch[k] = to.perBatch[k];
  }
  return {
    ...state,
    batches: to.batches,
    assign: to.assign,
    moments: to.moments,
    momentAssign: to.momentAssign,
    rejectedBoundaries: to.rejectedBoundaries,
    recipe: { ...state.recipe, perBatch },
  };
}
