'use strict';

const assert = require('node:assert/strict'); // Assertions for real save modules running against deterministic browser adapters.
const fs = require('node:fs'); // Loads production modules without changing their source.
const vm = require('node:vm'); // Isolates separate browser sessions and their transient staging maps.

function missing() {
  return Object.assign(new Error('Not found'), { name: 'NotFoundError' });
}

function directory(name, disk) {
  const children = new Map(); // File System Access entries retained across simulated page reloads.
  return {
    name, kind: 'directory',
    queryPermission: async () => 'granted',
    async getDirectoryHandle(key, { create = false } = {}) {
      if (!children.has(key)) {
        if (!create) throw missing();
        children.set(key, directory(key, disk));
      }
      return children.get(key);
    },
    async getFileHandle(key, { create = false } = {}) {
      if (!children.has(key)) {
        if (!create) throw missing();
        let text = ''; // File contents change only when a writable stream closes successfully.
        children.set(key, {
          kind: 'file',
          getFile: async () => ({ text: async () => text }),
          async createWritable() {
            if (disk.failWrites) throw new Error('Disk write failed');
            let pending = ''; // Uncommitted file data used to model createWritable/close.
            return { async write(value) {
              pending = value;
              const onWrite = disk.onWrite; // One-shot gameplay edit while the captured snapshot is being committed.
              disk.onWrite = null;
              onWrite?.();
            }, async close() { text = pending; } };
          },
        });
      }
      return children.get(key);
    },
    async removeEntry(key) { if (!children.delete(key)) throw missing(); },
    async *entries() { yield* children.entries(); },
  };
}

