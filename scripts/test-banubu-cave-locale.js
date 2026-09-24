const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');
const hikiHikiLocale = require('../docs/config/locales/locale_hikihiki_shrine.json'); // Used to lock Hiki-hiki to the Southern Cloud Forest.
const rahayobiLocale = require('../docs/config/locales/locale_mother_rahayobi_shrine.json'); // Used to lock Mother Rahayobi to the Eastern Mire.
const nohuknukLocale = require('../docs/config/locales/locale_old_man_nohuknuk_shrine.json'); // Used to lock Old Man Nohuknuk to the Western Slope.
const index = require('../docs/config/locales/index.json');
const terrainPlacement = require('../docs/js/locale-terrain-placement.js');

assert.strictEqual(locale.name, "Banubu's Cave", 'Banubu landmark must use the cave name in-game');
assert.deepStrictEqual(locale.placement?.allowedZones, ['map_northern_cliffs'], 'Banubu Cave must be Northern Cliffs only');
assert.strictEqual(locale.placement?.alwaysVisibleOnMap, true, 'Banubu Cave must always expose its map waypoint once the zone is generated');
assert.deepStrictEqual(locale.placement?.terrainFallback, {
  mode: 'subset',
  terrainAnchors: ['4,0', '4,2', '4,3'],
  embeddedTiles: ['4,3'],
  notes: 'If the full-width cliff fit has no valid site, keep the cave on an existing north-facing internal plateau cliff using the center approach/mouth/backing probes and center embedded cell; never carve the host cliff.',
}, 'Banubu Cave must keep its authored center-cliff fallback so a strict no-match does not remove the cave/waypoint from a Tothal layout');
assert.deepStrictEqual(hikiHikiLocale.placement?.allowedZones, ['map_southern_cloud_forest'], 'Hiki-hiki shrine must be Southern Cloud Forest only');
assert.deepStrictEqual(rahayobiLocale.placement?.allowedZones, ['map_eastern_mire'], 'Mother Rahayobi shrine must be Eastern Mire only');
assert.deepStrictEqual(nohuknukLocale.placement?.allowedZones, ['map_western_slope'], 'Old Man Nohuknuk shrine must be Western Slope only');
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
assert.deepStrictEqual(caveObject.visual, { renderer: 'cave_small', scaleX: 1.5, scaleY: 1.5, scaleZ: 1, facing: 'north' }, 'Banubu cave facade must be 1.5x wider and taller without increasing its depth into the cliff');

assert.deepStrictEqual(locale.npcAnchors || [], [], 'Banubu must live in the cavern interior, not on the wilderness cave-mouth footprint');
assert.deepStrictEqual(locale.interior, {
  targetMapId: 'map_i_den_banubu',
  targetSpotId: '',
  label: "Enter Banubu's Cave",
}, 'Banubu locale must explicitly target his generated cavern interior');
assert.deepStrictEqual(locale.connectors?.map(({ id, col, row, side, label }) => ({ id, col, row, side, label })), [
  { id: 'conn_1', col: 4, row: 2, side: 'north', label: "Banubu's Cave entrance" },
], 'Banubu entrance connector must match the user-authored version');

const expectedAnchorKeys = ['3,0','4,0','5,0','3,2','4,2','5,2','3,3','4,3','5,3'];
const anchors = locale.terrainAnchors || {};
assert.deepStrictEqual(Object.keys(anchors).sort(), expectedAnchorKeys.slice().sort(), 'Banubu default must use the six paired cliff-base probes plus three front-clearance probes');
for (const key of ['3,0','4,0','5,0']) {
  const rule = anchors[key];
  assert.strictEqual(rule?.terrain, 'free', `${key} must reserve open terrain in front of the north-facing cave mouth`);
  assert.strictEqual(rule?.strength, 'required');
  assert.strictEqual(rule?.facing, 'any');
  assert.strictEqual(rule?.height?.mode, 'relativeRange');
  assert.strictEqual(rule?.height?.min, 0);
  assert.strictEqual(rule?.height?.max, 0, `${key} must remain on the cave floor tier`);
}
for (const key of ['3,2','4,2','5,2']) {
  const rule = anchors[key];
  assert.strictEqual(rule?.terrain, 'plateauCliff', `${key} must inspect an internal plateau cliff`);
  assert.strictEqual(rule?.facing, 'north', `${key} must use the cave mouth's north-facing cliff`);
  assert.strictEqual(rule?.height?.mode, 'relativeRange');
  assert.strictEqual(rule?.height?.min, 0);
  assert.strictEqual(rule?.height?.max, 0, `${key} must sit on the local low side of the cliff`);
}
for (const key of ['3,3','4,3','5,3']) {
  const rule = anchors[key];
  assert.strictEqual(rule?.terrain, 'plateauCliff', `${key} must inspect an internal plateau cliff`);
  assert.strictEqual(rule?.facing, 'north', `${key} must use the backing north-facing cliff`);
  assert.strictEqual(rule?.height?.mode, 'relativeRange');
  assert.strictEqual(rule?.height?.min, 1, `${key} must sit on the high side above the locale floor`);
  assert.strictEqual(rule?.height?.max, null);
}
assert.strictEqual(anchors['4,2']?.strength, 'required', 'center mouth probe must be required');
assert.strictEqual(anchors['4,3']?.strength, 'required', 'center backing probe must be required');
for (const key of ['3,2','5,2','3,3','5,3']) {
  assert.strictEqual(anchors[key]?.strength, 'preferred', `${key} is a shaping preference, not a hard rectangular-cliff requirement`);
  assert.strictEqual(anchors[key]?.weight, 2);
}
assert.deepStrictEqual(locale.placement?.terrainAnchors, locale.terrainAnchors, 'editor-persistence terrain anchors must mirror runtime terrain anchors');

