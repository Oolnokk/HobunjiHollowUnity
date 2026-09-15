#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const editor = read('docs/tools/world-popup-editor/index.html');
const helper = read('docs/js/world-popup-relationship-editor.js');
const bridge = read('docs/js/favor-popup-points-bridge.js');
const generic = read('docs/js/generic-hud-icons.js');

assert.doesNotThrow(() => new vm.Script(helper), 'world popup relationship editor helper parses');
assert.doesNotThrow(() => new vm.Script(bridge), 'relationship popup bridge parses');
assert.match(editor, /world-popup-relationship-editor\.js\?v=20260915c/, 'Popup Text Editor cache-busts the relationship helper');
assert.doesNotMatch(editor, /relationship-popup-editor-preview\.js/, 'Popup Text Editor does not depend on the mistaken Ambient Dialogue preview helper');
assert.match(helper, /Overhead Rapport \/ Favor/, 'Popup Text Editor exposes relationship controls');
assert.match(helper, /Rapport \+10/, 'positive Rapport preview is available');
assert.match(helper, /Rapport -10/, 'negative Rapport preview is available');
assert.match(helper, /Favor \+10/, 'positive Favor preview is available');
assert.match(helper, /Favor -10/, 'negative Favor preview is available');
assert.match(helper, /favor-popup-points-bridge\.js\?v=20260915position6/, 'Popup Text Editor loads the v6 shared relationship bridge');
assert.match(helper, /showRelationshipChange\(root, kind, amount, \{ amountIsPoints: true \}\)/, 'editor controls route through the shared relationship API against the live avatar root');
assert.match(helper, /helper: 7/, 'editor diagnostics identify the PNG-heart diagnostic helper revision');
assert.match(helper, /heart=.*alphaPixels=/, 'copied diagnostics expose relationship heart alpha information');
assert.match(helper, /pngSurface=/, 'copied diagnostics report canonical PNG surface availability');

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

assert.match(bridge, /version: 6/, 'shared relationship popup bridge is v6');
assert.match(bridge, /layoutLikeChathead/, 'relationship popup uses a chathead-style two-part layout');
assert.match(bridge, /group\.add\(heartPart\.plane, valuePart\.plane\)/, 'heart and signed value are separate children of one billboard group');
assert.match(bridge, /canvas\.width = 200;\s*canvas\.height = 200;/, 'heart uses the same square-canvas shape as a chathead');
assert.match(bridge, /CHATHEAD_GAP_RATIO = 0\.14/, 'relationship layout retains the ambient chathead proportional gap');
assert.doesNotMatch(bridge, /POPUP_WIDTH = 360|POPUP_HEIGHT = 112/, 'old combined 360x112 relationship rectangle is gone');
assert.match(bridge, /window\.HobunjiSpritePngSurface \|\| window\.HobunjiPngPlaneUnlit/, 'heart reuses the canonical PNG-plane surface API');
assert.match(bridge, /pngSurface\.makeCanvasTexture\(THREE, canvas, 'relationship_heart_texture'\)/, 'heart texture uses the same canvas-texture factory as working avatar/tool PNG planes');
assert.match(bridge, /pngSurface\.makeMaterial\(THREE, texture, 'relationship_heart_material', materialOverrides\)/, 'heart material uses the same material factory as working avatar/tool PNG planes');
assert.match(bridge, /nonTransparentPixels/, 'heart diagnostics report whether the tinted canvas actually contains visible alpha');
assert.match(bridge, /canonicalPngSurface/, 'heart diagnostics report whether the canonical PNG-plane helper was present');
assert.match(bridge, /relationshipOriginWorld/, 'relationship motion starts from inside the avatar rather than a fixed above-head point');
assert.match(bridge, /source: 'portrait-local-upper-body'/, 'portrait metadata drives the pop-out origin');
assert.match(bridge, /addScaledVector\(cameraRight, event\.worldHeight \* POP_RIGHT_RATIO \* travel\)/, 'relationship popup travels screen-right as it emerges');
assert.match(bridge, /addScaledVector\(cameraUp, event\.worldHeight \* POP_UP_RATIO \* travel\)/, 'relationship popup travels screen-up as it emerges');
assert.match(bridge, /START_GROUP_SCALE = 0\.58/, 'relationship popup begins small');
assert.match(bridge, /END_GROUP_SCALE = 1\.32/, 'relationship popup grows while travelling');
assert.match(bridge, /Math\.pow\(1 - progress, 1\.12\)/, 'relationship popup fades continuously while growing');
assert.match(bridge, /HEART_RENDER_ORDER = 1211/, 'heart uses the ambient chathead render-order band');
assert.match(bridge, /VALUE_RENDER_ORDER = 1210/, 'signed value uses the ambient text render-order band');
assert.match(bridge, /plane\.userData\.noOutline = true/, 'relationship popup remains excluded from inverted-shell outlines');
assert.match(bridge, /plane\.userData\.hobunjiWorldTextOverlay = true/, 'relationship popup remains tagged for the world-text overlay path');

for (const [label, bridgePattern, genericPattern] of [
  ['Rapport heart color', /RAPPORT_HEART_COLOR = '#ffd84d'/, /RAPPORT_HEART_COLOR = '#ffd84d'/],
  ['Favor heart color', /FAVOR_HEART_COLOR = '#ff8fbd'/, /FAVOR_HEART_COLOR = '#ff8fbd'/],
  ['gain number color', /RELATIONSHIP_GAIN_COLOR = '#66d96f'/, /RELATIONSHIP_GAIN_COLOR = '#66d96f'/],
  ['loss number color', /RELATIONSHIP_LOSS_COLOR = '#ff5b5b'/, /RELATIONSHIP_LOSS_COLOR = '#ff5b5b'/],
]) {
  assert.match(bridge, bridgePattern, `shared renderer retains gameplay ${label}`);
  assert.match(generic, genericPattern, `generic event layer still exposes ${label}`);
}

assert.ok(fs.existsSync(path.join(root, 'docs/assets/hud/generic_icons/icon_heart.png')), 'runtime heart asset exists');
console.log('Popup Text Editor mobile visibility, canonical PNG-plane relationship heart, chathead-style layout, diagonal pop motion, diagnostics, and avatar fallback checks passed.');
