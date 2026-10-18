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
const bootstrapSource = fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js', 'utf8'); // Ensures module is loaded after the composer runtime.
assert.match(ruinSource, /const theme = .*requestedSeed/, 'Ruin theme must remain stable across generation retries');
assert.match(ruinSource, /puzzleOptions\.lavaBasin = theme === 'hronal'/, 'Only Hronal generates lava basins');
assert.match(ruinSource, /floorSet:ruin\.floorSet,ceilingY:ruin\.ceilingY/, 'Composer must receive the authoritative walkable set and ceiling');
assert.match(puzzlesSource, /state\?\.context\?\.theme !== 'hronal'\) return null/, 'Rope lava is Hronal-only');
assert.match(fogSource, /tradition === 'kanthic' \? 1/, 'Kanthic rooms retain pure blackness');
assert.match(fogSource, /ruinTradition === 'tothal'\) return/, 'Tothal lantern illumination is disabled');
assert.match(fogSource, /ruinTradition === 'kanthic' \? \.25 : 1/, 'Kanthic lantern radius is halved again to one-quarter normal size');
assert.match(fogSource, /getKanthicLanternRadiusTiles:\(\)=>tuning\.lantern\.radiusTiles\*\.25/, 'Plasm visibility uses the same tunable radius as actual lantern lighting');
assert.match(fogSource, /drawRuinTraditionLightMasks/, 'Ruin sources must be drawn through the central 2D overlay');
assert.match(bootstrapSource, /dev-random-ruin-lich-themes\.js/, 'Loader must include the theme composer');

class Vector {
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(value) { return this.set(value, value, value); }
  applyAxisAngle() { return this; }
}
class Node {
  constructor() { this.children = []; this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(); this.matrix = {}; this.visible = true; this.disposed=false; }
  add(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove(node) { this.children = this.children.filter(child => child !== node); node.parent = null; }
  traverse(visitor) { visitor(this); for (const child of this.children) child.traverse(visitor); }
  updateMatrix() {}
  dispose() {this.disposed=true;}
}
class Geometry { constructor() {this.attributes={};this.indices=[];this.disposed=false;} rotateX(){return this;}rotateZ(){return this;}setAttribute(key,value){this.attributes[key]=value;return this;}setIndex(indices){this.indices=indices;return this;}dispose(){this.disposed=true;} }
class Material { constructor(options) { Object.assign(this, options); } dispose() {} }
class Mesh extends Node { constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; } }
class Instances extends Mesh { constructor(geometry, material, count) { super(geometry, material); this.count = count; this.instanceMatrix = {}; this.isInstancedMesh=true; } setMatrixAt() {} }
const THREE = {
  Group:Node, Object3D:Node, Vector3:Vector, Mesh, InstancedMesh:Instances,
  PlaneGeometry:Geometry, ConeGeometry:Geometry, TetrahedronGeometry:Geometry, BoxGeometry:Geometry,
  BufferGeometry:Geometry,Float32BufferAttribute:class {constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}},
  MeshBasicMaterial:Material, DoubleSide:2, RepeatWrapping:1,
  TextureLoader:class { load(_url, done) { const texture = {dispose(){}}; done?.(texture); return texture; } },
}; // Lightweight renderer stand-ins preserve creation, instance batching and cleanup code paths.

