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
  for (const kind of Object.keys(manifest.species)) {
    const authoredPool = pools.pools['creature_' + kind]; // Every fur-hood animal needs a corresponding obtainable hide.
    assert(authoredPool?.entries.some(entry => entry.itemKey?.endsWith('Hide')),
      kind + ' has fur-hood art but no wild hide source');
  }
  assert(!Object.keys(manifest.species).includes('uumkaoii'), 'Uumkao\'ii shells must not accidentally become fur-hood source art');

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

  // Exercise game.js's actual corpse interaction, rather than only calling the hide API by hand.
  // This also catches a missing item definition, a wrong lootPool id or a death-handler integration regression.
  const gameSource = read('docs/game.js'); // Live game owner: this function is called by ordinary corpse interactions.
  const corpseStart = gameSource.indexOf('function makeCorpseWorldObject(c)');
  const corpseEnd = gameSource.indexOf('function getCorpseObjectAt(', corpseStart);
  assert(corpseStart >= 0 && corpseEnd > corpseStart, 'The production corpse interaction is available');
  const corpseInventory = {}; // Actual loot additions are verified here before looking up per-hide metadata.
  windowStub.InventoryStacks = { MAX_TOTAL: 99 }; // The production corpse action consults the normal maximum inventory stack size.
  windowStub.SkillSystem = { recordItemQuality() {}, rollQuality: () => 3 }; // Actual butchering also records general item-quality metadata.
  windowStub.FarmAnimals = { queueItemGenotype() {} }; // Existing Herd-Mother baby-loot compatibility hook.
  const corpseContext = vm.createContext({
    window: windowStub,
    inventory: corpseInventory,
    ITEM_DEFS: Object.fromEntries(Object.keys(index).map(key => [key, { label: index[key].label, icon: index[key].icon, sellPrice: 24 }])),
    itemIconForKey: () => '🟫',
    corpseObjects: new Set(),
    despawnCreature() {},
  });
  const corpseSource = gameSource.slice(corpseStart, corpseEnd); // Keep the extracted production implementation available for failure diagnostics.
  vm.runInContext(corpseSource, corpseContext, { filename: 'game-corpse-interaction.js' });
  function lootCorpseWithSourceDiagnostics(corpse) {
    try { return corpse.onAction('obj_loot_corpse'); }
    catch (error) {
      console.error('Real corpse implementation at failure:\n' + corpseSource.split('\n').slice(0, 100).map((line, i) => (i + 1) + ': ' + line).join('\n'));
      throw error;
    }
  }
  windowStub.AnimalHides.restore(null, {}); // Clear the manually recorded hides so this assertion proves the real corpse interaction recorded them.
  for (const [creatureKey, poolId, hideKey] of [
    ['puktuk', 'creature_puktuk', 'puktukHide'],
    ['voorg-ass', 'creature_voorg-ass', 'voorgAssHide'],
    ['nelk', 'creature_nelk', 'nelkHide'],
    ['voorg-ass-herd-mother', 'creature_voorg-ass', 'voorgAssHide'],
  ]) {
    const beforeCount = corpseInventory[hideKey] || 0;
    const creature = {
      id: 'test-' + creatureKey, creatureKey, def: { label: creatureKey, lootPool: poolId },
      genotype: { base: { color: '#776655' }, belly: { enabled: true, copies: 2, color: '#aabbcc' } },
    }; // The corpse action should snapshot this particular wild animal's coat without rerolling it.
    const corpse = corpseContext.makeCorpseWorldObject(creature);
    assert.equal(lootCorpseWithSourceDiagnostics(corpse).ok, true, creatureKey + ' corpse must be lootable');
    assert.equal(corpseInventory[hideKey], beforeCount + 1, creatureKey + ' corpse must award one hide into Pack');
    const record = windowStub.AnimalHides.groupsFor(hideKey, corpseInventory[hideKey])
      .map(group => group.hideRecord).find(hide => hide?.sourceKind === creatureKey);
    assert(record, creatureKey + ' corpse must save its own genetic provenance');
    assert.equal(record.genotype.base.color, '#776655');
    assert(windowStub.FurHoodLeatherworking.fromHide(record), creatureKey + ' corpse hide must be craftable');
  }
  for (const [creatureKey, poolId] of [
    ['uumkaoii-wild', 'creature_uumkaoii-wild'],
    ['uumkaoii-wild-den-mother', 'creature_uumkaoii-wild-den-mother'],
  ]) {
    const before = corpseInventory.uumkaoiiShell || 0;
    const corpse = corpseContext.makeCorpseWorldObject({ id: 'test-' + creatureKey, creatureKey, def: { label: creatureKey, lootPool: poolId } });
    assert.equal(lootCorpseWithSourceDiagnostics(corpse).ok, true);
    assert((corpseInventory.uumkaoiiShell || 0) > before, creatureKey + ' corpse must award shell to Pack');
  }
  assert.equal(windowStub.AnimalHides.getDebug().pack.uumkaoiiShell, undefined, 'Shell loot does not create hide metadata');

  console.log('Wildlife shell, genotype hides and fur-hood crafting integration regression passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
