const assert = require('assert');
const fs = require('fs');
const path = require('path');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');
const index = require('../docs/config/locales/index.json');
const terrainPlacement = require('../docs/js/locale-terrain-placement.js');

assert.strictEqual(locale.name, "Banubu's Cave", 'Banubu landmark must use the cave name in-game');
assert.deepStrictEqual(locale.placement?.allowedZones, ['map_northern_cliffs'], 'Banubu Cave must be Northern Cliffs only');
assert.strictEqual(locale.placement?.clearanceTiles, 0, 'Banubu default keeps zero clearance');
assert.strictEqual(locale.placement?.requiresFlatGround, true, 'Banubu approach/floor stays flat');
assert.strictEqual(locale.placement?.floorMode, 'nextLowerCliffTier', 'Banubu floor must follow the low side of its chosen cliff');

const expectedTiles = ['3,1','4,1','5,1','3,2','4,2','5,2','3,3','4,3','5,3'];
assert.deepStrictEqual(Object.keys(locale.tiles || {}).sort(), expectedTiles.slice().sort(), 'repo default must use the user-authored 3x3 Banubu footprint');
for (const key of expectedTiles) assert.strictEqual(locale.tiles[key]?.type, 'grass', `${key} must be grass in the Banubu default`);

const caveObject = (locale.objects || []).find(object => object.id === 'obj_structure');
assert(caveObject, 'Banubu Cave keeps the stable obj_structure id');
assert.strictEqual(caveObject.kind, 'structure');
assert.strictEqual(caveObject.key, 'cave_small');
assert.strictEqual(caveObject.label, "Banubu's Cave");
assert.deepStrictEqual({ col: caveObject.col, row: caveObject.row, w: caveObject.w, h: caveObject.h, rot: caveObject.rot }, { col: 3, row: 1, w: 3, h: 3, rot: 180 }, 'repo default must match the user-authored cave transform');

assert.deepStrictEqual(locale.npcAnchors || [], [], 'Banubu himself belongs in a future interior, not the exterior default');
assert.deepStrictEqual(locale.connectors?.map(({ id, col, row, side, label }) => ({ id, col, row, side, label })), [
  { id: 'conn_1', col: 4, row: 2, side: 'north', label: "Banubu's Cave entrance" },
], 'Banubu entrance connector must match the user-authored version');

const expectedAnchorKeys = ['3,1','4,1','5,1','3,2','4,2','5,2'];
const anchors = locale.terrainAnchors || {};
assert.deepStrictEqual(Object.keys(anchors).sort(), expectedAnchorKeys.slice().sort(), 'Banubu default must use the six authored cliff probes');
for (const key of expectedAnchorKeys) {
  const rule = anchors[key];
  assert.strictEqual(rule?.terrain, 'plateauCliff', `${key} must require an internal plateau cliff`);
  assert.strictEqual(rule?.strength, 'required');
  assert.strictEqual(rule?.facing, 'any');
  assert.strictEqual(rule?.height?.mode, 'relativeRange');
  assert.strictEqual(rule?.height?.min, 1);
  assert.strictEqual(rule?.height?.max, null);
}
assert.deepStrictEqual(locale.placement?.terrainAnchors, locale.terrainAnchors, 'editor-persistence terrain anchors must mirror runtime terrain anchors');
assert.deepStrictEqual(locale.embeddedTiles || {}, {}, 'user-authored Banubu default has no embedded tiles');
assert.deepStrictEqual(locale.placement?.embeddedTiles || {}, {}, 'editor-persistence embedded tiles must also be empty');

const compiled = terrainPlacement.compileLocale(locale, 1);
assert(compiled, 'Banubu default must compile for terrain-aware placement');
assert.strictEqual(compiled.tiles.size, 9, 'compiled Banubu footprint must remain 3x3 at 1x density');
assert.strictEqual(compiled.probes.size, 6, 'compiled Banubu rules must include all six authored cliff probes');

const indexEntry = index.locales.find(entry => entry.id === locale.id);
assert(indexEntry, 'Banubu Cave must remain registered in the locale index');
assert.strictEqual(indexEntry.name, "Banubu's Cave");

const repoRoot = path.resolve(__dirname, '..');
const caveRuntime = fs.readFileSync(path.join(repoRoot, 'docs/js/locale-cave-runtime.js'), 'utf8');
const zoneRenderer = fs.readFileSync(path.join(repoRoot, 'docs/js/zone-den-totem-features.js'), 'utf8');
const labPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/wilderness-generation-lab/lab-banubu-cave.js'), 'utf8');
const localeEditorPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/locale-preview3d.js'), 'utf8');
assert(caveRuntime.includes('generateZoneWorkspace = function localeCaveGenerateZoneWorkspace'), 'game wilderness generation must register placed locale caves');
assert(zoneRenderer.includes('LocaleCaveRuntime?.cavesForZone?.(mapId)'), 'game cave renderer must consume locale cave registrations');
assert(caveRuntime.includes('floorTier: Number.isFinite(Number(instance.floorTier))'), 'locale cave registry must preserve the placed locale floor tier');
assert(zoneRenderer.includes('Number.isFinite(Number(cave.floorTier)) ? Number(cave.floorTier) : sampledTier'), 'locale cave renderer must anchor terrain-aware caves to their locale floor tier');
assert(labPreview.includes('ZoneFeatures.buildAnimalDenMeshes(scene, mergedZGrid(merged), [], LAB_CAVE_MAP_ID)'), 'Wilderness Lab must invoke the exact game cave renderer for Banubu Cave');
assert(localeEditorPreview.includes('const placed = currentInstance || currentWorkspace?.localeInstances'), 'Locale Editor preview camera must focus the actual rendered locale instance first');
assert(localeEditorPreview.includes("if (value == null || value === '') return null"), 'Locale Editor preview camera must not coerce a missing anchor to tile 0,0');
assert(localeEditorPreview.includes('const bounds = compiled?.footprint || compiled?.bounds'), 'Locale Editor preview camera must orbit the painted locale footprint');

console.log('Banubu authored-default + terrain/runtime regression checks passed');
