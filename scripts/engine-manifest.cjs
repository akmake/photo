/* npm run protect:manifest — the seal on what lives outside app.asar.
 *
 * Writes electron/engine-manifest.json: the SHA-256 of every file the installed
 * shell will check before it starts the engine (see electron/integrity.cjs).
 * Paths are as they land under resources/ — the same mapping as
 * package.json build.extraResources.
 *
 * Fails, and writes nothing, when the engine was not built protected: a
 * manifest of a readable engine would seal the very thing we set out to hide. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../electron/integrity.cjs');

const root = path.join(__dirname, '..');
const engineDir = path.join(root, 'engine', '.dist', 'teza-engine');
const protectedList = path.join(root, 'engine', '.protect', 'modules.json');
const out = path.join(root, 'electron', 'engine-manifest.json');

function fail(message) {
  process.stderr.write(`protect:manifest — ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(engineDir, 'teza-engine.exe'))) fail('engine/.dist/teza-engine is missing — run npm run build:engine');
if (!fs.existsSync(protectedList)) fail('engine/.protect/modules.json is missing — the engine was not built protected');

const built = JSON.parse(fs.readFileSync(protectedList, 'utf8'));
const files = {};
files['engine/teza-engine.exe'] = sha256(path.join(engineDir, 'teza-engine.exe'));

// PyInstaller places our .pyd files at the root of its contents folder.
const contents = path.join(engineDir, '_internal');
const missing = [];
for (const name of built.files) {
  const file = path.join(contents, name);
  if (!fs.existsSync(file)) { missing.push(name); continue; }
  files[`engine/_internal/${name}`] = sha256(file);
}
if (missing.length) fail(`compiled modules missing from the engine build:\n  ${missing.join('\n  ')}`);

for (const [from, to] of [['release-config/license.json', 'license-config.json'], ['release-config/license-public.pem', 'license-public.pem']]) {
  const file = path.join(root, from);
  if (!fs.existsSync(file)) fail(`${from} is missing`);
  files[to] = sha256(file);
}

fs.writeFileSync(out, JSON.stringify({ version: 1, built: new Date().toISOString(), files }, null, 2));
process.stdout.write(`protect:manifest — ${Object.keys(files).length} files sealed → electron/engine-manifest.json\n`);
