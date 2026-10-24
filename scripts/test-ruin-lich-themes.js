// Contract smoke tests for the live Harlyao ruin tradition composer.
// Run with: node scripts/test-ruin-lich-themes.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const themeSource = fs.readFileSync('docs/js/dev-random-ruin-lich-themes.js', 'utf8'); // Executed against minimal THREE/ruin mocks to exercise generation, update and teardown.
const ruinSource = fs.readFileSync('docs/js/dev-random-ruin-interior-map.js', 'utf8'); // Static checks preserve the seeded boss-theme handoff and Hronal-only lava setting.
const puzzlesSource = fs.readFileSync('docs/js/dev-random-ruin-simple-puzzles.js', 'utf8'); // Confirms non-Hronal ropes never create lava.
const fogSource = fs.readFileSync('docs/js/cloud-forest-fog.js', 'utf8'); // Confirms themed tint, light source and lantern rules are wired into the shared overlay.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Native player movement owns Tothal ice friction and its ordinary collision.
const bootstrapSource = fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js', 'utf8'); // Ensures module is loaded after the composer runtime.
assert.match(ruinSource, /const theme = .*requestedSeed/, 'Ruin theme must remain stable across generation retries');
assert.match(ruinSource, /puzzleOptions\.lavaBasin = theme === 'hronal'/, 'Only Hronal generates lava basins');
assert.match(ruinSource, /floorSet:ruin\.floorSet,ceilingY:ruin\.ceilingY/, 'Composer must receive the authoritative walkable set and ceiling');
assert.match(puzzlesSource, /state\?\.context\?\.theme !== 'hronal'\) return null/, 'Rope lava is Hronal-only');
assert.match(fogSource, /tradition === 'kanthic' \? 1/, 'Kanthic rooms retain pure blackness');
assert.match(fogSource, /ruinTradition === 'tothal'\) return/, 'Tothal lantern illumination is disabled');
assert.match(fogSource, /ruinTradition === 'kanthic' \? \.375 : 1/, 'Kanthic lantern radius grows 50% from .25 to .375 of the regular radius');
assert.match(fogSource, /getKanthicLanternRadiusTiles:\(\)=>tuning\.lantern\.radiusTiles\*\.375/, 'Plasm visibility uses the same expanded .375 lantern radius as actual lighting');
assert.match(fogSource, /drawRuinTraditionLightMasks/, 'Ruin sources must be drawn through the central 2D overlay');
assert.match(bootstrapSource, /dev-random-ruin-lich-themes\.js/, 'Loader must include the theme composer');

