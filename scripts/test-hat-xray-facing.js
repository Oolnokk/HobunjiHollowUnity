#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/hat-xray-head-facing.js', 'utf8');
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');

assert.match(game, /async function buildPlayerHatXrayOverlay/, 'game still owns the shoulder-pet hat xray overlay');
assert.match(game, /mesh\.position\.z \+= facingBack \? -0\.0015 : 0\.0015;/,
  'regression fixture confirms game creates the xray with the historical physical Z nudge');
assert.match(game, /assembly\.add\(mesh\)/, 'xray overlay is added after the avatar build');
assert.match(game, /const PLAYER_FRONT_PLANE_RENDER_ORDER = 2[\s\S]{0,240}const PLAYER_BACK_PLANE_RENDER_ORDER = 4/,
  'owner front/back plane priorities stay fixed with a shoulder pet');
const render = fs.readFileSync('docs/js/held-object-render-order.js', 'utf8');
assert.match(game, /HeldObjectRenderOrder\?\.setShoulderPetLayering\?\.\(/,
  'game delegates shoulder-pet compositing to the shared renderer');
assert.match(render, /setShoulderPartDepthWrite\(state\.frontMaterial, false\)/,
  'shared compositor keeps the owner/pet portrait stack depth-write-free');
assert.match(game, /const SHOULDER_PET_XRAY_ENABLED = false;/, 'shoulder-pet hat xray is retired; the authored front/behind pose owns occlusion (#821)');
assert.match(game, /enabled = SHOULDER_PET_XRAY_ENABLED && !!enabled;/, 'setPlayerHatXray cannot re-enable the retired xray path');
assert.match(render, /function restoreShoulderPet\(pet\)/,
  'shared compositor restores detached pet sprite depth and order');

assert.match(source, /player_avatar_\(front\|back\)_hat_xray_plane/, 'parity module recognizes both runtime xray meshes');
assert.match(source, /mesh\.position\.z = source\.position\.z;/,
  'skinned xray is returned to the exact portrait surface instead of floating in front');
assert.match(source, /FRONT_XRAY_RENDER_ORDER = 2\.5/,
  'front hat overlay stays above body=2 but below the inward-facing pet front=3');
assert.match(source, /assembly\.add = function addWithHatXrayParity/,
  'post-build xray additions are intercepted and corrected when they are created');
assert.match(source, /angleVisibility:\s*'disabled'/,
  'xray diagnostics make permanent angle-independent visibility explicit');
assert.doesNotMatch(source, /TILT_CUTOFF|yawCutoff|tiltCutoff|FacingGate|worldFront|worldUp|toCamera|uprightDot|yawDot/i,
  'xray parity contains no camera/head-angle cutoff calculations');
assert.doesNotMatch(source, /material\.opacity\s*=|currentMaterial\.opacity\s*=/,
  'xray parity never changes material opacity based on view angle');
assert.doesNotMatch(source, /onBeforeRender\s*=|smoothstep\s*\(/,
  'xray parity installs no per-frame visibility hook or fade');
assert.match(loader, /js\/hat-xray-head-facing\.js\?v=[A-Za-z0-9_.-]+/,
  'xray coplanar module loads with the no-facing cache revision before game.js constructs the player overlay');

console.log('hat xray coplanar-only checks passed.');
