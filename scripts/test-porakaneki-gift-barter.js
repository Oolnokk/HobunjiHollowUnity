'use strict';
const assert = require('node:assert/strict'); // Covers real gifting, daily gates, returns, and genotype generation.
const fs = require('node:fs'); // Loads the same browser modules shipped to players.
const vm = require('node:vm'); // Runs deterministic interactions without a renderer.
const read = name => fs.readFileSync(name, 'utf8'); // Shared source reader for the integration harness.
let day = 1; // Advances the real Rapport midnight gate.
let roll = 0.99; // Selects bundles by default; lower values force animal or unique returns.
let heldTraits = []; // Controls preference scores independently of item quality.
let held = { kind: 'bagItem', key: 'gift', def: { label: 'Gift' }, quality: 0 }; // The player's actual held gift.
let pools = { herbs: ['herb'], fish: ['fish'], meat: ['meat'], animals: [{ itemKey: 'baby', kind: 'grehlr' }] }; // Region-native return pools.
const inventory = { gift: 30 }; // Tracks consumption and prevents duplicate returns.
const states = new Map(); // Shared existing relationship store used by the real Rapport module.
const saves = []; // Verifies the daily flag and return item exist before world saving.
const queuedGenes = []; // Verifies animal rewards use the normal carried-genotype save path.
const trinkets = []; // Captures high-tier grants to the real gear-inventory seam.
const chief = { id: 'porakaneki_chief', species: 'porakaneki', gifts: { loved: ['valuable'], liked: ['warm'] } }; // Both hunters inherit the chief's authored taste.
const relation = id => { if (!states.has(id)) states.set(id, { favor: 0, memory: [] }); return states.get(id); }; // Creates canonical records like DialogueContent.
const windowStub = {
  addEventListener() {}, __farmLog() {},
  CalendarSystem: { timeDebugSnapshot: () => ({ civilDay: day, rawDay: day, time01: 0.5 }) },
  ItemTraits: { computeItemTraits: () => heldTraits, isTraitDiscovered: () => false },
  DialogueContent: {
    getNpcDlgState: relation,
    adjustNpcFavor(id, amount) { relation(id).favor += amount; },
    npcRelationshipsSnapshot: () => Object.fromEntries(states),
    loadNpcRelationships() {},
  },
  TrinketSystem: { DEFINITIONS: { engravedWhistle: { displayName: 'Engraved Whistle' } }, grant: id => { trinkets.push(id); return id; } },
  FarmAnimals: { queueItemGenotype: (key, genotype) => queuedGenes.push({ key, genotype }) },
}; // Minimal browser context; all changed gift/rapport logic runs unmodified.
const context = vm.createContext({ window: windowStub, console }); // Shared context ensures the daily wrapper binds to the real gift API.
vm.runInContext(read('docs/config/scratchbones-config.js'), context);
vm.runInContext(read('docs/js/creature-genetics.js'), context);
windowStub.CreatureGenetics.init({ CREATURE_DB: { grehlr: { defaultSizeClass: 'medium' }, uumkaoii: { defaultSizeClass: 'medium' } }, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) });
vm.runInContext(read('docs/js/npc-gifting.js'), context);
windowStub.NpcGifting.init({
  getHeldGiftItem: () => held,
  getItemDefs: () => ({ gift: held.def, herb: { label: 'Herb' }, fish: { label: 'Fish' }, meat: { label: 'Meat' }, baby: { label: 'Grehlr Baby' } }),
  getNpcRecordById: id => id === chief.id ? chief : null,
  getPorakanekiRewardPools: () => pools, inventory, random: () => roll,
  getInventoryMax: () => 99,
  saveMemberWorldData: () => saves.push({ giftDay: relation(chief.id).lastGiftDay, items: { ...inventory } }),
});
vm.runInContext(read('docs/js/npc-social-relationship-bridge-v2.js'), context);
const gifting = windowStub.NpcGifting; // Wrapped public API used by the game's actual action dispatcher.
const rapport = windowStub.NpcRapport; // Existing daily/rollover authority.
const hunterA = { rec: { id: 'hunter_a', species: 'porakaneki' }, isPorakanekiHunter: true }; // Two unrelated camps must share one gift quota.
const hunterB = { rec: { id: 'hunter_b', species: 'porakaneki' }, isPorakanekiHunter: true };
assert(gifting.getNpcGiftOfferAction(hunterA));
assert(gifting.offerGift(hunterA));
assert.equal(relation(chief.id).favor, 1);
assert.equal(rapport.get(chief.id), 25, 'even a neutral accepted gift has positive Favor and earns 25 Rapport');
assert.equal(inventory.meat, 5);
assert.equal(inventory.gift, 29);
assert.equal(saves[0].giftDay, day, 'the daily flag is persisted before saving');
assert.equal(saves[0].items.meat, 5, 'return items are included in the same save');
assert.equal(gifting.offerGift(hunterB), false);
assert.equal(gifting.offerGift({ rec: chief }), false);
assert.equal(gifting.getNpcGiftOfferAction(hunterB), null);
assert.equal(inventory.gift, 29, 'blocked duplicate gifts consume nothing');
assert.equal(states.has('hunter_a'), false, 'procedural ids do not create separate relationships');

day++;
assert.equal(rapport.get(chief.id), 0, 'Rapport resets at the existing daily boundary');
heldTraits = ['warm'];
held.quality = 100;
assert(gifting.offerGift(hunterB));
assert.equal(inventory.meat, 15, '+4 gains return a ten-item bundle');
assert.equal(rapport.get(chief.id), 25, 'quality does not alter the flat Rapport bonus');

