const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const helperSource = read('docs/js/interior-furniture-grid.js');
const editorSource = read('docs/tools/building-interior-author/index.html');
const wardrobeEditorSource = read('docs/js/building-interior-npc-wardrobe-editor.js');
const indexSource = read('docs/index.html');
const mapEditorSource = read('docs/tools/map-editor/index.html');
const mapEditorSyncSource = read('docs/js/map-editor-interior-instance-sync.js');
const gameSource = read('docs/game.js'); // Used to pin the production building-scene floor/furniture grounding contract that interacts with generated furniture colliders.
const pixelProbeSource = read('docs/js/pixel-probe.js'); // Used to keep the mobile grounding diagnostic wired whenever this regression is touched.

new Function(helperSource);
new Function(wardrobeEditorSource);
new Function(mapEditorSyncSource);
for (const match of editorSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) new Function(match[1]);
}

const window = {
  FurniturePuzzleProperties: {
    normalizePuzzle(puzzle) { return puzzle || null; },
  },
  MapLayoutSystem: {
    getEffectiveMapData(mapData) {
      const furnitureById = new Map((mapData.furniture || []).map(piece => [String(piece.id || ''), piece]));
      return {
        ...mapData,
        npcStations: (mapData.npcStations || []).map(station => {
          const piece = furnitureById.get(String(station.sourceFurnitureId || ''));
          if (!piece) return station;
          return {
            ...station,
            col: piece.col + (Number(piece.postX) || 0),
            row: piece.row + (Number(piece.postZ) || 0),
            rotY: Number(piece.rotY) || 0,
          };
        }),
      };
    },
  },
};
const context = vm.createContext({ window, console, Math, Number, String, Object, Array, Map, Set });
vm.runInContext(helperSource, context, { filename: 'interior-furniture-grid.js' });
const grid = window.InteriorFurnitureGrid;
assert.ok(grid, 'shared furniture-grid API installs');
assert.ok(grid.debugSnapshot().installed, 'runtime bridge wraps MapLayoutSystem when available');

const scaled = {
  schema: 'hobunji_building_interior.v1',
  id: 'test_scaled',
  colliders: [],
  furniture: [{
    id: 'bar',
    itemKey: 'tableLongFurniture',
    col: 1,
    row: 5,
    gridRot: 0,
    gridW: 8,
    gridD: 1,
    rotY: 0,
    postX: 0,
    postY: 0,
    postZ: 0,
    postSX: 1.125,
    postSY: 1,
    postSZ: 1.25,
  }],
  npcStations: [{ id: 'seat', sourceFurnitureId: 'bar' }],
};
const scaledEffective = window.MapLayoutSystem.getEffectiveMapData(scaled);
assert.strictEqual(scaledEffective.furniture[0].postX, 2, '8-tile table is centered by the compatibility transform');
assert.strictEqual(scaledEffective.furniture[0].postSX, 2.25, 'grid width is converted back into the legacy X visual scale');
assert.strictEqual(scaledEffective.colliders.length, 0, 'ordinary furniture no longer bakes collision back into snapped tile colliders');
assert.strictEqual(scaledEffective._interiorFurnitureCollisionBounds.length, 1, 'colliding furniture emits one simple transformed 2D bound');
const scaledBounds = scaledEffective._interiorFurnitureCollisionBounds[0]; // Used to verify residual post scale/translation can carry collision outside the snapped placement.
assert.strictEqual(scaledBounds.centerX, 5);
assert.strictEqual(scaledBounds.centerZ, 5.5);
assert.strictEqual(scaledBounds.width, 9);
assert.strictEqual(scaledBounds.depth, 1.25);
assert.strictEqual(scaledBounds.rotationDeg, 0);
assert.strictEqual(grid.boundsOutsideSnappedGrid(scaled.furniture[0], scaledBounds), true, 'post scale can extend collision beyond the snapped grid footprint');
assert.strictEqual(grid.boundsContainsPoint(scaledBounds, 0.75, 5.5), true, 'collision remains active in the transformed region outside the snapped grid');
assert.strictEqual(scaledEffective.npcStations[0].col, 3, 'source-bound station receives the same grid-center translation as furniture');

