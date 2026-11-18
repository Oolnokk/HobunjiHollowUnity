'use strict';
// Real dungeon chest module: opened chests remain opened across a regenerated
// ruin session and are not a repeatable source of loot.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Node{
  constructor(){this.children=[];this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    this.rotation={x:0,y:0};this.scale={set(){}};this.userData={};}
  add(...children){for(const child of children){this.children.push(child);child.parent=this;}}
  remove(child){this.children=this.children.filter(x=>x!==child);child.parent=null;}
}
class Mesh extends Node{constructor(geo,mat){super();this.geometry=geo;this.material=mat;}}
class Sprite extends Mesh{}
class Material{constructor(data){Object.assign(this,data);}}
class Shape{constructor(){}}
const THREE={Group:Node,Mesh,Sprite,SpriteMaterial:Material,CanvasTexture:Shape,Vector3:class{},BoxGeometry:Shape};
const canvas={getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})};
const records=new Set(); // Minimal real-site persistence API, analogous to RuinSites' saved openedChests.
let grantCount=0,savePossible=true;
let lastGranted=null; // Inspects the exact earned bonus items passed into the normal inventory reward path.
const scene=new Node();scene.isScene=true;
const window={THREE,DynamicSurfaces:{addBeforeRenderClient(){}},DevSpawner:{init(){}},
  ProceduralFurniture:{makePartMaterial:()=>new Material({})},
  DevRandomRuin:{getSeed:()=>71,getState:()=>({theme:'hronal'})},
  DevRandomRuinFurniturePieces:{solid:()=>new Node(),pivotParts:()=>new Node()},
  RuinSites:{isInSite:()=>true,
    isActiveRuinChestOpened:(id,seed)=>seed===71&&records.has(id),
    markActiveRuinChestOpened:(id,seed)=>{if(!savePossible||seed!==71)return false;records.add(id);return true;}},
  LootRolling:{rollLootPool:()=>({stone:2})},
  ArtifactCollection:{ARTIFACTS:{harlyaoCopperCoin:{}},rollArtifacts:()=>({harlyaoCopperCoin:1})},
  __farmLog(){}};
const context={window,THREE,document:{createElement:()=>canvas},performance:{now:()=>1000},console};
vm.runInNewContext(fs.readFileSync('docs/js/dev-random-ruin-dungeon-chests.js','utf8'),context);
const chests=window.DevRandomRuinDungeonChests;
window.DevSpawner.init({grantLoot:gained=>{grantCount++;lastGranted=JSON.parse(JSON.stringify(gained));return ['stone'];},showToast(){}});
const opts={id:'vault-chest-1',tier:3,parent:scene,x:4,z:3,theme:'hronal'};
const first=chests.create(opts);
assert.equal(first.opened,false);
assert.equal(chests.open(first,{bonusDrops:2,bestStreak:2,bestScore:8}),true,'first lockpick grants loot');
assert.equal(lastGranted.stone,6,'two earned bonus rolls add two more stone stacks without re-awarding boss relics');
assert.equal(grantCount,1);
assert(records.has(first.id),'loot claim is recorded in the persistent ruin site');
const replacement=chests.create(opts);
assert.equal(replacement.opened,true,'regenerated chest restores as opened');
assert.equal(replacement.hinge.rotation.x,-1.95,'opened lid restores physically, not only the interaction flag');
assert.equal(chests.open(replacement),false,'the same chest cannot be looted twice');
assert.equal(grantCount,1,'no duplicate loot grants after re-entry');
assert.equal(chests.controlsFor([replacement]).length,0,'no contextual Open action on a previously looted chest');
savePossible=false;
const blocked=chests.create({...opts,id:'vault-chest-2'});
assert.equal(chests.open(blocked),false,'unwritable world save cannot mint repeatable loot');
assert.equal(grantCount,1);
// Standalone Hachutu vaults aren't RuinSites visits: their world-scoped claims
// must survive destruction and regeneration of the same generated room.
const metadata = { worlds:[{id:'world-a'},{id:'world-b'}] }; // Canonical world save used to verify independent vault claims.
let storedMetadata = JSON.stringify(metadata); // Simulates the browser's persisted metadata across room reconstructions.
let metadataWritable = true; // Simulates a storage-quota/permission failure while claiming an unopened chest.
context.localStorage = {
  getItem:key=>key==='hobunjiSaveMeta'?storedMetadata:null,
  setItem(key,value){assert.equal(key,'hobunjiSaveMeta');if(!metadataWritable)throw new Error('QuotaExceededError');storedMetadata=value;},
};
vm.runInNewContext(fs.readFileSync('docs/js/world-meta-store.js','utf8'),context);
window.__hobunjiPlayerProfile={worldId:'world-a'};
const independentOpts={...opts,id:'hachutu-heart-0',culture:'hachutu',persistenceScope:'hachutuTemple:71'}; // Same chest location rebuilt whenever this vault is revisited.
const grantsBeforeVault=grantCount; // Detects any accidental duplicate inventory credit.
const originalVault=chests.create(independentOpts);
assert.equal(originalVault.opened,false);
assert.equal(chests.open(originalVault),true);
assert.equal(window.WorldMetaStore.hasChestClaim('world-a','hachutuTemple:71','hachutu-heart-0'),true);
assert.equal(JSON.parse(storedMetadata).worlds[0].claimedDungeonChests['hachutuTemple:71'][0],'hachutu-heart-0');
const reenteredVault=chests.create(independentOpts);
assert.equal(reenteredVault.opened,true,'re-entering the same temple restores its claimed chest as opened');
assert.equal(reenteredVault.hinge.rotation.x,-1.95,'the claimed chest lid is visibly open after regeneration');
assert.equal(chests.open(reenteredVault),false,'recreated chest cannot credit the player twice');
assert.equal(chests.controlsFor([reenteredVault]).length,0,'claimed standalone chest no longer offers Open');
assert.equal(grantCount,grantsBeforeVault+1,'a zone re-entry cannot duplicate Hachutu loot');

window.__hobunjiPlayerProfile={worldId:'world-b'};
const otherWorldVault=chests.create(independentOpts);
assert.equal(otherWorldVault.opened,false,'a different world may independently claim its own temple chest');
assert.equal(chests.open(otherWorldVault),true);
assert.equal(window.WorldMetaStore.hasChestClaim('world-b','hachutuTemple:71','hachutu-heart-0'),true);
window.__hobunjiPlayerProfile={worldId:'world-a'};
const otherGeneration=chests.create({...independentOpts,persistenceScope:'hachutuTemple:72'});
assert.equal(otherGeneration.opened,false,'a newly generated temple seed is a distinct chest generation');
metadataWritable=false;
const inaccessibleSave=chests.create({...independentOpts,id:'hachutu-heart-1'});
assert.equal(chests.open(inaccessibleSave),false,'an unwritable canonical save cannot allow repeated loot');
assert.equal(inaccessibleSave.opened,false);
assert.equal(grantCount,grantsBeforeVault+2,'failed persistence grants nothing');
metadataWritable=true;

assert(fs.readFileSync('docs/js/dev-hachutu-ruin.js','utf8').includes("persistenceScope:'hachutuTemple:'+String(session.context.seed)"),'vault generator supplies the stable saved identity');
console.log('Dungeon and standalone vault chest progress persists and blocks duplicate loot: PASS');