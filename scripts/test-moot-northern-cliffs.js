// Regression coverage for the new Northern Cliffs Moot wild/farm species.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib'); // Decodes the authored PNG overlay alpha without a browser or screenshot/OCR.

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd(); // Allows tests to run against an arbitrary staged repo checkout.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8'); // Used to validate the files actually committed to Git.
const basePath = 'docs/assets/creaturesprites/'; // All five Moot assets live beside the other animal animation frames.
const expected = ['moot_idle.png', 'moot_run1.png', 'moot_run2.png', 'moot_eyes.png', 'moot_blink.png']; // Required art, including open and shut eyes.
const coatPatterns = ['overcoat', 'mitts']; // Authored overlay draw order; coloredneck is retired rather than a third inheritable allele.
for (const name of expected) {
  const bytes = fs.readFileSync(path.join(ROOT, basePath, name));
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${name} must be a PNG`);
  assert.equal(bytes.readUInt32BE(16), 1295, `${name} must retain the base frame's width`);
  assert.equal(bytes.readUInt32BE(20), 920, `${name} must retain the base frame's height`);
}
for (const pattern of [...coatPatterns, 'coloredneck']) for (const frame of ['idle', 'run1', 'run2']) {
  const name = `moot_${pattern}_${frame}.png`; // Required on all three animation poses so a visible allele never makes the compositor retry a missing frame.
  const bytes = fs.readFileSync(path.join(ROOT, basePath, 'patterns', name));
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${name} must be a PNG`);
  assert.equal(bytes.readUInt32BE(16), 1295, `${name} must align with Moot's base width`);
  assert.equal(bytes.readUInt32BE(20), 920, `${name} must align with Moot's base height`);
  assert.equal(bytes[24], 8, `${name} must have 8-bit sprite channels`);
  assert.equal(bytes[25], 6, `${name} must be RGBA, preserving transparency`);
}

function pngVisibleCoverage(relativePath) {
  const file = fs.readFileSync(path.join(ROOT, relativePath)); // Sample the actual authored overlay rather than a synthetic sprite.
  const width = file.readUInt32BE(16), height = file.readUInt32BE(20);
  assert.equal(file[24], 8); assert.equal(file[25], 6); assert.equal(file[28], 0, 'Only RGBA8 non-interlaced sprites are supported');
  const chunks = []; // Accumulates IDAT data for zlib.inflateSync.
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at), kind = file.toString('ascii', at + 4, at + 8);
    if (kind === 'IDAT') chunks.push(file.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const decoded = zlib.inflateSync(Buffer.concat(chunks)); // Raw filter-coded PNG scanlines.
  const stride = width * 4;
  let visible = 0, offset = 0, above = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = decoded[offset++], row = Buffer.alloc(stride); // Each scanline must reconstruct its own alpha.
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0, up = above[x], corner = x >= 4 ? above[x - 4] : 0;
      const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
      const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >>> 1
        : filter === 4 ? (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner) : 0;
      assert(filter >= 0 && filter <= 4);
      row[x] = (decoded[offset++] + predicted) & 255;
    }
    for (let x = 3; x < stride; x += 4) if (row[x] > 8) visible++;
    above = row;
  }
  assert.equal(offset, decoded.length, 'PNG decoding must consume every scanline');
  return visible / (width * height);
}
const eyeCoverage = pngVisibleCoverage(basePath + 'moot_eyes.png'); // Detects overlays that would hide most of the animal.
const blinkCoverage = pngVisibleCoverage(basePath + 'moot_blink.png'); // The blink sheet must not paint a full opaque card.
console.log('Moot overlay visible coverage:', { eyes: eyeCoverage.toFixed(5), blink: blinkCoverage.toFixed(5) });
assert(eyeCoverage < 0.25, 'Moot open-eye overlay must be sparse, not a full-card mask');
assert(blinkCoverage < 0.25, 'Moot blinking must not flash an opaque rectangle over the sprite');

