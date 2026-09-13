const assert = require('assert');
const fs = require('fs');
const path = require('path');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');
const index = require('../docs/config/locales/index.json');
const terrainPlacement = require('../docs/js/locale-terrain-placement.js');

assert.strictEqual(locale.name, "Banubu's Cave", 'Banubu landmark must use the cave name in-game');
assert.deepStrictEqual(locale.placement?.allowedZones, ['map_northern_cliffs'], 'Banubu Cave must be Northern Cliffs only');
assert.strictEqual(locale.placement?.clearanceTiles, 0, 'embedded cave placement must not demand a clear buffer through its host plateau');
assert.strictEqual(locale.placement?.requiresFlatGround, true, 'the exposed cave floor/approach must remain flat');
assert.strictEqual(locale.placement?.floorMode, 'nextLowerCliffTier', 'Banubu exterior floor must derive from the adjacent low side of its selected internal cliff');

const caveObject = (locale.objects || []).find(object => object.id === 'obj_structure');
assert(caveObject, 'Banubu Cave keeps the stable obj_structure locale object id');
assert.strictEqual(caveObject.kind, 'structure', 'stable structure-kind routing must be preserved');
assert.strictEqual(caveObject.key, 'cave_small', 'Banubu Cave must render with the shared cave_small asset');
assert.strictEqual(caveObject.label, "Banubu's Cave");
assert.strictEqual(caveObject.visual?.renderer, 'cave_small');
assert.strictEqual(caveObject.visual?.scale, 2, 'Banubu cave entrance must be twice normal cave prop scale');
assert.strictEqual(caveObject.visual?.facing, 'north', 'Banubu Cave entrance must face out of its authored mouth');

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
const freeApproach = ['3,3', '4,3', '5,3'].map(key => anchors[key]);
assert(freeApproach.every(rule => rule?.terrain === 'free' && rule?.strength === 'required'), 'Banubu Cave needs an open approach before the cliff mouth');
const internalCliff = anchors['4,5'];
assert(internalCliff, 'Banubu Cave needs an explicit cliff probe at the front of its embedded host');
assert.strictEqual(internalCliff.terrain, 'plateauCliff', 'Banubu Cave must require an internal plateau cliff, not a boundary cliff');
assert.strictEqual(internalCliff.facing, 'north', 'Banubu Cave plateau face must open north toward the authored mouth');
assert.deepStrictEqual(locale.placement?.terrainAnchors, locale.terrainAnchors, 'editor-persistence terrain anchors must mirror runtime terrain anchors');
assert.deepStrictEqual(locale.placement?.embeddedTiles, locale.embeddedTiles, 'editor-persistence embedded cells must mirror runtime embedded cells');

// The cave cliff is encoded by adjacency rather than a density-expanded
// plateauCliff probe: row 4 stays on the flat lower floor while row 5 directly
// behind it MUST be plateau >=1 tier higher. At the generator's normal 2x
// density this becomes a real low/high boundary, while all 2x embedded cells
// remain legal host checks.
for (const col of [3, 4, 5]) {
  assert(locale.tiles?.[`${col},4`], `mouth floor cell ${col},4 must exist`);
  assert(locale.embeddedTiles?.[`${col},5`], `embedded plateau must begin immediately behind mouth cell ${col},4`);
}

function syntheticWorkspace(withPlateau) {
  const cols = 40, rows = 40;
  const root = { id: 'root', cols, rows, tiles: {}, generatedFrom: { note: 'Flattened after 2x tile-density expansion.' } };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) root.tiles[`${c},${r}`] = { type: 'grass', crop: '' };
  const workspace = { maps: [root], plateauGroups: [], localeInstances: [] };
  if (!withPlateau) return workspace;
  const plateau = { id: 'p1', elevation: 2 };
  const submap = { id: 'plateau_p1', isSubmap: true, plateauGroupId: 'p1', cols: 40, rows: 20, anchorC: 0, anchorR: 20, tiles: {} };
  for (let r = 20; r < rows; r++) for (let c = 0; c < cols; c++) {
    root.tiles[`${c},${r}`].plateau = 'p1';
    submap.tiles[`${c},${r - 20}`] = { type: 'grass', crop: '' };
  }
  workspace.maps.push(submap);
  workspace.plateauGroups.push(plateau);
  return workspace;
}

// Source row 5 expands to final rows 10/11. Anchor row 10 therefore puts
// Banubu's embedded rear at final row 20 exactly where the synthetic plateau
// begins; source row 4 stays on the lower tier immediately in front of it.
const cliffFit = terrainPlacement.evaluateCandidateForTest(syntheticWorkspace(true), locale, 4, 10, { scale: 2, seed: 'banubu-cave-test' });
assert.strictEqual(cliffFit.ok, true, `Banubu Cave must fit the synthetic 2x plateau boundary: ${cliffFit.reason || 'unknown rejection'}`);
assert.strictEqual(cliffFit.floorTier, 0, 'a cliff whose adjacent low side is ground must place the cave at ground level');
assert.strictEqual(cliffFit.embedded.length, Object.keys(embedded).length * 4, 'every authored embedded cell should expand to four validated 2x host cells');
const flatFit = terrainPlacement.evaluateCandidateForTest(syntheticWorkspace(false), locale, 4, 10, { scale: 2, seed: 'banubu-cave-flat-test' });
assert.strictEqual(flatFit.ok, false, 'Banubu Cave must reject flat terrain with no higher plateau mass');

