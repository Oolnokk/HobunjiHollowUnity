#!/usr/bin/env node
'use strict';
// RemoteAreaTick stage 1: opt-in, co-op only, coarse, only occupied zones that already have a scene,
// and it can never leave currentArea swapped.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ctx = { window: { location: { search: '' } }, performance: { now: () => 0 }, console, URLSearchParams };
vm.createContext(ctx);
for (const f of ['actor-registry', 'time-consensus', 'remote-area-tick']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const w = ctx.window, reg = w.ActorRegistry, rat = w.RemoteAreaTick;

// A faithful stand-in for game.js's AreaScope (same rules: built zones only, swap + restore in a finally).
let currentArea = 'map_a', depth = 0, listener = null;
const built = new Set(['map_a', 'map_b']);
w.AreaScope = {
  hasScene: a => a === currentArea || built.has(a),
  with(area, fn) {
    if (area === currentArea) return fn();
    if (!built.has(area)) return undefined;
    const saved = currentArea; if (depth === 0) listener = saved; depth++; currentArea = area;
    try { return fn(); } finally { currentArea = saved; if (--depth === 0) listener = null; }
  },
  listenerArea: () => listener ?? currentArea,
};
reg.setLocalAreaResolver(() => w.AreaScope.listenerArea());
const ticks = [], order = [];
rat.init({ getCurrentArea: () => currentArea,
  tickPre: dt => { order.push('pre:' + currentArea); },
  tickHostiles: dt => { order.push('hostiles:' + currentArea); ticks.push({ area: currentArea, dt: +dt.toFixed(3), listener: w.AreaScope.listenerArea() }); } });

const host = { x: 0, y: 0, health: 100 };
reg.registerPlayer(host, { local: true });
const guest = { x: 0, y: 0, health: 100, areaId: 'map_b' };

// Off by default; and a no-op in single player even when enabled.
assert.equal(rat.isEnabled(), false);
rat.update(1);
assert.equal(ticks.length, 0, 'disabled by default');
rat.setEnabled(true);
rat.update(1);
assert.equal(ticks.length, 0, 'single player: nothing to do even when enabled');

// Co-op with a guest in another built zone.
reg.registerPlayer(guest, { playerId: 'g' });
assert.deepEqual(Array.from(rat.targetAreas()), ['map_b'], 'only occupied areas other than the local one');
rat.update(0.05); rat.update(0.05);
assert.equal(ticks.length, 0, 'coarse: waits for the 5 Hz interval');
rat.update(0.11);
assert.equal(ticks.length, 1);
assert.equal(ticks[0].area, 'map_b', 'the tick ran with currentArea swapped to the guest zone');
assert.equal(ticks[0].listener, 'map_a', 'while the listener (audio, local player) stays in the real area');
assert.equal(ticks[0].dt, 0.21, 'the skipped time is accumulated into one step');
assert.equal(currentArea, 'map_a', 'currentArea is restored');
assert.equal(reg.areaOf(host), 'map_a');
assert.deepEqual(Array.from(order), ['pre:map_b', 'hostiles:map_b'], 'the bandit sleep/wake pass runs first, in the same scoped area, then the hostile tick');

// During the scoped tick the local player is NOT in the guest's zone (so zone creatures cannot target them).
let seenLocalArea = null, seenPlayers = null;
rat.init({ getCurrentArea: () => currentArea, tickHostiles: () => { seenLocalArea = reg.areaOf(host); seenPlayers = Array.from(reg.playersInArea(currentArea)); } });
rat.update(1);
assert.equal(seenLocalArea, 'map_a');
assert.deepEqual(seenPlayers, [guest], 'a remote-area tick sees only the players actually in that area');

// Cap on a long stall.
ticks.length = 0;
rat.init({ getCurrentArea: () => currentArea, tickHostiles: dt => ticks.push({ dt }) });
rat.update(30);
assert.equal(ticks[0].dt, 0.6, 'a long stall is capped');

// Never builds or ticks an unbuilt zone.
guest.areaId = 'map_unbuilt';
ticks.length = 0;
rat.update(1);
assert.equal(ticks.length, 0);
assert.equal(rat.getDebug().skippedUnbuilt >= 1, true);

// A throwing tick is contained and the area is still restored.
guest.areaId = 'map_b';
rat.init({ getCurrentArea: () => currentArea, tickHostiles: () => { throw new Error('boom'); } });
const warn = ctx.console.warn; ctx.console.warn = () => {};
rat.update(1);
ctx.console.warn = warn;
assert.equal(rat.getDebug().errors, 1);
assert.equal(currentArea, 'map_a', 'a failed tick still restores the area');

// The guest in the local zone is not a remote area.
guest.areaId = 'map_a';
ticks.length = 0;
rat.init({ getCurrentArea: () => currentArea, tickHostiles: () => ticks.push(1) });
rat.update(1);
assert.equal(ticks.length, 0, 'players in the local area are ticked by the normal loop');

// Stage 3: an occupied zone nobody built is announced, painted, then built (one at a time, calm only), populated and ticked.
{
  const buildLog = [], popLog = [], announced = [];
  let throwOnBuild = false;
  w.AreaScope.ensureScene = a => { if (throwOnBuild) throw new Error('build boom'); buildLog.push(a); built.add(a); return true; };
  let queue = [];
  w.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  const nextFrame = () => { const run = queue; queue = []; for (const cb of run) cb(); };
  let calm = false;
  guest.areaId = 'map_new1'; ticks.length = 0;
  rat.init({ getCurrentArea: () => currentArea, isCalm: () => calm,
    announce: a => announced.push(a),
    populate: () => { popLog.push(currentArea); return true; },
    tickHostiles: () => ticks.push(currentArea) });
  rat.update(1);
  assert.deepEqual(announced, [], 'not announced or built while the host is not calm (cutscene/paused/dialogue)');
  assert.equal(queue.length, 0);
  calm = true;
  rat.update(1);
  assert.deepEqual(Array.from(announced), ['map_new1'], 'the notice goes out first');
  assert.deepEqual(buildLog, [], 'the blocking build never runs inside the update itself');
  assert.equal(rat.isBuilding(), true);
  nextFrame();
  assert.deepEqual(buildLog, [], 'one painted frame is not enough: the notice must be on screen');
  nextFrame();
  assert.deepEqual(buildLog, ['map_new1'], 'built after two frames');
  assert.equal(rat.isBuilding(), false);
  rat.update(1);
  assert.deepEqual(Array.from(popLog), ['map_new1'], 'populated on the first scoped tick after the build');
  assert.deepEqual(Array.from(ticks), ['map_new1']);
  rat.update(1);
  assert.deepEqual(buildLog, ['map_new1'], 'built exactly once');
  assert.equal(currentArea, 'map_a', 'building never moves the local area');

  // Two unbuilt zones at once: one build in flight at a time.
  const g2 = { x: 0, y: 0, health: 100, areaId: 'map_new2' };
  reg.registerPlayer(g2, { playerId: 'g2' });
  buildLog.length = 0; announced.length = 0; guest.areaId = 'map_new3';
  rat.update(1);
  assert.equal(announced.length, 1, 'only one zone is announced/built at a time');
  rat.update(1);
  assert.equal(announced.length, 1, 'the second waits while the first is in flight');
  nextFrame(); nextFrame();
  assert.equal(buildLog.length, 1);
  rat.update(1);
  assert.equal(announced.length, 2, 'the next zone starts once the first finished');
  nextFrame(); nextFrame();
  assert.equal(buildLog.length, 2);
  reg.unregisterPlayer(g2);

  // A host that never gets a calm moment still builds after the bounded wait.
  calm = false; built.delete('map_new1'); guest.areaId = 'map_new1'; announced.length = 0; buildLog.length = 0;
  for (let i = 0; i < 33; i++) rat.update(1); // each update advances at most 0.6 s: 33 x 0.6 = 19.8 s
  assert.equal(announced.length, 0, 'still waiting for a calm moment');
  rat.update(1);
  assert.equal(announced.length, 1, 'built anyway after the 20 s cap');
  nextFrame(); nextFrame();
  assert.deepEqual(buildLog, ['map_new1']);

  // A failing build is contained and does not wedge the builder.
  built.delete('map_new1'); announced.length = 0; calm = true; throwOnBuild = true;
  const warn2 = ctx.console.warn; ctx.console.warn = () => {};
  const errorsBefore = rat.getDebug().errors;
  rat.update(1); nextFrame(); nextFrame();
  ctx.console.warn = warn2;
  assert.equal(rat.getDebug().errors, errorsBefore + 1);
  assert.equal(rat.isBuilding(), false, 'a failed build releases the in-flight flag');
  throwOnBuild = false;
  rat.update(1); nextFrame(); nextFrame();
  assert.ok(built.has('map_new1'), 'and the next attempt can succeed');

  // Without requestAnimationFrame (headless/unit), the build still runs, right after the notice.
  delete w.requestAnimationFrame;
  built.delete('map_new1'); announced.length = 0; buildLog.length = 0;
  rat.update(1);
  assert.equal(announced.length, 1); assert.deepEqual(buildLog, ['map_new1']);
  assert.ok(rat.getDebug().built >= 3);
}
console.log('remote area tick tests passed');
