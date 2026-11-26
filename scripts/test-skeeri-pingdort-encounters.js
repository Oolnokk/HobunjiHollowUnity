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
const popularPingdortCoats={moss:'#485543','blue-moss':'#4a5d61','bog-olive':'#687149'}; // The requested muted natural coats share the species genetics pipeline.
for(const [id,hex] of Object.entries(popularPingdortCoats)){
  const entry=palettes.pingdort.find(color=>color.id===id); // Verify palette identity and a genuinely common wild/farm roll.
  assert(entry&&entry.hex===hex&&entry.weight>=8,'Missing or too-rare Pingdort coat: '+id);
}
const totalPingdortWeight=palettes.pingdort.reduce((sum,color)=>sum+color.weight,0); // Denominator for actual weighted spawn odds.
const popularPingdortWeight=palettes.pingdort.filter(color=>popularPingdortCoats[color.id]).reduce((sum,color)=>sum+color.weight,0); // Combined requested hues must be easy to encounter.
// Additional shades widen the palette, but the approved three still retain their weight-8 advantage.
assert(popularPingdortWeight/totalPingdortWeight>=.15,'Approved Pingdort coats should remain common after adding deeper pigments');
const newPingdortCoats={
  'peat-mustard':'#786947','reed-yellow':'#7b8155','silt-ochre':'#5b6546',
  'dusk-moss':'#344d43','kelp-green':'#4e6958','marsh-sage':'#66745d',
  'slatewater-blue':'#495769','rainpool-blue':'#4d606b','fen-teal':'#426061',
}; // Exact new muted-pigment genes shared by wild nests, eggs and breeding.
const shadowPingdortCoats={
  'shadow-mustard':{hex:'#4a4735',parent:'peat-mustard'},
  'deep-reed':{hex:'#414939',parent:'reed-yellow'},
  'night-moss':{hex:'#2d3d34',parent:'dusk-moss'},
  'black-kelp':{hex:'#33443b',parent:'kelp-green'},
  'blackwater-blue':{hex:'#37414c',parent:'slatewater-blue'},
  'deep-fen-teal':{hex:'#304344',parent:'fen-teal'},
}; // Deep, low-saturation variants with a named brighter counterpart for regression checks.
const marshCoatIds=new Set([
  'olive-grey','moss','sage','fern','lichen','deep-pine','blue-moss','bog-olive',
  ...Object.keys(newPingdortCoats),...Object.keys(shadowPingdortCoats),
]); // All author-approved swamp greens, muted yellows and blue-teals; excludes mammalian earth/grey coats.
const marshCoatWeight=palettes.pingdort.filter(entry=>marshCoatIds.has(entry.id)).reduce((sum,entry)=>sum+entry.weight,0); // Weighted probability of a freshly generated Pingdort having a swamp-coloured coat.
assert(marshCoatWeight/totalPingdortWeight>=.75,'Marsh coats must remain dominant over mammalian browns and greys');
assert.equal(palettes.pingdort.length,33,'Keep all 27 existing Pingdort coats and add six darker variants');
assert.equal(new Set(palettes.pingdort.map(entry=>entry.id)).size,palettes.pingdort.length,'All Pingdort gene ids must be unique');
for(const [id,hex] of Object.entries(newPingdortCoats)){
  const entry=palettes.pingdort.find(candidate=>candidate.id===id); // Verify that each new allele is rollable in the existing weighted picker.
  assert(entry&&entry.hex===hex&&entry.weight>=6,'Missing, recoloured or uncommon new Pingdort coat: '+id);
}

