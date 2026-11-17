'use strict';
// checkTransitionSpots must re-resolve on tile/area change, key-item grant, latch rewrite, while a spot is pending,
// and after the TTL, but skip the latch compare + pool.find on idle frames. refreshActionBar keeps its old cadence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js', 'utf8');
const start = game.indexOf('let _spotLastArea');
const end = game.indexOf('      function _returnToFarmMeshes', start);
// state block + canUseRoofSpot + checkTransitionSpots are contiguous in game.js
assert(start > 0 && end > start, 'function present');
let now = 0, finds = 0, bars = 0, listeners = {}, tileListener = null, hasKey = false;
const spot = { area: 'farm', col: 4, row: 4, target: 'interior', requiresKeyItem: 'k', targetCol: 1, targetRow: 1 };
const pool = new Proxy([spot], { get(t, p) { if (p === 'find') return fn => { finds++; return t.find(fn); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
const sb = {
  performance: { now: () => now }, Math, Number,
  window: { PlayerTileEvents: { subscribe: f => { tileListener = f; } }, addEventListener: (n, f) => { listeners[n] = f; }, KeyItemSystem: { has: () => hasKey } },
  document: { addEventListener: (n, f) => { listeners[n] = f; } },
  player: { x: 0.5, y: 0.5 }, TILE: 1, currentArea: 'farm',
  _spotResolveDirty: true, _transitionLatch: null, _pendingSpotTransition: null,
  _travelAreaOf: a => a, _isBuildingArea: () => false, _isZoneArea: () => false, worldTransitions: pool, worldTownTransitions: [],
  canUseRoofSpot: () => true, refreshActionBar: () => { bars++; }, startSceneTransition() {}, performTravel() {}, _playerData: {},
};
vm.createContext(sb);
vm.runInContext(game.slice(start, end) + '\nthis.check = checkTransitionSpots;', sb);
const run = () => sb.check();

run(); assert.equal(finds, 1, 'first frame resolves');
for (let i = 0; i < 30; i++) { now += 5; run(); }
assert.equal(finds, 1, 'idle frames skip resolution');
assert.equal(bars, 31, 'action bar keeps refreshing every frame');

sb.player.x = 4.5; sb.player.y = 4.5; now += 5; run();
assert.equal(finds, 2, 'tile change re-resolves (without needing the event)');
assert.equal(sb._pendingSpotTransition, null, 'key-gated spot not available yet');
hasKey = true; for (let i = 0; i < 3; i++) { now += 5; run(); }
assert.equal(finds, 2, 'no re-resolve until a trigger or the TTL');
listeners['hobunji:key-item-granted']({}); run();
assert.equal(finds, 3, 'key-item grant re-resolves immediately');
assert.equal(sb._pendingSpotTransition, spot, 'spot becomes available');
const f = finds; for (let i = 0; i < 5; i++) { now += 5; run(); }
assert.equal(finds - f, 5, 'a pending spot re-resolves every frame, exactly as before');

sb.player.x = 0.5; sb.player.y = 0.5; now += 5; run();
assert.equal(sb._pendingSpotTransition, null, 'leaving the spot clears it');
const g = finds; hasKey = false; sb.player.x = 4.5; sb.player.y = 4.5; run();
sb._transitionLatch = 'farm:4,4'; sb._spotResolveDirty = true; run();
assert.equal(sb._pendingSpotTransition, null, 'a rewritten latch suppresses the spot it was set on');
const b = bars; now += 5; run(); assert.equal(bars, b, 'latched frames do not touch the action bar (unchanged behaviour)');
sb._transitionLatch = null; hasKey = true; now += 300; run();
assert.equal(sb._pendingSpotTransition, spot, 'TTL re-resolve picks up changed state with no event');
tileListener({}); const h = finds; run(); assert.equal(finds, h + 1, 'tile event forces a resolve');
console.log('PASS transition spot resolution: event/key/latch/pending/TTL triggers, idle skip, unchanged action-bar cadence');
