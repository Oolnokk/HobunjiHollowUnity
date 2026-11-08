'use strict';
// Headless smoke/regression test. Run: node scripts/test-skeeri-pingdort-encounters.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'); // Production file root used by all following assertions.
const read=name=>fs.readFileSync(path.join(root,name),'utf8'); // Read the actual modules under test.
const paletteHost={}; // Run the shipped config independently to verify the actual species color tables.
vm.runInNewContext(read('docs/config/scratchbones-config.js'),{window:paletteHost});
const palettes=paletteHost.SCRATCHBONES_CONFIG.game.creatureGenetics.palettes; // Same data consumed by native genetics and Character Studio.
const colorsFor=kind=>new Set(palettes[kind].map(entry=>entry.hex)); // Reject any offspring outside its species palette.
const pingdortGreens=palettes.pingdort.filter(entry=>/green|moss|sage|fern|lichen|pine/i.test(entry.name)); // Muted woodland greens, not the bright Drenkirra palette.
assert(pingdortGreens.length>=5&&pingdortGreens.every(entry=>entry.weight>0));
assert(palettes.pingdort.every(entry=>/^#[0-9a-f]{6}$/i.test(entry.hex)&&entry.weight>0));
const nelkLightWeight=palettes.nelk.filter(entry=>entry.weight>=5).reduce((total,entry)=>total+entry.weight,0); // Wild rolls should primarily select light/mid coats.
const nelkDarkWeight=palettes.nelk.filter(entry=>entry.weight===1).reduce((total,entry)=>total+entry.weight,0); // Rare dark variants must still exist and breed.
assert(nelkDarkWeight>0&&nelkLightWeight>=7*nelkDarkWeight,'Nelk dark coats should be much rarer than lighter coats');
assert.equal(palettes.nelk.length,palettes.default.length,'Nelk retains every preexisting coat color');
assert(palettes.default.every(entry=>colorsFor('nelk').has(entry.hex)),'No Nelk pigmentation is made unobtainable by reweighting');
const geneticsHost={SCRATCHBONES_CONFIG:paletteHost.SCRATCHBONES_CONFIG,addEventListener(){},__farmLog(){}}; // Isolated genuine genetics module, no game bootstrap or sprite machinery.
vm.runInNewContext(read('docs/js/creature-genetics.js'),{window:geneticsHost});
geneticsHost.CreatureGenetics.init({CREATURE_DB:{pingdort:{defaultSizeClass:'small'},nelk:{defaultSizeClass:'medium'}},clamp:(x,a,b)=>Math.max(a,Math.min(b,x))});
for(const kind of ['pingdort','nelk']){
  const allowed=colorsFor(kind); // Both fresh specimens and offspring must use the authored palette.
  for(let i=0;i<60;i++){
    const mother=geneticsHost.CreatureGenetics.makeDefaultGenotype(kind);
    const father=geneticsHost.CreatureGenetics.makeDefaultGenotype(kind);
    const offspring=geneticsHost.CreatureGenetics.crossOffspring(mother,father,kind,0);
    assert(allowed.has(mother.base.color)&&allowed.has(father.base.color)&&allowed.has(offspring.base.color));
    assert.equal(offspring.sizeClass,mother.sizeClass,'identical parental size classes remain inheritable');
  }
}
assert.equal(palettes.drenkirra.length,12,'Unrelated bright Drenkirra colors stay unchanged');
for(const species of ['skeeri','pingdort']){
  const rig=JSON.parse(read('docs/config/creatures/'+species+'-flying-rig.json')); // Authored, not fake, species wing settings.
  assert.equal(rig.version,1);
  for(const pose of ['flying','perched','wings']){
    assert.equal(rig[pose],'creaturesprites/'+species+'_'+pose+'.png');
    assert(fs.existsSync(path.join(root,'docs/assets',rig[pose])));
  }
}
const authorHtml=read('docs/tools/flying-animal-author/index.html'); // Standalone mobile editor must expose Pingdort.
const authorApp=read('docs/tools/flying-animal-author/app.js'); // The new preset loads a separate authoring JSON and saved draft.
assert(authorHtml.includes('<option value="pingdort">Pingdort</option>'));
assert(authorApp.includes("pingdort: 'creaturesprites/pingdort_'"));
assert(authorApp.includes("pingdort: '../../config/creatures/pingdort-flying-rig.json'"));
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
const sourcePixels=Uint8ClampedArray.from([159,191,159,255,255,255,255,255,0,0,0,255,110,139,110,255]); // Green coat, white eye, black outline and shadow from authored PNG art.
class TestImage{set src(_url){this.width=4;this.height=1;this.onload?.();}} // Tiny pose artwork for an actual keyed coat-color regression.
class TestCanvas{
  constructor(){this.width=0;this.height=0;this.pixels=null;} // Supports the exact 2D surface API used by PingdortRegistration.
  getContext(){return {drawImage:()=>{this.pixels=new Uint8ClampedArray(sourcePixels);},
    getImageData:()=>({data:this.pixels}),putImageData:frame=>{this.pixels=frame.data;}};}
}
const fakeDocument={createElement:tag=>{assert.equal(tag,'canvas');return new TestCanvas();}}; // Avoids Node DOM dependencies while testing pixels.

const testFetch=async()=>({ok:true,json:async()=>({version:1})}); // The physical wing geometry is owned by FlyingAnimalRig, not this integration test.
const renderColors={SPECIES:{},
  hexToRgb:hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)],
  recolorPixels(data,color,predicate){for(let i=0;i<data.length;i+=4)if(predicate(i))for(let n=0;n<3;n++)data[i+n]=color[n];},
}; // Real registration and pixel mask selection use the existing shared recolor interface.
const w={THREE,PerchSupport,Shattercasks,CreatureGeneticsRender:renderColors,
  HobunjiSpritePngSurface:{makeCanvasTexture(_three,canvas){return {image:canvas,dispose(){this.disposed=true;}};}},
  SCRATCHBONES_CONFIG:{game:{livestock:{itemKinds:{},animalWidths:{},diet:{},resources:{}}}},
  CreatureGenetics:{makeDefaultGenotype:()=>({base:{color:'#aaaaaa'},sizeClass:'small'}),
    creatureSizeClass:(_kind,g)=>g?.sizeClass||'small'},
  TzatzulFlightRuntime:{sweptBodyHit:sweep},RangedWeapons:{actorHitbox:()=>null},
  Combat:{deps:{TILE:64,hostileObjects,damagePlayer(){},damageCreature(){},getGroundYAtWorld(){return 0;}},
    animalAttacks:{register(key,impl){attacks.set(key,impl);}}},
  GridTileAccessors:{getActiveScene:()=>scene},TzatzulLiveVisuals:{release(){}},
  CliffRouteNetwork:{
    forArea:a=>a==='map_southern_cloud_forest'?{balconies:[{
      id:'tested-shelf',x:45.5,z:45.5,y:12.5,reward:'buriedTreasure',
      base:{footprint:[{c:45,r:45}]},
      footprint:[{c:45,r:45},{c:46,r:45},{c:47,r:45}],
    }]}:null, // Real minicliff with a center-aligned reward and room for a separate 1×1 nest.
    shelfContains:(s,x,z)=>Math.abs(s.x-x)<2.1&&Math.abs(s.z-z)<.75,
  },
  HronalWitchBombs:{async spawn(o){const group=new Root();o.scene.add(group);
    group.position.set(o.x,o.y,o.z);return {...o,id:'bomb'+(++bombs),group};}},
  InventoryStacks:{MAX_TOTAL:99},FarmAnimals:{queueItemGenotype(){}},
  __hobunjiPlayerProfile:{worldId:'unit'},__farmLog(){}};
