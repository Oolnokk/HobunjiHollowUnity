#!/usr/bin/env node
'use strict';
// Runs the real furniture-puzzle-properties.js, furniture-puzzle-runtime.js and world-events.js:
// a mechanism or activator reacts to WorldEvents through its `puzzle.inputs`, no wire needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');

// ---- the few THREE pieces applyMechanism touches ----
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
}
class Quaternion { clone() { return new Quaternion(); } copy() { return this; } multiply() { return this; } setFromEuler() { return this; } }
class Euler { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
class Color { constructor(v) { this.v = v; } lerp() { return this; } copy() { return this; } }
class Box3 {
  constructor() { this.min = new Vector3(); this.max = new Vector3(); }
  setFromObject(mesh) { this.min.copy(mesh.testBox.min); this.max.copy(mesh.testBox.max); return this; }
}
class Raycaster {
  set(origin) { this.origin = origin.clone(); }
  intersectObject(mesh) { return mesh.testHitY == null ? [] : [{point:{x:this.origin.x,y:mesh.testHitY,z:this.origin.z}}]; }
}
const THREE = { Vector3, Quaternion, Euler, Color, Box3, Raycaster, MathUtils: { lerp: (a, b, t) => a + (b - a) * t } };

const timers = [], frames = [];
// requestAnimationFrame only queues: the runtime's emitter loop re-arms itself every frame, and zero-duration motions need no frames.
const context = { console, THREE, performance, requestAnimationFrame: fn => frames.push(fn), setTimeout: (fn, ms) => timers.push({ fn, ms }) };
context.window = context;
const registeredSurfaces = new Map(); // A narrow DynamicSurfaces spy validates registration, queries and cleanup without rendering.
context.DynamicSurfaces = {
  registerSurface(definition) { registeredSurfaces.set(definition.id, definition); },
  remove(id) { return registeredSurfaces.delete(id); },
};
vm.createContext(context);
for (const f of ['js/world-events.js', 'js/furniture-puzzle-properties.js', 'js/furniture-puzzle-runtime.js']) vm.runInContext(read(f), context, { filename: f });
const { WorldEvents, FurniturePuzzleProperties: P, FurniturePuzzleRuntime: R } = context;

// ---------------------------------------------------------------- schema
const N = raw => JSON.parse(JSON.stringify(P.normalizeInputs(raw))); // JSON: copy out of the vm realm
assert.deepEqual(N(undefined), []); assert.deepEqual(N('x'), []);
assert.deepEqual(N([{}]), [{ event: 'blast', withinTiles: null, targetId: '', tag: '', action: 'on', once: false, delaySeconds: 0 }], 'defaults');
assert.deepEqual(N([{ event: 'Struck', withinTiles: '2.5', targetId: 'self', tag: 'fire', action: 'toggle', once: 1, delaySeconds: -3 }]),
  [{ event: 'struck', withinTiles: 2.5, targetId: 'self', tag: 'fire', action: 'toggle', once: true, delaySeconds: 0 }], 'normalised and clamped');
assert.equal(N([{ event: 'bad event!' }, null, 5, { event: 'ok' }]).length, 1, 'invalid entries are dropped');
assert.equal(N([{ withinTiles: -1 }])[0].withinTiles, null, 'negative distances are ignored');
assert.equal(N([{ action: 'explode' }])[0].action, 'on');
assert.equal(N(Array.from({ length: 20 }, () => ({}))).length, 8, 'at most 8 inputs per node');
const withInputs = P.normalizePuzzle({ role: 'mechanism', behavior: 'toggle', inputs: [{ event: 'blast' }] });
assert.equal(withInputs.inputs.length, 1); assert.equal(withInputs.version, 3, 'additive: still a v3 puzzle');
assert.equal(P.normalizePuzzle({ role: 'mechanism' }).inputs.length, 0, 'existing puzzles are unaffected');

// ---------------------------------------------------------------- fake nodes
const MAP = 'map_i_test_ruin';
function node(id, puzzle, at = { x: 10, y: 0, z: 10 }) {
  return {
    id, position: new Vector3(at.x, at.y, at.z), quaternion: new Quaternion(), scale: new Vector3(1, 1, 1), userData: {},
    traverse() {}, updateWorldMatrix() {}, getWorldPosition(t) { return t.set(this.position.x, this.position.y, this.position.z); },
    _puzzle: puzzle,
  };
}
const motion = { durationSeconds: 0, off: { position: { x: 0, y: 0, z: 0 } }, on: { position: { x: 0, y: -2, z: 0 } } };
function register(n, mapId = MAP) { return R.registerNode(mapId, { id: n.id, puzzle: n._puzzle }, n); }
const mech = (inputs, extra = {}) => ({ role: 'mechanism', behavior: 'toggle', motion, inputs, ...extra });
const on = n => !!n.userData.puzzleActive, y = n => n.position.y;
// Runs queued animation frames with a clock far past any duration; bounded because the emitter loop re-arms itself.
const flush = () => { for (let i = 0; i < 3; i++) for (const f of frames.splice(0)) f(performance.now() + 1e7); };

// ---------------------------------------------------------------- a blast topples a cracked pillar
const bridge = JSON.parse(read('config/furniture-authored/ruinPillarBridge.json')); // Exercise the authored blast input and motion.
const pillar = node('pillar', bridge.puzzle);
const bridgePart = bridge.parts.find(part => part.id === bridge.puzzle.standingSurface.partId); // The same rendered upper shaft that falls into the gap.
assert(bridgePart && bridge.puzzle.standingSurface.minProgress >= .9, 'the bridge opts into standing on its settled upper shaft');
const partMesh = {
  position:new Vector3(), rotation:{set(){}}, scale:new Vector3(1,1,1), updateMatrixWorld(){}, updateWorldMatrix(){},
  testBox:{min:new Vector3(9.6,0,9.6),max:new Vector3(10.4,1,10.4)}, testHitY:.32,
};
pillar.userData.meshById = new Map([[bridgePart.id, partMesh]]);
pillar.userData.partById = new Map([[bridgePart.id, bridgePart]]);
assert.equal(register(pillar), true);
const bridgeSupportId = pillar.userData.puzzleStandingSurfaceId; // Must remain attached to this exact pillar instance until it is unregistered.
const bridgeSurface = registeredSurfaces.get(bridgeSupportId);
assert(bridgeSurface && !bridgeSurface.enabled(), 'upright pillar is not already a floor over the chasm');
assert.equal(WorldEvents.listenerCount('blast'), 1, 'one subscription for one input');
assert.equal(on(pillar), false);

WorldEvents.emit('blast', { scope: MAP, x: 10, z: 20, radius: 4.4 });           // 10 tiles away, radius 4.4: out of reach
assert.equal(on(pillar), false, 'a blast outside the authored trigger distance does nothing');
WorldEvents.emit('blast', { scope: 'some_other_map', x: 10, z: 10, radius: 4.4 });
assert.equal(on(pillar), false, 'a blast in another map does nothing');
WorldEvents.emit('blast', { scope: MAP, x: 12, z: 11, radius: 4.4 });           // ~2.2 tiles away: in reach
assert.equal(on(pillar), true, 'a blast whose radius reaches the node turns the mechanism on');
flush();
assert.equal(pillar.userData.puzzleProgress, 1); assert(Math.abs(y(pillar) - bridge.puzzle.motion.on.position.y) < 1e-9, 'the authored on-keyframe plays through the real runtime');
assert.equal(pillar.userData.blocksMovement, false, 'the toppled pillar clears its upright blocker');
assert(bridgeSurface.enabled(), 'after the fall the real upper-shaft mesh becomes walkable');
assert(bridgeSurface.supports(10,10), 'vertical ray intersects the fallen authored bridge');
assert(Math.abs(bridgeSurface.topY()- .33) < 1e-9, 'standing height comes from the surface hit plus authored offset');
assert(!bridgeSurface.supports(100,100), 'outside the actual bridge bounds has no support');
assert.equal(WorldEvents.listenerCount('blast'), 0, 'once: the subscription is released after it fires');

// ---------------------------------------------------------------- conditions
const gated = node('gated', mech([{ event: 'blast', withinTiles: 1, tag: 'fire' }]));
register(gated);
WorldEvents.emit('blast', { scope: MAP, x: 11.5, z: 10, radius: 9, tag: 'fire' }); assert.equal(on(gated), false, 'withinTiles overrides the blast radius: 1.5 > 1');
WorldEvents.emit('blast', { scope: MAP, x: 10.5, z: 10, radius: 0.1, tag: 'blunt' }); assert.equal(on(gated), false, 'tag must match');
WorldEvents.emit('blast', { scope: MAP, x: 10.5, z: 10, radius: 0.1, tag: 'fire' }); assert.equal(on(gated), true, 'close enough and the right tag');
R.unregisterNode(MAP, 'gated');

const needsPosition = node('needsPosition', mech([{ event: 'struck', withinTiles: 3 }]));
register(needsPosition);
WorldEvents.emit('struck', { scope: MAP, targetId: 'x' }); assert.equal(on(needsPosition), false, 'a distance condition cannot be met by an event with no position');
R.unregisterNode(MAP, 'needsPosition');

// ---------------------------------------------------------------- targetId / struck
const door = node('door', mech([{ event: 'struck', targetId: 'self', action: 'toggle' }]));
register(door);
WorldEvents.emit('struck', { scope: MAP, targetId: 'other' }); assert.equal(on(door), false, 'struck events about other targets are ignored');
WorldEvents.emit('struck', { scope: MAP, targetId: 'door' }); assert.equal(on(door), true, "targetId 'self' matches this node's own id");
WorldEvents.emit('struck', { scope: MAP, targetId: 'door' }); assert.equal(on(door), false, 'toggle flips it back');
R.unregisterNode(MAP, 'door');

// ---------------------------------------------------------------- actions, delay
const lit = node('lit', mech([{ event: 'blast', action: 'off' }], { startsActive: true }));
register(lit);
assert.equal(on(lit), true);
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 }); assert.equal(on(lit), false, "action 'off' turns an active mechanism off");
R.unregisterNode(MAP, 'lit');