function syntheticStackedMesaWorkspace() {
  const cols = 40, rows = 40;
  const root = { id: 'root', cols, rows, tiles: {}, generatedFrom: { note: 'Flattened after 2x tile-density expansion.' } };
  const workspace = { maps: [root], plateauGroups: [{ id: 'low', elevation: 2 }, { id: 'high', elevation: 5 }], localeInstances: [] };
  const low = { id: 'plateau_low', isSubmap: true, plateauGroupId: 'low', cols, rows: 20, anchorC: 0, anchorR: 0, tiles: {} };
  const high = { id: 'plateau_high', isSubmap: true, plateauGroupId: 'high', cols, rows: 20, anchorC: 0, anchorR: 20, tiles: {} };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const highSide = r >= 20;
    root.tiles[`${c},${r}`] = { type: 'grass', crop: '', plateau: highSide ? 'high' : 'low' };
    (highSide ? high : low).tiles[`${c},${highSide ? r - 20 : r}`] = { type: 'grass', crop: '' };
  }
  workspace.maps.push(low, high);
  return workspace;
}
const stackedFit = terrainPlacement.evaluateCandidateForTest(syntheticStackedMesaWorkspace(), locale, 4, 10, { scale: 2, seed: 'banubu-cave-stacked-test' });
assert.strictEqual(stackedFit.ok, true, `Banubu Cave must fit a taller mesa behind a lower mesa: ${stackedFit.reason || 'unknown rejection'}`);
assert.strictEqual(stackedFit.floorTier, 2, 'a 5→2 cliff must place the cave on the adjacent tier-2 lower mesa, not force ground or tier 4');

assert(!(locale.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'Banubu belongs in a future cave interior, not the exterior entrance locale');
assert((locale.connectors || []).some(connector => connector.label === "Banubu's Cave entrance"), 'exterior entrance connector must remain for the future interior handoff');

const indexEntry = index.locales.find(entry => entry.id === locale.id);
assert(indexEntry, 'Banubu Cave must remain registered in the locale index');
assert.strictEqual(indexEntry.name, "Banubu's Cave", 'locale index must expose the cave name to loaders/UI');

const repoRoot = path.resolve(__dirname, '..');
const caveRuntime = fs.readFileSync(path.join(repoRoot, 'docs/js/locale-cave-runtime.js'), 'utf8');
const zoneRenderer = fs.readFileSync(path.join(repoRoot, 'docs/js/zone-den-totem-features.js'), 'utf8');
const labPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/wilderness-generation-lab/lab-banubu-cave.js'), 'utf8');
const localeEditorPreview = fs.readFileSync(path.join(repoRoot, 'docs/tools/locale-editor/locale-preview3d.js'), 'utf8');
assert(caveRuntime.includes('generateZoneWorkspace = function localeCaveGenerateZoneWorkspace'), 'game wilderness generation must register placed locale caves');
assert(zoneRenderer.includes('LocaleCaveRuntime?.cavesForZone?.(mapId)'), 'game cave renderer must consume locale cave registrations');
assert(zoneRenderer.includes('DEN_SIZE_SCALE * authoredScale'), 'authored 2x cave scale must multiply the normal game cave scaling path');
assert(caveRuntime.includes('floorTier: Number.isFinite(Number(instance.floorTier))'), 'locale cave registry must preserve the placed locale floor tier');
assert(zoneRenderer.includes('Number.isFinite(Number(cave.floorTier)) ? Number(cave.floorTier) : sampledTier'), 'locale cave renderer must anchor terrain-aware caves to their locale floor tier');
assert(labPreview.includes('ZoneFeatures.buildAnimalDenMeshes(scene, mergedZGrid(merged), [], LAB_CAVE_MAP_ID)'), 'Wilderness Lab must invoke the exact game cave renderer for Banubu Cave');
assert(localeEditorPreview.includes('const placed = currentInstance || currentWorkspace?.localeInstances'), 'Locale Editor preview camera must focus the actual rendered locale instance before consulting candidate coordinates');
assert(localeEditorPreview.includes("if (value == null || value === '') return null"), 'Locale Editor preview camera must not coerce a missing anchor to world tile 0,0');
assert(localeEditorPreview.includes('const bounds = compiled?.footprint || compiled?.bounds'), 'Locale Editor preview camera must orbit the painted locale footprint rather than the editor canvas origin');

console.log('Banubu Cave locale + 2x cliff placement + shared game-render regression checks passed');
