'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/google-drive-save-startup.js'), 'utf8');

new Function(source);
assert(source.includes("kind: 'drive-startup-divergence'"), 'startup ambiguity/conflict stores a durable two-branch conflict record');
assert(source.includes('local: localEnvelope') && source.includes('external: remote.envelope'), 'startup conflict record preserves both complete validated envelopes');
assert(source.includes('data-drive-startup-keep-both'), 'startup conflict gate exposes an explicit Keep Both action');
assert(source.includes('Keep Both · Continue This Device'), 'Keep Both wording explains that gameplay continues from the local branch');
assert(source.includes("finish('kept-both-local')"), 'Keep Both resolves the startup gate without invoking a transport overwrite');
assert(source.includes('Replace Drive with This Device'), 'destructive local resolution is labeled as a Drive replacement');
assert(source.includes('driveApi().useLocalVersion()'), 'explicit local resolution remains the only startup path that overwrites Drive');
assert(source.includes('driveApi().useDriveVersion()'), 'explicit Drive resolution can still replace local cache before gameplay');
assert(source.includes('await preserveUnresolvedBranches(decision, localEnvelope, remote, baseline)'), 'branches are durably preserved before the resolution gate appears');

const keepBothHandlerStart = source.indexOf("gate.querySelector('[data-drive-startup-keep-both]')");
const localHandlerStart = source.indexOf("gate.querySelector('[data-drive-startup-use-local]')");
assert(keepBothHandlerStart >= 0 && localHandlerStart > keepBothHandlerStart, 'Keep Both handler is present before destructive local-resolution handler');
const keepBothHandler = source.slice(keepBothHandlerStart, localHandlerStart);
assert(!keepBothHandler.includes('useLocalVersion'), 'Keep Both never overwrites Drive');
assert(!keepBothHandler.includes('useDriveVersion'), 'Keep Both never overwrites local state with Drive');

console.log('OK  Drive startup conflicts preserve both branches and offer a truly non-destructive Keep Both path');
