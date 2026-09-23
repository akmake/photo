/**
 * The desktop shell. One icon, one window, and the engine underneath it.
 *
 * WHAT THIS IS FOR
 * ----------------
 * In development the photographer's machine runs two windows he starts himself:
 * Vite on 5173 and the Python engine on 8756. Installed, that is not a product.
 * This process is the product's outer edge: it owns the window, it starts the
 * engine, it waits for it honestly, and it shuts it down again.
 *
 * WHAT MAKES IT NOT LOOK LIKE A BROWSER
 * -------------------------------------
 * A packaged web app betrays itself through behaviour, not through the frame:
 * the right-click menu that offers "view source", Ctrl+wheel zooming the whole
 * editor, a dropped file navigating the window away from the app, a window that
 * forgets its size. Every one of those is closed here or in preload.cjs, and
 * each one is commented where it is closed, because a future reader will
 * otherwise "clean up" a line that exists on purpose.
 *
 * THE TITLE BAR IS OURS, THE BUTTONS ARE WINDOWS'
 * -----------------------------------------------
 * `titleBarStyle: 'hidden'` + `titleBarOverlay` is what Edge and VS Code do:
 * the strip belongs to the app's own design, while minimise/maximise/close are
 * drawn by Windows with real hover, real snap-layouts on hover-maximise, real
 * theming and the correct side under an RTL system. Hand-drawn buttons get all
 * four of those subtly wrong, and this product is judged on exactly that.
 *
 * A dedicated, quiet 36px strip lives ABOVE the app's navigation. The renderer
 * leaves native button space free via CSS env(): `titlebar-area-*` — see
 * src/design/desktop.css.
 */

