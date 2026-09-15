'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/seat-surface-placement-transform.js', 'utf8'); // Used to execute the placement adapter in a small browser-like harness.
const authoredData = {
  chairSimple: {
    key: 'chairSimple',
    footprint: { w: 1, d: 1 },
    seatAnchors: [
      { position: { x: 0.2, y: 0.3, z: 0.1 }, rotationDeg: { x: -5, y: 0, z: 0 } },
    ],
  },
}; // Used as the base authored chair metadata that transformed aliases derive from.
const visualCalls = []; // Used to prove runtime alias keys still render through the base furniture recipe.
const farmLog = []; // Used to verify the adapter leaves a mobile-readable diagnostic when it transforms a map.
const window = {
  FarmEditor: {
    init(deps) { this.lastDeps = deps; return 'farm-init'; },
  },
  AuthoredFurniture: {
    peek(key) { return authoredData[key] || null; },
    load(key) { return Promise.resolve(authoredData[key] || null); },
    seatAnchorFor(data, index) { return data?.seatAnchors?.[index || 0] || null; },
  },
  ProceduralFurniture: {
    buildFurnitureGroup(key) { visualCalls.push(key); return { builtKey: key }; },
  },
  MapLayoutSystem: {
    getEffectiveMapData(mapData) {
      const furnitureById = new Map((mapData.furniture || []).map(piece => [String(piece.id || ''), piece])); // Mirrors the existing sourceFurnitureId station resolver before the new adapter runs.
      return {
        ...mapData,
        npcStations: (mapData.npcStations || []).map(station => {
          const piece = furnitureById.get(String(station.sourceFurnitureId || '')); // Used to fold postX/postZ into the station origin exactly once, as map-layout-system.js does.
          if (!piece) return station;
          return {
            ...station,
            col: piece.col + (Number(piece.postX) || 0),
            row: piece.row + (Number(piece.postZ) || 0),
            rotY: Number.isFinite(piece.rotY) ? piece.rotY : (Number(station.rotY) || 0),
            sourceFurnitureKey: station.sourceFurnitureKey || piece.itemKey,
            furnitureKey: station.furnitureKey || station.sourceFurnitureKey || piece.itemKey,
          };
        }),
      };
    },
  },
  __farmLog(message) { farmLog.push(message); },
}; // Used as the browser global consumed by the adapter without requiring Three.js or the full game.
const context = vm.createContext({ window, console, Math, Number, String, Object, Array, Map, Set, Promise }); // Used to isolate the adapter's wrappers from Node's own globals.
vm.runInContext(source, context, { filename: 'seat-surface-placement-transform.js' });

const decorativeFurnitureDefs = {
  chairSimple: {
    itemKey: 'chairSimpleFurniture',
    name: 'Simple Chair',
    sit: true,
    fw: 1,
    fd: 1,
  },
  tableRound: {
    itemKey: 'tableRoundFurniture',
    name: 'Round Table',
    fw: 1,
    fd: 1,
  },
}; // Used to exercise the same itemKey-to-internal-key registry game.js passes into FarmEditor.
assert.strictEqual(window.FarmEditor.init({ DECORATIVE_FURNITURE_DEFS: decorativeFurnitureDefs }), 'farm-init');
assert.strictEqual(window.SeatSurfacePlacementTransform.debugSnapshot().definitionsCaptured, true, 'FarmEditor init should expose the live decorative furniture registry to the adapter');

const rawMap = {
  id: 'seat_transform_test',
  furniture: [
    {
      id: 'chair-a',
      itemKey: 'chairSimpleFurniture',
      col: 2,
      row: 3,
      rotY: 90,
      postX: 0.4,
      postY: 0.2,
      postZ: -0.1,
      postSX: 2,
      postSY: 1.5,
      postSZ: 0.5,
    },
    {
      id: 'table-a',
      itemKey: 'tableRoundFurniture',
      col: 6,
      row: 7,
      postX: 0.25,
      postY: 0.4,
      postSX: 1.8,
    },
  ],
  npcStations: [
    { id: 'chair-a-seat', sourceFurnitureId: 'chair-a', sourceFurnitureKey: 'chairSimpleFurniture', pose: 'sit' },
  ],
}; // Used to reproduce an interior-editor chair translated and non-uniformly scaled after placement.
const effective = window.MapLayoutSystem.getEffectiveMapData(rawMap); // Used as the runtime map copy game.js will later build into a scene.

assert.strictEqual(rawMap.furniture[0].itemKey, 'chairSimpleFurniture', 'raw/editor map data must remain unchanged');
assert.notStrictEqual(effective.furniture[0].itemKey, 'chairSimpleFurniture', 'transformed seats should receive a runtime-only alias item key');
assert.strictEqual(effective.furniture[1].itemKey, 'tableRoundFurniture', 'non-seat furniture must not be aliased');

const fullAliasKey = Object.keys(decorativeFurnitureDefs).find(key => decorativeFurnitureDefs[key].itemKey === effective.furniture[0].itemKey); // Used to inspect the seat alias chosen for player/automatic seating.
assert(fullAliasKey, 'transformed chair alias definition should be registered');
assert.strictEqual(decorativeFurnitureDefs[fullAliasKey].sit, true, 'runtime alias must preserve the base chair sit behavior');
const fullData = window.AuthoredFurniture.peek(fullAliasKey); // Used to verify the private gameplay seat resolver will see transformed local anchor data.
assert(fullData, 'runtime alias should expose derived authored seat data');

