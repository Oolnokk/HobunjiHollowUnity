'use strict';
const assert = require('node:assert/strict'); // Runtime checks for lineage selection, star partitions and portrait cache reuse.
const fs = require('node:fs');
const vm = require('node:vm');
const source = file => fs.readFileSync(`docs/js/${file}.js`, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

async function run() {
  const inventory = { egg: 4 }; // One generic egg plus three saved lineages.
  const meta = { worlds: [{ id: 'world', members: { player: { nonGearInventory: { egg: 4 } } } }] };
  const storage = { hobunjiSaveMeta: JSON.stringify(meta) }; // Durable character/world fixture.
  const deployed = []; // Records exactly which genotype the deployment wrapper forwards.
  let fail = false; // Exercises failed deployment without consuming metadata.
  let composites = 0; // Counts all canvas composition work, including concurrent requests.
  const window = {
    __hobunjiPlayerProfile: { worldId: 'world', characterId: 'player' },
    SCRATCHBONES_CONFIG: { game: { livestock: { itemKinds: { egg: 'grehlr' } } } },
    CreatureGeneticsRender: { composeFrame() {} },
    AnimalChatheadFrame: {
      frameForKind: () => ({ frame: { x: .2, y: .1, width: .3, height: .4 } }),
      async renderCreatureChathead(canvas, kind, options) {
        composites++;
        assert.equal(kind, 'grehlr');
        assert.equal(options.genotype.base.color, '#cba');
        assert.equal(options.genotype.stripes.copies, 1, 'pattern-bearing genes reach the shared crop compositor');
        return true;
      },
    },
    FarmAnimals: {
      queueItemGenotype() {},
      addFromItem(key, options) { return this.addToStable(key, options); },
      addToStable(key, options) {
        if (fail) return { ok: false };
        if (!window.LivestockItemGenotypePersistence.groupsFor(key, inventory[key]).some(group => group.variant === options.inventoryVariant)) return { ok: false };
        inventory[key]--;
        deployed.push(options.carriedGenotype);
        return { ok: true };
      },
    },
  };
  // Keep both original deployment stubs independent so their wrappers cannot recursively invoke each other.
  window.FarmAnimals.addFromItem = window.FarmAnimals.addToStable;
  const context = vm.createContext({ window, console,
    localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; } },
    document: { querySelectorAll: () => [], getElementById: () => null, documentElement: {},
      createElement: () => ({ width: 0, height: 0, toDataURL: () => 'data:image/png;base64,crop' }) },
    MutationObserver: class { observe() {} }, Node: { ELEMENT_NODE: 1 },
  });
  vm.runInContext(source('inventory-stacks'), context);
  vm.runInContext(source('livestock-item-genotype-persistence'), context);
  const stacks = window.InventoryStacks;
  const persistence = window.LivestockItemGenotypePersistence;
  const coat = { base: { color: '#cba', copies: 2 }, stripes: { color: '#fff', copies: 1 }, sizeClass: 'small' };
  const reordered = { sizeClass: 'small', stripes: { copies: 1, color: '#fff' }, base: { copies: 2, color: '#cba' } };
  const carrier = { ...coat, stripes: { ...coat.stripes, copies: 0 } };
  window.FarmAnimals.queueItemGenotype('egg', coat);
  window.FarmAnimals.queueItemGenotype('egg', reordered);
  window.FarmAnimals.queueItemGenotype('egg', carrier);
  const groups = persistence.groupsFor('egg', 4);
  assert.deepEqual(plain(groups.map(group => group.count)), [2, 1, 1]);
  assert.equal(persistence.groupsFor('egg', 4), groups, 'unchanged queues reuse the grouped result');
  assert.notEqual(groups[0].variant, groups[1].variant, 'hidden recessive differences split stacks');
  fail = true;
  assert.equal(window.FarmAnimals.addToStable('egg', { inventoryVariant: groups[1].variant }).ok, false);
  assert.equal(inventory.egg, 4);
  assert.equal(persistence.groupsFor('egg', 4), groups, 'failed deployment leaves lineage untouched');
  fail = false;
  assert.equal(window.FarmAnimals.addToStable('egg', { inventoryVariant: groups[1].variant }).ok, true);
  assert.deepEqual(plain(deployed[0]), carrier, 'selected non-FIFO bloodline deploys exactly');
  persistence.reload();
  assert.deepEqual(plain(persistence.groupsFor('egg', 3).map(group => group.count)), [2, 1], 'selection survives a reload with both other lineages intact');
  assert.equal(JSON.parse(storage.hobunjiSaveMeta).worlds[0].members.player.nonGearInventory.egg, 3);
  assert.equal(window.FarmAnimals.addToStable('egg', { inventoryVariant: groups[1].variant }).ok, false, 'stale selection cannot consume a different animal');
  assert.equal(window.FarmAnimals.addFromItem('egg', { inventoryVariant: 'generic' }).ok, true);
  assert.equal(deployed[1], null, 'generic stack never steals a saved lineage');
  assert.deepEqual(plain(persistence.groupsFor('egg', 2).map(group => group.count)), [2]);
  assert.equal(window.FarmAnimals.addToStable('egg', { inventoryVariant: 'generic' }).ok, false, 'stale generic selection is rejected');

  window.CookingSystem = { availableQualityEntries: () => [{ stars: 5, count: 101 }, { stars: 2, count: 3 }] };
  const boxes = stacks.variants('fruit', 104, true);
  assert.deepEqual(plain(boxes.map(box => [box.stars, box.count])), [[5, 99], [5, 2], [2, 3]]);
  assert.equal(new Set(boxes.map(box => box.stackId)).size, 3, 'overflow and quality boxes each have a unique selection identity');
  assert.deepEqual(plain(stacks.variants('wood', 100).map(box => box.count)), [99, 1]);
  assert.deepEqual(plain(stacks.variants('wood', 0)), []);

  const [first, second] = await Promise.all([stacks.headIcon('grehlr', coat), stacks.headIcon('grehlr', reordered)]);
  assert.equal(first, second);
  assert.equal(composites, 1, 'concurrent same-genotype portraits share one composition');
  for (let index = 0; index < 30; index++) await stacks.headIcon('grehlr', coat);
  assert.equal(composites, 1, 'refreshes do not reapply colors/patterns');
  assert.equal(stacks.getDebug().cachedHeads, 1);
  console.log('inventory variants: exact lineage selection, persistence, qualities and cached head crops passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
