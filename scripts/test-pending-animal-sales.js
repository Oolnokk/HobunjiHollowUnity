'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const pendingSource = fs.readFileSync('docs/js/pending-animal-sales.js', 'utf8');
const worldSource = fs.readFileSync('docs/js/world-meta-store.js', 'utf8');
const crateSource = fs.readFileSync('docs/js/farm-crates.js', 'utf8');
const configSource = fs.readFileSync('docs/js/shipping-box-config.js', 'utf8');
const farmSource = fs.readFileSync('docs/js/farm-panel-core.js', 'utf8');
const nurserySource = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8');
const incubatorSource = fs.readFileSync('docs/js/barn-incubator.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/farm-panel.js', 'utf8');

const original = { id: 'animal_7', kind: 'grehlr', name: 'Stripe', lifeStage: 'adult',
  barnId: 'barn_3', genotype: { fur: { main: '#829eab' }, pattern: { stripes: 2 }, sizeClass: 'small' },
  offspringProvenance: { parents: [{ id: 'sire' }, { id: 'dam' }] } }; // Preserves full identity/genetics on cancellation.
const second = { id: 'animal_8', kind: 'pingdort', name: 'Pip', lifeStage: 'baby',
  genotype: { sizeClass: 'small' } }; // Different seller and age verify receipt routing.

function harness({ animals = [original, second], day = 15, gold = 20 } = {}) {
  const initial = { worlds: [{ id: 'farm_1', members: {
    seller: { nonGearInventory: { gold } },
    guest: { nonGearInventory: { gold: 7 } },
  }, livestock: structuredClone(animals), breedingPairs: [{
    id: 'pair_1', parentA: { source: 'world', id: 'animal_7' },
    parentB: { source: 'world', id: 'animal_8' },
  }] }] }; // Canonical world metadata used by BOTH shipped modules, not a mocked settlement.
  const storage = new Map([['hobunjiSaveMeta', JSON.stringify(initial)]]); // Fake persistent storage supports simulated reload and write failure.
  let failNextWrite = false; // Set to inject a failed localStorage write at a chosen transaction boundary.
  let failMemberSave = false; // Set to test an active-member flush failure before committing a sale.
  let activeCharacter = 'seller'; // Switchable character shows whose gold actually receives each payout.
  let currentDay = day; // Drives the same calendar cutoff consumed by FarmCrates.
  let area = 'farm'; // Drives the real farm/away collection transition.
  let pulse = null; // Captured from FarmCrates' existing 500-ms interval.
  let walletSaves = 0; // Distinguishes a failed pre-save from a completed settlement.
  let visualRemovals = []; // Tracks FarmPanel mesh disposal after atomic commit.
  let farmRenders = 0; // Tracks roster re-render after a real collection.
  const log = []; // Shipping delivery log receives one receipt per collected batch.
  const inventory = { gold }; // In-memory wallet matches the active character until switched.

  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem(key, value) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('Simulated quota/write failure');
      }
      storage.set(key, String(value));
    },
  };
  const read = () => JSON.parse(localStorage.getItem('hobunjiSaveMeta')).worlds[0];
  const win = {
    FarmAnimals: {
      currentCharacterId: () => activeCharacter,
      invalidateBreedingFollowCache() {},
    },
    FarmPanel: {
      init() {},
      onAnimalSalesCollected(ids) { visualRemovals.push(...ids); },
      render() { farmRenders++; },
    },
    LivestockNursery: { rerollSwarm() {} },
    addEventListener() {},
    setInterval(callback) { pulse = callback; return 1; },
  };
  win.window = win;
  const context = { window: win, localStorage, performance: { now: () => 0 },
    document: { getElementById: () => null }, console };
  vm.runInNewContext(worldSource, context, { filename: 'world-meta-store.js' });
  vm.runInNewContext(pendingSource, context, { filename: 'pending-animal-sales.js' });
  vm.runInNewContext(configSource, context, { filename: 'shipping-box-config.js' });
  vm.runInNewContext(crateSource, context, { filename: 'farm-crates.js' });

  const deps = {
    inventory, calendar: { get day() { return currentDay; } },
    _tothalWorldId: () => 'farm_1',
    _loadWorldLivestock: () => win.WorldMetaStore.loadLivestock('farm_1'),
    _saveWorldLivestock: list => win.WorldMetaStore.saveLivestock('farm_1', list),
    getDeliveryLog: () => log,
    hasFarmPermission: () => true,
    saveMemberWorldData() {
      walletSaves++;
      if (failMemberSave) return false;
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta'));
      meta.worlds[0].members[activeCharacter].nonGearInventory.gold = inventory.gold;
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
      return true;
    },
    showToast() {},
    getMenuOpen: () => false,
  };
  win.FarmCrates.init(deps);
  win.FarmPanel.init({ getCurrentArea: () => area });
  win.PendingAnimalSales.init(deps);
  return {
    win, deps, inventory, log, read, localStorage,
    get walletSaves() { return walletSaves; },
    get visualRemovals() { return visualRemovals; },
    get farmRenders() { return farmRenders; },
    setFailNextWrite() { failNextWrite = true; },
    setFailMemberSave(value) { failMemberSave = value; },
    changeCharacter(id, walletGold) { activeCharacter = id; inventory.gold = walletGold; },
    changeDay(value) { currentDay = value; },
    changeArea(value) { area = value; },
    tick() { assert.equal(typeof pulse, 'function'); pulse(); },
  };
}

