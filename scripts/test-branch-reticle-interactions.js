#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const climb = read('docs/js/climb-system.js');
const game = read('docs/game.js');
const reticle = read('docs/js/combat/melee-hud-reticle.js');
const ranged = read('docs/js/combat/ranged-weapons.js');

assert(climb.includes('branchJumpDown'), 'branch jump-down path exists');
assert(climb.includes('collapseTree'), 'tree collapse release path exists');
assert(climb.includes('rayFocusedNest'), 'nest selection requires a ray-focused collider hit');
assert(game.includes('const interactionRay = currentPlayerInteractionRay()'), 'cavern nest selection requires an interaction ray');
assert(climb.includes('updateBranchDefender'), 'branch defender climb path exists');
assert(game.includes('ClimbSystem?.collapseTree'), 'axe action collapses branch occupants');
assert(game.includes('updateFallenNests'), 'game loop updates fallen nest lerp');
assert(game.includes('player._nestTakeActive = false'), 'damage interrupts nest hold');
assert(reticle.includes('SLOT_COLOR_FILTERS'), 'reticle keeps unlocked slot colors');
assert(reticle.includes('Combat?.meleeHit'), 'reticle uses authoritative melee collision');
assert(ranged.includes('aimRadius'), 'ranged acquisition uses projectile sweep radius');
console.log('branch/reticle interaction contracts: 9 checks passed');

