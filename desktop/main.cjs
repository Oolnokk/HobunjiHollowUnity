'use strict';

const { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { GAME_SCHEME, GAME_URL, getGameAsset, isGameUrl, localizeGameHtml } = require('./game-protocol.cjs');

// A secure, standard origin preserves IndexedDB, localStorage and folder-handle permissions.
protocol.registerSchemesAsPrivileged([{ scheme: GAME_SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true,
} }]);

const GAME_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.resolve(__dirname, '..', 'docs'); // Shipped game assets or original checkout.
const VENDOR_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'vendor')
  : path.join(__dirname, 'node_modules', 'three'); // Locally bundled r128 files.
const ALLOWED_PERMISSIONS = new Set(['fileSystem', 'persistent-storage', 'fullscreen', 'clipboard-sanitized-write']); // Only trusted game pages receive these.
let mainWindow = null; // Single game window.
let closeAllowed = false; // Avoid recursive interception after a successful save.
let closeInProgress = false; // Serialize repeated close requests.

// Execute only in the trusted renderer; no preload or Node.js access is exposed to the game.
const CLOSE_SAVE_SCRIPT = [
  '(async () => {',
  '  const save = window.LocalSaveFolder;',
  '  const before = save?.getStatus?.();',
  '  if (before?.state === "ready" && before.autoSyncArmed && !window.HobunjiAutosavePause?.isPaused?.()) {',
  '    const result = await save.syncNow({ reason: "desktop-window-close" });',
  '    const action = String(result?.lastAction || "");',
  '    if (/error|blocked|risk/i.test(action) || result?.dataLossRisk) {',
  '      return { ok: false, error: result?.lastError || action || "Folder sync failed" };',
  '    }',
  '    return { ok: true, mode: "folder", action };',
  '  }',
  '  if (window.__hobunjiGameStarted === true && typeof window.HobunjiRuntimeSave?.flushNow === "function") {',
  '    const result = await window.HobunjiRuntimeSave.flushNow({ reason: "desktop-window-close" });',
  '    if (result?.ok === false) return { ok: false, error: result.error || "Browser save failed" };',
  '  }',
  '  return { ok: true, mode: "browser" };',
  '})()',
].join('\n');

function vendorAsset(filename) {
  if (app.isPackaged) return path.join(VENDOR_ROOT, filename);
  const subdir = filename === 'three.min.js' ? 'build' : path.join('examples', 'js', 'controls');
  return path.join(VENDOR_ROOT, subdir, filename);
}

function registerAssets() {
  protocol.handle(GAME_SCHEME, async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('', { status: 405 });
    const asset = getGameAsset(request.url, { gameRoot: GAME_ROOT, vendorRoot: VENDOR_ROOT });
    if (!asset) return new Response('Not found', { status: 404 });
    try {
      if (asset.kind === 'vendor') {
        const code = await readFile(vendorAsset(path.basename(asset.file)));
        return new Response(request.method === 'HEAD' ? null : code, {
          headers: { 'content-type': 'application/javascript; charset=utf-8' },
        });
      }
      if (asset.kind === 'html') {
        const html = localizeGameHtml(await readFile(asset.file, 'utf8'));
        return new Response(request.method === 'HEAD' ? null : html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return net.fetch(pathToFileURL(asset.file).toString());
    } catch (error) {
      console.error('[Hobunji desktop] Missing asset', asset.file, error);
      return new Response('Asset could not be loaded', { status: 404 });
    }
  });
}

function configurePermissions() {
  const ses = session.defaultSession; // Persistent Chromium profile owns the saved folder handle.
  ses.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isGameUrl(contents.getURL()) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((contents, permission, origin) => {
    return !!contents && isGameUrl(contents.getURL()) && isGameUrl(origin) && ALLOWED_PERMISSIONS.has(permission);
  });
  ses.on('file-system-access-restricted', async (_event, details, callback) => {
    if (!isGameUrl(details.origin) || !isGameUrl(details.webContents?.getURL() || '')) {
      callback('deny'); return;
    }
    try {
      const selected = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Hobunji Hollow — Save folder permission',
        message: 'Allow access to this protected folder?',
        detail: 'Choose the specific game-save directory rather than an entire Windows system folder.',
        buttons: ['Choose Another Folder', 'Allow This Folder', 'Cancel'],
        defaultId: 0, cancelId: 2,
      });
      callback(selected.response === 1 ? 'allow' : selected.response === 0 ? 'tryAgain' : 'deny');
    } catch { callback('deny'); }
  });
}

