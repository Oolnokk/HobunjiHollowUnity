'use strict';

const path = require('node:path');

const RELEASES_URL = 'https://github.com/Oolnokk/HobunjiHollowUnity/releases/latest'; // Stable development release page.
const FRIENDS_RELEASES_URL = 'https://github.com/Oolnokk/HobunjiHollowUnity/releases'; // Friends prereleases are never GitHub's latest stable release.
const CHANNELS = Object.freeze({
  status: 'desktop-updates:status',
  check: 'desktop-updates:check',
  install: 'desktop-updates:install',
  later: 'desktop-updates:later',
  releases: 'desktop-updates:releases',
  changed: 'desktop-updates:changed',
}); // Private IPC channels used only by the isolated update window.

const CHECK_RETRY_DELAYS_MS = Object.freeze([5000, 15000, 30000]); // Bounded backoff for metadata checks only.

function waitForRetry(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Do not expose upstream response bodies, cookies, XML or stack traces in the UI or logs.
function describeUpdateError(error) {
  const headline = String(error?.message || error || '').split(/\r?\n/, 1)[0]; // Electron may wrap the HTTP error in a feed-parse error.
  const code = String(error?.code || ''); // Only allowlisted codes are included in diagnostics.
  const status = Number(error?.statusCode || code.match(/^HTTP_ERROR_(\d{3})$/)?.[1] ||
    headline.match(/\b(?:HttpError:|HTTP(?: error| status)?[: ]+|status(?: code)?[: ]+)\s*(\d{3})\b/i)?.[1]);
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    const retryable = [408, 429, 500, 502, 503, 504].includes(status);
    const reason = status === 429 ? 'The update server is rate limiting requests.'
      : status === 408 || status === 504 ? 'The update server timed out.'
      : status >= 500 ? 'The update server returned an error.'
      : status === 404 ? 'The update release or a required file was not found.'
      : status === 401 || status === 403 ? 'The update server denied access.'
      : 'The update server rejected the request.';
    return { retryable, detail: reason + ' (HTTP ' + status + ')' };
  }
  const networkCode = (String(error?.code || '') + ' ' + headline).match(/\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ERR_TIMED_OUT|ERR_CONNECTION_(?:RESET|REFUSED|CLOSED|TIMED_OUT|ABORTED)|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE)\b/)?.[0];
  if (networkCode) return { retryable: true, detail: 'Could not reach the update server (' + networkCode + ').' };
  if (/\bRequest timed out\b/i.test(headline)) return { retryable: true, detail: 'The update request timed out.' };
  if (/\bRequest has been aborted by the server\b/i.test(headline)) return { retryable: true, detail: 'The update server aborted the request.' };
  if (['ERR_UPDATER_INVALID_RELEASE_FEED', 'ERR_UPDATER_INVALID_UPDATE_INFO', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'].includes(code)) {
    return { retryable: false, detail: 'The published update metadata is missing or invalid (' + code + ').' };
  }
  if (/cannot parse (?:releases feed|update info)/i.test(headline)) {
    return { retryable: false, detail: 'The published update metadata could not be read.' };
  }
  if (['ERR_UPDATER_INVALID_SIGNATURE', 'ERR_UPDATER_INVALID_UPDATE_FILE', 'ERR_CHECKSUM_MISMATCH'].includes(code)) {
    return { retryable: false, detail: 'The update failed integrity verification (' + code + ').' };
  }
  if (/No update filepath provided|installer declined to start/i.test(headline)) {
    return { retryable: false, detail: 'The downloaded installer could not be started.' };
  }
  return { retryable: false, detail: 'An unexpected updater error occurred.' };
}

function clampPercent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

