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
assert(html.includes('id="devSpawnShattercaskBtn"'),'dev arena has a Shattercask spawn button');
assert(devSpawner.includes("window.Shattercasks.spawnRandomInDevArena()"),'arena button dispatches to the runtime');

function vector() {
  return {x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;},
    setScalar(v){this.x=this.y=this.z=v;}};
}
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
class Mesh extends Node {constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class InstancedMesh extends Mesh {constructor(geometry,material){super(geometry,material);this.instanceMatrix={};}setMatrixAt(){}}
class Object3D extends Node {updateMatrix(){this.matrix={};}}
class Geometry {dispose(){}}
class Material {constructor(options){Object.assign(this,options);}dispose(){}}
const THREE = {Group:Node,Mesh,InstancedMesh,Object3D,TetrahedronGeometry:Geometry,
  SphereGeometry:Geometry,CylinderGeometry:Geometry,DodecahedronGeometry:Geometry,
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
    AuthoredFurniture:{load:async()=>asset,buildGroup:()=>new Node()},
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
    AuthoredFurniture:{load:async()=>asset,buildGroup:()=>{modelBuilds++;return new Node();}},
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
  console.log('PASS shattercasks: model + 5-tile area effect + swept hit + loot + reload');
})().catch(error=>{console.error(error);process.exitCode=1;});
