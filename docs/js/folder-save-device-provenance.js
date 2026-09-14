// Folder Save Device Provenance — remembers only an anonymous installation id,
// never a device name/fingerprint, and stamps it into portable save entities so
// onboarding can say whether the folder was last overwritten here or elsewhere.
(() => {
  'use strict';

  const save = window.LocalSaveFolder; // Existing folder persistence API wrapped to add/remove provenance around actual writes.
  if (!save?.syncNow || window.FolderSaveDeviceProvenance) return;

  const DEVICE_ID_KEY = 'hobunjiSaveDeviceId.v1'; // Local-only anonymous installation id used solely for same/different-device comparison.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Existing browser save metadata stamped immediately before a folder overwrite.
  const PROVENANCE_KEY = 'folderSaveProvenance'; // Per-entity portable field preserved by the core's character/world JSON files.
  const rawSyncNow = save.syncNow.bind(save); // Prior sync wrapper retained so existing locks/data-loss protection still execute.
  const rawLoadFromFolder = save.loadFromFolder.bind(save); // Prior load wrapper retained so empty-folder/onboarding behavior stays intact.
  let lastObservedSource = 'unknown'; // Mobile-visible source most recently established by a successful folder load/write.
  let lastError = ''; // Mobile-visible provenance wrapper error.
  let mutationScheduled = false; // Coalesces onboarding DOM rerenders into one Resume-source refresh per frame.

  function randomId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'device_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY); // Stable only inside this browser storage profile; clearing site data deliberately creates a new identity.
      if (!id) {
        id = randomId();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch {
      return 'ephemeral_' + randomId();
    }
  }

  function readMetaRaw() {
    try { return localStorage.getItem(SAVE_META_KEY); } catch { return null; }
  }

  function readMeta() {
    const raw = readMetaRaw();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function stampBrowserMeta() {
    const beforeRaw = readMetaRaw(); // Exact pre-stamp text restored if the folder write is blocked or fails.
    if (!beforeRaw) return { beforeRaw: null, stamp: null };
    let meta;
    try { meta = JSON.parse(beforeRaw); } catch { return { beforeRaw, stamp: null }; }

    const stamp = {
      version: 1,
      lastWriterDeviceId: getDeviceId(),
      writtenAt: Date.now(),
    }; // Portable overwrite provenance copied onto every character/world written in this folder snapshot.

    for (const character of (meta.characters || [])) {
      if (character && typeof character === 'object') character[PROVENANCE_KEY] = { ...stamp };
    }
    for (const world of (meta.worlds || [])) {
      if (world && typeof world === 'object') world[PROVENANCE_KEY] = { ...stamp };
    }
    try { localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta)); } catch {}
    return { beforeRaw, stamp };
  }

  function restoreBrowserMeta(raw) {
    if (raw == null) return;
    try { localStorage.setItem(SAVE_META_KEY, raw); } catch {}
  }

  function latestProvenance(meta = readMeta()) {
    let latest = null; // Most recent portable overwrite stamp found among entities in the currently loaded save.
    const consider = value => {
      const stamp = value?.[PROVENANCE_KEY];
      const writtenAt = Number(stamp?.writtenAt) || 0;
      if (!stamp?.lastWriterDeviceId || !writtenAt) return;
      if (!latest || writtenAt > latest.writtenAt) latest = { ...stamp, writtenAt };
    };
    for (const character of (meta?.characters || [])) consider(character);
    for (const world of (meta?.worlds || [])) consider(world);
    return latest;
  }

  function writerRelationship(stamp = latestProvenance()) {
    if (!stamp?.lastWriterDeviceId) return 'unknown';
    return stamp.lastWriterDeviceId === getDeviceId() ? 'this-device' : 'different-device';
  }

  save.syncNow = async (options = {}) => {
    const stamped = stampBrowserMeta(); // Provenance is added before the core serializes entity files and manifest.
    try {
      const result = await rawSyncNow(options);
      if (result?.lastError || result?.dataLossRisk) {
        restoreBrowserMeta(stamped.beforeRaw);
        lastError = result.lastError || String(result.dataLossRisk || 'Folder write was blocked.');
      } else if (stamped.stamp) {
        lastObservedSource = 'folder-written-here';
        lastError = '';
      }
      scheduleResumeSourceRefresh();
      return result;
    } catch (error) {
      restoreBrowserMeta(stamped.beforeRaw);
      lastError = String(error?.message || error);
      scheduleResumeSourceRefresh();
      throw error;
    }
  };

  save.loadFromFolder = async (...args) => {
    const result = await rawLoadFromFolder(...args);
    if (result?.ok) {
      lastObservedSource = 'folder-loaded';
      lastError = '';
    }
    scheduleResumeSourceRefresh();
    return result;
  };

  function sourceLine() {
    const status = save.getStatus?.() || {};
    if (!status.folderName || !status.autoSyncArmed) return 'Using browser fallback for this session.';

    const stamp = latestProvenance(); // Loaded folder's portable writer record shown before Resume changes anything.
    const relation = writerRelationship(stamp);
    const deviceText = relation === 'this-device'
      ? 'Last saved on this device'
      : relation === 'different-device'
        ? 'Last saved on a different device'
        : 'Last-save device unknown (older folder save)';
    const timeText = stamp?.writtenAt ? ` · ${new Date(stamp.writtenAt).toLocaleString()}` : '';
    return `From “${status.folderName}” · ${deviceText}${timeText}`;
  }

  function refreshResumeSource() {
    mutationScheduled = false;
    const resume = document.getElementById('slQuickResume');
    if (!resume) return;
    const section = resume.closest('.sl-resume-section') || resume.parentElement; // Existing Resume section receives provenance directly beneath the save name/button.
    if (!section) return;
    let line = section.querySelector('.folder-save-resume-source'); // Reused across onboarding rerenders when possible.
    if (!line) {
      line = document.createElement('div');
      line.className = 'folder-save-resume-source';
      Object.assign(line.style, {
        marginTop: '7px',
        padding: '0 4px',
        fontSize: '10px',
        lineHeight: '1.45',
        color: 'var(--ob-muted,#aeb9bd)',
        textAlign: 'center',
      });
      section.appendChild(line);
    }
    line.textContent = sourceLine();
  }

  function scheduleResumeSourceRefresh() {
    if (mutationScheduled) return;
    mutationScheduled = true;
    requestAnimationFrame(refreshResumeSource);
  }

  const observer = new MutationObserver(scheduleResumeSourceRefresh); // Save-source rerenders replace the Resume DOM, so provenance follows the rebuilt button.
  const begin = () => {
    if (!document.body) return;
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleResumeSourceRefresh();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  window.FolderSaveDeviceProvenance = {
    getDeviceId,
    latestProvenance,
    writerRelationship,
    sourceLine,
  };

  window.__hobunjiFolderSaveProvenanceDebug = {
    snapshot: () => ({
      source: lastObservedSource,
      writerRelationship: writerRelationship(),
      latestWrittenAt: latestProvenance()?.writtenAt || null,
      folderName: save.getStatus?.().folderName || null,
      autoSyncArmed: !!save.getStatus?.().autoSyncArmed,
      lastError: lastError || null,
    }),
  };
})();