async function boot(folder, nativeData, sessionData = new Map()) {
  const nativeAttempts = []; // Proves direct capture does not attempt browser writes before the folder commit.
  class Storage { // Fresh prototype per browser session, with a quota shared by its native values.
    constructor() { this.limit = Infinity; }
    getItem(key) { return nativeData.get(String(key)) ?? null; }
    removeItem(key) { nativeData.delete(String(key)); }
    clear() { nativeData.clear(); }
    setItem(key, value) {
      nativeAttempts.push(key);
      let size = String(key).length + String(value).length; // Native quota counts all persisted keys and values.
      for (const [otherKey, otherValue] of nativeData) if (otherKey !== key) size += otherKey.length + otherValue.length;
      if (size > this.limit) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      nativeData.set(String(key), String(value));
    }
  }
  const storage = new Storage(); // Native persistence intentionally survives boot while guard staging does not.
  const sessionStorage = { // Reload handoffs survive the page, unlike quota staging.
    getItem: key => sessionData.get(key) ?? null,
    setItem: (key, value) => sessionData.set(key, String(value)),
    removeItem: key => sessionData.delete(key),
  };
  const frames = []; // Queued UI work lets tests bind the real Settings handlers without a browser.
  const actions = { reloads: 0, suppressed: [], alerts: [] }; // Records real reload/error decisions made by production modules.
  const indexedDB = { // Minimal async IndexedDB adapter for the folder core's handle bookkeeping.
    open() {
      const request = {}; // Core assigns onsuccess before the microtask runs.
      request.result = {
        transaction() {
          const transaction = { // Completes handle writes after their callbacks are installed.
            objectStore: () => ({
              get() { const read = { result: null }; queueMicrotask(() => read.onsuccess()); return read; },
              put() {}, delete() {},
            }),
          };
          queueMicrotask(() => transaction.oncomplete?.());
          return transaction;
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  const document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } }; // No UI is needed to execute the save path.
  const window = { // Production globals; folder saves use the same storage seen by gameplay callbacks.
    Storage, localStorage: storage, showDirectoryPicker: async () => folder,
    sessionStorage,
    addEventListener() {}, __hobunjiGameStarted: true,
    HobunjiSessionPersistenceStartupGuard: { suppressExitFlush: reason => actions.suppressed.push(reason) },
    __hobunjiPlayerProfile: { characterId: 'farmer', worldId: 'hollow' },
  };
  const context = vm.createContext({ // Timers are inert so each test explicitly chooses when to save.
    window, localStorage: storage, sessionStorage, indexedDB, document, console, navigator: {},
    MutationObserver: class { observe() {} }, requestAnimationFrame: fn => frames.push(fn),
    setInterval: () => 1, clearInterval() {}, setTimeout: (fn, delay) => { if (delay === 0) fn(); return 1; }, clearTimeout() {},
    location: { reload() { actions.reloads++; } }, confirm: () => true, alert: message => actions.alerts.push(message),
  });
  for (const file of ['storage-quota-guard', 'save-snapshot-core', 'local-save-folder-core', 'folder-save-primary', 'farm-editor', 'folder-save-runtime-flush', 'save-checkpoint-manager', 'folder-save-quit-guard']) {
    vm.runInContext(fs.readFileSync(`docs/js/${file}.js`, 'utf8'), context, { filename: `${file}.js` });
  }
  await new Promise(resolve => setImmediate(resolve));
  await window.LocalSaveFolder.chooseFolder();
  return {
    window, storage, sessionStorage, actions, nativeAttempts,
    installLiveMember(inventory) {
      window.AlchemySystem = { serializeKnownEffects: () => [], serializeKnownRecipes: () => [], serializeActiveEffects: () => [] };
      window.ReagentPlants = { serializeZoneReagentState: () => ({}) };
      window.CookingSystem = { serialize: () => ({ recipe: 'three-fish-pie', notes: 'x'.repeat(300) }) };
      window.WildBerries = { serializeState: () => ({}) };
      window.WildTreasure = { serializeState: () => ({}) };
      Object.assign(context, {
        inventory, packClothing: [], questProgress: {}, player: { x: 0, y: 0, angle: 0 }, currentArea: 'farm',
        _playerData: window.__hobunjiPlayerProfile, _tothalWorldId: () => window.__hobunjiPlayerProfile.worldId,
        defaultWorldMemberState: () => ({}), serializeWildernessChunkState: () => ({}),
        serializeZoneFelledTreeState: () => ({}), serializeZoneMinedRockState: () => ({}),
      });
      const game = fs.readFileSync('docs/game.js', 'utf8'); // Execute the actual gameplay serializer rather than a miniature inventory-only substitute.
      const start = game.indexOf('      function captureMemberWorldData('); // Shared production serializer and its browser writer are adjacent.
      const end = game.indexOf('\n      // ── Owner/farmhand', start);
      vm.runInContext(game.slice(start, end), context, { filename: 'game-save-serializers.js' });
      window.FarmAnimals = { init() {} };
      window.FarmAnimals.init({ inventory, saveMemberWorldData: context.saveMemberWorldData,
        captureMemberWorldData: context.captureMemberWorldData, saveFarmLayout: window.FarmEditor.saveFarmLayout });
    },
    async loadFromSettings() {
      let handler = null; // The actual click callback installed by FolderSavePrimary.bindSettings.
      const button = { textContent: 'Load Folder', dataset: {}, style: {}, addEventListener(type, callback) { if (type === 'click') handler = callback; } }; // Minimal Settings load button.
      const row = { classList: { contains: () => true }, querySelector: () => null }; // Existing Settings row with optional decoration omitted.
      document.getElementById = id => id === 'localSaveFolderRow' ? row : id === 'localSaveFolderLoadBtn' ? button : null;
      for (const frame of frames.splice(0)) frame();
      assert.ok(handler, 'real Settings load handler is bound');
      await handler({ currentTarget: button });
    },
  };
}

(async () => {
  const disk = { failWrites: false }; // Shared disk survives both browser sessions and can fail independently of quota.
  const folder = directory('Primary Save', disk); // Actual production folder core reads/writes this adapter.
  const initial = { version: 1, characters: [{ id: 'farmer' }], worlds: [{ id: 'hollow', members: { farmer: { nonGearInventory: {} } } }] }; // Old persisted save lacks the cooked pie.
  const nativeData = new Map([['hobunjiSaveMeta', JSON.stringify(initial)]]); // Browser copy remains stale when later writes exceed quota.
  const first = await boot(folder, nativeData); // First session starts with a small browser save and initializes its folder.
  assert.equal((await first.window.LocalSaveFolder.syncNow()).lastError, null);
  first.storage.limit = JSON.stringify(initial).length + 30;
  first.window.HousePieces = { getFixtureInventory: () => [] };
  first.window.FarmEditor.init({
    threeContainer: { addEventListener() {} }, getPlayerData: () => first.window.__hobunjiPlayerProfile,
    COLS: 1, ROWS: 1, getGrid: () => [[{ type: 'grass' }]], createDayOneTile: () => ({ type: 'grass' }),
    getShippingBoxObject: () => null, getSupplyBoxObject: () => null,
    processingFurnitureObjects: new Set(), interiorFurnitureObjects: new Set([{ id: 'window', key: 'simpleWindow', area: 'farm', col: 0, row: 0 }]),
    getHousePieces: () => [], getFarmBuildings: () => [], getWorldRoutes: () => [], getWorldNpcPaths: () => [], getWorldTransitions: () => [],
    DECORATIVE_FURNITURE_DEFS: { simpleWindow: {} }, debugLog() {},
  });
  const inventory = { cookedPie: 1 }; // The real member serializer must capture the current live bag.
  first.installLiveMember(inventory);
  assert.equal(first.window.HobunjiRuntimeSave.flushNow().ok, false, 'the real linked-window browser backup still hits quota');
  const beforeCapture = first.nativeAttempts.length; // Browser writes are forbidden during the replacement live capture path.
  assert.equal(first.window.HobunjiRuntimeSave.captureSnapshot().ok, true);
  assert.equal(first.nativeAttempts.length, beforeCapture, 'direct live capture makes zero browser write attempts');
  const saved = await first.window.HobunjiSaveCheckpoints.saveManual(); // Real gameplay serializers → folder write → optional browser mirrors.
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.folder, true);
  assert.equal(JSON.parse(nativeData.get('hobunjiSaveMeta')).worlds[0].members.farmer.nonGearInventory.cookedPie, undefined);
  assert.equal((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);
  assert.equal((await first.window.LocalSaveFolder.readRecoveryCheckpoint('manual')).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);

  const sessionData = new Map(); // Settings handoff flags survive between the second and third sessions.
  const second = await boot(folder, nativeData, sessionData); // Reload discards all first-session staging and still starts with the stale native browser save.
  second.storage.limit = first.storage.limit;
  await second.loadFromSettings();
  assert.equal(second.actions.reloads, 1, 'a changed Settings folder load really restarts the runtime');
  assert.ok(second.actions.suppressed.includes('settings-folder-load'), 'departing gameplay cannot overwrite the restored folder');
  assert.equal(second.sessionStorage.getItem('hobunjiFolderPrimarySkipOnce'), null, 'staged folder imports must not skip folder loading after reload');
  const reloaded = second.window.HobunjiSaveSnapshot.capture(); // Real snapshot adapter must now see the pie and farm layout from disk.
  assert.equal(reloaded.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);
  assert.equal(reloaded.farmLayouts.hollow.decor[0].key, 'simpleWindow', 'linked windows survive alongside the pie');

  const third = await boot(folder, nativeData, sessionData); // Real pre-onboarding owner must reread disk rather than trust the stale native copy.
  third.storage.limit = first.storage.limit;
  assert.equal(await third.window.FolderSavePrimary.prepareBeforeOnboarding(), 'folder');
  assert.equal(third.window.HobunjiSaveSnapshot.capture().meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 1);
  assert.throws(() => third.window.HobunjiSaveSnapshot.apply(reloaded), /quota/, 'browser-only snapshot apply cannot silently stage against the connected folder');
  await third.window.HobunjiSaveCheckpoints.syncRecoveryMirrorsFromFolder(); // Recovery UI awaits this reconciliation before enabling its restore buttons.
  const restored = await third.window.HobunjiSaveCheckpoints.restoreManual(); // Folder-backed recovery remains valid when browser-only apply would fail.
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(third.actions.reloads, 1, 'successful folder-backed recovery reloads after durable disk write');

  third.storage.limit = Infinity;
  const imported = await third.window.LocalSaveFolder.readRecoveryCheckpoint('manual'); // Import while browser space is available, then fill it before applying.
  await third.window.HobunjiSaveCheckpoints.importRecoveryFiles([{ name: 'manual.json', text: async () => JSON.stringify(imported) }]);
  third.storage.limit = first.storage.limit;
  const failedEmergency = await third.window.HobunjiSaveCheckpoints.restoreManual(); // Emergency import promises browser persistence and disconnects its folder only after a durable apply.
  assert.equal(failedEmergency.ok, false);
  assert.match(failedEmergency.error, /quota/);
  assert.equal(third.actions.reloads, 1, 'failed browser-only recovery never reloads and loses its transient data');
  assert.equal(third.window.LocalSaveFolder.getStatus().folderName, 'Primary Save', 'failed browser-only recovery keeps the existing folder connected');

  const small = await boot(folder, new Map([['hobunjiSaveMeta', JSON.stringify(initial)]])); // Native persistence still supports the original skip-once optimization.
  small.window.FolderSavePrimary.markFolderAlreadyApplied();
  assert.equal(small.sessionStorage.getItem('hobunjiFolderPrimarySkipOnce'), 'applied', 'native browser saves keep the ordinary reload handoff');
  small.window.FolderSavePrimary.markFolderAlreadyApplied('folder-loaded-in-settings');
  assert.equal(await small.window.FolderSavePrimary.prepareBeforeOnboarding(), 'folder-already-applied');
  assert.equal(small.sessionStorage.getItem('hobunjiFolderPrimarySkipOnce'), null, 'native reload handoff is consumed exactly once');
  await small.window.LocalSaveFolder.forget();
  small.storage.limit = 1;
  small.window.FarmAnimals = { init() {} };
  small.window.FarmAnimals.init({
    saveMemberWorldData() {
      try { small.storage.setItem('hobunjiSaveMeta', JSON.stringify(reloaded.meta)); } catch {} // Real gameplay callbacks can swallow quota failures.
    },
  });
  const failedFlush = small.window.HobunjiRuntimeSave.flushNow({ reason: 'browser-fallback-after-disconnect' }); // Quit/manual save must not call stale browser data a successful runtime capture.
  assert.equal(failedFlush.ok, false);
  assert.match(failedFlush.error, /Browser storage is full/);

  inventory.cookedPie = 2;
  await first.window.LocalSaveFolder.reconnect(); // A connected but unarmed folder is a valid explicit-save destination.
  assert.equal(first.window.LocalSaveFolder.getStatus().autoSyncArmed, false);
  assert.equal((await first.window.HobunjiSaveCheckpoints.saveManual()).ok, true, 'explicit save captures live data before the first armed sync');
  assert.equal((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 2);

  inventory.cookedPie = 3;
  const campfire = await first.window.HobunjiSaveCheckpoints.saveCampfire(); // Campfire checkpoints must use the same direct capture path.
  assert.equal(campfire.ok, true);
  assert.equal((await first.window.LocalSaveFolder.readRecoveryCheckpoint('campfire')).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 3);
  inventory.cookedPie = 4;
  const travel = await first.window.HobunjiSaveCheckpoints.saveMapChange({ fromArea: 'farm', toArea: 'town' }); // Map-change recovery also captures without flushing browser backups.
  assert.equal(travel.ok, true);
  assert.equal((await first.window.LocalSaveFolder.readRecoveryCheckpoint('mapChange')).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 4);

  inventory.cookedPie = 5;
  const originalApply = first.window.HobunjiSaveSnapshot.apply; // Force the optional post-disk browser mirror itself to fail.
  first.window.HobunjiSaveSnapshot.apply = () => { throw new Error('browser mirror unavailable'); };
  const mirrorFailure = await first.window.LocalSaveFolder.syncNow({ automatic: true, reason: 'folder-timer' }); // Real timer/Settings core path must capture live inventory and report a successful disk save.
  assert.equal(mirrorFailure.lastError, null);
  assert.match(mirrorFailure.browserMirrorWarning, /browser mirror unavailable/);
  assert.equal((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 5);
  first.window.HobunjiSaveSnapshot.apply = originalApply;

  inventory.cookedPie = 6;
  disk.onWrite = () => {
    const meta = JSON.parse(first.storage.getItem('hobunjiSaveMeta')); // Character changes made during folder I/O must survive its optional browser mirror.
    meta.characters[0].nickname = 'Changed during save';
    first.storage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
  };
  const concurrentSave = await first.window.LocalSaveFolder.syncNow();
  assert.equal(concurrentSave.lastError, null);
  assert.match(concurrentSave.browserMirrorWarning, /newer browser changes/);
  assert.equal(JSON.parse(first.storage.getItem('hobunjiSaveMeta')).characters[0].nickname, 'Changed during save');
  inventory.cookedPie = 7;
  await first.window.FolderSaveQuitGuard.guardedQuit({ textContent: 'Quit', dataset: {} }); // Real quit orchestration must commit the direct snapshot before navigation.
  assert.equal(first.actions.reloads, 1);
  assert.equal((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot.meta.worlds[0].members.farmer.nonGearInventory.cookedPie, 7);
  assert.equal((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot.meta.characters[0].nickname, 'Changed during save', 'the next direct snapshot includes the concurrent character edit');

  const beforeBadCapture = (await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot; // A serialization failure must not replace a good folder save with stale browser state.
  first.window.CookingSystem.serialize = () => { throw new Error('cooking capture failed'); };
  const badCapture = await first.window.HobunjiSaveCheckpoints.saveManual();
  assert.equal(badCapture.ok, false);
  assert.match(badCapture.error, /cooking capture failed/);
  assert.equal(JSON.stringify((await first.window.LocalSaveFolder.readPrimarySnapshot()).snapshot), JSON.stringify(beforeBadCapture));

  disk.failWrites = true;
  assert.match((await second.window.LocalSaveFolder.syncNow()).lastError, /Disk write failed/, 'staging cannot hide a real folder write failure');
  console.log('folder quota integration: actual gameplay/farm serializers, linked-window quota failure, zero-write capture, manual/campfire/travel/autosync/quit, browser mirror errors, reloads, and real capture/disk errors verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
