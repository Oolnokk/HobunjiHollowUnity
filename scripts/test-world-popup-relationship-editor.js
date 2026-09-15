#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Used to fail when the Popup Text Editor relationship preview or position bridge drifts from the intended contract.
const fs = require('node:fs'); // Used to read editor/runtime source files directly.
const path = require('node:path'); // Used to resolve repository-relative fixture paths.
const vm = require('node:vm'); // Used to syntax-check both standalone browser helpers.

const root = path.resolve(__dirname, '..'); // Used as the repository root for every source read below.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8'); // Used to keep fixture reads concise.
const editor = read('docs/tools/world-popup-editor/index.html'); // Used to verify the Popup Text Editor loads its relationship helper.
const helper = read('docs/js/world-popup-relationship-editor.js'); // Used to validate controls, fallback avatar boot, and screen-fixed diagnostics.
const bridge = read('docs/js/favor-popup-points-bridge.js'); // Used as the shared gameplay/editor relationship renderer and anchor owner.
const generic = read('docs/js/generic-hud-icons.js'); // Used as the pre-v3 visual contract that still emits relationship events.

assert.doesNotThrow(() => new vm.Script(helper), 'world popup relationship editor helper parses');
assert.doesNotThrow(() => new vm.Script(bridge), 'relationship position bridge parses');
assert.match(editor, /world-popup-relationship-editor\.js\?v=20260915c/, 'Popup Text Editor cache-busts the v6 relationship helper');
assert.doesNotMatch(editor, /relationship-popup-editor-preview\.js/, 'Popup Text Editor does not depend on the mistaken Ambient Dialogue preview helper');
assert.match(helper, /Overhead Rapport \/ Favor/, 'Popup Text Editor exposes relationship controls');
assert.match(helper, /Rapport \+10/, 'positive Rapport preview is available');
assert.match(helper, /Rapport -10/, 'negative Rapport preview is available');
assert.match(helper, /Favor \+10/, 'positive Favor preview is available');
assert.match(helper, /Favor -10/, 'negative Favor preview is available');
assert.match(helper, /favor-popup-points-bridge\.js\?v=20260915position3/, 'Popup Text Editor loads the shared gameplay position bridge');
assert.match(helper, /showRelationshipChange\(root, kind, amount, \{ amountIsPoints: true \}\)/, 'editor controls route through the shared relationship API against the live avatar root');

assert.match(helper, /id: 'popup_preview_character'/, 'editor has an immediate deterministic preview character');
assert.match(helper, /async function ensureVisibleAvatar/, 'editor can render a preview avatar independently of repository NPC loading');
assert.match(helper, /await render\(FALLBACK_NPC\)/, 'fallback uses the editor real portrait/avatar renderer rather than a dummy mesh');
assert.match(helper, /renderGeneration\(\) > generationBeforeFallback \+ 1/, 'fallback detects when a repository render supersedes its generation');
assert.match(helper, /fallbackAvatar = 'superseded'/, 'superseded fallback is treated as a normal race outcome rather than an error');
assert.match(helper, /if \(!avatarModel\(\)\) ensureVisibleAvatar\(\)/, 'diagnostic loop repairs a missing avatar while the large NPC database is still loading');
assert.match(helper, /target = Array\.isArray\(npcList\) && npcList\.length \? \(npcList\[index\] \|\| npcList\[0\]\) : FALLBACK_NPC/, 'Retry avatar also works before repository NPCs are available');

assert.match(editor, /html,body\{height:100dvh\}/, 'mobile editor uses the dynamic viewport height');
assert.match(editor, /#app\{display:flex;flex-direction:column;height:100dvh;min-height:100dvh\}/, 'mobile editor uses a viewport-bounded column layout');
assert.match(editor, /#preview\{order:0;flex:0 0 56dvh;min-height:260px;max-height:64dvh\}/, 'mobile 3D preview is the first pane with a guaranteed visible height');
assert.match(editor, /#controls\{order:1;flex:1 1 auto;min-height:0;overflow:auto/, 'mobile controls scroll beneath the preview instead of pushing it off screen');

assert.match(helper, /position:fixed!important/, 'diagnostics are fixed to the viewport');
assert.match(helper, /top:max\(8px,env\(safe-area-inset-top\)\)!important/, 'diagnostics are top-anchored instead of following Android bottom-viewport changes');
assert.match(helper, /bottom:auto!important/, 'diagnostics do not use the moving bottom edge as their anchor');
assert.match(helper, /max-height:34px!important/, 'diagnostics start collapsed so they cannot obscure the 3D preview');
assert.match(helper, /data-toggle[^>]*style[^>]*>Show</, 'collapsed diagnostics expose an explicit Show control');
assert.match(helper, /document\.body\.appendChild\(panel\)/, 'diagnostics are not parented under the moving preview container');
assert.match(helper, /transform:none!important/, 'diagnostics explicitly disable transform movement');
assert.match(helper, /transition:none!important/, 'diagnostics explicitly disable easing/transitions');
assert.match(helper, /animation:none!important/, 'diagnostics explicitly disable CSS animations');
assert.match(helper, /visualTop=/, 'copied diagnostics report Android visual viewport offset');
assert.match(helper, /preview=\$\{preview \?/, 'copied diagnostics report whether the 3D preview intersects the visible viewport');
assert.match(helper, /debug panel=/, 'copied diagnostics report the panel screen position and computed motion styles');
assert.match(helper, /Retry avatar/, 'diagnostics retain the avatar retry action');
assert.match(helper, /ResizeObserver loop completed with undelivered notifications/, 'benign Android ResizeObserver warning is explicitly filtered from failure diagnostics');
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
console.log('Popup Text Editor mobile visibility, fallback race, diagnostics, and relationship head-anchor checks passed.');
