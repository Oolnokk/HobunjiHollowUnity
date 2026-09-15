#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to fail when the Popup Text Editor relationship preview or position bridge drifts from the intended contract.
const fs = require('node:fs'); // Used to read editor/runtime source files directly.
const path = require('node:path'); // Used to resolve repository-relative fixture paths.
const vm = require('node:vm'); // Used to syntax-check both standalone browser helpers.

const root = path.resolve(__dirname, '..'); // Used as the repository root for every source read below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Used to keep fixture reads concise.
const editor = read('docs/tools/world-popup-editor/index.html'); // Used to verify the Popup Text Editor loads its relationship helper.
const helper = read('docs/js/world-popup-relationship-editor.js'); // Used to validate controls and screen-fixed diagnostics.
const bridge = read('docs/js/favor-popup-points-bridge.js'); // Used as the shared gameplay/editor relationship renderer and anchor owner.
const generic = read('docs/js/generic-hud-icons.js'); // Used as the pre-v3 visual contract that still emits relationship events.

assert.doesNotThrow(() => new vm.Script(helper), 'world popup relationship editor helper parses');
assert.doesNotThrow(() => new vm.Script(bridge), 'relationship position bridge parses');
assert.match(editor, /world-popup-relationship-editor\.js/, 'Popup Text Editor loads the relationship helper');
assert.doesNotMatch(editor, /relationship-popup-editor-preview\.js/, 'Popup Text Editor does not depend on the mistaken Ambient Dialogue preview helper');
assert.match(helper, /Overhead Rapport \/ Favor/, 'Popup Text Editor exposes relationship controls');
assert.match(helper, /Rapport \+10/, 'positive Rapport preview is available');
assert.match(helper, /Rapport -10/, 'negative Rapport preview is available');
assert.match(helper, /Favor \+10/, 'positive Favor preview is available');
assert.match(helper, /Favor -10/, 'negative Favor preview is available');
assert.match(helper, /favor-popup-points-bridge\.js\?v=20260915position3/, 'Popup Text Editor loads the shared gameplay position bridge');
assert.match(helper, /showRelationshipChange\(root, kind, amount, \{ amountIsPoints: true \}\)/, 'editor controls route through the shared relationship API against the live avatar root');

assert.match(helper, /position:fixed!important/, 'diagnostics are fixed to the viewport');
assert.match(helper, /document\.body\.appendChild\(panel\)/, 'diagnostics are not parented under the moving preview container');
assert.match(helper, /transform:none!important/, 'diagnostics explicitly disable transform movement');
assert.match(helper, /transition:none!important/, 'diagnostics explicitly disable easing/transitions');
assert.match(helper, /animation:none!important/, 'diagnostics explicitly disable CSS animations');
assert.match(helper, /debug panel=/, 'copied diagnostics report the panel screen position and computed motion styles');
assert.match(helper, /Retry avatar/, 'diagnostics retain the avatar retry action');
assert.match(helper, /window\.addEventListener\('unhandledrejection'/, 'diagnostics capture async boot failures');
assert.match(helper, /window\.addEventListener\('error'/, 'diagnostics capture JS/resource failures');

assert.match(bridge, /version: 3/, 'shared relationship position bridge is v3');
assert.match(bridge, /avatarRootWithPortraitMetadata/, 'relationship anchor resolves the avatar transform that owns portrait metadata');
assert.match(bridge, /portraitModelHeight/, 'relationship anchor uses authored portrait height');
assert.match(bridge, /portraitVerticalPlacementRatio/, 'relationship anchor uses authored portrait vertical placement');
assert.match(bridge, /avatarRoot\.localToWorld\(point\)/, 'relationship head position is transformed from avatar-local to world space every frame');
assert.match(bridge, /const anchor = relationshipHeadAnchorWorld\(event\.root\)/, 'active relationship popups recompute their head anchor every update');
assert.doesNotMatch(bridge, /new THREE\.Box3\(\)\.setFromObject\(root\)/, 'relationship positioning no longer caches a Box3 world-Y head offset');
assert.match(bridge, /anchor\.y \+= 0\.075 \* \(1 - Math\.pow\(1 - progress, 2\)\)/, 'relationship rise matches core Float+ rise distance');
assert.match(bridge, /plane\.userData\.noOutline = true/, 'relationship popup remains excluded from inverted-shell outlines');
assert.match(bridge, /plane\.userData\.hobunjiWorldTextOverlay = true/, 'relationship popup remains tagged for the world-text overlay path');

for (const [label, bridgePattern, genericPattern] of [
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
  assert.match(bridge, bridgePattern, `shared renderer retains gameplay ${label}`);
  assert.match(generic, genericPattern, `generic event layer still exposes ${label}`);
}

assert.ok(fs.existsSync(path.join(root, 'docs/assets/hud/generic_icons/icon_heart.png')), 'runtime heart asset exists');
console.log('Popup Text Editor fixed diagnostics and relationship head-anchor checks passed.');