const rotated = {
  schema: 'hobunji_building_interior.v1',
  id: 'test_rotated',
  colliders: [],
  furniture: [{
    id: 'bench',
    itemKey: 'benchFurniture',
    col: 4,
    row: 6,
    gridRot: 90,
    gridW: 1,
    gridD: 2,
    rotY: 0,
    postX: 0,
    postY: 0,
    postZ: 0,
    postSX: 1,
    postSY: 1,
    postSZ: 1,
  }],
};
const rotatedEffective = window.MapLayoutSystem.getEffectiveMapData(rotated);
assert.strictEqual(rotatedEffective.furniture[0].rotY, 90, 'grid quarter-turn is folded into legacy rotation');
assert.strictEqual(rotatedEffective.furniture[0].postX, -0.5, 'rotated non-square furniture recenters on its grid footprint');
assert.strictEqual(rotatedEffective.furniture[0].postZ, 0.5, 'rotated non-square furniture recenters on its grid footprint');
assert.deepStrictEqual(Array.from(rotatedEffective.colliders, tile => Array.from(tile)), [], 'rotated furniture stays out of tile collision');
const rotatedBounds = rotatedEffective._interiorFurnitureCollisionBounds[0]; // Used to verify the grid quarter-turn becomes the bound's actual orientation.
assert.deepStrictEqual(
  { centerX: rotatedBounds.centerX, centerZ: rotatedBounds.centerZ, width: rotatedBounds.width, depth: rotatedBounds.depth, rotationDeg: rotatedBounds.rotationDeg },
  { centerX: 4.5, centerZ: 7, width: 2, depth: 1, rotationDeg: 90 }
);
assert.strictEqual(grid.boundsContainsPoint(rotatedBounds, 4.5, 6.1), true, 'rotated long axis blocks along world Z');
assert.strictEqual(grid.boundsContainsPoint(rotatedBounds, 3.9, 7), false, 'rotated narrow axis does not retain the old snapped-square corners');

const finePiece = { // Used to prove non-grid post translation, rotation, and scale all affect one simple 2D collision rectangle.
  id: 'fine',
  itemKey: 'tableSmallFurniture',
  col: 2,
  row: 3,
  gridW: 1,
  gridD: 1,
  gridRot: 0,
  postX: 0.6,
  postZ: -0.35,
  rotY: 30,
  postSX: 1.5,
  postSZ: 0.5,
};
const fineBounds = grid.collisionBounds(finePiece);
assert.deepStrictEqual(
  { centerX: fineBounds.centerX, centerZ: fineBounds.centerZ, width: fineBounds.width, depth: fineBounds.depth, rotationDeg: fineBounds.rotationDeg },
  { centerX: 3.1, centerZ: 3.15, width: 1.5, depth: 0.5, rotationDeg: 30 }
);
assert.strictEqual(grid.boundsCorners(fineBounds).length, 4, 'transformed collision remains a four-corner 2D rectangle');
assert.strictEqual(grid.boundsOutsideSnappedGrid(finePiece, fineBounds), true, 'fine post transform is allowed to leave the snapped placement cell');
assert.strictEqual(grid.boundsContainsPoint(fineBounds, 3.62, 2.85), true, 'point collision follows the rotated rectangle outside the snapped cell');
assert.strictEqual(grid.boundsOverlapAabb(fineBounds, 3.8, 2.8, 0.15, 0.15), true, 'actor-radius collision catches edge overlap even when no sampled corner lands inside');
assert.strictEqual(grid.boundsOverlapAabb(fineBounds, 5, 5, 0.1, 0.1), false, 'actor-radius collision rejects separated bounds');

assert.deepStrictEqual(Array.from(grid.DEFAULT_FOOTPRINTS.nestFurniture), [2, 2], 'large authored nests keep their current 2x2 base footprint');
assert.deepStrictEqual(Array.from(grid.DEFAULT_FOOTPRINTS.bonfireFurniture), [2, 2], 'authored bonfires keep their current 2x2 base footprint');

