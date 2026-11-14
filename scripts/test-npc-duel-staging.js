#!/usr/bin/env node
'use strict';

// Executes js/combat/npc-duel-staging.js (and EnemyDodge's staged-dodge entry)
// to check that NPC-vs-NPC fights the player is not part of are staged
// cheaply, and fall back to the full simulation once the player is involved.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let now = 10000;
let roll = 0; // Deterministic rnd() value.
const TILE = 64;
const player = { x: 0, y: 0, health: 100 };

const HIDDEN_X = 9999; // Avatar positions beyond this are outside the stub camera frustum.
const windowStub = {
  ResourceSystem: { spendStamina(entity, amount) { entity.stamina -= amount; } },
  OffscreenRigLod: { inView: x => x < HIDDEN_X },
};
const context = vm.createContext({ window: windowStub, performance: { now: () => now }, Date, Math, console });
vm.runInContext(fs.readFileSync('docs/js/combat/npc-duel-staging.js', 'utf8'), context, { filename: 'npc-duel-staging.js' });
const staging = windowStub.NpcDuelStaging;
assert.ok(staging, 'module exposes window.NpcDuelStaging');
staging.init({ TILE, player, rnd: () => roll, now: () => now });

function hidden(entity) { entity.avatarRef.group.position.x = HIDDEN_X; return entity; }
function fighter(id, x, y, extra = {}) {
  return {
    id, isBandit: true, banditRank: 'grunt', health: 50, x, y, facing: 0, stamina: 40, attackCooldownT: 0,
    _banditComboIndex: 0, state: 'chase', avatarRef: { group: { visible: true, position: { x: x / TILE, y: 0, z: y / TILE } } },
    def: { attackStaminaCost: 10, attackCooldownS: 1.1, attackDamage: 7, chaseSpeed: 200, attackTag: 'sharp' },
    ...extra,
  };
}

const calls = { swings: 0, damage: [], moves: [] };
const api = {
  comboReachPx: () => 80,
  fireStagedSwing(actor) { calls.swings++; actor.attackCooldownT = 1; return true; },
  moveToward(actor, x, y) { calls.moves.push({ x, y }); return true; },
  damage(actor, foe, amount) { calls.damage.push({ actor, foe, amount }); foe.health -= amount; },
};

// Far from the player: staged, approaches to reach without any full-AI bookkeeping.
const far = 40 * TILE;
const a = fighter('a', far, 0);
const b = fighter('b', far + 300, 0);
let result = staging.update(a, 0.016, b, 300, 0, api);
assert.ok(result, 'a duel far from the player is staged');
assert.equal(result.moving, true, 'out of reach, the staged fighter approaches');
assert.equal(calls.swings, 0);
assert.equal(staging.isStaged(a), true);
const approach = calls.moves.at(-1);
assert.ok(Math.hypot(approach.x - b.x, approach.y - b.y) <= 80, 'approach point sits inside reach of the opponent');

// In reach and facing the opponent: swings through the real (staged) combo step.
b.x = far + 60;
result = staging.update(a, 0.016, b, 60, 0, api);
assert.equal(calls.swings, 1, 'in reach and aligned, a real staged swing fires');
assert.equal(result.moving, false);

// Not yet facing: turns in first instead of snapping and swinging.
const c = fighter('c', far, 0, { facing: Math.PI });
const d = fighter('d', far + 60, 0);
staging.update(c, 0.016, d, 60, 0, api);
assert.equal(calls.swings, 1, 'a fighter facing away turns before swinging');
assert.ok(Math.abs(c.facing - Math.PI) > 0.1, 'it actually turned toward its opponent');

// Both offscreen: resolved abstractly (no swing, but stamina/cooldown/damage still move).
const e = hidden(fighter('e', far, 0));
const f = hidden(fighter('f', far + 60, 0));
roll = 0; // Below ABSTRACT_HIT_CHANCE -> hit.
staging.update(e, 0.016, f, 60, 0, api);
assert.equal(calls.swings, 1, 'no swing is staged for a fight nobody can see');
assert.equal(calls.damage.length, 1, 'the abstract exchange still deals damage');
assert.equal(f.health, 43);
assert.equal(e.stamina, 30, 'and spends the same stamina as a swing');
assert.equal(e.attackCooldownT, 1.1, 'and keeps the normal attack cadence');
roll = 0.99;
e.attackCooldownT = 0;
staging.update(e, 0.016, f, 60, 0, api);
assert.equal(calls.damage.length, 1, 'a failed roll misses');
roll = 0;

