#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const game = read('docs/game.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
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

assert.strictEqual(gangConfig.rangedWeaponChanceByRank.captain, 1, 'captains must always retain a ranged option');
assert.match(bandit, /weaponKey:\s*weapon\.weaponKey,[\s\S]*rangedWeaponKey/, 'bandits must retain both melee and ranged weapon keys');
assert.match(ranged, /distToPlayer < minRange[\s\S]*_rangedMode = false/, 'bandits must fall back to melee at close range');
assert.match(ranged, /window\.__rangedDebug/, 'debug surface must be available by default');

console.log('ranged weapon integration tests passed');
