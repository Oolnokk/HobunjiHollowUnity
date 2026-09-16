// Hobunji Save Checkpoints — folder-first manual + rolling autosave recovery snapshots.
// The canonical save remains characters/worlds/farm-layouts in the primary folder (or
// localStorage when no folder is active). Recovery history is independent so a bad
// autosave cannot destroy the player's last explicit manual or older rolling save.
(() => {
  'use strict';

  if (window.HobunjiSaveCheckpoints) return;

  const MANUAL_KEY = 'hobunjiSaveCheckpoint.manual.v1';
  const AUTO_KEY = 'hobunjiSaveCheckpoint.auto.v1';
  const AUTO_PREVIOUS_KEY = 'hobunjiSaveCheckpoint.autoPrevious.v1';
  const PRE_RESTORE_KEY = 'hobunjiSaveCheckpoint.preRestore.v1';
  const SLOT_KEYS = Object.freeze({
    manual: MANUAL_KEY,
    auto: AUTO_KEY,
    autoPrevious: AUTO_PREVIOUS_KEY,
    preRestore: PRE_RESTORE_KEY,
  });
  const CHECKPOINT_VERSION = 1;
  const AUTO_INTERVAL_MS = 30000;
  const AUTO_GRACE_MS = 45000;
  const AUTO_PREVIOUS_MIN_AGE_MS = 5 * 60 * 1000;
  const MODAL_ID = 'hobunjiSaveRecoveryModal';
  const MANUAL_BUTTON_ID = 'menuManualSaveBtn';
  const RECOVERY_BUTTON_ID = 'menuRecoveryBtn';

  let hydratedAt = 0; // Keeps browser-fallback autosaves out of the load/hydration danger window.
  let autoTimer = null; // Folder autosync owns normal folder recovery; this timer is for browser fallback only.
  let lastAutosaveFingerprint = ''; // Avoids rewriting an identical browser-fallback checkpoint.
  let recoveryMirrorPromise = null; // Serializes folder->browser recovery reconciliation.
  let autosavesWritten = 0; // Mobile-visible count of recovery autosaves created.
  let autosavesSkipped = 0; // Mobile-visible count of intentionally skipped autosaves.
  let manualSavesWritten = 0; // Mobile-visible count of explicit manual checkpoints.
  let restoresApplied = 0; // Mobile-visible count of completed recoveries.
  let folderRecoveryReads = 0; // Mobile-visible count of folder recovery slot reads.
  let folderRecoveryWrites = 0; // Mobile-visible count of folder recovery slot writes.
  let folderBaselineSeeds = 0; // Counts primary-folder baselines created when upgrading folders with no history.
  let restoreRollbacks = 0; // Counts failed restores that successfully rolled the folder back.
  let lastAction = 'initialized'; // Latest checkpoint operation shown in diagnostics.
  let lastError = ''; // Latest checkpoint/recovery failure shown in diagnostics.
  let lastIntegrityWarning = ''; // Latest suspicious-state reason shown in diagnostics.

  function snapshotApi() {
    return window.HobunjiSaveSnapshot || null;
  }

  function runtimeSaveApi() {
    return window.HobunjiRuntimeSave || null;
  }

  function folderApi() {
    return window.LocalSaveFolder || null;
  }

  function validateRecord(record) {
    if (!record || record.checkpointVersion !== CHECKPOINT_VERSION || !record.snapshot) return null;
    snapshotApi()?.validate?.(record.snapshot);
    return record;
  }

  function safeValidateRecord(record) {
    try { return validateRecord(record); } catch { return null; }
  }

  function readRecord(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? safeValidateRecord(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function writeRecord(key, record) {
    localStorage.setItem(key, JSON.stringify(record));
  }

  function readSlot(slot) {
    const key = SLOT_KEYS[slot]; // Shared slot names keep browser fallback aligned with folder recovery filenames.
    return key ? readRecord(key) : null;
  }

  function writeSlot(slot, record) {
    const key = SLOT_KEYS[slot];
    if (!key) throw new Error(`Unknown checkpoint slot: ${String(slot)}`);
    writeRecord(key, record);
    return record;
  }

  function removeSlot(slot) {
    const key = SLOT_KEYS[slot]; // Folder authority clears stale browser history for recovery slots the folder does not contain.
    if (key) localStorage.removeItem(key);
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
    const nextActive = activeIds(); // Current farmer/world prevents unrelated save slots from sharing farm-specific reset heuristics.
    const previousActive = previousRecord.active || {};
    const sameActiveSave = previousActive.characterId === nextActive.characterId && previousActive.worldId === nextActive.worldId;
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

  function folderIsPrimary() {
    const status = folderApi()?.getStatus?.();
    return status?.state === 'ready' && status?.autoSyncArmed === true;
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

  function createRecord(kind, snapshot, reason, savedAt = Date.now()) {
    return {
      checkpointVersion: CHECKPOINT_VERSION,
      kind,
      savedAt,
      reason,
      active: activeIds(),
      summary: snapshotApi().summary(snapshot),
      stats: checkpointStats(snapshot),
      snapshot,
    };
  }

  function baselineRecord() {
    return readSlot('auto') || readSlot('manual');
  }

  function evaluateSnapshotForFolderWrite(snapshot, { recoveryKind = 'auto', force = false, automatic = false } = {}) {
    if (force || recoveryKind === 'restore') return { ok: true };
    if (automatic && !isHydrated()) {
      lastAction = 'folder-write-deferred-hydration';
      return { ok: false, deferred: true, warning: 'gameplay state is still hydrating; automatic folder save is paused' };
    }
    const risk = integrityRisk(baselineRecord(), snapshot);
    if (!risk) return { ok: true };
    lastIntegrityWarning = risk;
    lastAction = 'folder-write-blocked-integrity';
    try { window.__farmLog?.(`Primary folder save blocked: ${risk}.`, 'warn'); } catch (_) {}
    return { ok: false, warning: risk };
  }

  function canonicalSucceededWithRecoveryWarning(status) {
    return Boolean(status?.lastError && String(status?.lastAction || '').includes('primary-recovery-error'));
  }

  async function writeFolderSlot(slot, record) {
    if (!folderIsPrimary()) return false;
    const localSave = folderApi();
    if (typeof localSave?.writeRecoveryCheckpoint !== 'function') return false;
    await localSave.writeRecoveryCheckpoint(slot, record);
    folderRecoveryWrites++;
    return true;
  }

  async function promoteAutosave(snapshot, { reason = 'folder-sync', savedAt = Date.now(), writeFolder = false } = {}) {
    const current = readSlot('auto');
    const previous = readSlot('autoPrevious');
    let promotedPrevious = null;
    if (current && (!previous || current.savedAt - previous.savedAt >= AUTO_PREVIOUS_MIN_AGE_MS)) {
      promotedPrevious = current;
      writeSlot('autoPrevious', current);
    }

    const record = createRecord('autosave', snapshot, reason, savedAt);
    writeSlot('auto', record);
    lastAutosaveFingerprint = snapshotApi()?.fingerprint?.(snapshot) || '';
    autosavesWritten++;
    lastIntegrityWarning = '';
    lastError = '';
    lastAction = 'autosaved';

    if (writeFolder) {
      if (promotedPrevious) await writeFolderSlot('autoPrevious', promotedPrevious);
      await writeFolderSlot('auto', record);
    }
    return record;
  }

  async function onFolderSnapshotWritten(snapshot, { automatic = false, savedAt = Date.now(), recoveryKind = 'auto' } = {}) {
    if (!folderIsPrimary() || recoveryKind === 'restore') return;
    if (recoveryKind === 'manual') {
      const record = createRecord('manual', snapshot, 'manual-folder-save', savedAt);
      writeSlot('manual', record); // Canonical write has already succeeded, so the browser mirror can now advance safely.
      manualSavesWritten++;
      await writeFolderSlot('manual', record);
      lastAction = 'manual-saved-folder';
      lastError = '';
      return record;
    }
    return promoteAutosave(snapshot, {
      reason: automatic ? 'folder-autosync' : 'folder-save',
      savedAt,
      writeFolder: true,
    });
  }

  async function ensureFolderBaseline() {
    if (!folderIsPrimary() || baselineRecord()) return false;
    const ids = activeIds();
    if (!ids.characterId || !ids.worldId) return false; // Wait until player-ready so farm-specific stats bind to the correct save slot.
    const localSave = folderApi();
    if (typeof localSave?.readPrimarySnapshot !== 'function') return false;
    const primary = await localSave.readPrimarySnapshot();
    if (!primary?.snapshot) return false;
    const characters = primary.snapshot.meta?.characters || []; // Confirms the selected farmer actually belongs to this canonical folder before binding a baseline.
    const worlds = primary.snapshot.meta?.worlds || []; // Confirms the selected world actually belongs to this canonical folder before binding a baseline.
    if (!characters.some(entry => String(entry?.id || '') === ids.characterId)) return false;
    if (!worlds.some(entry => String(entry?.id || '') === ids.worldId)) return false;
    const record = createRecord('autosave', primary.snapshot, 'folder-baseline', primary.savedAt || Date.now());
    writeSlot('auto', record);
    await writeFolderSlot('auto', record);
    lastAutosaveFingerprint = snapshotApi()?.fingerprint?.(primary.snapshot) || '';
    autosavesWritten++;
    folderBaselineSeeds++;
    lastAction = 'folder-baseline-seeded';
    lastError = '';
    return true;
  }

  async function syncRecoveryMirrorsFromFolder() {
    if (!folderIsPrimary()) return false;
    if (recoveryMirrorPromise) {
      const result = await recoveryMirrorPromise;
      await ensureFolderBaseline(); // Handles player-ready racing an earlier pre-player mirror pass.
      return result;
    }

    const localSave = folderApi();
    if (typeof localSave?.readRecoveryCheckpoint !== 'function' || typeof localSave?.readPrimarySnapshot !== 'function') return false;
    recoveryMirrorPromise = (async () => {
      const warnings = [];
      try {
        folderRecoveryReads++;
        for (const slot of Object.keys(SLOT_KEYS)) {
          let folderRaw = null;
          try {
            folderRaw = await localSave.readRecoveryCheckpoint(slot); // Slots are independent so one corrupt recovery file cannot hide the others.
          } catch (error) {
            warnings.push(`${slot}: ${String(error?.message || error)}`);
            removeSlot(slot); // Never present an unproven browser checkpoint as folder-authoritative history.
            continue;
          }
          const folderRecord = safeValidateRecord(folderRaw);
          if (folderRecord) {
            writeSlot(slot, folderRecord); // Valid folder history is the only history mirrored into browser storage once armed.
          } else {
            if (folderRaw) warnings.push(`${slot}: invalid recovery record preserved in folder`);
            removeSlot(slot); // Missing/invalid folder slots do not import browser history from another folder or fallback session.
          }
        }
        await ensureFolderBaseline(); // Old folders get a guard baseline from their own canonical save, never from browser history.
        const latest = readSlot('auto');
        lastAutosaveFingerprint = latest?.snapshot ? (snapshotApi()?.fingerprint?.(latest.snapshot) || '') : '';
        lastAction = warnings.length ? 'folder-recovery-mirrored-with-warnings' : 'folder-recovery-mirrored';
        lastError = warnings.length ? warnings.join('; ') : '';
        return true;
      } catch (error) {
        lastError = String(error?.message || error);
        lastAction = 'folder-recovery-mirror-error';
        return false;
      } finally {
        recoveryMirrorPromise = null;
      }
    })();
    return recoveryMirrorPromise;
  }

  async function saveManual({ reason = 'menu-manual-save', force = false } = {}) {
    try {
      if (!isHydrated()) throw new Error('Manual save is unavailable until the farmer and farm finish loading.');
      flushLiveState('manual-checkpoint');
      const snapshot = snapshotApi()?.capture?.({ strict: true });
      if (!snapshot) throw new Error('Save snapshot system is unavailable.');

      const risk = force ? '' : integrityRisk(baselineRecord(), snapshot);
      if (risk) {
        lastIntegrityWarning = risk;
        lastAction = 'manual-save-blocked-integrity';
        return { ok: false, skipped: true, reason: 'integrity', warning: risk, needsConfirmation: true };
      }

      if (folderIsPrimary()) {
        const status = await folderApi().syncSnapshot(snapshot, { automatic: false, recoveryKind: 'manual', force });
        if (status?.lastError && !canonicalSucceededWithRecoveryWarning(status)) {
          lastError = status.lastError;
          lastAction = 'manual-folder-save-error';
          const guardBlocked = String(status.lastAction || '').includes('save-blocked-');
          return {
            ok: false,
            error: status.lastError,
            warning: status.dataLossRisk || status.lastError,
            needsConfirmation: guardBlocked && !force,
          };
        }
        const record = readSlot('manual') || createRecord('manual', snapshot, reason);
        lastError = status?.lastError || '';
        lastAction = status?.lastError ? 'manual-primary-saved-recovery-warning' : 'manual-saved-folder';
        return { ok: true, record, folder: true, warning: status?.lastError || null };
      }

      const record = createRecord('manual', snapshot, reason);
      writeSlot('manual', record);
      manualSavesWritten++;
      lastAction = 'manual-saved-browser';
      lastError = '';
      lastIntegrityWarning = '';
      return { ok: true, record, folder: false };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'manual-save-error';
      return { ok: false, error: lastError };
    }
  }

  async function saveAuto({ reason = 'timer' } = {}) {
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
    if (folderIsPrimary() && reason === 'timer') {
      autosavesSkipped++;
      lastAction = 'autosave-skipped-folder-owned';
      return { ok: true, skipped: true, reason: 'folder-autosync-owned' };
    }

    try {
      flushLiveState(`auto-checkpoint:${reason}`);
      const api = snapshotApi();
      const snapshot = api?.capture?.({ strict: true });
      if (!snapshot) throw new Error('Save snapshot system is unavailable.');
      const fingerprint = api.fingerprint(snapshot);
      if (!folderIsPrimary() && fingerprint === lastAutosaveFingerprint) {
        autosavesSkipped++;
        lastAction = 'autosave-skipped-unchanged';
        return { ok: true, skipped: true, reason: 'unchanged' };
      }

      const risk = integrityRisk(baselineRecord(), snapshot);
      if (risk) {
        lastIntegrityWarning = risk;
        autosavesSkipped++;
        lastAction = 'autosave-blocked-integrity';
        try { window.__farmLog?.(`Recovery autosave blocked: ${risk}.`, 'warn'); } catch (_) {}
        return { ok: false, skipped: true, reason: 'integrity', warning: risk };
      }

      if (folderIsPrimary()) {
        const status = await folderApi().syncSnapshot(snapshot, { automatic: true, recoveryKind: 'auto' });
        if (status?.lastError && !canonicalSucceededWithRecoveryWarning(status)) {
          lastError = status.lastError;
          lastAction = 'autosave-folder-error';
          return { ok: false, error: lastError };
        }
        lastError = status?.lastError || '';
        return { ok: true, record: readSlot('auto'), folder: true, warning: status?.lastError || null };
      }

      const record = await promoteAutosave(snapshot, { reason, savedAt: Date.now(), writeFolder: false });
      return { ok: true, record, folder: false };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'autosave-error';
      return { ok: false, error: lastError };
    }
  }

  async function preservePreRestore() {
    let snapshot = null;
    let savedAt = Date.now();
    if (folderIsPrimary() && typeof folderApi()?.readPrimarySnapshot === 'function') {
      const primary = await folderApi().readPrimarySnapshot();
      if (primary?.snapshot) {
        snapshot = primary.snapshot;
        savedAt = primary.savedAt || savedAt;
      }
    }
    if (!snapshot) snapshot = snapshotApi()?.capture?.({ strict: true });
    if (!snapshot) throw new Error('Could not capture the current save before recovery.');
    const record = createRecord('pre-restore', snapshot, 'before-recovery', savedAt);
    writeSlot('preRestore', record);
    if (folderIsPrimary()) await writeFolderSlot('preRestore', record);
    return record;
  }

  async function rollbackRestore(preRestore, restoreError) {
    snapshotApi().apply(preRestore.snapshot); // Browser fallback returns to the pre-restore point regardless of folder rollback outcome.
    let rollbackError = '';
    try {
      const rollbackStatus = await folderApi().syncSnapshot(preRestore.snapshot, { force: true, automatic: false, recoveryKind: 'restore' });
      if (rollbackStatus?.lastError) rollbackError = rollbackStatus.lastError;
    } catch (error) {
      rollbackError = String(error?.message || error);
    }
    if (rollbackError) {
      throw new Error(`${restoreError} The automatic folder rollback also failed: ${rollbackError}. “Before Last Restore” remains preserved for recovery.`);
    }
    restoreRollbacks++;
    throw new Error(`${restoreError} The original primary-folder save was restored from “Before Last Restore.”`);
  }

  async function applyRecord(record) {
    let preRestore = null;
    try {
      if (!record?.snapshot) throw new Error('That recovery checkpoint is unavailable.');
      preRestore = await preservePreRestore();
      snapshotApi().apply(record.snapshot);

      if (folderIsPrimary()) {
        let restoreWriteError = '';
        try {
          const status = await folderApi().syncSnapshot(record.snapshot, { force: true, automatic: false, recoveryKind: 'restore' });
          if (status?.lastError) restoreWriteError = status.lastError;
        } catch (error) {
          restoreWriteError = String(error?.message || error);
        }
        if (restoreWriteError) await rollbackRestore(preRestore, `The recovery checkpoint could not be fully written to the primary folder: ${restoreWriteError}`);
      }

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
    const stats = record.stats || {};
    const farmCounts = `bag ${stats.memberInventoryUnits || 0} · storage ${stats.worldStorageUnits || 0} · livestock ${stats.livestockCount || 0} · stable ${stats.stableCount || 0}`;
    return `${fmtTime(record)} · ${s.characterCount || 0} farmer(s) · ${s.worldCount || 0} world(s) · ${farmCounts}`;
  }

  function closeRecoveryModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function recoveryChoices() {
    if (folderIsPrimary()) await syncRecoveryMirrorsFromFolder();
    let currentFolder = null;
    if (folderIsPrimary() && typeof folderApi()?.readPrimarySnapshot === 'function') {
      try {
        const primary = await folderApi().readPrimarySnapshot();
        if (primary?.snapshot) currentFolder = createRecord('current-folder', primary.snapshot, 'current-primary-folder', primary.savedAt || Date.now());
      } catch (error) {
        lastError = String(error?.message || error);
      }
    }
    return [
      { record: currentFolder, title: 'Current Folder Save', note: 'The canonical save currently used by the folder-first workflow.', current: true },
      { record: readSlot('manual'), title: 'Manual Save', note: 'Only changes when you explicitly press the manual save button.' },
      { record: readSlot('auto'), title: 'Latest Autosave', note: 'Latest good rolling checkpoint accepted by the integrity guard.' },
      { record: readSlot('autoPrevious'), title: 'Earlier Autosave', note: 'Older rolling checkpoint retained separately from the latest autosave.' },
      { record: readSlot('preRestore'), title: 'Before Last Restore', note: 'Safety copy of the canonical save immediately before the most recent recovery.' },
    ];
  }

  async function openRecoveryModal() {
    closeRecoveryModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '18px', boxSizing: 'border-box', background: 'rgba(5,8,10,.86)', fontFamily: 'inherit',
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(650px,96vw)', maxHeight: '88vh', overflow: 'auto', padding: '18px', borderRadius: '12px',
      background: '#151b20', color: '#eef3f6', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 18px 60px rgba(0,0,0,.55)',
    });
    panel.innerHTML = '<div style="font-size:20px;font-weight:700;margin-bottom:6px;">Save Recovery</div><div style="font-size:12px;line-height:1.45;color:#aebbc3;margin-bottom:12px;">The primary folder remains the current save. Recovery points are independent history; restoring first preserves the current save as “Before Last Restore.”</div><div data-recovery-loading style="font-size:12px;color:#9fb1bb;">Reading recovery history…</div>';
    overlay.appendChild(panel);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeRecoveryModal(); });
    document.body.appendChild(overlay);

    let choices;
    try {
      choices = await recoveryChoices();
    } catch (error) {
      panel.querySelector('[data-recovery-loading]').textContent = `Could not read recovery history: ${String(error?.message || error)}`;
      return;
    }
    panel.querySelector('[data-recovery-loading]')?.remove();
    for (const choice of choices) {
      const record = choice.record;
      if (choice.current && !record && !folderIsPrimary()) continue;
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
      button.textContent = choice.current ? 'Current' : (record ? 'Restore' : 'Unavailable');
      button.disabled = choice.current || !record;
      Object.assign(button.style, { marginTop: '8px', padding: '7px 11px', borderRadius: '7px', border: '1px solid #7f9e88', background: '#294b32', color: '#effff2', cursor: button.disabled ? 'default' : 'pointer' });
      button.addEventListener('click', async () => {
        if (!record || choice.current) return;
        if (!confirm(`Restore ${choice.title} from ${fmtTime(record)}? The current save will first be preserved as “Before Last Restore.”`)) return;
        button.disabled = true;
        button.textContent = 'Restoring…';
        const result = await applyRecord(record);
        if (!result.ok) {
          button.disabled = false;
          button.textContent = 'Restore';
          alert(`Could not restore checkpoint:\n${result.error}`);
        }
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
      saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        let result = await saveManual();
        if (!result.ok && result.needsConfirmation) {
          const warning = result.warning || result.error || 'This save looks destructive.';
          if (confirm(`This manual save was blocked because ${warning}. Save it anyway and replace the previous manual checkpoint?`)) {
            result = await saveManual({ reason: 'menu-manual-save-confirmed', force: true });
          }
        }
        saveButton.disabled = false;
        alert(result.ok
          ? `Manual save created${result.folder ? ' in the primary folder' : ' in browser fallback storage'}.${result.warning ? `\nWarning: ${result.warning}` : ''}\n${recordDetail(result.record)}`
          : `Manual save failed:\n${result.error || result.warning || 'Unknown save error.'}`);
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
      restoreButton.addEventListener('click', () => { openRecoveryModal(); });
      const closeButton = controls.querySelector('#mpClose');
      controls.insertBefore(restoreButton, closeButton || null);
    }
    return true;
  }

  function startAutosaves() {
    if (autoTimer) return;
    markHydrated();
    autoTimer = setInterval(() => { saveAuto({ reason: 'timer' }); }, AUTO_INTERVAL_MS);
  }

  function onPlayerReady() {
    markHydrated();
    startAutosaves();
    installMenuButtons();
    if (folderIsPrimary()) syncRecoveryMirrorsFromFolder().catch(() => {});
  }

  document.addEventListener('hobunjiPlayerReady', onPlayerReady);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAuto({ reason: 'visibility-hidden' });
  });
  document.addEventListener('DOMContentLoaded', () => {
    installMenuButtons();
    if (window.__hobunjiGameStarted === true) onPlayerReady();
  }, { once: true });

  folderApi()?.onChange?.(status => {
    if (status?.state === 'ready' && status?.autoSyncArmed) syncRecoveryMirrorsFromFolder().catch(() => {});
  });

  const existingAuto = readSlot('auto');
  if (existingAuto?.snapshot) {
    try { lastAutosaveFingerprint = snapshotApi()?.fingerprint?.(existingAuto.snapshot) || ''; } catch {}
  }

  window.HobunjiSaveCheckpoints = {
    saveManual,
    saveAuto,
    openRecoveryModal,
    evaluateSnapshotForFolderWrite,
    onFolderSnapshotWritten,
    syncRecoveryMirrorsFromFolder,
    restoreManual: () => applyRecord(readSlot('manual')),
    restoreLatestAuto: () => applyRecord(readSlot('auto')),
    restorePreviousAuto: () => applyRecord(readSlot('autoPrevious')),
    restorePreRestore: () => applyRecord(readSlot('preRestore')),
    getStatus: () => ({
      manual: readSlot('manual'),
      auto: readSlot('auto'),
      autoPrevious: readSlot('autoPrevious'),
      preRestore: readSlot('preRestore'),
      folderPrimary: folderIsPrimary(),
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
      folderPrimary: folderIsPrimary(),
      autosavesWritten,
      autosavesSkipped,
      manualSavesWritten,
      restoresApplied,
      folderRecoveryReads,
      folderRecoveryWrites,
      folderBaselineSeeds,
      restoreRollbacks,
      hasManual: !!readSlot('manual'),
      hasAuto: !!readSlot('auto'),
      hasAutoPrevious: !!readSlot('autoPrevious'),
      hasPreRestore: !!readSlot('preRestore'),
      lastAction,
      lastError: lastError || null,
      lastIntegrityWarning: lastIntegrityWarning || null,
    }),
  };
})();
