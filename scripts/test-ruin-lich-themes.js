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
assert.match(fogSource, /ruinLanternScale = 1/, 'Kanthic lantern shares the normal feathered radius');
assert.match(fogSource, /getKanthicLanternRadiusTiles:\(\)=>tuning\.lantern\.radiusTiles,/, 'Kanthic uses the ordinary full-radius lantern');
assert.doesNotMatch(fogSource, /ctx\.clip\(/, 'No hard camera-centered lantern clipping circle may survive');
assert.match(fogSource, /KANTHIC_STANDARD_DARKNESS_ALPHA = 0\.95/, 'Kanthic darkness uses the shared underground ambient rendering pass');
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
  const t=setup('kanthic');
  const initial=t.api.snapshot().plasmTiles;
  const mesh=()=>{let out=null;t.kit.root.traverse(obj=>{if(obj.name?.startsWith('kanthic_plasm_connected_room_'))out=obj;});return out;};
  const original=mesh(),geometry=original.geometry,patches=t.mappedPatches.length;
  const seed=new Set();
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))seed.add(x+','+z);
  t.player.x=11.4*64;t.player.y=11.4*64;
  t.tick(400,.25); // A long idle/gameplay interval may NEVER grow or erase a single tile.
  assert.equal(t.api.snapshot().plasmTiles,initial,'Static hazard occupancy cannot change over time');
  assert.equal(mesh(),original,'No scene mesh replacement on gameplay ticks');
  assert.equal(original.geometry,geometry,'The GPU surface stays resident until teardown');
  assert.equal(t.mappedPatches.length,patches,'No runtime nine-slice remapping or geometry uploads');
  t.composer.onPlayerDeath(t.kit);
  assert.equal(t.api.snapshot().plasmTiles,initial,'Even death leaves stationary patches untouched');
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)assert.equal(t.api.isPlasmAt(x+.5,z+.5),seed.has(x+','+z));
  assertPlasmSeams(t);
  const start=puzzlesSource.indexOf('  function respawnAtCheckpoint('),end=puzzlesSource.indexOf('\n  function buildCheckpoints(',start);
  const recovery={checkpoints:{active:{point:{x:3,y:0,z:3}},respawnCount:0},context:t.context,kit:t.kit};
  const respawn=vm.runInNewContext('('+puzzlesSource.slice(start,end)+')',{
    inRuin:()=>true,state:recovery,deps:t.kit.deps,composers:[t.composer],MAP_ID:'map_i_dev_random_ruin',
    restorePlayerScene(){},clearPlayerAfflictions(){},setPlayerWorld(){},restoreRopeEquipment(){},
    clonePoint:p=>({...p}),CHECKPOINT_INVULN_MS:1000,performance:{now:()=>100},console,
  });
  t.player.maxHealth=100;t.player.health=0;
  assert.equal(respawn('combat'),true);
  assert.equal(t.player.health,50,'Checkpoint still restores health synchronously');
  assert.equal(mesh(),original,'Respawn never reconstructs stationary plasm');
  const [x,z]=[...seed][0].split(',').map(Number);
  t.player.x=(x+.5)*64;t.player.y=(z+.5)*64;
  t.kit.ownsPlayerMotion=()=>true;t.tick(16,.25);
  assert.equal(t.player.health,50,'Ropes and traversal protect from static plasm');
  t.kit.ownsPlayerMotion=()=>false;t.kit.deps.playerMesh.position.y=3;t.kit.sampleSupport=()=>({y:3});
  t.tick(16,.25);
  assert.equal(t.player.health,50,'A bridge above the original plasm is safe');
  t.kit.deps.playerMesh.position.y=0;t.tick(13,.25);
  assert.equal(t.player.health,0,'Sustained contact at floor level still causes sinking death');
  assert.ok(t.presentationHeights.length>0,'The same plasm immersion presentation remains active');
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
  // The lantern does not delete static tiles; remaining in this room should not mutate any geometry.
  const far=[11.5,11.5];
  t.player.x=far[0]*64;t.player.y=far[1]*64;
  t.tick(120,.25);
  assert.equal(t.api.snapshot().plasmTiles,initial,'Patch stays static for thirty seconds');
  assert.equal(initialGeometry.disposed,false,'Stable geometry stays GPU-resident until dungeon teardown');
  assert.equal(t.mappedPatches.length,1,'Connected surface is mapped exactly once per run');
  t.composer.clear();
  assert.equal(t.api.snapshot().active,false,'Leaving the entire dungeon releases all patches');
  t.composer.clear();
}
{
  // Changing rooms, waiting and dying cannot alter the initial footprints.
  const rooms=[
    {id:'west',bounds:{minX:2,maxX:12,minZ:2,maxZ:12}},
    {id:'east',bounds:{minX:12,maxX:22,minZ:2,maxZ:12}},
  ];
  const t=setup('kanthic',3,3,{rooms,maxX:22});
  const initial=new Set();
  for(let z=2;z<12;z++)for(let x=2;x<22;x++)if(t.api.isPlasmAt(x+.5,z+.5))initial.add(x+','+z);
  const before=t.api.snapshot();
  assert.ok(before.plasmTiles>=8&&before.plasmTiles<=32,'Each clear chamber seeds one finite 2x2–4x4 patch');
  assert.equal(before.plasmGrowthMs,0,'Growth timer is disabled');
  assert.equal(before.plasmStatic,true,'Mobile diagnostics mark patches as static');
  const geometry=new Map();
  t.kit.root.traverse(mesh=>{if(mesh.name?.startsWith('kanthic_plasm_connected_room_'))geometry.set(mesh.name,mesh.geometry);});
  assert.equal(geometry.size,2,'Each room retains a single connected static mesh');
  t.player.x=15*64;t.player.y=10*64;t.tick(100,.25);
  t.player.x=3*64;t.player.y=10*64;t.tick(100,.25);
  t.composer.onPlayerDeath(t.kit);
  assert.equal(t.api.snapshot().plasmTiles,initial.size,'No room changes across transitions/death');
  for(let z=2;z<12;z++)for(let x=2;x<22;x++)assert.equal(t.api.isPlasmAt(x+.5,z+.5),initial.has(x+','+z));
  t.kit.root.traverse(mesh=>{if(geometry.has(mesh.name))assert.equal(mesh.geometry,geometry.get(mesh.name),'No GPU geometry replacement on transitions');});
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
console.log('Harlyao ruin lich-theme tests passed: static Kanthic patches, cached surfaces, shared lantern darkness, Tothal friction and icicles, teardown.');

{
  const checkpoints={active:{point:{x:8.5,z:8.5}},doorways:[{axis:'x',x:6,z:7,width:2}]}; // Protect both inactive doorway landings and the current respawn.
  const t=setup('kanthic',3,3,{spawn:{x:3.5,z:3.5},checkpoints});
  const check=()=>{for(let z=2;z<12;z++)for(let x=2;x<12;x++){
    const safe=(Math.abs(x+.5-3.5)<=1.5&&Math.abs(z+.5-3.5)<=1.5)||(Math.abs(x+.5-8.5)<=1.5&&Math.abs(z+.5-8.5)<=1.5)||(Math.abs(x+.5-6)<=1.5&&Math.abs(z+.5-7)<=1.8);
    if(safe){assert.equal(t.api.isPlasmAt(x+.5,z+.5),false,'No static plasm on landing '+x+','+z);assert.equal(t.api.isProtectedPlasmAt(x+.5,z+.5),true,'Shared spell-plasm safety recognizes the same landing '+x+','+z);}
  }};
  check();t.tick(240,.25);check();t.composer.onPlayerDeath(t.kit);check();
  t.composer.clear();
}
{
  const camera={position:{x:0,y:1,z:0},getWorldDirection(out){out.set(1,0,0);}};
  const t=setup('kanthic',3,3,{camera});
  const first=t.api.snapshot().plasmTiles;
  t.tick(60,.25);
  assert.equal(t.api.snapshot().plasmTiles,first,'Looking at plasm cannot clear it');
  t.composer.clear();
}
