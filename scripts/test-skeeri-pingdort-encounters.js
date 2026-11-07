'use strict';
// Headless smoke/regression test. Run: node scripts/test-skeeri-pingdort-encounters.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'); // Production file root used by all following assertions.
const read=name=>fs.readFileSync(path.join(root,name),'utf8'); // Read the actual modules under test.
for(const species of ['skeeri','pingdort']){
  const rig=JSON.parse(read('docs/config/creatures/'+species+'-flying-rig.json')); // Authored, not fake, species wing settings.
  assert.equal(rig.version,1);
  for(const pose of ['flying','perched','wings']){
    assert.equal(rig[pose],'creaturesprites/'+species+'_'+pose+'.png');
    assert(fs.existsSync(path.join(root,'docs/assets',rig[pose])));
  }
}
class Root {
  constructor(geo=null,mat=null){
    this.geometry=geo;this.material=mat;this.children=[];this.parent=null;this.isObject3D=true;
    this.position={x:0,y:0,z:0,set:(x,y,z)=>Object.assign(this.position,{x,y,z})};
    this.rotation={y:0};this.scale={y:1};this.visible=true;this.userData={};
  }
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(c=>c!==child);child.parent=null;}
  traverse(fn){fn(this);this.children.forEach(c=>c.traverse?.(fn));}
  getWorldPosition(v){return Object.assign(v,this.position);}
}
class Mesh extends Root {constructor(g,m){super(g,m);this.isMesh=true;}}
class Geometry {dispose(){}}
class Material {dispose(){}}
const THREE={Group:Root,Mesh,BoxGeometry:Geometry,SphereGeometry:Geometry,
  IcosahedronGeometry:Geometry,MeshBasicMaterial:Material,
  Vector3:class {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}},
  Raycaster:class {intersectObjects(){return [];}}}; // No GPU is needed.
const PerchSupport={
  point:(id,x,y,worldY)=>({id,dimension:0,x,y,worldY}),
  line:(id,start,end)=>({id,dimension:1,start,end}),
  attach(a,p,t=0){a.onPerch=p;a.onBranch={id:p.id,perchSupport:true};a.branchT=t;
    const q=p.start||p;a.x=q.x;a.y=q.y;a.branchSurfaceY=q.worldY;return true;},
  constrain(a){const p=a.onPerch;if(p?.dimension!==1)return false;const t=a.branchT;
    a.x=p.start.x+(p.end.x-p.start.x)*t;a.y=p.start.y+(p.end.y-p.start.y)*t;
    a.branchSurfaceY=p.start.worldY+(p.end.worldY-p.start.worldY)*t;return true;},
  forget(a){a.onPerch=null;return true;},release(a){a.onPerch=null;a.onBranch=null;return true;},
};
const sweep=(start,end,half,box)=>{
  let entry=0,exit=1;
  for(const axis of ['x','y','z']){
    const d=end[axis]-start[axis],min=box.min[axis]-half[axis],max=box.max[axis]+half[axis];
    if(Math.abs(d)<1e-9){if(start[axis]<min||start[axis]>max)return null;continue;}
    let a=(min-start[axis])/d,b=(max-start[axis])/d;if(a>b)[a,b]=[b,a];
    entry=Math.max(entry,a);exit=Math.min(exit,b);if(entry>exit)return null;
  }
  return entry<=1&&exit>=0?entry:null;
};
let area='map_i_dev_random_ruin',scene=new Root(),serial=0,bombs=0,drops=0,rocks=0;
const hostileObjects=new Set(),companionObjects=new Set(),attacks=new Map(),factories=new Map();
const inventory={},player={x:0,y:0,health:100},storage=new Map();
const db={'gar-wolf':{modelWidth:1.9,defaultSizeClass:'medium',diet:'carnivore'},
  drenkirra:{modelWidth:.82,defaultSizeClass:'small',diet:'herbivore'}};
const zoneScenes=new Map();
const Shattercasks={
  registerBurdenFactory(kind,fn){factories.set(kind,fn);return true;},
  async createHangingBurden(o){const built=await factories.get(o.kind)(o);o.scene.add(built.group);
    built.group.position.set(o.x,o.y,o.z);rocks++;return {id:o.id,mapId:o.mapId,group:built.group,kind:o.kind};},
  releaseBurdenDownward(b){if(!b?.group?.parent)return false;drops++;b.flying=true;return true;},
  discardBurden(b){b.group?.parent?.remove?.(b.group);return true;},
};
const w={THREE,PerchSupport,Shattercasks,CreatureGeneticsRender:{SPECIES:{}},
  SCRATCHBONES_CONFIG:{game:{livestock:{itemKinds:{},animalWidths:{},diet:{},resources:{}}}},
  CreatureGenetics:{makeDefaultGenotype:()=>({base:{color:'#aaaaaa'},sizeClass:'small'}),
    creatureSizeClass:(_kind,g)=>g?.sizeClass||'small'},
  TzatzulFlightRuntime:{sweptBodyHit:sweep},RangedWeapons:{actorHitbox:()=>null},
  Combat:{deps:{TILE:64,hostileObjects,damagePlayer(){},damageCreature(){},getGroundYAtWorld(){return 0;}},
    animalAttacks:{register(key,impl){attacks.set(key,impl);}}},
  GridTileAccessors:{getActiveScene:()=>scene},TzatzulLiveVisuals:{release(){}},
  HronalWitchBombs:{async spawn(o){const group=new Root();o.scene.add(group);
    group.position.set(o.x,o.y,o.z);return {...o,id:'bomb'+(++bombs),group};}},
  InventoryStacks:{MAX_TOTAL:99},FarmAnimals:{queueItemGenotype(){}},
  __hobunjiPlayerProfile:{worldId:'unit'},__farmLog(){}};
