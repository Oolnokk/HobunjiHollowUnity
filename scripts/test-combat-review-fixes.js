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
assert.match(game, /window\.BanditCombat\?\.cancelLunge\?\.\(c\);\s*\n\s*window\.EnemyDodge\?\.cancel\?\.\(c\)/, 'leaving chase ends a bandit dodge');

// ── Projectile exclusion no longer drops id-less hostiles ─────────────
assert.doesNotMatch(ranged, /c\.id === exclude\?\.id/, 'a null exclude no longer matches every hostile without an id');
assert.match(ranged, /exclude && c\.id != null && c\.id === exclude\.id/, 'owner exclusion still matches by id');

// ── Melee reticle out-of-reach prefilter ──────────────────────────────
assert.match(reticle, /const outOfReach = Math\.hypot\(closest\.x - origin\.x, closest\.z - origin\.z\) > maxReachWorld;/, 'reticle computes horizontal reach before collider tests');
assert.match(reticle, /if \(outOfReach \|\| !profile\.attackId/, 'out-of-reach hostiles skip meleeHit');

// ── EnemySearchAI extraction ──────────────────────────────────────────
assert.match(game, /= window\.EnemySearchAI;/, 'game.js consumes the extracted enemy search module');
assert.match(game, /lineOfSightBlocker: c\._enemyVisibilityLosDebug[\s\S]{0,180}kind: c\._enemyVisibilityLosDebug\.kind/, 'mobile combat diagnostics identify the obstacle that blocked sight');
assert.match(ranged, /losTerrainStepTiles: 0\.25/, 'NPC sight samples terrain finely enough to catch narrow wall crossings');
assert.match(ranged, /InteriorDoorTiles\?\.blocksBox\?\.\(deps\.getCurrentArea\(\)/, 'closed interior doors block NPC line of sight even though they are separate from terrain tiles');
assert.match(ranged, /function hasLineOfSight\(observer, target\)[\s\S]{0,700}computeBanditLos\(observer, target, \{ projectileRadiusPx: 0 \}\)/, 'NPC perception reuses the real terrain and cover segment test');
assert.match(ranged, /hasLineOfSight,/, 'ranged collision exposes the shared geometric LOS check');
assert.match(enemySearch, /targetInsideAttackCone[\s\S]{0,180}RangedWeapons\?\.hasLineOfSight/, 'enemy acquisition requires both facing and geometric LOS');
assert.doesNotMatch(game, /distToPlayer > def\.leashRangePx/, 'player distance alone cannot immediately break combat');
assert.match(game, /lastKnownDistance > TILE \* 0\.45[\s\S]{0,180}moveCreatureToward\(c, lastKnownX, lastKnownY, def\.chaseSpeed, entityDt\)/, 'searching hostiles navigate toward their last-known player position');
assert.doesNotMatch(game, /function (enemyCanSeeTarget|beginEnemySearch|updateEnemySearch|enemyAttackAlignment|enemyAttackBusy)\(/, 'no duplicate enemy search implementation remains in game.js');
const coreTag = html.indexOf('js/combat/combat-core.js?v=');
const searchTag = html.indexOf('js/combat/enemy-search-ai.js?v=');
const gameTag = html.indexOf('game.js?v=');
assert(coreTag > 0 && searchTag > coreTag && searchTag < gameTag, 'enemy-search-ai.js loads after combat-core.js and before game.js');

let inCone = false;
let lineOfSightClear = true;
const searchRuntime = {
  THREE: { MathUtils },
  window: {
    FormatUtils: { clamp: MathUtils.clamp },
    Combat: { targetInsideAttackCone: () => inCone, postAttackTurnMultiplier: () => 1 },
    RangedWeapons: { hasLineOfSight: () => lineOfSightClear },
  },
};
vm.runInNewContext(enemySearch, searchRuntime);
const AI = searchRuntime.window.EnemySearchAI;
const hostile = { x: 0, y: 0, facing: 0, state: 'chase', def: { aggroRangePx: 500 } };
const target = { x: 0, y: 100, health: 50 };
AI.beginEnemySearch(hostile, target);
assert.equal(hostile.state, 'searching');
assert.equal(hostile._enemySearchDirection, 1, 'first sweep turns toward the side the target vanished on');
assert.equal(hostile._enemySearchLastKnownX, target.x, 'search stores the player X position at loss of sight');
assert.equal(hostile._enemySearchLastKnownY, target.y, 'search stores the player Y position at loss of sight');
assert.equal(AI.ENEMY_SEARCH_DURATION_S, 8, 'search lasts long enough to pursue and investigate the last-known position');
target.x = 25;
AI.updateEnemySearch(hostile, 0.1, target);
assert.equal(hostile._enemySearchLastKnownX, 0, 'unseen player movement does not update the last-known position');
AI.updateEnemySearch(hostile, 0.1, target);
assert(hostile.facing > 0, 'search sweep rotates the hostile');
inCone = true;
lineOfSightClear = false;
AI.updateEnemySearch(hostile, 0.1, target);
assert.equal(hostile.state, 'searching', 'a wall still blocks reacquisition inside the facing cone');
lineOfSightClear = true;
AI.updateEnemySearch(hostile, 0.1, target);
assert.equal(hostile.state, 'chase', 'regaining geometric line of sight resumes the chase');
inCone = false;
AI.beginEnemySearch(hostile, target);
AI.updateEnemySearch(hostile, AI.ENEMY_SEARCH_DURATION_S + 0.01, target);
assert.equal(hostile.state, 'return', 'search gives up after its duration');
assert.equal(AI.enemyAttackBusy({ _banditLunging: true }), true);
assert.equal(AI.enemyAttackBusy({}), false);

console.log('combat review fixes: all checks passed');

let actionLocked = false; // Models bandaging starting during a player windup.
let lockedPlayerStrikes = 0; // Counts actual callbacks rather than source patterns.
coreRuntime.window.CharacterActionLocks = { isLocked: () => actionLocked };
Combat.beginStagedAction({ windupS:0.2, onStrike:()=>lockedPlayerStrikes++ });
actionLocked = true;
Combat.update(0.3);
assert.equal(lockedPlayerStrikes, 0, 'player windup cancels if bandaging acquires the action lock');
Combat.beginStagedAction({ windupS:0, onStrike:()=>lockedPlayerStrikes++ });
assert.equal(lockedPlayerStrikes, 0, 'zero-duration player actions also respect locks');
Combat.beginStagedAction({ windupS:0, data:{isBandit:true,attacker:bandit}, onStrike:()=>lockedPlayerStrikes++ });
assert.equal(lockedPlayerStrikes, 1, 'player bandaging never suppresses hostile attacks');

coreRuntime.window.BandageSystem = {cancel(reason){assert.equal(reason,'attack');actionLocked=false;}};
Combat.beginStagedAction({windupS:0,onStrike:()=>lockedPlayerStrikes++});
assert.equal(lockedPlayerStrikes,2,'a direct player attack interrupts bandaging and executes');

const rangedInterrupt = {window:{BandageSystem:{cancel(reason){assert.equal(reason,'attack');rangedInterrupt.locked=false;}},CharacterActionLocks:{isLocked:()=>rangedInterrupt.locked}},locked:true,defFor:()=>({label:'Crossbow',fireDurationS:.3,fireAtFrac:.5}),playerAction:null,isLoaded:()=>true,poseForAction:()=>({}),deps:{player:{},refreshActionBar(){}},lastEvent:null}; // Executes the real ranged start owner with its ordinary animation suppressed.
vm.createContext(rangedInterrupt);
vm.runInContext(ranged.slice(ranged.indexOf('  function startPlayerAction('),ranged.indexOf('  function restoreHeldThrownWeapon(')),rangedInterrupt);
assert.equal(rangedInterrupt.startPlayerAction('crossbow',{suppressVisual:true}),true,'ranged fire stops bandaging before checking action locks');
assert.equal(rangedInterrupt.playerAction.kind,'fire');