const explicitGameFootprints = new Map(); // Tracks current game-side furniture definitions that declare a non-default footprint on one source line.
for (const line of gameSource.split('\n')) {
  const itemKeyMatch = line.match(/itemKey:\s*'([^']+Furniture)'/); // Finds the item key consumed by InteriorFurnitureGrid.
  const widthMatch = line.match(/\bfw:\s*(\d+)/); // Finds the canonical game footprint width when this definition declares one.
  const depthMatch = line.match(/\bfd:\s*(\d+)/); // Finds the canonical game footprint depth when this definition declares one.
  if (!itemKeyMatch || !widthMatch || !depthMatch) continue;
  explicitGameFootprints.set(itemKeyMatch[1], [Number(widthMatch[1]), Number(depthMatch[1])]);
}
for (const [itemKey, footprint] of explicitGameFootprints) {
  if (footprint[0] === 1 && footprint[1] === 1) continue;
  assert.deepStrictEqual(
    Array.from(grid.DEFAULT_FOOTPRINTS[itemKey] || []),
    footprint,
    `${itemKey}: shared collision footprint must match the current non-1x1 game definition`
  );
}

const nonColliding = window.MapLayoutSystem.getEffectiveMapData({
  schema: 'hobunji_building_interior.v1',
  id: 'test_noncolliding',
  colliders: [[0, 0]],
  furniture: [
    { itemKey: 'rugFurniture', col: 2, row: 2, gridW: 3, gridD: 2, nonColliding: true },
    { itemKey: 'tableSmallFurniture', col: 6, row: 6, walkableElevation: true },
  ],
});
assert.deepStrictEqual(Array.from(nonColliding.colliders, tile => Array.from(tile)), [[0, 0]], 'non-colliding and walkable-elevation furniture preserve only the explicit manual tile blocker');
assert.strictEqual(nonColliding._interiorFurnitureCollisionBounds.length, 0, 'non-colliding and walkable-elevation furniture emit no freeform blockers');

const dynamicMechanism = window.MapLayoutSystem.getEffectiveMapData({
  schema: 'hobunji_building_interior.v1',
  id: 'test_dynamic',
  colliders: [],
  furniture: [{ id: 'door', itemKey: 'woodenDoorFurniture', col: 1, row: 1, puzzle: { role: 'mechanism', blocksMovement: true } }],
});
assert.strictEqual(dynamicMechanism._interiorFurnitureCollisionBounds.length, 0, 'dynamic blocking mechanisms stay out of the static transformed-bound channel');

