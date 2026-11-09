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
  const FESTIVAL_TEST_KEY = 'hobunjiFestivalTestSession.v1'; // Tracks the isolated test and its restore slots across reloads.
  const FESTIVAL_RECOVERY_KEY = 'hobunjiFestivalTestRecovery.v1'; // Durable recovery marker survives a closed browser tab when no Primary Save Folder is connected.
  const FESTIVAL_PREFS_KEY = 'hobunjiFestivalTestPrefs.v1'; // Remembers festival selection and the opt-in reward checkbox.

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
  async function quickSave({ label = '', pinned = false } = {}) {
    try {
      if (festivalTestSession()) throw new Error('Quick Save is disabled during Festival Test. Use Restart or Exit to return to the original world.');
      if (window.__hobunjiGameStarted !== true) throw new Error('The game has not finished loading a save yet.');
      if (!deps) throw new Error('Quick save is not wired into the game yet.');
      const ids = activeIds();
      if (!ids.characterId || !ids.worldId) throw new Error('No active farmer/world.');

      const flushed = deps.flushAll?.(); // Writes live member state, farm layout, and the exact calendar into the browser save first.
      if (flushed?.ok === false) throw new Error('Could not capture live save state: ' + (flushed.error || 'flush failed'));
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
        pinned: !!pinned, // Festival test restore points must not be pruned while the test runs.
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
    const test = festivalTestSession();
    if (test && [test.baseSlotId, test.previewSlotId, test.returnSlotId].includes(id)) {
      return { ok: false, error: 'This festival recovery snapshot cannot be deleted while the test is unfinished.' };
    }
    await deleteSlot(id);
    return { ok: true };
  }


  // ── Isolated Festival Test (Dev Companion) ────────────────────────────
  // Never rewind the live simulation. Boot a modified COPY of a full save,
  // then reload the untouched original, optionally adding journaled rewards.
  function festivalPrefs() {
    const saved = readSession(FESTIVAL_PREFS_KEY) || {};
    return { festivalId: String(saved.festivalId || 'gorkunash'), keepRewards: saved.keepRewards === true };
  }

  function festivalTestSession() {
    let session = readSession(FESTIVAL_TEST_KEY);
    // sessionStorage disappears when the tab closes. A small localStorage
    // recovery marker keeps the original IndexedDB snapshot discoverable.
    if (!session) {
      try { session = JSON.parse(localStorage.getItem(FESTIVAL_RECOVERY_KEY) || 'null'); }
      catch { session = null; }
    }
    return session && session.characterId && session.worldId ? session : null;
  }

  function writeFestivalSession(session) {
    if (!writeSession(FESTIVAL_TEST_KEY, session)) throw new Error('Festival test session storage is unavailable.');
    try {
      if (session == null) localStorage.removeItem(FESTIVAL_RECOVERY_KEY);
      else localStorage.setItem(FESTIVAL_RECOVERY_KEY, JSON.stringify(session));
    } catch (error) {
      if (session != null) {
        writeSession(FESTIVAL_TEST_KEY, null); // Refuse a sandbox without a durable recovery route.
        throw new Error('Cannot preserve festival restore information: ' + String(error?.message || error));
      }
      window.__farmLog?.('[festival-test] Could not clear durable recovery marker: ' + String(error?.message || error), 'warn');
    }
  }

  function setFestivalPrefs(next) {
    const prefs = { ...festivalPrefs(), ...next }; // Shared by the selector and reward checkbox, including across game reloads.
    if (!writeSession(FESTIVAL_PREFS_KEY, prefs)) return { ok: false, error: 'Festival test preferences could not be stored.' };
    const session = festivalTestSession();
    if (session && Object.hasOwn(next, 'keepRewards')) {
      session.keepRewards = prefs.keepRewards;
      writeFestivalSession(session);
    }
    return { ok: true, ...prefs };
  }

  function festivalStatus() {
    const session = festivalTestSession();
    return session ? {
      active: session.phase === 'active', phase: session.phase, festivalId: session.festivalId,
      keepRewards: !!session.keepRewards, rewardCount: (session.journal?.items || []).length +
        (session.journal?.masks || []).length + Object.keys(session.journal?.favor || {}).length,
      restoreSlotId: session.baseSlotId, targetDay: session.targetDay,
    } : { active: false, phase: 'idle', ...festivalPrefs() };
  }

  function recordFestivalReward(kind, entry) {
    const session = festivalTestSession();
    const ids = activeIds();
    if (!session || session.phase !== 'active' || session.characterId !== ids.characterId || session.worldId !== ids.worldId) return;
    const journal = session.journal || (session.journal = { favor: {}, items: [], masks: [] }); // Rewards journaled only by festival award handlers, never by incidental test play.
    if (kind === 'favor' && entry?.npcId && Number.isFinite(entry.amount) && entry.amount > 0) {
      journal.favor[entry.npcId] = (Number(journal.favor[entry.npcId]) || 0) + entry.amount;
    } else if (kind === 'item' && entry?.key && Number.isInteger(entry.count) && entry.count > 0) {
      journal.items.push({ key: String(entry.key), count: entry.count, stars: Math.max(1, Math.min(5, Number(entry.stars) || 3)) });
    } else if (kind === 'mask' && /^(festivalmask_[\w'-]+|replica_bzabag_helm)$/.test(entry?.id || '')) {
      if (!journal.masks.includes(entry.id)) journal.masks.push(entry.id);
    } else return;
    writeFestivalSession(session);
  }

  function festivalMember(snapshot, ids) {
    const world = snapshot?.meta?.worlds?.find(w => String(w.id) === ids.worldId);
    return world?.members?.[ids.characterId] || null;
  }

  function mergeFestivalRewards(original, tested, session) {
    const ids = { characterId: session.characterId, worldId: session.worldId };
    const member = festivalMember(original, ids);
    const after = festivalMember(tested, ids);
    if (!member || !after) throw new Error('Festival reward save does not match the original character and world.');
    const journal = session.journal || { favor: {}, items: [], masks: [] };

    // Preserve the real timeline and every unrelated field. Only explicitly
    // awarded festival Favor and items may cross the sandbox boundary.
    const relationships = member.npcRelationships || (member.npcRelationships = {});
    for (const [id, amount] of Object.entries(journal.favor || {})) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const before = relationships[id] || {};
      relationships[id] = { ...before, favor: (Number(before.favor) || 0) + amount };
    }
    const inventory = member.nonGearInventory || (member.nonGearInventory = {});
    const cooking = member.cookingState || (member.cookingState = {});
    const qualities = cooking.qualityBuckets || (cooking.qualityBuckets = {});
    for (const item of journal.items || []) {
      if (!item?.key || !Number.isInteger(item.count) || item.count <= 0) continue;
      const ownedCount = Math.max(0, Number(inventory[item.key]) || 0);
      const stackLimit = Number(window.InventoryStacks?.MAX_TOTAL) || 999; // A festival reward must never overflow the real world's item stack during merge.
      if (ownedCount + item.count > stackLimit) throw new Error('Cannot keep festival reward ' + item.key + ': inventory stack limit (' + stackLimit + ') would be exceeded.');
      inventory[item.key] = ownedCount + item.count;
      const bucket = qualities[item.key] || (qualities[item.key] = {});
      const stars = String(Math.max(1, Math.min(5, Number(item.stars) || 3)));
      bucket[stars] = (Number(bucket[stars]) || 0) + item.count;
      // Procedurally authored festival sweets must retain their definitions.
      if (after.cookingState?.cookedDefinitions?.[item.key]) {
        (cooking.cookedDefinitions ||= {})[item.key] = after.cookingState.cookedDefinitions[item.key];
      }
    }
    // Festival masks use the already-authored clothing records; don't copy
    // unrelated wardrobe edits or clothing made during the test.
    const pack = member.packClothing || (member.packClothing = []);
    const character = original.meta.characters?.find(c => String(c.id) === ids.characterId);
    const testedCharacter = tested.meta.characters?.find(c => String(c.id) === ids.characterId);
    const gearBefore = character?.gearInventory || {};
    const gearAfter = testedCharacter?.gearInventory || {};
    const owned = [
      ...pack, ...(gearBefore.clothingItems || []), ...Object.values(gearBefore.clothing || {}),
    ]; // Avoid duplicate cosmetics when the real character already owns one in Gear.
    const earned = [
      ...(after.packClothing || []), ...(gearAfter.clothingItems || []), ...Object.values(gearAfter.clothing || {}),
    ]; // Festival rewards can be granted straight to worn/owned Gear instead of Pack.
    const cosmeticIdentity = item => String(item?.baseCosmeticId || item?.cosmeticId || item?.id || (typeof item === 'string' ? item : ''));
    for (const cosmeticId of journal.masks || []) {
      if (!/^(festivalmask_[\w'-]+|replica_bzabag_helm)$/.test(cosmeticId)) continue;
      const alreadyOwned = owned.filter(item => cosmeticIdentity(item) === cosmeticId);
      const priorUids = new Set(alreadyOwned.map(item => item?.uid).filter(Boolean));
      const candidates = earned.filter(item => cosmeticIdentity(item) === cosmeticId);
      const record = candidates.find(item => item?.uid && !priorUids.has(item.uid))
        || (!alreadyOwned.length ? candidates.at(-1) : null);
      if (!record || typeof record !== 'object') throw new Error('New festival cosmetic missing from test save: ' + cosmeticId);
      const copy = JSON.parse(JSON.stringify(record)); // Never alias a gear article from the disposable snapshot.
      if (copy.uid && owned.some(item => item?.uid === copy.uid)) copy.uid += '_festival';
      pack.push(copy); owned.push(copy);
      if (cosmeticId === 'replica_bzabag_helm' && character?.gearInventory) {
        const known = character.gearInventory.knownMetalArmorBlueprints || (character.gearInventory.knownMetalArmorBlueprints = []);
        if (!known.includes(cosmeticId)) known.push(cosmeticId); // Helm ownership unlocks its authored smith recipe.
      }
    }

    const beforeFestival = member.festivals || (member.festivals = {});
    const afterFestival = after.festivals || {};
    const event = String(session.eventKey || '');
    if (event && afterFestival.claims?.[event]) {
      (beforeFestival.claims ||= {})[event] = {
        ...(beforeFestival.claims?.[event] || {}), ...afterFestival.claims[event],
      };
      if (event.endsWith(':gorkunash') && afterFestival.potluckContests?.[event]) {
        (beforeFestival.potluckContests ||= {})[event] = afterFestival.potluckContests[event];
      }
    }
    // A completed festival claim transfers its payout ledger, but pending
    // Fun stays in the test until explicitly settled. It must never create
    // a phantom payout or suppress real rewards on the original timeline.
    if (event && afterFestival.festivalFunPaid && Object.keys(journal.favor || {}).length) {
      for (const name of ['festivalFunEarned', 'festivalFunPaid', 'festivalMealPortions']) {
      const entries = afterFestival[name] || {};
        for (const [key, value] of Object.entries(entries)) {
          if (key.startsWith(event + ':')) (beforeFestival[name] ||= {})[key] = value;
        }
      }
    }
    if (event.endsWith(':tzizkhanash') && afterFestival.claims?.[event]?.offering && afterFestival.blessing) {
      const cal = window.CalendarSystem;
      const oldDay = original.meta.worlds.find(w => String(w.id) === ids.worldId)?.calendar?.day;
      const elapsedDay = tested.meta.worlds.find(w => String(w.id) === ids.worldId)?.calendar?.day;
      const age = day => cal.aotYearNumber(day) * 336 + cal.dayOfYear(day) - 1;
      if (!Number.isFinite(oldDay) || !Number.isFinite(elapsedDay)) throw new Error('Could not translate festival blessing to the restored calendar.');
      const remaining = Math.max(0, Number(afterFestival.blessing.expiresDay) - age(elapsedDay));
      beforeFestival.blessing = { ...afterFestival.blessing, expiresDay: age(oldDay) + remaining };
    }
  }

  async function startFestivalTest() {
    if (festivalTestSession()) return { ok: false, error: 'Exit the existing festival test before starting another.' };
    if (window.__hobunjiGameStarted !== true || !deps) return { ok: false, error: 'Start a world before testing a festival.' };
    const cal = window.CalendarSystem;
    const prefs = festivalPrefs();
    const festival = window.FestivalCalendar?.get?.(prefs.festivalId);
    if (!festival || !cal?.absDayForMonthStart || !cal?.aotYearNumber) return { ok: false, error: 'Festival calendar is unavailable.' };
    const ids = activeIds();
    const wasPaused = window.HobunjiAutosavePause?.isPaused?.() === true;
    const saved = await quickSave({ label: 'Festival test return point', pinned: true });
    if (!saved.ok) return saved;
    const baseline = await getSlot(saved.slot.id);
    let year = cal.aotYearNumber();
    let day = cal.absDayForMonthStart(year, festival.month - 1) + festival.day - 1;
    const currentDay = baseline.snapshot.meta.worlds.find(w => String(w.id) === ids.worldId)?.calendar?.day;
    if (!Number.isFinite(currentDay)) return { ok: false, error: 'Current world has no saved calendar.' };
    while (day < currentDay || day < 1) {
      year++;
      day = cal.absDayForMonthStart(year, festival.month - 1) + festival.day - 1;
    }
    const preview = JSON.parse(JSON.stringify(baseline)); // Used only for the temporary festival-world boot.
    const previewWorld = preview.snapshot.meta.worlds.find(w => String(w.id) === ids.worldId);
    previewWorld.calendar.day = day;
    previewWorld.calendar.time01 = (15 - cal.getHour(0)) / (cal.getHour(1) - cal.getHour(0)); // Begins at 15:00 using the calendar's own represented hours.
    previewWorld.lastDay = day; // Avoid treating every skipped day as a pending overnight rollover.
    previewWorld.lastSeason = cal.seasonForDay(day)?.name || previewWorld.lastSeason;
    const previewFestival = previewWorld.members?.[ids.characterId]?.festivals; // Only the disposable preview loses earlier claims so every festival activity can be retested.
    const eventKey = year + ':' + festival.id;
    if (previewFestival) {
      if (previewFestival.claims) delete previewFestival.claims[eventKey];
      if (previewFestival.potluckContests) {
        delete previewFestival.potluckContests[eventKey];
        for (const [key, contest] of Object.entries(previewFestival.potluckContests)) {
          if (key !== eventKey && contest) contest.favorAwarded = true; // Don't pay old contests merely because the test jumped forward.
        }
      }
      for (const ledger of ['festivalFunEarned', 'festivalFunPaid', 'festivalMealPortions']) {
        for (const key of Object.keys(previewFestival[ledger] || {})) {
          if (key.startsWith(eventKey + ':')) delete previewFestival[ledger][key];
        }
      }
      previewFestival.festivalFun = {}; // Old unpaid Fun belongs to the original timeline, not this test.
      previewFestival.funDay = year * 336 + cal.dayOfYear(day) - 1;
    }
    preview.id = 'festival-test-preview-' + Date.now().toString(36);
    preview.label = 'Festival test: ' + festival.name;
    preview.pinned = true;
    preview.festivalTemporary = true;
    if (preview.exact?.calendar) preview.exact.calendar = { ...preview.exact.calendar, ...previewWorld.calendar };
    await putSlot(preview);
    const session = {
      characterId: ids.characterId, worldId: ids.worldId, festivalId: festival.id,
      eventKey: year + ':' + festival.id, targetDay: day,
      baseSlotId: baseline.id, previewSlotId: preview.id, phase: 'starting',
      keepRewards: !!prefs.keepRewards, wasPaused, startedAt: Date.now(),
      journal: { favor: {}, items: [], masks: [] },
    }; // One tab-local journal identifies only the running festival test.
    writeFestivalSession(session);
    const result = await quickLoad(preview.id, { pauseAutosave: true, festivalInternal: true });
    if (!result.ok) {
      writeFestivalSession(null);
      await deleteSlot(preview.id);
    }
    return result;
  }

  function resumeFestivalAutoPlay() {
    const session = festivalTestSession();
    if (!session) return false;
    requestAutoPlay({ characterId: session.characterId, worldId: session.worldId, reason: 'festival-test-refresh' });
    return true;
  }

  async function recoverFestivalTest() {
    const session = festivalTestSession();
    if (!session) return { ok: false, error: 'No festival restore is pending.' };
    if (session.phase === 'active') return exitFestivalTest();
    const previous = { ...session }; // Recovery restores the last phase if scheduling a reload fails.
    const slotId = ['returning', 'restored'].includes(session.phase) && session.returnSlotId ? session.returnSlotId : session.baseSlotId;
    const restoreSlot = await getSlot(slotId);
    if (!restoreSlot?.snapshot) return { ok: false, error: 'Original festival restore snapshot missing. Use the pinned Quick Save recovery point.' };
    session.returnSlotId = slotId;
    session.phase = 'recovering';
    writeFestivalSession(session);
    const result = await quickLoad(slotId, { pauseAutosave: true, festivalInternal: true });
    if (!result.ok) writeFestivalSession(previous);
    return result;
  }

  async function restartFestivalTest() {
    const session = festivalTestSession();
    if (!session || session.phase !== 'active') return { ok: false, error: 'There is no running festival test.' };
    const previousJournal = session.journal;
    session.journal = { favor: {}, items: [], masks: [] }; // Restart discards the previous attempt's awards.
    session.phase = 'starting';
    writeFestivalSession(session);
    const result = await quickLoad(session.previewSlotId, { pauseAutosave: true, festivalInternal: true });
    if (!result.ok) { session.phase = 'active'; session.journal = previousJournal; writeFestivalSession(session); }
    return result;
  }

  async function exitFestivalTest() {
    const session = festivalTestSession();
    if (!session || session.phase !== 'active') return { ok: false, error: 'There is no running festival test.' };
    const ids = activeIds();
    if (ids.characterId !== session.characterId || ids.worldId !== session.worldId) return { ok: false, error: 'The active save changed during this festival test.' };
    const baseline = await getSlot(session.baseSlotId);
    if (!baseline?.snapshot) return { ok: false, error: 'The festival restore snapshot is missing. Do not save over the test world.' };
    try {
      const returnSlot = JSON.parse(JSON.stringify(baseline)); // Never modify the pinned original restore point.
      if (session.keepRewards) {
        window.FestivalSystem?.settleTestRewards?.(); // Convert same-day earned Festival Fun before the discard/restore boundary.
        const flushed = deps.flushAll?.();
        if (flushed?.ok === false) throw new Error('Cannot collect test rewards: ' + (flushed.error || 'save flush failed'));
        const tested = window.HobunjiSaveSnapshot.capture({ strict: true });
        mergeFestivalRewards(returnSlot.snapshot, tested, session);
      }
      returnSlot.id = 'festival-test-return-' + Date.now().toString(36);
      returnSlot.label = 'Restored from festival test';
      returnSlot.festivalTemporary = true;
      returnSlot.pinned = true;
      await putSlot(returnSlot);
      session.returnSlotId = returnSlot.id;
      session.phase = 'returning';
      writeFestivalSession(session);
      const result = await quickLoad(returnSlot.id, { pauseAutosave: true, festivalInternal: true });
      if (!result.ok) { session.phase = 'active'; writeFestivalSession(session); }
      return result;
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function finishFestivalReturn(ids) {
    const session = festivalTestSession();
    if (!session || session.phase !== 'restored' || session.characterId !== ids.characterId || session.worldId !== ids.worldId) return false;
    // Do not clear the recovery marker before a previously armed primary
    // folder has durably saved the restored state. Otherwise the next boot
    // could import the older folder and silently discard kept rewards.
    const folder = window.LocalSaveFolder;
    const folderStatus = folder?.getStatus?.();
    if (!session.wasPaused && folderStatus?.folderName) {
      if (folderStatus.state !== 'ready') {
        window.__farmLog?.('[festival-test] Restore complete in browser; reconnect Primary Save Folder to finalize.', 'warn');
        return false;
      }
      const synced = await folder.syncNow({ automatic: false, reason: 'festival-test-restored' });
      if (synced?.lastError && synced?.lastAction !== 'saved-primary-recovery-error') {
        window.__farmLog?.('[festival-test] Primary folder save failed: ' + synced.lastError, 'warn');
        return false;
      }
    }
    writeFestivalSession(null);
    // Both return and original snapshots are pinned when rewards are kept;
    // the player can recover them manually even if autosave was already paused.
    if (session.previewSlotId) try { await deleteSlot(session.previewSlotId); } catch (_) {}
    if (!session.keepRewards && session.returnSlotId) try { await deleteSlot(session.returnSlotId); } catch (_) {}
    if (!session.wasPaused) window.HobunjiAutosavePause?.resume?.('festival-test-restored');
    return true;
  }

  // ── Quick load ──────────────────────────────────────────────────────
  // Schedules the load and reloads the tab; the snapshot is applied at the
  // start of the next boot. pauseAutosave (default on) keeps the rewind out
  // of the canonical save until you resume autosave yourself.
  async function quickLoad(id = 'latest', { pauseAutosave = true, reload = true, festivalInternal = false } = {}) {
    try {
      const festivalSession = festivalTestSession(); // Public Quick Load must never replace an unfinished festival test.
      if (festivalSession && !festivalInternal) throw new Error('Use Festival Test Restore before loading another save.');
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
      const festivalSession = festivalTestSession();
      if (festivalSession?.previewSlotId === slot.id && festivalSession.phase === 'starting') {
        festivalSession.phase = 'active';
        writeFestivalSession(festivalSession);
      } else if (festivalSession?.returnSlotId === slot.id && ['returning', 'recovering'].includes(festivalSession.phase)) {
        festivalSession.phase = 'restored';
        writeFestivalSession(festivalSession);
      }
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
    if (!resume || !deps) { if (deps) await finishFestivalReturn(activeIds()); return false; }
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
      await finishFestivalReturn(activeIds());
      return true;
    } catch (error) {
      lastResume = { ok: false, area: exact?.area, error: String(error?.message || error), at: Date.now() };
      console.warn('[quick-save] exact placement failed; using the normal login spawn', error);
      deps.showToast?.(`Quick load: could not return to ${exact?.area} (${lastResume.error}) — starting at the farmhouse.`, false);
      await finishFestivalReturn(activeIds());
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

    companion.registerPanel?.({
      id: 'festival-test',
      title: '🎪 Festival Test',
      order: 21,
      when: () => window.__hobunjiGameStarted === true && !!window.CalendarSystem?.isInitialized?.(),
      render: () => {
        const status = festivalStatus(); // The companion reads the same session that the reward journal writes.
        const prefs = festivalPrefs();
        const running = status.phase === 'active';
        const festival = window.FestivalCalendar?.get?.(status.festivalId || prefs.festivalId);
        return {
          summary: running ? 'Testing ' + (festival?.name || '') : status.phase === 'idle' ? 'Safe festival preview' : status.phase,
          rows: running ? [['Rewards recorded', String(status.rewardCount)], ['Original quick save', status.restoreSlotId]] : [],
          actions: [
            ...(status.phase === 'idle' ? [{ id: 'select', label: 'Festival', group: 'Festival', value: prefs.festivalId,
              options: (window.FestivalCalendar?.festivals || []).map(f => ({ value: f.id, label: f.name })) }] : []),
            { id: 'keep-rewards', label: 'Keep earned festival rewards when exiting', group: 'Festival',
              checkbox: true, checked: status.phase === 'idle' ? prefs.keepRewards : status.keepRewards },
            ...(!running && status.phase === 'idle' ? [{ id: 'start', label: 'Start festival test', group: 'Festival' }] : []),
            ...(running ? [
              { id: 'restart', label: 'Restart festival test', group: 'Festival', confirm: 'Discard this test attempt and restart the festival from its opening?' },
              { id: 'exit', label: 'Exit & restore original world', group: 'Festival', confirm: 'Restore the original world? Only journaled festival rewards are kept if the checkbox is enabled.' },
            ] : []),
            ...(!running && status.phase !== 'idle' && status.phase !== 'restored' ? [
              { id: 'recover', label: 'Repair interrupted festival load', group: 'Festival', confirm: 'Restore your original world from the pinned festival snapshot?' },
            ] : []),
            ...(status.phase === 'restored' ? [
              { id: 'finalize', label: 'Finish restore & save', group: 'Festival' },
            ] : []),
          ],
          note: running
            ? 'The original save remains pinned. Primary-folder and cloud writes are blocked until the test exits. Rewards are opt-in.'
            : status.phase === 'restored'
              ? 'Your original world has been loaded. Reconnect your Primary Save Folder if needed, then finish saving. A rewards return Quick Save is kept when enabled.'
              : 'Test starts at 3 PM on the next occurrence. The world reloads into an isolated snapshot; ordinary time progression remains forward-only.',
        };
      },
      onAction: (action, args) => {
        if (action === 'select') {
          if (festivalTestSession()) return { ok: false, error: 'Exit the running test to change festivals.' };
          const id = String(args.value || '');
          if (!window.FestivalCalendar?.get?.(id)) return { ok: false, error: 'Unknown festival.' };
          return setFestivalPrefs({ festivalId: id });
        }
        if (action === 'keep-rewards') return setFestivalPrefs({ keepRewards: args.checked === true });
        if (action === 'exit') return exitFestivalTest();
        if (action === 'restart') return restartFestivalTest();
        if (action === 'recover') return recoverFestivalTest();
        if (action === 'finalize') return finishFestivalReturn(activeIds()).then(ok => ok
          ? { ok: true, message: 'Original world restored and saved.' }
          : { ok: false, error: 'Restore still needs a Primary Save Folder connection or a successful save. The recovery snapshot is preserved.' });
        if (action === 'start') {
          if (!document.getElementById('settingDevMode')?.checked) return { ok: false, error: 'Enable Dev Mode before starting a festival test.' };
          return startFestivalTest();
        }
        return { ok: false, error: 'Unknown festival test action.' };
      },
    });

    companion.registerStateProvider('saves', () => ({
      autosave: pauseApi()?.getState?.() || null,
      quick: getStatus(),
      festivalTest: festivalStatus(),
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
    festivalStatus,
    recordFestivalFavor: (npcId, amount) => recordFestivalReward('favor', { npcId, amount }),
    recordFestivalItem: (key, count, stars) => recordFestivalReward('item', { key, count, stars }),
    recordFestivalMask: id => recordFestivalReward('mask', { id }),
    resumeFestivalAutoPlay,
    _slotSummary: slotSummary,
  };
})();