function attachNavigationGuards(contents) {
  contents.on('will-navigate', (event, url) => {
    if (!isGameUrl(url)) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url).catch(console.error);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || isGameUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      } };
    }
    if (url.startsWith('https://')) void shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });
}

async function showSaveStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  let status;
  try {
    status = await mainWindow.webContents.executeJavaScript('window.LocalSaveFolder?.getStatus?.() || null');
  } catch (error) { status = { state: 'unavailable', lastError: String(error) }; }
  const lines = status ? [
    'Folder: ' + (status.folderName || '(none)'),
    'Connection: ' + (status.state || 'unknown'),
    'Autosync: ' + (status.autoSyncArmed ? 'armed' : 'not armed'),
    'Last operation: ' + (status.lastAction || 'none'),
    'Last synced: ' + (status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'never'),
    'Error: ' + (status.lastError || '(none)'),
  ] : ['Save system not initialized.'];
  await dialog.showMessageBox(mainWindow, {
    type: 'info', title: 'Hobunji Hollow — Save Folder Status',
    message: 'Local Save Folder', detail: lines.join('\n'), buttons: ['OK'],
  });
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Game', submenu: [
      { label: 'Save and Quit', click: () => mainWindow?.close() },
    ] },
    { label: 'View', submenu: [
      { label: 'Fullscreen', accelerator: 'F11', click: () => {
        if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } },
      { label: 'Save Folder Status', click: showSaveStatus },
      { label: 'Developer Tools', accelerator: 'Ctrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
    ] },
  ]));
}

async function saveAndClose(win) {
  if (closeInProgress || win.isDestroyed()) return;
  closeInProgress = true;
  let outcome;
  try {
    outcome = await win.webContents.executeJavaScript(CLOSE_SAVE_SCRIPT, true);
  } catch (error) {
    outcome = { ok: false, error: String(error?.message || error) };
  }
  closeInProgress = false;
  if (win.isDestroyed()) return;
  if (outcome?.ok) {
    closeAllowed = true;
    win.close();
    return;
  }
  const response = await dialog.showMessageBox(win, {
    type: 'error', title: 'Hobunji Hollow — Save failed',
    message: 'The game could not finish saving before exit.',
    detail: String(outcome?.error || 'Unknown failure') + '\nYour Google Drive folder might not have the latest changes.',
    buttons: ['Retry Save', 'Quit Without Saving', 'Cancel'], defaultId: 0, cancelId: 2,
  });
  if (response.response === 1) { closeAllowed = true; win.close(); }
  else if (response.response === 0) win.close();
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Hobunji Hollow', width: 1440, height: 900, minWidth: 900, minHeight: 600,
    show: false, backgroundColor: '#12191b',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', event => { event.preventDefault(); win.setTitle('Hobunji Hollow'); });
  win.on('close', event => {
    if (closeAllowed) return;
    event.preventDefault();
    void saveAndClose(win);
  });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame && code !== -3) void dialog.showMessageBox(win, {
      type: 'error', title: 'Hobunji Hollow — Loading failed',
      message: 'Game files could not be loaded', detail: description + ' (' + code + ')\n' + url, buttons: ['OK'],
    });
  });
  void win.loadURL(GAME_URL);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.oolnokk.hobunjihollow');
  registerAssets();
  configurePermissions();
  app.on('web-contents-created', (_event, contents) => attachNavigationGuards(contents));
  installMenu();
  createWindow();
}).catch(error => {
  dialog.showErrorBox('Hobunji Hollow startup failed', String(error.stack || error));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
