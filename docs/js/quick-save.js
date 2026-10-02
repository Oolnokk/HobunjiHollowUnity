// Quick Save / Quick Load (Dev Companion) — "save state" style checkpoints
// that hold more than a normal save: the full browser save snapshot PLUS the
// exact live placement (area, sub-tile position, facing, the doorway the
// player will walk back out of) so a quick load drops you back on the exact
// spot — e.g. right before a conversation — instead of the farmhouse login
// spawn. Typical loop: quick save → talk → edit the dialogue/conditions in
// an editor (local override) → quick load → talk again.
//
// Why a reload: config (NPC database, maps, etc.) loads once at boot, so a
// reload is what makes edited configuration visible. The snapshot is applied
// at the START of the next boot (FolderSavePrimary.prepareBeforeOnboarding
// calls applyPendingBeforeOnboarding) rather than before unloading, so no
// unload-time flush or timer of the old page can write over it. Onboarding
// then auto-plays the same farmer/world (takeAutoPlay) and game.js's
// spawnPlayerAvatar hands placement to restoreResume().
//
// Slots live in IndexedDB (a save can be several MB — too big to duplicate
// in localStorage). They are per-browser dev data, never part of the save.
(() => {
  'use strict';

  if (window.HobunjiQuickSave) return;

  const DB_NAME = 'hobunjiQuickSaves';
  const STORE = 'slots';
  const MAX_SLOTS = 12;
  const PENDING_KEY = 'hobunjiQuickLoadPending.v1'; // {slotId, requestedAt}
  const AUTOPLAY_KEY = 'hobunjiAutoPlay.v1'; // {characterId, worldId, requestedAt, reason}
  const RESUME_KEY = 'hobunjiQuickResume.v1'; // {slotId, characterId, worldId, exact}
  const PENDING_MAX_AGE_MS = 3 * 60 * 1000;
  const QUICK_SAVE_VERSION = 1;

  let deps = null; // Injected by game.js (see init).
  let lastAction = 'initialized';
  let lastError = '';
  let lastResume = null; // {ok, area, fallback, at, error}

  // ── IndexedDB ───────────────────────────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is unavailable in this browser.')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        Promise.resolve(fn(store, value => { result = value; })).catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Quick save transaction aborted.'));
      });
    } finally {
      db.close();
    }
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getSlot(id) {
    return withStore('readonly', async (store, set) => set(await requestValue(store.get(String(id)))));
  }

  async function allSlots() {
    return withStore('readonly', async (store, set) => set(await requestValue(store.getAll())));
  }

  async function putSlot(slot) {
    return withStore('readwrite', store => { store.put(slot); });
  }

  async function deleteSlot(id) {
    return withStore('readwrite', store => { store.delete(String(id)); });
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function readSession(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
  }
  function writeSession(key, value) {
    try {
      if (value == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch { return false; }
  }

  function activeIds() {
    const profile = window.__hobunjiPlayerProfile || {};
    return { characterId: String(profile.characterId || ''), worldId: String(profile.worldId || '') };
  }

  function slotSummary(slot) {
    if (!slot) return null;
    return {
      id: slot.id,
      label: slot.label,
      savedAt: slot.savedAt,
      characterId: slot.characterId,
      worldId: slot.worldId,
      characterName: slot.characterName || '',
      worldLabel: slot.worldLabel || '',
      exact: slot.exact ? { area: slot.exact.area, x: slot.exact.x, y: slot.exact.y, angle: slot.exact.angle, areaLabel: slot.exact.areaLabel || slot.exact.area } : null,
      context: slot.context || null,
      bytes: slot.bytes || null,
    };
  }

  // Same clock the HUD shows (the represented day spans only the active
  // hours, so time01 is not a 24h fraction).
  function describeTime(calendar) {
    if (!calendar) return '';
    const cal = window.CalendarSystem;
    const clock = cal?.formatClockTime && cal?.getHour ? cal.formatClockTime(cal.getHour(Number(calendar.time01) || 0)) : '';
    return `Day ${calendar.day ?? '?'}${clock ? ` ${clock}` : ''}`;
  }

  // ── Quick save ──────────────────────────────────────────────────────
  async function quickSave({ label = '' } = {}) {
    try {
      if (window.__hobunjiGameStarted !== true) throw new Error('The game has not finished loading a save yet.');
      if (!deps) throw new Error('Quick save is not wired into the game yet.');
      const ids = activeIds();
      if (!ids.characterId || !ids.worldId) throw new Error('No active farmer/world.');

      deps.flushAll?.(); // Writes live member state, farm layout, and the exact calendar into the browser save first.
      const snapshotApi = window.HobunjiSaveSnapshot;
      if (!snapshotApi?.capture) throw new Error('Save snapshot system is unavailable.');
      const snapshot = snapshotApi.capture({ strict: true });
      const exact = deps.captureExactState?.() || null;
      const context = deps.describeContext?.() || null;
      const meta = snapshot.meta || {};
      const character = (meta.characters || []).find(c => String(c.id) === ids.characterId);
      const world = (meta.worlds || []).find(w => String(w.id) === ids.worldId);
      let bytes = null;
      try { bytes = JSON.stringify(snapshot).length; } catch (_) {}
      const savedAt = Date.now();
      const slot = {
        id: `qs-${savedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        version: QUICK_SAVE_VERSION,
        label: String(label || '').trim() || `${exact?.areaLabel || exact?.area || 'Quick save'} · ${describeTime(exact?.calendar) || new Date(savedAt).toLocaleTimeString()}`,
        savedAt,
        characterId: ids.characterId,
        worldId: ids.worldId,
        characterName: character?.nickname || '',
        worldLabel: world?.label || '',
        exact,
        context,
        bytes,
        snapshot,
      };
      await putSlot(slot);
      await pruneSlots();
      lastAction = 'quick-saved';
      lastError = '';
      try { window.__farmLog?.(`Quick saved: ${slot.label}`, 'info'); } catch (_) {}
      deps.showToast?.('⚡ Quick saved', true);
      return { ok: true, slot: slotSummary(slot) };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'quick-save-error';
      return { ok: false, error: lastError };
    }
  }

  async function pruneSlots() {
    const slots = (await allSlots()).sort((a, b) => b.savedAt - a.savedAt);
    for (const slot of slots.slice(MAX_SLOTS)) {
      if (slot.pinned) continue;
      await deleteSlot(slot.id);
    }
  }

  async function list() {
    try {
      const slots = await allSlots();
      return slots.sort((a, b) => b.savedAt - a.savedAt).map(slotSummary);
    } catch (error) {
      lastError = String(error?.message || error);
      return [];
    }
  }

  async function rename(id, label) {
    const slot = await getSlot(id);
    if (!slot) return { ok: false, error: 'Quick save not found.' };
    slot.label = String(label || '').trim() || slot.label;
    await putSlot(slot);
    return { ok: true, slot: slotSummary(slot) };
  }

  async function remove(id) {
    await deleteSlot(id);
    return { ok: true };
  }

  // ── Quick load ──────────────────────────────────────────────────────
  // Schedules the load and reloads the tab; the snapshot is applied at the
  // start of the next boot. pauseAutosave (default on) keeps the rewind out
  // of the canonical save until you resume autosave yourself.
  async function quickLoad(id = 'latest', { pauseAutosave = true, reload = true } = {}) {
    try {
      let slot = null;
      if (!id || id === 'latest') {
        const ids = activeIds();
        const slots = (await allSlots()).sort((a, b) => b.savedAt - a.savedAt);
        slot = slots.find(s => !ids.characterId || (s.characterId === ids.characterId && s.worldId === ids.worldId)) || slots[0] || null;
      } else {
        slot = await getSlot(id);
      }
      if (!slot) throw new Error('No quick save to load yet.');
      window.HobunjiSaveSnapshot?.validate?.(slot.snapshot);
      if (pauseAutosave) window.HobunjiAutosavePause?.pause?.('quick-load');
      if (!writeSession(PENDING_KEY, { slotId: slot.id, requestedAt: Date.now() })) throw new Error('Could not record the pending quick load (sessionStorage unavailable).');
      lastAction = 'quick-load-scheduled';
      lastError = '';
      if (reload) {
        window.HobunjiSessionPersistenceStartupGuard?.suppressExitFlush?.('quick-load'); // The old in-memory game must not flush itself during the reload.
        setTimeout(() => location.reload(), 30);
      }
      return { ok: true, slot: slotSummary(slot), reloading: !!reload };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'quick-load-error';
      return { ok: false, error: lastError };
    }
  }

  // Called by FolderSavePrimary.prepareBeforeOnboarding before it would pull
  // the Primary Save Folder into the browser; {applied:true} tells it to skip
  // that pull (the quick-load snapshot IS the intended browser state).
  async function applyPendingBeforeOnboarding() {
    const pending = readSession(PENDING_KEY);
    if (!pending) return { applied: false };
    writeSession(PENDING_KEY, null); // Consumed first so a failure can never loop reloads.
    if (!pending.slotId || Date.now() - (Number(pending.requestedAt) || 0) > PENDING_MAX_AGE_MS) {
      lastAction = 'quick-load-expired';
      return { applied: false, expired: true };
    }
    try {
      const slot = await getSlot(pending.slotId);
      if (!slot?.snapshot) throw new Error('The quick save to load no longer exists.');
      window.HobunjiSaveSnapshot.apply(slot.snapshot);
      writeSession(AUTOPLAY_KEY, { characterId: slot.characterId, worldId: slot.worldId, requestedAt: Date.now(), reason: 'quick-load' });
      writeSession(RESUME_KEY, { slotId: slot.id, characterId: slot.characterId, worldId: slot.worldId, exact: slot.exact || null, label: slot.label });
      lastAction = 'quick-load-applied';
      lastError = '';
      return { applied: true, slot: slotSummary(slot) };
    } catch (error) {
      lastError = String(error?.message || error);
      lastAction = 'quick-load-apply-error';
      console.warn('[quick-save] could not apply pending quick load', error);
      return { applied: false, error: lastError };
    }
  }

  // Lets any intentional reload (quick load, a recovery restore from the Dev
  // Companion) skip the save-select screen and re-enter the same save.
  function requestAutoPlay({ characterId, worldId, reason = 'companion' } = {}) {
    if (!characterId || !worldId) return false;
    return writeSession(AUTOPLAY_KEY, { characterId: String(characterId), worldId: String(worldId), requestedAt: Date.now(), reason });
  }

  // Consumed by onboarding-core.js's init once the save-select model exists.
  function takeAutoPlay() {
    const value = readSession(AUTOPLAY_KEY);
    writeSession(AUTOPLAY_KEY, null);
    if (!value?.characterId || !value?.worldId) return null;
    if (Date.now() - (Number(value.requestedAt) || 0) > PENDING_MAX_AGE_MS) return null;
    return value;
  }

  // ── Exact placement restore (called from game.js spawnPlayerAvatar) ──
  function takeResume(playerData) {
    const value = readSession(RESUME_KEY);
    if (!value) return null;
    writeSession(RESUME_KEY, null);
    if (!value.exact || String(value.characterId) !== String(playerData?.characterId || '') || String(value.worldId) !== String(playerData?.worldId || '')) return null;
    return value;
  }

  async function travelTo(exact) {
    const d = deps;
    const tile = Number(d.TILE) || 1;
    const area = String(exact.area || '');
    const col = Math.floor(Number(exact.x) / tile);
    const row = Math.floor(Number(exact.y) / tile);
    if (!Number.isFinite(col) || !Number.isFinite(row)) throw new Error('Saved position is invalid.');
    if (area === 'interior') d.placeInFarmhouse();
    else if (area === 'farm') { /* Boot already stands on the farm. */ }
    else if (area === 'town') d.enterTown(col, row);
    else if (d.isZoneArea(area)) await d.enterZone(area, col, row);
    else if (d.isBuildingArea(area)) {
      d.enterBuilding(area, col, row);
      const ready = await d.waitForArea(area);
      if (!ready) throw new Error(`Timed out loading ${area}.`);
    } else throw new Error(`Unknown area "${area}".`);
    if (d.getCurrentArea() !== area) throw new Error(`Landed in ${d.getCurrentArea()} instead of ${area}.`);
  }

  // Returns true when the player was placed (caller skips its normal login
  // spawn); false leaves the normal spawn path to run.
  async function restoreResume(playerData) {
    const resume = takeResume(playerData);
    if (!resume || !deps) return false;
    const exact = resume.exact;
    try {
      await travelTo(exact);
      const player = deps.player;
      player.x = Number(exact.x); player.y = Number(exact.y);
      player.vx = 0; player.vy = 0;
      if (Number.isFinite(exact.angle)) { player.angle = exact.angle; deps.setFacingAngle?.(Number.isFinite(exact.facingAngle) ? exact.facingAngle : exact.angle); }
      if (exact.returnPoint) deps.setFarmPlayerSave?.({ ...exact.returnPoint });
      deps.snapCameraTarget?.();
      lastResume = { ok: true, area: exact.area, label: resume.label, at: Date.now() };
      deps.showToast?.(`⚡ Quick loaded: ${resume.label || exact.area}`, true);
      return true;
    } catch (error) {
      lastResume = { ok: false, area: exact?.area, error: String(error?.message || error), at: Date.now() };
      console.warn('[quick-save] exact placement failed; using the normal login spawn', error);
      deps.showToast?.(`Quick load: could not return to ${exact?.area} (${lastResume.error}) — starting at the farmhouse.`, false);
      if (deps.getCurrentArea() === 'farm') return false; // Nothing moved yet: let the normal spawn run.
      return true; // Already moved somewhere valid; keep it rather than stacking a second travel.
    }
  }

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  function getStatus() {
    return {
      wired: !!deps,
      lastAction,
      lastError: lastError || null,
      lastResume,
      pendingLoad: !!readSession(PENDING_KEY),
    };
  }

  // ── Dev Companion wiring (saves tab + session header) ──────────────
  function registerCompanion() {
    const companion = window.DevCompanion;
    if (!companion) return;
    const pauseApi = () => window.HobunjiAutosavePause;
    const checkpoints = () => window.HobunjiSaveCheckpoints;

    companion.registerCommand('quick-save', args => quickSave(args));
    companion.registerCommand('quick-load', args => quickLoad(args.id || 'latest', { pauseAutosave: args.pauseAutosave !== false }));
    companion.registerCommand('quick-list', async () => ({ ok: true, slots: await list() }));
    companion.registerCommand('quick-rename', args => rename(args.id, args.label));
    companion.registerCommand('quick-delete', args => remove(args.id));
    companion.registerCommand('autosave-set', args => ({ ok: true, state: args.paused ? pauseApi()?.pause?.('dev-companion') : pauseApi()?.resume?.('dev-companion') }));
    companion.registerCommand('manual-save', async () => {
      const result = await checkpoints()?.saveManual?.({ reason: 'dev-companion-manual-save' });
      return result || { ok: false, error: 'Save checkpoints are unavailable.' };
    });
    companion.registerCommand('recovery-list', async () => {
      const api = checkpoints();
      if (!api?.listRecoveryChoices) return { ok: false, error: 'Save recovery is unavailable.' };
      return { ok: true, ...(await api.listRecoveryChoices()) };
    });
    companion.registerCommand('recovery-restore', async args => {
      const api = checkpoints();
      if (!api?.restoreChoice) return { ok: false, error: 'Save recovery is unavailable.' };
      const ids = activeIds();
      const autoPlay = args.autoPlay !== false && ids.characterId && ids.worldId;
      if (autoPlay) requestAutoPlay({ ...ids, reason: 'recovery-swap' });
      const result = await api.restoreChoice(String(args.slot || ''));
      if (!result?.ok && autoPlay) writeSession(AUTOPLAY_KEY, null);
      return result;
    });

    companion.registerStateProvider('saves', () => ({
      autosave: pauseApi()?.getState?.() || null,
      quick: getStatus(),
      checkpoint: (() => {
        const status = window.__hobunjiSaveCheckpointDebug?.snapshot?.();
        return status ? { lastAction: status.lastAction, lastError: status.lastError, folderPrimary: status.folderPrimary, hydrated: status.hydrated } : null;
      })(),
      folder: (() => {
        const status = window.LocalSaveFolder?.getStatus?.();
        return status ? { state: status.state, folderName: status.folderName || null, autoSyncArmed: !!status.autoSyncArmed, lastAction: status.lastAction || null, lastError: status.lastError || null, lastSyncedAt: status.lastSyncedAt || null } : null;
      })(),
    }));
    companion.registerStateProvider('session', () => {
      const profile = window.__hobunjiPlayerProfile || null;
      const started = window.__hobunjiGameStarted === true;
      return {
        started,
        characterId: profile?.characterId || null,
        characterName: profile?.nickname || null,
        worldId: profile?.worldId || null,
        worldLabel: profile?.worldLabel || null,
        exact: started && deps?.captureExactState ? roundExact(deps.captureExactState()) : null,
        context: started && deps?.describeContext ? deps.describeContext() : null,
      };
    });
  }

  function roundExact(exact) {
    if (!exact) return null;
    const tile = Number(deps?.TILE) || 1;
    return {
      ...exact,
      x: +Number(exact.x).toFixed(2), y: +Number(exact.y).toFixed(2),
      col: Math.floor(Number(exact.x) / tile), row: Math.floor(Number(exact.y) / tile),
      angle: +Number(exact.angle || 0).toFixed(3), facingAngle: +Number(exact.facingAngle || 0).toFixed(3),
      calendar: exact.calendar ? { ...exact.calendar, time01: +Number(exact.calendar.time01 || 0).toFixed(4), label: describeTime(exact.calendar) } : null,
    };
  }

  registerCompanion();

  window.HobunjiQuickSave = {
    init,
    quickSave,
    quickLoad,
    list,
    rename,
    remove,
    applyPendingBeforeOnboarding,
    requestAutoPlay,
    takeAutoPlay,
    restoreResume,
    getStatus,
    _slotSummary: slotSummary,
  };
})();
