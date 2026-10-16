'use strict';
// Farm Layout editor + production-building rotation, executed against the real
// farm-production.js and farm-layout-editor.js modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const COLS = 20, ROWS = 20;
const objects = new Map(); // Shared tile occupancy (FarmBuildings/worldObjects stand-in).
let allowed = true, saves = 0;
const rotations = []; // Mesh rotations applied by the production module.
const context = { console, Math, Number, JSON, setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} } };
context.window = context;
context.FarmWorldSettings = { current: () => ({}), read: () => ({ meta: {}, world: null }) };
context.AuthoredFurniture = { load: async () => ({ parts: [] }), buildGroup: () => {
  const mesh = { userData: {}, position: { set() {} }, rotation: {}, traverse() {} };
  rotations.push(mesh); return mesh;
} };
const excluded = (id, exclude) => typeof exclude?.has === 'function' ? exclude.has(id) : id === exclude; // The module's Set comes from the vm realm.
const barns = [{ id: 'barnA', kind: 'barn', stage: 'built', tier: 'small', col: 12, row: 12, w: 4, h: 3 }];
const moves = [];
context.FarmBuildings = {
  canPlaceAt: (col, row, w, h, exclude) => Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col + w <= COLS && row + h <= ROWS
    && !Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => objects.get((col + c) + ',' + (row + r)))).flat().some(obj => obj && !excluded(obj.id, exclude))
    && !barns.some(b => !excluded(b.id, exclude) && col < b.col + b.w && col + w > b.col && row < b.row + b.h && row + h > b.row),
  clearFootprint() {}, connectedBarnRooms: id => barns.filter(b => b.id === id), label: () => 'Little Barn',
  moveGroup(ids, dCol, dRow) { moves.push({ ids, dCol, dRow }); for (const b of barns) if (ids.includes(b.id)) { b.col += dCol; b.row += dRow; } return { ok: true, message: 'Moved the barn.' }; },
};
vm.createContext(context);
for (const file of ['docs/config/farm-specializations.js', 'docs/js/farm-production.js', 'docs/js/farm-layout-editor.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

const production = context.FarmProduction;
production.init({ calendar: { day: 1, time01: 0 }, inventory: {}, ITEM_DEFS: {}, COLS, ROWS, scene: { add() {}, remove() {} }, worldObjects: objects,
  hasFarmPermission: () => allowed, getGrid: () => [], surfaceY: () => 0, saveFarmLayout: () => { saves++; return true; }, saveMemberWorldData() {}, showToast() {}, debugLog() {} });

// Compost bins are shipping-box-like: width x ceil(width/2), matching their authored asset.
const defs = context.FARM_SPECIALIZATIONS_CONFIG.buildings;
assert.deepEqual([defs.compostBinSmall, defs.compostBinMedium, defs.compostBinLarge].map(d => [d.w, d.h]), [[2, 1], [3, 2], [4, 2]]);
for (const def of Object.values(defs)) assert.equal(JSON.parse(fs.readFileSync('docs/config/furniture-authored/' + def.key + '.json')).footprint.d, def.h, def.key + ' authored depth matches its footprint');

production.load([{ id: 'compost', key: 'compostBinSmall', col: 2, row: 2 }, { id: 'mill', key: 'windmillSmall', col: 6, row: 2 }]);
assert.equal(objects.get('3,2').id, 'compost'); assert.equal(objects.get('2,3'), undefined, 'unrotated compost bin is one tile deep');

// Rotating swaps the footprint, re-registers occupancy and persists the turn.
assert.equal(production.rotate('compost').ok, true);
const compost = production.entries().find(entry => entry.id === 'compost');
assert.equal(compost.rot, 1); assert.deepEqual({ ...production.footprint(compost) }, { w: 1, h: 2 });
assert.ok(objects.get(compost.col + ',' + (compost.row + 1))?.id === 'compost', 'rotated footprint is occupied');
assert.equal(production.serialize().find(record => record.id === 'compost').rot, 1);
production.load(JSON.parse(JSON.stringify(production.serialize())));
assert.equal(production.entries().find(entry => entry.id === 'compost').rot, 1, 'rotation survives reload');
(async () => {
await new Promise(resolve => setImmediate(resolve)); // Authored meshes attach asynchronously.
assert.equal(production.entries().find(entry => entry.id === 'compost').mesh.rotation.y, -Math.PI / 2, 'mesh turns with the footprint');

// The layout adapter lists whole structures and moves them through their authorities.
context.FarmLayoutEditor.init({ getHousePieces: () => [], getFarmBuildings: () => barns, hasFarmPermission: () => allowed, showToast() {}, COLS, ROWS });
const adapter = context.FarmLayoutEditor.createAdapter();
const pieces = adapter.getPieces();
assert.deepEqual(Array.from(pieces, piece => piece.kind).sort(), ['barn', 'production', 'production']);
const mill = pieces.find(piece => piece.id === 'mill');
assert.equal(adapter.canMove(mill, 9, 6), true);
assert.equal(adapter.canMove(mill, 11, 11), false, 'mill cannot overlap the barn');
assert.equal(adapter.move(mill, 9, 6).ok, true);
assert.equal(objects.get('9,6').id, 'mill'); assert.equal(objects.get('6,2'), undefined, 'old footprint is released');
const barn = pieces.find(piece => piece.kind === 'barn');
assert.equal(adapter.canMove(barn, barn.col + 1, barn.row), true, 'a barn may overlap its own current tiles');
assert.equal(adapter.move(barn, barn.col - 2, barn.row).ok, true);
assert.deepEqual({ ...moves[0], ids: Array.from(moves[0].ids) }, { ids: ['barnA'], dCol: -2, dRow: 0 });
allowed = false;
adapter.refresh();
assert.equal(adapter.canMove(adapter.getPieces()[0], 0, 0), false, 'permission gates every move');
assert.equal(production.rotate('mill').ok, false);
console.log('farm layout editor ok');
})().catch(error => { console.error(error); process.exit(1); });