timers.length = 0;
const slow = node('slow', mech([{ event: 'blast', delaySeconds: 2 }]));
register(slow);
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 });
assert.equal(on(slow), false, 'a delayed input has not acted yet'); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 2000);
timers[0].fn(); assert.equal(on(slow), true, 'and acts when the delay elapses');
R.unregisterNode(MAP, 'slow');

// Delayed inputs must not act on a replacement node after a reroll.
timers.length = 0;
const stale = node('reused', mech([{ event: 'blast', delaySeconds: 2 }]));
register(stale);
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 });
assert.equal(timers.length, 1, 'the original node queued its delayed event');
R.unregisterNode(MAP, 'reused');
const fresh = node('reused', mech([]));
register(fresh);
timers[0].fn();
assert.equal(on(fresh), false, 'an old delayed event cannot activate a fresh node with the same id');
assert.equal(on(stale), false, 'the removed node stays inactive');
R.unregisterNode(MAP, 'reused');

timers.length = 0;
const reRegistered = node('reRegistered', mech([{event:'blast',delaySeconds:2}]));
register(reRegistered);
WorldEvents.emit('blast', {scope:MAP,x:10,z:10,radius:1});
assert.equal(timers.length,1);
register(reRegistered); // Same rendered object, but a new puzzle registration and generation.
timers[0].fn();
assert.equal(on(reRegistered),false,'a queued input cannot cross even a same-object re-registration');
R.unregisterNode(MAP, 'reRegistered');