const { app, BrowserWindow, Menu, ipcMain, screen, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { startUpdates } = require('./updater.cjs');
const { createServerOrigin } = require('./serverOrigin.cjs');

const DEV = !app.isPackaged;

/** The engine's address. Production stays on 8756. The override lets a
 * packaged build be tested beside the development engine without attaching to
 * the wrong process; the spawned engine inherits the same variable. */
const ENGINE_HOST = '127.0.0.1';
const requestedEnginePort = Number(process.env.TEZA_PORT);
const ENGINE_PORT = Number.isInteger(requestedEnginePort) &&
  requestedEnginePort > 0 && requestedEnginePort < 65536
  ? requestedEnginePort
  : 8756;
const ENGINE_ORIGIN = `http://${ENGINE_HOST}:${ENGINE_PORT}`;

/* Match the reference's understated native title strip, without making the
 * app's navigation carry window controls. Keep this in sync with desktop.css. */
const TITLEBAR_HEIGHT = 36;
const TITLEBAR_COLOR = '#57585c';
const TITLEBAR_SYMBOL = '#ffffff';

/** The app's pre-paint ground — the same value as index.html's <style>, so the
 *  first frame is the product's surface and never a flash of white. */
const SURFACE = '#fcfcfd';

const REPO_ROOT = path.join(__dirname, '..');

/* Everything this app leaves on the machine lives under one roof, next to the
 * records (engine/db.py) and the caches (server.py:_cache_root): LOCALAPPDATA\
 * TEZA. Electron's own default would scatter a second tree under APPDATA. */
const DATA_ROOT = path.join(
  process.env.LOCALAPPDATA || app.getPath('appData'),
  'TEZA',
);
app.setPath('userData', path.join(DATA_ROOT, 'shell'));

const WINDOW_STATE_FILE = path.join(DATA_ROOT, 'shell', 'window.json');
const LOG_DIR = path.join(DATA_ROOT, 'logs');
// Which website this copy talks to. Outside the install folder on purpose: an
// update replaces that folder, and a moved domain must stay moved.
const SERVER_FILE = path.join(DATA_ROOT, 'server.json');

let mainWindow = null;
let splashWindow = null;
const galleryPreviewWindows = new Set();
let engine = null;          // the child process, when WE started it
let engineAttached = false; // true when an engine was already running
let quitting = false;
let server = null;          // serverOrigin.cjs; packaged builds only

// ---------------------------------------------------------------- the engine

/** Ask the engine whether it is up. Packaged must never accept a development
 * engine answering on the same port: it has no license gate. */
function engineAnswers(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: ENGINE_HOST, port: ENGINE_PORT, path: '/health', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (part) => { body += part; });
        res.on('end', () => {
          try {
            const health = JSON.parse(body);
            resolve(res.statusCode === 200 && (!app.isPackaged || health.license_required === true));
          } catch { resolve(false); }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** How to start the engine here.
 *
 * Packaged, it is one frozen executable beside the app. In development it is
 * the checkout's own virtual environment — so this shell runs against the
 * working tree with no build step, which is the only way it gets used daily.
 *
 * electron-builder places the frozen folder under resources/engine. Keep the
 * file-exists check: a damaged installation must report a missing engine
 * instead of failing with a cryptic child-process error. */
function engineCommand() {
  if (!DEV) {
    const frozen = path.join(process.resourcesPath, 'engine', 'teza-engine.exe');
    if (fs.existsSync(frozen)) {
      return { file: frozen, args: [], cwd: path.dirname(frozen) };
    }
    return null;
  }
  const python = path.join(REPO_ROOT, 'engine', '.venv', 'Scripts', 'python.exe');
  return {
    file: python,
    args: [path.join(REPO_ROOT, 'engine', 'server.py')],
    cwd: path.join(REPO_ROOT, 'engine'),
  };
}

/** Start the engine — unless one is already listening.
 *
 * ATTACHING IS NOT A FALLBACK, IT IS THE COMMON CASE ON THIS MACHINE: the
 * photographer's own engine is running while he develops, and the port is
 * hard-coded, so a shell that insisted on spawning its own would die on
 * "port already in use" every time it was opened here. */
async function startEngine(onLine) {
  if (!DEV && await portAnswers()) {
    onLine('פורט המנוע תפוס; סגור גרסה אחרת של TEZA');
    return false;
  }
  if (DEV && await engineAnswers()) {
    engineAttached = true;
    onLine('משתמש במנוע שכבר רץ');
    return true;
  }

  const command = engineCommand();
  if (!command) {
    onLine('קובץ המנוע חסר בהתקנה');
    return false;
  }
  const { file, args, cwd } = command;
  if (!fs.existsSync(file)) {
    onLine(`המנוע לא נמצא: ${file}`);
    return false;
  }

  let licenseConfig = null;
  if (!DEV) {
    try {
      licenseConfig = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'license-config.json'), 'utf8'));
      if (!/^https:\/\//.test(licenseConfig.origin) ||
          !fs.existsSync(path.join(process.resourcesPath, 'license-public.pem'))) {
        throw new Error('invalid license configuration');
      }
    } catch {
      onLine('התקנה חסרה: שרת רישיונות או מפתח אימות');
      return false;
    }
    server = createServerOrigin({
      defaultOrigin: licenseConfig.origin,
      publicKeyPem: fs.readFileSync(path.join(process.resourcesPath, 'license-public.pem'), 'utf8'),
      stateFile: SERVER_FILE,
      log: (...parts) => {
        try {
          fs.mkdirSync(LOG_DIR, { recursive: true });
          fs.appendFileSync(path.join(LOG_DIR, 'server.log'), `${new Date().toISOString()} ${parts.join(' ')}\n`);
        } catch { /* logging must not break the launch */ }
      },
    });
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(path.join(LOG_DIR, 'engine.log'), 'a');
  fs.writeSync(log, `\n--- ${new Date().toISOString()} ${file}\n`);

  engine = spawn(file, args, {
    cwd,
    stdio: ['ignore', log, log],
    windowsHide: true,
    env: {
      ...process.env,
      // Packaged, the weights live beside the app and NOT inside it — an update
      // replaces the app folder, and re-downloading 1.9GB per update is an
      // update nobody installs. engine/paths.py reads this.
      ...(DEV ? {} : {
        TEZA_MODELS_DIR: path.join(process.resourcesPath, 'models'),
        // And the same in the other direction: what the app WRITES — a
        // published client gallery, its records — goes next to the studio's
        // database and not inside the installed folder, which an update
        // replaces and Program Files will not let us write to anyway.
        TEZA_DATA_DIR: DATA_ROOT,
        TEZA_LICENSE_REQUIRED: '1',
        // The address can move while the engine runs (serverOrigin.cjs), so
        // the engine reads SERVER_FILE at call time; this is the fallback.
        TEZA_LICENSE_ORIGIN: server.current(),
        TEZA_SERVER_FILE: SERVER_FILE,
        TEZA_LICENSE_PUBLIC_KEY_PATH: path.join(process.resourcesPath, 'license-public.pem'),
        TEZA_LICENSE_DATA_DIR: path.join(DATA_ROOT, 'license'),
      }),
      PYTHONIOENCODING: 'utf-8',   // Hebrew paths through a pipe, on a Hebrew codepage
      PYTHONUNBUFFERED: '1',
    },
  });

  engine.on('exit', (code) => {
    engine = null;
    // A quiet death is the expensive bug: the window would simply stop being
    // able to open a photograph, with nothing said. See §6 of CLAUDE.md.
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine:down', { code });
    }
  });
  return true;
}

