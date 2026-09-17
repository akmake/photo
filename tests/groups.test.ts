/* Rules of the two groupings, without a browser.
 *
 *   node --test tests/
 *
 * Node runs TypeScript natively (type stripping), and groups.ts imports types
 * only, so no build step and no test dependency is involved. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCuts, copyEditGroupsAsMoments, copyStoryMomentsAsEditGroups, rejectBoundary,
  boundariesFromRuns, coverOf, createGroup, deleteGroup, insertIndex, mergeGroups,
  membersOf, moveFrames, normalize, recipesDiffer, renameGroup, reorderGroups,
  restoreSlice, runsFromBoundaries, setCover, sliceIsCurrent, sliceOf, splitGroup,
} from '../src/studio/groups.ts';

const tool = (id: string, v = 1) => ({ toolId: id, params: { v }, enabled: true });

function base() {
  return normalize({
    version: 1,
    batches: [
      { id: 'b1', name: 'גן', order: 0 },
      { id: 'b2', name: 'אולם', order: 1 },
      { id: 'b3', name: 'רחבה', order: 2 },
    ],
    assign: { a: 'b1', b: 'b1', c: 'b2', d: 'b2', e: 'b3' },
    statuses: { a: 'ready' },
    recipe: {
      version: 1,
      base: [tool('clean')],
      perBatch: { b1: [tool('wb', 1)], b2: [tool('wb', 2)] },
      perFrame: { a: [tool('spot')] },
    },
    gallery: null,
  } as never);
}

const frames = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, i) => ({ name, shot: 1000 + i * 60 }));
const meta = { id: 'n1', name: 'חדש', createdAt: '2026-09-14' };

/* ---------------------------------------------------------------- store */

test('normalize fills moments on an old project.json without inventing any', () => {
  const s = base();
  assert.deepEqual(s.moments, []);
  assert.deepEqual(s.momentAssign, {});
  assert.deepEqual(s.rejectedBoundaries, []);
});

test('move single: frame a from b1 to b2', () => {
  const s = moveFrames(base(), 'edit', ['a'], 'b2');
  assert.equal(s.assign.a, 'b2');
  assert.equal(s.assign.b, 'b1');
});

test('bulk move: mixed origins land in one target in one state', () => {
  const s = moveFrames(base(), 'edit', ['a', 'c', 'e', 'f'], 'b3');
  for (const f of ['a', 'c', 'e', 'f']) assert.equal(s.assign[f], 'b3');
});

test('unassign: frame back to null', () => {
  const s = moveFrames(base(), 'edit', ['a'], null);
  assert.equal('a' in s.assign, false);
  assert.deepEqual(membersOf(frames, s.assign, null).map((f) => f.name), ['a', 'f', 'g']);
});

test('moving or unassigning frames never touches any recipe', () => {
  const before = base();
  const moved = moveFrames(before, 'edit', ['a', 'c'], 'b3');
  const out = moveFrames(moved, 'edit', ['e'], null);
  assert.equal(out.recipe, before.recipe);
});

test('group delete: every member frame returns to null', () => {
  const s = deleteGroup(base(), 'edit', 'b1');
  assert.equal('a' in s.assign, false);
  assert.equal('b' in s.assign, false);
  assert.equal(s.assign.c, 'b2');
  assert.deepEqual(s.batches.map((b) => b.id), ['b2', 'b3']);
});

test('edit group delete removes ONLY that group’s recipe', () => {
  const s = deleteGroup(base(), 'edit', 'b1');
  assert.equal('b1' in s.recipe.perBatch, false);
  assert.deepEqual(s.recipe.perBatch.b2, [tool('wb', 2)]);
  assert.deepEqual(s.recipe.base, [tool('clean')]);
  assert.deepEqual(s.recipe.perFrame, { a: [tool('spot')] });
});

test('story moment delete touches no recipe and no batch', () => {
  let s = createGroup(base(), 'story', meta, ['a', 'b'], 0);
  const recipe = s.recipe;
  const batches = s.batches;
  s = deleteGroup(s, 'story', 'n1');
  assert.equal(s.recipe, recipe);
  assert.equal(s.batches, batches);
  assert.deepEqual(s.momentAssign, {});
});

test('reorder changes order only, never membership', () => {
  const before = base();
  const s = reorderGroups(before, 'edit', ['b3', 'b1', 'b2']);
  assert.deepEqual(s.batches.map((b) => [b.id, b.order]), [['b3', 0], ['b1', 1], ['b2', 2]]);
  assert.equal(s.assign, before.assign);
});

test('rename changes the name only; empty falls back', () => {
  const before = base();
  const s = renameGroup(before, 'edit', 'b1', '  ', 'ללא שם');
  assert.equal(s.batches.find((b) => b.id === 'b1')!.name, 'ללא שם');
  assert.equal(s.assign, before.assign);
});

