'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log('OK ', message);
};

const envelope = read('docs/js/save-sync-envelope.js');
const reconciliation = read('docs/js/save-reconciliation.js');
const syncStore = read('docs/js/save-sync-store.js');
const coordinator = read('docs/js/save-coordinator.js');
const driveConfig = read('docs/js/google-drive-save-config.js');
const driveTransport = read('docs/js/google-drive-save-transport.js');
const driveUi = read('docs/js/google-drive-save-ui.js');
const canonicalV3 = read('docs/js/folder-save-v3-canonical.js');
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
new Function(envelope);
new Function(reconciliation);
new Function(syncStore);
new Function(coordinator);
new Function(driveConfig);
new Function(driveTransport);
new Function(driveUi);
new Function(canonicalV3);
new Function(primary);
new Function(emptyBootstrap);
new Function(debugUi);
new Function(bridge);
new Function(creatorHandoff);
console.log('OK  persistence lifecycle modules parse as JavaScript');

const envelopeIndex = folderLoader.indexOf('save-sync-envelope.js');
const reconciliationIndex = folderLoader.indexOf('save-reconciliation.js');
const syncStoreIndex = folderLoader.indexOf('save-sync-store.js');
const coordinatorIndex = folderLoader.indexOf('save-coordinator.js');
const driveConfigIndex = folderLoader.indexOf('google-drive-save-config.js');
const driveTransportIndex = folderLoader.indexOf('google-drive-save-transport.js');
const coreIndex = folderLoader.indexOf('local-save-folder-core.js');
const canonicalV3Index = folderLoader.indexOf('folder-save-v3-canonical.js');
const primaryIndex = folderLoader.indexOf('folder-save-primary.js');
const emptyBootstrapIndex = folderLoader.indexOf('folder-save-empty-bootstrap.js');
const debugUiIndex = folderLoader.indexOf('folder-save-debug-ui.js');
const driveUiIndex = folderLoader.indexOf('google-drive-save-ui.js');
const legacyFlowIndex = folderLoader.indexOf('local-save-flow.js');
assert(envelopeIndex >= 0, 'canonical save envelope loads from the persistence entrypoint');
assert(reconciliationIndex > envelopeIndex, 'three-way reconciliation loads after canonical envelope support');
assert(syncStoreIndex > reconciliationIndex, 'durable sync store loads after reconciliation primitives');
assert(coordinatorIndex > syncStoreIndex, 'save coordinator loads after its durable sync-store dependency');
assert(driveConfigIndex > coordinatorIndex, 'public Google Drive configuration loads after transport-neutral save coordination');
assert(driveTransportIndex > driveConfigIndex, 'Google Drive transport loads after its public configuration');
assert(coreIndex > driveTransportIndex, 'Drive transport foundation loads before the existing filesystem core');
assert(canonicalV3Index > coreIndex, 'canonical V3 filesystem adapter loads after the V2 filesystem core exists');
assert(primaryIndex > canonicalV3Index, 'primary folder UX wraps the V3-aware filesystem API');
assert(emptyBootstrapIndex > primaryIndex, 'empty-folder bootstrap wraps the primary folder load behavior');
assert(debugUiIndex > emptyBootstrapIndex, 'mobile diagnostics load after folder lifecycle wrappers');
assert(driveUiIndex > debugUiIndex, 'Drive Settings UI loads after shared persistence diagnostics');
assert(legacyFlowIndex > driveUiIndex, 'new persistence layers load before the legacy reload-heavy UX flow');
assert(folderLoader.includes('folder-save-primary.css'), 'primary folder/Drive hierarchy stylesheet is loaded by the compatibility entrypoint');

const onboardingCoreIndex = onboardingLoader.indexOf('onboarding-core.js');
const bridgeIndex = onboardingLoader.indexOf('folder-save-onboarding-bridge.js');
const reloadHandoffIndex = onboardingLoader.indexOf('onboarding-character-creation-reload-handoff.js');
assert(bridgeIndex > onboardingCoreIndex, 'folder/onboarding bridge loads after onboarding core exists');
assert(reloadHandoffIndex > bridgeIndex, 'folder/onboarding bridge is installed before later onboarding wrappers');
assert(onboardingLoader.includes('20260915drivea'), 'creator handoff cache key advances with linked-Drive queue support');

