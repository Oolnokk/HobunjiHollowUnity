'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/folder-save-reload-choice.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'docs/js/folder-save-local-autosave-policy.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/local-save-folder.js'), 'utf8');

new Function(source);
new Function(policy);

assert(source.includes('primary.prepareBeforeOnboarding = prepareBeforeOnboarding'), 'reload-choice policy replaces the old automatic folder startup owner');
assert(source.includes('primary.markFolderAlreadyApplied = () => {}'), 'one-shot folder-loaded bypass cannot suppress a real page-reload recovery choice');
assert(source.includes("sessionStorage.removeItem(OLD_SKIP_KEY)"), 'stale pre-policy skip markers are cleared on load');
assert(source.includes('Normal autosaves stay in this browser'), 'reload gate explains that browser storage owns ordinary autosaves');
assert(source.includes('If the page or app closed unexpectedly'), 'reload gate explicitly describes accidental-close recovery');
assert(source.includes('Use Browser Autosave'), 'reload gate exposes browser autosave as an explicit recovery choice');
assert(source.includes('Use Save Folder'), 'reload gate preserves an explicit folder restore choice');
assert(source.includes('Deliberately do NOT auto-load'), 'remembered ready folders are never silently loaded at startup');

assert(source.includes('HobunjiSaveSyncStore?.getCurrentEnvelope'), 'reload recovery checks durable IndexedDB when localStorage is missing or unreadable');
assert(source.includes('HobunjiSaveEnvelope?.verify?.(envelope)'), 'durable fallback envelope is hash-verified before it becomes an offered recovery source');
assert(source.includes('snapshot.apply(browser.envelope.snapshot)'), 'choosing the durable browser fallback can repair localStorage without reading the folder');
assert(source.includes("appendEvent?.('BROWSER FALLBACK RESTORED'"), 'durable browser recovery is recorded for mobile diagnostics');
assert(source.includes('durableRecoveries'), 'durable fallback restores remain visible in diagnostics');

const browserButtonIndex = source.indexOf('data-folder-use-browser');
const folderButtonIndex = source.indexOf('data-folder-use-folder');
assert(browserButtonIndex >= 0 && folderButtonIndex > browserButtonIndex, 'browser autosave choice is presented before the folder restore choice');

const browserHandlerStart = source.indexOf("browserButton?.addEventListener('click'");
const folderHandlerStart = source.indexOf("folderButton?.addEventListener('click'");
const browserHandler = source.slice(browserHandlerStart, folderHandlerStart);
assert(!browserHandler.includes('loadFromFolder') && !browserHandler.includes('syncNow'), 'choosing browser autosave performs no folder read or write');
assert(source.slice(folderHandlerStart).includes('await save.loadFromFolder()'), 'folder contents are loaded only after the explicit folder choice');

assert(policy.includes("if (options?.automatic)"), 'folder policy has an explicit automatic-write rejection branch');
assert(policy.includes("state: 'automatic-folder-write-blocked'"), 'automatic folder writes return a non-ready state so V3 wrappers cannot continue writing');
assert(policy.includes('await disarmLegacyFolderAutosync()'), 'explicit folder operations immediately shut off legacy timer-based writes');

const coreIndex = loader.indexOf('local-save-folder-core.js');
const policyIndex = loader.indexOf('folder-save-local-autosave-policy.js');
const canonicalIndex = loader.indexOf('folder-save-v3-canonical.js');
const primaryIndex = loader.indexOf('folder-save-primary.js');
const reloadChoiceIndex = loader.indexOf('folder-save-reload-choice.js');
const emptyBootstrapIndex = loader.indexOf('folder-save-empty-bootstrap.js');
assert(coreIndex >= 0 && policyIndex > coreIndex && canonicalIndex > policyIndex, 'browser-only autosave policy wraps the legacy core before V3 captures its methods');
assert(primaryIndex >= 0 && reloadChoiceIndex > primaryIndex && emptyBootstrapIndex > reloadChoiceIndex, 'reload-choice policy replaces startup behavior after primary UI exists and before later folder wrappers');

console.log('OK  every desktop reload offers browser autosave/durable recovery before any explicit folder restore, while automatic folder writes stay disabled');
