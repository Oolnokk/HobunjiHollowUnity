'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const random = Object.create(Math); // Deterministic rolls without replacing global Math.random.
const ctx = { Math: random, console, addEventListener() {} };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const path of ['docs/config/scratchbones-config.js', 'docs/js/creature-genetics.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), ctx);
const G = ctx.CreatureGenetics;
G.init({ CREATURE_DB: { puktuk: { label: 'Puktuk' }, 'dabinggi-hound': { label: 'Dabinggi-hound' } }, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });
const genome = { practical: { speedy: 2, fierce: 2, milk: 2, fertile: 2 } };
const enduringGenome = { practical: { speedy: 2, enduring: 2, milk: 2, fertile: 2 } }; // Separate valid genetic specialization.
assert.equal(G.practicalMultiplier(null, 'speedy'), 1);
assert.equal(G.practicalCopies({ practical: { speedy: 500 } }, 'speedy'), 2);
assert.equal(G.practicalCopies({ practical: { speedy: -5 } }, 'speedy'), 0);
assert.equal(G.practicalMultiplier(genome, 'speedy'), 1.2);
assert.equal(G.practicalMultiplier(genome, 'fierce'), 1.15);
assert.equal(G.practicalMultiplier(enduringGenome, 'enduring'), 1.25);
assert.equal(G.practicalMultiplier(genome, 'fertile'), 1.3);
assert.equal(G.practicalResource('puktuk', genome).itemKey, 'puktukMilk');
assert.equal(G.practicalResource('puktuk', {}), null);
assert.equal(G.practicalResource('gar-wolf', genome), null);
assert.equal(G.practicalResource('dabinggi-hound', { practical: { egg: 1 } }).itemKey, 'dabinggiHoundEggs');
assert.equal(G.practicalTraitList('puktuk', genome).find(t => t.id === 'milk').label, 'Milk Puktuk');
random.random = () => 0.9;
assert.equal(G.crossPracticalGenes('puktuk', genome, genome, 0).speedy, 2);
assert.equal(G.crossPracticalGenes('puktuk', genome, {}, 0).milk, 1);
assert.equal(G.crossPracticalGenes('puktuk', {}, {}, 0).speedy, undefined);
assert.equal(G.rollPracticalGenes('puktuk').milk, undefined);
random.random = () => 0;
assert.equal(G.rollPracticalGenes('puktuk').milk, 2);
assert.equal(G.rollPracticalGenes('gar-wolf').milk, undefined);
assert.equal(G.crossPracticalGenes('puktuk', {}, {}, 0.05).milk, 1);
assert.equal(G.PRACTICAL_TRAIT_LIMITS.stable, 2);
assert.equal(G.PRACTICAL_TRAIT_LIMITS.livestock, 2);
const overCap = { practical: { speedy: 2, fierce: 1, enduring: 2, fertile: 2, productive: 1, bountiful: 2, fineProducer: 1, milk: 2 } };
assert.equal(G.practicalMultiplier(overCap, 'enduring'), 1);
assert.equal(G.practicalResource('puktuk', overCap), null);
assert.equal(G.practicalTraitList('puktuk', overCap).length, 4);
assert.equal(G.practicalTraitList('puktuk', overCap).filter(t => t.group === 'stable').length, 2);
assert.equal(G.practicalTraitList('puktuk', overCap).filter(t => t.group === 'livestock').length, 2);
assert.equal(overCap.practical.enduring, 2, 'legacy reads do not mutate saved genomes');
const fresh = G.rollPracticalGenes('puktuk'); // All genes roll under forced zero; limiter must remove extras.
assert.equal(Object.keys(fresh).length, 4);
assert.equal(G.practicalTraitList('puktuk', { practical: fresh }).length, 4);
const offspring = G.crossPracticalGenes('puktuk', genome, enduringGenome, 1);
assert.equal(Object.keys(offspring).length, 4);
assert.equal(G.practicalTraitList('puktuk', { practical: offspring }).length, 4);
random.random = () => 0.9;
const twoCopies = G.crossPracticalGenes('puktuk', genome, genome, 0);
assert.equal(twoCopies.speedy, 2, 'two copies of a gene occupy one slot');
assert.equal(Object.keys(twoCopies).length, 4);
const def = { moveSpeed: 100, chaseSpeed: 200, attackDamage: 20 };
const animal = { def, genotype: genome };
G.applyWildPracticalTraits(animal);
assert.equal(animal.def.moveSpeed, 120);
assert.equal(animal.def.chaseSpeed, 240);
assert.ok(Math.abs(animal.def.attackDamage - 23) < 1e-10);
assert.equal(def.moveSpeed, 100);
G.applyWildPracticalTraits(animal);
assert.equal(animal.def.moveSpeed, 120);
const companion = { def, genotype: genome, isCompanion: true };
G.applyWildPracticalTraits(companion);
assert.equal(companion.def, def);
vm.runInContext(fs.readFileSync('docs/js/combat/companion-offense.js', 'utf8'), ctx);
assert.equal(ctx.CompanionOffense.getModifiers(companion, {}).damage, 1.15);
assert.equal(ctx.CompanionOffense.getModifiers(animal, {}).damage, 1);
const healthy = { genotype: enduringGenome, maxHealth: 80, health: 80, maxStamina: 40, stamina: 40 };
assert.equal(G.applyPracticalCapacities(healthy), true);
assert.equal(healthy.maxHealth, 100);
assert.equal(healthy.health, 100);
assert.equal(healthy.maxStamina, 50);
assert.equal(healthy.stamina, 50);
G.applyPracticalCapacities(healthy);
assert.equal(healthy.maxHealth, 100);
assert.equal(healthy.maxStamina, 50);
const injured = { genotype: enduringGenome, maxHealth: 80, health: 20, maxStamina: 40, stamina: 0, exhaustion: { active: true } };
G.applyPracticalCapacities(injured);
assert.equal(injured.health, 20);
assert.equal(injured.stamina, 0);
assert.equal(injured.maxHealth, 100);
assert.equal(injured.maxStamina, 50);
const late = { genotype: enduringGenome, maxHealth: 80, health: 0 };
G.applyPracticalCapacities(late);
late.maxStamina = late.stamina = 40;
G.applyPracticalCapacities(late);
assert.equal(late.health, 0);
assert.equal(late.maxHealth, 100);
assert.equal(late.stamina, 50);
const plain = { maxHealth: 80, health: 80, maxStamina: 40, stamina: 40 };
assert.equal(G.applyPracticalCapacities(plain), false);
assert.equal(plain.maxHealth, 80);
const wild = { def, genotype: enduringGenome, maxHealth: 80, health: 80, maxStamina: 40, stamina: 40 };
G.applyWildPracticalTraits(wild);
G.applyWildPracticalTraits(wild);
assert.equal(wild.maxHealth, 100);
assert.equal(wild.maxStamina, 50);
const mount = { genotype: enduringGenome, isCompanion: true, stableRole: 'mount', maxHealth: 80, health: 80, maxStamina: 40, stamina: 40 };
G.applyPracticalCapacities(mount);
assert.equal(mount.maxHealth, 100);
assert.equal(mount.maxStamina, 50);
const rsSource = fs.readFileSync('docs/js/combat/resource-system.js', 'utf8');
const mountSource = fs.readFileSync('docs/js/mount-system.js', 'utf8');
assert.ok(rsSource.includes('window.CreatureGenetics?.applyPracticalCapacities?.(entity)'));
assert.ok(mountSource.includes("practicalMultiplier?.(mountRideEntity.genotype, 'fierce')"));
// Exercise the actual ResourceSystem initializer, including ordinary actors and repeated initialization.
vm.runInContext(rsSource, ctx);
const actual = { genotype: enduringGenome, maxHealth: 80, health: 80, maxStamina: 40, stamina: 40 };
ctx.ResourceSystem.initEntity(actual);
ctx.ResourceSystem.initEntity(actual);
assert.equal(actual.maxHealth, 100);
assert.equal(actual.maxStamina, 50);
assert.equal(ctx.ResourceSystem.getEffectiveMax(actual, 'health'), 100);
assert.equal(ctx.ResourceSystem.getEffectiveMax(actual, 'stamina'), 50);
const legacy = { maxHealth: 80, health: 80, maxStamina: 40, stamina: 40 };
ctx.ResourceSystem.initEntity(legacy);
assert.equal(ctx.ResourceSystem.getEffectiveMax(legacy, 'health'), 80);
assert.equal(ctx.ResourceSystem.getEffectiveMax(legacy, 'stamina'), 40);
// Drive the actual daily resource scheduler and harvest implementation in an isolated farm fixture.
ctx.CreatureTextureCache = { create: () => ({}) };
ctx.InventoryStacks = { MAX_TOTAL: 999 };
const farmSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8').replace('window.FarmAnimals = {', 'window.FarmAnimals = { collectResource, breedingGeneMultiplier,');
vm.runInContext(farmSource, ctx);
const livestock = [
  { id: 'milk', kind: 'puktuk', barnId: 'barn', genotype: { practical: { milk: 2, bountiful: 1 } }, heartLevel: 2.5, resourceReady: true },
  { id: 'oil', kind: 'grehlr', barnId: 'barn', genotype: { practical: { productive: 1, fineProducer: 1 } }, heartLevel: 2.5, resourceReady: false, daysUntilResource: 3 },
  { id: 'stasis', kind: 'puktuk', genotype: { practical: { milk: 1 } }, resourceReady: false },
  { id: 'plain', kind: 'puktuk', barnId: 'barn', genotype: {}, resourceReady: false, daysUntilResource: 2 },
]; // Cover genetic secondary products, cooldown, quality, stasis and unchanged legacy behavior.
const inventory = { puktukMilk: 998 };
const itemDefs = { puktukWool: {label:'Puktuk Wool'}, grehlrStinkOil: {label:'Stink Oil'} };
const quality = [];
let saves = 0;
ctx.FarmAnimals.init({
  ITEM_DEFS: itemDefs, inventory,
  LIVESTOCK_RESOURCE_DEFS: { puktuk: {itemKey:'puktukWool', cooldownDays:2}, grehlr: {itemKey:'grehlrStinkOil', cooldownDays:3} },
  loadWorldLivestock: () => livestock, saveWorldLivestock: () => { saves++; },
  rollItemStars: () => 4, recordItemQuality: (...args) => quality.push(args),
});
assert.ok(itemDefs.puktukMilk);
assert.ok(itemDefs.dabinggiHoundEggs);
ctx.FarmAnimals.tickResources();
assert.equal(livestock[0].additionalResources.puktukMilk.ready, true);
assert.equal(livestock[0].resourceReady, true);
assert.equal(livestock[1].daysUntilResource, 1);
assert.equal(livestock[2].additionalResources, undefined);
assert.equal(livestock[3].daysUntilResource, 1);
assert.equal(ctx.FarmAnimals.collectResource('milk','puktukMilk').ok, true);
assert.equal(inventory.puktukMilk, 999);
assert.equal(quality[0][2], 1);
assert.equal(livestock[0].resourceReady, true);
assert.equal(livestock[0].additionalResources.puktukMilk.ready, false);
assert.equal(ctx.FarmAnimals.collectResource('milk','puktukWool').ok, true);
assert.equal(inventory.puktukWool, 2);
assert.equal(quality[1][2], 2);
assert.equal(ctx.FarmAnimals.collectResource('milk','dabinggiHoundEggs').ok, false);
ctx.FarmAnimals.tickResources();
assert.equal(livestock[0].additionalResources.puktukMilk.ready, true);
assert.equal(ctx.FarmAnimals.collectResource('milk','puktukMilk').ok, false);
assert.equal(livestock[0].additionalResources.puktukMilk.ready, true);
assert.equal(ctx.FarmAnimals.collectResource('oil').ok, true);
assert.equal(quality[2][1], 5);
assert.ok(saves > 0);
assert.ok(Math.abs(ctx.FarmAnimals.breedingGeneMultiplier({genotype: genome}, {})-1.15) < 1e-10);
assert.equal(ctx.FarmAnimals.breedingGeneMultiplier({genotype: genome}, {genotype: genome}), 1.3);
console.log('Practical animal genetics passed');
