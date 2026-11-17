'use strict';

const path = require('node:path');

const RELEASES_URL = 'https://github.com/Oolnokk/HobunjiHollowUnity/releases/latest'; // Public update page exposed by the View menu.
const CHANNELS = Object.freeze({
  status: 'desktop-updates:status',
  check: 'desktop-updates:check',
  install: 'desktop-updates:install',
  later: 'desktop-updates:later',
  releases: 'desktop-updates:releases',
  changed: 'desktop-updates:changed',
}); // Private IPC channels used only by the isolated update window.

function clampPercent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

// Keep update state in the main process; the sandboxed screen receives only plain data.
function createDesktopUpdates({ app, BrowserWindow, ipcMain, shell, autoUpdater, getGameWindow, prepareRestart, logger = console, cancelPreparedRestart = () => {} }) {
  let updateWindow = null; // Sole update screen, not a second game instance.
  let checkActive = false; // Deduplicates launch, timer and menu update checks.
  let installActive = false; // Disallows multiple updater restart requests.
  let started = false; // Registers updater and IPC event handlers once.
  let dismissedVersion = null; // Respect Later for the current update during this launch.
  const state = {
    phase: 'idle', currentVersion: app.getVersion(), targetVersion: null,
    percent: 0, message: 'Checking for newer builds is automatic in the installed Windows game.',
    error: null,
  }; // Read-only snapshots are rendered in update-ui.js.

  function snapshot() {
    return { ...state };
  }

  function publish(changes, announce = false) {
    Object.assign(state, changes);
    if (updateWindow && !updateWindow.isDestroyed() && !updateWindow.webContents.isDestroyed()) {
      updateWindow.webContents.send(CHANNELS.changed, snapshot());
    }
    if (announce && state.targetVersion !== dismissedVersion) open();
  }

  function open() {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.show();
      updateWindow.focus();
      return;
    }
    const parent = getGameWindow(); // Parent only for stacking, never for access to game data.
    const updateOptions = {
      title: 'Hobunji Hollow — Updates', width: 520, height: 410, minWidth: 460, minHeight: 380,
      show: false, backgroundColor: '#151e23', autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'update-preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true,
      },
    };
    if (parent && !parent.isDestroyed()) updateOptions.parent = parent;
    const win = new BrowserWindow(updateOptions);
    updateWindow = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => win.webContents.send(CHANNELS.changed, snapshot()));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (updateWindow === win) {
        dismissedVersion = state.targetVersion; // Closing the screen behaves like Later.
        updateWindow = null;
      }
    });
    void win.loadFile(path.join(__dirname, 'update.html')).catch(error => {
      logger.error('[Hobunji desktop] Could not open update screen', error);
      if (!win.isDestroyed()) win.close();
    });
  }

  function checkNow() {
    if (!app.isPackaged) {
      publish({ phase: 'unsupported', message: 'Updates are available after installing the Windows build.' });
      return Promise.resolve();
    }
    if (checkActive || installActive || ['downloading', 'downloaded', 'installing'].includes(state.phase)) {
      return Promise.resolve();
    }
    checkActive = true;
    publish({ phase: 'checking', message: 'Checking GitHub Releases for a newer build from main…', error: null });
    return Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch(error => {
      logger.error('[Hobunji desktop] Update check failed', error);
      publish({ phase: 'error', message: 'Could not check for updates.', error: String(error.message || error) });
    }).finally(() => { checkActive = false; });
  }

  async function install() {
    if (installActive || state.phase !== 'downloaded') return;
    installActive = true;
    let restartPrepared = false; // Restore close interception if installation fails.
    publish({ phase: 'saving', message: 'Saving the game before restarting…', error: null });
    try {
      if (!await prepareRestart()) {
        publish({ phase: 'downloaded', message: 'Update ready. Restart when you are ready.' });
        return;
      }
      restartPrepared = true;
      publish({ phase: 'installing', message: 'Installing the update and restarting Hobunji Hollow…' });
      const startedInstall = autoUpdater.quitAndInstall(false, true);
      if (startedInstall === false) throw new Error('The update installer declined to start.');
    } catch (error) {
      if (restartPrepared) cancelPreparedRestart();
      logger.error('[Hobunji desktop] Could not install update', error);
      publish({ phase: 'error', message: 'The update could not start.', error: String(error.message || error) });
    } finally {
      installActive = false;
    }
  }

  function requireUpdateWindow(event) {
    if (!updateWindow || updateWindow.isDestroyed() || event.sender !== updateWindow.webContents) {
      throw new Error('Update controls are only available in the update window.');
    }
  }

  function start({ autoCheck = true } = {}) {
    if (started) return;
    started = true;
    autoUpdater.autoDownload = true; // Download in the background after a newer main build is discovered.
    autoUpdater.autoInstallOnAppQuit = false; // Never install behind the existing save/quit guard.
    autoUpdater.allowPrerelease = false; // Only use the published stable main builds.

    autoUpdater.on('checking-for-update', () => publish({
      phase: 'checking', message: 'Checking for updates…', error: null,
    }));
    autoUpdater.on('update-available', info => {
      const version = String(info?.version || 'newer build');
      publish({
        phase: 'downloading', targetVersion: version, percent: 0,
        message: 'New main build ' + version + ' found. Downloading automatically…', error: null,
      }, true);
    });
    autoUpdater.on('download-progress', progress => publish({
      phase: 'downloading', percent: clampPercent(progress?.percent),
      message: 'Downloading the update…',
    }));
    autoUpdater.on('update-downloaded', info => {
      publish({
        phase: 'downloaded', targetVersion: String(info?.version || state.targetVersion),
        percent: 100, message: 'Update downloaded. Save and restart to install it.', error: null,
      }, true);
    });
    autoUpdater.on('update-not-available', () => publish({
      phase: 'current', targetVersion: null, percent: 0,
      message: 'This installation is up to date with the latest published Windows build.', error: null,
    }));
    autoUpdater.on('error', error => {
      if (state.phase === 'installing') cancelPreparedRestart();
      logger.error('[Hobunji desktop] Update error', error);
      publish({ phase: 'error', message: 'Could not finish the update.', error: String(error?.message || error) });
    });
    autoUpdater.on('update-cancelled', () => publish({
      phase: 'idle', message: 'Update download was cancelled.', percent: 0,
    }));

    ipcMain.handle(CHANNELS.status, event => { requireUpdateWindow(event); return snapshot(); });
    ipcMain.handle(CHANNELS.check, event => { requireUpdateWindow(event); void checkNow(); });
    ipcMain.handle(CHANNELS.install, event => { requireUpdateWindow(event); void install(); });
    ipcMain.handle(CHANNELS.later, event => {
      requireUpdateWindow(event);
      dismissedVersion = state.targetVersion;
      updateWindow.hide();
    });
    ipcMain.handle(CHANNELS.releases, event => {
      requireUpdateWindow(event);
      return shell.openExternal(RELEASES_URL);
    });

    if (autoCheck) {
      const firstCheck = setTimeout(() => { void checkNow(); }, 8000);
      firstCheck.unref?.();
      const periodicCheck = setInterval(() => { void checkNow(); }, 4 * 60 * 60 * 1000);
      periodicCheck.unref?.();
    }
  }

  return { start, open, checkNow, snapshot, install };
}

module.exports = { createDesktopUpdates, CHANNELS, RELEASES_URL, clampPercent };
