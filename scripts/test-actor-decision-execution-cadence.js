#!/usr/bin/env node
'use strict';
// Real execution tests for actor decision leases; actions remain frame-smooth.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let nowMs = 0; // Shared fake clock lets cadence tests establish deadlines without wall-clock sleeps.
const performance = { now: () => nowMs }; // Used by every tested decision owner.

// Companion targeting still uses the original authoritative ranking on decision ticks.
const combatContext = { window: { __farmLog() {} }, performance, console };
vm.createContext(combatContext);
vm.runInContext(read('docs/js/companion-combat-response.js'), combatContext);
const companionAI = combatContext.window.CompanionCombatResponse;
const master = { x: 0, y: 0 }; // Owner anchors the ordinary threat radius.
const pet = { x: 0, y: 0, health: 100 }; // Decision deadline is stored on this one companion, never globally.
const enemy = { id: 'attacker', x: 30, y: 0, health: 20, areaId: 'town', def: { hostile: true } };
assert.equal(companionAI.shouldReevaluate(pet, master, 'town', 100), true, 'initial target acquisition must run');
assert.equal(companionAI.chooseTarget(pet, master, new Set([enemy]), 'town', 100), enemy);
nowMs = 70;
assert.equal(companionAI.shouldReevaluate(pet, master, 'town', 100), false, 'committed target is not fully rescored every frame');
nowMs = 141;
assert.equal(companionAI.shouldReevaluate(pet, master, 'town', 100), true, 'decision lease expires at ~7Hz');
enemy.health = 0;
nowMs = 142;
assert.equal(companionAI.shouldReevaluate(pet, master, 'town', 100), true, 'death immediately invalidates target regardless of lease');
assert.equal(companionAI.chooseTarget(pet, master, new Set([enemy]), 'town', 100), null);
nowMs = 145;
assert.equal(companionAI.shouldReevaluate(pet, master, 'town', 100), false, 'idle companions also avoid full roster scans between deadlines');
assert.equal(companionAI.shouldReevaluate(pet, master, 'forest', 100), true, 'area transition invalidates target selection immediately');

// The real NPC schedule resolver is wrapped, not replaced by a second planner.
const npcContext = { window: {}, performance, console };
vm.createContext(npcContext);
vm.runInContext(read('docs/js/npc-scheduling.js'), npcContext);
const calendar = { day: 1, time01: .4 }; // Scheduled time and debug jumps are invalidation inputs.
const scheduling = npcContext.window.NpcScheduling;
scheduling.init({ calendar, normalizeNpcArea: x => x });
let decisions = 0; // Provider invocations count expensive destination resolution rather than frame updates.
scheduling.registerTargetOverride('test', () => { decisions++; return { area: 'town', c: 4, r: 5 }; });
const walker = { rec: { id: 'walker', scheduleHooks: { rules: [] } }, area: 'town' };
nowMs = 200;
assert.equal(scheduling.resolveNpcScheduleTargetCached(walker, true).c, 4);
assert.equal(scheduling.resolveNpcScheduleTargetCached(walker, true).c, 4);
assert.equal(decisions, 1, 'same-frame calls share a cached target');
nowMs = 300;
scheduling.resolveNpcScheduleTargetCached(walker, true);
assert.equal(decisions, 1, 'movement frames do not recalculate agenda');
nowMs = 361;
scheduling.resolveNpcScheduleTargetCached(walker, true);
assert.equal(decisions, 2, 'visible NPC agenda refreshes at the decision cadence');
scheduling.registerTargetOverride('test', () => { decisions++; return { area: 'town', c: 6, r: 7 }; });
assert.equal(scheduling.resolveNpcScheduleTargetCached(walker, true).c, 6, 'override registration invalidates immediately');
nowMs = 362;
scheduling.resolveNpcScheduleTargetCached(walker, false);
nowMs = 800;
scheduling.resolveNpcScheduleTargetCached(walker, false);
assert.equal(decisions, 4, 'changing from near to far does not extend a stale near-area decision'); 
nowMs = 810;
calendar.day = 2;
scheduling.resolveNpcScheduleTargetCached(walker, false);
assert.equal(decisions, 5, 'day change invalidates a cached destination');
scheduling.replaceMapNpcStations([{ id: 'test_station', area: 'town', c: 3, r: 2 }], 'town');
scheduling.resolveNpcScheduleTargetCached(walker, false);
assert.equal(decisions, 6, 'registered map stations invalidate previously resolved destinations');
scheduling.replaceMapNpcStations([], 'town');
scheduling.resolveNpcScheduleTargetCached(walker, false);
assert.equal(decisions, 7, 'removing the last station invalidates old destinations');
let floodActive = false; // Simulates the authoritative WaterSystem emergency state, independent of elapsed frames.
npcContext.window.WaterSystem = { isTownFloodEmergency: () => floodActive };
scheduling.resolveNpcScheduleTargetCached(walker, false);
floodActive = true;
scheduling.resolveNpcScheduleTargetCached(walker, false);
assert.equal(decisions, 8, 'flood activation overrides an existing agenda cache immediately');
floodActive = false;
scheduling.resolveNpcScheduleTargetCached(walker, false);
assert.equal(decisions, 9, 'flood recovery resumes normal agendas immediately');