for(const name of ['skeeri-ruins','pingdort-registration','pingdort-flocks'])
  vm.runInNewContext(read('docs/js/'+name+'.js'),{window:w,performance:{now:()=>1000},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,val)=>storage.set(key,String(val))},
    console,Promise},{filename:name+'.js'});
const deps={TILE:64,CREATURE_DB:db,hostileObjects,companionObjects,zoneScenes,inventory,
  player,ITEM_DEFS:{},inventoryItems:[],calendar:{day:1},
  getCurrentArea:()=>area,getActiveScene:()=>scene,
  makeCreatureEntity(key,x,y,opts={}){
    const def=db[key];if(!def)return null;
    return {id:'actor'+(++serial),creatureKey:key,def,x,y,areaId:area,health:def.maxHealth||70,
      maxHealth:def.maxHealth||70,avatarRef:{group:{parent:{remove(){}},visible:true},dispose(){}},...opts};
  },saveMemberWorldData(){},refreshItemScroll(){},refreshActionBar(){}};
async function check(){
  assert(w.SkeeriRuins.register(deps));assert(w.SkeeriRuins.init(deps));
  assert(w.PingdortRegistration.register(deps));assert(w.PingdortFlocks.init(deps));
  assert(db.pingdort.modelWidth<db.drenkirra.modelWidth);
  assert.equal(w.SCRATCHBONES_CONFIG.game.livestock.itemKinds.fertilePingdortEgg,'pingdort');
  const plan={floorCount:5,shaft:{anchor:{x:110,z:110}},
    floors:Array.from({length:5},(_,i)=>({floor:i,y:i*16,
      rooms:[{id:'r'+i,kind:'challenge-room',x:60,z:70,w:12,d:12,y:i*16}]}))};
  const ruin=w.SkeeriRuins.mount({rec:{scene,mapData:{id:area}},plan,seed:11,
    getPlayerY:()=>0,difficulty:5});
  assert.equal(ruin.hatches.length,5);assert.equal(ruin.bombers.length,3);
  const hatch=ruin.hatches.find(h=>h.size==='small')||ruin.hatches[0];
  const before=ruin.actors.size;assert(w.SkeeriRuins.activateCompartment(hatch.id));
  for(let i=0;i<10;i++)w.SkeeriRuins.update(.1);
  assert.equal(ruin.actors.size-before,hatch.size==='small'?3:1);
  player.x=110*64;player.y=110*64;
  for(let i=0;i<430;i++){w.SkeeriRuins.update(.1);if(i%80===0)await Promise.resolve();}
  assert(bombs>=1&&drops>=1,'large Skeeri drop ordinary Hronal witch-bombs');
  ruin.dispose();assert.equal(hostileObjects.size,0,'ruin cleanup retires Skeeri');

  area='map_southern_cloud_forest';scene=new Root();zoneScenes.set(area,{scene});
  player.x=45*64;player.y=45*64;
  const prey=deps.makeCreatureEntity('drenkirra',44*64,44*64,{genotype:{sizeClass:'small'}});
  hostileObjects.add(prey);
  const count=w.PingdortFlocks.ensureZone(area);
  assert(count>=1 && count<=3,'wild Pingdorts establish eligible flocks');
  assert.equal([...hostileObjects].filter(a=>a.creatureKey==='pingdort').length,count*3);
  const nest=w.PingdortFlocks.debugSnapshot().habitats[0].nests[0];
  player.x=nest.x*64;player.y=nest.z*64;
  inventory.fertilePingdortEgg=99;assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,false);
  inventory.fertilePingdortEgg=0;assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,true);
  assert.equal(inventory.fertilePingdortEgg,3);
  assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,false);

  area='farm';scene=new Root();zoneScenes.set(area,{scene});player.x=20*64;player.y=20*64;
  const pet=deps.makeCreatureEntity('pingdort',21*64,20*64,{isCompanion:true,stableRole:'companion',master:player});
  companionObjects.add(pet);
  const ability=attacks.get('pingdortBoulderBomb');assert(ability);
  const state={},target={x:22*64,y:20*64,health:100};
  ability.start(pet,state,{target});pet._animalAttack={id:'pingdortBoulderBomb',state,def:ability};
  let ended=false;const start=drops;
  for(let i=0;i<220;i++){ended=!ability.update(pet,state,.1,w.Combat.deps);
    await Promise.resolve();if(ended)break;}
  assert(ended,'companion finishes its hit-and-run attack');
  assert(rocks>0&&drops>start,'companion fetched and dropped a physical Boulder burden');
  assert.equal(w.PingdortFlocks.debugSnapshot().bouldersDropped,1);
  assert.match(read('docs/js/creature-genetics.js'),/entry\?\.kind==='pingdort'&&sizeClass==='large'\?'companion'/);
  console.log('Skeeri and Pingdort flight, hatches, bombs, eggs, farm registration and companion boulder PASS');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
