#!/usr/bin/env node
'use strict';
const assert = require('assert');
const T = require('../docs/js/targetables.js');
const { CAPS } = T;

// registration, scope and capability filtering
T.clear();
const box = { box: { id: 'b' }, center: { id: 'c' } };
const a = T.register({ id: 'a', scope: 'mapA', caps: [CAPS.BURDEN, CAPS.LUNGE_STOP], hitbox: () => box });
T.register({ id: 'b', scope: 'mapA', caps: [CAPS.BURDEN] });
T.register({ id: 'c', scope: 'mapB', caps: [CAPS.LUNGE_STOP] });
T.register({ id: 'any', caps: [CAPS.LUNGE_STOP] }); // no scope = visible everywhere
assert.deepEqual(T.query('mapA', CAPS.BURDEN).map(e => e.id), ['a', 'b']);
assert.deepEqual(T.query('mapA', CAPS.LUNGE_STOP).map(e => e.id), ['a', 'any']);
assert.deepEqual(T.query('mapB', CAPS.LUNGE_STOP).map(e => e.id), ['c', 'any']);
assert.deepEqual(T.query('mapC', CAPS.BURDEN), [], 'other scopes see nothing');
assert.equal(T.query('mapA', null).length, 3, 'no capability filter returns all in scope');
assert.throws(() => T.register({}), /requires an id/);

// unregister only removes the entry it belongs to
assert.equal(a.unregister(), true); assert.equal(a.unregister(), false);
const again = T.register({ id: 'a', scope: 'mapA', caps: [] });
assert.equal(T.query('mapA', CAPS.BURDEN).some(e => e.id === 'a'), false);
assert.equal(again.unregister(), true);

// sources: lazily provided, dynamic capabilities, failures isolated
T.clear();
const live = { id: 's1', scope: 'mapA', hasCap: c => c === CAPS.BURDEN || (c === CAPS.LUNGE_STOP && live.rope) , hitbox: () => box, toActor() { return { id: 's1' }; } }; live.rope = false;
T.addSource('burdens', scope => (scope === 'mapA' ? [live] : []));
assert.deepEqual(T.query('mapA', CAPS.LUNGE_STOP), [], 'capability is read live: not lunge-stoppable yet');
live.rope = true;
assert.deepEqual(T.query('mapA', CAPS.LUNGE_STOP).map(e => e.id), ['s1'], 'now it opts in');
const warn = console.warn; console.warn = () => {};
T.addSource('broken', () => { throw new Error('x'); });
assert.equal(T.query('mapA', CAPS.BURDEN).length, 1, 'a throwing source does not hide the others'); console.warn = warn;
const stopped = T.forEach('mapA', null, e => e.id === 's1'); assert.equal(stopped.id, 's1', 'returning true stops and yields the entry');

// stand-in actor: position in px for the fallback path, hitbox through the hook
T.clear();
const e = T.register({ id: 'p', scope: 'm', caps: [CAPS.LUNGE_STOP], hitbox: () => box, position: () => ({ x: 2, z: 3 }) });
const actor = e.toActor();
assert.equal(e.toActor(), actor, 'stand-in actor is created once');
assert.equal(actor.__targetableHitbox(), box); assert.equal(actor.x, 2 * 64); assert.equal(actor.y, 3 * 64); assert.equal(actor.areaId, 'm');
assert.equal(actor.health, 1, 'alive, so combat code does not skip it');

// firstInCone uses the injected melee test, once per candidate, with the probe options
T.clear();
const probes = [];
T.setMeleeHit((attacker, target, opts) => { probes.push([attacker, target.id, opts]); return target.id === 'hit'; });
T.register({ id: 'miss', scope: 'm', caps: [CAPS.LUNGE_STOP] });
T.register({ id: 'hit', scope: 'm', caps: [CAPS.LUNGE_STOP] });
T.register({ id: 'wrongcap', scope: 'm', caps: [CAPS.BURDEN] });
const who = {};
const found = T.firstInCone(who, { rangePx: 90, halfConeRad: 0.5, yaw: 1, pitch: 0 }, CAPS.LUNGE_STOP, 'm');
assert.equal(found.id, 'hit');
assert.deepEqual(probes.map(p => p[1]), ['miss', 'hit'], 'candidates without the capability are never probed; stops at the first hit');
assert.equal(probes[0][0], who); assert.deepEqual(probes[0][2], { rangePx: 90, halfConeRad: 0.5, yaw: 1, pitch: 0, debug: false }, 'probes skip debug collider recording');
assert.equal(T.firstInCone(who, {}, CAPS.LUNGE_STOP, 'other'), null);
T.setMeleeHit(null);
assert.equal(T.firstInCone(who, {}, CAPS.LUNGE_STOP, 'm'), null, 'no melee test available means no hit, never a throw');
assert.equal(T.debugSnapshot().registered, 3);
console.log('targetables: ok');
