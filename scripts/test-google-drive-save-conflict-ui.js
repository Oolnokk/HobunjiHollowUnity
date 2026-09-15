'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-conflict-ui.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'docs/js/local-save-folder.js'), 'utf8');

new Function(source);

assert(source.includes("storeApi()?.getConflict?.(TARGET_ID)"), 'Settings conflict panel reads the durable preserved branch record directly');
assert(source.includes('branchSummary(\'This device\'') && source.includes("branchSummary('Google Drive'"), 'both local and Drive branch summaries are shown');
assert(source.includes('Keep Both · Decide Later'), 'conflict recovery exposes a non-destructive Keep Both choice');
assert(source.includes("appendEvent?.('DRIVE KEEP BOTH'"), 'Keep Both acknowledgement is recorded for mobile diagnostics');
assert(!source.includes("setConflict?.(TARGET_ID, null)"), 'Keep Both presentation layer never clears the preserved conflict record itself');
assert(source.includes('Replace Drive with This Device'), 'local-wins destructive action is labeled explicitly');
assert(source.includes('Replace This Device with Drive'), 'Drive-wins destructive action is labeled explicitly');
assert(source.includes('farmers') && source.includes('worlds') && source.includes('contentHash'), 'branch preview summarizes gameplay counts and canonical content identity');

assert(source.includes("UNLINK_BUTTON_ID = 'googleDriveSaveUnlinkBtn'"), 'conflict layer guards the existing Settings unlink control rather than adding a duplicate');
assert(source.includes('event.stopImmediatePropagation()'), 'conflict-aware unlink intercepts the ordinary handler before it can discard metadata with only the generic warning');
assert(source.includes("const conflict = await storeApi()?.getConflict?.(TARGET_ID)"), 'unlink warning re-reads durable conflict state at click time');
assert(source.includes("Unlinking will NOT delete this device\\'s save or the Google Drive file"), 'conflict unlink warning explicitly distinguishes real saves from disposable browser sync metadata');
assert(source.includes('preserved conflict copy, common baseline, pending Drive queue, and link metadata'), 'conflict unlink warning names the recovery metadata that will be forgotten');
assert(source.includes('await driveApi()?.unlink?.()'), 'transport cleanup happens only after the conflict-aware confirmation path');
assert(source.includes('conflictUnlinks++'), 'confirmed unresolved-conflict unlinks remain visible in mobile diagnostics');

const driveUiIndex = loader.indexOf('google-drive-save-ui.js');
const conflictUiIndex = loader.indexOf('google-drive-save-conflict-ui.js');
const lifecycleIndex = loader.indexOf('google-drive-save-lifecycle.js');
assert(driveUiIndex >= 0 && conflictUiIndex > driveUiIndex, 'conflict recovery layer loads after the base Drive Settings controls exist');
assert(lifecycleIndex > conflictUiIndex, 'foreground Drive lifecycle checks load after conflict presentation is available');

console.log('OK  Drive conflicts remain preserved with explicit Keep Both/replace choices and conflict-aware unlinking');