test('cover moved away: fallback is the first member in capture order', () => {
  let s = setCover(base(), 'edit', 'b1', 'b');
  s = moveFrames(s, 'edit', ['b'], 'b2');
  const g = s.batches.find((x) => x.id === 'b1')!;
  const members = membersOf(frames, s.assign, 'b1');
  assert.equal(coverOf(g, members)!.name, 'a');
});

test('story and edit groupings are independent', () => {
  const before = base();
  const s1 = createGroup(before, 'story', meta, ['a', 'c'], 0);
  assert.equal(s1.assign, before.assign);
  assert.equal(s1.batches, before.batches);
  const s2 = moveFrames(s1, 'edit', ['a'], 'b3');
  assert.equal(s2.momentAssign, s1.momentAssign);
  assert.equal(s2.moments, s1.moments);
});

/* ---------------------------------------------------- structural operations */

test('split: new group inserted right after, frames from the cut onward', () => {
  const s = splitGroup(base(), 'edit', 'b1', ['a', 'b'], 'b', meta);
  assert.deepEqual(s.batches.map((b) => b.id), ['b1', 'n1', 'b2', 'b3']);
  assert.equal(s.assign.a, 'b1');
  assert.equal(s.assign.b, 'n1');
});

test('split before the first frame is refused', () => {
  const before = base();
  assert.equal(splitGroup(before, 'edit', 'b1', ['a', 'b'], 'a', meta), before);
});

test('merge: source disappears, frames join target, initiator name kept', () => {
  const s = mergeGroups(base(), 'story', 'x', 'y', { keepName: 'source' });
  assert.equal(s.moments!.length, 0); // unknown ids: no-op

  let t = createGroup(base(), 'story', { ...meta, id: 'm1', name: 'ריקוד ראשון' }, ['a'], 0);
  t = createGroup(t, 'story', { ...meta, id: 'm2', name: 'ריקודים' }, ['b', 'c'], 1);
  t = setCover(t, 'story', 'm2', 'c');
  const m = mergeGroups(t, 'story', 'm1', 'm2', { keepName: 'source' });
  assert.deepEqual(m.moments!.map((g) => [g.id, g.name, g.cover]), [['m2', 'ריקוד ראשון', 'c']]);
  assert.deepEqual(membersOf(frames, m.momentAssign!, 'm2').map((f) => f.name), ['a', 'b', 'c']);
});

test('edit merge with different looks: the chosen recipe survives', () => {
  const s = base();
  assert.equal(recipesDiffer(s, 'b1', 'b2'), true);
  assert.equal(recipesDiffer(s, 'b3', 'b3'), false);
  const keepSource = mergeGroups(s, 'edit', 'b1', 'b2', { keepName: 'target', recipe: 'source' });
  assert.deepEqual(keepSource.recipe.perBatch, { b2: [tool('wb', 1)] });
  const none = mergeGroups(s, 'edit', 'b1', 'b2', { keepName: 'target', recipe: 'none' });
  assert.deepEqual(none.recipe.perBatch, {});
  const target = mergeGroups(s, 'edit', 'b1', 'b2', { keepName: 'target', recipe: 'target' });
  assert.deepEqual(target.recipe.perBatch, { b2: [tool('wb', 2)] });
});

test('insertIndex: chronological strip gets the new group where it falls in the day', () => {
  const s = base(); // b1 starts a(1000), b2 c(1120), b3 e(1240)
  assert.equal(insertIndex(s.batches, s.assign, frames, ['d2'], null), 3); // unknown frames: end
  const withF = insertIndex(s.batches, s.assign, [...frames, { name: 'x', shot: 1100 }], ['x'], null);
  assert.equal(withF, 1);
});

test('insertIndex: after a manual reorder, lands after the active group', () => {
  const s = reorderGroups(base(), 'edit', ['b3', 'b1', 'b2']);
  const groups = s.batches;
  assert.equal(insertIndex(groups, s.assign, frames, ['f'], 'b1'), 2);
});

/* ------------------------------------------------------------- suggestions */

test('boundaries: gap reason and strength come from the frames, rejected are skipped', () => {
  const fr = [
    { name: 'a', shot: 0 }, { name: 'b', shot: 60 },
    { name: 'c', shot: 120 },
    { name: 'd', shot: 3000 },
  ];
  const runs = [['a', 'b'], ['c'], ['d']];
  const out = boundariesFromRuns(runs, fr, 720, []);
  assert.deepEqual(out.map((b) => [b.afterFrame, b.strength, b.gapMinutes]), [['b', 'medium', 0], ['c', 'strong', 48]]);
  assert.equal(boundariesFromRuns(runs, fr, 720, ['b']).length, 1);
});

test('applyCuts on a fresh shoot: every run becomes a moment, in day order', () => {
  let n = 0;
  const make = (run: string[]) => ({ id: `m${++n}`, name: run[0], createdAt: 'x' });
  const s = applyCuts(base(), 'story', ['a', 'b', 'c', 'd', 'e'], new Set(['b', 'c']), frames, make);
  assert.deepEqual(s.moments!.map((m) => m.name), ['a', 'c', 'd']);
  assert.equal(s.momentAssign!.b, 'm1');
  assert.equal(s.momentAssign!.c, 'm2');
  assert.equal(s.momentAssign!.e, 'm3');
});

