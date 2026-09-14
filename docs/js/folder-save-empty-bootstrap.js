// Empty primary-folder bootstrap — choosing a brand-new folder before the first
// farmer exists is valid. The folder remains connected and the creator handoff
// will perform the first real write once save metadata exists.
(() => {
  'use strict';

  const localSave = window.LocalSaveFolder; // Existing folder API whose load wrapper reports an empty-folder/no-browser-save bootstrap as a normal connected state.
  if (!localSave?.loadFromFolder || window.FolderSaveEmptyBootstrap) return;

  const originalLoadFromFolder = localSave.loadFromFolder.bind(localSave); // Primary-layer wrapped load retained for every non-empty restore.
  let emptyBootstrapCount = 0; // Mobile-readable count of first-run folders accepted before any farmer metadata exists.
  let lastError = ''; // Mobile-readable failure from the permission refresh used to clear the core's expected no-browser-save error.

  localSave.loadFromFolder = async (...args) => {
    const result = await originalLoadFromFolder(...args);
    if (result?.ok) return result;

    let browserHasMeta = false; // Used to distinguish a legitimate first-run empty folder from a failed restore of existing browser data.
    try { browserHasMeta = Boolean(localStorage.getItem('hobunjiSaveMeta')); } catch {}
    const status = localSave.getStatus?.() || {};
    const noBrowserSave = /No browser save is available to write/i.test(String(result?.message || status.lastError || ''));
    if (browserHasMeta || !noBrowserSave || status.state !== 'ready') return result;

    try {
      // reconnect() is non-destructive when permission is already granted. It
      // re-inspects the still-empty folder and clears the expected sync error
      // without writing placeholder save data.
      await localSave.reconnect();
      emptyBootstrapCount++;
      lastError = '';
      return {
        ok: true,
        changed: false,
        action: 'empty-folder-connected-awaiting-first-save',
        message: 'Primary save folder connected. Your first farmer will be saved here automatically.',
      };
    } catch (error) {
      lastError = String(error?.message || error);
      return result;
    }
  };

  window.FolderSaveEmptyBootstrap = Object.freeze({ installed: true });
  window.__hobunjiFolderSaveEmptyBootstrapDebug = {
    snapshot: () => ({ emptyBootstrapCount, lastError: lastError || null }),
  };
})();
