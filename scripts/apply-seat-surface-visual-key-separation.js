'use strict';

const fs = require('fs');

function replaceExact(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match in ${path}, found ${count}`);
  fs.writeFileSync(path, source.replace(before, after));
}

replaceExact(
  'docs/js/seat-surface-placement-transform.js',
`  function aliasRecordForPiece(piece) {
    const itemKey = String(piece?.itemKey || ''); // Used to detect an effective map that has already passed through this adapter.
    const resolvedKey = furnitureKeyForItemKey(itemKey); // Used to map the runtime alias item key back to its alias record without persisting extra marker fields.
    return resolvedKey ? (aliasByKey.get(resolvedKey) || null) : null;
  }`,
`  function aliasRecordForPiece(piece) {
    const metadataKey = String(piece?.seatSurfaceFurnitureKey || ''); // Used to detect an effective map that already carries runtime-only transformed seat metadata while its visual item key stays untouched.
    if (metadataKey && aliasByKey.has(metadataKey)) return aliasByKey.get(metadataKey);
    const itemKey = String(piece?.itemKey || ''); // Used only for compatibility with effective maps created by the earlier visual-alias implementation in the same page session.
    const resolvedKey = furnitureKeyForItemKey(itemKey); // Used to recognize that legacy alias item key without making new maps depend on it.
    return resolvedKey ? (aliasByKey.get(resolvedKey) || null) : null;
  }`,
  'separate effective-map alias detection from visual itemKey',
);

replaceExact(
  'docs/js/seat-surface-placement-transform.js',
`      return { ...piece, itemKey: alias.aliasItemKey };`,
`      return { ...piece, seatSurfaceFurnitureKey: alias.aliasKey }; // Runtime-only interaction metadata: the original itemKey remains the sole visual/render key.`,
  'keep transformed seat visual itemKey unchanged',
);

replaceExact(
  'docs/js/seat-surface-placement-transform.js',
`  installVisualAliasBridge();`,
`  // Do not install the visual alias bridge: transformed seats retain their real itemKey/render key, and only seating metadata uses the synthetic key.`,
  'disable synthetic visual routing',
);

replaceExact(
  'docs/game.js',
`              _buildingInteractables.set(mapId + ',' + f.col + ',' + f.row, makeSitInteractable(furnitureKey, f.col, f.row, def.fw, def.fd, f.rotY || 0));`,
`              const seatFurnitureKey = f.seatSurfaceFurnitureKey || furnitureKey; // Runtime-only transformed seat metadata must not replace the real furniture key used to render the chair/bench.
              _buildingInteractables.set(mapId + ',' + f.col + ',' + f.row, makeSitInteractable(seatFurnitureKey, f.col, f.row, def.fw, def.fd, f.rotY || 0));`,
  'route building sitting through metadata key only',
);

replaceExact(
  'scripts/test-interior-seat-surface-post-transform.js',
`assert.notStrictEqual(effective.furniture[0].itemKey, 'chairSimpleFurniture', 'transformed seats should receive a runtime-only alias item key');
assert.strictEqual(effective.furniture[1].itemKey, 'tableRoundFurniture', 'non-seat furniture must not be aliased');

const fullAliasKey = Object.keys(decorativeFurnitureDefs).find(key => decorativeFurnitureDefs[key].itemKey === effective.furniture[0].itemKey); // Used to inspect the seat alias chosen for player/automatic seating.`,
`assert.strictEqual(effective.furniture[0].itemKey, 'chairSimpleFurniture', 'transformed seats must keep the original item key used by the visual renderer');
assert.strictEqual(effective.furniture[1].itemKey, 'tableRoundFurniture', 'non-seat furniture must remain untouched');
assert(effective.furniture[0].seatSurfaceFurnitureKey?.startsWith('__seat_surface_xform_'), 'transformed seats should carry a separate runtime-only seat metadata key');

const fullAliasKey = effective.furniture[0].seatSurfaceFurnitureKey; // Used to inspect the transformed seat metadata key while the visible furniture keeps its base item key.`,
  'update transformed-seat key assertions',
);

