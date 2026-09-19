import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GalleryLink, ProjectMemory } from '../src/api.ts';
import { withClientChoice } from '../src/studio/clientChoice.ts';

const link: GalleryLink = {
  galleryId: 'g1',
  slug: 'family',
  username: 'family-1',
  createdAt: 1,
  published: 4,
};

const memory: ProjectMemory = {
  version: 1,
  batches: [
    { id: 'garden', name: 'גינה', order: 0 },
    { id: 'dance', name: 'ריקודים', order: 1 },
  ],
  assign: { 'a.jpg': 'garden', 'b.jpg': 'garden', 'c.jpg': 'dance' },
  statuses: {},
  recipe: {
    version: 1,
    base: [],
    perBatch: { garden: [{ toolId: 'tone-color', enabled: true, params: { exposure: 4 } }] },
    perFrame: {},
  },
  gallery: link,
};

test('client choice remains a filter and preserves every original batch assignment', () => {
  const next = withClientChoice(memory, link, {
    matched: ['a.jpg', 'c.jpg', 'a.jpg'],
    missing: ['gone.jpg'],
    albums: {
      album: { name: 'אלבום', quota: 2, frames: ['a.jpg', 'c.jpg'] },
    },
    groups: {
      'a.jpg': { id: 'garden', name: 'גינה' },
      'c.jpg': { id: 'dance', name: 'ריקודים' },
    },
  }, 99);

  assert.deepEqual(next.batches, memory.batches);
  assert.deepEqual(next.assign, memory.assign);
  assert.deepEqual(next.recipe, memory.recipe);
  assert.deepEqual(next.gallery?.selectedFrames, ['a.jpg', 'c.jpg']);
  assert.equal(next.gallery?.importedAt, 99);
  assert.deepEqual(next.gallery?.missing, ['gone.jpg']);
  assert.deepEqual(next.gallery?.selectionGroups?.['c.jpg'], { id: 'dance', name: 'ריקודים' });
});
