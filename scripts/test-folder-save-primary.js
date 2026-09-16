'use strict';

const fs = require('fs');
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
const startupGuard = read('docs/js/session-persistence-startup-guard.js');

// Syntax parse without executing browser globals.
new Function(primary);
new Function(emptyBootstrap);
new Function(debugUi);
new Function(bridge);
new Function(creatorHandoff);
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

assert(primary.includes('__hobunjiFolderSavePrimaryDebug'), 'primary save behavior exposes diagnostics data');
assert(emptyBootstrap.includes('__hobunjiFolderSaveEmptyBootstrapDebug'), 'first-run empty-folder state exposes diagnostics data');
assert(bridge.includes('__hobunjiFolderSaveOnboardingDebug'), 'onboarding reconciliation exposes diagnostics data');
assert(debugUi.includes("button.textContent = 'Save Diagnostics'"), 'Settings exposes a mobile-visible Save Diagnostics button');
assert(debugUi.includes('SAVE DIAGNOSTICS'), 'mobile diagnostics render without requiring DevTools');
assert(debugUi.includes('folder recovery is authoritative'), 'Settings includes the current audited save-protection summary');
assert(debugUi.includes('__hobunjiSaveCheckpointDebug'), 'Settings diagnostics include checkpoint/recovery state');

console.log('\nFolder-save primary regression checks passed.');
