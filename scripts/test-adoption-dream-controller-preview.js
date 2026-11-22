#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
const dream = read('docs/js/romance-family.js'); // Actual dream decision and naming overlays.
const creator = read('docs/js/onboarding-character-creation-redesign.js'); // Runtime 3D character creator.
const bridge = read('docs/js/controller-modern-flow-bridge.js'); // Existing shared controller integration.
assert.match(dream, /setAttribute\('data-ctrl-panel', ''\)/, 'dream has a controller navigation root');
assert.match(dream, /setAttribute\('data-ctrl-modal', ''\)/, 'dream cannot lose controller focus');
assert.match(dream, /data-rf-ready data-ctrl-default/, 'default focus is the accept action');
assert.match(dream, /data-rf-postpone="soon" data-ctrl-cancel/, 'B postpones for one day');
assert.match(dream, /data-ctrl-default data-rf-name/, 'naming prompt gets initial focus');
assert.match(bridge, /FLOW_ROOT_SELECTOR = '#ob-overlay/, 'the reused creator is navigated by ControllerUI');
assert.match(creator, /function fitPreviewCamera\(state, avatarGroup\)/, 'fit uses avatar size');
assert.match(creator, /new state\.THREE\.Box3\(\)\.setFromObject\(avatarGroup\)/, 'grid is excluded');
assert.match(creator, /fitPreviewCamera\(sceneState, group\)/, 'fitting happens after the scaled model is built');
assert.match(creator, /data-ob-zoom="in"/, 'zoom in has a focusable control');
assert.match(creator, /data-ob-zoom="out"/, 'zoom out has a focusable control');
assert.doesNotThrow(() => new Function(dream));
assert.doesNotThrow(() => new Function(creator));
console.log('Adoption dream controller and preview checks passed.');
