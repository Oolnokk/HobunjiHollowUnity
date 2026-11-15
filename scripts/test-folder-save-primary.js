'use strict';

const fs = require('fs');
const vm = require('vm'); // Executes the real quit-guard module against a deterministic fake DOM for rotation-loop regression coverage.
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log('OK ', message);
};

const primary = read('docs/js/folder-save-primary.js');
const emptyBootstrap = read('docs/js/folder-save-empty-bootstrap.js');
const debugUi = read('docs/js/folder-save-debug-ui.js');
const bridge = read('docs/js/folder-save-onboarding-bridge.js');
const creatorHandoff = read('docs/js/onboarding-character-creation-reload-handoff.js');
const folderLoader = read('docs/js/local-save-folder.js');
const onboardingLoader = read('docs/onboarding.js');
const css = read('docs/folder-save-primary.css');
const core = read('docs/js/local-save-folder-core.js');
const checkpoint = read('docs/js/save-checkpoint-manager.js');
const motifStore = read('docs/js/motif-store.js');
const startupGuard = read('docs/js/session-persistence-startup-guard.js');
const quitGuard = read('docs/js/folder-save-quit-guard.js');

// Syntax parse without executing browser globals.
new Function(primary);
new Function(emptyBootstrap);
new Function(debugUi);
new Function(bridge);
new Function(creatorHandoff);
new Function(quitGuard);
new Function(core);
new Function(motifStore);
console.log('OK  folder-save lifecycle modules parse as JavaScript');

const coreIndex = folderLoader.indexOf('local-save-folder-core.js');
const primaryIndex = folderLoader.indexOf('folder-save-primary.js');
const emptyBootstrapIndex = folderLoader.indexOf('folder-save-empty-bootstrap.js');
const debugUiIndex = folderLoader.indexOf('folder-save-debug-ui.js');
const legacyFlowIndex = folderLoader.indexOf('local-save-flow.js');
assert(coreIndex >= 0 && primaryIndex > coreIndex, 'primary folder layer loads after the existing persistence core');
assert(emptyBootstrapIndex > primaryIndex, 'empty-folder bootstrap wraps the primary folder load behavior');
assert(debugUiIndex > emptyBootstrapIndex, 'mobile diagnostics load after folder lifecycle wrappers');
assert(legacyFlowIndex > debugUiIndex, 'folder lifecycle layers load before the legacy reload-heavy UX flow');
assert(folderLoader.includes('folder-save-primary.css'), 'primary folder hierarchy stylesheet is loaded by the compatibility entrypoint');

const onboardingCoreIndex = onboardingLoader.indexOf('onboarding-core.js');
const bridgeIndex = onboardingLoader.indexOf('folder-save-onboarding-bridge.js');
const reloadHandoffIndex = onboardingLoader.indexOf('onboarding-character-creation-reload-handoff.js');
assert(bridgeIndex > onboardingCoreIndex, 'folder/onboarding bridge loads after onboarding core exists');
assert(reloadHandoffIndex > bridgeIndex, 'folder/onboarding bridge is installed before later onboarding wrappers');

assert(primary.includes('prepareBeforeOnboarding'), 'primary layer exposes pre-onboarding folder reconciliation');
assert(primary.includes("lastUiAction = 'startup-auto-load-folder'"), 'remembered ready folders automatically load before save selection');
assert(primary.includes('data-folder-primary-recovery'), 'startup gate exposes Save Recovery when a remembered folder cannot be loaded safely');
assert(primary.includes('openRecoveryModal'), 'startup recovery action opens the checkpoint recovery UI before onboarding');
assert(primary.includes('const initialError = lastUiError || status.lastError'), 'startup gate shows the folder-load failure immediately instead of a blank reconnect screen');
assert(bridge.includes('prepareBeforeOnboarding'), 'onboarding init waits for primary folder reconciliation');
assert(bridge.includes('refreshFromStorage'), 'folder restore can rebuild save selection in place');
assert(bridge.includes('hobunjiSaveStartupFailure'), 'onboarding bridge has an emergency visible startup-failure surface');
assert(bridge.includes('safeOriginalInit'), 'onboarding bridge catches failures thrown by the onboarding renderer itself');
assert(bridge.includes('STARTUP_WATCHDOG_MS'), 'onboarding bridge has a watchdog for a preparation promise that never renders any UI');
assert(bridge.includes('openRecoveryModal'), 'emergency onboarding failure surface exposes Save Recovery before normal onboarding exists');
assert(read('docs/js/save-checkpoint-manager.js').includes('data-recovery-reselect-folder'), 'recovery modal exposes a fresh-folder retry when filesystem reads fail');
assert(read('docs/js/save-checkpoint-manager.js').includes('Could not read this checkpoint'), 'recovery UI distinguishes read failure from a genuinely missing checkpoint');
assert(!bridge.includes('location.reload'), 'in-place onboarding restore bridge never reloads the site');