const config = {
  game: {
    livestock: { itemKinds: {}, animalWidths: {}, diet: {}, resources: {} },
    wildlife: { denMothers: { moot: { nestItemKey: 'staleMootEgg' }, 'moot-herd-mother': { nestItemKey: 'staleMootMotherEgg' } } },
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
assert.equal(config.game.wildlife.denMothers['moot-herd-mother'], undefined, 'Moot Herd-Mothers must not become cavern guardians');

const creatureDb = { 'uumkaoii-wild': {
  label: 'Wild Uumkao\'ii', hostile: false, speed: 1.25, health: 20,
  sprites: { idle: 'old.png', run: ['old1.png', 'old2.png'] },
} }; // Existing herbivore baseline for overworld locomotion and threat reaction.
const zone = {
  roamingHerdSpecies: ['voorg-ass'], roamingHerdCount: 2,
  roamingForagerSpecies: ['nazgraku', 'moot'], roamingForagerCount: 2,
  herbivoreSpecies: ['uumkaoii-wild', 'moot'],
  denSpecies: ['grehlr', 'moot'],
}; // Includes a pre-migration Moot forager slot, which registration must convert without displacing Nazgraku.
const itemDefs = { mootBaby: { label: 'Baby Moot', cat: 'material', sellPrice: 0 } }; // Legacy placeholder from existing saves.
const inventoryItems = []; // Must receive meat/hide exactly once even across repeated registration.
const deps = {
  CREATURE_DB: creatureDb,
  EXTERIOR_ZONES: { map_northern_cliffs: zone, map_western_slope: { roamingForagerSpecies: [] } },
  DEN_MOTHER_DEFS: { moot: { creatureKey: 'moot' }, 'moot-herd-mother': { creatureKey: 'moot-herd-mother' } },
  ITEM_DEFS: itemDefs, inventoryItems,
}; // Same injected-dependency shape the real wildlife init already receives.

assert.equal(api.register(deps), true);
assert.equal(api.register(deps), true, 'Repeated registration is idempotent');
assert.equal(creatureDb.moot.label, 'Moot');
assert.equal(api.HERD_MOTHER_KIND, 'moot-herd-mother');
assert.equal(creatureDb['moot-herd-mother']?.label, 'Herd-Mother', 'Moot mother is a real spawnable creature variant');
assert.equal(creatureDb['moot-herd-mother']?.defaultSizeClass, 'large');
assert.equal(creatureDb['moot-herd-mother']?.lootPool, 'creature_moot', 'Mother yields normal Moot products alongside recovered babies');
assert.deepEqual(creatureDb['moot-herd-mother']?.sprites, creatureDb.moot.sprites, 'Mother shares adult Moot animation frames');
assert.equal(creatureDb.moot.hostile, false);
assert.equal(creatureDb.moot.lootPool, 'creature_moot');
assert.equal(creatureDb.moot.defaultSizeClass, 'large');
assert.equal(creatureDb.moot.spriteAspect, 920 / 1295);
const oldWorldUnitsPerPixel = 1.7 / 1617; // Measures visible art scale independently of the old transparent padding.
const mootBestiary = JSON.parse(read('docs/config/creatures/hobunji-creature-bestiary.json')).creatures.find(entry => entry.id === 'moot'); // Standalone Head Rig view of the same sprite.
for (const def of [creatureDb.moot, creatureDb['moot-herd-mother'], mootBestiary]) {
  assert.ok(Math.abs(def.modelWidth / 1295 - oldWorldUnitsPerPixel) < 1e-12);
  assert.ok(Math.abs(def.modelWidth * def.spriteAspect / 920 - oldWorldUnitsPerPixel) < 1e-12);
}
assert.equal(config.game.livestock.animalWidths.moot, creatureDb.moot.modelWidth, 'Default farm and nursery scale matches the original pixel density');
assert.equal(creatureDb['moot-herd-mother'].spriteAspect, creatureDb.moot.spriteAspect);
assert.equal(creatureDb.moot.speed, 1.25, 'Moot retains native herbivore wandering behavior');
assert.deepEqual(JSON.parse(JSON.stringify(creatureDb.moot.sprites)), {
  idle: api.SPRITES.idle, run: [api.SPRITES.run1, api.SPRITES.run2],
});
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.eyes.open, api.SPRITES.eyes);
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.eyes.blink, api.SPRITES.blink);
assert.deepEqual(Array.from(windowStub.CreatureGeneticsRender.SPECIES.moot.patterns), coatPatterns, 'Runtime renders overcoat under independently inherited mitts');
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.fullBaseRecolor, false, 'Moot must not tint claws, teeth, hooves or outlines');
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.baseRecolorKeyHex, '#9CBD9E', 'Moot coat tint uses only its mint-green authored pigment family');
assert.equal(windowStub.CreatureGeneticsRender.SPECIES.moot.patternRecolorKeys.overcoat.hex, '#9CBD9E', 'Overcoat selectively recolors mint pigment instead of teeth/hooves');
assert.deepEqual(Array.from(windowStub.CreatureGeneticsRender.SPECIES.moot.clipPatternsToBase), ['overcoat'], 'Only overcoat opaque padding is clipped to the animal silhouette');

