#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = require('./classic-script-group-index.js').expandClassicScriptGroups(); // Group manifests expanded, as the parser sees the page.
const pixelProbe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');
const actionArc = fs.readFileSync('docs/js/action-arc-ui.js', 'utf8'); // The utilities wheel now lives here.

assert.match(actionArc, /id: 'character-view'[\s\S]*deps\.setCharacterViewMode\(!deps\.characterViewMode\.enabled\)/, 'the utilities wheel exposes the character-view toggle');
assert.match(game, /characterViewMode\.enabled \|\| cameraModeConfig\(activeCameraMode\)\.freeRotate === true/, 'character view grants full camera orbit');
assert.match(game, /viewModeMoveMagnitude > 0\.08 \|\| viewModeForcedMovement[\s\S]*setCharacterViewMode\(false, 'movement'\)/, 'manual or forced movement disables character view');
assert.match(game, /if \(characterViewMode\.enabled\) \{[\s\S]*facingAngle = characterViewMode\.lockedFacingAngle;[\s\S]*player\.angle = characterViewMode\.lockedPlayerAngle;/, 'logical face and aim yaw stay pinned while viewing');
assert.match(game, /else if \(characterViewMode\.enabled\) \{[\s\S]*playerFacing = characterViewMode\.lockedPlayerFacing;[\s\S]*playerMesh\.rotation\.y = playerFacing;/, 'camera-relative billboard rotation stays pinned while viewing');
assert.match(game, /playerNeckJoint\.rotation\.x = characterViewMode\.lockedNeckX;[\s\S]*playerNeckJoint\.rotation\.y = characterViewMode\.lockedNeckY;/, 'the neck remains pinned while viewing');
assert.match(pixelProbe, /Character View: \$\{characterView\.enabled \? 'ON' : 'off'\}/, 'Pixel Probe includes mobile-copyable character-view state');
assert.match(index, /game\.js\?v=[A-Za-z0-9_.-]+/, 'the game script cache is invalidated');
assert.match(index, /js\/pixel-probe\.js\?v=[A-Za-z0-9_.-]+/, 'the updated mobile diagnostic is cache-invalidated');

// State/toggle extracted to js/character-view-mode.js; game.js aliases the state object.
assert.match(game, /const characterViewMode = window\.CharacterViewMode\.state;/, 'game.js aliases the module-owned Character View state');
assert.match(game, /function setCharacterViewMode\([^)]*\) \{[^}\n]*CharacterViewMode\.set\(/, 'existing call sites delegate to the module');
assert(index.indexOf('js/character-view-mode.js?v=') > -1 && index.indexOf('js/character-view-mode.js?v=') < index.indexOf('"game.js?v='), 'Character View module loads before game.js');
// Ready ranged weapons must not track the camera reticle while the body/hands are pinned.
assert.match(game, /rangedTracksAim = [^;\n]*!characterViewMode\.enabled/, 'ready ranged weapon stays body-relative in Character View');

// Behavioural check of the module itself.
{
  const vm = require('node:vm');
  const toasts = []; const locks = [];
  const sandbox = { window: {}, Date };
  vm.runInNewContext(fs.readFileSync('docs/js/character-view-mode.js', 'utf8'), sandbox);
  const cv = sandbox.window.CharacterViewMode;
  let facing = 1.25, playerAngle = 0.5, playerFacing = -0.75, cursorless = false;
  const neck = { rotation: { x: 0.1, y: -0.2 } };
  cv.init({
    getFacingAngle: () => facing, getPlayerAngle: () => playerAngle, getPlayerFacing: () => playerFacing,
    getNeckJoint: () => neck, requestPointerLock: () => locks.push('request'), releasePointerLock: () => locks.push('release'),
    cursorlessMouseAimRequested: () => cursorless, showToast: msg => toasts.push(msg),
  });
  assert.equal(sandbox.window.HOBUNJI_CHARACTER_VIEW_STATUS.enabled, false, 'init publishes the boot status');
  assert.equal(cv.state.lockedFacingAngle, 1.25, 'init seeds the locked facing from game.js');
  cv.set(true);
  assert.deepEqual([cv.state.enabled, cv.state.lockedFacingAngle, cv.state.lockedPlayerAngle, cv.state.lockedPlayerFacing, cv.state.lockedNeckX, cv.state.lockedNeckY],
    [true, 1.25, 0.5, -0.75, 0.1, -0.2], 'enabling pins facing, aim yaw, body yaw and neck');
  facing = 3; cv.set(true);
  assert.equal(cv.state.lockedFacingAngle, 1.25, 'repeat enable is a no-op');
  cv.set(false, 'movement');
  assert.deepEqual(locks, ['request', 'release'], 'pointer lock follows the toggle');
  assert.equal(toasts.at(-1), 'Character View: Off — movement');
  assert.equal(sandbox.window.HOBUNJI_CHARACTER_VIEW_STATUS.lastChangeReason, 'movement');
  cursorless = true; cv.set(true); cv.set(false);
  assert.deepEqual(locks, ['request', 'release', 'request'], 'exit keeps pointer lock while cursor-less aim is still requested');
}

console.log('Character view mode checks passed.');