// No pay-now, no duplicate queue, and no loss of provenance on cancellation.
const h = harness();
const sales = h.win.PendingAnimalSales;
assert.equal(sales.queue('unknown', 40).ok, false);
assert.equal(sales.queue('animal_7', -1).ok, false);
assert.equal(sales.queue('animal_7', 700).ok, true);
assert.equal(h.inventory.gold, 20);
assert.equal(sales.queue('animal_7', 700).ok, false);
assert.equal(h.read().livestock[0].pendingAnimalSale.sellerCharacterId, 'seller');
assert.equal(sales.settle('left farm').sold, 0, 'no payout before midnight');
assert.equal(sales.cancel('animal_7').ok, true);
assert.deepEqual(h.read().livestock[0], original, 'cancellation restores exact original animal record');
assert.equal(h.read().breedingPairs.length, 1);
assert.equal(h.inventory.gold, 20);
assert.equal(sales.queue('animal_7', 700).ok, true);
h.setFailNextWrite();
assert.equal(sales.cancel('animal_7').ok, false, 'failed cancellation must preserve its pending sale');
assert.equal(h.read().livestock[0].pendingAnimalSale.price, 700);
assert.equal(sales.cancel('animal_7').ok, true);
h.setFailNextWrite();
assert.equal(sales.queue('animal_7', 700).ok, false, 'failed queue must leave the animal unreserved');
assert.equal(sales.pendingFor(h.read().livestock[0]), null);
assert.equal(sales.queue('animal_7', 700).ok, true);

// A second farmhand can queue a baby; the original seller gets its own gold.
h.changeCharacter('guest', 7);
assert.equal(sales.queue('animal_8', 35).ok, true);
assert.equal(h.read().livestock[1].pendingAnimalSale.sellerCharacterId, 'guest');
h.changeCharacter('seller', 20);
h.changeDay(16);
const collection = sales.settle('left farm');
assert.equal(collection.sold, 2);
assert.equal(collection.earned, 735);
assert.equal(h.inventory.gold, 720, 'active member receives only their own 700g');
assert.equal(h.read().members.seller.nonGearInventory.gold, 720);
assert.equal(h.read().members.guest.nonGearInventory.gold, 42);
assert.equal(h.read().livestock.length, 0, 'both animals removed from the committed roster');
assert.equal(h.read().breedingPairs.length, 0, 'pair references removed in the same world transaction');
assert.deepEqual(h.visualRemovals, ['animal_7', 'animal_8'], 'both world meshes can be disposed');
assert.equal(h.log.length, 1, 'one receipt for the collected batch');
assert.equal(sales.settle('left farm').earned, 0, 'collection cannot pay twice');
assert.equal(h.farmRenders, 1);

