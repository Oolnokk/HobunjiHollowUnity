'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createDesktopUpdates } = require('./update-controller.cjs'); // Dedicated update-screen state and events.
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { GAME_SCHEME, GAME_URL, getGameAsset, isGameUrl, localizeGameHtml } = require('./game-protocol.cjs');
const { configureSaveFolderPermissions } = require('./save-folder-permissions.cjs'); // Tested Electron permission policy for the native folder picker.
const { CLOSE_SAVE_SCRIPT } = require('./close-save.cjs'); // Shared, tested final-save policy executed inside the game window.

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
let mainWindow = null; // Single game window.
let desktopUpdates = null; // Main-process update screen controller, populated after app readiness.
let folderPermissions = null; // Exposes the most recent native restricted-folder decision in Save Folder Status.
let closeAllowed = false; // Avoid recursive interception after a successful save.
let closeInProgress = false; // Serialize repeated close requests.

// Close-save policy is isolated in close-save.cjs, with no access to Node APIs.

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
    'Native picker: ' + (folderPermissions?.getDebugStatus()?.lastRestriction || 'not checked'),
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
      { label: 'Check for Updates', click: () => desktopUpdates?.open() },
      { label: 'Developer Tools', accelerator: 'Ctrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() },
    ] },
  ]));
}

async function saveGameBeforeExit(win) {
  try {
    return await win.webContents.executeJavaScript(CLOSE_SAVE_SCRIPT, true);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function prepareUpdateRestart() {
  const win = mainWindow; // The game window whose live save must finish before updating.
  if (!win || win.isDestroyed() || closeInProgress) return false;
  closeInProgress = true;
  try {
    while (!win.isDestroyed()) {
      const outcome = await saveGameBeforeExit(win);
      if (win.isDestroyed()) return false;
      if (outcome?.ok && outcome.mode !== 'paused') {
        closeAllowed = true; // Let electron-updater close windows only after a real save succeeds.
        return true;
      }
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', title: 'Hobunji Hollow — Save before update',
        message: outcome?.mode === 'paused'
          ? 'Saving is deliberately paused. Installing now may discard gameplay changes.'
          : 'The final save did not complete. Do you still want to install the update?',
        detail: outcome?.mode === 'paused'
          ? 'Unpause saving and retry, or explicitly restart without saving.'
          : String(outcome?.error || 'Unknown save failure') +
            '\nInstalling now could leave your Google Drive save folder behind.',
        buttons: ['Retry Save', 'Restart Without Saving', 'Cancel Update'],
        defaultId: 0, cancelId: 2,
      });
      if (response === 0) continue;
      if (response === 1) {
        closeAllowed = true; // Explicit user override only, never automatic.
        return true;
      }
      return false;
    }
  } finally {
    closeInProgress = false;
  }
  return false;
}

async function saveAndClose(win) {
  if (closeInProgress || win.isDestroyed()) return;
  closeInProgress = true;
  try {
    const outcome = await saveGameBeforeExit(win);
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
    if (win.isDestroyed()) return;
    if (response.response === 1) { closeAllowed = true; win.close(); }
    else if (response.response === 0) {
      // Schedule the retry after releasing the guard, not inside this save attempt.
      queueMicrotask(() => { if (!win.isDestroyed()) win.close(); });
    }
  } catch (error) {
    console.error('[Hobunji desktop] Could not finish the save/close dialog', error);
  } finally {
    closeInProgress = false;
  }
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
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      app.quit(); // Quit hidden update windows too when the player has saved and closed the game.
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame && code !== -3) void dialog.showMessageBox(win, {
      type: 'error', title: 'Hobunji Hollow — Loading failed',
      message: 'Game files could not be loaded', detail: description + ' (' + code + ')\n' + url, buttons: ['OK'],
    });
  });
  void win.loadURL(GAME_URL);
}

// Never run two separate desktop processes against the same local save profile.
const singleInstance = app.requestSingleInstanceLock(); // A second launch focuses the existing window instead of starting another writer.
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
  app.setAppUserModelId('com.oolnokk.hobunjihollow');
  registerAssets();
  folderPermissions = configureSaveFolderPermissions({
    session: session.defaultSession, dialog, getGameWindow: () => mainWindow,
  });
  app.on('web-contents-created', (_event, contents) => attachNavigationGuards(contents));
  desktopUpdates = createDesktopUpdates({
    app, BrowserWindow, ipcMain, shell, autoUpdater,
    getGameWindow: () => mainWindow,
    prepareRestart: prepareUpdateRestart,
    cancelPreparedRestart: () => { closeAllowed = false; },
  });
  installMenu();
  createWindow();
  desktopUpdates.start();
}).catch(error => {
  dialog.showErrorBox('Hobunji Hollow startup failed', String(error.stack || error));
  app.quit();
  });
}
app.on('window-all-closed', () => app.quit());