// Movement locks retain the already-normalized lie/seat decision rather than replacing it with an earlier raw schedule.
const lockContext = { window: { CharacterActionLocks: { isLocked(_id, channel) { return channel === 'movement'; } } }, Math };
vm.createContext(lockContext);
vm.runInContext(read('docs/js/npc-character-state.js'), lockContext);
const lockedWalker = {
  rec: { id: 'sleeping' },
  root: { position: { x: 1, y: 0, z: 2 } },
  currentScheduleTarget: { area: 'town', pose: 'lie', activity: 'sleeping' },
  _npcScheduleDecision: { target: { area: 'town', pose: 'stand', activity: 'sleeping' } },
};
assert.equal(lockContext.window.NpcCharacterState.update(lockedWalker, .016, {
  surfaceY: () => 0,
  resolveScheduleTarget() { throw Error('live locked walker must not re-resolve its schedule'); },
}), true, 'the character lock still holds position');
assert.equal(lockedWalker.currentScheduleTarget.pose, 'lie', 'a movement lock cannot remove the normalized sleeping pose');

// The existing NPC beeline collision sweep is used less often, without moving the walker itself.
const game = read('docs/game.js');
const start = game.indexOf('          canBeelineDecision(targetC, targetR, allowOccupiedTarget = false) {');
const end = game.indexOf('          _tryStartGridPath(target) {', start);
assert(start >= 0 && end > start, 'game exposes the walker-local navigation decision method');
const position = { x: 1.5, z: 2.5 }; // Independent mutable position demonstrates movement between decision refreshes.
let sweeps = 0; // Counts real collision sweeps; no cached result can outlive the short time/distance lease.
const nav = vm.runInNewContext('({' + game.slice(start, end) + '}).canBeelineDecision', {
  performance, root: { position }, Math,
  canNpcBeeline: () => { sweeps++; return true; },
});
const movingWalker = { area: 'town' }; // Walker caches only its own recent route decision.
nowMs = 900;
assert.equal(nav.call(movingWalker, 5, 5), true);
position.x += .05;
nowMs = 960;
assert.equal(nav.call(movingWalker, 5, 5), true);
assert.equal(sweeps, 1, 'movement can continue on one recent sweep');
position.x += .15;
assert.equal(nav.call(movingWalker, 5, 5), true);
assert.equal(sweeps, 2, 'sub-tile movement beyond the lease distance rechecks geometry');
nowMs = 1080;
nav.call(movingWalker, 5, 5);
assert.equal(sweeps, 3, 'route decision time deadline triggers a fresh swept check');
movingWalker.area = 'forest';
nav.call(movingWalker, 5, 5);
assert.equal(sweeps, 4, 'area transition invalidates old route geometry');