function portAnswers() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ENGINE_HOST, port: ENGINE_PORT });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

function stopEngine() {
  if (engine && !engineAttached) {
    try { engine.kill(); } catch { /* already gone */ }
  }
  engine = null;
}

// ------------------------------------------------------------- window memory

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf-8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch { /* first run, or a file we cannot read: open at the default */ }
  return null;
}

/** A saved position is only usable if that screen still exists. A laptop
 *  undocked from a second monitor would otherwise open the window off-screen,
 *  where it looks like the app failed to start.
 *
 *  Returns null when there is nothing usable to restore. */
function usableBounds(state) {
  if (!state) return null;
  const bounds = {
    width: Math.max(1024, state.width),
    height: Math.max(680, state.height),
  };
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    const area = screen.getDisplayMatching({ ...bounds, x: state.x, y: state.y }).workArea;
    const onScreen =
      state.x + bounds.width > area.x + 80 &&
      state.x < area.x + area.width - 80 &&
      state.y >= area.y - 8 &&
      state.y < area.y + area.height - 80;
    if (onScreen) { bounds.x = state.x; bounds.y = state.y; }
  }
  return bounds;
}

let saveTimer = null;
function rememberWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const maximized = mainWindow.isMaximized();
      /* CONTENT bounds, not window bounds. Measured on this window style:
       * getBounds -> setBounds and getNormalBounds -> setBounds both come back
       * one pixel taller every round trip (1440x902 -> 903 -> 904), because the
       * frame arithmetic behind a hidden title bar is not symmetrical. The
       * content pair returns exactly what it was given, three round trips
       * running, so the window opens the same size it was closed at. */
      const bounds = maximized
        // Maximised, the content bounds ARE the screen — saving them would
        // lose the size to restore down to. Keep the last real one.
        ? (loadWindowState() || {})
        : mainWindow.getContentBounds();
      fs.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true });
      fs.writeFileSync(
        WINDOW_STATE_FILE,
        JSON.stringify({ ...bounds, maximized }, null, 2),
      );
    } catch { /* losing the window size is not worth an error to the user */ }
  }, 400);
}

// -------------------------------------------------------------------- splash

function openSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: SURFACE,
    skipTaskbar: false,
    title: 'TEZA',
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow && splashWindow.show());
  return splashWindow;
}