assert(emptyBootstrap.includes('empty-folder-connected-awaiting-first-save'), 'a new empty folder is a valid first-run save destination');
assert(emptyBootstrap.includes('No browser save is available to write'), 'empty-folder exception is narrowly limited to the expected no-browser-save bootstrap');
assert(creatorHandoff.includes('flushPrimaryFolderBeforeReload'), 'character creator flushes the primary folder before its deliberate clean-session reload');
assert(creatorHandoff.includes('await localSave.syncNow()'), 'creator folder flush completes before navigation begins');
assert(creatorHandoff.includes('folderFlushFailures'), 'creator folder flush failures remain mobile-visible');

assert(primary.includes('navigator.locks.request'), 'explicit folder operations use a cross-tab Web Lock when available');
assert(primary.includes('dataLossRisk'), 'manual folder writes preserve the existing destructive-shrink confirmation guard');
assert(primary.includes('browserSaveIsSafeToPush'), 'manual folder writes refuse unreadable browser fallback data');
assert(primary.includes("document.addEventListener('visibilitychange'"), 'mobile/background transitions request a best-effort folder flush');
assert(primary.includes("window.addEventListener('pagehide'"), 'pagehide requests a best-effort folder flush');
assert(startupGuard.includes('stopImmediatePropagation'), 'existing startup persistence guard still blocks unsafe transient exit saves');
assert(core.includes('describeDataLossRisk'), 'existing core data-loss guard remains installed');
assert(core.includes("!name.toLowerCase().endsWith('.json')"), 'canonical reader ignores harmless non-JSON files in character/world folders');
assert(core.includes('canonical entity JSON is missing a valid id'), 'canonical reader rejects syntactically valid but structurally invalid entity JSON');
assert(core.includes('duplicate canonical entity id'), 'canonical reader rejects ambiguous duplicate character/world ids');
assert(core.includes('manifest.json: expected'), 'manifest entity counts detect missing canonical character/world files');
assert(core.includes("campfire: 'campfire.json'"), 'folder recovery whitelist keeps Campfire Save separate from Manual Save');
assert(core.includes("if (!_handle) return null; // Recovery history is independent of canonical-save health"), 'recovery reads remain available even when canonical folder inspection is in an error state');
assert(!/async function readRecoveryCheckpoint\(slot\)[\s\S]{0,160}_state !== 'ready'/.test(core), 'recovery checkpoint reads are not gated on canonical folder ready state');
assert(core.includes('async function chooseRecoveryFolder()'), 'folder core exposes a recovery-only fresh folder picker');
assert(core.includes("window.showDirectoryPicker({ mode: 'readwrite' })"), 'recovery picker uses the same minimal directory-picker invocation as the normal folder chooser');
assert(!/async function chooseRecoveryFolder\(\)[\s\S]{0,900}inspectConnectedFolder\(/.test(core), 'recovery-only folder selection does not inspect broken canonical files before recovery');
assert(!/async function chooseRecoveryFolder\(\)[\s\S]{0,700}startIn\s*=\s*_handle/.test(core), 'recovery picker never dereferences the stale remembered handle as startIn');
assert(checkpoint.includes('function recoveryHandleNeedsReselect()'), 'recovery modal identifies unhealthy remembered handles before reading them');
assert(checkpoint.indexOf('if (recoveryHandleNeedsReselect())') < checkpoint.indexOf('recovery = await recoveryChoices()'), 'recovery modal asks for a fresh handle before starting uncancellable filesystem reads');
assert(checkpoint.includes('data-recovery-choose-fresh-folder'), 'recovery modal exposes a fresh-handle chooser before any stale-handle reads');
assert(checkpoint.includes('data-recovery-file-import'), 'recovery modal exposes picker-free drag/drop recovery import');
assert(checkpoint.includes('recoveryFilesFromZip'), 'picker-free emergency import can read the exported recovery ZIP directly');
assert(checkpoint.includes("new DecompressionStream('deflate-raw')"), 'recovery ZIP import supports normal deflated ZIP entries without an external dependency');
assert(checkpoint.includes("return Boolean(status?.folderName && !status?.recoveryHandleFresh)"), 'recovery refuses every remembered cross-page folder handle until the user freshly reselects it');
assert(core.includes('_syncPromise'), 'existing core still serializes folder writes within a tab');
assert(core.includes("const PATTERNS_DIR = 'patterns'"), 'primary folder save reserves a portable patterns directory');
assert(core.includes('async function mirrorPatternFile'), 'folder core can write custom motif PNG bytes');
assert(core.includes('async function readPatternFile'), 'folder core can recover custom motif PNG bytes on another device');
assert(core.includes('async function deletePatternFile'), 'folder core can clean up mirrored custom motif PNGs');
assert(core.includes('window.MotifStore?.mirrorReferencedMotifs'), 'every folder save retries all customMotifId files referenced by save metadata');
assert(core.includes('patternMirror: _lastPatternMirror'), 'pattern portability results are visible in save diagnostics');
assert(motifStore.includes('await mirror(id, bytes)'), 'new custom motifs finish their connected-folder mirror before saveMotif returns');
assert(motifStore.includes('readPatternFile'), 'MotifStore falls back to the connected folder when OPFS lacks a custom motif');
assert(motifStore.includes('writeOpfsMotif(id, bytes).catch'), 'folder-recovered motifs are hydrated back into OPFS for later local rendering');
assert(motifStore.includes('function collectCustomMotifIds'), 'MotifStore can discover pre-existing custom motifs when a folder is connected later');
assert(motifStore.includes('async function mirrorReferencedMotifs'), 'MotifStore can mirror every custom motif referenced by a save snapshot');

const primaryReloads = (primary.match(/location\.reload\s*\(/g) || []).length;
assert(primaryReloads === 1, 'primary UX has exactly one deliberate reload path for replacing an active gameplay runtime');
assert(primary.includes("sessionStorage.setItem(PRIMARY_SKIP_ONCE_KEY"), 'the deliberate runtime reload carries a one-shot startup handoff');
assert(primary.includes('stopImmediatePropagation'), 'legacy onboarding folder handlers are intercepted before their reload paths fire');

assert(css.includes('.folder-save-primary-section'), 'folder save source has a dedicated prominent visual treatment');
assert(css.includes('.folder-save-browser-fallback'), 'browser-only save source has a dedicated de-emphasized treatment');
assert(css.includes('#localSaveFolderRow.folder-save-settings-primary'), 'settings promotes the primary folder row');
assert(css.includes('#hobunjiEmptySaveFolder.folder-save-primary-action'), 'fresh-browser restore promotes the folder action');
assert(primary.includes("folderLabel.textContent = 'Primary Save Folder'"), 'save selection labels folder storage as primary');
assert(primary.includes("browserLabel.textContent = 'Browser Fallback'"), 'save selection labels browser storage as fallback');

assert(quitGuard.includes("attributeFilter: ['class']"), 'menu observer watches menu visibility only, not disabled-state churn');
assert(!quitGuard.includes("attributeFilter: ['class', 'disabled']"), 'menu observer cannot re-enter itself through Farm Reset disabled mutations');
assert(quitGuard.includes('if (!resetButton.disabled) resetButton.disabled = true'), 'Farm Reset disabling is idempotent');
assert(quitGuard.includes("button.dataset.manualSaveBusy = '1'"), 'Manual Save busy feedback uses explicit local UI state');
assert(quitGuard.includes("button.textContent = 'Saving…'"), 'Manual Save replaces its actual label while saving');
assert(quitGuard.includes('startManualSaveBusyLabel(button)'), 'Manual Save busy feedback is driven from its click path instead of a global disabled observer');
assert(/changedNodes\.some\(node => node\?\.nodeType === 1\b/.test(quitGuard), 'menu observer reacts only to structural child changes, not its own text-label mutations');
assert(/changedNodes\.some\([^\n]*data-generic-hud-icon/.test(quitGuard), 'menu observer ignores generic-hud-icons swapping the compact ✕ label for an icon (it would re-label and loop every frame)');
assert(quitGuard.includes('if (visibilityChange || structuralChange) scheduleMenuControlRelayout()'), 'menu mutations schedule a coalesced relayout instead of synchronously re-entering label measurement');
assert(quitGuard.includes('menuControlRelayoutTimer = setTimeout'), 'rotation resize bursts are debounced until layout settles');
assert(!quitGuard.includes('requestAnimationFrame('), 'menu resize handling does not create a direct RAF outside RuntimeFrameScheduler ownership');

function runQuitGuardRelayoutBehaviorRegression() {
  let observerCallback = null; // Receives MutationObserver records emitted after the fake menu observer is armed.
  let observerArmed = false; // Prevents pre-observe setup writes from being reported as mutations.
  const pendingMutations = []; // Collects button text mutations so the test can flush them like a browser microtask checkpoint.
  const timers = new Map(); // Models the trailing resize debounce and lets the test verify only one timer survives a burst.
  let nextTimerId = 1; // Generates deterministic timeout handles for the fake timer queue.
  const windowListeners = new Map(); // Captures resize/beforeunload listeners installed by the production module.
  const attributesByNode = new WeakMap(); // Stores fake DOM attributes used by the menu-safety helpers.

  function attributesFor(node) {
    let attributes = attributesByNode.get(node); // Reuses a stable attribute bag for each fake DOM node.
    if (!attributes) {
      attributes = new Map();
      attributesByNode.set(node, attributes);
    }
    return attributes;
  }

  function makeButton(initialText = '') {
    let textValue = initialText; // Backs textContent so production label writes can emit realistic text-node childList records.
    const button = { // Minimal button surface used by label, reset, and overlay-control code.
      dataset: {},
      style: {},
      disabled: false,
      hidden: false,
      tabIndex: 0,
      isConnected: true,
      setAttribute(name, value) { attributesFor(button).set(name, String(value)); },
      getAttribute(name) { return attributesFor(button).get(name) ?? null; },
    };
    Object.defineProperty(button, 'textContent', {
      get() { return textValue; },
      set(value) {
        const nextValue = String(value); // Normalizes assigned labels the same way DOM textContent does.
        if (nextValue === textValue) return;
        textValue = nextValue;
        if (observerArmed) {
          pendingMutations.push({
            type: 'childList',
            target: button,
            addedNodes: [{ nodeType: 3 }],
            removedNodes: [{ nodeType: 3 }],
          });
        }
      },
    });
    return button;
  }

  const menuPanel = { // Supplies only the open-state API consumed by the quit guard.
    classList: { contains: className => className === 'open' },
  };
  const controls = {}; // Presence of the menu control row enables responsive label installation.
  const tabs = { scrollWidth: 480, clientWidth: 300 }; // Forces the narrow/rotated compact-label path throughout this regression.
  const nodes = new Map([ // Resolves the exact element IDs the production module reads.
    ['menuPanel', menuPanel],
    ['menuPauseBtn', makeButton('Pause')],
    ['menuManualSaveBtn', makeButton('Manual Save')],
    ['menuRecoveryBtn', makeButton('Recovery')],
    ['mpClose', makeButton('Close')],
    ['menuResetBtn', makeButton('Reset')],
    ['menuBtn', makeButton('Menu')],
    ['farmEditBtn', makeButton('Farm')],
    ['mapEditBtn', makeButton('Map')],
  ]);

  const documentObject = { // Minimal document contract needed to execute the unmodified production IIFE.
    readyState: 'complete',
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      if (selector === '#menuPanel .mp-ctrls') return controls;
      if (selector === '#menuPanel .mp-tabs') return tabs;
      return null;
    },
    addEventListener() {},
  };
  const windowObject = { // Captures production window listeners and later exposes the installed debug API.
    addEventListener(type, callback) { windowListeners.set(type, callback); },
  };
  const context = { // Browser-like globals used by the real quit-guard source under vm.
    window: windowObject,
    document: documentObject,
    MutationObserver: class MutationObserver {
      constructor(callback) { observerCallback = callback; }
      observe() { observerArmed = true; }
    },
    setTimeout(callback) {
      const id = nextTimerId++; // Returned handle is stored by production debounce state and clearTimeout.
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    confirm: () => false,
    alert: () => {},
    location: { reload() {} },
    console,
  };

  vm.runInNewContext(quitGuard, context, { filename: 'folder-save-quit-guard.js' });
  assert(typeof observerCallback === 'function', 'rotation regression installs the menu MutationObserver');
  assert(typeof windowListeners.get('resize') === 'function', 'rotation regression installs the responsive resize listener');

  const flushObserverMutations = () => { // Delivers queued text-node mutations in one observer callback, like a browser microtask checkpoint.
    if (!pendingMutations.length) return;
    const records = pendingMutations.splice(0);
    observerCallback(records);
  };
  const runPendingTimer = () => { // Executes the single surviving debounce timer and removes it from the fake queue first.
    assert(timers.size === 1, 'rotation debounce has exactly one pending relayout');
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };

  windowObject.FolderSaveQuitGuard.labelMenuControls();
  flushObserverMutations();
  assert(timers.size === 0, 'label text mutations do not schedule recursive menu relayouts');

  const resize = windowListeners.get('resize'); // Reuses the exact production resize callback for an orientation-style event burst.
  for (let i = 0; i < 12; i++) resize();
  assert(timers.size === 1, 'orientation-style resize burst coalesces to one relayout timer');
  runPendingTimer();
  flushObserverMutations();
  assert(timers.size === 0, 'post-rotation label writes settle without scheduling another relayout');

  const afterResize = windowObject.__hobunjiFolderSaveQuitDebug.snapshot(); // Confirms the scheduled callback actually completed once.
  assert(afterResize.menuControlRelayouts === 1, 'orientation-style resize burst performs exactly one responsive relayout');
  assert(afterResize.relayoutPending === false, 'rotation debounce clears its pending state after relayout');

  observerCallback([{ // Real element insertion should still request a responsive recalculation.
    type: 'childList',
    target: controls,
    addedNodes: [{ nodeType: 1 }],
    removedNodes: [],
  }]);
  observerCallback([{ // Menu visibility changes should coalesce with that structural update rather than create a second timer.
    type: 'attributes',
    target: menuPanel,
    attributeName: 'class',
  }]);
  assert(timers.size === 1, 'real menu structure/class mutations coalesce to one relayout');
  runPendingTimer();
  flushObserverMutations();
  assert(timers.size === 0, 'structural relayout also settles without observer feedback');
}

runQuitGuardRelayoutBehaviorRegression();

assert(primary.includes('__hobunjiFolderSavePrimaryDebug'), 'primary save behavior exposes diagnostics data');
assert(emptyBootstrap.includes('__hobunjiFolderSaveEmptyBootstrapDebug'), 'first-run empty-folder state exposes diagnostics data');
assert(bridge.includes('__hobunjiFolderSaveOnboardingDebug'), 'onboarding reconciliation exposes diagnostics data');
assert(debugUi.includes("button.textContent = 'Save Diagnostics'"), 'Settings exposes a mobile-visible Save Diagnostics button');
assert(debugUi.includes('SAVE DIAGNOSTICS'), 'mobile diagnostics render without requiring DevTools');
assert(debugUi.includes('wilderness treasure meshes are excluded from save JSON') && debugUi.includes('unreadable character/world files block folder import'), 'Settings includes the current audited save-corruption protection summary');
assert(debugUi.includes('__hobunjiSaveCheckpointDebug'), 'Settings diagnostics include checkpoint/recovery state');

// A canonical file can be identical to the browser cache while the already-running farm
// still contains default objects. Explicit Load Folder must rehydrate that runtime.
async function verifySettingsLoadRebuild(started, changed, ok = true, mode = 'load', action = 'folder-already-current') {
  const callbacks = new Map(); // Registered button listeners are invoked like Settings clicks.
  const storage = new Map(); // One-shot folder-load handoff is asserted without real browser storage.
  const events = []; // Ordered reload and exit-guard actions prove stale state is never saved over the folder.
  const button = {
    dataset: {}, style: {}, textContent: 'Load Folder', disabled: false,
    addEventListener(type, fn) { callbacks.set(type, fn); },
  }; // Only the real Settings Load button is needed for this isolated regression.
  const row = {
    classList: { contains() { return false; }, add() {} },
    previousElementSibling: null, parentElement: null,
    querySelector() { return null; },
  }; // Minimal Settings row allows the real primary UI to attach its existing handler.
  const status = { state: 'ready', supported: true, folderName: 'farm-backup', autoSyncArmed: true, lastError: '' }; // A valid connected folder already imported into browser JSON.
  const localSave = {
    isSupported: () => true,
    getStatus: () => status,
    onChange() {},
    syncNow: async () => status,
    loadFromFolder: async () => ({ ok, changed, action, message: ok ? 'Browser save already matches folder.' : 'Import failed.' }),
    chooseFolder: async () => status,
    changeFolder: async () => status,
    reconnect: async () => status,
  }; // No writes are permitted: this is a folder-to-browser reload, not Save to Folder.
  const window = {
    LocalSaveFolder: localSave,
    __hobunjiGameStarted: started,
    addEventListener() {},
    HobunjiSessionPersistenceStartupGuard: {
      suppressExitFlush(reason) { events.push('guard:' + reason); },
    },
  }; // Real runtime start flag is the missing condition in the previous implementation.
  const buttonId = mode === 'load' ? 'localSaveFolderLoadBtn' : mode === 'choose' ? 'localSaveFolderChooseBtn' : mode === 'change' ? 'localSaveFolderChangeBtn' : 'localSaveFolderReconnectBtn'; // All Settings source-switch actions use the same restore/reload helper.
  const document = {
    body: null,
    addEventListener() {},
    querySelector() { return null; },
    getElementById(id) {
      if (id === 'localSaveFolderRow') return row;
      if (id === buttonId) return button;
      return null;
    },
  }; // DOM only includes the elements accessed by the Settings Load handler.
  const context = {
    window, document,
    sessionStorage: {
      setItem(key, value) { storage.set(key, String(value)); },
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
    },
    localStorage: { getItem() { return null; } },
    navigator: {},
    MutationObserver: class { observe() {} },
    requestAnimationFrame(fn) { fn(); },
    confirm: () => true,
    alert: message => events.push('alert:' + message),
    location: { reload() { events.push('reload'); } },
    console,
  }; // Executes the actual production module without a browser/console dependency.
  vm.runInNewContext(primary, context, { filename: 'folder-save-primary.js' });
  window.FolderSavePrimary.refreshUi(); // Installs the actual Load Folder click path.
  assert(callbacks.has('click'), 'Settings Load Folder handler installs in the test runtime');
  await callbacks.get('click')({ currentTarget: button });
  const mustReload = ok && (started || changed) && action !== 'empty-folder-connected-awaiting-first-save' && action !== 'initialized-empty-folder';
  assert(events.includes('reload') === mustReload, `folder import started=${started}, changed=${changed}, ok=${ok}: rebuilds live runtime iff necessary`);
  const expectedGuard = 'guard:settings-folder-' + mode; // Every folder action suppresses old-runtime exit writes before navigating.
  assert(events.includes(expectedGuard) === mustReload, 'reload protects the restored browser cache from exit-time stale-world writes');
  if (mustReload) assert(storage.get('hobunjiFolderPrimarySkipOnce') === 'folder-loaded-in-settings', 'intentional reload carries its one-shot folder-import handoff');
}

function verifySavedProcessingRestoresAfterStaleProduction() {
  const farmEditorSource = read('docs/js/farm-editor.js'); // Test the real extracted loader, not an imitation of its restoration sequence.
  const objectMap = new Map([['4,5', { type: 'farm_production', id: 'legacy' }]]); // A previous-world specialty footprint that the barn-reset boundary already owns.
  const processingObjects = new Set(); // Runtime processor registry should contain the restored squeeze station after loading.
  const houses = [{ id: 'house_starter', pieceKey: 'starter', stage: 'built' }]; // Live starter house skips unrelated migration paths.
  const layout = {
    version: 3, tiles: [], objects: {},
    furniture: [{ key: 'squeezer', col: 4, row: 5 }], decor: [],
    housePieces: [], buildings: [],
  }; // Minimal per-world layout reproducing the obstructed processor restore.
  let clearCalls = 0; // Proves stale production footprints were actually cleared, not just ignored by the occupancy test.
  const browserStore = { getItem(key) { return key === 'hobunji_farm_layout_v3:world_p6bt8ho6' ? JSON.stringify(layout) : null; } }; // Canonical browser mirror for inspection after hydration.
  const farmWindow = {
    __hobunjiPlayerProfile: { worldId: 'world_p6bt8ho6' },
    __hobunjiGameStarted: true,
    addEventListener() {},
    FarmProduction: {
      clear() { clearCalls++; objectMap.delete('4,5'); },
      serialize() { return []; },
    },
    HousePieces: { loadFixtureInventory() {} },
    DewVats: { rebuildMeshesFromGrid() {} },
    FarmhouseRoomPlanner: { restore() {} },
  }; // Existing modular authorities injected into the production FarmEditor.
  const ctx = {
    window: farmWindow, localStorage: browserStore, console,
    document: { getElementById() { return null; }, querySelector() { return null; } },
  }; // The extracted farm editor only binds listeners at init; no graphics or browser access is required.
  vm.runInNewContext(farmEditorSource, ctx, { filename: 'farm-editor.js' });
  farmWindow.FarmEditor.init({
    threeContainer: { addEventListener() {} },
    getPlayerData: () => farmWindow.__hobunjiPlayerProfile,
    PROCESSING_FURNITURE_DEFS: { squeezer: {} },
    DECORATIVE_FURNITURE_DEFS: {},
    getShippingBoxObject() { return null; },
    getSupplyBoxObject() { return null; },
    getHousePieces: () => houses,
    getFarmBuildings: () => [],
    getBarnTiers: () => ({}),
    getHousePieceCatalog: () => ({}),
    getCurrentArea: () => 'farm',
    getGrid: () => [],
    canPlaceFurnitureAt(col, row) { return !objectMap.has(col + ',' + row); },
    makeProcessingFurniture(col, row, key) { return { col, row, furnitureKey: key }; },
    worldObjects: objectMap,
    processingFurnitureObjects: processingObjects,
    interiorFurnitureObjects: [],
    rebuildInteriorGeometry() {},
    transformFurnitureWithHousePiece() {},
    reconcileInteriorFurniture() { return []; },
    debugLog() {},
  }); // Only the actual restore dependencies used by the minimal layout are mocked.
  const farmBuildingsSource = read('docs/js/farm-buildings.js'); // Real world reset authority already clears specialty footprints on world switches.
  assert(farmBuildingsSource.includes('window.FarmProduction?.clear?.()'), 'existing FarmBuildings.clearAll owns specialty footprint teardown');
  farmWindow.FarmProduction.clear(); // Models game.js calling FarmBuildings.clearAll before the world-specific layout restore.
  farmWindow.FarmEditor.applyFarmLayoutObjects(layout);
  assert(clearCalls === 1, 'farm layout restoration does not redundantly clear already-reset specialty buildings');
  assert(processingObjects.size === 1, 'saved squeezer restores even when old specialty production previously blocked its tile');
  const debug = farmWindow.FarmEditor.inspectFarmRestore();
  assert(debug.expected.processing === 1 && debug.live.processing === 1, 'mobile diagnostics counts agree after successful processor restore');
  assert(debug.missing.processing.length === 0, 'mobile diagnostics reports no missing processor after hydration');
  houses[0].col = 10; houses[0].row = 11; // Live starter remains at the default, despite a save placing it elsewhere.
  layout.housePieces = [{ id: 'house_starter', pieceKey: 'starter', col: 20, row: 15 }]; // Saved house ID exists but its actual location differs.
  layout.tiles = [{ c: 6, r: 7, type: 'tilled' }]; // Saved terrain override has not been applied to the live grid.
  const mismatch = farmWindow.FarmEditor.inspectFarmRestore(); // Read-only mobile diagnostics must reveal both errors, not just equal counts.
  assert(mismatch.misplaced.houses.length === 1, 'saved house at the wrong live coordinates is identified as misplaced');
  assert(mismatch.expected.tiles === 1 && mismatch.live.tiles === 0 && mismatch.missing.tiles.length === 1, 'missing terrain overrides are also visible in Save Diagnostics');
}

verifySavedProcessingRestoresAfterStaleProduction();

function verifyMovedHouseUnblocksAllSavedProcessors() {
  const editorSource = read('docs/js/farm-editor.js'); // Real farm loader, including the moved-house restoration order.
  const objectMap = new Map(); // Simulates the same worldObjects tile occupancy used by canPlaceFurnitureAt in game.js.
  const processors = new Set(); // Counts fully restored processing objects, rather than just parsed JSON records.
  let houses = [ // HousePieces.clearAll replaces the backing registry; test must reproduce real reassignment.
    { id: 'house_starter', pieceKey: 'starter', col: 26, row: 2, w: 4, h: 3, stage: 'built' },
    { id: 'house_starter_annex', pieceKey: 'starter', col: 30, row: 2, w: 3, h: 3, stage: 'built' },
  ]; // Default house + annex reserve six tiles where the player's moved-house save has processors.
  const savedFurniture = [
    { key: 'squeezer', col: 25, row: 3 },
    { key: 'butterChurn', col: 31, row: 3 },
    { key: 'squeezer', col: 26, row: 3 },
    { key: 'squeezer', col: 28, row: 3 },
    { key: 'butterChurn', col: 29, row: 3 },
    { key: 'butterChurn', col: 30, row: 3 },
    { key: 'agingBarrel', col: 32, row: 2 },
  ]; // Exact restored furniture type/coordinates from the affected world's recovered layout.
  const savedHouses = [
    { id: 'house_starter', pieceKey: 'starter', col: 25, row: 0, w: 4, h: 3, stage: 'built' },
    { id: 'house_starter_annex', pieceKey: 'starter', col: 29, row: 0, w: 3, h: 3, stage: 'built' },
  ]; // Saved house is one tile west and two tiles north of the temporary defaults.
  const occupy = house => {
    house._footprintObject = { id: house.id }; // Stable registry ownership lets clearAll remove only its own old footprint.
    for (let row = house.row; row < house.row + house.h; row++) {
      for (let col = house.col; col < house.col + house.w; col++) objectMap.set(col + ',' + row, house._footprintObject);
    }
  };
  houses.forEach(occupy);
  assert.equal(savedFurniture.filter(item => objectMap.has(item.col + ',' + item.row)).length, 6,
    'regression fixture recreates the six saved processing tiles blocked by the default house');
  const layout = {
    version: 3, objects: {}, tiles: [], decor: [], buildings: [],
    furniture: savedFurniture, housePieces: savedHouses,
  }; // Load all seven processors from the same world whose saved house was moved.
  const window = {
    __hobunjiPlayerProfile: { worldId: 'world_p6bt8ho6' },
    __hobunjiGameStarted: true,
    addEventListener() {},
    HousePieces: {
      clearAll() {
        for (const house of houses) {
          for (let row = house.row; row < house.row + house.h; row++) {
            for (let col = house.col; col < house.col + house.w; col++) {
              const key = col + ',' + row;
              if (objectMap.get(key) === house._footprintObject) objectMap.delete(key);
            }
          }
        }
        houses = []; // Actual HousePieces.clearAll invokes setHousePieces([]), rather than mutating its old array.
      },
      spawnEntry: occupy,
      loadFixtureInventory() {},
    },
    DewVats: { rebuildMeshesFromGrid() {} },
    FarmhouseRoomPlanner: { restore() {} },
    FarmProduction: { serialize: () => [] },
  }; // Minimal authentic house footprints: spawning registers tiles, clearing releases them.
  const ctx = {
    window, console,
    localStorage: { getItem(key) { return key === 'hobunji_farm_layout_v3:world_p6bt8ho6' ? JSON.stringify(layout) : null; } },
    document: { getElementById() { return null; }, querySelector() { return null; } },
  }; // Test reads the on-disk layout mirror without DevTools or a graphical scene.
  vm.runInNewContext(editorSource, ctx, { filename: 'farm-editor.js' });
  window.FarmEditor.init({
    threeContainer: { addEventListener() {} },
    getPlayerData: () => window.__hobunjiPlayerProfile,
    PROCESSING_FURNITURE_DEFS: { squeezer: {}, butterChurn: {}, agingBarrel: {} },
    DECORATIVE_FURNITURE_DEFS: {},
    getShippingBoxObject: () => null, getSupplyBoxObject: () => null,
    getHousePieces: () => houses, getFarmBuildings: () => [],
    getBarnTiers: () => ({}),
    getHousePieceCatalog: () => ({ starter: { w: 4, h: 3 } }),
    getCurrentArea: () => 'farm', getGrid: () => [],
    canPlaceFurnitureAt: (col, row) => !objectMap.has(col + ',' + row),
    makeProcessingFurniture: (col, row, furnitureKey) => ({ col, row, furnitureKey }),
    worldObjects: objectMap, processingFurnitureObjects: processors,
    interiorFurnitureObjects: [],
    rebuildInteriorGeometry() {},
    transformFurnitureWithHousePiece() {},
    reconcileInteriorFurniture: () => [],
    debugLog() {},
  });
  window.FarmEditor.applyFarmLayoutObjects(layout);
  assert.equal(processors.size, 7, 'moving the temporary house before furniture placement restores all seven processors');
  assert.equal(houses.length, 2, 'the restored house still includes the complete saved main room and annex');
  assert(houses.every(entry => entry._footprintObject), 'house registry contains spawned saved entries, not stale objects from before clearAll');
  assert.deepEqual(houses.map(house => [house.col, house.row]), [[25, 0], [29, 0]], 'saved house coordinates win over bootstrap defaults');
  const diagnostics = window.FarmEditor.inspectFarmRestore(); // Inspect the same mobile-visible counters users will check after importing.
  assert.equal(diagnostics.expected.processing, 7);
  assert.equal(diagnostics.live.processing, 7);
  assert.equal(diagnostics.missing.processing.length, 0, 'all seven processors occupy their exact saved tiles');
}

verifyMovedHouseUnblocksAllSavedProcessors();

async function verifyCanonicalFarmDiskDiagnostics() {
  const worldId = 'world_p6bt8ho6'; // Real-world-style world ID selects exactly one canonical layout in the portable folder.
  const key = 'hobunji_farm_layout_v3:' + worldId; // Existing browser mirror key used by the farm editor and folder snapshot.
  const browserLayout = { version: 3, furniture: [{ key: 'squeezer', col: 25, row: 3 }] }; // Stale browser JSON holds only one processor.
  const diskLayout = { version: 3, furniture: Array.from({ length: 7 }, (_, col) => ({ key: 'squeezer', col, row: 3 })) }; // Restored canonical file contains the full set.
  const alerts = []; // Mobile-visible Save Diagnostics output is captured without a browser console.
  let writes = 0; // Any write during inspection is an unsafe mutation of a user's recovered folder.
  let currentDiskLayout = diskLayout; // Switches from a complete canonical file to only numbered backups in the second assertion.
  const status = { state: 'ready', ignoredFarmLayoutBackupFiles: [worldId + '(9).json'] }; // The existing reader recognizes version copies but never imports them.
  const window = {
    FarmEditor: {
      farmLayoutKey: () => key,
      inspectFarmRestore: () => ({ worldId, expected: { processing: 1 }, live: { processing: 0 } }),
    },
    LocalSaveFolder: {
      getStatus: () => status,
      async readPrimarySnapshot() {
        return { savedAt: 100, snapshot: { farmLayouts: currentDiskLayout ? { [worldId]: currentDiskLayout } : {} } };
      },
      async syncNow() { writes++; throw new Error('Disk inspection may not save.'); },
    },
  }; // Only real API methods used by the shipped diagnostics are implemented.
  const ctx = {
    window, localStorage: { getItem: selected => selected === key ? JSON.stringify(browserLayout) : null },
    document: { body: null, visibilityState: 'visible', addEventListener() {}, getElementById() { return null; } },
    location: { href: 'https://example.invalid/game' },
    MutationObserver: class { observe() {} }, requestAnimationFrame() {},
    alert: value => alerts.push(value), console,
  }; // The real mobile diagnostic IIFE executes unchanged in an isolated browser-like context.
  vm.runInNewContext(debugUi, ctx, { filename: 'folder-save-debug-ui.js' });
  const inspector = window.__hobunjiFolderSaveDiagnostics.inspectCanonicalFarmOnDisk;
  const full = await inspector(worldId);
  assert(full.canonicalPresent && full.counts.processing === 7, 'mobile diagnostics reads the complete canonical folder layout, not its numbered backups');
  assert(full.matchesBrowserMirror === false, 'mobile diagnostics reveals folder/browser mismatch even when the runtime uses a stale cache');
  assert(full.ignoredNumberedCopies.includes(worldId + '(9).json'), 'mobile diagnostics lists ignored numbered backups explicitly');
  await window.__hobunjiFolderSaveDiagnostics.show();
  assert(alerts[0].includes('"diskFarm"') && alerts[0].includes('"processing": 7'), 'Save Diagnostics alert includes actual canonical disk counts for mobile screenshots');
  currentDiskLayout = null;
  const absent = await inspector(worldId);
  assert(absent.canonicalPresent === false && absent.counts === null, 'missing canonical farm is not misrepresented as a valid empty layout');
  assert(writes === 0, 'folder inspection never overwrites the recovered layout or browser mirror');
}

Promise.resolve()
  .then(() => verifySettingsLoadRebuild(true, false))
  .then(() => verifySettingsLoadRebuild(true, true))
  .then(() => verifySettingsLoadRebuild(true, false, true, 'change'))
  .then(() => verifySettingsLoadRebuild(true, false, true, 'reconnect'))
  .then(() => verifySettingsLoadRebuild(true, false, true, 'choose'))
  .then(() => verifySettingsLoadRebuild(false, false))
  .then(() => verifySettingsLoadRebuild(true, false, false))
  .then(() => verifySettingsLoadRebuild(true, false, false, 'reconnect'))
  .then(() => verifySettingsLoadRebuild(true, false, true, 'change', 'empty-folder-connected-awaiting-first-save'))
  .then(verifyCanonicalFarmDiskDiagnostics)
  .then(() => {
    assert(debugUi.includes('FarmEditor?.inspectFarmRestore'), 'mobile Save Diagnostics exposes actual spawned farm furniture/building counts');
    console.log('\nFolder-save primary regression checks passed.');
  })
  .catch(error => { console.error(error); process.exitCode = 1; });