// A stale _rigOffscreenAsleep flag on an actor that is actually in view must not
// hide the fight (the flag is only refreshed when its mesh update runs).
const staleA = fighter('staleA', far, 0, { _rigOffscreenAsleep: true });
const staleB = fighter('staleB', far + 60, 0, { _rigOffscreenAsleep: true });
const swingsBefore = calls.swings;
staging.update(staleA, 0.016, staleB, 60, 0, api);
assert.equal(calls.swings, swingsBefore + 1, 'visible fighters with a stale offscreen flag still swing for real');
assert.equal(staging.isHidden(fighter('inv', 0, 0, { avatarRef: { group: { visible: false, position: { x: 0, y: 0, z: 0 } } } })), true, 'an undrawn avatar is hidden');

// Player involvement returns the fight to full simulation.
const g = fighter('g', 3 * TILE, 0);
const h = fighter('h', 3 * TILE + 60, 0);
assert.equal(staging.update(g, 0.016, h, 60, 0, api), null, 'player within range -> full simulation');
const i = fighter('i', far, 0);
const j = fighter('j', far + 60, 0, { _teamHitAt: now - 1000 });
assert.equal(staging.update(i, 0.016, j, 60, 0, api), null, 'opponent recently hit by the player -> full simulation');
assert.equal(staging.update(i, 0.016, player, 60, 0, api), null, 'the player is never a staged opponent');
assert.equal(staging.update(i, 0.016, { x: far, y: 0, health: 10 }, 60, 0, api), null, 'non-actor targets are never staged');
assert.equal(staging.update(i, 0.016, { x: far, y: 0, health: 1e9, creatureKey: 'encounterStatueProxy', isEncounterProxy: true }, 60, 0, api), null, 'ruin statue proxies are never staged');
const boss = fighter('boss', far, 0, { maskboundTroop: 'headtaker' });
assert.equal(staging.update(boss, 0.016, b, 60, 0, api), null, 'scripted/boss attackers keep their own AI');

// Hysteresis: a staged fighter the player walks up to promotes at INVOLVE_TILES,
// and only re-stages beyond RELEASE_TILES.
const k = fighter('k', 20 * TILE, 0);
const l = fighter('l', 20 * TILE + 300, 0);
assert.ok(staging.update(k, 0.016, l, 300, 0, api));
player.x = 20 * TILE - 5.5 * TILE;
assert.equal(staging.update(k, 0.016, l, 300, 0, api), null, 'promoted when the player comes within INVOLVE_TILES');
assert.equal(staging.isStaged(k), false);
player.x = 20 * TILE - 7 * TILE;
assert.equal(staging.update(k, 0.016, l, 300, 0, api), null, 'stays full inside RELEASE_TILES');
player.x = 20 * TILE - 8 * TILE;
assert.ok(staging.update(k, 0.016, l, 300, 0, api), 're-staged once beyond RELEASE_TILES');
player.x = 0;

// 2D strike test.
const atk = fighter('atk', 0, 0, { facing: 0 });
assert.equal(staging.strikeLands(atk, fighter('t1', 70, 0), 60, 0.4), true, 'inside reach + body radius and cone');
assert.equal(staging.strikeLands(atk, fighter('t2', 120, 0), 60, 0.4), false, 'beyond reach');
assert.equal(staging.strikeLands(atk, fighter('t3', 0, 70), 60, 0.4), false, 'outside the cone');
assert.equal(staging.strikeLands(atk, fighter('t4', 50, 0, { dodging: true }), 60, 0.4), false, 'a dodging defender is missed');
assert.equal(staging.strikeLands(atk, fighter('t5', 50, 0, { invulnUntil: now + 100 }), 60, 0.4), false, 'iframes still apply');

// A/B switch.
staging.setEnabled(false);
assert.equal(staging.update(fighter('m', far, 0), 0.016, fighter('n', far + 60, 0), 60, 0, api), null, 'disabled -> full simulation');
staging.setEnabled(true);
const snap = staging.snapshot();
assert.ok(snap.stagedFrames > 0 && snap.fullFrames > 0 && snap.abstractExchanges === 2 && snap.promotions >= 1, 'counters are exposed');

