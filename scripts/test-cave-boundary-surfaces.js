'use strict';

const assert = require('node:assert/strict'); // Boundary, material, and height contracts exercised against their actual owners.
const fs = require('node:fs'); // Loads the browser renderer into an isolated context.
const vm = require('node:vm'); // Minimal scene API lets geometry/material assertions run without WebGL.

global.window = global;
require('../docs/js/cavern-sculptor.js');
require('../docs/js/cavern-generator.js');

const original = new Set(); // Wide room and a thin detached branch exercise both rim removal and reachability.
for (let row = 0; row < 9; row++) for (let col = 0; col < 12; col++) original.add(`${col},${row}`);
for (let col = 12; col < 17; col++) original.add(`${col},4`);
const inner = new Set(original); // The sculptor edits its claimed floor before generating the real boundary mesh.
const doorway = [[4, 8], [5, 8], [6, 8]]; // The exterior threshold is the only opening through the protected rim.
const rim = CavernSculptor.reserveOuterRim(inner, doorway); // Real inset operation, rather than a duplicate test implementation.
assert(inner.has('5,8') && inner.has('5,7'), 'the entrance stays connected to the interior');
assert(rim.has('0,4') && rim.has('11,3') && rim.has('16,4'), 'perimeter and severed thin branches become rock');
for (const key of rim) assert(!inner.has(key), 'solid rim cannot also be walkable');
for (const key of inner) {
  if (doorway.some(tile => tile.join(',') === key)) continue;
  const [col, row] = key.split(',').map(Number); // Inner cells must have an original cave tile in every cardinal direction.
  for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) assert(original.has(`${col+dc},${row+dr}`), 'the original outermost cells are all reserved');
}

const generated = CavernGenerator.generateCavernFloor('rim-integration-10', { fast:true }); // Full SDF generation must carry the reserved boundary into runtime data.
const floorKeys = new Set(generated.floor.map(tile => tile.join(','))); // Shared collision/placement membership used below.
assert(generated.outerRimTiles.length > 20 && generated.floor.length > 80);
for (const tile of generated.outerRimTiles) assert(!floorKeys.has(tile.join(',')));
assert.equal(CavernGenerator.entranceConnectedFloor(generated.floor, generated.exitCol, generated.exitRow).removed, 0);
for (let dc=0; dc<2; dc++) for (let dr=0; dr<2; dr++) assert(floorKeys.has(`${generated.nestCol+dc},${generated.nestRow+dr}`), 'complete nest stays inside the rim');

// This seed once lost almost its entire cave when a narrow throat was consumed by the rim.
global.WildlifeSpawn={denCavernZoneOf:()=> 'test-zone',denSpeciesFor:()=> 'gar-wolf',denTurnoverStateForCavern:()=>null};
CavernGenerator.init({EXTERIOR_ZONES:{'test-zone':{packSpecies:['gar-wolf']}},DEN_MOTHER_DEFS:{'gar-wolf':{creatureKey:'gar-wolf-den-mother'}}});
require('../docs/js/cave-site-system.js');
const caveMap=CavernGenerator.synthesizeCavernMapData('rim-integration-10'); // Reuses the real carve above, including collision and native placement generation.
CaveSiteSystem.__test.sitesByMapId.set(caveMap.id,{mapId:caveMap.id,signature:caveMap.id,zoneId:'test-zone',denId:'den_0',contents:'ruin_entrance',inhabitant:'bandit_hideout'});
CaveSiteSystem.decorateCavernMapData(caveMap.id,caveMap);
assert(caveMap.caveRuinEntrance,'the narrow-throat regression cave must still have room for its requested ruin');
assert.equal(caveMap.mesh.wallHeightScale,2.5);
assert(caveMap.floor.length > generated.floor.length, 'door berth expands the actual floor');
for (const cell of caveMap.caveRuinEntrance.clearanceTiles) assert(caveMap.floorSurfaceByTile[`${cell.col},${cell.row}`] != null, 'new approach cells have sampled grounding');
assert.equal(CavernGenerator.entranceConnectedFloor(caveMap.floor,caveMap.exitCol,caveMap.exitRow).removed,0,'expansion stays connected to the entrance');
const expandedFloorKeys = new Set(caveMap.floor.map(tile=>tile.join(','))); // Recarved clearances create new placement-safe floor cells.
for(const cell of caveMap.caveRuinEntrance.tunnelTiles) assert(!expandedFloorKeys.has(`${cell.col},${cell.row}`),'the entire rear tunnel stays inside rock');
const colliderKeys=new Set(caveMap.colliders.map(tile=>tile.join(','))); // Runtime collision uses the same protected rim as generation.
for(const tile of caveMap.outerRimTiles) assert(colliderKeys.has(tile.join(',')));
for(const feature of [...caveMap.oreRocks,...(caveMap.caveBanditSpawns||[]),...(caveMap.caveProps||[]).filter(prop=>!prop.embedded)]) assert(expandedFloorKeys.has(`${feature.col},${feature.row}`),'every generated floor feature remains off solid rock');

