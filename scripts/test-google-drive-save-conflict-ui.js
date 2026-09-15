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
assert(!source.includes("setConflict?.(TARGET_ID, null)"), 'Keep Both presentation layer never clears the preserved conflict record');
assert(source.includes('Replace Drive with This Device'), 'local-wins destructive action is labeled explicitly');
assert(source.includes('Replace This Device with Drive'), 'Drive-wins destructive action is labeled explicitly');
assert(source.includes('farmers') && source.includes('worlds') && source.includes('contentHash'), 'branch preview summarizes gameplay counts and canonical content identity');

const driveUiIndex = loader.indexOf('google-drive-save-ui.js');
const conflictUiIndex = loader.indexOf('google-drive-save-conflict-ui.js');
const lifecycleIndex = loader.indexOf('google-drive-save-lifecycle.js');
assert(driveUiIndex >= 0 && conflictUiIndex > driveUiIndex, 'conflict recovery layer loads after the base Drive Settings controls exist');
assert(lifecycleIndex > conflictUiIndex, 'foreground Drive lifecycle checks load after conflict presentation is available');

console.log('OK  Drive conflicts remain durably preserved and are presented with explicit Keep Both/replace choices');