// Staged dodge goes through the real EnemyDodge state machine.
const dodgeVoices = [];
const BanditCombat = {
  init() {}, async makeEntity() { return null; },
  updateCombatAI(entity) { return { aimAngle: entity.facing, moving: false }; },
};
const dodgeWindow = {
  BanditCombat,
  Combat: { currentPlayerMeleeThreat: () => null },
  ResourceSystem: { spendStamina() {} },
  CombatVocalizations: { playDodge: entity => dodgeVoices.push(entity) },
  ClothingWeavingSystem: { armorStats: () => ({ weightUnits: 0, dodgeEfficacy: 1, combatMoveMul: 1 }), outfitItemsFromRoster: () => [], totalOutfitWeight: () => 0 },
};
const dodgeContext = vm.createContext({ window: dodgeWindow, performance: { now: () => now }, Date, Math, console });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-enemy-dodge.js', 'utf8'), dodgeContext, { filename: 'combat-enemy-dodge.js' });
dodgeWindow.BanditCombat.init({
  TILE, rnd: () => 0, canOccupyAt: () => true, tickCreatureFootsteps() {},
  sweptMove(_x, _y, x, y) { return { x, y }; },
});
windowStub.EnemyDodge = dodgeWindow.EnemyDodge;
const defender = fighter('def', 100, 0, { outfitArmorStats: { weightUnits: 0, dodgeEfficacy: 1, combatMoveMul: 1 } });
const attacker = fighter('atk2', 40, 0);
assert.equal(staging.maybeStageDodge(defender, attacker, 0.2), true, 'roll 0 < dodge chance -> defender queues a dodge');
assert.ok(defender._enemyDodgePending, 'pending reaction like a dodge of the player');
for (let n = 0; n < 5 && !defender.dodging; n++) dodgeWindow.BanditCombat.updateCombatAI(defender, 0.03, attacker, 60);
assert.equal(defender.dodging, true, 'the defender plays the ordinary roll');
assert.deepEqual(dodgeVoices, [defender]);
assert.equal(dodgeWindow.EnemyDodge.stageDodge(defender, attacker, 0.2), false, 'no second dodge while one is active');
const notFighting = fighter('idle', 100, 0, { state: 'return' });
roll = 0;
assert.equal(staging.maybeStageDodge(notFighting, attacker, 0.2), false, 'a defender outside chase AI never queues a dodge that would fire late');
roll = 0.99;
const defender2 = fighter('def2', 100, 0);
assert.equal(staging.maybeStageDodge(defender2, attacker, 0.2), false, 'failed roll -> no dodge');


