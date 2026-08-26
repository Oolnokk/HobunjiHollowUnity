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
assert.match(game, /const PLAYER_FRONT_PLANE_RENDER_ORDER = 2[\s\S]{0,240}const PLAYER_BACK_PLANE_RENDER_ORDER = 4[\s\S]{0,180}const SHOULDER_PET_PLANE_RENDER_ORDER = PLAYER_BACK_PLANE_RENDER_ORDER \+ 2/, 'shoulder pets render above both portrait faces and their hat overlays');
assert.match(game, /for \(const m of \[_playerAvatarFrontMaterial, _playerAvatarBackMaterial\]\)[\s\S]{0,180}m\.depthWrite = !active/, 'shoulder-pet xray disables depth writes on both front and back portrait materials');
assert.match(game, /if \(mesh\) mesh\.renderOrder = PLAYER_FRONT_PLANE_RENDER_ORDER/, 'released shoulder pets restore their own planes to the normal portrait stack');

assert.match(source, /player_avatar_\(front\|back\)_hat_xray_plane/, 'parity module recognizes both runtime xray meshes');
assert.match(source, /mesh\.position\.z = source\.position\.z;/,
  'skinned xray is returned to the exact portrait surface instead of floating in front');
assert.match(source, /FRONT_XRAY_RENDER_ORDER = 2\.5/,
  'front xray is ordered above body=2 but below shoulder pet=3 without a geometry offset');
assert.match(source, /yawDot > 0 && uprightDot >= TILT_CUTOFF_DOT/,
  'front xray uses the same binary 90-degree yaw and 35-degree tilt gate as front headwear');
assert.match(source, /currentMaterial\.opacity = visible \? baseOpacity : 0;/,
  'culled xray fragments are made fully transparent before alphaTest/depth write');
assert.match(source, /assembly\.add = function addWithHatXrayParity/,
  'post-build xray additions are intercepted and corrected when they are created');
assert.match(loader, /js\/hat-xray-head-facing\.js\?v=20260824a/,
  'xray parity module loads before game.js constructs the player overlay');
assert.ok(
  loader.indexOf('js/front-hat-head-facing.js') < loader.indexOf('js/hat-xray-head-facing.js'),
  'xray parity wraps the final front-hat-aware avatar builder'
);

console.log('hat xray facing parity checks passed.');