function splashSay(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // The splash has no preload and no bridge on purpose — it is one dumb file
  // that must render with nothing else present. So the line is pushed in.
  splashWindow.webContents
    .executeJavaScript(`window.say && window.say(${JSON.stringify(text)})`)
    .catch(() => { /* still loading; the next line will land */ });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

// ---------------------------------------------------------------- the window

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,                 // revealed on ready-to-show: no white flash
    backgroundColor: SURFACE,
    title: 'TEZA',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      symbolColor: TITLEBAR_SYMBOL,
      height: TITLEBAR_HEIGHT,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,         // red squiggles under Hebrew client names
      devTools: DEV,             // no F12 in the shipped product
      // How preload learns which build it is in. It cannot read app.isPackaged,
      // and the reload key must stay alive in development and die in the product.
      additionalArguments: [`--teza-dev=${DEV}`],
    },
  });

  /* RESTORE THROUGH setContentBounds, NOT THROUGH THE CONSTRUCTOR.
   *
   * The constructor's width/height and the window's own bounds are not the same
   * measurement on Windows, and feeding one back into the other grows the window
   * on every launch — measured: 1440x900 came back as 1442x905, then 1444x909.
   * A window that is a little bigger every morning is exactly the kind of small
   * wrongness this product is judged on. See rememberWindow for the pair that
   * was measured to be symmetrical. */
  const restored = usableBounds(state);
  if (restored) mainWindow.setContentBounds(restored);
  if (state && state.maximized) mainWindow.maximize();

  mainWindow.on('resize', rememberWindow);
  mainWindow.on('move', rememberWindow);
  mainWindow.on('maximize', rememberWindow);
  mainWindow.on('unmaximize', rememberWindow);
  mainWindow.on('close', rememberWindow);
  mainWindow.on('closed', () => { mainWindow = null; });

  /* A link must never replace the app with a web page: there is no address bar
   * and no back button, so the photographer would be left with a white window
   * and no way out. Same-origin navigation (the app's own routing) is allowed;
   * anything else opens in the real browser, where it belongs. */
  const appOrigin = DEV ? 'http://localhost:5173' : 'file://';
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(appOrigin)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };   // never a second, chrome-less app window
  });

  /* Pinch and Ctrl+wheel zoom the entire interface. In an editor, where the
   * photographer is judging an image at a known size, that is not a feature —
   * it is a way to lose the reference without noticing. */
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow.webContents.setZoomLevel(0);
  });

  if (DEV) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(REPO_ROOT, 'dist', 'index.html'));
  }
  return mainWindow;
}

// ------------------------------------------------------- what the page may ask

/* The only native menu in the product: the clipboard, on a right-click inside a
 * text field. preload.cjs decides when — everywhere else right-click is silent.
 * Built here because a renderer cannot pop a native menu. */
ipcMain.on('menu:context-edit', (event) => {
  const menu = Menu.buildFromTemplate([
    { role: 'cut', label: 'גזור' },
    { role: 'copy', label: 'העתק' },
    { role: 'paste', label: 'הדבק' },
    { type: 'separator' },
    { role: 'selectAll', label: 'בחר הכול' },
  ]);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) menu.popup({ window: win });
});

/* Settings → "server address". Null in development, where there is no site.
 * Setting it verifies the address is really our server before saving it. */
ipcMain.handle('server:get', () => (server ? { origin: server.current(), installed: server.installed() } : null));
ipcMain.handle('server:set', (_event, value) => (
  server ? server.setOrigin(value) : { ok: false, error: 'זמין רק בתוכנה המותקנת.' }
));

