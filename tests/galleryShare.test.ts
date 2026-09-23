import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryShareText } from '../src/studio/galleryShare.ts';

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