// ── Ranged troops: real shots while visible (timer-cached sight, target-only
// projectile), abstract volleys while both fighters are offscreen. Extracts the
// real functions from ranged-weapons.js like test-npc-thrown-ranged-actions.js.
const rangedSource = fs.readFileSync('docs/js/combat/ranged-weapons.js', 'utf8');
function rangedFn(name, followingName) {
  const start = rangedSource.indexOf('  function ' + name + '(');
  const end = rangedSource.indexOf('\n  function ' + followingName + '(', start);
  assert(start >= 0 && end > start, name + ' is extractable');
  return rangedSource.slice(start, end);
}
let rangedNow = 1000;
const rangedLog = { volleys: [], los: 0, fullLos: 0, damage: [], loads: 0, pitches: 0 };
const rangedDefs = { crossbow: { label: 'Crossbow', fireDurationS: 1, reloadDurationS: 1, fireAtFrac: 0.1, damage: 9, knockbackPxS: 80, projectileCount: 1 } };
const rangedSandbox = {
  Math, console, performance: { now: () => rangedNow },
  AIM_EPSILON: 1e-6, losRepositions: 0, MAX_FIRE_TRIGGER_TO_PROJECTILE_S: 0.012,
  window: { NpcDuelStaging: staging, ResourceSystem: { spendStamina() { return { spent: 0 }; } } },
  deps: {
    TILE, getCurrentArea: () => 'zone', worldSurfaceY: () => 0, moveCreatureToward: () => true,
    damageCreature(target, amount, _x, _y, _kb, opts) { rangedLog.damage.push({ target, amount, opts }); target.health -= amount; },
  },
  chargeStaminaCostForPose: () => 0, paymentTotal: () => 0,
  spendRangedLoadStamina() { rangedLog.loads++; return { spent: 0 }; },
  setRangedLoadRegenBlocked() {},
  defFor: key => rangedDefs[key],
  isLoaded: (_key, actor) => actor._rangedLoaded !== false,
  setLoaded: (_key, value, actor) => { actor._rangedLoaded = value; },
  playRangedActionSfx() {},
  spawnVolley(key, _x, _y, _angle, team, owner, _ammo, _pitch, shotOptions) { rangedLog.volleys.push({ key, team, owner, shotOptions }); return []; },
  banditAimPitch() { rangedLog.pitches++; return 0; },
  banditLosStatus() { rangedLog.fullLos++; return { clear: true }; },
  computeBanditLos() { rangedLog.los++; return { clear: true }; },
  rangedAttackRadiusPx: () => TILE * 9,
  canMeleeReach: () => true,
  ledgesBlockMeleeApproach: () => false,
  repositionBanditForLos: () => false,
  segmentHitboxInterval: (_s, _e, box) => (box ? { enter: 0.5 } : null),
  actorHitbox: actor => (actor.noBox ? null : { box: true }),
};
vm.createContext(rangedSandbox);
vm.runInContext('let lastEvent = "idle";\n'
  + rangedFn('fireReleaseFrac', 'isLoaded') + '\n'
  + rangedFn('stagedTargetHit', 'nearestHostileHit') + '\n'
  + rangedFn('stagedAimPitch', 'banditAimPitch').replace('const STAGED_LOS_REFRESH_MS', 'var STAGED_LOS_REFRESH_MS') + '\n'
  + rangedFn('beginBanditAction', 'banditLosSegment') + '\n'
  + rangedFn('updateBanditAI', 'updateBanditVisual') + '\n'
  + 'globalThis.ranged = { updateBanditAI, stagedTargetHit };', rangedSandbox);
const rangedUpdate = rangedSandbox.ranged.updateBanditAI;
const archer = fighter('archer', far, 0, { def: { ...fighter('x', 0, 0).def, rangedWeaponKey: 'crossbow' }, _rangedCooldownT: 0, _rangedLoaded: true });
const foe = fighter('foe', far + 5 * TILE, 0);
rangedUpdate(archer, 0.016, foe, 5 * TILE);
assert.equal(archer._rangedAction?.kind, 'fire', 'a staged archer still plays the real fire action');
assert.equal(rangedLog.fullLos, 0, 'staged sight never uses the movement-invalidated LOS cache');
assert.equal(rangedLog.los, 1);
assert.equal(rangedLog.pitches, 0, 'staged aim pitch comes from ground heights, not portrait hitboxes');
for (let n = 0; n < 20; n++) { foe.y += 3; rangedUpdate(archer, 0.06, foe, 5 * TILE); }
assert.equal(rangedLog.volleys.length, 1, 'the arrow is released');
assert.equal(rangedLog.volleys[0].shotOptions?.stagedTarget, foe, 'the arrow only tests its intended target');
assert.equal(rangedLog.los, 1, 'sight is not recomputed while both keep moving inside the refresh window');
rangedNow += 1000;
archer._rangedCooldownT = 0; archer._rangedLoaded = true; archer._rangedAction = null;
rangedUpdate(archer, 0.016, foe, 5 * TILE);
assert.equal(rangedLog.los, 2, 'sight refreshes once the timer expires');
assert.ok(rangedSandbox.ranged.stagedTargetHit(foe, {}, {}, 0.1, 'zone'), 'staged projectile hit test finds its target');
assert.equal(rangedSandbox.ranged.stagedTargetHit({ ...foe, health: 0 }, {}, {}, 0.1, 'zone'), null, 'dead targets are not hit');

