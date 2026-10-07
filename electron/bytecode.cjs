/* RUNNING THE SHELL FROM V8 BYTECODE, NOT FROM SOURCE.
 *
 * A packaged build does not carry main.cjs as text. It carries shell.jsc: the
 * shell bundled, minified and compiled by V8 itself (scripts/protect-shell.cjs),
 * and this loader, which hands that bytecode back to the same V8.
 *
 * The technique is bytenode's (MIT), written here rather than depended on:
 * three facts about V8's code cache and nothing else.
 *
 *  1. A cache is only accepted for source of the SAME LENGTH. The real source
 *     is not shipped, so a placeholder of that length is compiled instead —
 *     the length is stored in the cache header, bytes 8..12.
 *  2. A cache is only accepted under the same V8 FLAGS. The build compiled it
 *     with --no-lazy (every function compiled now, not on first call — a lazy
 *     function would need the real source later). The same flags are set
 *     here, and the flag hash of THIS process (bytes 12..16) is written into
 *     the header, so a flag Electron sets by itself cannot reject it.
 *  3. The cache must come from this exact Electron. protect-shell.cjs compiles
 *     with the electron binary in node_modules, which is the one packaged.
 *
 * A rejected cache is a broken installation, and it says so instead of running
 * the placeholder. */

'use strict';

const fs = require('node:fs');
const v8 = require('node:v8');
const vm = require('node:vm');

v8.setFlagsFromString('--no-lazy');
v8.setFlagsFromString('--no-flush-bytecode');

/** The flag hash this process would write into a cache it produced. */
function currentFlagHash() {
  const probe = new vm.Script('"ಠ_ಠ"', { produceCachedData: true });
  return probe.createCachedData().subarray(12, 16);
}

/** Bytecode file → the module wrapper function it holds:
 *  (exports, require, module, __filename, __dirname) => void. */
function load(file) {
  const data = Buffer.from(fs.readFileSync(file));
  currentFlagHash().copy(data, 12);
  const length = data.readUInt32LE(8);
  const placeholder = length > 1 ? `"${'​'.repeat(length - 2)}"` : '';
  const script = new vm.Script(placeholder, { cachedData: data, filename: file });
  if (script.cachedDataRejected) {
    throw new Error(`FrameOps: the application files are damaged (${file}). Reinstall FrameOps.`);
  }
  return script.runInThisContext();
}

/** Used by the build only: source → bytecode, with the same flags as load(). */
function compile(source) {
  const wrapped = require('node:module').wrap(source);
  const script = new vm.Script(wrapped, { produceCachedData: true });
  return script.createCachedData();
}

module.exports = { load, compile };
