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
assert(bridge.includes('prepareBeforeOnboarding'), 'onboarding init waits for primary folder reconciliation');
assert(bridge.includes('refreshFromStorage'), 'folder restore can rebuild save selection in place');
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
assert(quitGuard.includes('changedNodes.some(node => node?.nodeType === 1)'), 'menu observer reacts only to structural child changes, not its own text-label mutations');
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
assert(debugUi.includes('folder recovery is authoritative'), 'Settings includes the current audited save-protection summary');
assert(debugUi.includes('__hobunjiSaveCheckpointDebug'), 'Settings diagnostics include checkpoint/recovery state');

console.log('\nFolder-save primary regression checks passed.');