for(const name of ['skeeri-ruins','pingdort-registration','pingdort-flocks'])
  vm.runInNewContext(read('docs/js/'+name+'.js'),{window:w,Image:TestImage,document:fakeDocument,fetch:testFetch,performance:{now:()=>1000},
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
  assert.equal(w.CreatureGeneticsRender.SPECIES.pingdort.baseRecolorKeyHex,'#9dc09c','Farm and Stable colors should target green feathers, not white eyes');
  const makeColor=()=>({value:'ffffff',getHexString(){return this.value;},set(hex){this.value=hex.slice(1).toLowerCase();}}); // Covers the existing material white-reset after damage.
  const materials=Object.fromEntries(['flying','perched','wings'].map(p=>[p,{color:makeColor(),map:null}])); // Actual pose material ownership, including the perched gripping alias.
  w.FlyingAnimalRig={normalize:value=>value,create:(_settings,images)=>{for(const pose of Object.keys(materials))materials[pose].map={image:images[pose],dispose(){this.disposed=true;}};
    return {root:{},bodyMaterials:materials,dispose(){}};}}; // Only geometry and GPU upload are stubbed, not Pingdort's pixel recolor or map-swapping code.
  const tintedRig=await w.PingdortRegistration.createRig({base:{color:'#536747'}});
  for(const material of Object.values(materials)){
    assert.deepEqual([...material.map.image.pixels.slice(0,3)],[83,103,71],'Only green plumage is recolored');
    assert.deepEqual([...material.map.image.pixels.slice(4,8)],[255,255,255,255],'The white eye remains white');
    assert.deepEqual([...material.map.image.pixels.slice(8,12)],[0,0,0,255],'The black outline remains black');
  }
  const oldFlyingMap=materials.flying.map; // A live edit disposes the obsolete map without rebuilding the actor.
  assert.equal(tintedRig.restoreTint('#859578'),true,'Changing the genotype swaps all three pose textures');
  assert.equal(oldFlyingMap.disposed,true,'Old GPU texture is disposed after a new genotype color');
  assert.deepEqual([...materials.perched.map.image.pixels.slice(0,3)],[133,149,120]);
  assert.deepEqual([...materials.perched.map.image.pixels.slice(4,8)],[255,255,255,255]);
  assert.equal(tintedRig.restoreTint('#859578'),false,'Repeated update neither recolors nor reallocates the same genotype');
  materials.wings.color.set('#ff0000');
  assert.equal(tintedRig.restoreTint('#859578'),true,'Hit-flash multiply color resets without replacing body textures');
  assert.equal(materials.wings.color.value,'ffffff');
  assert.equal(w.PingdortRegistration.debugSnapshot().tintAssignments,2);
  assert(read('docs/js/tzatzul-live-visuals.js').includes('create(appearance)'),'Native bird owner passes Pingdort genotype to rig constructor');
  assert(read('docs/js/tzatzul-live-visuals.js').includes('actor.genotype?.base?.color'),'Native owner restores after damage or genetic edits');
  assert(db.pingdort.modelWidth<db.drenkirra.modelWidth);
  assert.equal(w.SCRATCHBONES_CONFIG.game.livestock.itemKinds.fertilePingdortEgg,'pingdort');
  const plan={floorCount:5,shaft:{anchor:{x:110,z:110}},
    floors:Array.from({length:5},(_,i)=>({floor:i,y:i*16,
      rooms:[{id:'r'+i,kind:'challenge-room',x:60,z:70,w:12,d:12,y:i*16}]}))};
  const ruin=w.SkeeriRuins.mount({rec:{scene,mapData:{id:area}},plan,seed:11,
    getPlayerY:()=>0,difficulty:5,theme:'kanthic'});
  w.SkeeriRuins.update(.01); // bombers are created lazily once the ruin is the active area
  assert.equal(ruin.theme,'kanthic', "Skeeri inherit the generated ruin’s lich tradition");
  assert(ruin.bombers.every(b=>b.actor.skeeriPalette.theme==='kanthic'
    && w.SkeeriRuins.BODY_GROUPS.kanthic.includes(b.actor.skeeriPalette.body)),
    'all three bombers inherit stable natural Kanthic body palettes');
  assert.equal(ruin.hatches.length,5);assert.equal(ruin.bombers.length,3);
  assert.equal(ruin.hatches.map(h=>h.floor).join(','),'0,1,2,3,4','hatch difficulty follows floor index, not world elevation');
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
  assert.equal(count,1,'only reachable minicliff sites provide native nests');
  const wildBirds=[...hostileObjects].filter(a=>a.creatureKey==='pingdort');
  assert.equal(wildBirds.length,3,'one nearby nest supports one three-bird hunting flock');
  assert(wildBirds.every(a=>a.genotype?.base?.color==='#aaaaaa'),'individual coats are genotype-driven');
  assert(wildBirds.every(a=>a.branchSurfaceY>=12.5),'all roosting birds remain above their raised shelf, not buried in terrain');
  const nest=w.PingdortFlocks.debugSnapshot().habitats[0].nests[0];
  assert.equal(nest.y,12.5,'nest visuals and egg records use the physical minicliff elevation');
  assert(Math.hypot(nest.x-45.5,nest.z-45.5)>.88,
    'the nest occupies a clear cap tile away from the shelf reward');
  assert.equal(nest.remaining,3,'a visible clutch starts with three individually harvestable eggs');
  assert.equal(w.PingdortFlocks.nestRecords(area)[0].w,1,'nest occupies a one-tile footprint');
  player.x=nest.x*64;player.y=nest.z*64;
  inventory.fertilePingdortEgg=99;assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,false);
  inventory.fertilePingdortEgg=0;
  assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,true);
  assert.equal(inventory.fertilePingdortEgg,1,'individual nest egg pickup awards one item, not three at once');
  assert.equal(w.PingdortFlocks.nestRecords(area)[0].remaining,2);
  assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,true);
  assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,true);
  assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,false,'depleted clutch cannot be harvested twice');
  deps.calendar.day=2;
  assert.equal(w.PingdortFlocks.ensureZone(area),count);
  assert.equal(w.PingdortFlocks.nestRecords(area)[0].remaining,3,'new in-game day renews the clutch');
  assert.equal(w.PingdortFlocks.collectNest(nest.id).ok,true);
  assert.equal(inventory.fertilePingdortEgg,4);
  assert(!read('docs/js/pingdort-flocks.js').includes('pingdortNestTakeButton'),
    'the bespoke floating egg button is removed in favor of DenNestSystem');
  // A dead member must not revive when changing zones or streaming the flock.
  // Surviving flock members should return until normal daily wildlife turnover.
  const lostBird=[...hostileObjects].find(a=>a.isWildPingdort&&a.health>0);
  assert(lostBird,'a living wild bird must exist for the mortality test');
  lostBird.health=0;
  w.PingdortFlocks.update(.1);
  assert.equal(w.PingdortFlocks.debugSnapshot().habitats[0].nests[0].deadSlots.length,1);
  area='farm';w.PingdortFlocks.update(.1);
  area='map_southern_cloud_forest';scene=new Root();zoneScenes.set(area,{scene});
  assert.equal(w.PingdortFlocks.ensureZone(area),count);
  assert.equal([...hostileObjects].filter(a=>a.isWildPingdort&&a.health>0).length,2,
    'scene re-entry must not revive a killed wild bird');
  player.x=100*64;player.y=100*64;
  for(let i=0;i<22;i++)w.PingdortFlocks.update(.1);
  assert.equal([...hostileObjects].filter(a=>a.isWildPingdort&&a.health>0).length,0,
    'the distant flock should unload from the shared wildlife roster');
  player.x=nest.x*64;player.y=nest.z*64;
  assert.equal(w.PingdortFlocks.ensureZone(area),count);
  assert.equal([...hostileObjects].filter(a=>a.isWildPingdort&&a.health>0).length,2,
    'both surviving birds return after streaming');
  deps.calendar.day=3;
  w.PingdortFlocks.ensureZone(area);
  assert.equal([...hostileObjects].filter(a=>a.isWildPingdort&&a.health>0).length,3,
    'normal in-game day renewal restores the complete nest flock');


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
  console.log('Skeeri/Pingdort encounters, inherited flight colors and Nelk light-coat genetics PASS');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
