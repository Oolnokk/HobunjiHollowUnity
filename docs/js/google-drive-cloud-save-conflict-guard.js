// Google Drive cloud-save same-revision conflict guard.
// Drive updates are last-writer-wins, so two devices can very rarely produce the same app revision.
// This guard compares the remote fingerprint with the last synced fingerprint and pauses autosync if they diverge.
(() => {
  'use strict';

  const LINK_STATE_KEY = 'hobunjiGoogleDriveSaveState:v1';
  const BANNER_ID = 'hobunjiDriveSameRevisionConflict';
  let tripped = false;
  let unsubscribe = null;

  function isSameRevisionConflict(status) {
    const remote = status?.remote;
    const link = status?.link;
    const folder = status?.folder;
    if (!remote || !link || !folder) return false;
    if (String(link.folderId || '') !== String(folder.id || '')) return false;
    if (Number(remote.revision) !== Number(link.revision)) return false;
    if (!remote.fingerprint || !link.lastSyncedFingerprint) return false;
    return remote.fingerprint !== link.lastSyncedFingerprint;
  }

  function pauseStoredAutosync(link) {
    if (!link || typeof link !== 'object') return;
    try {
      // Used by the main Drive client on reconnect; clearing this prevents it from re-arming automatically.
      localStorage.setItem(LINK_STATE_KEY, JSON.stringify({ ...link, autoSyncArmed: false }));
    } catch {}
  }

  function showConflictBanner() {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483600;width:min(680px,calc(100vw - 24px));box-sizing:border-box;padding:12px;border:1px solid #b68b49;border-radius:10px;background:#342818;color:#ffe0a3;font:600 13px/1.35 "Pixelify Sans",system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
      banner.innerHTML = `
        <div><strong>Google Drive save conflict</strong></div>
        <div style="margin-top:4px;font-weight:400">Another device wrote a different save with the same revision number. Autosync has been paused so neither copy is silently overwritten.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
          <button type="button" data-drive-conflict-open style="font:inherit;padding:7px 9px">Open Cloud Save</button>
          <button type="button" data-drive-conflict-dismiss style="font:inherit;padding:7px 9px">Dismiss</button>
        </div>`;
      document.body.appendChild(banner);
      banner.querySelector('[data-drive-conflict-open]')?.addEventListener('click', () => {
        window.HobunjiCloudSave?.openPanel?.();
      });
      banner.querySelector('[data-drive-conflict-dismiss]')?.addEventListener('click', () => banner.remove());
    }
  }

  async function tripGuard(status) {
    if (tripped) return;
    tripped = true;
    pauseStoredAutosync(status?.link);
    showConflictBanner();

    // disconnect() is the public way to stop the main client's active timers without touching the browser save
    // or forgetting the selected folder. The player can reconnect in the panel and explicitly push or pull.
    try {
      await window.HobunjiCloudSave?.disconnect?.({ forgetFolder: false });
    } catch {}
  }

  function inspect(status) {
    if (isSameRevisionConflict(status)) tripGuard(status);
  }

  function attach() {
    const api = window.HobunjiCloudSave;
    if (!api?.getStatus || !api?.onChange) {
      setTimeout(attach, 100);
      return;
    }
    if (unsubscribe) return;
    unsubscribe = api.onChange(inspect);
    inspect(api.getStatus());
  }

  window.__hobunjiDriveConflictGuardDebug = {
    status: () => ({
      tripped,
      attached: !!unsubscribe,
      cloud: window.HobunjiCloudSave?.getStatus?.() || null,
    }),
    inspect: () => inspect(window.HobunjiCloudSave?.getStatus?.()),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
})();
