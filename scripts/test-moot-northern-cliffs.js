// Regression coverage for the new Northern Cliffs Moot wild/farm species.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Allows tests to run against an arbitrary staged repo checkout.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8'); // Used to validate the files actually committed to Git.
const basePath = 'docs/assets/creaturesprites/'; // All five Moot assets live beside the other animal animation frames.
const expected = ['moot_idle.png', 'moot_run1.png', 'moot_run2.png', 'moot_eyes.png', 'moot_blink.png']; // Required art, including open and shut eyes.
for (const name of expected) {
  const bytes = fs.readFileSync(path.join(ROOT, basePath, name));
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${name} must be a PNG`);
  assert.equal(bytes.readUInt32BE(16), 1617, `${name} must retain the base frame's width`);
  assert.equal(bytes.readUInt32BE(20), 1000, `${name} must retain the base frame's height`);
}

const config = {
  game: {
    livestock: { itemKinds: {}, animalWidths: {}, diet: {}, resources: {} },
    wildlife: { denMothers: { moot: { nestItemKey: 'staleMootEgg' } } },
    creatureGenetics: { palettes: { default: [
      { id: 'brown', name: 'Brown', hex: '#6a412e', weight: 3 },
      { id: 'cream', name: 'Cream', hex: '#c7aa77', weight: 3 },
      { id: 'ash', name: 'Ash', hex: '#6d7068', weight: 3 },
    ] } },
  },
}; // Mirrors only the existing config structures Moot needs for registration, genetics and feeding.
const log = []; // Mobile debug instrumentation is checked without a browser console.
const listeners = {}; // CreatureGenetics may defer its existing unrelated species bootstraps.
const windowStub = {
  SCRATCHBONES_CONFIG: config,
  CreatureGeneticsRender: { SPECIES: {} },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: { uumkaoii: { sizeScales: {
    small: { x: 0.5, y: 0.5 }, medium: { x: 1, y: 1 }, large: { x: 1.3, y: 1.3 },
  } } } },
  addEventListener(name, listener) { listeners[name] = listener; },
  __farmLog(message, channel) { log.push({ message, channel }); },
}; // Simulates parser order and keeps registration's globals isolated from process state.
const context = vm.createContext({ window: windowStub, console, Math, Set, Array, performance: { now: () => 0 } });
vm.runInContext(read('docs/js/moot-registration.js'), context, { filename: 'moot-registration.js' });
const api = windowStub.MootRegistration; // Single integration surface used by wildlife-spawn.js and FarmProduction.
assert(api, 'Moot registration script must export the shared runtime');
assert.equal(config.game.livestock.itemKinds.mootBaby, 'moot', 'Ranch baby must become deployable before game startup');
assert.equal(config.game.livestock.diet.moot, 'prey', 'Moots eat ordinary plant fodder');
assert.equal(config.game.wildlife.denMothers.moot, undefined, 'Moots must not use cave Den-Mothers');

const creatureDb = { 'uumkaoii-wild': {
  label: 'Wild Uumkao\'ii', hostile: false, speed: 1.25, health: 20,
  sprites: { idle: 'old.png', run: ['old1.png', 'old2.png'] },
} }; // Existing herbivore baseline for overworld locomotion and threat reaction.
const zone = {
  roamingHerdSpecies: ['voorg-ass'], roamingHerdCount: 2,
  roamingForagerSpecies: ['nazgraku'], roamingForagerCount: 1,
  herbivoreSpecies: ['uumkaoii-wild', 'moot'],
  denSpecies: ['grehlr', 'moot'],
}; // Verifies that neither Voorg-Ass herds nor Nazgraku foragers are displaced.
const itemDefs = { mootBaby: { label: 'Baby Moot', cat: 'material', sellPrice: 0 } }; // Legacy placeholder from existing saves.
const inventoryItems = []; // Must receive meat/hide exactly once even across repeated registration.
const deps = {
  CREATURE_DB: creatureDb,
  EXTERIOR_ZONES: { map_northern_cliffs: zone, map_western_slope: { roamingForagerSpecies: [] } },
  DEN_MOTHER_DEFS: { moot: { creatureKey: 'moot' } },
  ITEM_DEFS: itemDefs, inventoryItems,
}; // Same injected-dependency shape the real wildlife init already receives.