// Offscreen: no action, no projectile, same cadence and a damage roll.
const hiddenArcher = hidden(fighter('harcher', far, 0, { def: { ...fighter('x', 0, 0).def, rangedWeaponKey: 'crossbow' }, _rangedCooldownT: 0, _rangedLoaded: false }));
const hiddenFoe = hidden(fighter('hfoe', far + 5 * TILE, 0));
const volleysBefore = rangedLog.volleys.length;
roll = 0;
rangedUpdate(hiddenArcher, 0.016, hiddenFoe, 5 * TILE);
assert.equal(hiddenArcher._rangedAction ?? null, null, 'no load animation offscreen');
assert.equal(hiddenArcher._rangedLoaded, true, 'the abstract load still loads');
assert.equal(rangedLog.loads, 1, 'and still pays its stamina');
assert.equal(hiddenArcher._rangedCooldownT, 1, 'at the normal reload cadence');
rangedUpdate(hiddenArcher, 1, hiddenFoe, 5 * TILE);
assert.equal(rangedLog.damage.length, 1, 'the abstract volley deals damage on a hit roll');
assert.equal(rangedLog.damage[0].amount, 9);
assert.equal(rangedLog.damage[0].opts.attacker, hiddenArcher);
assert.equal(rangedLog.volleys.length, volleysBefore, 'and spawns no projectile');
assert.equal(hiddenArcher._rangedLoaded, false, 'the shot unloads the weapon');

// Player involvement: the full ranged path (movement-cached LOS) is used.
const nearArcher = fighter('narcher', 2 * TILE, 0, { def: { ...fighter('x', 0, 0).def, rangedWeaponKey: 'crossbow' }, _rangedCooldownT: 0, _rangedLoaded: true });
rangedUpdate(nearArcher, 0.016, fighter('nfoe', 7 * TILE, 0), 5 * TILE);
assert.equal(rangedLog.fullLos, 1, 'near the player the full LOS path runs');

// ── Flaskers: offscreen throws apply the recipe directly, no projectile.
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const applied = [];
let throws = 0, flaskStarts = 0;
const flaskContext = vm.createContext({
  Math, console,
  window: {
    NpcDuelStaging: staging,
    AlchemyFlasks: { throwFromEntity() { throws++; return true; } },
    AlchemySystem: { applyRecipeToEntity(id, mul, target, opts) { applied.push({ id, mul, target, opts }); return { ok: true }; }, potencyMultiplier: tier => 1 + tier },
    HeldActionAnimations: { throwFlask: { poses: {}, durationS: 1 } },
    Combat: { beginStagedAction() { flaskStarts++; return {}; } },
  },
  deps: { TILE }, finishBanditAction() {},
});
vm.runInContext(banditSource.slice(banditSource.indexOf('  function updateBanditFlaskAI('), banditSource.indexOf('  function makeBanditDef(')), flaskContext);
const flaskDef = { banditFlaskLoadout: ['venom', 'fire'], banditFlaskPotencyTier: 2, banditFlaskerTuning: { minThrowRangeTiles: 2.25, maxThrowRangeTiles: 10, throwCooldownSeconds: 2 } };
const hiddenFlasker = hidden(fighter('hflask', far, 0, { banditRank: 'flasker', _banditFlaskIndex: 0, def: { ...fighter('x', 0, 0).def, ...flaskDef } }));
roll = 0;
assert.ok(flaskContext.updateBanditFlaskAI(hiddenFlasker, 0.016, hiddenFoe, 5 * TILE).handled);
assert.equal(flaskStarts, 0, 'no throw animation offscreen');
assert.equal(throws, 0, 'and no flask projectile');
assert.equal(applied.length, 1, 'the recipe lands on the opponent directly');
assert.deepEqual([applied[0].id, applied[0].mul, applied[0].target], ['venom', 3, hiddenFoe]);
assert.equal(applied[0].opts.skipEmpower, true, 'NPC throws never borrow player perks');
assert.equal(hiddenFlasker._banditFlaskCooldownT, 3, 'normal throw cadence (cooldown + throw duration)');
const visibleFlasker = fighter('vflask', far, 0, { banditRank: 'flasker', _banditFlaskIndex: 0, def: { ...fighter('x', 0, 0).def, ...flaskDef } });
flaskContext.updateBanditFlaskAI(visibleFlasker, 0.016, foe, 5 * TILE);
assert.equal(flaskStarts, 1, 'visible staged Flaskers still throw for real');

console.log('npc duel staging: ok');
