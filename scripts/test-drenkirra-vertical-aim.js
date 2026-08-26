#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const pellet = fs.readFileSync('docs/js/combat/combat-drenkirra-pellet.js', 'utf8'); // Guards the named Drenkirra projectile/rig implementation.
const followup = fs.readFileSync('docs/js/combat/combat-grehlr-drenkirra-followup.js', 'utf8'); // Guards the compatibility pose correction around the named attack.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Guards the live render-height dependencies supplied by the game closure.
const loader = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Guards cache-busting for the dynamically loaded modules.

assert.match(pellet, /Math\.hypot\(rawDirection\.x, rawDirection\.y, rawDirection\.z\)/, 'aim uses a complete 3D vector length');
assert.match(pellet, /x: rawDirection\.x \/ length,[\s\S]{0,100}y: rawDirection\.y \/ length,[\s\S]{0,100}z: rawDirection\.z \/ length/, 'aim normalizes every 3D direction component');
assert.match(pellet, /const horizontal = Math\.hypot\(dir\.x, dir\.z\)[\s\S]{0,120}Math\.atan2\(dir\.y, horizontal\) \* 180 \/ Math\.PI/, 'head pitch is derived from vertical versus horizontal aim');
assert.match(pellet, /headRig\?\.rig[\s\S]{0,260}minDeg[\s\S]{0,160}maxDeg/, 'authored head-rig limits clamp the requested pitch');
assert.match(pellet, /updateHeadRotation\(state\.aimPitchDeg, dt\)/, 'the rig tracks pitch during the attack wind-up/fire update');
assert.match(pellet, /PELLET_ORIGIN_FORWARD_TILES/, 'the pellet has an authored forward mouth offset');
assert.match(pellet, /const originX = creature\.x \+ Math\.cos\(angle\)/, 'the pellet starts ahead along world X');
assert.match(pellet, /const originZ = creature\.y \+ Math\.sin\(angle\)/, 'the pellet starts ahead along world Z');
assert.match(pellet, /vyWorld: dir\.y \* \(tuning\.PROJECTILE_SPEED_PX_S \/ deps\.TILE\)/, 'projectile velocity retains a world-Y component');
assert.match(pellet, /projectile\.worldY \+= projectile\.vyWorld \* dt/, 'projectile simulation advances vertical world height');
assert.match(pellet, /pointSegmentDistanceSqT[\s\S]{0,220}rayWorldY[\s\S]{0,220}targetWorldY/, 'collision checks vertical separation at the swept closest point');
assert.match(pellet, /restoreHeadRotation\(creature\)/, 'attack completion/cancel restores the authored rest angle');
assert.match(followup, /const hasHeadRig = typeof creature\.avatarRef\?\.updateHeadRotation === 'function'/, 'follow-up recognizes the authored head rig');
assert.match(followup, /if \(!hasHeadRig\) \{[\s\S]{0,220}rotation\.x/, 'legacy whole-plane pitch is skipped when the head rig is active');
assert.match(game, /getActorWorldY: \(actor\) =>[\s\S]{0,300}playerMesh\.position\.y/, 'combat receives the player render height');
assert.match(game, /worldSurfaceY: \(x, y\) => activeSurfaceYAtWorld\(x \/ TILE, y \/ TILE\)/, 'combat receives terrain height for pitched projectile grounding');
assert.match(game, /if \(!c\.treasureCue[\s\S]{0,160}animalAttacks\?\.isBusy\(c\)/, 'companion head restoration waits until a named attack is no longer active');
assert.match(loader, /combat-drenkirra-pellet\.js\?v=20260826drenkirra1/, 'pellet module cache key is bumped');
assert.match(loader, /combat-grehlr-drenkirra-followup\.js\?v=20260826drenkirra1/, 'follow-up module cache key is bumped');

for (const file of [
  'docs/game.js',
  'docs/js/combat/combat-drenkirra-pellet.js',
  'docs/js/combat/combat-grehlr-drenkirra-followup.js',
]) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });

console.log('Drenkirra vertical aim regression checks passed.');
