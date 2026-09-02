#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ghoul = JSON.parse(fs.readFileSync('docs/config/species/ghoul.json', 'utf8'));
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
const music = fs.readFileSync('docs/js/music-system.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const npcPreview = fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8');
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');

assert.match(mine, /GHOUL_BGM_TRACK = \{[^}]*volumeMultiplier: 2/, 'Ghoul BGM requests 2x base volume');
assert.match(music, /baseVol \* trackVolMul/, 'music player consumes per-track volumeMultiplier');

for (const gender of ['male', 'female']) {
  const choices = ghoul[gender].bodyColorRanges.A.choices;
  assert.equal(choices.length, 4, `${gender} keeps four authored skin-tone families`);
  for (const choice of choices) {
    for (const stop of choice.range.stops) {
      assert.ok(stop.sMin > 0, `${gender} Ghoul skin no longer desaturates toward paper white`);
      assert.ok(stop.sMax >= 0.5, `${gender} Ghoul skin retains visible pink saturation`);
      assert.ok(stop.vMax <= 0, `${gender} Ghoul skin no longer receives a brightness boost toward white`);
    }
  }
}

assert.match(game, /randomSeed: `mine-ghoul:\$\{mapData\.mineFloor\}:\$\{spawn\.col\}:\$\{spawn\.row\}`/, 'mine Ghoul spawns use deterministic palette variation');
assert.doesNotMatch(game, /speciesId: 'ghoul'[^\n]*s: -0\.82/, 'old paper-white body-color override is gone');
assert.match(npcPreview, /appearance\.randomSeed \|\| `npc-json:/, 'NPC portrait builder accepts non-visible deterministic appearance seeds');
assert.match(bandit, /function makeGhoulAvatarMineLit/, 'Ghoul-specific mine lighting helper exists');
assert.match(bandit, /new THREE\.MeshLambertMaterial\(/, 'Ghoul mapped sprite planes are converted to lit materials');
assert.match(bandit, /speciesId === 'ghoul'\) makeGhoulAvatarMineLit\(avatarRef\)/, 'only Ghoul bandit-style avatars opt into cave lighting');

console.log('Ghoul mine visual/audio tests passed');