class Vector {
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(value) { return this.set(value, value, value); }
  applyAxisAngle() { return this; }
}
class Node {
  constructor() { this.children = []; this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(); this.matrix = {}; this.visible = true; this.disposed=false; this.userData={}; }
  add(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove(node) { this.children = this.children.filter(child => child !== node); node.parent = null; }
  traverse(visitor) { visitor(this); for (const child of this.children) child.traverse(visitor); }
  updateMatrix() {}
  dispose() {this.disposed=true;}
}
class Geometry { constructor() {this.attributes={};this.indices=[];this.disposed=false;} rotateX(){return this;}rotateZ(){return this;}setAttribute(key,value){this.attributes[key]=value;return this;}getAttribute(key){return this.attributes[key];}setIndex(indices){this.indices=indices;return this;}dispose(){this.disposed=true;} }
class Material { constructor(options) { Object.assign(this, options); } dispose() {} }
class Mesh extends Node { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
class Instances extends Mesh { constructor(geometry, material, count) { super(geometry, material); this.count = count; this.instanceMatrix = {}; this.isInstancedMesh=true; } setMatrixAt() {} }
const THREE = {
  Group:Node, Object3D:Node, Vector3:Vector, Mesh, InstancedMesh:Instances,
  PlaneGeometry:Geometry, ConeGeometry:Geometry, TetrahedronGeometry:Geometry, BoxGeometry:Geometry,
  BufferGeometry:Geometry,Float32BufferAttribute:class {constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}getX(i){return this.array[i*this.itemSize];}getY(i){return this.array[i*this.itemSize+1];}getZ(i){return this.array[i*this.itemSize+2];}},
  MeshBasicMaterial:Material, DoubleSide:2, RepeatWrapping:1,
  TextureLoader:class { load(_url, done) { const texture = {dispose(){}}; done?.(texture); return texture; } },
}; // Lightweight renderer stand-ins preserve creation, instance batching and cleanup code paths.

function setup(theme, playerX = 3.1, playerZ = 3.1, options = {}) {
  let composer = null; // Registered composer is the subject of each isolated runtime test.
  let impactCount = 0; // Tracks shared collision impact calls when an ice slide is obstructed.
  let afflictionCount = 0; // Confirms area hazards affect the same ResourceSystem as normal combat.
  let footprint = null; // Captures a Hronal column's live collision enabled gate.
  const damageEvents=[]; // Captures canonical direct-damage and outward-knockback arguments.
  const audioEvents=[]; // Verifies release plays the existing rock sample at double speed/pitch.
  const mappedPatches=[]; // Verify connected nine-slice remapping occurs whenever a puddle's grid changes.
  const presentationHeights=[]; // Detect hazards stealing rope/bridge presentation height.
  const player = {x:playerX * 64, y:playerZ * 64, health:100, facing:3};
  const window = {
    THREE, DevRandomRuinSimplePuzzles:{registerComposer(next) { composer = next; }},
    DevRandomRuinTileOccupancy:{
      solidAt:() => false, refresh() {}, clearSolids() {},
      addSolidBox(_id, box, enabled) { footprint = {box,enabled}; },
    },
    KnockbackCollisionImpact:{resolveStrength() { impactCount++; }},
    ResourceSystem:{addAffliction() { afflictionCount++; }, spendFooting() { afflictionCount++; }},
    DevRandomRuin:{syncPlayerPresentationHeight(y) {presentationHeights.push(y);}},
    AudioSystem:{gameAudioConfig:() => ({sfxVolume:1})},
    CloudForestFog:{getKanthicLanternRadiusTiles:()=>options.lanternRadius??.9}, // Default: 2.4 × .375. Cap stress tests may suppress visibility without changing production logic.
    HobunjiSurfaceStretchUV:{
      mapGeometry(geo,settings){
        // The real nine-slice mapper is independently covered by
        // scripts/test-surface-stretch-uv.js. Here check that the
        // compositor passes ONE connected mesh's positions through it
        // on each grid edit rather than tiling the source PNG per tile.
        const p=geo.getAttribute('position');
        const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
        for(let i=0;i<p.count;i++){
          bounds.minX=Math.min(bounds.minX,p.getX(i));bounds.maxX=Math.max(bounds.maxX,p.getX(i));
          bounds.minZ=Math.min(bounds.minZ,p.getZ(i));bounds.maxZ=Math.max(bounds.maxZ,p.getZ(i));
        }
        const uv=[];
        for(let i=0;i<p.count;i++)uv.push(
          (p.getX(i)-bounds.minX)/Math.max(1,bounds.maxX-bounds.minX),
          (p.getZ(i)-bounds.minZ)/Math.max(1,bounds.maxZ-bounds.minZ));
        geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
        mappedPatches.push({geo,settings});
        return geo;
      },
    },
  }; // Gameplay APIs stubbed at the contract boundaries, not duplicated in the tests.
  const document = {getElementById:() => null}; // The mobile diagnostics path intentionally handles a missing badge.
  const Audio = class {constructor(url){this.url=url;this.playbackRate=1;}play(){audioEvents.push({url:this.url,rate:this.playbackRate});return Promise.resolve();}};
  vm.runInNewContext(themeSource, {window, document, Audio, console}, {filename:'dev-random-ruin-lich-themes.js'});
  const floorSet = new Set();
  for(let x=2;x<(options.maxX||12);x++)for(let z=2;z<12;z++)floorSet.add(x+','+z);
  const context = {
    theme, spawn:options.spawn, seed:123, root:new Node(), ceilingY:3, floorSet,
    meta:{floorSurfaceY:0,wallHeight:3,rooms:options.rooms||[{id:'test',col:0,row:0,w:10,h:10}]},
  };
  const kit = {
    deps:{getActiveCamera:()=>options.camera,damagePlayer:(...args)=>damageEvents.push(args),damageCreature:(...args)=>damageEvents.push(args),TILE:64,player,hostileObjects:new Set(),playerMesh:{position:{y:0},userData:{portraitModelHeight:1.8}},handlePlayerDeath() {}},
    root:new Node(),state:{context,checkpoints:options.checkpoints},group(){return this.root;},sampleSupport(){return {y:0};},
    roomBounds(_meta,room){return room.bounds||{minX:2,maxX:12,minZ:2,maxZ:12};},makeBasic(){return new Material({color:0x777777});},
  }; // The 10×10 fixture plus shared floorSet verifies the entire room is iced.
  composer.buildRooms(kit, context);
  const api = window.DevRandomRuinLichThemes;
  const tick = (frames, seconds = .25) => {for (let index = 0; index < frames; index++) composer.update(kit, index * seconds * 1000, seconds);};
  return {api,kit,context,composer,player,tick,damageEvents,get impactCount(){return impactCount;},get afflictionCount(){return afflictionCount;},get footprint(){return footprint;}, audioEvents,mappedPatches,presentationHeights};
}

function assertPlasmSeams(t) {
  t.kit.root.traverse(mesh=>{
    if(!mesh.name?.startsWith('kanthic_plasm_connected_room_'))return;
    const vertices=new Map(),p=mesh.geometry.getAttribute('position'),uv=mesh.geometry.getAttribute('uv'); // Compare both copies of every joined vertex, including concave corners.
    for(let i=0;i<p.count;i++){
      const key=p.getX(i).toFixed(5)+','+p.getZ(i).toFixed(5); // Float-safe world-coordinate key across adjoining tile lattices.
      const value=[p.getY(i),uv.getX(i),uv.getY(i)],previous=vertices.get(key); // Matching positions must share height and continuous UVs.
      if(previous)assert.ok(value.every((n,index)=>Math.abs(n-previous[index])<.00001),
        'No cracks or UV seams at '+key+': '+previous+' vs '+value);
      vertices.set(key,value);
    }
  });
}

{
  const t=setup('kanthic',3,3,{lanternRadius:.02}); // Grow a nonrectangular puddle, which exposes concave-corner cracks absent from square seed tests.
  t.tick(12,.25);
  assertPlasmSeams(t);
  const initialKeys=[]; // Recover exact seeded positions after the synchronous checkpoint lifecycle.
  t.composer.onPlayerDeath(t.kit);
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))initialKeys.push(x+','+z);
  t.tick(12,.25);
  assert.ok(t.api.snapshot().plasmTiles>initialKeys.length,'Fixture grows before ordinary combat death');
  const start=puzzlesSource.indexOf('  function respawnAtCheckpoint('),end=puzzlesSource.indexOf('\n  function buildCheckpoints(',start); // Execute the actual recovery owner rather than imitating its callback ordering.
  const recovery={checkpoints:{active:{point:{x:3,y:0,z:3}},respawnCount:0},context:t.context,kit:t.kit}; // Minimal native checkpoint state.
  const respawn=vm.runInNewContext('('+puzzlesSource.slice(start,end)+')',{
    inRuin:()=>true,state:recovery,deps:t.kit.deps,composers:[t.composer],MAP_ID:'map_i_dev_random_ruin',
    restorePlayerScene(){},clearPlayerAfflictions(){},setPlayerWorld(){},restoreRopeEquipment(){},
    clonePoint:p=>({...p}),CHECKPOINT_INVULN_MS:1000,performance:{now:()=>100},console,
  }); // Production callback must run before health is restored in the same synchronous call.
  t.player.maxHealth=100;t.player.health=0;
  assert.equal(respawn('combat'),true);
  assert.equal(t.player.health,50,'Checkpoint has already restored health before the next render');
  assert.equal(t.api.snapshot().plasmTiles,initialKeys.length,'Ordinary death immediately resets growth');
  for(const key of initialKeys){
    const [x,z]=key.split(',').map(Number); // Check the exact original cluster, not just its size.
    assert.ok(t.api.isPlasmAt(x+.5,z+.5));
  }
  assert.equal(recovery.checkpoints.respawnCount,1);
  assertPlasmSeams(t);
  const [x,z]=initialKeys[0].split(',').map(Number); // Stand directly over the puddle for traversal/contact regressions.
  t.player.x=(x+.5)*64;t.player.y=(z+.5)*64;
  t.kit.ownsPlayerMotion=()=>true;
  t.tick(16,.25);
  assert.equal(t.player.health,50,'A rope or flight over plasm cannot cause fatal immersion');
  assert.equal(t.presentationHeights.length,0,'Rope and flight height stay owned by traversal');
  t.kit.ownsPlayerMotion=()=>false;
  t.kit.deps.playerMesh.position.y=3;
  t.kit.sampleSupport=()=>({y:3}); // A bridge added later must not lift the original puddle onto its deck when remapped.
  t.tick(16,.25);
  assert.equal(t.player.health,50,'A raised bridge above plasm is safe');
  assert.equal(t.presentationHeights.length,0,'Plasm never overwrites bridge height');
  t.composer.onPlayerDeath(t.kit);
  t.kit.root.traverse(mesh=>{
    if(!mesh.name?.startsWith('kanthic_plasm_connected_room_'))return;
    const p=mesh.geometry.getAttribute('position'); // Original puddle elevation survives a reset/remap under the new bridge.
    for(let i=0;i<p.count;i++)assert.ok(p.getY(i)<=.227);
  });
  t.kit.deps.playerMesh.position.y=0;
  t.tick(13,.25);
  assert.equal(t.player.health,0,'Contact at the actual puddle elevation remains lethal');
  assert.ok(t.presentationHeights.length>0,'Real immersion still lowers player presentation');
  t.composer.clear();
}