test('applyCuts inside a group splits it and keeps the first piece', () => {
  let n = 0;
  const make = (run: string[]) => ({ id: `n${++n}`, name: run[0], createdAt: 'x' });
  const s = applyCuts(base(), 'edit', ['c', 'd'], new Set(['c']), frames, make);
  assert.deepEqual(s.batches.map((b) => b.id), ['b1', 'b2', 'n1', 'b3']);
  assert.equal(s.assign.c, 'b2');
  assert.equal(s.assign.d, 'n1');
});

test('applyCuts across a membership change does not merge different groups', () => {
  let n = 0;
  const make = (run: string[]) => ({ id: `n${++n}`, name: run[0], createdAt: 'x' });
  const before = base();
  const s = applyCuts(before, 'edit', ['a', 'b', 'c', 'd'], new Set(), frames, make);
  assert.deepEqual(s.assign, before.assign);
});

test('rejectBoundary is remembered once', () => {
  const s = rejectBoundary(rejectBoundary(base(), 'b'), 'b');
  assert.deepEqual(s.rejectedBoundaries, ['b']);
});

test('copy edit groups as moments: same names and members, skips frames already in a moment', () => {
  let n = 0;
  let s = createGroup(base(), 'story', meta, ['a'], 0);
  s = copyEditGroupsAsMoments(s, () => ({ id: `c${++n}`, createdAt: 'x' }));
  assert.deepEqual(s.moments!.map((m) => m.name), ['חדש', 'גן', 'אולם', 'רחבה']);
  assert.equal(s.momentAssign!.a, 'n1');
  assert.equal(s.momentAssign!.b, 'c1');
  assert.equal(s.assign.a, 'b1'); // edit groups untouched
});

test('copy legacy story moments as edit groups without deleting the legacy data', () => {
  let n = 0;
  const original = base();
  const legacy = {
    ...original,
    batches: [],
    assign: {},
    moments: [
      { id: 'm1', name: 'קבלת פנים', order: 0 },
      { id: 'm2', name: 'ריקודים', order: 1 },
    ],
    momentAssign: { a: 'm1', b: 'm1', c: 'm2' },
  };
  const s = copyStoryMomentsAsEditGroups(legacy, () => ({ id: `b${++n}`, createdAt: 'x' }));
  assert.deepEqual(s.batches.map((g) => g.name), ['קבלת פנים', 'ריקודים']);
  assert.deepEqual(s.assign, { a: 'b1', b: 'b1', c: 'b2' });
  assert.equal(s.moments, legacy.moments);
  assert.equal(s.momentAssign, legacy.momentAssign);
});

test('runsFromBoundaries cuts an ordered list', () => {
  assert.deepEqual(runsFromBoundaries(['a', 'b', 'c', 'd'], new Set(['b'])), [['a', 'b'], ['c', 'd']]);
});

/* ---------------------------------------------------------------- history */

test('undo merge restores source with name, order, members and recipe', () => {
  const s0 = base();
  const before = sliceOf(s0);
  const s1 = mergeGroups(s0, 'edit', 'b1', 'b2', { keepName: 'source', recipe: 'source' });
  const after = sliceOf(s1);
  assert.equal(sliceIsCurrent(s1, after), true);
  const undone = restoreSlice(s1, after, before);
  assert.deepEqual(undone.batches, s0.batches);
  assert.deepEqual(undone.assign, s0.assign);
  assert.deepEqual(undone.recipe.perBatch, s0.recipe.perBatch);
  const redone = restoreSlice(undone, before, after);
  assert.deepEqual(redone.batches, s1.batches);
  assert.deepEqual(redone.recipe.perBatch, s1.recipe.perBatch);
});

test('undo move returns frames to the same groups and leaves other looks alone', () => {
  const s0 = base();
  const before = sliceOf(s0);
  const s1 = moveFrames(s0, 'edit', ['a', 'c'], 'b3');
  const after = sliceOf(s1);
  // a look graded on b2 AFTER the move must survive undoing the move
  const graded = { ...s1, recipe: { ...s1.recipe, perBatch: { ...s1.recipe.perBatch, b2: [tool('wb', 9)] } } };
  const undone = restoreSlice(graded, after, before);
  assert.equal(undone.assign.a, 'b1');
  assert.equal(undone.assign.c, 'b2');
  assert.deepEqual(undone.recipe.perBatch.b2, [tool('wb', 9)]);
});

test('a change made outside the history makes it stale', () => {
  const s0 = base();
  const s1 = moveFrames(s0, 'edit', ['a'], 'b2');
  const after = sliceOf(s1);
  const outside = { ...s1, assign: { ...s1.assign, z: 'b1' } };
  assert.equal(sliceIsCurrent(outside, after), false);
});
