'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let now = 1000;
let activeCombat = true;
let baseWasDodging = false;
const player = {
  dodging: false,
  dodgeT: 0,
  invulnUntil: 0,
};

const ClothingWeavingSystem = {
  version: 1,
  combatActive() { return activeCombat; },
  armorStats() { return { dodgeEfficacy: 0.75 }; },
};

const Combat = {
  deps: { player },
  update() {
    const dodging = !!player.dodging;
    if (activeCombat && dodging && !baseWasDodging) {
      const efficacy = ClothingWeavingSystem.armorStats().dodgeEfficacy;
      player.dodgeT *= efficacy;
      const remaining = Math.max(0, player.invulnUntil - now);
      if (remaining > 0) player.invulnUntil = now + remaining * efficacy;
      player._armorWeightDodgeEfficacy = efficacy;
    }
    baseWasDodging = dodging;
  },
};

const windowStub = { ClothingWeavingSystem, Combat };
const context = vm.createContext({
  window: windowStub,
  performance: { now: () => now },
  Date,
  console,
});
vm.runInContext(fs.readFileSync('docs/js/clothing-weight-dodge-policy.js', 'utf8'), context, { filename: 'clothing-weight-dodge-policy.js' });

const api = windowStub.ClothingWeightDodgePolicy;
assert(api, 'ClothingWeightDodgePolicy exported');
assert.equal(api.debugSnapshot().installed, true, 'dodge policy installs over the existing clothing combat wrapper');

// In combat, the main clothing system owns the adjustment and this policy
// must not apply it a second time.
player.dodging = true;
player.dodgeT = 0.5;
player.invulnUntil = now + 400;
Combat.update(0.016);
assert(Math.abs(player.dodgeT - 0.375) < 1e-12, 'active-combat dodge is scaled exactly once');
assert(Math.abs(player.invulnUntil - (now + 300)) < 1e-12, 'active-combat iframes are scaled exactly once');
assert.equal(api.debugSnapshot().lastApplied, null, 'compat policy does not claim an active-combat adjustment');

// Let both rising-edge trackers observe the dodge ending before beginning a
// fresh out-of-combat dodge.
player.dodging = false;
Combat.update(0.016);
activeCombat = false;
now = 5000;
player.dodging = true;
player.dodgeT = 0.5;
player.invulnUntil = now + 400;
Combat.update(0.016);
assert(Math.abs(player.dodgeT - 0.375) < 1e-12, 'armor weight weakens a dodge even outside the recent-combat grace window');
assert(Math.abs(player.invulnUntil - (now + 300)) < 1e-12, 'out-of-combat dodge iframes use the same weight efficacy');
assert.equal(api.debugSnapshot().lastApplied.efficacy, 0.75, 'mobile debug records the complementary dodge adjustment');
assert.equal(api.debugSnapshot().combatActive, false);

console.log('clothing weight dodge policy tests passed');