day++;
heldTraits = ['valuable'];
assert(gifting.offerGift(hunterA));
assert.equal(inventory.meat, 30, '+10 gains return a fifteen-item bundle when the unique roll misses');
day++;
roll = 0;
assert(gifting.offerGift(hunterB));
assert.deepEqual(trinkets, ['engravedWhistle'], 'the highest current Favor gain can award the whistle');

day++;
heldTraits = ['warm'];
assert(gifting.offerGift(hunterA));
assert.equal(queuedGenes.length, 1);
assert.equal(inventory.baby, 1);
assert.equal(queuedGenes[0].key, 'baby');
assert.equal(Object.entries(queuedGenes[0].genotype).filter(([key, layer]) => key !== 'base' && layer?.enabled).length, 2, 'medium animal returns guarantee two expressed patterns');
for (const rank of [1, 2, 3]) {
  const genotype = windowStub.CreatureGenetics.makeRareGiftGenotype('grehlr', rank); // Real palette/pattern constraints remain authoritative.
  assert.equal(Object.entries(genotype).filter(([key, layer]) => key !== 'base' && layer?.enabled).length, rank);
  assert.equal(genotype.mitts.enabled, true, 'the rarest authored pattern is guaranteed first');
  assert.equal(genotype.mitts.copies, 2);
  const palette = windowStub.SCRATCHBONES_CONFIG.game.creatureGenetics.palettes.default; // The least common palette tier defines rare coat colors.
  assert.equal(palette.find(entry => entry.hex === genotype.base.color).weight, 1);
  if (rank === 3) assert.notEqual(genotype.sizeClass, 'medium');
}
const dual = windowStub.CreatureGenetics.makeRareGiftGenotype('uumkaoii', 2); // Dual-color wildlife has two rare colors rather than invented pattern genes.
assert(dual.fur && dual.plates);

day++;
roll = 0.99;
pools = { herbs: ['herb'], fish: [], meat: [], animals: [] };
inventory.herb = 99;
const countBefore = inventory.gift; // Full inventories must neither consume a gift nor spend the daily quota.
assert.equal(gifting.offerGift(hunterA), false);
assert.equal(inventory.gift, countBefore);
assert.equal(rapport.canGiftToday(chief.id), true);
inventory.herb = 0;
assert(gifting.offerGift(hunterA));
assert.equal(inventory.herb, 10);

day++;
heldTraits = ['bad'];
chief.gifts.hated = ['bad'];
assert(gifting.offerGift(hunterA));
assert.equal(rapport.get(chief.id), 0, 'negative gifts add no Rapport');
assert.equal(inventory.herb, 15, 'low/unfavorable gifts still receive a small return');
const npc = { rec: { id: 'town_npc', gifts: { liked: ['bad'] } } }; // The positive Rapport policy applies across NPC types, not just Porakaneki.
assert(gifting.offerGift(npc));
assert.equal(rapport.get('town_npc'), 25);
assert.equal(inventory.herb, 15, 'ordinary NPCs do not issue Porakaneki returns');
assert.equal(rapport.canGiftToday('town_npc'), false);
const gameSource = read('docs/game.js'); // Execute the shipped dependency callback against the real region/fish/loot definitions.
const regionalContext = vm.createContext({ window: windowStub, TILE: 32, Math, WILDLIFE_CREATURE_MODEL_WIDTHS: { drenkirra: 0.82 } }); // Region definitions need only the existing tile constant.
for (const name of ['EXTERIOR_ZONES', 'FISH_DEFS', 'CREATURE_DB']) {
  const definition = gameSource.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n      \\});`)); // Closing indentation identifies each complete authored top-level catalog.
  assert(definition, `the real ${name} catalog is available`);
  vm.runInContext(`const ${name} = ${definition[1]};`, regionalContext);
}
const callbackStart = gameSource.indexOf('getPorakanekiRewardPools: () => {'); // Capture exactly the callback passed to NpcGifting.init.
const callbackEnd = gameSource.indexOf('\n        clearManualHeldItem,', callbackStart);
const callback = gameSource.slice(callbackStart, callbackEnd).replace('getPorakanekiRewardPools: ', '').replace(/,\s*$/, ''); // Remove only the object property name and separator.
windowStub.LootRolling = { getLootPools: () => JSON.parse(read('docs/config/loot/loot-pools.json')).pools };
windowStub.AlchemySystem = { reagentsForZone: zone => [`herb_${zone}`] };
vm.runInContext(`let currentArea; const getPools = ${callback};`, regionalContext);
for (const [area, meatKey, animalKey] of [
  ['map_northern_cliffs', 'grehlrMeat', 'grehlrBaby'],
  ['map_southern_cloud_forest', 'garWolfMeat', 'garWolfBaby'],
  ['map_western_slope', 'uumkaoiiMeat', 'uumkaoiiEgg'],
  ['map_eastern_mire', 'uumkaoiiMeat', 'uumkaoiiEgg'],
]) {
  const result = vm.runInContext(`currentArea = ${JSON.stringify(area)}; getPools();`, regionalContext); // Each region resolves its own live pools rather than borrowing a generic reward list.
  assert(result.meat.includes(meatKey), `${area} offers its native meat`);
  assert(result.animals.some(entry => entry.itemKey === animalKey), `${area} offers its native offspring`);
  assert.deepEqual(Array.from(result.herbs), [`herb_${area}`]);
  assert(result.fish.length, `${area} offers its authored fish`);
  assert(result.animals.every(entry => !entry.itemKey.endsWith('Crate')), 'return animals use wild eggs/babies rather than livestock crates');
}
console.log('Porakaneki daily gifts, return tiers, shared quota, inventory capacity, and rare genetics passed.');