// Registering a new object under the same id must replace its subscriptions, not stack them.
const oldObject = node('swapped', mech([{ event: 'blast' }]));
register(oldObject);
const beforeReplace = WorldEvents.listenerCount('blast');
const newObject = node('swapped', mech([{ event: 'blast' }]));
register(newObject);
assert.equal(WorldEvents.listenerCount('blast'), beforeReplace, 'replacing a puzzle object retires its prior listener');
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 });
assert.equal(on(oldObject), false, 'replaced object never receives the blast');
assert.equal(on(newObject), true, 'replacement object alone receives the blast');
R.unregisterNode(MAP, 'swapped');
R.unregisterNode(MAP, 'pillar');
assert(!registeredSurfaces.has(bridgeSupportId), 'removing the bridge also removes its dynamic standing surface');

// ---------------------------------------------------------------- activators drive their wired mechanisms
const sensor = node('sensor', { role: 'activator', behavior: 'interact', inputs: [{ event: 'blast' }] });
const gate = node('gate', mech([]));
register(sensor); register(gate);
R.registerMap(MAP + '_wired', [{ id: 'sensor', puzzle: sensor._puzzle }, { id: 'gate', puzzle: gate._puzzle }], new Map([['sensor', sensor], ['gate', gate]]), [{ fromId: 'sensor', toId: 'gate' }]);
WorldEvents.emit('blast', { scope: MAP + '_wired', x: 10, z: 10, radius: 1 });
assert.equal(on(sensor), true, 'an activator with an event input fires');
assert.equal(on(gate), true, 'and its wired mechanism follows');
R.unregisterNode(MAP, 'sensor'); R.unregisterNode(MAP, 'gate');