const previousPingdortCoats={moss:'#536747','blue-moss':'#587a80','bog-olive':'#9b9845'}; // Baseline hues from the prior PR, used to catch accidental brightness or saturation regressions.
const pigmentRgb=hex=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)); // Converts authored swatches into numeric channels for relative tone checks.
const coatTone=hex=>{ // Rejects coats that are lighter or more saturated than the requested muted reference.
  const [r,g,b]=pigmentRgb(hex); // Each channel contributes to HSV brightness and saturation.
  const brightest=Math.max(r,g,b),darkest=Math.min(r,g,b); // Brightness and chroma are measured against the same RGB swatch.
  return {brightness:brightest,saturation:(brightest-darkest)/Math.max(1,brightest)};
};
for(const [id,hex] of Object.entries(popularPingdortCoats)){
  const previousTone=coatTone(previousPingdortCoats[id]),currentTone=coatTone(hex); // Compare the actual shipped swatches, not descriptive names.
  assert(currentTone.brightness<previousTone.brightness,'Pingdort coat should be darker: '+id);
  assert(currentTone.saturation<previousTone.saturation,'Pingdort coat should be less saturated: '+id);
}
for(const [id,hex] of Object.entries(newPingdortCoats)){
  const {brightness,saturation}=coatTone(hex); // Keep each added pigment deep and earthy rather than saturated tropical.
  assert(brightness<=130&&saturation<=.42,'New Pingdort coat too bright or saturated: '+id);
}
for(const [id,variant] of Object.entries(shadowPingdortCoats)){
  const entry=palettes.pingdort.find(candidate=>candidate.id===id); // The shared weighted picker should give each darker coat a distinct inheritable allele.
  assert(entry&&entry.hex===variant.hex&&entry.weight===4,'Missing or incorrectly weighted dark Pingdort coat: '+id);
  const parent=palettes.pingdort.find(candidate=>candidate.id===variant.parent); // Verifies the existing lighter coat was preserved and remains the comparison anchor.
  assert(parent,'Dark Pingdort coat needs its unchanged parent colour: '+id);
  const previousTone=coatTone(parent.hex),currentTone=coatTone(variant.hex); // Compare actual luminance and saturation rather than trusting a shade's name.
  assert(currentTone.brightness<previousTone.brightness,'Shadow variant should be darker: '+id);
  assert(currentTone.saturation<previousTone.saturation,'Shadow variant should be less saturated: '+id);
  assert(currentTone.brightness<=80,'Dark Pingdort variant is too bright: '+id);
}
const [bogRed,bogGreen,bogBlue]=pigmentRgb(popularPingdortCoats['bog-olive']); // Verify the mustard-olive coat leans green without becoming neon.
const [oldBogRed,oldBogGreen]=pigmentRgb(previousPingdortCoats['bog-olive']); // Only Bog Olive must explicitly shift toward green.
assert(bogGreen>bogRed&&bogGreen>bogBlue&&bogGreen-bogRed>oldBogGreen-oldBogRed,'Bog Olive should be greener than before');
assert.equal(new Set(palettes.pingdort.map(color=>color.id)).size,palettes.pingdort.length,'Pingdort coat genes need unique ids');
assert.equal(new Set(palettes.pingdort.map(color=>color.hex)).size,palettes.pingdort.length,'Pingdort colors need unique hex keys');
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
// Same-colour parents must pass each new coat through the existing blend/quantization genetics.
for(const [id,hex] of [...Object.entries(newPingdortCoats),...Object.entries(shadowPingdortCoats).map(([id,entry])=>[id,entry.hex])]){
  const parent={base:{color:hex,copies:2,inheritance:'dominant'},sizeClass:'small'}; // An existing-style Pingdort genotype, supplied to the real breeding function.
  const offspring=geneticsHost.CreatureGenetics.crossOffspring(parent,parent,'pingdort',0); // No mutation: inheritance must preserve a naturally matching new coat.
  assert.equal(offspring.base.color,hex,'New Pingdort coat should breed true: '+id);
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

const testFetch=async()=>({ok:true,json:async()=>JSON.parse(read('docs/config/creatures/pingdort-flying-rig.json'))}); // Exercise the actual authored perch settings.
const renderColors={SPECIES:{},
  hexToRgb:hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)],
  recolorPixels(data,color,predicate){for(let i=0;i<data.length;i+=4)if(predicate(i))for(let n=0;n<3;n++)data[i+n]=color[n];},
}; // Real registration and pixel mask selection use the existing shared recolor interface.
const w={THREE,PerchSupport,Shattercasks,CreatureGeneticsRender:renderColors,
  DevRandomRuin:{flightClear:()=>true}, // This isolated fixture has no ruin wall voxels: explicitly declare unobstructed air rather than relying on an absent collision API.
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
      base:{footprint:[{c:45,r:45},{c:46,r:45}]}, // Projected cap overlaps original parent plateau rock.
      footprint:[{c:45,r:45},{c:46,r:45},{c:47,r:45}],
    },{
      id:'painted-rock-face',x:80.5,z:80.5,y:12.5,
      base:{footprint:[{c:79,r:80}],boundaryCells:[{c:80,r:80}]},
      footprint:[{c:80,r:80}],
    }]}:null, // The only cap tile lies on a painted rock boundary, not a parent-plateau footprint.
    shelfContains:(s,x,z)=>Math.abs(s.x-x)<2.1&&Math.abs(s.z-z)<.75,
  },
  HronalWitchBombs:{async spawn(o){const group=new Root();o.scene.add(group);
    group.position.set(o.x,o.y,o.z);return {...o,id:'bomb'+(++bombs),group};}},
  InventoryStacks:{MAX_TOTAL:99},FarmAnimals:{queueItemGenotype(){}},
  __hobunjiPlayerProfile:{worldId:'unit'},__farmLog(){}};
