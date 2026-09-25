#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Guards persistence and dependency wiring for the in-game marker mode.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Guards the mobile-accessible Settings toggle.
const debug = fs.readFileSync('docs/js/debug-hitboxes.js', 'utf8'); // Guards the world-space perch/grip renderer and copyable snapshot.
const pixelProbe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards copyable world/local shoulder attachment coordinates.

assert.match(index, /Show Shoulder-Pet Perch \/ Grip/);
assert.match(index, /id="settingShowShoulderPetAttachmentPoints"/);
assert.match(game, /SHOULDER_ATTACHMENT_DEBUG_STORAGE_KEY = 'hobunjiDebugShoulderPetAttachmentPoints'/);
assert.match(game, /getShowShoulderPetAttachmentPoints: \(\) => s_showShoulderPetAttachmentPoints/);
assert.match(debug, /DEBUG_SHOULDER_PERCH_COLOR = '#5cf2ff'/);
assert.match(debug, /DEBUG_SHOULDER_GRIP_COLOR = '#ff5cf4'/);
assert.match(debug, /raw\.authoredPerchWorldPosition/);
assert.match(debug, /raw\.alignedGripWorldPosition/);
assert.match(debug, /_drawDebugSegment3D\(state\.perch, state\.grip/);
assert.match(debug, /'PERCH', 9/);
assert.match(debug, /'GRIP', 5/);
assert.match(debug, /DEBUG_SHOULDER_SOURCE_PIXEL_COLOR/);
assert.match(debug, /function _liveShoulderSourcePixelWorld\(\)/);
assert.match(debug, /getAttribute\?\.\('skinIndex'\)/);
assert.match(debug, /getAttribute\?\.\('skinWeight'\)/);
assert.match(debug, /SOURCE PIXEL/);
assert.match(debug, /sourcePerchError/);
assert.match(debug, /shoulderSourcePixelCaptureBefore/);
assert.match(debug, /material\?\.colorWrite === false/);
assert.match(debug, /visible-skinnedmesh-onBeforeRender/);
assert.match(pixelProbe, /Rendered source pixel world: SOURCE=/);
assert.match(pixelProbe, /source→perch=/);
assert.match(pixelProbe, /Shoulder attachment: SOURCE=/);
assert.match(pixelProbe, /sourceCapture=/);
assert.match(debug, /sourceCaptureMode/);
assert.match(debug, /DEBUG_SHOULDER_PET_ROOT_COLOR/);
assert.match(debug, /shoulderPetRootCaptureBefore/);
assert.match(debug, /'PET ROOT'/);
assert.match(debug, /petRootWorld/);
assert.match(pixelProbe, /PET_ROOT=/);
assert.match(pixelProbe, /petRootCapture=/);
assert.match(game, /playerAttachmentAnchor,/);
assert.match(debug, /grip \$\{state\.error\.toFixed\(5\)\}u/);
assert.match(debug, /get shoulderPetAttachment\(\)/);
assert.match(pixelProbe, /Attachment points world: PERCH=/);
assert.match(pixelProbe, /GRIP=/);
assert.match(pixelProbe, /Authored shoulderPerch local:/);
assert.doesNotMatch(debug, /requestAnimationFrame\s*\(|setInterval\s*\(/,
  'attachment marker reuses the existing overlay draw pass without another frame loop');

console.log('shoulder-pet attachment point debug checks passed');
