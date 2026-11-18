'use strict';

const { isGameUrl } = require('./game-protocol.cjs');

const ALLOWED_PERMISSIONS = new Set(['fileSystem', 'persistent-storage', 'fullscreen', 'clipboard-sanitized-write']); // Only the game's trusted renderer may request these permissions.

function configureSaveFolderPermissions({ session, dialog, getGameWindow }) {
  let lastRestriction = 'none'; // Shown by View → Save Folder Status when Chromium blocks a sensitive directory.
  let lastFileSystemCheck = 'none'; // Explains ordinary fileSystem permission failures even when no protected-path prompt appears.

  function trustedGameWindow() {
    const win = getGameWindow(); // The single live game window, not an unrelated Electron popup.
    return win && !win.isDestroyed?.() && isGameUrl(win.webContents?.getURL?.()) ? win : null;
  }

  function trustedPermissionRequest(contents, permission, requestingOrigin, details) {
    const win = trustedGameWindow();
    if (!win || !ALLOWED_PERMISSIONS.has(permission)) return false;
    if (contents !== null && contents !== undefined && contents !== win.webContents) return false;
    // Chromium may check fileSystem permission without attaching a WebContents or
    // supplying an origin. In that case, require an explicit trusted origin.
    if (!contents && (permission !== 'fileSystem' || !requestingOrigin)) return false;
    for (const url of [requestingOrigin, details?.requestingOrigin, details?.requestingUrl]) {
      if (url && !isGameUrl(url)) return false; // Never let an embedded or external document borrow the app's grants.
    }
    return true;
  }

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Some Electron permission requests include no requestingUrl; the owned
    // WebContents remains authoritative for those requests.
    const allowed = trustedPermissionRequest(contents, permission, details?.requestingUrl, details); // Approved only for the owned game renderer and origin.
    if (permission === 'fileSystem') lastFileSystemCheck = 'request ' + (allowed ? 'allowed' : 'denied') +
      (contents ? ' (renderer present)' : ' (origin-only)');
    callback(allowed);
  });

  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    const allowed = trustedPermissionRequest(contents, permission, origin, details); // Never infer permission from an untrusted subframe.
    if (permission === 'fileSystem') lastFileSystemCheck = 'check ' + (allowed ? 'allowed' : 'denied') +
      (contents ? ' (renderer present)' : ' (origin-only)');
    return allowed;
  });

  session.on('file-system-access-restricted', async (_event, details, callback) => {
    const win = trustedGameWindow();
    if (!win || !isGameUrl(details?.origin) ||
        (details?.webContents && details.webContents !== win.webContents)) {
      lastRestriction = 'Denied an untrusted restricted-folder request';
      callback('deny');
      return;
    }
    // Electron may omit details.webContents even for a valid main-window picker.
    // The trusted origin plus a real user confirmation is required either way.
    let decision = 'deny';
    try {
      const selected = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Hobunji Hollow — Save folder permission',
        message: 'Allow access to this protected folder?',
        detail: 'Choose the specific game-save directory rather than an entire Windows system folder.',
        buttons: ['Choose Another Folder', 'Allow This Folder', 'Cancel'],
        defaultId: 0, cancelId: 2,
      });
      decision = selected.response === 1 ? 'allow' : selected.response === 0 ? 'tryAgain' : 'deny';
      lastRestriction = decision === 'allow' ? 'Protected folder explicitly allowed'
        : decision === 'tryAgain' ? 'Choosing another folder'
          : 'Protected folder access canceled';
    } catch (error) {
      lastRestriction = 'Protected-folder prompt failed: ' + String(error?.message || error);
    }
    callback(decision);
  });

  return { getDebugStatus: () => ({ lastRestriction, lastFileSystemCheck }) };
}

module.exports = { configureSaveFolderPermissions };