// Keep update state in the main process; the sandboxed screen receives only plain data.
function createDesktopUpdates({ app, BrowserWindow, ipcMain, shell, autoUpdater, getGameWindow, prepareRestart, desktopIcon = null, logger = console, cancelPreparedRestart = () => {}, delayRetry = waitForRetry }) {
  const isFriendsEdition = app.getName?.() === 'Hobunji Hollow Tester'; // Packaged product name determines the approved-release track.
  const releasesUrl = isFriendsEdition ? FRIENDS_RELEASES_URL : RELEASES_URL; // View menu opens the appropriate release list.
  const releaseLabel = isFriendsEdition ? 'approved Friends' : 'main'; // Used in update-window status text.
  let updateWindow = null; // Sole update screen, not a second game instance.
  let checkActive = false; // Deduplicates launch, timer and menu update checks.
  let downloadPending = false; // Blocks new checks until electron-updater clears its download promise.
  let checkEventError = null; // A metadata error event belongs to the pending check.
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
      ...(desktopIcon ? { icon: desktopIcon } : {}),
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
    win.on('close', event => {
      if (state.phase === 'saving') event.preventDefault(); // Do not imply cancellation while a final save is in flight.
    });
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

  function reportFailure(message, error) {
    const { detail } = describeUpdateError(error);
    logger.error('[Hobunji desktop] ' + message, detail);
    publish({ phase: 'error', message, error: detail });
  }

  async function checkNow() {
    if (!app.isPackaged) {
      publish({ phase: 'unsupported', message: 'Updates are available after installing the Windows build.' });
      return;
    }
    if (checkActive || downloadPending || installActive || ['downloading', 'downloaded', 'saving', 'installing'].includes(state.phase)) return;
    checkActive = true;
    try {
      for (let attempt = 0; attempt <= CHECK_RETRY_DELAYS_MS.length; attempt++) {
        checkEventError = null;
        publish({
          phase: 'checking', targetVersion: null, percent: 0,
          message: 'Checking GitHub Releases for a newer ' + releaseLabel + ' build…', error: null,
        });
        try {
          const result = await autoUpdater.checkForUpdates();
          // electron-updater emits a separate error event and may also reject this promise.
          if (checkEventError) throw checkEventError;
          // Auto-download is a separate promise. Consume rejections without retrying large downloads.
          if (result?.downloadPromise) {
            downloadPending = true;
            void result.downloadPromise.then(() => {
              downloadPending = false;
              if (state.phase === 'cancelled') finishCancellation();
            }, error => {
              downloadPending = false;
              if (state.phase === 'cancelled') finishCancellation();
              else if (state.phase === 'downloading') reportFailure('Download failed. Check Now to try again.', error);
            });
          }
          if (state.phase === 'checking') {
            publish({ phase: 'unsupported', message: 'Update checking is unavailable in this installation.' });
          } else if (state.phase === 'cancelled' && !downloadPending) finishCancellation();
          return;
        } catch (error) {
          if (state.phase !== 'checking') {
            if (state.phase === 'downloading') reportFailure('Download failed. Check Now to try again.', error);
            else if (state.phase === 'cancelled') finishCancellation();
            return;
          }
          const { retryable, detail } = describeUpdateError(error);
          const delay = CHECK_RETRY_DELAYS_MS[attempt]; // Undefined after the last allowed attempt.
          if (!retryable || delay === undefined) {
            reportFailure('Could not check for updates. You can keep playing and try Check Now again.', error);
            return;
          }
          logger.warn?.('[Hobunji desktop] Update check retry ' + (attempt + 1), detail);
          publish({
            phase: 'retrying',
            message: 'Update check failed. Retrying in ' + (delay / 1000) + ' seconds (' +
              (attempt + 1) + '/' + CHECK_RETRY_DELAYS_MS.length + '). You can keep playing.',
            error: detail,
          });
          await delayRetry(delay);
        }
      }
    } finally {
      checkEventError = null;
      checkActive = false;
    }
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
      reportFailure('The update could not start. Check Now to try again.', error);
    } finally {
      installActive = false;
    }
  }

  function requireUpdateWindow(event) {
    if (!updateWindow || updateWindow.isDestroyed() || event.sender !== updateWindow.webContents) {
      throw new Error('Update controls are only available in the update window.');
    }
  }

  function finishCancellation() {
    publish({ phase: 'idle', targetVersion: null, message: 'Update download was cancelled. Check Now to try again.', percent: 0, error: null });
  }

  function start({ autoCheck = true } = {}) {
    if (started) return;
    started = true;
    autoUpdater.logger = null; // The library can log complete HTTP responses; use our bounded diagnostics instead.
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
        message: 'New ' + releaseLabel + ' build ' + version + ' found. Downloading automatically…', error: null,
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
      message: 'This installation is up to date with the latest ' + releaseLabel + ' Windows build.', error: null,
    }));
    autoUpdater.on('error', error => {
      if (checkActive && state.phase === 'checking') {
        checkEventError = error; // The pending metadata check owns retry/error publication.
        return;
      }
      // For an auto-download, the returned promise settles only after the library clears its internal lock.
      // A synchronous throw during discovery is handled by checkNow's catch.
      if (state.phase === 'downloading' && (checkActive || downloadPending)) return;
      if (['error', 'retrying', 'cancelled'].includes(state.phase)) return;
      if (state.phase === 'installing') cancelPreparedRestart();
      const message = state.phase === 'downloading' ? 'Download failed. Check Now to try again.'
        : 'Could not finish the update. Check Now to try again.';
      reportFailure(message, error);
    });
    autoUpdater.on('update-cancelled', () => {
      if (downloadPending || checkActive) {
        publish({ phase: 'cancelled', message: 'Finishing download cancellation…', percent: 0, error: null });
      } else finishCancellation();
    });

    ipcMain.handle(CHANNELS.status, event => { requireUpdateWindow(event); return snapshot(); });
    ipcMain.handle(CHANNELS.check, event => { requireUpdateWindow(event); void checkNow(); });
    ipcMain.handle(CHANNELS.install, event => { requireUpdateWindow(event); void install(); });
    ipcMain.handle(CHANNELS.later, event => {
      requireUpdateWindow(event);
      if (state.phase === 'saving' || state.phase === 'installing') return; // No misleading dismissal during a committed restart request.
      dismissedVersion = state.targetVersion;
      updateWindow.hide();
    });
    ipcMain.handle(CHANNELS.releases, event => {
      requireUpdateWindow(event);
      return shell.openExternal(releasesUrl);
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

module.exports = { createDesktopUpdates, CHANNELS, RELEASES_URL, FRIENDS_RELEASES_URL, clampPercent };
