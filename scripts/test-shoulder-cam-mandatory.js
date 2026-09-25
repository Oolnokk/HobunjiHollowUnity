#!/usr/bin/env node
'use strict';

// Shoulder Cam is the only gameplay camera; the top-down "default" mode is retired
// (kept only as an internal config fallback). Guards every path that used to be able
// to land the player back in top-down.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Owns defaultCameraModeKey(), dialogue close, and the setCameraMode deps.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Settings markup.
const resetButton = fs.readFileSync('docs/js/shoulder-camera-reset-button.js', 'utf8'); // Must stay null-safe without the toggle.

assert.match(game, /const s_shoulderSurf = true;/, 'Shoulder Cam flag is a constant, not a user toggle');
assert.match(game, /function defaultCameraModeKey\(\) \{\s*return SHOULDER_SURF_MODE;/,
  'every "back to gameplay camera" path resolves to Shoulder Cam');
assert.doesNotMatch(game, /getElementById\('settingShoulderSurf'\)/, 'game.js no longer listens for a Shoulder Cam on/off toggle');
assert.doesNotMatch(index, /id="settingShoulderSurf"/, 'Settings no longer offers a Shoulder Cam on/off toggle');
assert.match(index, /id="settingShoulderSurfOffsetH"/, 'Shoulder Cam framing sliders remain available');

const setCameraModeDeps = game.match(/setCameraMode: \(v\) => \{[^\n]*\}/g) || [];
assert.equal(setCameraModeDeps.length, 2, 'both farm/fishing setCameraMode deps are present');
for (const dep of setCameraModeDeps) {
  assert.match(dep, /v == null \|\| v === \(cameraConfig\(\)\.defaultMode \|\| 'default'\)\) enterDefaultCameraMode\(\)/,
    'farm/livestock/fishing restores that fall back to the retired default mode are redirected into Shoulder Cam');
}

const closeDialogue = game.slice(game.indexOf('enterDefaultCameraMode(); // Always Shoulder Cam now'), game.indexOf('dialogueZoomPointers.clear();'));
assert.ok(closeDialogue.length > 0, 'dialogue close re-enters the default (Shoulder Cam) mode');
assert.doesNotMatch(closeDialogue, /cameraAzimuthOffsetDeg = 0/,
  'dialogue close relies on the Shoulder Cam azimuth snap instead of the old top-down reset');

assert.match(resetButton, /const toggle = document\.getElementById\('settingShoulderSurf'\);[\s\S]{0,1200}if \(toggle\)/,
  'Shoulder Cam reset button tolerates the removed toggle');

console.log('Shoulder Cam mandatory checks passed.');