replaceExact(
  'scripts/test-interior-seat-surface-post-transform.js',
`const built = window.ProceduralFurniture.buildFurnitureGroup(fullAliasKey); // Used to prove aliasing interaction metadata does not fork the visible furniture recipe.
assert.strictEqual(built.builtKey, 'chairSimple', 'runtime alias visuals should delegate to the original furniture key');
assert.deepStrictEqual(visualCalls, ['chairSimple']);

const secondPass = window.MapLayoutSystem.getEffectiveMapData(effective); // Used to ensure harmless re-resolution does not stack the same transform into seat metadata twice.
assert.strictEqual(secondPass.furniture[0].itemKey, effective.furniture[0].itemKey, 'effective map seat aliasing should be idempotent');`,
`const built = window.ProceduralFurniture.buildFurnitureGroup('chairSimple'); // Used as a control proving the adapter no longer intercepts or rewrites furniture rendering.
assert.strictEqual(built.builtKey, 'chairSimple', 'ordinary furniture rendering should remain on the original builder/key');
assert.deepStrictEqual(visualCalls, ['chairSimple']);

const secondPass = window.MapLayoutSystem.getEffectiveMapData(effective); // Used to ensure harmless re-resolution does not stack the same transform into seat metadata twice.
assert.strictEqual(secondPass.furniture[0].itemKey, effective.furniture[0].itemKey, 'effective map visual item key should remain stable');
assert.strictEqual(secondPass.furniture[0].seatSurfaceFurnitureKey, effective.furniture[0].seatSurfaceFurnitureKey, 'effective map seat metadata key should be idempotent');`,
  'remove alias visual-builder expectation',
);

replaceExact(
  'scripts/test-interior-seat-surface-three-math.js',
`const chairAliasKey = Object.keys(decorativeFurnitureDefs).find(key => decorativeFurnitureDefs[key].itemKey === chairEffective.furniture[0].itemKey); // Used to resolve the alias definition selected for the transformed chair.`,
`const chairAliasKey = chairEffective.furniture[0].seatSurfaceFurnitureKey; // Used to resolve transformed seat metadata without replacing the chair's real visual item key.`,
  'use chair seat metadata key',
);

replaceExact(
  'scripts/test-interior-seat-surface-three-math.js',
`const benchAliasKey = Object.keys(decorativeFurnitureDefs).find(key => decorativeFurnitureDefs[key].itemKey === benchEffective.furniture[0].itemKey); // Used to resolve the real bench placement's runtime alias.`,
`const benchAliasKey = benchEffective.furniture[0].seatSurfaceFurnitureKey; // Used to resolve the real bench placement's runtime seat metadata key while its visual key remains benchFurniture.`,
  'use bench seat metadata key',
);

replaceExact(
  'scripts/test-interior-seat-surface-three-math.js',
`assert.strictEqual(templeBenchPiece.itemKey, 'benchFurniture', 'runtime transformation must not mutate the real saved temple furniture record');`,
`assert.strictEqual(templeBenchPiece.itemKey, 'benchFurniture', 'runtime transformation must not mutate the real saved temple furniture record');
assert.strictEqual(benchEffective.furniture[0].itemKey, 'benchFurniture', 'runtime transformation must not replace the temple bench visual item key');`,
  'prove real temple visual key survives effective-map transform',
);

const visualRegression = `'use strict';

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
assert(!adapterSource.includes('\\n  installVisualAliasBridge();'), 'seat adapter must not install a renderer wrapper now that visual and interaction keys are separated');

console.log('Interior transformed-seat visual-key separation regression passed.');
`;
fs.writeFileSync('scripts/test-interior-seat-surface-visual-alias.js', visualRegression);

console.log('Applied seat-surface visual/metadata key separation patch.');
