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

const windowStub = { ResourceSystem: { spendStamina(entity, amount) { entity.stamina -= amount; } } };
const context = vm.createContext({ window: windowStub, performance: { now: () => now }, Date, Math, console });
vm.runInContext(fs.readFileSync('docs/js/combat/npc-duel-staging.js', 'utf8'), context, { filename: 'npc-duel-staging.js' });
const staging = windowStub.NpcDuelStaging;
assert.ok(staging, 'module exposes window.NpcDuelStaging');
staging.init({ TILE, player, rnd: () => roll, now: () => now });

function fighter(id, x, y, extra = {}) {
  return {
    id, isBandit: true, banditRank: 'grunt', health: 50, x, y, facing: 0, stamina: 40, attackCooldownT: 0,
    _banditComboIndex: 0, avatarRef: { group: { visible: true } },
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
const e = fighter('e', far, 0, { _rigOffscreenAsleep: true });
const f = fighter('f', far + 60, 0, { _rigOffscreenAsleep: true });
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

// Player involvement returns the fight to full simulation.
const g = fighter('g', 3 * TILE, 0);
const h = fighter('h', 3 * TILE + 60, 0);
assert.equal(staging.update(g, 0.016, h, 60, 0, api), null, 'player within range -> full simulation');
const i = fighter('i', far, 0);
const j = fighter('j', far + 60, 0, { _teamHitAt: now - 1000 });
assert.equal(staging.update(i, 0.016, j, 60, 0, api), null, 'opponent recently hit by the player -> full simulation');
assert.equal(staging.update(i, 0.016, player, 60, 0, api), null, 'the player is never a staged opponent');
assert.equal(staging.update(i, 0.016, { x: far, y: 0, health: 10 }, 60, 0, api), null, 'non-actor targets (ruin proxies) are never staged');
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
roll = 0.99;
const defender2 = fighter('def2', 100, 0);
assert.equal(staging.maybeStageDodge(defender2, attacker, 0.2), false, 'failed roll -> no dodge');

console.log('npc duel staging: ok');
