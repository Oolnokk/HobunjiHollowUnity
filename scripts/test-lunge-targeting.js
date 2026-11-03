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

// uninitialised use is safe
delete require.cache[require.resolve('../docs/js/lunge-targeting.js')];
const fresh = require('../docs/js/lunge-targeting.js');
assert.notEqual(fresh, LT, 'a genuinely fresh instance');
assert.equal(fresh.hasTargetInCone(cone), false, 'before init() there is nothing to test against, and it must not throw');
console.log('lunge-targeting: ok');
