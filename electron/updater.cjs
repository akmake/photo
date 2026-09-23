/**
 * Updates: the website publishes a new version, every installed copy finds it,
 * downloads it in the background, and asks once to restart.
 *
 * The feed is the SAME site the app talks to for its license, under /updates/,
 * and that address can move (electron/serverOrigin.cjs). No second address to
 * configure, and no address baked into the code. The site serves three files
 * there, written by scripts/release-upload.cjs: latest.yml, the installer, and
 * its .blockmap.
 *
 * Rules this module keeps:
 *  - Never in development. There is nothing to update and no installer to run.
 *  - Never installs by itself while the photographer works. A downloaded update
 *    installs on quit, or right away only when they press the button.
 *  - An update check that fails (offline, site down) is NOT the photographer's
 *    problem: it is written to update.log and retried later, nothing is shown.
 *    What must never happen is the opposite — a button that says "restart" and
 *    does nothing. So the renderer only hears about an update that is fully
 *    downloaded and verified.
 */

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FIRST_CHECK_MS = 20_000;               // after launch, once the studio is up
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;   // a studio left open all day still hears

let ready = null;   // { version } once an update is downloaded and waiting

function fileLogger(logDir) {
  const file = path.join(logDir, 'update.log');
  const write = (level, parts) => {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${parts.map(String).join(' ')}\n`);
    } catch { /* a log that cannot be written must not break the update */ }
  };
  return {
    info: (...p) => write('info', p),
    warn: (...p) => write('warn', p),
    error: (...p) => write('error', p),
    debug: () => {},
  };
}

/**
 * @param {object} o
 * @param {() => import('electron').BrowserWindow | null} o.getWindow
 * @param {() => ReturnType<import('./serverOrigin.cjs')['createServerOrigin']> | null} o.getServer
 * @param {() => void} o.beforeInstall  stop the engine, mark the app as quitting
 * @param {string} o.logDir
 */
function startUpdates({ getWindow, getServer, beforeInstall, logDir }) {
  // The renderer asks on mount, so an update downloaded before the window
  // existed is still offered. In development the answer is always "none".
  ipcMain.handle('update:status', () => ready);

  if (!app.isPackaged) return;

  const log = fileLogger(logDir);
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    ready = { version: info.version };
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:ready', ready);
  });
  autoUpdater.on('error', (e) => log.error('update failed:', e && (e.stack || e.message || e)));

  ipcMain.on('update:install', () => {
    if (!ready) return;
    beforeInstall();
    // Silent: the photographer already chose where TEZA lives; the installer
    // keeps that folder. Then open the new version by itself.
    autoUpdater.quitAndInstall(true, true);
  });

  const check = async () => {
    if (ready) return;   // one waiting update is enough; do not download again
    const server = getServer();
    if (!server) { log.error('no update feed: the site address was never loaded'); return; }
    try {
      // The site may have moved since the last check (serverOrigin.cjs); the
      // feed follows it, so a copy installed today still updates after a
      // domain change.
      const origin = await server.followMoves();
      autoUpdater.setFeedURL({ provider: 'generic', url: new URL('/updates/', origin).href });
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log.warn('check failed:', e && e.message);
    }
  };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { startUpdates };
