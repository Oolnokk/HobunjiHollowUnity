'use strict';

// Regression coverage for the 2026-09-26 combat review:
//   - a creature killed mid-windup can no longer land its staged strike
//   - player projectiles hit hostiles that have no id
//   - EnemySearchAI (extracted from game.js) keeps its search sweep behavior
//   - the melee reticle skips collider tests for out-of-reach hostiles

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const game = read('docs/game.js');
const core = read('docs/js/combat/combat-core.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
const reticle = read('docs/js/combat/melee-hud-reticle.js');
const dodge = read('docs/js/combat/combat-enemy-dodge.js');
const enemySearch = read('docs/js/combat/enemy-search-ai.js');
const html = read('docs/index.html');

const MathUtils = {
  degToRad: degrees => degrees * Math.PI / 180,
  radToDeg: radians => radians * 180 / Math.PI,
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  lerp: (from, to, amount) => from + (to - from) * amount,
};

// ── Staged strikes are cancelled per attacker ─────────────────────────
const coreRuntime = { window: {}, performance: { now: () => 1000 }, THREE: { MathUtils } };
vm.runInNewContext(core, coreRuntime);
const Combat = coreRuntime.window.Combat;
Combat.init({ player: {} });
const bandit = { id: 'bandit' };
const other = { id: 'other' };
let banditStrikes = 0, otherStrikes = 0, banditCancels = 0;
Combat.beginStagedAction({ windupS: 0.2, strikeS: 0.1, data: { isBandit: true, attacker: bandit }, onStrike: () => { banditStrikes++; }, onCancel: () => { banditCancels++; } });
Combat.beginStagedAction({ windupS: 0.2, strikeS: 0.1, data: { isBandit: true, attacker: bandit }, onStrike: () => { banditStrikes++; } }); // Riposte-style action not stored on the bandit.
Combat.beginStagedAction({ windupS: 0.2, strikeS: 0.1, data: { isBandit: true, attacker: other }, onStrike: () => { otherStrikes++; } });
Combat.cancelStagedForAttacker(bandit);
Combat.update(0.5);
assert.equal(banditStrikes, 0, 'a dead attacker never fires its in-flight staged strikes');
assert.equal(banditCancels, 1, 'cancelled staged actions still run their own cleanup');
assert.equal(otherStrikes, 1, 'other attackers keep their staged strikes');

const deathFn = game.slice(game.indexOf('function transitionCreatureToDeath('), game.indexOf('function damageCreature('));
assert.match(deathFn, /cancelStagedForAttacker\?\.\(c\)/, 'death cancels staged bandit actions and ripostes');
assert.match(deathFn, /telegraph\?\.cancel\?\.\(c\)/, 'death cancels the generic bite telegraph');
assert.match(deathFn, /animalAttacks\?\.cancel\?\.\(c\)/, 'death cancels named animal attacks');
assert.match(deathFn, /EnemyDodge\?\.cancel\?\.\(c\)/, 'death ends any in-flight dodge roll');

// ── Enemy dodge cancel ────────────────────────────────────────────────
assert.match(dodge, /function cancel\(entity\)[\s\S]{0,200}finishDodge\(entity\)/, 'EnemyDodge.cancel finishes an active roll');
assert.match(dodge, /threatStatus, cancel, debugSnapshot/, 'EnemyDodge exposes cancel');
assert.match(game, /c\._banditLunging = false;\s*\n\s*window\.EnemyDodge\?\.cancel\?\.\(c\)/, 'leaving chase ends a bandit dodge');

// ── Projectile exclusion no longer drops id-less hostiles ─────────────
assert.doesNotMatch(ranged, /c\.id === exclude\?\.id/, 'a null exclude no longer matches every hostile without an id');
assert.match(ranged, /exclude && c\.id != null && c\.id === exclude\.id/, 'owner exclusion still matches by id');

// ── Melee reticle out-of-reach prefilter ──────────────────────────────
assert.match(reticle, /const outOfReach = Math\.hypot\(closest\.x - origin\.x, closest\.z - origin\.z\) > maxReachWorld;/, 'reticle computes horizontal reach before collider tests');
assert.match(reticle, /if \(outOfReach \|\| !profile\.attackId/, 'out-of-reach hostiles skip meleeHit');

// ── EnemySearchAI extraction ──────────────────────────────────────────
assert.match(game, /= window\.EnemySearchAI;/, 'game.js consumes the extracted enemy search module');
assert.doesNotMatch(game, /function (enemyCanSeeTarget|beginEnemySearch|updateEnemySearch|enemyAttackAlignment|enemyAttackBusy)\(/, 'no duplicate enemy search implementation remains in game.js');
const coreTag = html.indexOf('js/combat/combat-core.js?v=');
const searchTag = html.indexOf('js/combat/enemy-search-ai.js?v=');
const gameTag = html.indexOf('game.js?v=');
assert(coreTag > 0 && searchTag > coreTag && searchTag < gameTag, 'enemy-search-ai.js loads after combat-core.js and before game.js');

let inCone = false;
const searchRuntime = {
  THREE: { MathUtils },
  window: {
    FormatUtils: { clamp: MathUtils.clamp },
    Combat: { targetInsideAttackCone: () => inCone, postAttackTurnMultiplier: () => 1 },
  },
};
vm.runInNewContext(enemySearch, searchRuntime);
const AI = searchRuntime.window.EnemySearchAI;
const hostile = { x: 0, y: 0, facing: 0, state: 'chase', def: { aggroRangePx: 500 } };
const target = { x: 0, y: 100, health: 50 };
AI.beginEnemySearch(hostile, target);
assert.equal(hostile.state, 'searching');
assert.equal(hostile._enemySearchDirection, 1, 'first sweep turns toward the side the target vanished on');
AI.updateEnemySearch(hostile, 0.1, target);
assert(hostile.facing > 0, 'search sweep rotates the hostile');
inCone = true;
AI.updateEnemySearch(hostile, 0.1, target);
assert.equal(hostile.state, 'chase', 'regaining sight resumes the chase');
inCone = false;
AI.beginEnemySearch(hostile, target);
AI.updateEnemySearch(hostile, AI.ENEMY_SEARCH_DURATION_S + 0.01, target);
assert.equal(hostile.state, 'return', 'search gives up after its duration');
assert.equal(AI.enemyAttackBusy({ _banditLunging: true }), true);
assert.equal(AI.enemyAttackBusy({}), false);

console.log('combat review fixes: all checks passed');
