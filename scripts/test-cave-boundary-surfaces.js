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
const plainTopY=Math.max(...caveMap.mesh.positions.filter((_,i)=>i%3===1)); // Every procedural cave is now carved at the tall height, ruin or not.
assert(plainTopY > 5,'ordinary caves share the 2.5x carved height');
const nearestAbove=(mesh,x,z,fromY)=>{ // Closest shell surface above a point, and whether it faces up (rock below) or down (air below).
  const P=mesh.positions,I=mesh.indices; let best=null;
  for(let i=0;i<I.length;i+=3){const a=I[i]*3,b=I[i+1]*3,c=I[i+2]*3;const den=(P[b+2]-P[c+2])*(P[a]-P[c])+(P[c]-P[b])*(P[a+2]-P[c+2]);if(Math.abs(den)<1e-12)continue;
    const wa=((P[b+2]-P[c+2])*(x-P[c])+(P[c]-P[b])*(z-P[c+2]))/den,wb=((P[c+2]-P[a+2])*(x-P[c])+(P[a]-P[c])*(z-P[c+2]))/den,wc=1-wa-wb;if(wa<0||wb<0||wc<0)continue;
    const y=wa*P[a+1]+wb*P[b+1]+wc*P[c+1];if(y<=fromY||(best&&y>=best.y))continue;
    best={y,up:(P[b+2]-P[a+2])*(P[c]-P[a])-(P[b]-P[a])*(P[c+2]-P[a+2])>0};}
  return best;
};
const assertRoofed=(map,label)=>{ // Each walkable tile sits under the faceted roof, never an open shaft.
  const vault=map.mesh.vaultCeiling;
  assert(vault && vault.topY > vault.startY && vault.startY > 3,`${label} carves a faceted roof above full-height walls`);
  for(const [col,row] of map.floor){
    const hit=nearestAbove(map.mesh,col+.5,row+.5,1);
    assert(hit && !hit.up,`${label} tile ${col},${row} has a roof over open air`);
  }
  // Low-poly roof: downward faces in the roof band lie on a limited set of
  // shared flat planes (so the stretch mapper finds large surfaces), not a smooth curve.
  const P=map.mesh.positions,I=map.mesh.indices,planes=new Map(); let roofArea=0;
  for(let i=0;i<I.length;i+=3){const a=I[i]*3,b=I[i+1]*3,c=I[i+2]*3;
    if(Math.min(P[a+1],P[b+1],P[c+1])<vault.startY-.2)continue;
    const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz);if(l<1e-9||ny/l>-.3)continue;
    const n=[nx/l,ny/l,nz/l],d=n[0]*P[a]+n[1]*P[a+1]+n[2]*P[a+2],key=[...n,d].map(v=>Math.round(v*50)).join(',');
    planes.set(key,(planes.get(key)||0)+l/2);roofArea+=l/2;}
  const facets=[...planes.values()].filter(area=>area>=2);
  assert(facets.length>=10,`${label} roof has many flat facets (${facets.length})`);
  assert(facets.reduce((sum,area)=>sum+area,0)>=roofArea*.6,`${label} most roof area lies on shared flat facets`);
  assert.equal(CavernGenerator.rockCoveredFloorTiles(map.floor,map.mesh,new Set([`${map.exitCol},${map.exitRow}`])).size,0,`${label} has no walkable tile inside rendered rock`);
};
assertRoofed(caveMap,'ordinary cave');
assert(generated.rockCoveredFloorTiles <= generated.floor.length*.03,`walls land on tile edges, so few tiles need the rock-covered collision fallback (${generated.rockCoveredFloorTiles})`);
CaveSiteSystem.__test.sitesByMapId.set(caveMap.id,{mapId:caveMap.id,signature:caveMap.id,zoneId:'test-zone',denId:'den_0',contents:'ruin_entrance',inhabitant:'bandit_hideout'});
CaveSiteSystem.decorateCavernMapData(caveMap.id,caveMap);
assert(caveMap.caveRuinEntrance,'the narrow-throat regression cave must still have room for its requested ruin');
assert.equal(caveMap.cavernCarvedHeightScale,2.5,'the clearance recarve sweeps the probe 2.5x higher');
assert.equal(caveMap.mesh.wallHeightScale,undefined,'ruin height is carved, never stretched from the shorter shell');
assert(Math.abs(Math.max(...caveMap.mesh.positions.filter((_,i)=>i%3===1)) - plainTopY) < .2,'the ruin recarve keeps the shared tall height');
assertRoofed(caveMap,'ruin cave');
assert(Math.abs(caveMap.floorSurfaceY) < 0.1,'taller carve keeps the floor at its original height');
for(const [key,y] of Object.entries(caveMap.floorSurfaceByTile)) assert(y <= 0.5,`edge tile ${key} grounds on the floor, not the rock top (${y})`);
const overheadSlabTiles=caveMap.floor.filter(([col,row])=>{ // Downward-facing rock hanging above an open tile's floor.
  const x=col+.5,z=row+.5,P=caveMap.mesh.positions,I=caveMap.mesh.indices; let floorHit=false,slab=false;
  for(let i=0;i<I.length;i+=3){const a=I[i]*3,b=I[i+1]*3,c=I[i+2]*3;const den=(P[b+2]-P[c+2])*(P[a]-P[c])+(P[c]-P[b])*(P[a+2]-P[c+2]);if(Math.abs(den)<1e-12)continue;
    const wa=((P[b+2]-P[c+2])*(x-P[c])+(P[c]-P[b])*(z-P[c+2]))/den,wb=((P[c+2]-P[a+2])*(x-P[c])+(P[a]-P[c])*(z-P[c+2]))/den,wc=1-wa-wb;if(wa<0||wb<0||wc<0)continue;
    const y=wa*P[a+1]+wb*P[b+1]+wc*P[c+1],up=(P[b+2]-P[a+2])*(P[c]-P[a])-(P[b]-P[a])*(P[c+2]-P[a+2])>0;
    if(up&&Math.abs(y)<.1)floorHit=true; else if(!up&&y>.5&&y<caveMap.mesh.vaultCeiling.startY-.3)slab=true;} // The vaulted roof itself is not a slab.
  return floorHit&&slab;
});
assert(overheadSlabTiles.length <= caveMap.floor.length*.02,`taller carve refines every column instead of leaving floating slabs (${overheadSlabTiles.length})`);
assert(caveMap.floor.length > generated.floor.length, 'door berth expands the actual floor');
{ // The approach stays open along the door's axis; only rock-rounded outer corners may become solid.
  const ruin=caveMap.caveRuinEntrance, grounded=cell=>caveMap.floorSurfaceByTile[`${cell.col},${cell.row}`] != null;
  const axis=ruin.clearanceTiles.filter(cell=>ruin.rotY%180===0 ? cell.col===ruin.col : cell.row===ruin.row);
  assert(axis.length>=5 && axis.every(grounded),'every approach cell in front of the door is grounded floor');
  assert(ruin.clearanceTiles.filter(grounded).length >= ruin.clearanceTiles.length*.9,'new approach cells have sampled grounding');
}
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
console.log('PASS solid cave rim, connected floor, complete nest, shared wall/floor material and stretch, upward-only 2.5x ruin wall growth, tall faceted low-poly roofs in every cave, walls on tile edges');
