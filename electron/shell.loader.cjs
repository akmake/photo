/* The packaged entry point (package.json build.extraMetadata.main).
 *
 * Development runs electron/main.cjs as source, unchanged. A packaged build
 * runs this instead: it loads shell.jsc — the same main.cjs, bundled and
 * compiled to V8 bytecode by scripts/protect-shell.cjs — as if it were this
 * file, so __dirname is still electron/ and every path main.cjs builds from it
 * (splash.html, preload.cjs, ../dist) is still right. */

'use strict';

const path = require('node:path');
const { load } = require('./bytecode.cjs');

const file = path.join(__dirname, 'shell.jsc');
load(file).call(module.exports, module.exports, require, module, file, __dirname);
