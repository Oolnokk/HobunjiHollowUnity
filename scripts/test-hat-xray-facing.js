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
assert.match(game, /const PLAYER_FRONT_PLANE_RENDER_ORDER = 2[\s\S]{0,240}const PLAYER_BACK_PLANE_RENDER_ORDER = 4[\s\S]{0,180}const SHOULDER_PET_PLANE_RENDER_ORDER = 6/, 'shoulder pets render above both portrait faces and their hat overlays');
assert.match(game, /_setLayerDepthWrite\(_playerAvatarFrontMaterial, !active\);[\s\S]{0,100}_setLayerDepthWrite\(_playerAvatarBackMaterial, !active\);/, 'shoulder-pet xray disables depth writes on both front and back portrait materials');
assert.match(game, /if \(mesh\) mesh\.renderOrder = PLAYER_FRONT_PLANE_RENDER_ORDER/, 'released shoulder pets restore their own planes to the normal portrait stack');

assert.match(source, /player_avatar_\(front\|back\)_hat_xray_plane/, 'parity module recognizes both runtime xray meshes');
assert.match(source, /mesh\.position\.z = source\.position\.z;/,
  'skinned xray is returned to the exact portrait surface instead of floating in front');
assert.match(source, /FRONT_XRAY_RENDER_ORDER = 2\.5/,
  'front xray is ordered above body=2 but below shoulder pets without a geometry offset');
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
assert.match(loader, /js\/hat-xray-head-facing\.js\?v=20260824a/,
  'xray coplanar module still loads before game.js constructs the player overlay');

console.log('hat xray coplanar-only checks passed.');