assert.deepEqual(JSON.parse(JSON.stringify(zone.roamingHerdSpecies)), ['voorg-ass', 'moot'], 'Moot joins Voorg-Ass in the daily herd species pool');
assert.deepEqual(JSON.parse(JSON.stringify(zone.roamingForagerSpecies)), ['nazgraku'], 'Nazgraku keeps its own dedicated forager slot');
assert.equal(zone.roamingForagerCount, 1, 'Moots must not reserve a permanent small forager slot');
assert.equal(zone.roamingHerdCount, 2, 'Two herd slots now rotate between Voorg-Ass and Moot');
assert.deepEqual(JSON.parse(JSON.stringify(zone.denSpecies)), ['grehlr']);
assert.deepEqual(JSON.parse(JSON.stringify(zone.herbivoreSpecies)), ['uumkaoii-wild']);
assert.equal(deps.DEN_MOTHER_DEFS.moot, undefined);
assert.equal(deps.DEN_MOTHER_DEFS['moot-herd-mother'], undefined);
assert.equal(deps.EXTERIOR_ZONES.map_western_slope.roamingForagerSpecies.length, 0, 'Moot does not leak to other regions');
assert.equal(itemDefs.mootBaby.cat, 'livestock');
assert(itemDefs.mootBaby.tags.includes('Baby'));
assert.equal(itemDefs.mootHide.cat, 'material');
assert.equal(itemDefs.mootMeat.cat, 'ingredient');
assert.deepEqual(inventoryItems.map(item => item.key).sort(), ['mootHide', 'mootMeat']);
assert(log.some(x => /\[moot\].*northernCliffs=ok.*herds=\[voorg-ass,moot\]/.test(x.message)), 'In-game debug log names both herd species on mobile');

