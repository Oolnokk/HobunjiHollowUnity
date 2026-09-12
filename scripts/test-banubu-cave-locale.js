const assert = require('assert');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');
const index = require('../docs/config/locales/index.json');

assert.strictEqual(locale.name, "Banubu's Cave", 'Banubu landmark must use the cave name in-game');
assert.deepStrictEqual(locale.placement?.allowedZones, ['map_northern_cliffs'], 'Banubu Cave must be Northern Cliffs only');
assert.strictEqual(locale.placement?.clearanceTiles, 0, 'embedded cave placement must not demand a clear buffer through its host plateau');
assert.strictEqual(locale.placement?.requiresFlatGround, true, 'the exposed cave floor/approach must remain flat');

const caveObject = (locale.objects || []).find(object => object.id === 'obj_structure');
assert(caveObject, 'Banubu Cave keeps the stable obj_structure locale object id');
assert.strictEqual(caveObject.kind, 'structure', 'stable structure-kind routing must be preserved');
assert.strictEqual(caveObject.key, 'cave_small', 'Banubu Cave must render with the shared cave_small asset');
assert.strictEqual(caveObject.label, "Banubu's Cave");
assert.strictEqual(caveObject.visual?.renderer, 'cave_small');
assert.strictEqual(caveObject.visual?.scale, 2, 'Banubu cave entrance must be twice normal cave prop scale');

const embedded = locale.embeddedTiles || {};
assert(Object.keys(embedded).length >= 6, 'Banubu Cave needs a substantial embedded rear footprint');
for (const [key, rule] of Object.entries(embedded)) {
  assert(locale.tiles?.[key], `embedded cell ${key} must also be a real locale footprint tile`);
  assert.strictEqual(rule.terrain, 'plateau', `embedded cell ${key} must require plateau mass`);
  assert.strictEqual(rule.carveToLocaleFloor, true, `embedded cell ${key} must carve the host plateau`);
  assert.strictEqual(rule.height?.mode, 'relativeRange', `embedded cell ${key} must compare host height to the cave floor`);
  assert((rule.height?.min ?? 0) >= 1, `embedded cell ${key} must require plateau above the cave floor`);
}

const exposedProbeKeys = Object.keys(locale.terrainAnchors || {});
assert(exposedProbeKeys.length >= 3, 'Banubu Cave needs an exposed/free approach in front of the embedded rear');
for (const key of exposedProbeKeys) assert.strictEqual(locale.terrainAnchors[key].terrain, 'free');

const npc = (locale.npcAnchors || []).find(anchor => anchor.npcId === 'banubu');
assert(npc, 'Banubu must remain anchored inside his cave locale');

const indexEntry = index.locales.find(entry => entry.id === locale.id);
assert(indexEntry, 'Banubu Cave must remain registered in the locale index');
assert.strictEqual(indexEntry.name, "Banubu's Cave", 'locale index must expose the cave name to loaders/UI');

console.log('Banubu Cave locale regression checks passed');
