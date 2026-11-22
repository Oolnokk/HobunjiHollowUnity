'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the shipped module without a browser: only the real farm and
// shipping dependencies are stubbed, not the queuing/settlement logic itself.
const source = fs.readFileSync('docs/js/pending-animal-sales.js', 'utf8');
const farmSource = fs.readFileSync('docs/js/farm-panel-core.js', 'utf8');
const crateSource = fs.readFileSync('docs/js/farm-crates.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/farm-panel.js', 'utf8');

const geneticRecord = { fur: { main: '#829eab' }, pattern: { stripes: 2 }, sizeClass: 'small' };
const original = {
  id: 'animal_7', name: 'Stripe', kind: 'grehlr', lifeStage: 'adult',
  barnId: 'barn_3', assignedVatId: null, genotype: geneticRecord,
  offspringProvenance: { parentA: 'dam_1', parentB: 'sire_2' },
}; // The exact original record is compared after cancellation and JSON round-trip.
let livestock = [structuredClone(original), { id: 'animal_8', name: 'Pip', kind: 'pingdort', lifeStage: 'baby' }];
let pairs = [{ parentA: { source: 'world', id: 'animal_7' }, parentB: { source: 'world', id: 'animal_8' } }];
const calendar = { day: 15 }; // Day 16 is the first eligible collection day.
const inventory = { gold: 20 }; // Only actual settlement is allowed to change this.
const deliveryLog = []; // Verifies that collection writes one sale receipt.
let permit = true;
let rosterSaves = 0;
let walletSaves = 0;
let swarmRefreshes = 0;
let farmRenders = 0;
let removals = 0;

const windowStub = {
  FarmPanel: {
    removeLivestockAndCleanup(id) {
      const index = livestock.findIndex(entry => entry.id === id);
      if (index < 0) return null;
      const [removed] = livestock.splice(index, 1);
      pairs = pairs.filter(pair => ![pair.parentA, pair.parentB].some(ref => ref.source === 'world' && ref.id === id));
      removals++;
      rosterSaves++;
      return removed;
    },
    render() { farmRenders++; },
  },
  LivestockNursery: { rerollSwarm() { swarmRefreshes++; } },
};
const context = { window: windowStub };
vm.runInNewContext(source, context, { filename: 'pending-animal-sales.js' });
const sales = windowStub.PendingAnimalSales;
sales.init({
  calendar, inventory,
  hasFarmPermission: () => permit,
  _loadWorldLivestock: () => structuredClone(livestock),
  _saveWorldLivestock(next) { livestock = next; rosterSaves++; return true; },
  saveMemberWorldData() { walletSaves++; },
  getDeliveryLog: () => deliveryLog,
  showToast() {},
});

assert.equal(sales.queue('unknown', 40).ok, false, 'unknown animals cannot be sold');
assert.equal(sales.queue('animal_7', -1).ok, false, 'invalid prices do not alter a livestock record');
permit = false;
assert.equal(sales.queue('animal_7', 700).ok, false, 'only permitted farm managers may sell animals');
permit = true;
assert.equal(sales.queue('animal_7', 700).ok, true, 'adult is queued for the next shipping collection');
assert.equal(inventory.gold, 20, 'queuing does not pay early');
assert.equal(sales.queue('animal_7', 700).ok, false, 'duplicate sale is rejected');
assert.equal(sales.pendingFor(livestock[0]).eligibleDay, 16);
assert.equal(sales.settle('left farm').earned, 0, 'exiting farm before midnight leaves queued animal intact');
assert.equal(sales.cancel('animal_7').ok, true, 'queued sale may be cancelled');
assert.deepEqual(livestock[0], original, 'cancellation leaves all genetics, housing, provenance and original identity intact');
assert.equal(pairs.length, 1, 'cancellation does not alter breeding relationships');
assert.equal(inventory.gold, 20, 'cancellation never needs a refund');

assert.equal(sales.queue('animal_7', 700).ok, true);
assert.equal(sales.queue('animal_8', 35).ok, true, 'baby and adult share the same ledger');
livestock = JSON.parse(JSON.stringify(livestock));
assert.equal(sales.debugSnapshot().pending.length, 2, 'save/reload preserves both queued animals');
calendar.day = 16;
const result = sales.settle('left farm');
assert.equal(result.sold, 2);
assert.equal(result.earned, 735, 'exact queued prices pay out together');
assert.equal(inventory.gold, 755);
assert.equal(livestock.length, 0, 'both collected animals leave the world');
assert.equal(pairs.length, 0, 'existing livestock cleanup removes the settled breeding pair');
assert.equal(removals, 2);
assert.equal(walletSaves, 1, 'one collection produces one wallet save');
assert.equal(deliveryLog.length, 1, 'one receipt tracks the batch');
assert.equal(swarmRefreshes, 1, 'Nursery refreshes after collection');
assert.equal(farmRenders, 1, 'Farm roster refreshes after collection');
assert.equal(sales.settle('left farm').earned, 0, 'repeated collection never credits gold twice');

assert.match(farmSource, /PendingAnimalSales\?\.init\?\.\(injectedDeps\)/, 'FarmPanel injects the authoritative farm save dependencies');
assert.match(farmSource, /removeLivestockAndCleanup:\s*id\s*=>/, 'settlement shares the existing livestock removal and pair/mesh cleanup');
assert.match(farmSource, /Cancel Sale/, 'Farm roster presents an undo control');
assert.match(crateSource, /PendingAnimalSales\?\.settle\?\.\(reason\)/, 'animal collection uses the Shipping Box settlement trigger');
assert.match(indexSource, /js\/pending-animal-sales\.js\?v=20261122cancelAnimal1/, 'shipping ledger is loaded by the game');
assert.match(bridgeSource, /livestock-nursery-grid\.js\?v=20261122cancelAnimal1/, 'Nursery sale changes invalidate its old cache');
assert.match(loaderSource, /farm-panel-core\.js\?v=20261122cancelAnimal1/, 'Farm roster changes invalidate its old cache');

console.log('reversible animal sales regression checks passed');
