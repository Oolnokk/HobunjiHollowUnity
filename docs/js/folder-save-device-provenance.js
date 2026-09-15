// Folder Save Device Provenance — reports anonymous same/different-installation
// provenance without mutating gameplay content. V3 envelope metadata is primary;
// old per-entity folderSaveProvenance fields remain read-only legacy fallback.
(() => {
  'use strict';

  const save = window.LocalSaveFolder; // Existing folder persistence API observed around successful reads/writes without adding transport metadata to gameplay state.
  if (!save?.syncNow || window.FolderSaveDeviceProvenance) return;

  const DEVICE_ID_KEY = 'hobunjiSaveDeviceId.v1'; // Local-only anonymous installation id shared with canonical save envelopes.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Legacy browser metadata read only for older per-entity provenance fallback.
  const PROVENANCE_KEY = 'folderSaveProvenance'; // Legacy per-entity field accepted for pre-V3 folders but never written by this module now.
  const rawSyncNow = save.syncNow.bind(save); // Prior folder/V3 writer retained; wrapper observes its outcome only.
  const rawLoadFromFolder = save.loadFromFolder.bind(save); // Prior folder/V3 loader retained; wrapper refreshes canonical envelope provenance after restore.
  let lastObservedSource = 'unknown'; // Mobile-visible source most recently established by a successful folder load/write.
  let lastError = ''; // Mobile-visible provenance observation error.
  let envelopeProvenance = null; // Cached canonical envelope writer/time read asynchronously from the durable sync store for synchronous Resume rendering.
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

  function readMeta() {
    try {
      const raw = localStorage.getItem(SAVE_META_KEY); // Old portable provenance is read only; transport metadata no longer modifies this gameplay blob.
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function latestLegacyProvenance(meta = readMeta()) {
    let latest = null; // Most recent pre-V3 per-entity overwrite stamp, used only when no canonical envelope writer has been recovered yet.
    const consider = value => {
      const stamp = value?.[PROVENANCE_KEY];
      const writtenAt = Number(stamp?.writtenAt) || 0;
      if (!stamp?.lastWriterDeviceId || !writtenAt) return;
      if (!latest || writtenAt > latest.writtenAt) latest = { ...stamp, writtenAt, source: 'legacy-entity' };
    };
    for (const character of (meta?.characters || [])) consider(character);
    for (const world of (meta?.worlds || [])) consider(world);
    return latest;
  }

  async function refreshEnvelopeProvenance() {
    try {
      const current = await window.HobunjiSaveSyncStore?.getCurrentEnvelope?.(); // V3 durable authority carries transport-neutral writer/time outside gameplay content.
      envelopeProvenance = current?.writerId && Number(current?.writtenAt)
        ? {
            version: 2,
            lastWriterDeviceId: String(current.writerId),
            writtenAt: Number(current.writtenAt),
            contentHash: current.contentHash || null,
            source: 'canonical-envelope',
          }
        : null;
      lastError = '';
    } catch (error) {
      lastError = String(error?.message || error);
    }
    scheduleResumeSourceRefresh();
    return envelopeProvenance;
  }

  function latestProvenance(meta = readMeta()) {
    return envelopeProvenance || latestLegacyProvenance(meta); // V3 envelope always wins; legacy entity stamp exists only for old folders/sessions.
  }

  function writerRelationship(stamp = latestProvenance()) {
    if (!stamp?.lastWriterDeviceId) return 'unknown';
    return stamp.lastWriterDeviceId === getDeviceId() ? 'this-device' : 'different-device';
  }

  save.syncNow = async (options = {}) => {
    try {
      const result = await rawSyncNow(options); // Folder write performs no provenance injection; canonical envelope already contains writer/time metadata.
      if (result?.lastError || result?.dataLossRisk) {
        lastError = result.lastError || String(result.dataLossRisk || 'Folder write was blocked.');
      } else {
        lastObservedSource = 'folder-written-here';
        await refreshEnvelopeProvenance();
      }
      scheduleResumeSourceRefresh();
      return result;
    } catch (error) {
      lastError = String(error?.message || error);
      scheduleResumeSourceRefresh();
      throw error;
    }
  };

  save.loadFromFolder = async (...args) => {
    const result = await rawLoadFromFolder(...args); // Successful V3 load commits the exact external envelope into the durable store before this wrapper resumes.
    if (result?.ok) {
      lastObservedSource = 'folder-loaded';
      lastError = '';
      await refreshEnvelopeProvenance();
    }
    scheduleResumeSourceRefresh();
    return result;
  };

  function sourceLine() {
    const status = save.getStatus?.() || {};
    if (!status.folderName || !status.autoSyncArmed) return 'Using browser fallback for this session.';

    const stamp = latestProvenance(); // Canonical envelope writer is preferred; old per-entity stamps remain compatible for legacy folders.
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
    refreshEnvelopeProvenance().catch(() => {}); // Recover prior-session V3 provenance before/alongside the first Resume render.
    scheduleResumeSourceRefresh();
  };
  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });

  window.FolderSaveDeviceProvenance = {
    getDeviceId,
    latestProvenance,
    writerRelationship,
    sourceLine,
    refreshEnvelopeProvenance,
  };

  window.__hobunjiFolderSaveProvenanceDebug = {
    snapshot: () => ({
      source: lastObservedSource,
      provenanceSource: latestProvenance()?.source || null,
      writerRelationship: writerRelationship(),
      latestWrittenAt: latestProvenance()?.writtenAt || null,
      latestContentHash: latestProvenance()?.contentHash || null,
      folderName: save.getStatus?.().folderName || null,
      autoSyncArmed: !!save.getStatus?.().autoSyncArmed,
      lastError: lastError || null,
    }),
  };
})();