{
  const t = setup('hronal');
  const before = t.api.snapshot();
  assert.equal(before.theme, 'hronal');
  assert.equal(before.iceTiles, 0);
  assert.equal(before.plasmTiles, 0);
  assert.ok(before.lightSources > 0);
  assert.equal(before.totalPillars, 1);
  assert.equal(typeof t.footprint.enabled, 'function', 'Pillar collision must be tied to its intact phase');
  assert.equal(t.footprint.enabled(), true);
  t.tick(16);
  assert.equal(t.api.snapshot().burstPillars, 1, 'Three one-second pulses must precede a pillar blast');
  assert.equal(t.footprint.enabled(), false, 'Destroyed pillar no longer collides');
  assert.ok(t.afflictionCount > 0, 'Hronal fire and Footing pressure hit nearby actors');
  t.composer.clear();
  assert.equal(t.api.snapshot().active, false, 'Reroll/leave tears down the theme');
}
{
  const t = setup('tothal');
  const before = t.api.snapshot();
  assert.equal(before.theme, 'tothal');
  assert.equal(before.iceTiles, t.context.floorSet.size, 'Every walkable Tothal floor cell is icy, with no random clear tiles');
  for(const key of t.context.floorSet){
    const [x,z]=key.split(',').map(Number);
    assert.equal(t.api.isIceAt(x+.5,z+.5),true,'The same floor tiles drive ice physics and surface render: '+key);
  }
  assert.equal(t.api.isIceAt(12.5,6.5),false,'Outside the generated floor, normal traction resumes');
  const physics=t.api.movementPhysicsAt(6.5,6.5);
  assert.ok(physics?.retention20Hz>.85&&physics.retention20Hz<1,'Tothal ice preserves momentum between frames');
  assert.ok(physics?.accelerationFactor<.5&&physics.turningFactor<.5,'Ice uses weak traction for acceleration and steering');
  assert.equal(t.api.movementPhysicsAt(12.5,6.5),null,'Normal ground must not inherit ice physics');
  assert.ok(before.icicles >= 5,'Evenly distributed Tothal clusters must be more numerous than the old sparse icicles');
  assert.ok(before.lightSources > 0);
  assert.equal(before.totalPillars, 0);
  assert.equal(before.plasmTiles, 0);
  const target = [];
  t.kit.root.traverse(mesh => { if (mesh.name === 'tothal_falling_icicle') target.push(mesh); });
  assert.ok(target.length>=5,'Every 3x3 clear room cell should produce a cluster with just one draw call');
  for(const mesh of target){
    const attr=mesh.geometry.attributes.position;
    assert.ok(attr.count>=5*7*3,'Icicle meshes must contain several needles, batched in one mesh');
    const verts=attr.array;
    const triangles=verts.length/9;
    assert.ok(triangles>=35,'Each cluster contains at least five irregular cone needles');
  }
  const caps=[];
  t.kit.root.traverse(mesh=>{if(mesh.name?.startsWith('tothal_ice_sheen_edge_'))caps.push(mesh);});
  assert.ok(caps.length>1,'Connected ice and exposed outer edges must use shared curved-cap variants');
  const curved=caps.some(mesh=>mesh.geometry.attributes.position.array.some((v,i,arr)=>
    i%3===1 && v>0 && v<.025)); // Smooth falling shoulder vertices around snow-like edges.
  assert.ok(curved,'Ice caps need intermediate-height bevels, not flat square tiles');
  t.player.x = target[0].position.x * 64;
  t.player.y = target[0].position.z * 64;
  t.tick(20, .25);
  assert.ok(t.api.snapshot().fallenIcicles >= 1, 'Icicles triggered by a passing actor eventually shatter');
  assert.ok(t.afflictionCount > 0, 'Shatter damage uses ordinary status and Footing APIs');
  assert.ok(t.damageEvents.some(args=>args[0]===18&&args[3]===220),'Icicles route 18 direct damage and outward knockback through canonical damagePlayer');
  assert.ok(t.audioEvents.some(event=>event.rate===2&&event.url.includes('sfx_break_rock')),'Icicles drop with the break-rock sample at double pitch and speed');
  assert.ok(t.audioEvents.some(event=>event.rate===1&&event.url.includes('sfx_break_rock')),'If WebAudio is unavailable, impact keeps the original-length break-rock sound');
  assert.match(themeSource,/pitchRockWithoutSpeedChange\(decoded,audioContext,1\.5\)/,'Supported WebAudio uses an offline 1.5x pitch transform at the original duration');
  t.composer.clear();
  assert.equal(t.api.snapshot().active, false);
}
{
  const t = setup('kanthic');
  const initial=t.api.snapshot().plasmTiles;
  assert.ok([4,9,16].includes(initial),'A clear Kanthic room must start with a contiguous 2x2, 3x3 or 4x4 puddle');
  const seed=[];
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))seed.push({x,z});
  assert.equal(seed.length,initial,'Plasm tile query must reflect exact render and physics footprint');
  const minX=Math.min(...seed.map(p=>p.x)),maxX=Math.max(...seed.map(p=>p.x));
  const minZ=Math.min(...seed.map(p=>p.z)),maxZ=Math.max(...seed.map(p=>p.z));
  assert.equal((maxX-minX+1)*(maxZ-minZ+1),initial,'Seed is a solid square, not a scattered set of puddles');
  const caps=[];
  t.kit.root.traverse(mesh=>{if(mesh.name?.startsWith('kanthic_plasm_connected_room_'))caps.push(mesh);});
  assert.equal(caps.length,1,'A contiguous room puddle uses one continuous textured surface');
  const initialSurface=caps[0],initialGeometry=initialSurface.geometry;
  assert.equal(initialSurface.userData.plasmUvMapping,'edge-preserving-nine-slice','Plasm must use the existing snow nine-slice mapping API');
  assert.equal(t.mappedPatches.length,1,'Initial seeded cluster must be UV-mapped once');
  assert.equal(t.mappedPatches[0].settings.angleToleranceDeg,89,'Shared snow mapper must preserve curved lip + top as one surface');
  // A 2x2–4x4 blob must have NO lip where two cells meet, one UV domain
  // across that shared edge, and a visibly tapered lip at its exterior.
  const surfacePosition=initialGeometry.getAttribute('position');
  const surfaceUv=initialGeometry.getAttribute('uv');
  const minCellX=Math.min(...seed.map(p=>p.x));
  const minCellZ=Math.min(...seed.map(p=>p.z));
  const samples=(targetX,targetZ)=>Array.from({length:surfacePosition.count},(_,i)=>i)
    .filter(i=>Math.abs(surfacePosition.getX(i)-targetX)<.00001&&
               Math.abs(surfacePosition.getZ(i)-targetZ)<.00001)
    .map(i=>({y:surfacePosition.getY(i),u:surfaceUv.getX(i),v:surfaceUv.getY(i)}));
  const joined=samples(minCellX+1,minCellZ+.22);
  assert.ok(joined.length>=2,'Adjoining plasm cells retain identical shared-edge vertices');
  assert.ok(joined.every(p=>Math.abs(p.y-.226)<.00001),
    'Internal plasm tile borders must remain at full cap height, never curve downward');
  assert.ok(joined.every(p=>Math.abs(p.u-joined[0].u)<.00001&&Math.abs(p.v-joined[0].v)<.00001),
    'Shared sides use matching UVs, not a restarted per-tile texture');
  const outer=samples(minCellX,minCellZ+.22);
  assert.ok(outer.length&&outer.every(p=>Math.abs(p.y-.006)<.00001),
    'Only the outside edge of the entire puddle falls to ground level');
  const tapered=samples(minCellX+.11,minCellZ+.22);
  assert.ok(tapered.some(p=>p.y>.03&&p.y<.20),
    'An exposed outer edge must have intermediate-height curved vertices');
  assert.ok(t.mappedPatches[0].settings.edgeSourceFraction===.32,
    'Nine-slice mapper protects the image border, as snow does');

  assert.equal(t.api.snapshot().lightSources, 0, 'Kanthic relies on lantern alone');
  // Turn toward the seed from outside the narrowed radius; the player can
  // still see the direction, but not the actual puddle at lantern range.
  const corners=[[2.1,2.1],[11.8,2.1],[2.1,11.8],[11.8,11.8]];
  const far=corners.sort((a,b)=>Math.min(...seed.map(p=>Math.hypot(b[0]-p.x-.5,b[1]-p.z-.5)))-
                               Math.min(...seed.map(p=>Math.hypot(a[0]-p.x-.5,a[1]-p.z-.5))))[0];
  t.player.x=far[0]*64;t.player.y=far[1]*64;
  t.player.facing=Math.atan2(seed[0].z+.5-far[1],seed[0].x+.5-far[0]);
  t.tick(12,.25);
  const grown=t.api.snapshot().plasmTiles;
  assert.ok(grown>initial,'A local puddle grows a half ring after three seconds');
  assert.ok(initialGeometry.disposed,'Retexturing after plasm growth must dispose the previous GPU geometry');
  assert.equal(t.mappedPatches.length,2,'One half-ring beat rebuilds the mesh only once');
  assert.equal(t.mappedPatches[1].settings.edgeSourceFraction,.32,'Plasm must preserve source-PNG nine-slice borders');
  // Step out of the chamber; no room transition may grow or cull the patch.
  t.player.x=30*64;t.player.y=30*64;
  t.tick(2,.25);
  assert.equal(t.api.snapshot().plasmTiles,grown,
    'When the player stands outside every room, even unseen plasm must not grow');
  t.composer.clear();
  assert.equal(t.api.snapshot().active,false,'Only leaving/clearing the entire ruin removes the puddle');
  // Teardown is idempotent; repeated clear is safe.
  t.composer.clear();
}
{
  // Each room has an independent seed and an independent growth clock.
  // Entering another room pauses the old puddle without erasing or advancing it.
  const rooms=[
    {id:'west',bounds:{minX:2,maxX:12,minZ:2,maxZ:12}},
    {id:'east',bounds:{minX:12,maxX:22,minZ:2,maxZ:12}},
  ];
  const t=setup('kanthic',3,3,{rooms,maxX:22});
  const seedWest=[],seedEast=[];
  for(let z=2;z<12;z++)for(let x=2;x<22;x++)if(t.api.isPlasmAt(x+.5,z+.5)){
    (x<12?seedWest:seedEast).push(x+','+z);
  }
  assert.ok([4,9,16].includes(seedWest.length)&&[4,9,16].includes(seedEast.length),
    'Each room receives its own initial solid 2x2–4x4 puddle');
  const meshes=()=>{const result=new Map();t.kit.root.traverse(mesh=>{
    if(mesh.name?.startsWith('kanthic_plasm_connected_room_'))result.set(mesh.name,mesh);
  });return result;};
  const originalWest=meshes().get('kanthic_plasm_connected_room_0');
  const originalEast=meshes().get('kanthic_plasm_connected_room_1');
  assert.ok(originalWest&&originalEast,'Each room has its own one-piece connected nine-slice surface');
  const pickFarthestCorner=(minX,maxX,seed)=>{
    const points=[[minX+.1,2.1],[maxX-.2,2.1],[minX+.1,11.8],[maxX-.2,11.8]];
    return points.sort((a,b)=>{
      const far=p=>Math.min(...seed.map(key=>{
        const [x,z]=key.split(',').map(Number);
        return Math.hypot(p[0]-x-.5,p[1]-z-.5);
      }));
      return far(b)-far(a);
    })[0];
  };
  const farEast=pickFarthestCorner(12,22,seedEast);
  t.player.x=farEast[0]*64;t.player.y=farEast[1]*64;
  t.tick(12,.25);
  const eastAfterGrowth=[];
  for(let z=2;z<12;z++)for(let x=12;x<22;x++)if(t.api.isPlasmAt(x+.5,z+.5))eastAfterGrowth.push(x+','+z);
  assert.ok(eastAfterGrowth.length>seedEast.length,
    'An unseen puddle grows in the room the player actually occupies');
  assert.equal(meshes().get('kanthic_plasm_connected_room_0'),originalWest,
    'Updating the east-room grid must not remap or replace the unchanged west-room mesh');
  assert.equal(originalWest.geometry.disposed,false,'Dormant rooms retain their live nine-slice UV geometry');
  assert.equal(originalEast.geometry.disposed,true,'Only the changed east room must retire its previous UV geometry');
  assert.ok(meshes().get('kanthic_plasm_connected_room_1')!==originalEast,
    'The active room is retextured after its grid changes');
  const westWhileEast=[];
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))westWhileEast.push(x+','+z);
  assert.equal(westWhileEast.length,seedWest.length,
    'An unseen puddle in an unoccupied room may NOT grow');
  for(const key of seedWest.concat(seedEast)){
    const [x,z]=key.split(',').map(Number);
    assert.ok(t.api.isPlasmAt(x+.5,z+.5),'Changing rooms may never cull a pre-existing plasm tile: '+key);
  }
  const beforeLeaving=t.api.snapshot().plasmTiles;
  t.player.x=40*64;t.player.y=40*64;t.tick(3,.25);
  assert.equal(t.api.snapshot().plasmTiles,beforeLeaving,
    'Leaving every room preserves all puddles but freezes every growth clock');
  const grownEast=[];
  for(let z=2;z<12;z++)for(let x=12;x<22;x++)if(t.api.isPlasmAt(x+.5,z+.5))grownEast.push(x+','+z);
  assert.equal(grownEast.length,eastAfterGrowth.length,
    'East-room plasm must not advance when the player leaves that room');
  const farWest=pickFarthestCorner(2,12,seedWest);
  t.player.x=farWest[0]*64;t.player.y=farWest[1]*64;
  t.tick(12,.25);
  const westAfterReturn=[];
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))westAfterReturn.push(x+','+z);
  assert.ok(westAfterReturn.length>seedWest.length,
    'Returning to an unseen west room resumes only that room’s growth');
  const eastAfterWestReturn=[];
  for(let z=2;z<12;z++)for(let x=12;x<22;x++)if(t.api.isPlasmAt(x+.5,z+.5))eastAfterWestReturn.push(x+','+z);
  assert.equal(eastAfterWestReturn.length,eastAfterGrowth.length,
    'Returning to west leaves east frozen at its exact former size');
  // Fatal immersion resets ALL rooms to the original seeded puddle clusters,
  // rather than leaving the previous unseen expansion behind.
  const [sx,sz]=seedWest[0].split(',').map(Number);
  t.player.x=(sx+.5)*64;t.player.y=(sz+.5)*64;
  t.tick(13,.25);
  assert.equal(t.player.health,0,'Plasm remains lethal after repeated room transitions');
  assert.equal(t.api.snapshot().plasmTiles,seedWest.length+seedEast.length,
    'Fatal plasm sinking must reset ALL rooms to their original 2x2–4x4 clusters');
  const initialSeed=new Set(seedWest.concat(seedEast));
  for(let z=2;z<12;z++)for(let x=2;x<22;x++)assert.equal(
    t.api.isPlasmAt(x+.5,z+.5),initialSeed.has(x+','+z),
    'Fatal plasm sinking must restore exact original tile positions: '+x+','+z);
  t.tick(3,.25);
  assert.equal(t.api.snapshot().plasmTiles,initialSeed.size,'A dead player must not restart unseen plasm growth');
  // An unrelated cause of death must trigger exactly the same reset.
  t.player.health=100;
  t.player.x=farEast[0]*64;t.player.y=farEast[1]*64;t.tick(12,.25);
  assert.ok(t.api.snapshot().plasmTiles>initialSeed.size,
    'Plasm can resume growing when a respawned player enters an unseen room');
  t.player.health=0;t.tick(1,.25);
  assert.equal(t.api.snapshot().plasmTiles,initialSeed.size,
    'Death from another source also restores original plasm across every room');
  for(let z=2;z<12;z++)for(let x=2;x<22;x++)assert.equal(
    t.api.isPlasmAt(x+.5,z+.5),initialSeed.has(x+','+z),
    'Other causes of death must restore exact original tile positions: '+x+','+z);
  t.composer.clear();
  assert.equal(t.api.isPlasmAt(sx+.5,sz+.5),false,'Exiting and clearing the dungeon finally releases all plasm');
}
{
  // Even in the dark with growth allowed, no new cell may cover the
  // player's current tile. The lantern's visual suppression is deliberately
  // disabled here to exercise the explicit occupied-cell rejection.
  const t=setup('kanthic',30,30,{lanternRadius:.02});
  let playerTile=null;
  for(let z=2;z<12&&!playerTile;z++)for(let x=2;x<12&&!playerTile;x++){
    if(t.api.isPlasmAt(x+.5,z+.5))continue;
    const adjacent=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>t.api.isPlasmAt(x+dx+.5,z+dz+.5));
    if(adjacent)playerTile={x,z};
  }
  assert.ok(playerTile,'Fixture seed provides a dry tile next to a growing puddle');
  t.player.x=(playerTile.x+.5)*64;t.player.y=(playerTile.z+.5)*64;
  const originalSize=t.api.snapshot().plasmTiles;
  t.tick(12,.25);
  assert.equal(t.api.isPlasmAt(playerTile.x+.5,playerTile.z+.5),true,
    'Plasm can now grow beneath the player');
  assert.ok(t.api.snapshot().plasmTiles>originalSize,'Other, unoccupied frontier tiles must still grow');
  t.composer.clear();
}
{
  // Cap is half of the room's walkable area. Beyond the limit the farthest
  // exposed tiles retreat so the growing perimeter never fragments.
  const t=setup('kanthic',3,3,{lanternRadius:.02}); // Cap-only stress test: visibility is deliberately absent so maximum coverage is attainable.
  const initial=new Set();
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))initial.add(x+','+z);
  assert.equal(t.api.snapshot().plasmCapacity,50,'100 walkable cells allow at most 50 plasm tiles');
  const tickFromDryTile=()=>{
    // Keep the player in the SAME room but outside the growing puddle.
    // Reposition to a dry tile each frame so the test measures growth/culling,
    // not the unrelated plasm sinking/death mechanic.
    const candidates=[];
    for(let z=2;z<12;z++)for(let x=2;x<12;x++){
      if(t.api.isPlasmAt(x+.5,z+.5))continue;
      const minDistance=Math.min(...[...Array(100)].map((_,i)=>{
        const tx=2+i%10,tz=2+Math.floor(i/10);
        return t.api.isPlasmAt(tx+.5,tz+.5)?Math.hypot(x-tx,z-tz):Infinity;
      }));
      candidates.push({x,z,minDistance});
    }
    candidates.sort((a,b)=>b.minDistance-a.minDistance);
    assert.ok(candidates.length>0,'Half-room cap always leaves walkable dry tiles');
    t.player.x=(candidates[0].x+.5)*64;t.player.y=(candidates[0].z+.5)*64;
    t.tick(1,.25);
  };
  for(let frame=0;frame<102;frame++)tickFromDryTile(); // 25.5s of local growth at 2 tiles/s reaches the 50-cell cap and exercises replacement.
  const report=t.api.snapshot();
  assert.equal(report.plasmTiles,report.plasmCapacity,'Plasm must never exceed half the room');
  assert.ok(report.plasmCulled>0,'After reaching the cap, new leading growth replaces farthest edge tiles');
  const actual=new Set();
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))actual.add(x+','+z);
  assert.equal(actual.size,50,'The cap must match the exact visible/gameplay footprint');
  assertPlasmSeams(t);
  const seed=actual.values().next().value,visited=new Set([seed]),queue=[seed];
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i].split(',').map(Number);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const key=(x+dx)+','+(z+dz);
      if(actual.has(key)&&!visited.has(key)){visited.add(key);queue.push(key);}
    }
  }
  assert.equal(visited.size,actual.size,'Farthest-tile culling must not split the plasm into unconnected islands');
  // Growth cannot increase the overall area after capacity has been reached.
  for(let frame=0;frame<4;frame++)tickFromDryTile();
  assert.equal(t.api.snapshot().plasmTiles,50,'Plasm remains capped while growth continues at its boundary');
  t.player.health=0;
  t.tick(1,.25);
  assert.equal(t.api.snapshot().plasmTiles,initial.size,'Death resets the full capped puddle to its original cluster');
  assert.equal(t.api.snapshot().plasmCulled,0,'Death resets the culling counter along with the active patch');
  for(let z=2;z<12;z++)for(let x=2;x<12;x++){
    const key=x+','+z;
    assert.equal(t.api.isPlasmAt(x+.5,z+.5),initial.has(key),'Death restores exact initial coverage: '+key);
  }
  t.composer.clear();
}
{
  const t=setup('tothal');
  // Extract and execute the actual native velocity block, rather than a
  // parallel imitation of ice logic. This catches broken integration when
  // the game replaces player.vx/vy after the hazard composer runs.
  const start=gameSource.indexOf('        const icePhysics = currentArea ===');
  const end=gameSource.indexOf('        // ── Axis-separated collision',start);
  assert.ok(start>0&&end>start,'Tothal traction must live before game.js native collision handling');
  const native=gameSource.slice(start,end);
  assert.match(native,/DevRandomRuinLichThemes\?\.movementPhysicsAt/,
    'Native game movement must consume the Tothal physics API');
  assert.doesNotMatch(themeSource,/function updateIceMotion\(/,
    'The old after-the-fact ice slide must no longer move the player');
  const move=new Function('window','player','currentArea','TILE','inputStrength','ix','iy',
    'targetSpeed','dt','ACCEL','TURN_ACCEL','DECEL','footingSpeedMul',native+
    '\nreturn {vx:player.vx,vy:player.vy};');
  const window={DevRandomRuinLichThemes:t.api,FormatUtils:{
    clamp:(value,lo,hi)=>Math.max(lo,Math.min(hi,value))
  }};
  const step=(speed,ix,iy,dt,area='map_i_dev_random_ruin',x=6.5,z=6.5)=>{
    const player={x:x*64,y:z*64,vx:speed,vy:0};
    return move(window,player,area,64,Math.hypot(ix,iy),ix,iy,
      238,dt,980,1320,1850,1);
  };
  const icyStart=step(0,1,0,.05),ordinaryStart=step(0,1,0,.05,'farm');
  assert.ok(icyStart.vx>0&&icyStart.vx<ordinaryStart.vx,
    'Ice accelerates more slowly than normal ground while holding movement');
  const icyRelease=step(238,0,0,.05),ordinaryRelease=step(238,0,0,.05,'farm');
  assert.ok(icyRelease.vx>ordinaryRelease.vx+35,
    'Letting go preserves real velocity on ice instead of using a post-frame push');
  const icyReverse=step(238,-1,0,.05),ordinaryReverse=step(238,-1,0,.05,'farm');
  assert.ok(icyReverse.vx>ordinaryReverse.vx,
    'Changing direction has less traction on ice: existing momentum persists');
  const dried=step(238,0,0,.05,'map_i_dev_random_ruin',12.5,6.5);
  assert.equal(dried.vx,ordinaryRelease.vx,
    'Crossing off the icy floor restores the normal ground deceleration immediately');
  let sixty={x:6.5*64,y:6.5*64,vx:238,vy:0};
  for(let i=0;i<60;i++)move(window,sixty,'map_i_dev_random_ruin',64,0,0,0,238,
    1/60,980,1320,1850,1);
  let thirty={x:6.5*64,y:6.5*64,vx:238,vy:0};
  for(let i=0;i<30;i++)move(window,thirty,'map_i_dev_random_ruin',64,0,0,0,238,
    1/30,980,1320,1850,1);
  assert.ok(Math.abs(sixty.vx-thirty.vx)<.1,
    'Friction decay must be frame-rate-independent at 30 and 60 fps');
  t.composer.clear();
}
console.log('Harlyao ruin lich-theme tests passed: stable theme, entire icy floor with Minecraft-style native friction, clustered icicles, Kanthic half-ring growth every 3 seconds, teardown.');

{
  const checkpoints={active:{point:{x:8.5,z:8.5}},doorways:[{axis:'x',x:6,z:7,width:2}]}; // Protect both inactive doorway landings and the current respawn.
  const t=setup('kanthic',3,3,{spawn:{x:3.5,z:3.5},checkpoints});
  const check=()=>{for(let z=2;z<12;z++)for(let x=2;x<12;x++){
    const safe=(Math.abs(x+.5-3.5)<=1.5&&Math.abs(z+.5-3.5)<=1.5)||(Math.abs(x+.5-8.5)<=1.5&&Math.abs(z+.5-8.5)<=1.5)||(Math.abs(x+.5-6)<=1.5&&Math.abs(z+.5-7)<=1.8);
    if(safe)assert.equal(t.api.isPlasmAt(x+.5,z+.5),false,'No plasm on entry/checkpoint landing '+x+','+z);
  }};
  check();t.tick(240,.25);check();t.composer.onPlayerDeath(t.kit);check();
  t.composer.clear();
}
{
  const camera={position:{x:0,y:1,z:0},getWorldDirection(out){out.set(this.dx,this.dy,this.dz);}}; // Controlled real-camera cone, independent of actor facing.
  const t=setup('kanthic',3,3,{camera});
  let target=null;
  for(let z=2;z<12&&!target;z++)for(let x=2;x<12&&!target;x++)if(t.api.isPlasmAt(x+.5,z+.5))target={x:x+.5,z:z+.5};
  camera.position={x:target.x-1,y:1,z:target.z};
  const length=Math.hypot(1,.78);camera.dx=1/length;camera.dy=-.78/length;camera.dz=0;
  t.player.x=(target.x-1)*64;t.player.y=target.z*64;
  t.tick(1,.25);
  assert.equal(t.api.isPlasmAt(target.x,target.z),false,'Camera cone actively removes lit plasm before a growth beat');
  t.composer.onPlayerDeath(t.kit);camera.dx=-camera.dx;
  t.tick(1,.25);
  assert.equal(t.api.isPlasmAt(target.x,target.z),true,'Looking away does not clear plasm behind the camera');
  t.composer.clear();
}

{
  const t=setup('kanthic',3,3); // One isolated growth beat proves both cadence and half-frontier size.
  const seed=new Set(),frontier=new Set();
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))seed.add(x+','+z);
  for(const key of seed){const [x,z]=key.split(',').map(Number);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx=x+dx,nz=z+dz,k=nx+','+nz;if(nx>=2&&nx<12&&nz>=2&&nz<12&&!seed.has(k))frontier.add(k);
  }}
  t.tick(11,.25);assert.equal(t.api.snapshot().plasmTiles,seed.size,'No growth before three seconds');
  t.tick(1,.25);assert.equal(t.api.snapshot().plasmTiles,seed.size+Math.ceil(frontier.size/2),'One beat adds exactly half of the pre-beat frontier');
  t.composer.clear();
}
