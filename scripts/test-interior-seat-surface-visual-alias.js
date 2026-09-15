'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const adapterSource = fs.readFileSync('docs/js/seat-surface-placement-transform.js', 'utf8'); // Used to execute the production map adapter in a browser-like harness.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to prove building interaction registration consumes the metadata-only seat key.
const visualCalls = []; // Records the keys sent to the ordinary furniture renderer; a synthetic seat alias here is the brown-box regression.
const authoredData = {
  chairSimple: { key: 'chairSimple', footprint: { w: 1, d: 1 }, seatAnchors: [{ position: { x: 0, y: 0.25, z: 0 }, rotationDeg: { x: -5, y: 0, z: 0 } }] },
};
const window = {
  FarmEditor: { init(deps) { this.lastDeps = deps; return true; } },
  AuthoredFurniture: {
    peek(key) { return authoredData[key] || null; },
    load(key) { return Promise.resolve(authoredData[key] || null); },
    seatAnchorFor(data, index) { return data?.seatAnchors?.[index || 0] || null; },
  },
  ProceduralFurniture: {
    buildFurnitureGroup(key) { visualCalls.push(key); return { builtKey: key }; },
  },
  MapLayoutSystem: {
    getEffectiveMapData(mapData) { return { ...mapData, furniture: (mapData.furniture || []).map(piece => ({ ...piece })) }; },
  },
  __farmLog() {},
};
const context = vm.createContext({ window, console, Math, Number, String, Object, Array, Map, Set, Promise });
vm.runInContext(adapterSource, context, { filename: 'seat-surface-placement-transform.js' });

const defs = {
  chairSimple: { itemKey: 'chairSimpleFurniture', name: 'Simple Chair', sit: true, fw: 1, fd: 1 },
};
window.FarmEditor.init({ DECORATIVE_FURNITURE_DEFS: defs });

const effective = window.MapLayoutSystem.getEffectiveMapData({
  id: 'visual-key-seat',
  furniture: [{ id: 'chair-a', itemKey: 'chairSimpleFurniture', col: 1, row: 1, postY: 0.2, postSX: 1.5 }],
});
const piece = effective.furniture[0];
assert.strictEqual(piece.itemKey, 'chairSimpleFurniture', 'transformed seat must retain its original render item key');
assert(piece.seatSurfaceFurnitureKey?.startsWith('__seat_surface_xform_'), 'transformed seat must carry a separate metadata-only seat key');
assert.notStrictEqual(piece.seatSurfaceFurnitureKey, 'chairSimple', 'seat metadata key should remain isolated from the authored visual key');

const furnKeyByItemKey = Object.fromEntries(Object.entries(defs).map(([key, def]) => [def.itemKey, key])); // Mirrors loadBuildingScene's itemKey-to-furniture-key lookup.
const renderKey = furnKeyByItemKey[piece.itemKey];
assert.strictEqual(renderKey, 'chairSimple', 'loadBuildingScene should still select the real chair key for rendering');
window.ProceduralFurniture.buildFurnitureGroup(renderKey);
assert.deepStrictEqual(visualCalls, ['chairSimple'], 'synthetic seat alias must never enter the furniture visual builder');

assert(gameSource.includes('const seatFurnitureKey = f.seatSurfaceFurnitureKey || furnitureKey;'), 'building interaction registration must opt into the metadata-only transformed seat key');
assert(gameSource.includes('makeSitInteractable(seatFurnitureKey, f.col, f.row, def.fw, def.fd, f.rotY || 0)'), 'building sit action must use the transformed metadata key');
assert(!adapterSource.includes('\n  installVisualAliasBridge();'), 'seat adapter must not install a renderer wrapper now that visual and interaction keys are separated');

console.log('Interior transformed-seat visual-key separation regression passed.');