function resolveLikeGame(data, anchor, piece, col = piece.col, row = piece.row) {
  const yawRad = (piece.rotY || 0) * Math.PI / 180; // Mirrors game.js resolveSeatWorldTransform's placement yaw.
  const cos = Math.cos(yawRad); // Used by the mirrored X/Z seat-anchor rotation.
  const sin = Math.sin(yawRad); // Used by the mirrored X/Z seat-anchor rotation.
  const ax = anchor.position.x || 0; // Used as the transformed seat's local X coordinate.
  const az = anchor.position.z || 0; // Used as the transformed seat's local Z coordinate.
  const cx = col + (decorativeFurnitureDefs[fullAliasKey].fw || 1) / 2; // Mirrors the private resolver's footprint-center X.
  const cz = row + (decorativeFurnitureDefs[fullAliasKey].fd || 1) / 2; // Mirrors the private resolver's footprint-center Z.
  return {
    x: cx + (ax * cos + az * sin),
    y: anchor.position.y || 0,
    z: cz + (-ax * sin + az * cos),
    halfDepth: (Number(data.footprint?.d) || 1) / 2,
  };
}

const fullAnchor = fullData.seatAnchors[0]; // Used to compare alias output with the visible furniture's T * R * S seat point.
const fullSeat = resolveLikeGame(fullData, fullAnchor, effective.furniture[0]); // Used to model the unchanged private gameplay resolver receiving the transformed alias.
assert(Math.abs(fullSeat.x - 2.95) < 1e-9, `player seat X should follow postX/postZ + yaw (got ${fullSeat.x})`);
assert(Math.abs(fullSeat.z - 3.0) < 1e-9, `player seat Z should follow postX/postZ + yaw (got ${fullSeat.z})`);
assert(Math.abs(fullSeat.y - 0.65) < 1e-9, `player seat Y should follow postY/postSY (got ${fullSeat.y})`);
assert(Math.abs(fullSeat.halfDepth - 0.25) < 1e-9, `seat depth should follow postSZ (got ${fullSeat.halfDepth})`);

const station = effective.npcStations[0]; // Used to verify furniture-bound NPC seating receives vertical/scale correction without X/Z translation twice.
assert(Math.abs(station.col - 2.4) < 1e-9, 'existing furniture-bound station resolution should still fold postX into station col');
assert(Math.abs(station.row - 2.9) < 1e-9, 'existing furniture-bound station resolution should still fold postZ into station row');
assert.notStrictEqual(station.furnitureKey, fullAliasKey, 'bound station should use a separate alias that omits already-folded postX/postZ');
const stationData = window.AuthoredFurniture.peek(station.furnitureKey); // Used to inspect the bound-station seat anchor after its non-translation post transform.
const stationAnchor = stationData.seatAnchors[0]; // Used to compare the station's final world seat point with the player's seat point.
const stationSeat = resolveLikeGame(stationData, stationAnchor, { ...effective.furniture[0], col: station.col, row: station.row }, station.col, station.row); // Used to mirror NPC seat resolution after station origin translation.
assert(Math.abs(stationSeat.x - fullSeat.x) < 1e-9, 'bound NPC and player seat X should resolve to the same transformed surface');
assert(Math.abs(stationSeat.z - fullSeat.z) < 1e-9, 'bound NPC and player seat Z should resolve to the same transformed surface');
assert(Math.abs(stationSeat.y - fullSeat.y) < 1e-9, 'bound NPC and player seat Y should resolve to the same transformed surface');

const built = window.ProceduralFurniture.buildFurnitureGroup(fullAliasKey); // Used to prove aliasing interaction metadata does not fork the visible furniture recipe.
assert.strictEqual(built.builtKey, 'chairSimple', 'runtime alias visuals should delegate to the original furniture key');
assert.deepStrictEqual(visualCalls, ['chairSimple']);

const secondPass = window.MapLayoutSystem.getEffectiveMapData(effective); // Used to ensure harmless re-resolution does not stack the same transform into seat metadata twice.
assert.strictEqual(secondPass.furniture[0].itemKey, effective.furniture[0].itemKey, 'effective map seat aliasing should be idempotent');
assert.strictEqual(window.SeatSurfacePlacementTransform.debugSnapshot().aliasesCreated, 2, 'one player/auto-seat alias and one already-translated bound-station alias should be sufficient');
assert(farmLog.some(line => line.includes('[seat-surface] seat_transform_test')), 'seat transform should emit a mobile-readable farm log diagnostic');

const identityMap = {
  id: 'identity-seat',
  furniture: [{ id: 'chair-b', itemKey: 'chairSimpleFurniture', col: 0, row: 0, rotY: 45 }],
}; // Used to prove ordinary yaw-only chair placement stays on the existing no-alias path.
const identityEffective = window.MapLayoutSystem.getEffectiveMapData(identityMap); // Used as the control case with no editor post transform.
assert.strictEqual(identityEffective.furniture[0].itemKey, 'chairSimpleFurniture', 'ordinary placement/yaw should not allocate a runtime seat alias');

assert(source.includes('normal.x / safeSx') && source.includes('forward.x * transform.sx'), 'non-uniform post scale must transform the seat plane normal/tangent, not only its anchor position');
console.log('Interior seat surface post-transform regression passed.');