assert.equal(api.register(deps), true);
assert.equal(api.register(deps), true, 'Repeated registration is idempotent');
assert.equal(creatureDb.moot.label, 'Moot');
assert.equal(creatureDb.moot.hostile, false);
assert.equal(creatureDb.moot.lootPool, 'creature_moot');
assert.equal(creatureDb.moot.defaultSizeClass, 'large');
assert.equal(creatureDb.moot.spriteAspect, 1000 / 1617);
assert.equal(creatureDb.moot.speed, 1.25, 'Moot retains native herbivore wandering behavior');
assert.deepEqual(JSON.parse(JSON.stringify(creatureDb.moot.sprites)), {
  idle: api.SPRITES.idle, run: [api.SPRITES.run1, api.SPRITES.run2],
});
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.eyes.open, api.SPRITES.eyes);
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.eyes.blink, api.SPRITES.blink);
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.patterns.length, 0);
assert.deepEqual(JSON.parse(JSON.stringify(zone.roamingHerdSpecies)), ['voorg-ass']);
assert.deepEqual(JSON.parse(JSON.stringify(zone.roamingForagerSpecies)), ['nazgraku', 'moot']);
assert.equal(zone.roamingForagerCount, 2, 'Each grazing/foraging species gets its own stable exterior slot');
assert.deepEqual(JSON.parse(JSON.stringify(zone.denSpecies)), ['grehlr']);
assert.deepEqual(JSON.parse(JSON.stringify(zone.herbivoreSpecies)), ['uumkaoii-wild']);
assert.equal(deps.DEN_MOTHER_DEFS.moot, undefined);
assert.equal(deps.EXTERIOR_ZONES.map_western_slope.roamingForagerSpecies.length, 0, 'Moot does not leak to other regions');
assert.equal(itemDefs.mootBaby.cat, 'livestock');
assert(itemDefs.mootBaby.tags.includes('Baby'));
assert.equal(itemDefs.mootHide.cat, 'material');
assert.equal(itemDefs.mootMeat.cat, 'ingredient');
assert.deepEqual(inventoryItems.map(item => item.key).sort(), ['mootHide', 'mootMeat']);
assert(log.some(x => /\[moot\].*northernCliffs=ok/.test(x.message)), 'In-game debug log makes Moot registration visible on mobile');

vm.runInContext(read('docs/js/creature-genetics.js'), context, { filename: 'creature-genetics.js' });
windowStub.CreatureGenetics.init({ CREATURE_DB: creatureDb, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });
const parentA = windowStub.CreatureGenetics.makeDefaultGenotype('moot'); // Genotype uses the generic species color inheritance, even with zero authored patterns.
const parentB = windowStub.CreatureGenetics.makeDefaultGenotype('moot');
const child = windowStub.CreatureGenetics.crossOffspring(parentA, parentB, 'moot');
assert.equal(parentA.sizeClass, 'large');
assert.equal(child.sizeClass !== undefined, true);
assert(/^#[a-f0-9]{6}$/i.test(child.base.color));
assert.deepEqual(Object.keys(child).sort(), ['base', 'sizeClass'], 'Moot breeding cannot invent missing pattern assets');
assert.equal(windowStub.CreatureGenetics.creatureSizeScale('moot', 'large').x, 1.3, 'Moot borrows Uumkao\'ii size calibration until a dedicated rig is authored');

const loot = JSON.parse(read('docs/config/loot/loot-pools.json')); // Live corpse loot table used by game.js.
assert.deepEqual(loot.pools.creature_moot.entries.map(entry => entry.itemKey), ['mootMeat', 'mootHide']);
assert(read('docs/js/cooking-data.js').includes('"mootMeat": {'), 'Moot meat must be recognized by the cooking registry');
assert(read('docs/js/wildlife-spawn.js').includes('window.MootRegistration?.register?.(injectedDeps)'), 'WildlifeSpawn must call the registration before spawning');
assert(read('docs/index.html').includes('js/moot-registration.js'), 'The registration must load before game.js');
assert(!read('docs/js/farm-production.js').includes('Kept safely as an item until Moot animals are available'), 'Old placeholder must not be restored');

console.log('PASS Moot Northern Cliffs wildlife, five sprites, farm baby, inherited coat, drops and mobile diagnostics');
