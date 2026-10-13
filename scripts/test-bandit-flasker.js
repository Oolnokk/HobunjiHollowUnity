#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const editor = read('docs/tools/attack-animation-editor/index.html');
const grips = read('docs/js/hand-tool-grips.js');
const animations = read('docs/js/held-action-animations.js');
const bandits = read('docs/js/combat/combat-bandit.js');
const camps = read('docs/js/bandit-camps.js');
const cfg = JSON.parse(read('docs/config/bandits/bandit-gang-config.json'));
const loot = JSON.parse(read('docs/config/loot/loot-pools.json'));

assert.match(editor, /throwingflask:\s*\{[^\n]*throwing_flask\.png/, 'Attack Editor tool catalog exposes the authored throwing flask sprite');
assert.match(editor, /id: 'flask_throw'[^\n]*heldAnimationKey: 'throwFlask'[^\n]*toolKey: 'throwingflask'/, 'Flask action selects the throwing-flask tool and shared throw animation');
assert.match(animations, /const throwFlask = weaponThrowSpin;/, 'flasks reuse the exact hatchet spin-throw animation object');
assert.match(grips, /throwingflask:\s*\{[\s\S]*?primaryGrip:[\s\S]*?z: 0\.17/, 'throwing flask has an authored neck grip');
assert.match(grips, /key\.includes\('flask'\).*return 'throwingflask'/, 'real alchemy flask item keys normalize onto the authored grip');
assert.equal(cfg.gangComposition.flaskersMin, 1);
assert.equal(cfg.gangComposition.flaskersMax, 2);
assert.equal(cfg.flasker.loadoutSize, 2, 'Flaskers always carry two distinct flask recipe types');
assert.equal(cfg.rangedWeaponChanceByRank.flasker, 0, 'Flaskers reserve their ranged role for alchemy flasks');
assert.equal(cfg.flasker.lootMinPerType, 2);
assert.ok(loot.pools.bandit_flasker, 'Flasker base corpse pool exists');
assert.match(bandits, /banditRank !== 'flasker'/, 'Bandit AI has a first-class Flasker branch');
assert.match(bandits, /throwFromEntity\(c, recipeId/, 'Flasker AI launches through the shared alchemy flask projectile system');
assert.match(camps, /grantFlaskerLoadoutLoot\(c, parts\)/, 'corpse looting grants the exact Flasker loadout types');
assert.match(camps, /reserveByRank: \{ grunt: 0, flasker: 0, lieutenant: 0, captain: 0 \}/, 'camp lifecycle tracks Flaskers beside the existing ranks');
console.log('ok: throwing flask editor grip + Flasker bandit integration');