vm.runInNewContext(read('docs/js/flying-combat-orbit.js'),{window:w,Math});
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
  w.FlyingAnimalRig={normalize:value=>value,create:(settings,images)=>{
    assert.equal(settings.perchSpline?.afterPoints.length,7,'Wild Pingdorts curl into the authored perch on their nest shelf');
    for(const pose of Object.keys(materials))materials[pose].map={image:images[pose],dispose(){this.disposed=true;}};
    return {root:{},bodyMaterials:materials,dispose(){}};}}; // Only geometry and GPU upload are stubbed, not Pingdort's pixel recolor or map-swapping code.
  const tintedRig=await w.PingdortRegistration.createRig({base:{color:'#485543'}});
  for(const material of Object.values(materials)){
    assert.deepEqual([...material.map.image.pixels.slice(0,3)],[72,85,67],'Only approved moss-green plumage is recolored');
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
  for(const hex of ['#4a5d61','#687149',...Object.values(newPingdortCoats),...Object.values(shadowPingdortCoats).map(entry=>entry.hex)]){
    assert.equal(tintedRig.restoreTint(hex),true,'New Pingdort coat should recolor the live flight rig');
    const rgb=renderColors.hexToRgb(hex); // Native blue-moss and bog-olive textures use the shared shade fill, not flat material multiplication.
    for(const material of Object.values(materials)){
      assert.deepEqual([...material.map.image.pixels.slice(0,3)],rgb,'New coat color reaches every flight pose');
      assert.deepEqual([...material.map.image.pixels.slice(4,8)],[255,255,255,255],'The white eye stays white');
      assert.deepEqual([...material.map.image.pixels.slice(8,12)],[0,0,0,255],'Ink outlines stay black');
    }
  }
  assert.equal(w.PingdortRegistration.debugSnapshot().tintAssignments,19,'Every new and deeper coat swaps all three flight textures once');
  assert(read('docs/js/tzatzul-live-visuals.js').includes('create(appearance)'),'Native bird owner passes Pingdort genotype to rig constructor');
  assert(read('docs/js/tzatzul-live-visuals.js').includes('actor.genotype?.base?.color'),'Native owner restores after damage or genetic edits');
  assert(db.pingdort.modelWidth<db.drenkirra.modelWidth);
  assert.equal(w.SCRATCHBONES_CONFIG.game.livestock.itemKinds.fertilePingdortEgg,'pingdort');
  const plan={floorCount:5,shaft:{anchor:{x:110,z:110}},
    floors:Array.from({length:5},(_,i)=>({floor:i,y:i*16,
      rooms:[{id:'r'+i,kind:'challenge-room',x:60,z:70,w:12,d:12,y:i*16}]}))};
  let playerFloorY=0; // Move the simulated player between floors when verifying hatch activation ranges.
  const ruin=w.SkeeriRuins.mount({rec:{scene,mapData:{id:area}},plan,seed:11,
    getPlayerY:()=>playerFloorY,difficulty:5,theme:'kanthic'});
  w.SkeeriRuins.update(.01); // bombers are created lazily once the ruin is the active area
  assert.equal(ruin.theme,'kanthic', "Skeeri inherit the generated ruin’s lich tradition");
  assert(ruin.bombers.every(b=>b.actor.skeeriPalette.theme==='kanthic'
    && w.SkeeriRuins.BODY_GROUPS.kanthic.includes(b.actor.skeeriPalette.body)),
    'all three bombers inherit stable natural Kanthic body palettes');
  assert.equal(ruin.hatches.length,5);assert.equal(ruin.bombers.length,3);
  { const eyes=w.SkeeriRuins.eyeLights(); assert.ok(eyes.length>=3,'every live ruin Skeeri contributes an eye light to the darkness overlay');
    for(const l of eyes){assert.ok(Number.isFinite(l.x)&&Number.isFinite(l.y)&&Number.isFinite(l.z)&&l.radius>0&&l.strength>0&&l.active===true&&l.color.length===3&&l.color.every(Number.isFinite),'finite light record in the lich eye colour');assert.equal(l.floorY,undefined,'eye lights are visible from other stories');} }
  assert.equal(ruin.hatches.map(h=>h.floor).join(','),'0,1,2,3,4','hatch difficulty follows floor index, not world elevation');
  const hatch=ruin.hatches.find(h=>h.size==='small')||ruin.hatches[0];
  const before=ruin.actors.size;assert(w.SkeeriRuins.activateCompartment(hatch.id));
  for(let i=0;i<10;i++)w.SkeeriRuins.update(.1);
  assert.equal(ruin.actors.size-before,hatch.size==='small'?3:1);
  const circlingBird=[...ruin.actors].find(state=>state.size==='small'||state.size==='medium');
  assert(circlingBird,'a spawned diving Skeeri can use the no-perch fallback');
  const previousPlayer={x:player.x,y:player.y,floor:playerFloorY}; // Restore the real test encounter after forcing a blocked landing.
  const home=circlingBird.home,otherX=home.x+2; // Two tiles off its original room perch, facing a nearby live target.
  PerchSupport.attach(circlingBird.actor,PerchSupport.point('test:airborne',
    otherX*64,home.z*64,home.y+2));
  player.x=(home.x+1)*64;player.y=home.z*64;playerFloorY=home.y;
  const oldClear=w.DevRandomRuin.flightClear;
  w.DevRandomRuin.flightClear=(_sx,_sy,_sz,ex,_ey,ez)=>
    Math.hypot(ex-home.x,ez-home.z)>.5; // No path back to the original perch; other flight paths remain clear.
  circlingBird.phase='orbit';circlingBird.segment=null;circlingBird.orbitRetryS=0;
  const beforeOrbits=w.SkeeriRuins.debugSnapshot().orbits;
  w.SkeeriRuins.update(.1);
  assert.equal(circlingBird.phase,'orbit','a blocked landing turns into a combat circle rather than a frozen retreat');
  assert(circlingBird.segment,'real flight-support movement continues without a usable perch');
  assert(w.SkeeriRuins.debugSnapshot().orbits>beforeOrbits,'mobile diagnostics count completed fallback plans');
  assert(Math.hypot(circlingBird.segment.to.x-(home.x+1),circlingBird.segment.to.z-home.z)<=4.81,
    'fallback arc encircles the foe instead of fleeing to a distant nest');
  circlingBird.orbitLegs=3; // This completed arc must lead into a genuine body-sweep attack.
  for(let i=0;i<20&&circlingBird.phase==='orbit';i++)w.SkeeriRuins.update(.1);
  assert.equal(circlingBird.phase,'dive','a circling Skeeri still resumes its ordinary combat attacks');
  assert(circlingBird.segment,'dive from the orbit uses a native flight support');
  w.DevRandomRuin.flightClear=oldClear;
  circlingBird.phase='rest';circlingBird.segment=null;circlingBird.cooldown=99;
  PerchSupport.attach(circlingBird.actor,PerchSupport.point('test:roost',home.x*64,home.z*64,home.y));
  player.x=previousPlayer.x;player.y=previousPlayer.y;playerFloorY=previousPlayer.floor;
  const nearby=ruin.hatches.find(h=>h.trigger==='proximity'&&!h.opened); // A distinct hatch lets the original spawn-count assertion remain isolated.
  assert(nearby,'a sealed proximity hatch remains after the explicit activation');
  playerFloorY=nearby.y;
  player.x=(nearby.x+5.1)*64;player.y=nearby.z*64;
  w.SkeeriRuins.update(.01);assert.equal(nearby.opened,false,'proximity hatch stays shut outside five tiles');
  player.x=(nearby.x+4.9)*64;
  w.SkeeriRuins.update(.01);assert.equal(nearby.opened,true,'proximity hatch opens at the new five-tile range');
  const mechanism=ruin.hatches.find(h=>h.trigger==='mechanism'&&!h.opened); // A higher-floor puzzle must use its own nine-tile radius.
  assert(mechanism,'a sealed mechanism hatch remains');
  playerFloorY=mechanism.y;
  player.x=(mechanism.x+9.1)*64;player.y=mechanism.z*64;
  assert.equal(w.SkeeriRuins.signalMechanism(),0,'mechanism stays shut beyond nine tiles');
  player.x=(mechanism.x+8.9)*64;
  assert.equal(w.SkeeriRuins.signalMechanism(),1,'mechanism opens inside nine tiles');
  playerFloorY=0;
  player.x=110*64;player.y=110*64;
  for(let i=0;i<430;i++){w.SkeeriRuins.update(.1);if(i%80===0)await Promise.resolve();}
  assert(bombs>=1&&drops>=1,'large Skeeri drop ordinary Hronal witch-bombs');
  ruin.dispose();assert.equal(hostileObjects.size,0,'ruin cleanup retires Skeeri');

  area='map_southern_cloud_forest';scene=new Root();zoneScenes.set(area,{scene});
  player.x=45*64;player.y=45*64;
  const prey=deps.makeCreatureEntity('drenkirra',44*64,44*64,{genotype:{sizeClass:'small'}});
  hostileObjects.add(prey);
  const count=w.PingdortFlocks.ensureZone(area);
  assert.equal(count,1,'parent cliff bodies and painted boundary rocks cannot contain nest cups');
  const wildBirds=[...hostileObjects].filter(a=>a.creatureKey==='pingdort');
  assert.equal(wildBirds.length,3,'one nearby nest supports one three-bird hunting flock');
  assert(wildBirds.every(a=>a.genotype?.base?.color==='#aaaaaa'),'individual coats are genotype-driven');
  const homeNest=w.PingdortFlocks.nestRecords(area)[0]; // The nest's inherited bloodline is authoritative for all three birds.
  assert(wildBirds.every(bird=>JSON.stringify(bird.genotype)===JSON.stringify(homeNest.genotype)),
    'every home-point guardian has the exact fertile-egg genotype, including Size');
  const savedLineage=[...storage.entries()].find(([key])=>key.startsWith('pingdort:family:unit:map_southern_cloud_forest:'));
  assert(savedLineage&&JSON.stringify(JSON.parse(savedLineage[1]))===JSON.stringify(homeNest.genotype),
    'the family genotype survives a streamed nest rebuild and page reload');
  assert(wildBirds.every(a=>a.branchSurfaceY===homeNest.worldY),'every resting bird uses the physical nest shelf height, with no hidden flock or slot lift');
  const nest=w.PingdortFlocks.debugSnapshot().habitats[0].nests[0];
  assert.equal(nest.y,12.5,'nest visuals and egg records use the physical minicliff elevation');
  assert.equal(nest.x,47.5,'nest uses the exposed cap tile rather than solid parent-cliff rock');
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
  for (const kind of ['pingdort','skeeri']) {
    assert.equal(geneticsHost.CreatureGenetics.stableEntryRole({kind,genotype:{sizeClass:'large'}}),
      'companion',`${kind} Large variants must remain companions, never mounts`);
  } // Assert real Stable behavior instead of an obsolete source-text spelling.
  console.log('Skeeri/Pingdort encounters, inherited flight colors and Nelk light-coat genetics PASS');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
