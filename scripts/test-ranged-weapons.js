#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const game = read('docs/game.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
const pngAvatar = read('docs/js/png-plane-avatar.js');
const bandit = read('docs/js/combat/combat-bandit.js');
const editor = read('docs/tools/attack-animation-editor/index.html');
const index = read('docs/index.html');
const combatConfig = JSON.parse(read('docs/config/combat/attack-values.json'));
const gangConfig = JSON.parse(read('docs/config/bandits/bandit-gang-config.json'));

assert.match(index, /js\/combat\/ranged-weapons\.js/, 'runtime must load the ranged module');
assert.match(game, /ranged:\s*\['shoot'\]/, 'ranged slot must expose its own action');
assert.match(game, /ranged:\s*null/, 'equipment must own a dedicated ranged slot');
assert.match(game, /activeTool === 'weapon'\) setActiveTool\('ranged'\)/, 'combat toggle must swap melee to ranged');
assert.match(game, /activeTool === 'ranged'\) setActiveTool\('weapon'\)/, 'combat toggle must swap ranged to melee');

assert.strictEqual(combatConfig.rangedWeapons.crossbow.projectileCount, 1, 'crossbow must be single-shot');
assert.ok(combatConfig.rangedWeapons.scatterbow.projectileCount > 1, 'scatterbow must fire multiple projectiles');
assert.ok(combatConfig.rangedWeapons.scatterbow.spreadDeg > 0, 'scatterbow must have a cone spread');
assert.match(ranged, /arrow_long\.png/, 'crossbow must use the long arrow visual');
assert.match(ranged, /arrow_short\.png/, 'scatterbow must use the short arrow visual');
assert.match(ranged, /SphereGeometry/, 'projectile collision body must be a sphere');
assert.match(ranged, /visible:\s*false/, 'projectile collider must remain hidden');
assert.match(ranged, /creatureSnapSwayTarget/, 'projectile PNG must reuse animal snap/deadzone rotation');
assert.match(ranged, /root sphere's vx\/vy and trajectory angle are never changed/, 'visual deadzone must not steer the projectile');

assert.match(editor, /value="load">Load: Neutral → Windup → Neutral/, 'editor must expose loading playback');
assert.match(editor, /value="fire">Fire: Neutral → Strike → Neutral/, 'editor must expose firing playback');
assert.match(editor, /Crossbow — Load/, 'editor must include crossbow load preset');
assert.match(editor, /Scatterbow — Fire/, 'editor must include scatterbow fire preset');
assert.match(editor, /Tool scale \(uniform\)/, 'editor must expose neutral tool scale');
assert.match(editor, /neutralOnly:\s*true/, 'tool scale must only be authored on the neutral pose');
assert.match(game, /toolHolder\.scale\.setScalar\(Number\.isFinite\(Number\(neutral\.scale\)\)/, 'runtime must apply authored neutral tool scale');
assert.match(game, /playerIdlePose\?\.\(equipmentSlots\.ranged\)/, 'runtime must select the loaded or empty ranged neutral pose');
assert.match(game, /function updatePlayerHeadAim\(\)/, 'runtime must own global player head aim tracking');
assert.match(game, /angleDiff\(targetWorldYaw, playerMesh\.rotation\.y\)/, 'head aim must counter the rendered body yaw');
assert.match(pngAvatar, /top \+ totalHeight \* fraction/, 'neck pivot must be measured from the avatar top rather than its feet');
assert.match(pngAvatar, /const fraction = Number\.isFinite\(neckHeightFraction\) \? neckHeightFraction : 0\.13/, 'neck weighting must default to the head-only region');
assert.match(index, /png-plane-avatar\.js\?v=20260817a/, 'game bootstrap must invalidate the pre-fix whole-plane neck-rig cache');
assert.doesNotMatch(editor, /Head Yaw|headYaw/, 'head turn must not be an authored attack-pose channel');

for (const itemKey of ['crossbow', 'scatterbow']) {
  const def = combatConfig.rangedWeapons[itemKey];
  assert.strictEqual(def.reloadDurationS, 1.04, `${itemKey} must preserve the authored load duration`);
  assert.strictEqual(def.reloadSequence, 'attack', `${itemKey} load must include windup and strike stages`);
  assert.strictEqual(def.reloadWindupFrac, 0.55, `${itemKey} must preserve the authored load windup timing`);
  assert.strictEqual(def.reloadStrikeFrac, 0.56, `${itemKey} must preserve the authored load strike timing`);
  assert.strictEqual(def.reloadHoldFrac, 0.692, `${itemKey} must preserve the authored load hold timing`);
  assert.strictEqual(def.fireDurationS, 1.04, `${itemKey} must preserve the authored fire duration`);
  assert.strictEqual(def.fireSequence, 'attack', `${itemKey} fire must include windup and strike stages`);
  assert.strictEqual(def.fireWindupFrac, 0.05, `${itemKey} must preserve the authored fire windup timing`);
  assert.strictEqual(def.fireAtFrac, 0.08, `${itemKey} must preserve the authored fire strike timing`);
  assert.strictEqual(def.fireHoldFrac, 0.17, `${itemKey} must preserve the authored fire hold timing`);
}
assert.match(ranged, /AUTHORED_FIRE_POSE[\s\S]*neutral:\s*\{[^}]*scale:\s*1\.77/, 'fire neutral must use the higher authored tool scale');
assert.match(ranged, /AUTHORED_LOAD_POSE[\s\S]*neutral:\s*\{[^}]*scale:\s*1\.77/, 'load neutral must use the higher authored tool scale');
assert.strictEqual((ranged.match(/firePose:\s*clonePoseSet\(AUTHORED_FIRE_POSE\)/g) || []).length, 2, 'both weapons must use the authored fire pose set');
assert.strictEqual((ranged.match(/loadPose:\s*clonePoseSet\(AUTHORED_LOAD_POSE\)/g) || []).length, 2, 'both weapons must use the authored load pose set');
assert.match(ranged, /sequence === 'attack'[\s\S]*poses\.neutral, poses\.windup[\s\S]*poses\.windup, poses\.strike/, 'full ranged playback must traverse windup and strike');
assert.match(editor, /crossbow_load[\s\S]*?sequence: 'attack'[\s\S]*?scale: 1\.77/, 'crossbow load preset must include every pose stage at the higher scale');
assert.match(editor, /scatterbow_load[\s\S]*?sequence: 'attack'[\s\S]*?scale: 1\.77/, 'scatterbow load preset must include every pose stage at the higher scale');

assert.strictEqual(gangConfig.rangedWeaponChanceByRank.captain, 1, 'captains must always retain a ranged option');
assert.match(bandit, /weaponKey:\s*weapon\.weaponKey,[\s\S]*rangedWeaponKey/, 'bandits must retain both melee and ranged weapon keys');
assert.match(ranged, /distToPlayer < minRange[\s\S]*_rangedMode = false/, 'bandits must fall back to melee at close range');
assert.match(ranged, /window\.__rangedDebug/, 'debug surface must be available by default');

console.log('ranged weapon integration tests passed');