vm.runInContext(read('docs/js/creature-genetics.js'), context, { filename: 'creature-genetics.js' });
windowStub.CreatureGenetics.init({ CREATURE_DB: creatureDb, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });
assert.equal(windowStub.CreatureGenetics.SPECIES_ALIAS['moot-herd-mother'], 'moot', 'Mother inherits Moot recolor/eye/rig identity');
const parentA = windowStub.CreatureGenetics.makeDefaultGenotype('moot'); // Uses the existing optional-pattern roll and color inheritance for both Moot markings.
const parentB = windowStub.CreatureGenetics.makeDefaultGenotype('moot');
const child = windowStub.CreatureGenetics.crossOffspring(parentA, parentB, 'moot');
assert.equal(parentA.sizeClass, 'large');
assert.equal(child.sizeClass !== undefined, true);
assert(/^#[a-f0-9]{6}$/i.test(child.base.color));
assert.deepEqual(Object.keys(child).sort(), ['base', 'mitts', 'overcoat', 'secondary', 'sizeClass'], 'Both authored patterns inherit their own alleles');
for (const pattern of coatPatterns) {
  assert(/^#[a-f0-9]{6}$/i.test(parentA[pattern].color), `${pattern} receives a valid coat color`);
  assert.equal(typeof child[pattern].enabled, 'boolean', `${pattern} has an independent expressed state`);
  assert(child[pattern].copies >= 0 && child[pattern].copies <= 2, `${pattern} inherits Mendelian allele copies`);
}
assert(!('coloredneck' in child), 'Colored neck is not a competing new genotype');
const originalOvercoat = parentA.overcoat; // Only legacy input is overwritten below; actual generated specimens remain unchanged.
const legacyMoot = { ...parentA, coloredneck: { color: '#c7aa77', copies: 2, enabled: true, inheritance: 'dominant' } }; // Simulates an older saved marking and its exact pigmentation.
delete legacyMoot.overcoat;
delete legacyMoot.secondary; // A pre-A/B record does not have a separate secondary locus.
const migrated = windowStub.CreatureGenetics.normalizeLegacyGenotype('moot', legacyMoot); // Read-time migration keeps old saves and wild bloodlines intact.
assert.equal(migrated.overcoat.color, '#c7aa77', 'Colored neck now appears as overcoat without losing its color');
assert.equal(migrated.overcoat.copies, 2, 'Migration preserves inherited allele strength');
assert(!('coloredneck' in migrated), 'Legacy marking is removed from the active genome');
assert.equal(legacyMoot.overcoat, undefined, 'Read-time migration must not mutate the saved object');
assert.equal(parentA.overcoat, originalOvercoat, 'Existing modern genetics remain unchanged');
const legacyChild = windowStub.CreatureGenetics.crossOffspring(legacyMoot, legacyMoot, 'moot', 0); // Both parents give one guaranteed overcoat allele.
assert.equal(legacyChild.overcoat.copies, 2, 'Offspring inherits a migrated overcoat from both parents');
assert.equal(legacyChild.overcoat.enabled, true, 'Legacy coat remains visibly expressed after breeding');
const modernWins = windowStub.CreatureGenetics.normalizeLegacyGenotype('moot', { ...legacyMoot, overcoat: parentA.overcoat }); // New allele always takes precedence.
assert.equal(modernWins.overcoat.color, parentA.overcoat.color);
assert(!('coloredneck' in modernWins));
const traitNames = windowStub.CreatureGenetics.genotypeTraits('moot', migrated).patterns.map(pattern => pattern.label); // Reuses Farm/Stable trait-chip formatting.
assert(traitNames.includes('Overcoat'), 'Migrated overcoat appears in the genotype UI');
assert(!traitNames.includes('Coloredneck'), 'Retired colored neck is absent from trait chips');
assert.match(read('docs/js/creature-genetics-render.js'), /kind === 'moot' && genotype\?\.coloredneck/, 'Standalone renderer also translates legacy colored-neck genotypes');
assert.match(read('docs/tools/animation-author/rig-preview-species.js'), /patterns:\s*\['overcoat', 'mitts'\]/, 'Animation Author recognizes the same two patterns');
assert.equal(windowStub.CreatureGenetics.creatureSizeScale('moot', 'large').x, 1.3, 'Moot borrows Uumkao\'ii size calibration until a dedicated rig is authored');

const loot = JSON.parse(read('docs/config/loot/loot-pools.json')); // Live corpse loot table used by game.js.
assert.deepEqual(loot.pools.creature_moot.entries.map(entry => entry.itemKey), ['mootMeat', 'mootHide']);
assert(read('docs/js/cooking-data.js').includes('"mootMeat": {'), 'Moot meat must be recognized by the cooking registry');
assert(read('docs/js/wildlife-spawn.js').includes('window.MootRegistration?.register?.(injectedDeps)'), 'WildlifeSpawn must call the registration before spawning');
assert(read('docs/index.html').includes('js/moot-registration.js'), 'The registration must load before game.js');
assert(!read('docs/js/farm-production.js').includes('Kept safely as an item until Moot animals are available'), 'Old placeholder must not be restored');
const farmSource = read('docs/js/farm-animals.js'); // Regression for assigning a real Moot from the legacy baby item.
assert.match(farmSource, /function makeMootAnimal\(col, row, livestockId, genotype\)/, 'Moot must have a world-visible barn factory');
assert.match(farmSource, /moot:\s*makeMootAnimal/, 'Barn placement and world-load restoration must dispatch the Moot factory');
const authorSource = read('docs/js/animal-chathead-frame.js'); // Authoring tool must support all five Moot assets and editable initial rig values.
assert.match(authorSource, /REQUIRED_KINDS[^\n]*'moot'/, 'Moot is part of the author picker parity list');
assert.match(authorSource, /SEED_SOURCES[^\n]*moot: 'uumkaoii'/, 'Moot rig values are editable as a borrowed first-pass seed');


console.log('PASS Moot wild/farm registry, overcoat+mitts sprites/inheritance, coloredneck migration, drops and mobile diagnostics');