const expectedEmbedded = ['3,3','4,3','5,3'];
assert.deepStrictEqual(Object.keys(locale.embeddedTiles || {}).sort(), expectedEmbedded.slice().sort(), 'rear cave row must embed into the high plateau mass');
for (const key of expectedEmbedded) {
  const rule = locale.embeddedTiles[key];
  assert.strictEqual(rule?.terrain, 'plateau', `${key} must require high plateau mass behind the cave mouth`);
  assert.strictEqual(rule?.height?.mode, 'relativeRange');
  assert.strictEqual(rule?.height?.min, 1);
  assert.strictEqual(rule?.height?.max, null);
  assert.strictEqual(rule?.carveToLocaleFloor, false, `${key} must preserve the existing plateau so the cave clips into the natural cliff instead of cutting it`);
}
assert.deepStrictEqual(locale.placement?.embeddedTiles, locale.embeddedTiles, 'editor-persistence embedded tiles must mirror runtime embedded tiles');

const compiled = terrainPlacement.compileLocale(locale, 1);
assert(compiled, 'Banubu default must compile for terrain-aware placement');
assert.strictEqual(compiled.tiles.size, 9, 'compiled Banubu footprint must remain 3x3 at 1x density');
assert.strictEqual(compiled.probes.size, 9, 'compiled Banubu rules must include six cliff probes plus three front-clearance probes');
assert.strictEqual(compiled.embedded.size, 3, 'compiled Banubu rules must embed the full rear row');

const indexEntry = index.locales.find(entry => entry.id === locale.id);
assert(indexEntry, 'Banubu Cave must remain registered in the locale index');
assert.strictEqual(indexEntry.name, "Banubu's Cave");

