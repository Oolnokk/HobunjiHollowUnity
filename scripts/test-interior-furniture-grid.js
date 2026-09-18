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

new Function(helperSource);
new Function(wardrobeEditorSource);
for (const match of editorSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (match[1].trim()) new Function(match[1]);
}

const window = {
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
assert.strictEqual(scaledEffective.colliders.length, 8, 'all occupied table tiles generate collision');
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
assert.deepStrictEqual(Array.from(rotatedEffective.colliders, tile => Array.from(tile)), [[4, 6], [4, 7]], 'rotated collision follows the occupied grid tiles');

const nonColliding = window.MapLayoutSystem.getEffectiveMapData({
  schema: 'hobunji_building_interior.v1',
  id: 'test_noncolliding',
  colliders: [[0, 0]],
  furniture: [
    { itemKey: 'rugFurniture', col: 2, row: 2, gridW: 3, gridD: 2, nonColliding: true },
    { itemKey: 'tableSmallFurniture', col: 6, row: 6, walkableElevation: true },
  ],
});
assert.deepStrictEqual(Array.from(nonColliding.colliders, tile => Array.from(tile)), [[0, 0]], 'non-colliding and walkable-elevation furniture add no tile blockers');

assert.match(editorSource, /id="gridRotLeftBtn"/, 'interior editor exposes 90-degree grid rotation');
assert.match(editorSource, /id="gridFurnW"/, 'interior editor exposes whole-tile width');
assert.match(editorSource, /id="gridFurnD"/, 'interior editor exposes whole-tile depth');
assert.match(editorSource, /id="nonCollidingFurniture"/, 'interior editor exposes non-colliding checkbox');
assert.match(editorSource, /f\.gridW=nextW; f\.gridD=nextD/, 'grid-size control persists dimensions on the furniture record');
assert.match(wardrobeEditorSource, /piece\.nonColliding = true;[\s\S]{0,180}InteriorFurnitureGrid/, 'walkable elevation automatically persists non-collision');
assert.match(indexSource, /js\/interior-furniture-grid\.js\?v=20260917grid1/, 'game loads the furniture-grid runtime bridge');

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
function auditFurniture(furniture, label) {
  const covered = new Set();
  for (const piece of furniture || []) {
    const info = placement(piece);
    const fineRot = Number(piece.rotY) || 0;
    const isQuarterFineRotation = Math.abs(fineRot) > 1e-6 && Math.abs(fineRot / 90 - Math.round(fineRot / 90)) < 1e-6;
    assert.ok(!isQuarterFineRotation, `${label} ${piece.id || piece.itemKey}: exact 90-degree rotation must use gridRot, not fine rotY`);
    if (piece.walkableElevation) assert.strictEqual(piece.nonColliding, true, `${label} ${piece.id || piece.itemKey}: walkable elevation must be non-colliding`);
    if (piece.itemKey === 'rugFurniture') assert.strictEqual(piece.nonColliding, true, `${label} ${piece.id || piece.itemKey}: existing floor rugs must preserve walk-through behavior`);
    if (piece.nonColliding || piece.walkableElevation) continue;
    for (let dc = 0; dc < info.gridW; dc++) {
      for (let dr = 0; dr < info.gridD; dr++) covered.add(`${piece.col + dc},${piece.row + dr}`);
    }
  }
  return covered;
}

let auditedMaps = 0;
for (const entry of mapIndex.maps || []) {
  if (entry.category !== 'building_interior') continue;
  const mapData = JSON.parse(read('docs/' + entry.file));
  const covered = auditFurniture(mapData.furniture || [], entry.id);
  for (const tile of mapData.colliders || []) {
    assert.ok(!covered.has(`${tile[0]},${tile[1]}`), `${entry.id}: manual collider ${tile} redundantly overlaps colliding furniture`);
  }
  for (const layout of mapData.layouts || []) {
    const layoutCovered = auditFurniture(layout.furniture || [], `${entry.id}/${layout.id}`);
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
