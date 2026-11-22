#!/usr/bin/env node
'use strict';
const assert = require('assert');
globalThis.window = globalThis;
const T = require('../docs/js/targetables.js');
globalThis.Targetables = T;
const LT = require('../docs/js/lunge-targeting.js');

const probes = [];
globalThis.Combat = { meleeHit: (attacker, target, opts) => { probes.push({ id: target.id, opts }); return !!target.hit; } };
const player = { lungeDirX: 0, lungeDirY: -1, lungeAimPitch: 0.2, x: 0, y: 0 };
let hostiles = [], area = 'mapA';
LT.init({ player, getHostiles: () => hostiles, getCurrentArea: () => area });
const cone = { rangePx: 80, halfConeRad: 0.6 };
const reset = () => { probes.length = 0; };

// no cone, nothing to hit
assert.equal(LT.hasTargetInCone(null), false);
assert.equal(LT.hasTargetInCone(cone), false);

// hostiles behave exactly as the original game.js function did
hostiles = [{ id: 'dead', health: 0, areaId: 'mapA' }, { id: 'away', health: 5, areaId: 'mapB' }, { id: 'hidden', health: 5, areaId: 'mapA', _denHidden: true }, { id: 'live', health: 5, areaId: 'mapA', hit: true }];
reset();
assert.equal(LT.hasTargetInCone(cone), true);
assert.deepEqual(probes.map(p => p.id), ['live'], 'dead, other-area and hidden hostiles are skipped without a probe');
assert.deepEqual(probes[0].opts, { rangePx: 80, halfConeRad: 0.6, yaw: Math.atan2(-1, 0), pitch: 0.2 }, 'the same probe options the original built (and no debug flag, so debug colliders still record)');

// with no hostile hit, only 'lungeStop' targetables count
hostiles = [{ id: 'live', health: 5, areaId: 'mapA', hit: false }];
T.clear();
T.register({ id: 'plain', scope: 'mapA', caps: [T.CAPS.BURDEN], hit: true });
reset();
assert.equal(LT.hasTargetInCone(cone), false, 'a burden without lungeStop does not stop a lunge: existing gameplay unchanged');
assert.deepEqual(probes.map(p => p.id), ['live'], 'and is never probed');
const rope = T.register({ id: 'rope-bomb', scope: 'mapA', caps: [T.CAPS.BURDEN, T.CAPS.LUNGE_STOP] });
rope.toActor().hit = true;
reset();
assert.equal(LT.hasTargetInCone(cone), true, 'opting in makes it stop the lunge like an enemy');
assert.deepEqual(probes.map(p => p.id), ['live', 'rope-bomb']);
assert.equal(probes[1].opts.debug, false, 'targetable probes do not spam debug colliders');
assert.equal(probes[1].opts.yaw, probes[0].opts.yaw);
area = 'mapB'; hostiles = [];
reset();
assert.equal(LT.hasTargetInCone(cone), false, 'a lunge-stop target in another map does not count');

// Lunge contact also commits the shared object AOE, once per lunge, not once per frame.
const impacts = [];
globalThis.Shattercasks = { sweepMelee: opts => impacts.push(opts) };
globalThis.CratePiles = { hasLungeTarget: () => true };
area = 'mapA'; hostiles = []; T.clear();
player.lunging = true;
player.lungeOriginMs = 1001;
assert.equal(LT.hasTargetInCone(cone), true, 'a crate inside the melee cone stops the lunge');
assert.equal(impacts.length, 1, 'crate contact invokes the existing destructible melee pass');
assert.equal(impacts[0].actor, player);
assert.equal(impacts[0].lungeContact, true);
assert.equal(impacts[0].targetBurden, null);
LT.hasTargetInCone(cone);
assert.equal(impacts.length, 1, 'repeated movement probes do not shatter a second crate');
player.lungeOriginMs = 1002;
LT.hasTargetInCone(cone);
assert.equal(impacts.length, 2, 'a new lunge may hit another crate');
globalThis.CratePiles.hasLungeTarget = () => false;
const suspended = { id: 'suspended' };
const hangingEntry = T.register({ id: 'hanging', scope: 'mapA', owner: suspended, caps: [T.CAPS.LUNGE_STOP] });
hangingEntry.toActor().hit = true;
player.lungeOriginMs = 1003;
assert.equal(LT.hasTargetInCone(cone), true);
assert.equal(impacts.length, 3);
assert.equal(impacts[2].targetBurden, suspended, 'the precise hanging-burden target reaches the impact handler');
player.lunging = false;
player.lungeOriginMs = 1004;
LT.hasTargetInCone(cone);
assert.equal(impacts.length, 3, 'non-lunge targeting probes never cause object damage');
T.clear();
player.lunging = true;
hostiles = [{ id:'foe', health:5, areaId:'mapA', hit:true }];
player.lungeOriginMs = 1005;
assert.equal(LT.hasTargetInCone(cone), true);
assert.equal(impacts.length, 4, 'the same AOE can hit props when the lunge stops on an enemy');
hostiles = [];
player.lungeOriginMs = 1006;
assert.equal(LT.hasTargetInCone(cone), false);
assert.equal(impacts.length, 4, 'empty cones cannot generate object impacts');

// uninitialised use is safe
delete require.cache[require.resolve('../docs/js/lunge-targeting.js')];
const fresh = require('../docs/js/lunge-targeting.js');
assert.notEqual(fresh, LT, 'a genuinely fresh instance');
assert.equal(fresh.hasTargetInCone(cone), false, 'before init() there is nothing to test against, and it must not throw');
console.log('lunge-targeting: ok');
