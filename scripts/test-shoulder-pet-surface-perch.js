#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const avatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const composer = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8');
const probe = fs.readFileSync('docs/js/pixel-probe.js', 'utf8');

assert.match(game, /const SHOULDER_PET_PERCH_ANCHOR = 'rightHandShoulder';/, 'perch remains the combat right-shoulder portrait coordinate');
assert.match(game, /function _playerPortraitSurfacePerchWorld[\s\S]{0,2200}rig\.deformLocalPoint\(bindPlaneLocal/, 'final pin samples the authored coordinate through the portrait skin rig');
assert.match(game, /surfacePerch = _playerPortraitSurfacePerchWorld\(perch\)[\s\S]{0,2200}_pinShoulderPetGripToWorld\(c, grip, surfacePerch\.world\)/, 'rendered pet grip is pinned to the deformed world point');
assert.match(game, /mode: 'static-anchor-fallback'/, 'rigless portraits retain the static right-shoulder fallback');
assert.match(avatar, /function deformLocalPoint\(localPoint, target = new THREE\.Vector3\(\), options = \{\}\)[\s\S]{0,2600}skeleton\.boneMatrices[\s\S]{0,1800}headWeight/, 'portrait exposes CPU skinning using the live skeleton matrices and the same head blend');
assert.match(avatar, /deformLocalPoint: skinnedRig\.deformLocalPoint/, 'neckRig exposes the point sampler to gameplay attachments');
assert.match(composer, /function resolvedNeckYawRad\(\)[\s\S]{0,300}resolvedPlayerNeckYawState\(\)\?\.renderedYaw/, 'surface sampler can use the exact render-time physical neck yaw');
assert.match(probe, /surfacePerch: pet\.shoulderPetSurfacePerchDebug/, 'Pixel Probe exposes bind/deformed/world surface-perch diagnostics');
assert.doesNotMatch(game, /_applyShoulderPetCombatPose|shoulderPetCombatPoseDebug/, 'removed combat-pose experiment stays removed');
assert.doesNotMatch(fs.readFileSync('docs/js/hand-shoulder-pose-runtime.js', 'utf8'), /currentNonNeutralWeight/, 'removed non-Neutral pose plumbing stays removed');
console.log('Shoulder-pet portrait-surface perch checks passed.');