function setup(theme, playerX = 3.1, playerZ = 3.1, options = {}) {
  let composer = null; // Registered composer is the subject of each isolated runtime test.
  let impactCount = 0; // Tracks shared collision impact calls when an ice slide is obstructed.
  let afflictionCount = 0; // Confirms area hazards affect the same ResourceSystem as normal combat.
  let footprint = null; // Captures a Hronal column's live collision enabled gate.
  const audioEvents=[]; // Verifies release plays the existing rock sample at double speed/pitch.
  const player = {x:playerX * 64, y:playerZ * 64, health:100, facing:3};
  const window = {
    THREE, DevRandomRuinSimplePuzzles:{registerComposer(next) { composer = next; }},
    DevRandomRuinTileOccupancy:{
      solidAt:() => false, refresh() {}, clearSolids() {},
      addSolidBox(_id, box, enabled) { footprint = {box,enabled}; },
    },
    KnockbackCollisionImpact:{resolveStrength() { impactCount++; }},
    ResourceSystem:{addAffliction() { afflictionCount++; }, spendFooting() { afflictionCount++; }},
    DevRandomRuin:{syncPlayerPresentationHeight() {}},
    AudioSystem:{gameAudioConfig:() => ({sfxVolume:1})},
  }; // Gameplay APIs stubbed at the contract boundaries, not duplicated in the tests.
  const document = {getElementById:() => null}; // The mobile diagnostics path intentionally handles a missing badge.
  const Audio = class {constructor(url){this.url=url;this.playbackRate=1;}play(){audioEvents.push({url:this.url,rate:this.playbackRate});return Promise.resolve();}};
  vm.runInNewContext(themeSource, {window, document, Audio, console}, {filename:'dev-random-ruin-lich-themes.js'});
  const floorSet = new Set();
  for(let x=2;x<(options.maxX||12);x++)for(let z=2;z<12;z++)floorSet.add(x+','+z);
  const context = {
    theme, seed:123, root:new Node(), ceilingY:3, floorSet,
    meta:{floorSurfaceY:0,wallHeight:3,rooms:options.rooms||[{id:'test',col:0,row:0,w:10,h:10}]},
  };
  const kit = {
    deps:{TILE:64,player,hostileObjects:new Set(),playerMesh:{userData:{portraitModelHeight:1.8}},handlePlayerDeath() {}},
    root:new Node(),state:{context},group(){return this.root;},sampleSupport(){return {y:0};},
    roomBounds(_meta,room){return room.bounds||{minX:2,maxX:12,minZ:2,maxZ:12};},makeBasic(){return new Material({color:0x777777});},
  }; // 10×10 walkable room makes 70% ice coverage an exact 70-cell assertion.
  composer.buildRooms(kit, context);
  const api = window.DevRandomRuinLichThemes;
  const tick = (frames, seconds = .25) => {for (let index = 0; index < frames; index++) composer.update(kit, index * seconds * 1000, seconds);};
  return {api,kit,context,composer,player,tick,get impactCount(){return impactCount;},get afflictionCount(){return afflictionCount;},get footprint(){return footprint;}, audioEvents};
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
  assert.equal(before.iceTiles, 70, '70% of the room is ice');
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
  t.kit.root.traverse(mesh=>{if(mesh.name?.startsWith('kanthic_plasm_snow_shelf_edge_'))caps.push(mesh);});
  assert.ok(caps.length,'Plasm must use tapered-edge surface variants');
  const firstInstanced=caps.slice(); // Each subsequent growth rebuild must retire these per-instance GPU buffers.
  assert.equal(t.api.snapshot().lightSources, 0, 'Kanthic relies on lantern alone');
  // Turn toward the seed from outside the narrowed radius; the player can
  // still see the direction, but not the actual puddle at lantern range.
  const corners=[[2.1,2.1],[11.8,2.1],[2.1,11.8],[11.8,11.8]];
  const far=corners.sort((a,b)=>Math.min(...seed.map(p=>Math.hypot(b[0]-p.x-.5,b[1]-p.z-.5)))-
                               Math.min(...seed.map(p=>Math.hypot(a[0]-p.x-.5,a[1]-p.z-.5))))[0];
  t.player.x=far[0]*64;t.player.y=far[1]*64;
  t.player.facing=Math.atan2(seed[0].z+.5-far[1],seed[0].x+.5-far[0]);
  t.tick(4,.25);
  const grown=t.api.snapshot().plasmTiles;
  assert.ok(grown>=initial+8,'An entirely unseen puddle must add approximately 12 cells per second');
  assert.ok(firstInstanced.every(mesh=>mesh.disposed),'Rebuilding a fast-growing puddle must free its previous instanced GPU buffers');
  // Step out of the chamber; no room transition is allowed to cull the patch.
  t.player.x=30*64;t.player.y=30*64;
  t.tick(2,.25);
  assert.equal(t.api.snapshot().plasmTiles,grown,'Room exit retains every plasm tile until the entire ruin is left');
  // Re-enter with an illuminated edge within .6 tiles: even unseen outer
  // edges must stop growing if ANY puddle tile is currently visible.
  const boundary=[];
  for(let z=2;z<12;z++)for(let x=2;x<12;x++)if(t.api.isPlasmAt(x+.5,z+.5))boundary.push({x,z});
  let observer=null;
  for(const p of boundary){
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const px=p.x+dx,pz=p.z+dz;
      if(px<2||px>=12||pz<2||pz>=12||t.api.isPlasmAt(px+.5,pz+.5))continue;
      // Stand 0.525 tiles away from the observed edge but in the dry neighbour.
      observer={x:dx>0?p.x+1.025:dx<0?p.x-.025:p.x+.5,
        z:dz>0?p.z+1.025:dz<0?p.z-.025:p.z+.5, target:{x:p.x+.5,z:p.z+.5}};
      break;
    }
    if(observer)break;
  }
  assert.ok(observer,'A clear 10x10 room must have at least one dry neighbour of the puddle');
  t.player.x=observer.x*64;t.player.y=observer.z*64;
  t.player.facing=Math.atan2(observer.target.z-observer.z,observer.target.x-observer.x);
  const seenCount=t.api.snapshot().plasmTiles;
  t.tick(4,.25);
  assert.equal(t.api.snapshot().plasmTiles,seenCount,'Seeing one plasm tile inside lantern radius freezes all growth');
  t.composer.clear();
  assert.equal(t.api.snapshot().active,false,'Only leaving/clearing the entire ruin removes the puddle');
  // Teardown is idempotent; repeated clear is safe.
  t.composer.clear();
}
{
  // Two rooms are independently seeded. Crossing their boundary can make
  // new plasm grow, but must never reset either room's previous footprint.
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
  t.player.x=16.3*64;t.player.y=7.3*64;
  t.tick(4,.25);
  for(const key of seedWest.concat(seedEast)){
    const [x,z]=key.split(',').map(Number);
    assert.ok(t.api.isPlasmAt(x+.5,z+.5),'Changing rooms may never cull a pre-existing plasm tile: '+key);
  }
  const beforeLeaving=t.api.snapshot().plasmTiles;
  t.player.x=40*64;t.player.y=40*64;t.tick(3,.25);
  assert.equal(t.api.snapshot().plasmTiles,beforeLeaving,'Leaving all generated rooms while still in the dungeon preserves every patch');
  // Fatal immersion must not erase the patch either; only full runtime clear
  // on dungeon exit is permitted to destroy it.
  const [sx,sz]=seedWest[0].split(',').map(Number);
  t.player.x=(sx+.5)*64;t.player.y=(sz+.5)*64;
  t.tick(13,.25);
  assert.equal(t.player.health,0,'Plasm remains lethal after repeated room transitions');
  for(const key of seedWest.concat(seedEast)){
    const [x,z]=key.split(',').map(Number);
    assert.ok(t.api.isPlasmAt(x+.5,z+.5),'Player death may not cull persistent plasm: '+key);
  }
  t.composer.clear();
  assert.equal(t.api.isPlasmAt(sx+.5,sz+.5),false,'Exiting and clearing the dungeon finally releases all plasm');
}
{
  const t=setup('tothal');
  let chosen=null,dryBoundary=null;
  for(let x=3;x<11;x++)for(let z=3;z<11;z++){
    if(!t.api.isIceAt(x+.5,z+.5))continue;
    chosen||={x,z};
    if(!t.api.isIceAt(x+1.5,z+.5))dryBoundary={x,z};
  }
  assert.ok(chosen&&dryBoundary,'Seeded Tothal ice provides icy tiles and at least one dry boundary');
  const player=t.player, startX=chosen.x+.25,startZ=chosen.z+.4;
  player.x=startX*64;player.y=startZ*64;
  t.tick(1,.1); // Initialize native position tracking at the start of a held input.
  for(let step=0;step<8;step++){player.x+=.025*64;t.tick(1,.1);}
  const releasedAt=player.x/64;
  t.tick(1,.1); // The first released frame must immediately continue the held direction.
  assert.ok(Math.abs(player.x/64-releasedAt-.025)<.004,'Ice input must continue immediately without a release-frame pause');
  t.tick(1,.1);
  assert.ok(Math.abs(player.x/64-releasedAt-.05)<.004,
    'Eight 0.1s of moving at .25 tiles/s must replay for .2s = 25% of held duration');
  const glideEnded=player.x;
  t.tick(3,.1);
  assert.ok(Math.abs(player.x-glideEnded)<.05,'After the timed glide expires, no residual movement remains');
  // Repeat at an exposed tile edge: the next non-ice tile must cancel the glide,
  // not turn into a hidden carry on normal terrain.
  player.x=(dryBoundary.x+.78)*64;player.y=(dryBoundary.z+.5)*64;t.tick(1,.1);
  for(let step=0;step<8;step++){player.x+=.025*64;t.tick(1,.1);}
  t.tick(1,.1);
  assert.ok(player.x/64>=dryBoundary.x+1 && player.x/64<dryBoundary.x+1.06,
    'Momentum must enter the first un-iced tile, not collide with an invisible edge');
  const stoppedOnDry=player.x;
  t.tick(3,.1);
  assert.ok(Math.abs(player.x-stoppedOnDry)<.05,'The first dry tile cancels every remaining glide frame');
  t.composer.clear();
}
console.log('Harlyao ruin lich-theme tests passed: stable theme, 70% curved ice, distributed tapered icicle clusters, Kanthic curved plasm expansion, teardown.');
