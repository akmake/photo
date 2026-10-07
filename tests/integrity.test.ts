/* The installation seal (electron/integrity.cjs): intact passes, a changed byte
 * or a missing file is named, an empty manifest is never "intact".
 *
 *   node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { check, sha256 } = require('../electron/integrity.cjs');

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'frameops-seal-'));
  mkdirSync(join(base, 'engine', '_internal'), { recursive: true });
  writeFileSync(join(base, 'engine', 'teza-engine.exe'), 'engine');
  writeFileSync(join(base, 'engine', '_internal', 'cleanup.pyd'), 'compiled');
  writeFileSync(join(base, 'license-public.pem'), 'key');
  const manifest = {
    version: 1,
    files: {
      'engine/teza-engine.exe': sha256(join(base, 'engine', 'teza-engine.exe')),
      'engine/_internal/cleanup.pyd': sha256(join(base, 'engine', '_internal', 'cleanup.pyd')),
      'license-public.pem': sha256(join(base, 'license-public.pem')),
    },
  };
  return { base, manifest };
}

test('an untouched installation passes', () => {
  const { base, manifest } = fixture();
  try {
    assert.deepEqual(check(base, manifest), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a changed file is named as changed', () => {
  const { base, manifest } = fixture();
  try {
    writeFileSync(join(base, 'engine', '_internal', 'cleanup.pyd'), 'compiled!');
    assert.deepEqual(check(base, manifest), [{ file: 'engine/_internal/cleanup.pyd', why: 'changed' }]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a missing file is named as missing', () => {
  const { base, manifest } = fixture();
  try {
    rmSync(join(base, 'license-public.pem'));
    assert.deepEqual(check(base, manifest), [{ file: 'license-public.pem', why: 'missing' }]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('an empty manifest is never intact', () => {
  const { base } = fixture();
  try {
    assert.equal(check(base, { version: 1, files: {} }).length, 1);
    assert.equal(check(base, null).length, 1);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
