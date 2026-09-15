#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to fail when the Popup Text Editor relationship reference or diagnostics drift from the intended contract.
const fs = require('node:fs'); // Used to read the editor and runtime source files directly.
const path = require('node:path'); // Used to resolve repository-relative fixture paths.
const vm = require('node:vm'); // Used to syntax-check the standalone editor helper.

const root = path.resolve(__dirname, '..'); // Used as the repository root for every source read below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Used to keep test fixture reads concise.
const editor = read('docs/tools/world-popup-editor/index.html'); // Used to verify the actual Popup Text Editor loads the relationship helper.
const helper = read('docs/js/world-popup-relationship-editor.js'); // Used to validate the 3D relationship preview and visible diagnostics implementation.
const runtime = read('docs/js/generic-hud-icons.js'); // Used as the current gameplay relationship-popup visual contract.

assert.doesNotThrow(() => new vm.Script(helper), 'world popup relationship editor helper parses');
assert.match(editor, /world-popup-relationship-editor\.js/, 'Popup Text Editor loads the relationship preview helper');
assert.doesNotMatch(editor, /relationship-popup-editor-preview\.js/, 'Popup Text Editor does not depend on the mistaken Ambient Dialogue preview helper');
assert.match(helper, /Overhead Rapport \/ Favor/, 'Popup Text Editor exposes relationship controls');
assert.match(helper, /Rapport \+10/, 'positive Rapport preview is available');
assert.match(helper, /Rapport -10/, 'negative Rapport preview is available');
assert.match(helper, /Favor \+10/, 'positive Favor preview is available');
assert.match(helper, /Favor -10/, 'negative Favor preview is available');
assert.match(helper, /worldPopupEditorDiagnostics/, 'Popup Text Editor exposes an always-visible diagnostics panel');
assert.match(helper, /Preview debug/, 'diagnostics panel is visibly labeled');
assert.match(helper, /Retry avatar/, 'diagnostics panel provides an avatar retry action');
assert.match(helper, /Copy/, 'diagnostics panel provides a copy action for mobile debugging');
assert.match(helper, /three configured=/, 'diagnostics expose Three.js configuration and load state');
assert.match(helper, /avatar holder=/, 'diagnostics expose avatar-holder and model state');
assert.match(helper, /window\.addEventListener\('unhandledrejection'/, 'diagnostics capture async boot failures');
assert.match(helper, /window\.addEventListener\('error'/, 'diagnostics capture JS and resource failures');
assert.match(helper, /popupRuntime\.showRelationshipChange\(avatarHolder, kind, amount\)/, 'controls render through a WorldPopupText-shaped relationship API against the real preview avatar root');
assert.match(helper, /new THREE\.Mesh\(geometry, material\)/, 'relationship reference renders as an actual Three.js billboard');
assert.match(helper, /event\.plane\.quaternion\.copy\(camera\.quaternion\)/, 'relationship billboard faces the live popup-editor camera');

for (const [label, helperPattern, runtimePattern] of [
  ['Rapport heart color', /RAPPORT_HEART_COLOR = '#ffd84d'/, /RAPPORT_HEART_COLOR = '#ffd84d'/],
  ['Favor heart color', /FAVOR_HEART_COLOR = '#ff8fbd'/, /FAVOR_HEART_COLOR = '#ff8fbd'/],
  ['gain number color', /RELATIONSHIP_GAIN_COLOR = '#66d96f'/, /RELATIONSHIP_GAIN_COLOR = '#66d96f'/],
  ['loss number color', /RELATIONSHIP_LOSS_COLOR = '#ff5b5b'/, /RELATIONSHIP_LOSS_COLOR = '#ff5b5b'/],
  ['canvas width', /POPUP_WIDTH = 360/, /canvas\.width = 360/],
  ['canvas height', /POPUP_HEIGHT = 112/, /canvas\.height = 112/],
  ['heart size', /ICON_SIZE = 76/, /const iconSize = 76/],
  ['fade timing', /progress < 0\.72 \? 1 : \(1 - progress\) \/ 0\.28/, /progress < 0\.72 \? 1 : \(1 - progress\) \/ 0\.28/],
  ['settle timing', /1\.08 - 0\.08 \* Math\.min\(1, progress \/ 0\.24\)/, /1\.08 - 0\.08 \* Math\.min\(1, progress \/ 0\.24\)/],
]) {
  assert.match(helper, helperPattern, `editor reference retains gameplay ${label}`);
  assert.match(runtime, runtimePattern, `gameplay renderer still exposes ${label}`);
}

assert.ok(fs.existsSync(path.join(root, 'docs/assets/hud/generic_icons/icon_heart.png')), 'runtime heart asset exists');
console.log('Popup Text Editor relationship preview and diagnostics checks passed.');