ipcMain.on('shell:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.on('gallery:open-preview', (_event, slug) => {
  if (typeof slug !== 'string' || !/^[A-Za-z0-9]+$/.test(slug)) return;
  const preview = new BrowserWindow({
    width: 430,
    height: 820,
    minWidth: 360,
    minHeight: 600,
    title: 'תצוגת הלקוח · TEZA',
    autoHideMenuBar: true,
    backgroundColor: SURFACE,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: DEV,
    },
  });
  galleryPreviewWindows.add(preview);
  preview.on('closed', () => galleryPreviewWindows.delete(preview));
  if (DEV) {
    preview.loadURL(`http://localhost:5173/gallery.html?g=${encodeURIComponent(slug)}`);
  } else {
    preview.loadFile(path.join(REPO_ROOT, 'dist', 'gallery.html'), { query: { g: slug } });
  }
});

/** The menu bar is not shown (the window is frameless), but the application
 *  menu is where Windows finds the clipboard accelerators. Without it, Ctrl+C
 *  and Ctrl+V in a client's name field stop working — the classic packaged-web
 *  bug. So: the edit roles, and in development the reload/devtools pair. */
function installMenu() {
  const template = [{ role: 'editMenu' }];
  if (DEV) {
    template.push({
      label: 'Dev',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ----------------------------------------------------------------- lifecycle

/* A second launch must raise the window that is already open, not start a
 * second engine on a port that is already taken. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    installMenu();
    // The installer must not meet a running engine holding its own files.
    startUpdates({
      getWindow: () => mainWindow,
      getServer: () => server,
      beforeInstall: () => { quitting = true; stopEngine(); },
      logDir: LOG_DIR,
    });
    openSplash();
    splashSay('מדליק את המנוע');

    const startedEngine = await startEngine(splashSay);
    if (!startedEngine) {
      closeSplash();
      await dialog.showMessageBox({
        type: 'error', title: 'TEZA לא נפתחה',
        message: 'לא ניתן להפעיל את מנוע TEZA.',
        detail: 'בדוק שההתקנה מלאה ושאין גרסה אחרת של TEZA פתוחה, ואז נסה שוב.',
      });
      app.quit();
      return;
    }

    /* Measured on this machine: the engine's imports alone cost ~3.8s warm, and
     * a first start after a reboot is slower. So the wait is real, it is shown,
     * and it is never a frozen empty window. */
    const started = Date.now();
    let ready = await engineAnswers();
    while (!ready && Date.now() - started < 90_000) {
      if (Date.now() - started > 15_000) splashSay('זה לוקח יותר מהרגיל');
      await new Promise((r) => setTimeout(r, 300));
      if (!engine && !engineAttached) break;  // it died: stop pretending
      ready = await engineAnswers();
    }

    if (!ready) splashSay('המנוע לא ענה — נפתח בכל זאת');

    const win = createWindow();

    /* REVEALING THE WINDOW MUST NOT DEPEND ON `ready-to-show` ALONE.
     *
     * `ready-to-show` fires after the first paint, and a window that is hidden
     * does not necessarily paint: measured here, with the GPU in software
     * compositing (which is what a machine without working hardware
     * acceleration, a remote session, or an old driver gives you), the event had
     * still not fired 25 seconds after `did-finish-load` — the app was loaded,
     * correct and invisible, behind a splash that would have spun forever.
     *
     * So three paths lead to the same reveal, first one wins: the paint, the
     * load, and a stopwatch. A studio that opens a moment early is a product; a
     * studio that never opens is a support call. */
    let revealed = false;
    const reveal = () => {
      if (revealed || win.isDestroyed()) return;
      revealed = true;
      clearTimeout(revealTimer);
      closeSplash();
      win.show();
      win.focus();
    };
    const revealTimer = setTimeout(reveal, 12_000);
    win.once('ready-to-show', reveal);
    win.webContents.once('did-finish-load', () => setTimeout(reveal, 400));
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // A failed load leaves an empty window. Showing it is still right: an
      // empty window with a title bar can be closed, a hidden one cannot.
      if (isMainFrame) reveal();
    });
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {
    stopEngine();
    app.quit();
  });
  app.on('quit', stopEngine);
}
