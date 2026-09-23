/**
 * The bridge, and the place where the page stops behaving like a web page.
 *
 * Everything here is one of two things:
 *   1. A browser behaviour that would give the product away as "a website in a
 *      window" — closed, with the reason written next to it.
 *   2. The small surface the app is allowed to see: `window.teza`.
 *
 * Nothing in here knows anything about the studio. The renderer keeps talking
 * to the engine over http://127.0.0.1:8756 exactly as it does in the browser —
 * no rewiring, and the same code still runs in a plain browser tab, where
 * `window.teza` is simply absent.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** main.cjs passes this in webPreferences.additionalArguments. */
const DEV = process.argv.some((a) => a === '--teza-dev=true');

// -------------------------------------------------- mark the document as ours
//
// src/design/desktop.css hangs every desktop-only rule off this attribute, so a
// plain browser tab keeps browser behaviour and the installed app does not.
// Set as early as the document exists, so the first paint is already correct.

function markDocument() {
  if (document.documentElement) {
    document.documentElement.dataset.desktop = 'true';
    return true;
  }
  return false;
}
if (!markDocument()) {
  document.addEventListener('readystatechange', markDocument, { once: true });
  document.addEventListener('DOMContentLoaded', markDocument, { once: true });
}

// ------------------------------------------------------------- right-click
//
// The default menu offers Reload, Back, Save as, View source and Inspect. One
// accidental right-click and the illusion is over. In a text field a real menu
// is expected, so the main process pops a native one with the clipboard roles;
// everywhere else right-click does nothing, the way it does in a desktop tool.

window.addEventListener('contextmenu', (e) => {
  const t = e.target;
  const editable =
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable);
  e.preventDefault();
  if (editable) ipcRenderer.send('menu:context-edit');
});

// ------------------------------------------------------------------ zooming
//
// Ctrl+wheel and Ctrl+plus/minus rescale the whole interface. The visual-zoom
// path is locked in main.cjs; these are the keyboard and wheel paths, which go
// through the page. An editor whose interface silently changes size is an editor
// whose reference is gone.

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false, capture: true });

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  const k = e.key;
  if (k === '+' || k === '=' || k === '-' || k === '0') {
    e.preventDefault();
    return;
  }
  // Print belongs to a browser, not to a photo tool: the dialog that opens is
  // Chromium's, it prints the interface, and there is no reason for it to exist.
  if (k.toLowerCase() === 'p') {
    e.preventDefault();
    return;
  }
  // Reload mid-edit throws away what is on screen with no explanation. Kept in
  // development, where it is how the app is worked on.
  if (!DEV && (k.toLowerCase() === 'r' || k === 'F5')) e.preventDefault();
}, { capture: true });

if (!DEV) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') e.preventDefault();
  }, { capture: true });
}

// ----------------------------------------------------------- files and drops
//
// Dropped on a browser, a folder REPLACES the page with a directory listing —
// the single most damning "this is a web page" moment there is. So the default
// is refused everywhere, and the paths are handed to the app instead, which is
// what dragging a shoot onto the window should have meant all along.

const dropListeners = new Set();

window.addEventListener('dragover', (e) => e.preventDefault(), { capture: true });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.dataTransfer) return;
  const paths = [];
  for (const file of e.dataTransfer.files) {
    try {
      paths.push(webUtils.getPathForFile(file));
    } catch { /* not a real file (a dragged selection): nothing to import */ }
  }
  if (paths.length) {
    for (const cb of dropListeners) {
      try { cb(paths); } catch { /* one bad listener must not eat the drop */ }
    }
  }
}, { capture: true });

// ---------------------------------------------------------------- the bridge

contextBridge.exposeInMainWorld('teza', {
  /** Present only inside the installed app. The browser build must keep working. */
  desktop: true,
  dev: DEV,
  engineOrigin: 'http://127.0.0.1:8756',

  /** The engine died while the app was open. The app must SAY so — a studio
   *  screen that silently stops being able to open a photograph is the most
   *  expensive kind of bug (CLAUDE.md §6). */
  onEngineDown(callback) {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('engine:down', handler);
    return () => ipcRenderer.removeListener('engine:down', handler);
  },

  /** Folders or files dragged onto the window. Returns an unsubscribe. */
  onDropPaths(callback) {
    dropListeners.add(callback);
    return () => dropListeners.delete(callback);
  },

  /** Open a link in the real browser. Nothing in the app may navigate itself. */
  openExternal(url) {
    if (/^https?:\/\//.test(url)) ipcRenderer.send('shell:open-external', url);
  },

  /** Show the photographer the exact app their client will use. This is a
   * local preview, not a pretend public URL. */
  openClientGallery(slug) {
    ipcRenderer.send('gallery:open-preview', slug);
  },

  /** A new version, already downloaded. `updateStatus` answers for one that
   *  arrived before the page was listening; `onUpdateReady` for later ones.
   *  See electron/updater.cjs. */
  updateStatus() {
    return ipcRenderer.invoke('update:status');
  },
  onUpdateReady(callback) {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('update:ready', handler);
    return () => ipcRenderer.removeListener('update:ready', handler);
  },
  installUpdate() {
    ipcRenderer.send('update:install');
  },

  /** The website this copy talks to (license + updates). See
   *  electron/serverOrigin.cjs. `setServer` resolves to { ok, origin } or
   *  { ok: false, error } — the error is Hebrew and meant to be shown. */
  getServer() {
    return ipcRenderer.invoke('server:get');
  },
  setServer(origin) {
    return ipcRenderer.invoke('server:set', origin);
  },
});
