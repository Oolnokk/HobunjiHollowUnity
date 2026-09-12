const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
assert.strictEqual(caveObject.visual?.facing, 'north', 'Banubu Cave entrance must face out of the north-facing cliff');

const embedded = locale.embeddedTiles || {};
assert(Object.keys(embedded).length >= 6, 'Banubu Cave needs a substantial embedded rear footprint');
for (const [key, rule] of Object.entries(embedded)) {
  assert(locale.tiles?.[key], `embedded cell ${key} must also be a real locale footprint tile`);
  assert.strictEqual(rule.terrain, 'plateau', `embedded cell ${key} must require plateau mass`);
  assert.strictEqual(rule.carveToLocaleFloor, true, `embedded cell ${key} must carve the host plateau`);
  assert.strictEqual(rule.height?.mode, 'relativeRange', `embedded cell ${key} must compare host height to the cave floor`);
  assert((rule.height?.min ?? 0) >= 1, `embedded cell ${key} must require plateau above the cave floor`);
}

const anchors = locale.terrainAnchors || {};
const freeApproach = Object.values(anchors).filter(rule => rule.terrain === 'free' && rule.strength === 'required');
assert(freeApproach.length >= 3, 'Banubu Cave needs a required open approach before the cliff mouth');
const cliffMouth = Object.values(anchors).filter(rule => rule.terrain === 'plateauCliff' && rule.strength === 'required');
assert(cliffMouth.length >= 3, 'Banubu Cave needs a required cliff-edge mouth line');
for (const rule of cliffMouth) assert.strictEqual(rule.facing, 'north', 'Banubu cave mouth probes must face north/outward');
assert.deepStrictEqual(locale.placement?.terrainAnchors, locale.terrainAnchors, 'editor-persistence terrain anchors must mirror runtime terrain anchors');
assert.deepStrictEqual(locale.placement?.embeddedTiles, locale.embeddedTiles, 'editor-persistence embedded cells must mirror runtime embedded cells');

const npc = (locale.npcAnchors || []).find(anchor => anchor.npcId === 'banubu');
assert(npc, 'Banubu must remain anchored inside his cave locale');

const indexEntry = index.locales.find(entry => entry.id === locale.id);
assert(indexEntry, 'Banubu Cave must remain registered in the locale index');
assert.strictEqual(indexEntry.name, "Banubu's Cave", 'locale index must expose the cave name to loaders/UI');

const repoRoot = path.resolve(__dirname, '..');
const caveRuntime = fs.readFileSync(path.join(repoRoot, 'docs/js/locale-cave-runtime.js'), 'utf8');
const zoneRenderer = fs.readFileSync(path.join(repoRoot, 'docs/js/zone-den-totem-features.js'), 'utf8');
const labPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/wilderness-generation-lab/lab-banubu-cave.js'), 'utf8');
assert(caveRuntime.includes('generateZoneWorkspace = function localeCaveGenerateZoneWorkspace'), 'game wilderness generation must register placed locale caves');
assert(zoneRenderer.includes('LocaleCaveRuntime?.cavesForZone?.(mapId)'), 'game cave renderer must consume locale cave registrations');
assert(zoneRenderer.includes('DEN_SIZE_SCALE * authoredScale'), 'authored 2x cave scale must multiply the normal game cave scaling path');
assert(labPreview.includes('ZoneFeatures.buildAnimalDenMeshes(scene, mergedZGrid(merged), [], LAB_CAVE_MAP_ID)'), 'Wilderness Lab must invoke the exact game cave renderer for Banubu Cave');

console.log('Banubu Cave locale + shared game-render regression checks passed');
