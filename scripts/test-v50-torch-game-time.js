#!/usr/bin/env node
'use strict';
// The permanent Adventuring Tools torch can be relit, but each ignition burns for 30 real seconds.
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Read the shipped state machine, not a test copy.
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/adventuring-tools.js', 'utf8');
assert.match(source, /TORCH_BURN_MS\s*=\s*30_000/, 'the shared portable flame has a 30-second budget');
let now = 0; // Controlled monotonic clock for precise expiry checks.
let heldMode = 'tool'; // Simulates drawing and stowing without resetting the torch state.
let refreshes = 0; // Confirms timeout pushes its new state to the in-game action bar.
const world = { CharacterMetaSave: { update() {} } };
vm.runInNewContext(source, { window:world, performance: { now: () => now } });
const torch = world.AdventuringTools;
torch.init({
  getActiveTool:()=> 'adventuring',
  getHeldMode:()=> heldMode,
  getEquippedTool:()=> 'torch',
  getUnlocked:()=> [],
  refreshActionBar() { refreshes++; },
});
assert.equal(torch.light(), true, 'a fire hazard lights the held torch');
now = 12000;
assert.equal(torch.isLit(), true, 'held torch remains lit before the deadline');
torch.stow();
heldMode = 'none';
assert.equal(torch.isLit(), true, 'the flame survives being put on the belt');
assert.equal(torch.debug.onBelt, true, 'mobile debug identifies the stowed torch');
assert.equal(torch.debug.burnRemainingMs, 18000, 'stow does not reset the original expiry');
assert.equal(torch.light(), false, 'a belt torch cannot ignite itself while not held');
now = 29999;
assert.equal(torch.isLit(), true, 'belt torch survives until just before the exact deadline');
heldMode = 'tool';
assert.equal(torch.canThrow(), true, 'redrawing before expiry preserves a lit throwable torch');
now = 30000;
assert.equal(torch.isLit(), false, 'the same clock extinguishes the held torch at 30 seconds');
assert.equal(torch.canThrow(), false, 'the expired torch cannot be thrown');
assert.equal(torch.debug.burnRemainingMs, 0);
assert(refreshes >= 2, 'ignition and timeout refresh the action bar');
assert.equal(torch.light(), true, 'the same portable torch can be relit when held');
now = 40000;
torch.stow();
heldMode = 'none';
now = 60000;
torch.updateBurn();
assert.equal(torch.isLit(), false, 'the second burn also expires on the belt');
heldMode = 'tool';
assert.equal(torch.light(), true, 'a new flame starts a fresh 30-second deadline');
assert.equal(torch.debug.burnRemainingMs, 30000);
now += 5000;
assert.equal(torch.light(), false, 'ordinary ignition does not silently renew the flame');
assert.equal(torch.light(true), true, 'deliberate flame contact renews a held lit torch');
now += 29000;
assert.equal(torch.isLit(), true, 'renewed flame survives beyond original deadline');
now += 1000;
assert.equal(torch.isLit(), false, 'renewed flame still has exactly 30 seconds');
console.log('portable torch: 30s held/belt lifetime, no stow reset, throw gating and relight PASS');
