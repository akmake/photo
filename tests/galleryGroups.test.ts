import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupGalleryItems } from '../src/gallery/groups.ts';
import type { Item } from '../src/gallery/api.ts';
import { galleryShareText } from '../src/studio/galleryShare.ts';

const item = (id: string, groupId?: string, groupName?: string): Item => ({
  id,
  groupId,
  groupName,
  color: '#ffffff',
  aspect: 1.5,
  thumb: `${id}-thumb.jpg`,
  preview: `${id}.jpg`,
  version: 1,
  albumIds: [],
  clientDone: false,
  notes: [],
});

test('client gallery keeps original groups and capture order', () => {
  const groups = groupGalleryItems([
    item('a', 'b1', 'חופה'),
    item('b', 'b2', 'ריקודים'),
    item('c', 'b1', 'חופה'),
  ]);
  assert.deepEqual(groups.map((group) => group.name), ['חופה', 'ריקודים']);
  assert.deepEqual(groups[0].items.map((entry) => entry.id), ['a', 'c']);
  assert.deepEqual(groups[1].items.map((entry) => entry.id), ['b']);
});

test('old or unassigned photos remain visible in one fallback group', () => {
  const groups = groupGalleryItems([item('a'), item('b')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'תמונות נוספות');
  assert.deepEqual(groups[0].items.map((entry) => entry.id), ['a', 'b']);
});

test('share message always carries the link and both credentials', () => {
  const message = galleryShareText(
    'משפחת כהן',
    'https://gallery.example/g/abc',
    'cohen-123',
    'safe-pass',
  );
  assert.match(message, /https:\/\/gallery\.example\/g\/abc/);
  assert.match(message, /cohen-123/);
  assert.match(message, /safe-pass/);
});
