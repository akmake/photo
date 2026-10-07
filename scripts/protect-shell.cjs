/* npm run protect:shell — the shell, as the packaged build carries it.
 *
 *   electron/main.cjs (+ updater.cjs, serverOrigin.cjs)
 *     → one bundle, minified, comments gone          (esbuild)
 *     → V8 bytecode: electron/shell.jsc              (this repo's Electron)
 *
 * shell.jsc is git-ignored: it is a build product, rebuilt on every package.
 * The bytecode is made by the electron binary in node_modules — the same one
 * electron-builder packages — running as plain Node, because a cache from any
 * other V8 is rejected at launch (see electron/bytecode.cjs).
 *
 * --verify loads the result back the way the installed app will, and stops
 * before running it: proof the cache is accepted, without starting the app
 * (which would start an engine). */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shellDir = path.join(root, 'electron');
const bundle = path.join(shellDir, '.shell.bundle.cjs');
const out = path.join(shellDir, 'shell.jsc');

function fail(message) {
  process.stderr.write(`protect:shell — ${message}\n`);
  process.exit(1);
}

function electronBinary() {
  // The electron package's main export IS the path of its binary.
  const bin = require(path.join(root, 'node_modules', 'electron'));
  if (!fs.existsSync(bin)) fail(`Electron binary not found: ${bin}`);
  return bin;
}

function runInElectron(args) {
  const r = spawnSync(electronBinary(), args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  if (r.status !== 0) fail(`${args.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r.stdout;
}

if (process.argv.includes('--in-electron-compile')) {
  // Second half, running INSIDE Electron's V8.
  const { compile } = require(path.join(shellDir, 'bytecode.cjs'));
  fs.writeFileSync(out, compile(fs.readFileSync(bundle, 'utf8')));
  process.exit(0);
}

if (process.argv.includes('--in-electron-verify')) {
  const { load } = require(path.join(shellDir, 'bytecode.cjs'));
  const fn = load(out);
  if (typeof fn !== 'function') fail('the bytecode did not yield the module function');
  process.stdout.write(`ok · ${fs.statSync(out).size} bytes · ${process.versions.electron}\n`);
  process.exit(0);
}

if (process.argv.includes('--verify')) {
  if (!fs.existsSync(out)) fail('electron/shell.jsc is missing — run npm run protect:shell first');
  process.stdout.write(runInElectron([__filename, '--in-electron-verify']));
  process.exit(0);
}

// 1. Bundle + minify. electron is the runtime; electron-updater stays an
//    ordinary dependency inside app.asar (it is open source, and it loads
//    files of its own by path).
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
esbuild.buildSync({
  entryPoints: [path.join(shellDir, 'main.cjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  external: ['electron', 'electron-updater'],
  logLevel: 'warning',
});

// 2. Compile inside Electron, then verify it loads back.
try {
  runInElectron([__filename, '--in-electron-compile']);
} finally {
  fs.rmSync(bundle, { force: true });
}
process.stdout.write(`protect:shell — electron/shell.jsc written\n`);
process.stdout.write(runInElectron([__filename, '--in-electron-verify']));
