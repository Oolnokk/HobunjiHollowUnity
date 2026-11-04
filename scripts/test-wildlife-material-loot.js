#!/usr/bin/env node
'use strict';

// End-to-end regression for authored corpse loot -> per-animal genotype hide -> fur-hood recipe.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Root for the production scripts and authored configs exercised here.
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pools = JSON.parse(read('docs/config/loot/loot-pools.json'));
const manifest = JSON.parse(read('docs/config/patterns/fur-hoods.json'));
const index = JSON.parse(read('docs/config/items/item-index.json'));

const windowStub = { // Actual production APIs run against this small deterministic game-world fixture.
  CalendarSystem: { currentWeekdayName: () => 'Day 1', currentSeason: () => ({ name: 'Highheat' }) },
  Fishing: { timeOfDay: () => 'day' },
  ConditionRegistry: { rollIndependentEligible: entries => entries.filter(entry => entry.chance === 1) },
  GameRandom: { random: () => 0 },
  LocalDBOverrides: { loadDatabase: async id => id === 'lootPools' ? pools : { shops: {} } },
  CreatureGenetics: {
    SPECIES_ALIAS: { 'voorg-ass-herd-mother': 'voorg-ass' },
    normalizeLegacyGenotype: (_kind, genes) => genes,
    sellValueFor: () => ({ tier: 'Striking', amount: 200 }),
    genotypeTraits: (_kind, genes) => ({
      colors: [{ id: 'base', color: genes.base.color }],
      patterns: Object.entries(genes).filter(([id, gene]) => id !== 'base' && gene.enabled).map(([id, gene]) => ({ id, enabled: true, color: gene.color })),
    }),
  },
};
const context = vm.createContext({
  window: windowStub, URL,
  document: { currentScript: { src: 'https://example.test/docs/js/fur-hood-leatherworking.js' } },
  fetch: async () => ({ ok: true, json: async () => manifest }),
});
vm.runInContext(read('docs/js/loot-rolling.js'), context, { filename: 'loot-rolling.js' });
vm.runInContext(read('docs/js/animal-hides.js'), context, { filename: 'animal-hides.js' });
vm.runInContext(read('docs/js/fur-hood-leatherworking.js'), context, { filename: 'fur-hood-leatherworking.js' });
windowStub.LootRolling.init({
  calendar: { weather: 'clear' },
  getCurrentArea: () => 'map_western_slope',
  getPlayerData: () => ({ appearance: { speciesId: 'tletingan' } }),
  applyLoadedShopStock() {},
});

async function main() {
  await windowStub.LootRolling.loadLootShopConfig();
  await windowStub.FurHoodLeatherworking.ensureManifest();

  for (const [poolId, hideKey, species, motif] of [
    ['creature_puktuk', 'puktukHide', 'puktuk', 'foxtail'],
    ['creature_voorg-ass', 'voorgAssHide', 'voorg-ass', 'belly'],
    ['creature_nelk', 'nelkHide', 'nelk', 'cape'],
  ]) {
    const loot = windowStub.LootRolling.rollLootPool(poolId);
    assert.equal(loot[hideKey], 1, poolId + ' awards a guaranteed hide');
    assert(index[hideKey]?.cat === 'material', hideKey + ' is catalogued as a normal Pack material');
    assert(manifest.species[species], species + ' has authored fur-hood rendering');
    const genotype = { base: { color: '#927955' }, [motif]: { enabled: true, copies: 2, color: '#b9c6ad' } };
    const creature = { creatureKey: species, genotype }; // This original genetic coat must follow the item through butchering and crafting.
    const hide = windowStub.AnimalHides.recordFromCreature(hideKey, creature, 1, 24);
    assert.equal(hide.kind, species);
    assert.equal(hide.stars, 3);
    creature.genotype.base.color = '#000000';
    assert.equal(hide.genotype.base.color, '#927955', 'Hide must snapshot source coat at death');
    const hood = windowStub.FurHoodLeatherworking.fromHide(hide);
    assert.equal(hood.kind, species);
    assert.equal(hood.baseColor, '#927955');
    assert.equal(hood.genotype[motif].color, '#b9c6ad');
    assert.equal(windowStub.AnimalHides.groupsFor(hideKey, 1)[0].hideRecord.genotype.base.color, '#927955');
  }

  const herdHide = windowStub.AnimalHides.recordFromCreature(
    'voorgAssHide', { creatureKey: 'voorg-ass-herd-mother', genotype: { base: { color: '#99bf99' } } }, 1, 24,
  );
  assert.equal(herdHide.kind, 'voorg-ass', 'Herd-Mother hides keep the existing species alias for matching fur hood sprites');
  assert.equal(windowStub.FurHoodLeatherworking.fromHide(herdHide).kind, 'voorg-ass');

  for (const poolId of ['creature_uumkaoii-wild', 'creature_uumkaoii-wild-den-mother']) {
    const loot = windowStub.LootRolling.rollLootPool(poolId);
    assert(loot.uumkaoiiShell >= 1, poolId + ' awards an Uumkao\'ii shell');
    assert(Object.keys(loot).every(key => !key.endsWith('Hide')), poolId + ' must not award fur hides');
  }
  assert.equal(index.uumkaoiiShell.cat, 'material');
  assert.equal(windowStub.AnimalHides.isHide('uumkaoiiShell'), false, 'Shells cannot become fur hoods');
  assert.equal(windowStub.AnimalHides.recordFromCreature('uumkaoiiShell', { creatureKey: 'uumkaoii' }, 1, 18), null);
  assert.deepEqual(pools.pools.creature_uumkaoii.entries, [], 'Companion Uumkao\'ii keeps its intentionally empty loot table');
  console.log('Wildlife shell, genotype hides and fur-hood crafting integration regression passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
