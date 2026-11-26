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

// Stage 3: an occupied zone nobody built is built once per round (calm only), then populated and ticked.
{
  const buildLog = [], popLog = [];
  w.AreaScope.ensureScene = a => { buildLog.push(a); built.add(a); return true; };
  let calm = false;
  guest.areaId = 'map_new1'; ticks.length = 0;
  rat.init({ getCurrentArea: () => currentArea, isCalm: () => calm,
    populate: () => { popLog.push(currentArea); return true; },
    tickHostiles: () => ticks.push(currentArea) });
  rat.update(1);
  assert.deepEqual(buildLog, [], 'not built while the host is not calm (cutscene/paused)');
  calm = true;
  rat.update(1);
  assert.deepEqual(buildLog, ['map_new1'], 'built when calm');
  assert.deepEqual(Array.from(popLog), ['map_new1'], 'populated on first scoped tick, same round as the build');
  assert.deepEqual(Array.from(ticks), ['map_new1']);
  rat.update(1);
  assert.deepEqual(buildLog, ['map_new1'], 'built exactly once');
  assert.equal(currentArea, 'map_a', 'building never moves the local area');
  const g2 = { x: 0, y: 0, health: 100, areaId: 'map_new2' };
  reg.registerPlayer(g2, { playerId: 'g2' });
  buildLog.length = 0; guest.areaId = 'map_new3'; // two unbuilt zones at once
  rat.update(1);
  assert.equal(buildLog.length, 1, 'at most one zone is built per round');
  reg.unregisterPlayer(g2);
  assert.ok(rat.getDebug().built >= 2);
}
console.log('remote area tick tests passed');
