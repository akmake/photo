/* IS THE INSTALLED ENGINE THE ONE WE SHIPPED?
 *
 * app.asar is sealed by Electron itself (the EnableEmbeddedAsarIntegrityValidation
 * fuse): one changed byte and the app does not start. But the engine and the
 * license files live OUTSIDE app.asar, beside it in resources/, where that seal
 * does not reach — and the engine is where the license gate runs.
 *
 * So the build writes a list of their SHA-256 digests (scripts/engine-manifest.cjs)
 * into engine-manifest.json, INSIDE app.asar, where it is sealed in turn. Before
 * the engine is started, every file on the list is hashed and compared. A
 * missing or changed file is a damaged installation: the engine is not
 * started, and the window says so.
 *
 * What is listed: the engine's executable, our own compiled modules (.pyd),
 * and the two license files. Not the third-party libraries — they are open
 * source and hundreds of megabytes, and hashing them would cost every launch
 * seconds for nothing to protect. */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Every listed file that is missing or not what was shipped. Empty = intact.
 *  `base` is the folder the manifest's paths are relative to (resources/). */
function check(base, manifest) {
  const problems = [];
  const files = manifest && manifest.files;
  if (!files || typeof files !== 'object' || !Object.keys(files).length) {
    return [{ file: '(manifest)', why: 'empty' }];
  }
  for (const [rel, digest] of Object.entries(files)) {
    const file = path.join(base, rel);
    if (!fs.existsSync(file)) { problems.push({ file: rel, why: 'missing' }); continue; }
    if (sha256(file) !== digest) problems.push({ file: rel, why: 'changed' });
  }
  return problems;
}

/** The packaged check: the manifest beside this file, against resources/. A
 *  build without a manifest is treated as damaged — fail closed. */
function checkInstallation(resourcesPath) {
  const manifestFile = path.join(__dirname, 'engine-manifest.json');
  if (!fs.existsSync(manifestFile)) return [{ file: 'engine-manifest.json', why: 'missing' }];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    return [{ file: 'engine-manifest.json', why: 'unreadable' }];
  }
  return check(resourcesPath, manifest);
}

module.exports = { sha256, check, checkInstallation };