// A write failure cannot leave a vanished animal without its gold.
const failure = harness({ animals: [original], day: 21, gold: 9 });
assert.equal(failure.win.PendingAnimalSales.queue('animal_7', 40).ok, true);
failure.changeDay(22);
failure.setFailMemberSave(true);
assert.equal(failure.win.PendingAnimalSales.settle().sold, 0, 'failed member flush defers payout');
assert.equal(failure.read().livestock.length, 1);
failure.setFailMemberSave(false);
failure.setFailNextWrite(); // First write is the member flush, which fails before transaction.
assert.equal(failure.win.PendingAnimalSales.settle().sold, 0);
assert.equal(failure.read().livestock.length, 1);
assert.equal(failure.read().members.seller.nonGearInventory.gold, 9);
failure.win.PendingAnimalSales.settle();
assert.equal(failure.read().members.seller.nonGearInventory.gold, 49);
assert.equal(failure.read().livestock.length, 0);
assert.equal(failure.win.PendingAnimalSales.settle().earned, 0, 'simulated reload observes the already-committed removal');

// Also inject failure directly at the combined roster+wallet write.
const atomic = harness({ animals: [original], day: 30, gold: 11 });
assert.equal(atomic.win.PendingAnimalSales.queue('animal_7', 81).ok, true);
atomic.setFailNextWrite();
const rejected = atomic.win.WorldMetaStore.completeAnimalSales('farm_1', 'seller', 11, 31, ['animal_7']);
assert.equal(rejected.ok, false);
assert.equal(atomic.read().livestock.length, 1);
assert.equal(atomic.read().members.seller.nonGearInventory.gold, 11);
const committed = atomic.win.WorldMetaStore.completeAnimalSales('farm_1', 'seller', 11, 31, ['animal_7']);
assert.equal(committed.ok, true);
assert.equal(atomic.read().livestock.length, 0);
assert.equal(atomic.read().members.seller.nonGearInventory.gold, 92);
assert.equal(atomic.win.WorldMetaStore.completeAnimalSales('farm_1', 'seller', 92, 31, ['animal_7']).earned, 0);

// The actual Shipping Box cutoff/area logic must perform the collection.
const shipping = harness({ animals: [original], day: 41, gold: 6 });
assert.equal(shipping.win.PendingAnimalSales.queue('animal_7', 44).ok, true);
shipping.tick();
shipping.changeDay(42);
shipping.tick();
assert.equal(shipping.read().livestock.length, 1, 'midnight on farm does not collect immediately');
shipping.changeArea('map_northern_cliffs');
shipping.tick();
assert.equal(shipping.read().livestock.length, 0, 'leaving the farm after midnight collects queued animal');
assert.equal(shipping.inventory.gold, 50);
shipping.tick();
assert.equal(shipping.inventory.gold, 50, 'real repeated shipping pulses do not double-credit');

// Integration contracts and cache loaders must keep their updated modules reachable.
assert.match(farmSource, /PendingAnimalSales\?\.init\?\.\(injectedDeps\)/);
assert.match(farmSource, /onAnimalSalesCollected/);
assert.match(crateSource, /PendingAnimalSales\?\.settle\?\.\(reason\)/);
assert.match(nurserySource, /Cancel the pending animal sale before growing this baby/);
assert.match(incubatorSource, /Cancel the pending sale before incubating this baby/);
assert.match(indexSource, /js\/world-meta-store\.js\?v=20261122cancelAnimal2/);
assert.match(indexSource, /js\/pending-animal-sales\.js\?v=20261122cancelAnimal2/);
assert.match(bridgeSource, /barn-incubator\.js\?v=20261122cancelAnimal2/);
assert.match(loaderSource, /farm-panel-core\.js\?v=20261122cancelAnimal2/);

console.log('atomic reversible animal sales regression checks passed');
