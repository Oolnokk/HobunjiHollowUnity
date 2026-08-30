#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards the rider pin call after ordinary player smoothing.
const mountSource = fs.readFileSync('docs/js/mount-system.js', 'utf8'); // Guards steady-state carrier-authoritative positioning.
const pixelProbeSource = fs.readFileSync('docs/js/pixel-probe.js', 'utf8'); // Guards mobile-visible rider drift diagnostics.

assert.match(gameSource,
  /HOBUNJI_ATTACHMENT_RIG_MATH\?\.characterPosteriorY\(rec\.posteriorRule, modelHeight, playerToolBaseY\)/,
  'mounted riders must resolve posterior Y with the same floor-relative math as Shoulder Rig and procedural limbs');
assert.match(gameSource,
  /playerMesh\.position\.y \+= \(targetY - playerMesh\.position\.y\) \* 0\.18;[\s\S]{0,700}Mounts\?\.pinMountedRiderMesh\(playerMesh, mountSeatLift\);/,
  'the rider is pinned after its ordinary independent render lerp');
assert.match(mountSource,
  /mountRideState !== 'mounted'[\s\S]{0,900}riderMesh\.position\.set\(carrierPosition\.x, targetY, carrierPosition\.z\);/,
  'only the settled mounted state snaps the rider to the final carrier mesh transform');
assert.match(mountSource,
  /const riderSeatOffsetY = \(Number\(seatLift\) \|\| 0\) - \(Number\(m\.halfHeight\) \|\| 0\);/,
  'the existing floor-relative saddle lift is converted to a carrier-center-relative rider offset');
assert.match(mountSource,
  /get renderSync\(\) \{ return \{ \.\.\.mountRenderSync \}; \}/,
  'mount render synchronization exposes a read-only diagnostic snapshot');
assert.match(pixelProbeSource, /Mount render sync: pre-pin XZ drift=/,
  'Pixel Probe includes mobile-visible mounted rider drift diagnostics');

console.log('mounted rider render sync checks passed');