const repoRoot = path.resolve(__dirname, '..');
const caveRuntime = fs.readFileSync(path.join(repoRoot, 'docs/js/locale-cave-runtime.js'), 'utf8');
const zoneRenderer = fs.readFileSync(path.join(repoRoot, 'docs/js/zone-den-totem-features.js'), 'utf8');
const labPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/wilderness-generation-lab/lab-banubu-cave.js'), 'utf8');
const localeEditorPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/locale-preview3d.js'), 'utf8');
const localeEditorIndex = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/index.html'), 'utf8');
const localeTerrainEditor = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/terrain-placement.js'), 'utf8');
const placementSource = fs.readFileSync(path.join(repoRoot, 'docs/js/locale-terrain-placement.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(repoRoot, 'docs/game.js'), 'utf8');
const gameIndex = fs.readFileSync(path.join(repoRoot, 'docs/index.html'), 'utf8');
assert(caveRuntime.includes('generateZoneWorkspace = function localeCaveGenerateZoneWorkspace'), 'game wilderness generation must register placed locale caves');
assert(zoneRenderer.includes('LocaleCaveRuntime?.cavesForZone?.(mapId)'), 'game cave renderer must consume locale cave registrations');
assert(caveRuntime.includes('const floorTier = instance.floorTier != null'), 'locale cave registry must preserve the placed locale floor tier');
assert(caveRuntime.includes('entranceTile.elevTier'), 'locale cave registry must use the low-side connector for folded terrain tier');
const caveContext = { window: null }; // Exercises registration after an IndexedDB cache restore with no fresh generator call.
caveContext.window = caveContext;
vm.createContext(caveContext);
vm.runInContext(caveRuntime, caveContext, { filename: 'locale-cave-runtime.js' });
const restoredWorkspace = { localeInstances: [{ localeId: locale.id, name: locale.name,
  connectors: [{ x: 4, y: 5 }], objects: [{ id: 'obj_structure', key: 'cave_small', x: 3, y: 3, w: 3, h: 3 }] }] };
caveContext.LocaleCaveRuntime.registerWorkspace('map_northern_cliffs', restoredWorkspace, [locale], new Map([['4,5', { elevTier: 2 }]]));
const restoredCaves = caveContext.LocaleCaveRuntime.cavesForZone('map_northern_cliffs');
assert.strictEqual(restoredCaves.length, 1, 'cached Tothal locale must reconstruct its GLB visual registry');
assert.strictEqual(restoredCaves[0].floorTier, 2, 'cached cave must stand on its low-side connector tier');
assert.strictEqual(restoredCaves[0].visual.scaleX, 1.5, 'restored cave keeps authored facade scaling');
assert(zoneRenderer.includes('cave.floorTier != null && Number.isFinite(Number(cave.floorTier))'), 'locale cave renderer must anchor terrain-aware caves to their locale floor tier');
assert(zoneRenderer.includes('THREE.ClampToEdgeWrapping') && zoneRenderer.includes('tex.repeat.set(1, 1)'), 'cave material must stretch once across the fitted cave UVs instead of tiling');
assert(zoneRenderer.includes('fitCaveUvToTexture') && zoneRenderer.includes('(sourceUv.getX(i) - minU) / spanU'), 'cave UVs must be normalized to the full 0–1 texture span');
assert(!zoneRenderer.includes('THREE.RepeatWrapping'), 'cave renderer must not use repeating texture wrapping');
assert(labPreview.includes('ZoneFeatures.buildAnimalDenMeshes(scene, mergedZGrid(merged), [], LAB_CAVE_MAP_ID)'), 'Wilderness Lab must invoke the exact game cave renderer for Banubu Cave');
assert(localeEditorPreview.includes('const placed = currentInstance || currentWorkspace?.localeInstances'), 'Locale Editor preview camera must focus the actual rendered locale instance first');
assert(localeEditorPreview.includes("if (value == null || value === '') return null"), 'Locale Editor preview camera must not coerce a missing anchor to tile 0,0');
assert(localeEditorPreview.includes('const bounds = compiled?.footprint || compiled?.bounds'), 'Locale Editor preview camera must orbit the painted locale footprint');
assert(localeEditorPreview.includes('hasPlacementAnchors ? placement.terrainAnchors'), '3D preview must prefer persisted workspace terrain rules over stale sidecar cache');
assert(localeEditorPreview.includes('output.placement = { ...placement, terrainAnchors: clone(output.terrainAnchors)'), 'preview/debug locale must serialize synchronized top-level and placement terrain rules');
assert(localeEditorIndex.includes('setTerrainRules: (localeId, rules) =>'), 'main Locale Editor must expose live terrain-rule synchronization');
assert(localeEditorIndex.includes('m.terrainAnchors = terrainAnchors;') && localeEditorIndex.includes('m.placement.terrainAnchors = JSON.parse(JSON.stringify(terrainAnchors));'), 'live workspace must mirror runtime and persisted terrain probes');
assert(localeTerrainEditor.includes('reconcileRulesFromLocale(locale)'), 'terrain sidecar must reconcile stale cache from the authoritative workspace locale');
assert(localeTerrainEditor.includes('isBanubuRulesMissingFrontClearance'), 'terrain sidecar must migrate the immediately-previous Banubu browser rules to include the new front clearance apron');
assert(localeTerrainEditor.includes('syncRulesToMainLocale(locale.id, rules);'), 'terrain brush edits must update the live workspace locale immediately');
assert(placementSource.includes('lowSideRelative'), 'density scaling must distinguish low-side directional cliff probes from high-side probes');
assert(zoneRenderer.includes('visual.scaleX') && zoneRenderer.includes('visual.scaleY') && zoneRenderer.includes('visual.scaleZ'), 'game cave renderer must support independent facade width/height/depth scaling');
assert(gameSource.includes('localeTransitions: (workspace.maps || []).find(map => map && !map.isSubmap)?.transitions?.filter(t => t?.generatedLocaleId) || []'), 'zone cache must preserve stamped locale entrances across reloads');
assert(gameSource.includes('const generatedLocaleTransitions = (workspaceRoot?.transitions || workspace.localeTransitions || [])') && gameSource.includes('...generatedLocaleTransitions,'), 'Tothal Shift must restore terrain-aware locale cave transitions into the live zone interaction pool');
const generatorScriptIndex = gameIndex.indexOf('js/wilderness-map-generator.js?v=');
const terrainPlacementScriptIndex = gameIndex.indexOf('js/locale-terrain-placement.js?v=');
assert(generatorScriptIndex >= 0 && terrainPlacementScriptIndex > generatorScriptIndex,
  'the actual game page must load terrain-aware locale placement after the wilderness generator');

console.log('Banubu cliff-base authoring + terrain/runtime + editor rule-sync regression checks passed');