// Production integration regression: ordinary furniture collision is now a scene-local transformed
// 2D rectangle, while mapData.colliders remains the explicit snapped-tile channel. Floor surface Y
// still has to be established before manual colliders mutate tile type so furniture grounding is stable.
assert.match(
  gameSource,
  /bGrid\[r\]\[c\]\.surfaceY\s*=\s*Number\.isFinite\(sampledSurfaceY\)[\s\S]{0,260}Number\.isFinite\(fallbackSurfaceY\)[\s\S]{0,120}:\s*0\)/,
  'ordinary building floor cells explicitly retain Y=0 when no cavern surface sample exists'
);
assert.ok(
  gameSource.indexOf('bGrid[r][c].surfaceY = Number.isFinite(sampledSurfaceY)') <
    gameSource.indexOf('for (const [c, r] of (mapData.colliders || []))'),
  'building floor surface Y is established before explicit manual colliders change tile type'
);
assert.match(
  gameSource,
  /const floorSurfaceY = tileSurfaceYInArea\(bGrid\?\.\[f\.row\]\?\.\[f\.col\], mapId\);[\s\S]{0,700}const by = floorSurfaceY \+ authoredPostY;/,
  'building furniture composes the authoritative floor surface with only its authored vertical offset'
);
assert.match(
  gameSource,
  /const baseFootprint = window\.InteriorFurnitureGrid\?\.footprintForItem\?\.\(f\.itemKey\)[\s\S]{0,420}const bx = \(f\.col \+ baseFootprint\.w \* 0\.5\)[\s\S]{0,520}const bz = \(f\.row \+ baseFootprint\.d \* 0\.5\)/,
  'runtime building furniture uses the same base footprint center as the editor and transformed collision bounds'
);
const collisionBoundsCacheIndex = gameSource.indexOf('const furnitureCollisionBounds = Array.isArray(mapData._interiorFurnitureCollisionBounds)'); // Used to anchor the scene-load collision cache without depending on unrelated growth of the scene-info record.
const collisionBoundsInfoIndex = gameSource.indexOf('occlusionMeshes, furnitureCollisionBounds };', collisionBoundsCacheIndex); // Used to prove those cached bounds are stored on the loaded building scene after they are derived.
assert.ok(
  collisionBoundsCacheIndex >= 0 && collisionBoundsInfoIndex > collisionBoundsCacheIndex,
  'loaded building scenes cache transformed furniture bounds once for movement'
);
assert.match(
  gameSource,
  /InteriorFurnitureGrid\?\.installMovementBlocker\?\.\(area => _buildingScenes\.get\(area\)\?\.furnitureCollisionBounds\)/,
  'game.js serves each loaded room\'s cached transformed bounds through the shared movement blocker'
);
{
  // Executes the real shared sub-tile authority + provider: canOccupyAt()
  // (actor half-width) and furnitureBlocksMovementAt() (point / NPC pathing)
  // both resolve through AreaFootprintBlockers, so exercising it here covers
  // player, creature, knockback and NPC collision against transformed OBBs.
  const blockerWindow = {};
  vm.runInNewContext(read('docs/js/area-footprint-blockers.js'), { window: blockerWindow, Number, Math, Map });
  vm.runInNewContext(helperSource, { window: blockerWindow, console, Math, Number, JSON, Object, Array, Set, Map, String, Boolean });
  const boundsByArea = new Map([
    ['bld_test', [{ id: 'rotated-table', centerX: 5.5, centerZ: 5.5, halfWidth: 1, halfDepth: 0.25, rotationDeg: 90 }]],
  ]);
  assert.equal(blockerWindow.InteriorFurnitureGrid.installMovementBlocker(area => boundsByArea.get(area)), true,
    'transformed furniture bounds register with AreaFootprintBlockers');
  const blockers = blockerWindow.AreaFootprintBlockers;
  assert.equal(blockers.blocksPoint('bld_test', 5.5, 6.3), true, 'point inside the rotated OBB (long axis now along Z) blocks');
  assert.equal(blockers.blocksPoint('bld_test', 6.3, 5.5), false, 'point beyond the rotated OBB\'s thin side stays open');
  assert.equal(blockers.blocksBox('bld_test', 6.1, 5.5, 0.4), true, 'actor half-width expands the query into the OBB');
  assert.equal(blockers.blocksBox('bld_test', 6.8, 5.5, 0.4), false, 'actor square clear of the OBB is unobstructed');
  assert.equal(blockers.blocksPoint('bld_other', 5.5, 6.3), false, 'bounds only block in their own room, including NPC queries for non-current areas');
}
const buildingFurnitureKeyIndex = gameSource.indexOf('const buildingFurnitureKey = getDecorativeFurnitureKeyByItemKey(buildingFurniture.itemKey) || getFurnitureKeyByItemKey(buildingFurniture.itemKey)'); // Anchors canonical item-key resolution without depending on comment length.
const buildingFurnitureDescriptorIndex = gameSource.indexOf('knockbackFurnitureDescriptor(buildingFurnitureKey, buildingFurnitureDef?.name)', buildingFurnitureKeyIndex); // Proves the canonical key/definition flows into collision-effect classification.
assert.ok(
  buildingFurnitureKeyIndex >= 0 && buildingFurnitureDescriptorIndex > buildingFurnitureKeyIndex,
  'knockback collision resolves transformed building furniture through canonical runtime catalogs instead of suffix guessing'
);
assert.match(
  gameSource,
  /buildingFurnitureGrounding\s*=\s*\{[\s\S]{0,420}floorSurfaceY,[\s\S]{0,220}placedRootY:/,
  'rendered building furniture carries copyable grounding diagnostics'
);
assert.match(
  pixelProbeSource,
  /building furniture grounding:[\s\S]{0,260}floorY=[\s\S]{0,260}rootY=/,
  'Pixel Probe exposes building floor and furniture root Y on mobile'
);
assert.match(
  pixelProbeSource,
  /Interior furniture collision:[\s\S]{0,320}outsideGrid=[\s\S]{0,220}tileDerived=/,
  'Pixel Probe exposes transformed furniture collision and off-grid counts on mobile'
);

assert.match(editorSource, /id="gridRotLeftBtn"/, 'interior editor exposes 90-degree grid rotation');
assert.match(editorSource, /id="gridRot180Btn"/, 'interior editor exposes direct 180-degree grid rotation');
assert.match(editorSource, /gridRot180Btn'\)\.addEventListener\('click',[\s\S]{0,100}rotateSelectedGrid\(180\)/, '180-degree button rotates directly without an intermediate 90-degree state');
assert.match(editorSource, /id="placedFurnitureList"/, 'interior editor exposes a currently placed furniture list');
assert.match(editorSource, /function furnAtPreferringSelected\(c,r\)[\s\S]{0,420}state\.selectedId[\s\S]{0,420}furnitureOccupiesTile/, 'grid hit testing gives the explicitly selected furniture priority on overlapping tiles');
assert.match(editorSource, /btn\.addEventListener\('click',function\(\)\{[\s\S]{0,120}setTool\('select'\);[\s\S]{0,120}selectFurn\(f\.id\)/, 'placed-item list switches to Select and selects the exact furniture record');
assert.match(editorSource, /var swapsFootprint=Math\.abs\(Math\.round\(delta\/90\)\)%2===1;/, 'only odd quarter-turns swap the furniture footprint');
assert.match(editorSource, /id="gridFurnW"/, 'interior editor exposes whole-tile width');
assert.match(editorSource, /id="gridFurnD"/, 'interior editor exposes whole-tile depth');
assert.match(editorSource, /id="nonCollidingFurniture"/, 'interior editor exposes non-colliding checkbox');
assert.match(editorSource, /f\.gridW=nextW; f\.gridD=nextD/, 'grid-size control persists dimensions on the furniture record');
assert.match(editorSource, /collisionBoundsForFurniture[\s\S]{0,900}boundsCorners/, '2D editor draws the shared transformed collision rectangle');
assert.match(editorSource, /furnitureCollisionPreview/, '3D editor draws a low transformed collision preview box');
assert.match(editorSource, /extends outside snapped grid/, 'selected furniture reports collision overflow beyond snapped placement');
assert.match(editorSource, /applyPTBtn[\s\S]{0,650}drawGrid\(\); rebuild3D\(\); selectFurn\(f\.id\)/, 'numeric post-transform edits refresh collision previews immediately');
assert.match(wardrobeEditorSource, /piece\.nonColliding = true;[\s\S]{0,180}InteriorFurnitureGrid/, 'walkable elevation automatically persists non-collision');
assert.match(indexSource, /js\/interior-furniture-grid\.js\?v=20260927postcollision2/, 'game loads the transformed furniture collision runtime bridge');
assert.match(mapEditorSource, /js\/interior-furniture-grid\.js\?v=20260927postcollision2/, 'main Map Editor loads the shared transformed-collision helper');
assert.match(mapEditorSyncSource, /InteriorFurnitureGrid\?\.mergedColliders/, 'main Map Editor preserves explicit tile blockers through the shared interior helper');

const mapIndex = JSON.parse(read('docs/config/maps/index.json'));
const footprintFor = itemKey => grid.DEFAULT_FOOTPRINTS[itemKey] || [1, 1];
function placement(piece) {
  const [bw, bd] = footprintFor(piece.itemKey);
  const gridRot = ((Math.round((Number(piece.gridRot) || 0) / 90) % 4) + 4) % 4 * 90;
  const quarter = gridRot === 90 || gridRot === 270;
  return {
    gridRot,
    gridW: Math.max(1, Math.round(Number(piece.gridW) || (quarter ? bd : bw))),
    gridD: Math.max(1, Math.round(Number(piece.gridD) || (quarter ? bw : bd))),
  };
}
function auditFurniture(furniture, label, mapData) {
  const covered = new Set();
  const floor = new Set((mapData.floor || []).map(tile => `${tile[0]},${tile[1]}`));
  for (const piece of furniture || []) {
    const info = placement(piece);
    const fineRot = Number(piece.rotY) || 0;
    const isQuarterFineRotation = Math.abs(fineRot) > 1e-6 && Math.abs(fineRot / 90 - Math.round(fineRot / 90)) < 1e-6;
    assert.ok(!isQuarterFineRotation, `${label} ${piece.id || piece.itemKey}: exact 90-degree rotation must use gridRot, not fine rotY`);
    if (piece.walkableElevation) assert.strictEqual(piece.nonColliding, true, `${label} ${piece.id || piece.itemKey}: walkable elevation must be non-colliding`);
    if (piece.itemKey === 'rugFurniture') assert.strictEqual(piece.nonColliding, true, `${label} ${piece.id || piece.itemKey}: existing floor rugs must preserve walk-through behavior`);
    for (let dc = 0; dc < info.gridW; dc++) {
      for (let dr = 0; dr < info.gridD; dr++) {
        const col = Number(piece.col) + dc;
        const row = Number(piece.row) + dr;
        assert.ok(col >= 0 && row >= 0 && col < mapData.cols && row < mapData.rows, `${label} ${piece.id || piece.itemKey}: grid footprint must stay inside the map`);
        assert.ok(floor.has(`${col},${row}`), `${label} ${piece.id || piece.itemKey}: grid footprint must stay on authored floor`);
        if (!piece.nonColliding && !piece.walkableElevation) covered.add(`${col},${row}`);
      }
    }
  }
  return covered;
}

let auditedMaps = 0;
for (const entry of mapIndex.maps || []) {
  if (entry.category !== 'building_interior') continue;
  const mapData = JSON.parse(read('docs/' + entry.file));
  const covered = auditFurniture(mapData.furniture || [], entry.id, mapData);
  for (const tile of mapData.colliders || []) {
    assert.ok(!covered.has(`${tile[0]},${tile[1]}`), `${entry.id}: manual collider ${tile} redundantly overlaps colliding furniture`);
  }
  for (const layout of mapData.layouts || []) {
    const layoutCovered = auditFurniture(layout.furniture || [], `${entry.id}/${layout.id}`, mapData);
    if (Object.prototype.hasOwnProperty.call(layout, 'colliders')) {
      for (const tile of layout.colliders || []) {
        assert.ok(!layoutCovered.has(`${tile[0]},${tile[1]}`), `${entry.id}/${layout.id}: redundant manual collider ${tile}`);
      }
    }
  }
  auditedMaps++;
}
assert.ok(auditedMaps >= 20, 'all indexed building interiors were audited');

const inn = JSON.parse(read('docs/config/maps/map_i_inn.json'));
const stage = inn.furniture.find(piece => piece.id === 'fmss04iltqngq');
assert.ok(stage?.walkableElevation && stage?.nonColliding, 'inn stage remains walkable elevation and is explicitly non-colliding');
const bar = inn.furniture.find(piece => piece.id === 'fmqnw75m0zv1z');
assert.ok(bar?.gridW >= 8 && bar?.gridD >= 1, 'inn stretched bar now has a multi-tile grid footprint');

console.log(`interior furniture grid regression passed (${auditedMaps} interiors audited)`);