class Attribute { constructor(array, size) { this.array = new Float32Array(array); this.itemSize = size; } }
class Geometry {
  constructor() { this.attributes = {}; this.userData = {}; }
  setAttribute(key, value) { this.attributes[key] = value; }
  setIndex(value) { this.index = value; }
  computeVertexNormals() {}
}
class Mesh {
  constructor(geometry, material) { this.geometry=geometry; this.material=material; this.isMesh=true; this.userData={}; }
}
class Material { constructor(options) { Object.assign(this, options); } }
const canonical = { color:'wall-rock', map:{ repeat:{set(x,y){this.x=x;this.y=y;}}, offset:{set(){}}, center:{set(){}} } }; // Stand-in for the shared natural-surface material returned by the real game's factory.
const naturalCalls = []; // Both standalone floor and shell must choose the same preset.
const mappingCalls = []; // Verifies delegation to the wall's stretch mapper and patch size.
const three = { BufferGeometry:Geometry, Float32BufferAttribute:Attribute, BufferAttribute:Attribute, Mesh, MeshBasicMaterial:Material, FrontSide:0, ClampToEdgeWrapping:1001, Group:class {} }; // Only APIs used by these two mesh builders are needed.
const context = { console, THREE:three, NaturalSurfaceMaterials:{naturalizeMesh(mesh, family, mode){naturalCalls.push([family,mode]);mesh.material=canonical;}}, HobunjiSurfaceStretchUV:{mapMesh(mesh, options){mappingCalls.push(options);return {mapped:true};}} }; // Runs the production builder with observable material/UV owners.
context.window=context;
vm.runInNewContext(fs.readFileSync('docs/js/interior-scene-builder.js','utf8'), context);
const builder=context.InteriorSceneBuilder; // Actual shared renderer used by game.js.
const raw={positions:[0,-1,0, 1,0,0, 0,2,1],indices:[0,1,2],wallHeightBaseY:0,wallHeightScale:2.5}; // A floor, underside, and wall sample isolate upward-only growth.
const wall=builder.buildCarvedCavernMesh(three,raw);
assert.deepEqual(Array.from(wall.geometry.attributes.position.array),[0,-1,0,1,0,0,0,5,1]);
assert.equal(raw.positions[7],2,'height changes never mutate the cached generated shell');
const normal=builder.buildCarvedCavernMesh(three,{...raw,wallHeightScale:1}); // Ordinary cave height remains unchanged.
assert.equal(normal.geometry.attributes.position.array[7],2);
const floor=builder.buildCavernFloorMesh(three,[[0,0],[1,0]],{'0,0':0,'1,0':0},{wallMaterial:wall.material}); // Gameplay shares the exact material instance rather than approximating its color or lighting.
assert.equal(floor.material,wall.material);
assert.equal(floor.material.map.repeat.x,1);
assert.equal(floor.material.map.wrapS,three.ClampToEdgeWrapping);
assert.equal(floor.userData.naturalSurfaceUvOwner,'HobunjiSurfaceStretchUV');
const standalone=builder.buildCavernFloorMesh(three,[[0,0]],{},{}); // Editor/standalone builds use the same default material path even without a passed wall instance.
assert.equal(standalone.material,canonical);
assert(naturalCalls.every(([family,mode])=>family==='rocks' && mode==='planar-stretch'));
assert(mappingCalls.every(call=>call.maxPatchWorldSize===6));
console.log('PASS solid cave rim, connected floor, complete nest, shared wall/floor material and stretch, upward-only 2.5x ruin wall growth');