assert(envelope.includes("FORMAT = 'hobunji-primary-save'"), 'canonical envelope uses a stable portable save format identifier');
assert(envelope.includes("subtle.digest('SHA-256'"), 'canonical envelope hashes gameplay content with SHA-256');
assert(reconciliation.includes("return result('conflict', 'preserve-both'"), 'three-way reconciliation preserves both branches on divergent edits');
assert(syncStore.includes('commitEnvelope'), 'durable sync store exposes the atomic local commit primitive');
assert(syncStore.includes('OAuth tokens must not be persisted'), 'durable sync store rejects OAuth-token persistence');
assert(coordinator.includes('snapshot.capture({ strict: true })'), 'save coordinator captures the existing portable browser-save boundary strictly');
assert(coordinator.includes('store.commitEnvelope'), 'save coordinator commits the canonical envelope to durable local storage');
assert(driveConfig.includes("scope: 'https://www.googleapis.com/auth/drive.file'"), 'Drive configuration is permanently limited to the narrow drive.file scope');
assert(driveTransport.includes("let accessToken = ''"), 'Drive OAuth access token is memory-only transport state');
assert(driveTransport.includes("method: 'PATCH'"), 'Drive updates reuse the linked file id with PATCH instead of creating duplicates');
assert(driveTransport.includes('Mandatory preflight read') || driveTransport.includes('Mandatory preflight'), 'Drive sync documents mandatory remote preflight before automatic overwrite');
assert(driveTransport.includes('setConflict'), 'Drive transport preserves divergent branches in the durable conflict store');
assert(driveUi.includes("ROW_ID = 'googleDriveSaveRow'"), 'Settings exposes a dedicated Google Drive save row');
assert(driveUi.includes('!folderSupported && Boolean(status?.configured)'), 'Drive becomes visually primary when browser folder access is unavailable');
assert(driveUi.includes('gameIsRunning()'), 'Drive UI blocks hot-loading a remote save into a running world');
assert(canonicalV3.includes("CANONICAL_FILE_NAME = 'hobunji-primary-save.json'"), 'filesystem adapter uses one stable canonical filename');
assert(canonicalV3.includes('roundTrip.contentHash !== envelope.contentHash'), 'canonical filesystem writes are read back and hash-verified');
assert(canonicalV3.includes("canonicalError = `Canonical V3 save is invalid and was not bypassed"), 'invalid V3 files are never silently bypassed with V2 recovery data');
assert(canonicalV3.includes("clearCanonicalCache({ source: 'v2-loaded' })"), 'V2 fallback remains explicit when no canonical file exists');

assert(primary.includes('prepareBeforeOnboarding'), 'primary layer exposes pre-onboarding folder reconciliation');
assert(primary.includes("lastUiAction = 'startup-auto-load-folder'"), 'remembered ready folders automatically load before save selection');
assert(bridge.includes('prepareBeforeOnboarding'), 'onboarding init waits for primary folder reconciliation');
assert(bridge.includes('refreshFromStorage'), 'folder restore can rebuild save selection in place');
assert(!bridge.includes('location.reload'), 'in-place onboarding restore bridge never reloads the site');

assert(emptyBootstrap.includes('empty-folder-connected-awaiting-first-save'), 'a new empty folder is a valid first-run save destination');
assert(emptyBootstrap.includes('No browser save is available to write'), 'empty-folder exception is narrowly limited to the expected no-browser-save bootstrap');
assert(creatorHandoff.includes('commitDurableBeforeReload'), 'character creator commits durable local state before its deliberate clean-session reload');
assert(creatorHandoff.includes("reason: 'character-creator-start', pendingTargets"), 'creator handoff atomically queues linked Drive with the durable local save');
assert(creatorHandoff.includes('queuedDriveCommits'), 'creator Drive queueing remains mobile-visible');
assert(creatorHandoff.includes('durableCommitFailures'), 'creator durable-commit failures remain mobile-visible');
assert(creatorHandoff.includes('flushPrimaryFolderBeforeReload'), 'character creator still flushes the primary folder after the durable commit');
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
assert(css.includes('#localSaveFolderRow.folder-save-settings-primary'), 'settings promotes the primary folder row on supported desktop browsers');
assert(css.includes('.google-drive-save-row.google-drive-save-primary'), 'settings can promote Drive on browsers without folder support');
assert(css.includes('.folder-save-settings-secondary'), 'unavailable desktop-folder controls can be visually demoted on mobile');
assert(css.includes('#hobunjiEmptySaveFolder.folder-save-primary-action'), 'fresh-browser restore promotes the folder action');
assert(primary.includes("folderLabel.textContent = 'Primary Save Folder'"), 'save selection labels folder storage as primary');
assert(primary.includes("browserLabel.textContent = 'Browser Fallback'"), 'save selection labels browser storage as fallback');

assert(primary.includes('__hobunjiFolderSavePrimaryDebug'), 'primary save behavior exposes diagnostics data');
assert(emptyBootstrap.includes('__hobunjiFolderSaveEmptyBootstrapDebug'), 'first-run empty-folder state exposes diagnostics data');
assert(bridge.includes('__hobunjiFolderSaveOnboardingDebug'), 'onboarding reconciliation exposes diagnostics data');
assert(debugUi.includes("button.textContent = 'Save Diagnostics'"), 'Settings exposes a mobile-visible Save Diagnostics button');
assert(debugUi.includes('SAVE DIAGNOSTICS'), 'mobile diagnostics render without requiring DevTools');
assert(debugUi.includes('HobunjiSaveCoordinator?.getStatus'), 'mobile diagnostics include the durable local save coordinator');
assert(debugUi.includes('HobunjiGoogleDriveSave?.getStatus'), 'mobile diagnostics include Google Drive transport state');
assert(debugUi.includes('__hobunjiGoogleDriveSaveUIDebug'), 'mobile diagnostics include Drive UI/reconciliation state');
assert(debugUi.includes('__hobunjiFolderSaveV3Debug'), 'mobile diagnostics include canonical V3 filesystem status');
assert(debugUi.includes('Google Drive now uses the canonical V3 save envelope'), 'Settings includes a short summary of the latest persistence change');

console.log('\nFolder-save primary regression checks passed.');
