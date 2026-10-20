// Node-only regression for Shattercask placement, both attack paths,
// rubble drops and reload persistence; no DOM, WebGL or browser required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const code = fs.readFileSync(path.join(root,'docs/js/shattercasks.js'),'utf8');
const html = fs.readFileSync(path.join(root,'docs/index.html'),'utf8');
const ranged = fs.readFileSync(path.join(root,'docs/js/combat/ranged-weapons.js'),'utf8');
const devSpawner = fs.readFileSync(path.join(root,'docs/js/dev-spawner.js'),'utf8');
const asset = JSON.parse(fs.readFileSync(path.join(root,'docs/config/furniture-authored/shattercaskBlasting.json'),'utf8'));
assert.equal(asset.parts.length,3,'two-necked furniture retains all three authored pieces');
assert(asset.recognizedSurfaces.length>0,'all original surface definitions survive import');
assert(html.includes('src="js/shattercasks.js?v='),'shattercask runtime is loaded');
assert(ranged.includes('Shattercasks?.projectileHit'),'ranged projectile segment detects shattercasks');
assert(code.includes('assets/textures/boards.png')&&code.includes('assets/textures/carved_smooth.png'),'debris uses the real body and neck textures');

assert.equal(asset.particleEmitters.filter(e=>e.enabled&&e.type==='bubbles').length,2,
  'both editor-authored bubble emitters are preserved');
assert.equal(asset.carryable.enabled,true,'Shattercasks are authored as carryable world objects');
assert(asset.carryable.billboardAnchor?.position,'carryable billboard anchor is saved');
assert(asset.carryable.handTargets?.left && asset.carryable.handTargets?.right,
  'individual authored left and right grip coordinates are saved');
assert(code.includes('WorldPopupText?.setInteractionPrompts') &&
  code.includes("WorldActionInputClaims?.setClaims") &&
  !code.includes("document.createElement('button')"),
  'pickup uses the world prompt and native interaction claims instead of a standalone DOM button');
assert(code.includes('createEmitterVisual') && code.includes('emitterVisibilityElapsed'),
  'only visible charges drive their authored particle emitters');
assert(/src="js\/procedural-furniture\.js\?v=[A-Za-z0-9_-]+"/.test(html),
  'runtime receives the editor-parity curved barrel/cup geometry');
const renderer=fs.readFileSync(path.join(root,'docs/js/procedural-furniture.js'),'utf8');
assert(renderer.includes('createAuthoredVesselGeometry(part)') && renderer.includes("part.kind === 'barrel' || part.kind === 'cup'"),
  'authored open cups and curved barrels do not fall back to closed generic cylinders');
const reticle=fs.readFileSync(path.join(root,'docs/js/combat/ranged-hud-reticle.js'),'utf8');
assert(reticle.includes('FILTER_ORANGE') && reticle.includes('wouldHitShattercask'),
  'ranged reticle has orange Shattercask interception state');
assert(ranged.includes('function wouldHitShattercask()') &&
  ranged.includes("first={kind:'shattercask'"),'reticle shares projectile hit prediction');
const handDriver=fs.readFileSync(path.join(root,'docs/js/procedural-hand-frame-driver.js'),'utf8');
assert(handDriver.includes("target.mode === 'authored-world'") &&
  handDriver.includes('window.Shattercasks?.heldHandTarget'),
  'existing procedural hands accept authored world-object grip targets');
const author=fs.readFileSync(path.join(root,'docs/tools/furniture-avatar-author/carryable-objects.js'),'utf8');
const authorHtml=fs.readFileSync(path.join(root,'docs/tools/furniture-avatar-author/index.html'),'utf8');
assert(authorHtml.includes('carryable-objects.js?v=') && author.includes('billboardAnchor') &&
  author.includes('handTargets') && author.includes('exportData=function'),
  'furniture author exports invisible held-item plane anchor and both editable grip points');