// Melee HUD reuses the one focused ray, then considers only opponents close to an equipped ability.
const hudSource = read('docs/js/combat/melee-hud-reticle.js');
const hs = hudSource.indexOf('  function targetState(deps, direction, slotProfiles) {');
const he = hudSource.indexOf('\n  function refresh()', hs);
assert(hs >= 0 && he > hs, 'melee HUD target function is present');
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  normalize() { const d = Math.hypot(this.x, this.y, this.z) || 1; this.x /= d; this.y /= d; this.z /= d; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
let focusCalls = 0, hitboxCalls = 0; // Cheap counters verify remote actors do not incur collider construction.
const near = { id: 'near', x: 64, y: 0, health: 100, areaId: 'town' };
const far = { id: 'far', x: 6400, y: 0, health: 100, areaId: 'town' };
const hudContext = {
  THREE: { Vector3 }, Math, performance, OUT_OF_REACH_MARGIN_WORLD: 0.5, // Same outer-scope margin used by the production HUD's extracted function.
  window: { RangedWeapons: {
    actorHitbox(entity) {
      hitboxCalls++;
      return { box: { clampPoint(_origin, output) { output.x = entity.x / 64; output.y = .55; output.z = entity.y / 64; return output; } } };
    },
  }, Combat: { meleeHit: (_player, entity) => ({ hit: entity === near }) } },
};
const targetState = vm.runInNewContext('(' + hudSource.slice(hs, he) + ')', hudContext);
let rosterScans = 0; // Counts full-hostile iteration by the actual HUD decision path.
const roster = new Set([far, near]);
const originalRosterIterator = roster[Symbol.iterator]; // Retains the real Set semantics while recording each discovery pass.
roster[Symbol.iterator] = function* () { rosterScans++; yield* originalRosterIterator.call(this); };
const deps = { TILE: 64, player: { x: 0, y: 0 }, getCurrentArea: () => 'town',
  getMeleeReticleTarget: () => { focusCalls++; return near; }, hostileObjects: roster };
const profile = [{ slotId: 'tap1', attackId: 'combo', reachPx: 90, halfConeRad: Math.PI / 3 }];
assert.equal(targetState(deps, { x: 1, y: 0, z: 0 }, profile).target, 'near');
assert.equal(focusCalls, 1, 'the same interaction ray is not searched twice');
assert.equal(hitboxCalls, 1, 'distant actors never receive full 3D reach checks');
assert.equal(rosterScans, 1, 'initial discovery examines the roster once');
assert.equal(targetState(deps, { x: 1, y: 0, z: 0 }, profile).target, 'near', 'per-frame melee readiness still uses the cached local target');
assert.equal(rosterScans, 1, 'stationary actor discovery does not scan every enemy on every render frame');
assert.equal(focusCalls, 1, 'the interaction ray itself is also cached across stationary frames');
deps.getMeleeReticleTarget = () => null;
nowMs += 81;
assert.equal(targetState(deps, { x: 1, y: 0, z: 0 }, profile).target, 'near', 'off-ray but reachable enemies still count after a fresh discovery');
assert.equal(rosterScans, 2, 'expired discovery lease triggers another roster scan');
deps.player.x += 64 * .2;
assert.equal(targetState(deps, { x: 1, y: 0, z: 0 }, profile).target, 'near', 'player movement invalidates cached neighborhood without a wait');
assert.equal(rosterScans, 3, 'moving toward combat immediately refreshes the neighborhood');
nowMs += 81;
deps.player.x = 0;
targetState(deps, { x: 1, y: 0, z: 0 }, profile);
near.health = 0;
assert.equal(targetState(deps, { x: 1, y: 0, z: 0 }, profile).target, null, 'dead enemies are rejected on this frame even with a cached candidate list');
console.log('actor decision/execution separation tests passed');
