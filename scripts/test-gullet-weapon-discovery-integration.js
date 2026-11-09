#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Used for behavior checks below.
const fs = require('node:fs'); // Used to load the shipped modules in loader order.
const vm = require('node:vm'); // Used to run browser modules with deterministic rewards.

function fixture(roll = 0.14, poolReady = true) {
  const callbacks = new Map(); // Used to drive the real fishing frame owner.
  const grants = []; // Used to observe the authoritative persistent gift handoff.
  const completed = new Set(); // Used to model durable completion across casts.
  const inventory = {}; // Used to verify the ordinary treasure still reaches inventory.
  const sandbox = { // Used as the minimal browser environment for the shipped load order.
    console, URLSearchParams, performance: { now: () => 0 },
    Math: Object.assign(Object.create(Math), { random: () => roll }),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { getElementById: () => null, dispatchEvent() {} },
    location: { pathname: '/', search: '' }, setInterval() {},
    RuntimeFrameScheduler: { register(id, fn) { callbacks.set(id, fn); } },
    InventoryStacks: { MAX_TOTAL: 999 },
    WildTreasure: { init() {} },
    WEAPON_TRUST_VISIT_CONFIG: { gifts: [] },
    WeaponTrustVisits: {
      giftCompleted: gate => completed.has(gate.id),
      completeGift(gate) { grants.push(gate); completed.add(gate.id); return true; },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  function load(path, transform = text => text) {
    vm.runInContext(transform(fs.readFileSync(path, 'utf8')), sandbox, { filename: path });
  }
  load('docs/config/weapon-discovery-rewards.js');
  load('docs/js/weapon-discovery-rewards.js');
  load('docs/js/fish-catalog.js');
  // Expose only encounter state to arrange a surfaced fish without graphics.
  load('docs/js/fishing-events.js', text => text.replace('  hookWildTreasureInit();', '  window.testGulletState = gulletState;\n  hookWildTreasureInit();'));
  sandbox.Fishing = { init() {}, state: { phase: 'active' }, refreshCatchRewards() {} };
  sandbox.Fishing.init({ getCurrentArea: () => null }); // No toast dependency: display is optional.
  if (poolReady) sandbox.WildTreasure.init({
    inventory, rnd: () => 0.99,
    getLootPools: () => ({ treasureChest: { entries: ['metalBars', 'mysteryDye', 'gold', 'potion', 'combatManual', 'clothing'].map(id => ({ id, chance: 0 })) } }),
  });
  const tick = callbacks.get('fishing-events-feature-loop'); // Used to execute the real active-to-caught transition.
  function catchGullet(mode = 'surface') {
    sandbox.Fishing.state.phase = 'active';
    sandbox.testGulletState.mode = 'none';
    sandbox.testGulletState.treasureGranted = false;
    tick({ timestamp: 10 });
    sandbox.testGulletState.mode = mode;
    sandbox.testGulletState.surfaceElapsed = 0;
    sandbox.Fishing.state.phase = 'caught';
    tick({ timestamp: 20 });
    tick({ timestamp: 30 });
  }
  return { sandbox, grants, catchGullet };
}

const success = fixture(); // Used to cover a winning 15% roll after FishCatalog replaces the Fishing accessor.
success.catchGullet();
assert.equal(success.grants.length, 1);
assert.equal(success.grants[0].shapeKey, 'fishingmace');
assert.equal(success.grants[0].giftMetalKey, 'nativeCopper');
assert.deepEqual(Array.from(success.sandbox.Fishing.state.gulletRewards), ['Fishing Mace']);
assert.match(success.sandbox.FishingFeatureDebug.status().lastGulletDiscovery, /Received Fishing Mace/);
success.catchGullet();
assert.equal(success.grants.length, 1, 'a completed discovery cannot grant twice');

const miss = fixture(0.15); // Used to check the exact exclusive upper bound of the authored chance.
miss.catchGullet();
assert.equal(miss.grants.length, 0);
const escaped = fixture(); // Used to ensure an escaped Gullet never awards a weapon.
escaped.catchGullet('escaped');
assert.equal(escaped.grants.length, 0);
const unavailable = fixture(0, false); // Used to ensure failed treasure retrieval does not award a weapon.
unavailable.catchGullet();
assert.equal(unavailable.grants.length, 0);
console.log('Gullet discovery survives shipped loader order, grants once, reports catch rewards, and respects odds/escape/failure');