// Delayed wiring must not start an animation after the entire ruin map was cleared.
timers.length = 0;
const delayedMap = MAP + '_delayed_wire';
const delayedSource = node('source', {role:'activator',behavior:'interact'});
const delayedGate = node('target', mech([]));
R.registerMap(delayedMap, [
  {id:'source',puzzle:delayedSource._puzzle},
  {id:'target',puzzle:delayedGate._puzzle},
],new Map([['source',delayedSource],['target',delayedGate]]),[{fromId:'source',toId:'target',delaySeconds:2}]);
R.activate(delayedMap,'source',true);
assert.equal(timers.length,1);
R.clearMap(delayedMap);
timers[0].fn();
assert.equal(on(delayedGate),false,'a delayed wire cannot animate an already removed mechanism');

// ---------------------------------------------------------------- lifecycle: no leaks, no duplicates
const base = WorldEvents.listenerCount('blast') + WorldEvents.listenerCount('struck');
const twice = node('twice', mech([{ event: 'blast' }]));
register(twice); register(twice);
assert.equal(WorldEvents.listenerCount('blast'), base + 1, 're-registering the same node does not stack listeners');
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 }); assert.equal(on(twice), true);
R.unregisterNode(MAP, 'twice');
assert.equal(WorldEvents.listenerCount('blast'), base, 'unregistering releases the subscription');
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 });

const bulkA = node('bulkA', mech([{ event: 'blast' }]));
R.registerMap(MAP + '_bulk', [{ id: 'bulkA', puzzle: bulkA._puzzle }], new Map([['bulkA', bulkA]]), []);
assert.equal(WorldEvents.listenerCount('blast'), base + 1);
R.registerMap(MAP + '_bulk', [], new Map(), []);
assert.equal(WorldEvents.listenerCount('blast'), base, 're-registering a map releases the old nodes\' subscriptions');

// ---------------------------------------------------------------- ruin teardown clears both map subscriptions and physical support
{
  const mapId = MAP + '_reroll', old = node('old-pillar', bridge.puzzle);
  old.userData.meshById = new Map([[bridgePart.id, partMesh]]);
  old.userData.partById = new Map([[bridgePart.id, bridgePart]]);
  register(old, mapId);
  const surfaceId = old.userData.puzzleStandingSurfaceId; // Map removal must free surfaces registered outside the ruin scene's ordinary scope.
  assert(registeredSurfaces.has(surfaceId));
  const oldBlastCount = WorldEvents.listenerCount('blast');
  assert.equal(R.clearMap(mapId), 1, 'a map teardown removes its registered mechanism');
  assert.equal(WorldEvents.listenerCount('blast'), oldBlastCount - 1, 'a map teardown also unbinds its events');
  assert(!registeredSurfaces.has(surfaceId), 'no dangling support may survive into the next generated ruin');
  assert.equal(R.getNode(mapId,'old-pillar'), null);
  assert.equal(R.clearMap(mapId), 0, 'teardown is idempotent');
}

// ---------------------------------------------------------------- debug + isolation
const dbg = node('dbg', mech([{ event: 'blast' }, { event: 'struck' }]));
register(dbg);
assert.equal(JSON.parse(JSON.stringify(R.debug())).flatMap(m => m.nodes).find(n => n.id === 'dbg').inputs, 2, 'debug reports input counts');
R.unregisterNode(MAP, 'dbg');
const warn = console.warn; console.warn = () => {};
const bad = node('bad', mech([{ event: 'blast' }])); register(bad);
bad.getWorldPosition = () => { throw new Error('boom'); };
const good = node('good', mech([{ event: 'blast' }])); register(good);
WorldEvents.emit('blast', { scope: MAP, x: 10, z: 10, radius: 1 });
console.warn = warn;
assert.equal(on(good), true, 'one node failing does not stop the others from reacting');
console.log('puzzle-event-inputs: ok');
