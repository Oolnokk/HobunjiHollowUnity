// Hobunji Save Checkpoints — independent manual + rolling autosave recovery snapshots.
// The live hobunjiSaveMeta/farm-layout keys remain the canonical working autosave.
// These checkpoints are deliberately separate so a bad live autosave cannot destroy
// the player's last explicit manual save or the older rolling recovery point.
(() => {
  'use strict';

  if (window.HobunjiSaveCheckpoints) return;

  const MANUAL_KEY = 'hobunjiSaveCheckpoint.manual.v1';
  const AUTO_KEY = 'hobunjiSaveCheckpoint.auto.v1';
  const AUTO_PREVIOUS_KEY = 'hobunjiSaveCheckpoint.autoPrevious.v1';
  const CHECKPOINT_VERSION = 1;
  const AUTO_INTERVAL_MS = 30000;
  const AUTO_GRACE_MS = 45000;
  const AUTO_PREVIOUS_MIN_AGE_MS = 5 * 60 * 1000;
  const MODAL_ID = 'hobunjiSaveRecoveryModal';
  const MANUAL_BUTTON_ID = 'menuManualSaveBtn';
  const RECOVERY_BUTTON_ID = 'menuRecoveryBtn';

  let hydratedAt = 0; // Used to keep rolling recovery saves out of the load/hydration danger window.
  let autoTimer = null; // Single low-frequency checkpoint timer; never a per-frame poll.
  let lastAutosaveFingerprint = ''; // Used to avoid rewriting an identical checkpoint every interval.
  let autosavesWritten = 0;
  let autosavesSkipped = 0;
  let manualSavesWritten = 0;
  let restoresApplied = 0;
  let lastAction = 'initialized';
  let lastError = '';
  let lastIntegrityWarning = '';

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function runtimeSaveApi() {
    return window.HobunjiRuntimeSave || null;
  }

  function readRecord(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (!record || record.checkpointVersion !== CHECKPOINT_VERSION || !record.snapshot) return null;
      snapshotApi()?.validate?.(record.snapshot);
      return record;
    } catch {
      return null;
    }
  }

  function writeRecord(key, record) {
    localStorage.setItem(key, JSON.stringify(record));
  }

  function activeIds() {
    const profile = window.__hobunjiPlayerProfile || {};
    return {
      characterId: String(profile.characterId || ''),
      worldId: String(profile.worldId || ''),
    };
  }

  function numericInventoryTotal(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
    let total = 0;
    for (const count of Object.values(value)) {
      const numeric = Number(count);
      if (Number.isFinite(numeric) && numeric > 0) total += numeric;
    }
    return total;
  }

  function checkpointStats(snapshot) {
    const meta = snapshot?.meta || {};
    const ids = activeIds();
    const character = (meta.characters || []).find(entry => String(entry?.id || '') === ids.characterId) || null;
    const world = (meta.worlds || []).find(entry => String(entry?.id || '') === ids.worldId) || null;
    const member = world?.members?.[ids.characterId] || null;
    const memberInventory = member?.nonGearInventory || {};
    const worldStorage = world?.storage || {};
    return {
      bytes: JSON.stringify(snapshot || null).length,
      characterCount: (meta.characters || []).length,
      worldCount: (meta.worlds || []).length,
      memberInventoryKeys: Object.keys(memberInventory).length,
      memberInventoryUnits: numericInventoryTotal(memberInventory),
      worldStorageKeys: Object.keys(worldStorage).length,
      worldStorageUnits: numericInventoryTotal(worldStorage),
      livestockCount: Array.isArray(world?.livestock) ? world.livestock.length : 0,
      stableCount: Array.isArray(character?.stable) ? character.stable.length : 0,
    };
  }

  function integrityRisk(previousRecord, nextSnapshot) {
    if (!previousRecord?.snapshot) return '';
    const before = previousRecord.stats || checkpointStats(previousRecord.snapshot);
    const after = checkpointStats(nextSnapshot);
    const nextActive = activeIds(); // Used to avoid comparing one farmer/world's inventory totals with another save slot.
    const previousActive = previousRecord.active || {}; // Active ids stored with the older checkpoint for same-save integrity checks.
    const sameActiveSave = previousActive.characterId === nextActive.characterId && previousActive.worldId === nextActive.worldId; // Gates farm-specific reset heuristics to one save slot.
    if (before.characterCount > after.characterCount) return 'character count unexpectedly dropped';
    if (before.worldCount > after.worldCount) return 'world count unexpectedly dropped';
    if (before.bytes >= 1000 && after.bytes < before.bytes * 0.6) return 'save payload shrank by more than 40%';
    if (!sameActiveSave) return '';
    if (before.memberInventoryKeys >= 3 && after.memberInventoryKeys === 0) return 'active farmer inventory suddenly became empty';
    if (before.memberInventoryUnits >= 10 && after.memberInventoryUnits === 0) return 'active farmer inventory count suddenly became zero';
    if (before.worldStorageKeys >= 3 && after.worldStorageKeys === 0) return 'farm storage suddenly became empty';
    if (before.worldStorageUnits >= 10 && after.worldStorageUnits === 0) return 'farm storage count suddenly became zero';
    if (before.livestockCount >= 2 && after.livestockCount === 0) return 'world livestock suddenly became empty';
    if (before.stableCount >= 2 && after.stableCount === 0) return 'stable animals suddenly became empty';
    return '';
  }

  function isHydrated() {
    return window.__hobunjiGameStarted === true && runtimeSaveApi()?.isReady?.() === true;
  }

  function markHydrated() {
    if (!hydratedAt && isHydrated()) hydratedAt = Date.now();
  }

  function flushLiveState(reason) {
    const runtime = runtimeSaveApi();
    if (!runtime?.isReady?.()) throw new Error('The live farm save is not ready yet. Wait until the game has finished loading.');
    const result = runtime.flushNow({ reason });
    if (!result?.ok) throw new Error(result?.error || 'Could not flush the live farm state.');
  }

  function createRecord(kind, snapshot, reason) {
    return {
      checkpointVersion: CHECKPOINT_VERSION,
      kind,
      savedAt: Date.now(),
      reason,
      active: activeIds(),
      summary: snapshotApi().summary(snapshot),
      stats: checkpointStats(snapshot),
      snapshot,
    };
  }

  function saveManual({ reason = 'menu-manual-save' } = {}) {
    try {
      if (!isHydrated()) throw new Error('Manual save is unavailable until the farmer and farm finish loading.');
      flushLiveState('manual-checkpoint');
      const snapshot = snapshotApi()?.capture?.({ strict: true });
      if (!snapshot) throw new Error('Save snapshot system is unavailable.');
      writeRecord(MANUAL_KEY, createRecord('manual', snapshot, reason));
      manualSavesWritten++;
      lastAction = 'manual-saved';
      lastError = '';
      return { ok: true, record: readRecord(MANUAL_KEY) };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'manual-save-error';
      return { ok: false, error: lastError };
    }
  }

  function saveAuto({ reason = 'timer' } = {}) {
    markHydrated();
    if (!isHydrated()) {
      autosavesSkipped++;
      lastAction = 'autosave-skipped-not-hydrated';
      return { ok: false, skipped: true, reason: 'not-hydrated' };
    }
    if (Date.now() - hydratedAt < AUTO_GRACE_MS) {
      autosavesSkipped++;
      lastAction = 'autosave-skipped-grace';
      return { ok: false, skipped: true, reason: 'load-grace' };
    }

    try {
      flushLiveState(`auto-checkpoint:${reason}`);
      const api = snapshotApi();
      const snapshot = api?.capture?.({ strict: true });
      if (!snapshot) throw new Error('Save snapshot system is unavailable.');
      const fingerprint = api.fingerprint(snapshot);
      if (fingerprint === lastAutosaveFingerprint) {
        autosavesSkipped++;
        lastAction = 'autosave-skipped-unchanged';
        return { ok: true, skipped: true, reason: 'unchanged' };
      }

      const current = readRecord(AUTO_KEY);
      const risk = integrityRisk(current, snapshot);
      if (risk) {
        lastIntegrityWarning = risk;
        autosavesSkipped++;
        lastAction = 'autosave-blocked-integrity';
        try { window.__farmLog?.(`Recovery autosave blocked: ${risk}.`, 'warn'); } catch (_) {}
        return { ok: false, skipped: true, reason: 'integrity', warning: risk };
      }

      const previous = readRecord(AUTO_PREVIOUS_KEY);
      if (current && (!previous || current.savedAt - previous.savedAt >= AUTO_PREVIOUS_MIN_AGE_MS)) {
        writeRecord(AUTO_PREVIOUS_KEY, current);
      }
      const record = createRecord('autosave', snapshot, reason);
      writeRecord(AUTO_KEY, record);
      lastAutosaveFingerprint = fingerprint;
      autosavesWritten++;
      lastIntegrityWarning = '';
      lastError = '';
      lastAction = 'autosaved';
      return { ok: true, record };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'autosave-error';
      return { ok: false, error: lastError };
    }
  }

  function applyRecord(record) {
    try {
      if (!record?.snapshot) throw new Error('That recovery checkpoint is unavailable.');
      snapshotApi().apply(record.snapshot);
      restoresApplied++;
      lastAction = `restored-${record.kind || 'checkpoint'}`;
      lastError = '';
      setTimeout(() => location.reload(), 0);
      return { ok: true };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'restore-error';
      return { ok: false, error: lastError };
    }
  }

  function fmtTime(record) {
    if (!record?.savedAt) return 'Unavailable';
    try { return new Date(record.savedAt).toLocaleString(); } catch { return String(record.savedAt); }
  }

  function recordDetail(record) {
    if (!record) return 'No checkpoint yet.';
    const s = record.summary || {};
    return `${fmtTime(record)} · ${s.characterCount || 0} farmer(s) · ${s.worldCount || 0} world(s) · ${s.farmLayoutCount || 0} farm layout(s)`;
  }

  function closeRecoveryModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function openRecoveryModal() {
    closeRecoveryModal();
    const choices = [
      { key: MANUAL_KEY, title: 'Manual Save', note: 'Only changes when you press the manual save button.' },
      { key: AUTO_KEY, title: 'Latest Autosave', note: 'Rolling recovery checkpoint captured after the load grace period.' },
      { key: AUTO_PREVIOUS_KEY, title: 'Earlier Autosave', note: 'Older rolling checkpoint kept separately from the latest autosave.' },
    ];
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '18px', boxSizing: 'border-box', background: 'rgba(5,8,10,.86)', fontFamily: 'inherit',
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(620px,96vw)', maxHeight: '88vh', overflow: 'auto', padding: '18px', borderRadius: '12px',
      background: '#151b20', color: '#eef3f6', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 18px 60px rgba(0,0,0,.55)',
    });
    panel.innerHTML = '<div style="font-size:20px;font-weight:700;margin-bottom:6px;">Save Recovery</div><div style="font-size:12px;line-height:1.45;color:#aebbc3;margin-bottom:12px;">Restoring replaces the live browser autosave and reloads the game. Manual and autosave checkpoints remain separate.</div>';

    for (const choice of choices) {
      const record = readRecord(choice.key);
      const row = document.createElement('div');
      Object.assign(row.style, { border: '1px solid rgba(255,255,255,.13)', borderRadius: '9px', padding: '11px', marginBottom: '9px' });
      const title = document.createElement('div');
      title.textContent = choice.title;
      title.style.fontWeight = '700';
      const detail = document.createElement('div');
      detail.textContent = recordDetail(record);
      Object.assign(detail.style, { fontSize: '12px', color: '#c2cdd3', marginTop: '3px' });
      const note = document.createElement('div');
      note.textContent = choice.note;
      Object.assign(note.style, { fontSize: '11px', color: '#81939e', marginTop: '3px' });
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = record ? 'Restore' : 'Unavailable';
      button.disabled = !record;
      Object.assign(button.style, { marginTop: '8px', padding: '7px 11px', borderRadius: '7px', border: '1px solid #7f9e88', background: '#294b32', color: '#effff2', cursor: record ? 'pointer' : 'default' });
      button.addEventListener('click', () => {
        if (!record) return;
        if (!confirm(`Restore ${choice.title} from ${fmtTime(record)}? Current live autosave data will be replaced.`)) return;
        const result = applyRecord(record);
        if (!result.ok) alert(`Could not restore checkpoint:\n${result.error}`);
      });
      row.append(title, detail, note, button);
      panel.appendChild(row);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    Object.assign(close.style, { float: 'right', marginTop: '4px', padding: '7px 12px', borderRadius: '7px', border: '1px solid #64737b', background: '#273138', color: '#e5ecef' });
    close.addEventListener('click', closeRecoveryModal);
    panel.appendChild(close);
    overlay.appendChild(panel);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeRecoveryModal(); });
    document.body.appendChild(overlay);
  }

  function installMenuButtons() {
    const controls = document.querySelector('#menuPanel .mp-ctrls');
    if (!controls) return false;

    if (!document.getElementById(MANUAL_BUTTON_ID)) {
      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.id = MANUAL_BUTTON_ID;
      saveButton.className = 'mp-ctrl-btn';
      saveButton.title = 'Create manual save checkpoint';
      saveButton.setAttribute('aria-label', 'Create manual save checkpoint');
      saveButton.textContent = '💾';
      saveButton.addEventListener('click', () => {
        const result = saveManual();
        alert(result.ok ? `Manual save created.\n${recordDetail(result.record)}` : `Manual save failed:\n${result.error}`);
      });
      const closeButton = controls.querySelector('#mpClose');
      controls.insertBefore(saveButton, closeButton || null);
    }

    if (!document.getElementById(RECOVERY_BUTTON_ID)) {
      const restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.id = RECOVERY_BUTTON_ID;
      restoreButton.className = 'mp-ctrl-btn';
      restoreButton.title = 'Open save recovery';
      restoreButton.setAttribute('aria-label', 'Open save recovery');
      restoreButton.textContent = '🛟';
      restoreButton.addEventListener('click', openRecoveryModal);
      const closeButton = controls.querySelector('#mpClose');
      controls.insertBefore(restoreButton, closeButton || null);
    }
    return true;
  }

  function startAutosaves() {
    if (autoTimer) return;
    markHydrated();
    autoTimer = setInterval(() => saveAuto({ reason: 'timer' }), AUTO_INTERVAL_MS);
  }

  function onPlayerReady() {
    markHydrated();
    startAutosaves();
    installMenuButtons();
  }

  document.addEventListener('hobunjiPlayerReady', onPlayerReady);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAuto({ reason: 'visibility-hidden' });
  });
  document.addEventListener('DOMContentLoaded', () => {
    installMenuButtons();
    if (window.__hobunjiGameStarted === true) onPlayerReady();
  }, { once: true });

  const existingAuto = readRecord(AUTO_KEY);
  if (existingAuto?.snapshot) {
    try { lastAutosaveFingerprint = snapshotApi()?.fingerprint?.(existingAuto.snapshot) || ''; } catch {}
  }

  window.HobunjiSaveCheckpoints = {
    saveManual,
    saveAuto,
    openRecoveryModal,
    restoreManual: () => applyRecord(readRecord(MANUAL_KEY)),
    restoreLatestAuto: () => applyRecord(readRecord(AUTO_KEY)),
    restorePreviousAuto: () => applyRecord(readRecord(AUTO_PREVIOUS_KEY)),
    getStatus: () => ({
      manual: readRecord(MANUAL_KEY),
      auto: readRecord(AUTO_KEY),
      autoPrevious: readRecord(AUTO_PREVIOUS_KEY),
      hydrated: isHydrated(),
      hydratedAt: hydratedAt || null,
      lastAction,
      lastError: lastError || null,
      lastIntegrityWarning: lastIntegrityWarning || null,
    }),
  };

  window.__hobunjiSaveCheckpointDebug = {
    snapshot: () => ({
      hydrated: isHydrated(),
      hydratedAt: hydratedAt || null,
      autosavesWritten,
      autosavesSkipped,
      manualSavesWritten,
      restoresApplied,
      hasManual: !!readRecord(MANUAL_KEY),
      hasAuto: !!readRecord(AUTO_KEY),
      hasAutoPrevious: !!readRecord(AUTO_PREVIOUS_KEY),
      lastAction,
      lastError: lastError || null,
      lastIntegrityWarning: lastIntegrityWarning || null,
    }),
  };
})();