assert(html.includes('id="devSpawnShattercaskBtn"'),'dev arena has a Shattercask spawn button');
assert(devSpawner.includes("window.Shattercasks.spawnRandomInDevArena()"),'arena button dispatches to the runtime');

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setScalar(v){return this.set(v,v,v);}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this;}
  multiplyScalar(v){this.x*=v;this.y*=v;this.z*=v;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  length(){return Math.sqrt(this.lengthSq());}
  normalize(){return this.multiplyScalar(1/(this.length()||1));}
  crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
  distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
}
function vector() {return new Vector3();}
class Node {
  constructor(){this.children=[];this.position=vector();this.scale=vector();this.rotation=vector();this.userData={};this.parent=null;}
  add(other){this.children.push(other);other.parent=this;}
  remove(other){this.children=this.children.filter(child=>child!==other);other.parent=null;}
  traverse(callback){callback(this);for(const child of this.children)child.traverse(callback);}
  getObjectByProperty(key,value){
    if(this[key]===value)return this;
    for(const child of this.children){const match=child.getObjectByProperty(key,value);if(match)return match;}
    return null;
  }
}
class Mesh extends Node {constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
class InstancedMesh extends Mesh {constructor(geometry,material){super(geometry,material);this.instanceMatrix={};}setMatrixAt(){}}
class Object3D extends Node {updateMatrix(){this.matrix={};}}
class Geometry {dispose(){}}
class Material {constructor(options){Object.assign(this,options);}dispose(){}}
// This mock casts a ray against a small authored silhouette, not the full
// bounding volume. Production uses THREE.Mesh.raycast triangles directly.
class Raycaster {
  constructor(){this.near=0;this.far=Infinity;this.ray={origin:new Vector3(),direction:new Vector3()};}
  intersectObjects(meshes,recursive,hits){
    for(const mesh of meshes){
      const parent=mesh.parent;
      if(!mesh.geometry?.authoredMock || !parent)continue;
      const ray=this.ray,dx=ray.direction.x;
      if(Math.abs(dx)<1e-9)continue;
      const distance=(parent.position.x+mesh.position.x-ray.origin.x)/dx;
      if(distance<this.near || distance>this.far)continue;
      const y=ray.origin.y+distance*ray.direction.y-parent.position.y;
      const z=ray.origin.z+distance*ray.direction.z-parent.position.z;
      // A narrow tapered neck rising to .89, and a broader rounded body.
      const inBody=y>=.04&&y<=.57&&Math.abs(z)<.26;
      const inNeck=y>.57&&y<=.88&&Math.abs(z)<.11;
      if(inBody||inNeck)hits.push({distance,object:mesh});
    }
    hits.sort((a,b)=>a.distance-b.distance);
    return hits;
  }
}
function authoredGroup() {
  const group=new Node(),mesh=new Mesh({attributes:{position:{count:3}},authoredMock:true},new Material({visible:true}));
  group.add(mesh);
  group.userData.meshById=new Map([['silhouette',mesh]]);
  return group;
}
const THREE = {Group:Node,Mesh,InstancedMesh,Object3D,Vector3,Raycaster,
  TetrahedronGeometry:Geometry,SphereGeometry:Geometry,CylinderGeometry:Geometry,DodecahedronGeometry:Geometry,
  MeshBasicMaterial:Material,MeshLambertMaterial:Material,DoubleSide:2,AdditiveBlending:3,
  TextureLoader:class{load(){return{dispose(){}};}}};
const storage = new Map();
const localStorage = {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
const area='map_i_den_shattercask_test';
async function scenario(reloading=false) {
  const tiles=Array.from({length:12},()=>Array.from({length:12},()=>({type:'grass'})));
  tiles[3][5]={type:'rock',rockKind:'diggableRockOre',caveSeparator:true};
  tiles[3][6]={type:'tree',treeKind:'pine'};
  const scene=new Node();
  const player={x:3.5*64,y:3.5*64,angle:0,health:100};
  const inventory={},damage=[];
  const deps={
    TILE:64,player,inventory,TileType:{GRASS:'grass'},
    getCurrentArea:()=>area,getActiveScene:()=>scene,worldSurfaceY:()=>0,
    hostileObjects:new Set(),getPlayerMeleeAimPitch:()=>0,
    clearVegetationInAttackCone:()=>0,
    damagePlayer:(...args)=>damage.push(args),showToast(){},
  };
  const game={
    console,THREE,localStorage,__hobunjiPlayerProfile:{worldId:'regression'},
    Combat:{deps,init(){},update(){},beginStagedAction(options){return options;},
      spawnMeleeTrail(){},meleeColliderVolume(){return null;}},
    GridTileAccessors:{getActiveScene:()=>scene,getActiveGrid:()=>tiles},
    CaveSiteSystem:{__test:{plansByMapId:new Map([[area,{shattercasks:[{id:'wall-charge',col:4,row:3}]}]])}},
    AuthoredFurniture:{load:async()=>asset,buildGroup:authoredGroup},
    DevSpawner:{init(){}},ResourceSystem:{spendFooting(){}},
    AudioSystem:{playWeaponHitSfx(){}},__farmLog(){},
  };
  game.window=game;
  vm.createContext(game);
  vm.runInContext(code,game,{filename:'shattercasks.js'});
  game.Combat.update(.18);
  // Furniture loading and the async spawn's continuation run on separate
  // microtask turns in Node's vm context; yield a full event-loop turn.
  await new Promise(resolve=>setImmediate(resolve));
  const casks=game.Shattercasks.debugSnapshot();
  if(reloading) {
    assert.equal(casks.vases.length,0,'exploded charge must not respawn after reload');
    assert.equal(casks.rubble.length,1,'unlooted tree-stick pile persists');
    assert.equal(tiles[3][5].type,'grass','mineable cave wall stays broken');
    assert.equal(tiles[3][6].type,'grass','felled tree stays cleared');
    return;
  }
  assert.equal(casks.vases.length,1,'the cave wall has an intact Shattercask');
  // A projectile passes through the full height of the editor-authored neck,
  // not the former narrow .37-radius / .42-height fake target.
  const neck=game.Shattercasks.projectileHit({x:3,y:0.80,z:3.5},
    {x:5.6,y:0.80,z:3.5},.08,1,area);
  assert(neck && neck.t>=0 && neck.t<=1,'projectile intercepts the visible authored neck');
  assert.equal(game.Shattercasks.projectileHit({x:3,y:1.2,z:3.5},
    {x:5.6,y:1.2,z:3.5},.03,1,area),null,
    'the space above the modeled neck is not an explosive hit target');
  assert.equal(game.Shattercasks.projectileHit({x:3,y:.80,z:3.87},
    {x:5.6,y:.80,z:3.87},.03,1,area),null,
    'the empty space beside the narrow neck is not a mesh hit');
  const limited=game.Shattercasks.projectileHit({x:3,y:.42,z:3.5},
    {x:5.6,y:.42,z:3.5},.08,.15,area);
  assert.equal(limited,null,'cover/terrain segment limits prevent hitting mesh behind them');

  // A shot from either team uses this same swept-segment intersection.
  const hit=game.Shattercasks.projectileHit({x:3,y:.42,z:3.5},{x:5.6,y:.42,z:3.5},.08,1,area);
  assert(hit&&hit.t>0&&hit.t<1,'swept projectile crosses the vase');
  assert(game.Shattercasks.hitProjectile(hit),'projectile triggers a single detonation');
  assert.equal(damage.length,1,'player is hurt by own nearby charge');
  assert.equal(tiles[3][5].type,'grass','blast opens the mineable wall');
  assert.equal(tiles[3][6].type,'grass','blast cuts down the tree');
  assert.equal(game.Shattercasks.debugSnapshot().rubble.length,2,'rock and tree each create one loot pile');
  const drawBudget=game.Shattercasks.debugSnapshot().performance;
  assert.equal(drawBudget.activePileDrawCalls,2,'all debris uses only two instanced draw calls');
  assert.equal(drawBudget.activeDebrisInstances,8,'two piles each contain four GPU instances');
  assert.equal(drawBudget.textureBatchesCreated,1,'texture uploads and material allocation occur only once');
  player.x=5.5*64;
  assert(game.Shattercasks.interact(),'rubble is looted with one interaction');
  assert.equal(inventory.stone,3,'stone becomes actual inventory stock');
  assert.equal(inventory.pebble,2,'stone pile also gives pebbles');
  assert.equal(game.Shattercasks.debugSnapshot().rubble.length,1,'looting does not remove the other pile');
  assert.equal(game.Shattercasks.debugSnapshot().performance.activeDebrisInstances,4,
    'looting changes only instance count, not per-tile mesh ownership');
  // A second blast must reuse the first blast's geometry/textures.
  const phantom=new Node();phantom.position.set(4.5,0,3.5);
  assert(game.Shattercasks.detonate({id:'performance-repeat',mapId:area,col:4,row:3,
    group:phantom,exploded:false,carried:false},'regression'));
  assert.equal(game.Shattercasks.debugSnapshot().performance.textureBatchesCreated,1,
    'repeated explosions reuse pooled GPU source assets');
}
async function arenaScenario() {
  let currentArea='map_dev_arena',modelBuilds=0;
  const tiles=Array.from({length:9},()=>Array.from({length:9},()=>({type:'grass',water:0})));
  tiles[2][3]={type:'rock',rockKind:'diggableRockOre'};
  tiles[3][2]={type:'water',water:1};
  tiles[4][2]={type:'wall'};
  tiles[5][2]={type:'grass',solid:true};
  const activeScene=new Node();
  const player={x:4.5*64,y:4.5*64,angle:0,health:100};
  const deps={TILE:64,player,getCurrentArea:()=>currentArea,getActiveScene:()=>activeScene,
    worldSurfaceY:()=>0,hostileObjects:new Set(),showToast(){}};
  const game={console,THREE,localStorage,__hobunjiPlayerProfile:{worldId:'arena-regression'},
    Combat:{deps,init(){},update(){},beginStagedAction(){},spawnMeleeTrail(){}},
    GridTileAccessors:{getActiveScene:()=>activeScene,getActiveGrid:()=>tiles,
      isTownBuildingCollisionTile:(c,r)=>c===6&&r===6},
    AuthoredFurniture:{load:async()=>asset,buildGroup:()=>{modelBuilds++;return authoredGroup();}},
    DevSpawner:{init(){}},__farmLog(){}};
  game.window=game;
  vm.createContext(game);
  vm.runInContext(code,game,{filename:'shattercasks.js'});
  for(let i=0;i<4;i++){
    const p=await game.Shattercasks.spawnRandomInDevArena();
    assert(p.col>0&&p.col<8&&p.row>0&&p.row<8,'spawn keeps clear of arena border');
    assert(![ 'rock','water','wall' ].includes(tiles[p.row][p.col].type),'spawn is on walkable ground');
    assert(!(p.col===2&&p.row===5),'solid tiles are excluded');
    assert(!(p.col===6&&p.row===6),'building-collision tiles are excluded');
    assert(!(p.col===4&&p.row===4),'spawn avoids standing on player');
    assert.equal(game.Shattercasks.debugSnapshot().vases.length,i+1,'one live Shattercask per click');
    assert.equal(activeScene.children.length,i+1,'real authored meshes appear in scene');
  }
  assert.equal(modelBuilds,4,'each explicit spawn creates one authored Shattercask');
  const before=game.Shattercasks.debugSnapshot().vases.length;
  currentArea='town';
  await assert.rejects(game.Shattercasks.spawnRandomInDevArena(),/Testing Arena/);
  assert.equal(game.Shattercasks.debugSnapshot().vases.length,0,'out-of-area spawn does not create a charge');
  currentArea='map_dev_arena';
  assert.equal(before,4);
  for(let r=1;r<8;r++)for(let c=1;c<8;c++)tiles[r][c]={type:'rock'};
  await assert.rejects(game.Shattercasks.spawnRandomInDevArena(),/No unoccupied walkable tile/);
  assert.equal(modelBuilds,4,'no art created for rejected requests');
}
(async()=>{
  await arenaScenario();
  await scenario(false);
  await scenario(true);
  console.log('PASS shattercasks: model silhouette raycast + 5-tile area effect + loot + reload');
})().catch(error=>{console.error(error);process.exitCode=1;});
