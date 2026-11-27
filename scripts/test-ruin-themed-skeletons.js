const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let theme='hronal',calls=[],fires=[],plasm=[];
const window={GameRandom:{random:()=>.1},DevRandomRuin:{getRuntimeContext:()=>({theme})},DevRandomRuinLichThemes:{activeTheme:()=>theme,createSkeletonPlasmTile:(x,z,y)=>{plasm.push({tiles:[{x,z,y}],opts:{ttl:5}});return {};}},
DynamicSurfaces:{sampleSupport:()=>({y:4})},PersistentGroundFire:{ignite:o=>{fires.push(o);return true;}},ResourceSystem:{setImmutableAffliction(){}},
GhoulSpecialVariants:{rollEnchantedWeapon:(rnd,o)=>{assert.equal(o.singleBase,true);return {enchantments:{base:['burning'],flourishes:{}}};}},
BanditCombat:{makeEntity:async(cfg,rank,tier,x,y,o)=>{calls.push(o);return {maxFooting:10,maxHealth:100,def:{weaponShapeKey:'warhammer'},rosterRecord:o.rosterOverride,...o.extra};}}};
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-minion.js','utf8'),{window,console});
(async()=>{const m=window.MinionCombat,o={zoneId:'map_i_dev_random_ruin',roster:{appearance:{speciesId:'harlyao-skeleton'}},baseConfig:{}};
// All four portrait views must preserve original ink and its one-texel filter guard, plus transparent pixels.
const W=12,H=9,sample=new Uint8ClampedArray(W*H*4);
for(let p=0;p<W*H;p++)sample.set([100,85,50,255],p*4);
const ix=(x,y)=>(y*W+x)*4;
sample.set([0,0,0,255],ix(2,2));sample.set([0,0,0,80],ix(2,3));sample.set([12,20,24,255],ix(3,2));sample.set([200,150,100,0],ix(11,8));
const canvases=Array.from({length:4},()=>{const data=new Uint8ClampedArray(sample);return {width:W,height:H,data,getContext:()=>({getImageData:()=>({data}),putImageData(){}})};});
for(const tradition of ['tothal','hronal']){
  for(const canvas of canvases)canvas.data.set(sample);
  await m.paintRuinPortraits({ruinSkeletonTheme:tradition,ruinSkeletonSeed:7},canvases);
  for(const canvas of canvases){
    for(const [x,y] of [[2,2],[2,3],[3,2],[4,2],[1,1],[11,8]])assert.deepEqual(Array.from(canvas.data.slice(ix(x,y),ix(x,y)+4)),Array.from(sample.slice(ix(x,y),ix(x,y)+4)));
    assert.ok(tradition==='tothal'?canvas.data[ix(8,5)]>100:canvas.data[ix(8,5)]<100);
    assert.equal(canvas.data[ix(8,5)+3],255);
  }
}
// Oversized skull + narrow torso, with an offset silhouette: only the body pixels may seed spikes.
const w=100,h=100,body=new Uint8ClampedArray(w*h*4);
for(let y=3;y<60;y++)for(let x=12;x<88;x++)body[(y*w+x)*4+3]=255;
for(let y=60;y<92;y++)for(let x=42;x<63;x++)body[(y*w+x)*4+3]=255;
const footprint=m.ruinTorsoFootprint({width:w,height:h,getContext:()=>({getImageData:()=>({data:body})})},{x:.48,y:.60},1,1);
assert.ok(footprint&&footprint.top<-.10&&footprint.bottom>-.42&&footprint.height>.24);assert.ok(footprint.width<.22);assert.ok(footprint.x<0);
// Exercise both actual attachment branches, with stand-in scene nodes so this also runs without WebGL.
class Node {
  constructor(){this.children=[];this.userData={};this.rotation={x:0};this.position={x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}};this.layers={disable(){}};}
  add(child){this.children.push(child);child.parent=this;} remove(child){this.children=this.children.filter(c=>c!==child);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);}
}
class Disposable{dispose(){this.disposed=true;}}
class Mesh extends Node{constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
const THREE={Group:Node,Mesh,BoxGeometry:Disposable,MeshBasicMaterial:Disposable};
let lastSettings,stoneSurfaces=0;
window.IceStalagmiteCoverage={build(T,source,settings){lastSettings=settings;const layer=new Node();layer.add(new Mesh(new Disposable(),new Disposable()));return layer;}};
window.FacetedRocks={surfaceStone(mesh){stoneSurfaces++;mesh.geometry=new Disposable();mesh.material=new Disposable();}};
for(const tradition of ['hronal','tothal']){
  const group=new Node(),back=new Node(),portrait=new Node(),hammer=new Node(),nodes=Array.from({length:7},(_,i)=>{const n=new Node();n.name='torso-node-'+i;n.userData.hobunjiSplineRest={x:0,y:i===0?-.42:.05,z:0};return n;});
  group.add(back);back.add(portrait);portrait.add(nodes[0]);for(let i=1;i<nodes.length;i++)nodes[i-1].add(nodes[i]);group.add(hammer);
  const avatar={backPlane:back,backPortraitMesh:portrait,modelWidth:1,modelHeight:1,backCanvas:{width:w,height:h,getContext:()=>({getImageData:()=>({data:body})})},ruinNeckNormalized:{x:.48,y:.60},ruinBackSplineNodes:nodes};
  const dispose=m.attachRuinBackSpikes(THREE,avatar,{ruinSkeletonTheme:tradition,ruinSkeletonSeed:7});
  const carrier=nodes.find(n=>n.children.some(child=>child.name==='ruin-skeleton-back-stalagmites'));
  assert.ok(carrier&&nodes.indexOf(carrier)<5);assert.equal(hammer.children.length,0);
  const layer=carrier.children.find(child=>child.name==='ruin-skeleton-back-stalagmites');
  assert.equal(layer.rotation.x,Math.PI/2);assert.equal(lastSettings.kind,tradition==='hronal'?'stoneStalagmites':'iceStalagmites');assert.equal(lastSettings.iceHeightMax,.32);assert.equal(lastSettings.iceHeightMin,.12);assert.equal(lastSettings.radius,.055);assert.equal(typeof lastSettings.mapSpikeOrigin,'function');
  assert.equal(avatar.ruinBackSpikeInfo.carrier,carrier.name);assert.equal(avatar.ruinBackSpikeInfo.theme,tradition);dispose();dispose();assert.equal(layer.parent,null);assert.equal(avatar.ruinBackSpikeInfo,null);
}
assert.equal(stoneSurfaces,1,'Hronal must exercise the stone-specific material path');
vm.runInNewContext(fs.readFileSync('docs/js/tool-metal-recolor.js','utf8'),{window,console});
const eligible=new Uint8Array(100*100).fill(1);
const oilPixels=new Uint8ClampedArray(100*100*4),oilOverlay=new Uint8ClampedArray(oilPixels.length);for(let p=0;p<100*100;p++){oilPixels.set([120,110,90,255],p*4);oilOverlay.set([17,35,70,255],p*4);}
oilPixels.set([0,0,0,255],0);m.paintRuinPixels({ruinSkeletonTheme:'kanthic',ruinSkeletonSeed:8},oilPixels,100,100,oilOverlay);let oilInk=0,oilFill=0;for(let p=1;p<100*100;p++){const i=p*4;if(oilPixels[i]===0&&oilPixels[i+1]===0&&oilPixels[i+2]===0)oilInk++;if(oilPixels[i]===17&&oilPixels[i+1]===35&&oilPixels[i+2]===70)oilFill++;}assert.ok(oilInk>0&&oilFill>0);assert.deepEqual(Array.from(oilPixels.slice(0,4)),[0,0,0,255]);
for(let seed=1;seed<=12;seed++){
  const mask=window.ToolMetalRecolor.buildOxidationMask(eligible,100,100,.28,{seed,blotchCount:9,separateBlotches:true});
  const visited=new Uint8Array(mask.length);let groups=0,area=0;
  for(let p=0;p<mask.length;p++)if(mask[p]){area++;if(visited[p])continue;groups++;const stack=[p];visited[p]=1;while(stack.length){const i=stack.pop();for(const n of [i%100>0?i-1:-1,i%100<99?i+1:-1,i-100,i+100])if(n>=0&&n<mask.length&&mask[n]&&!visited[n]){visited[n]=1;stack.push(n);}}}
  assert.ok(groups>=5,'Oil patches must stay visibly separate, seed '+seed+' groups '+groups);assert.ok(area>0&&area<=2800);
}
await m.makeEntity(o);assert.equal(calls.at(-1).extra.ruinSkeletonHealthMultiplier,1.5);
const e=await m.makeEntity({...o,extra:{wallCoffin:0}});assert.equal(e.ruinSkeletonHealthMultiplier,3);assert.equal(e.rosterRecord.enchantedWeapon.relicShape,'warhammer');
await m.makeEntity({...o,zoneId:'map_mine'});assert.equal(calls.at(-1).extra.ruinSkeletonTheme,undefined);
// Explicit preview theme is accepted only in the isolated Workshop arena, not in other game zones.
await m.makeEntity({...o,zoneId:'map_mine',previewRuinTheme:'tothal',previewRuinWallCoffin:true});assert.equal(calls.at(-1).extra.ruinSkeletonTheme,undefined);
const preview=await m.makeEntity({...o,zoneId:'map_dev_arena',previewRuinTheme:'tothal',previewRuinWallCoffin:true});
assert.equal(preview.ruinSkeletonTheme,'tothal');assert.equal(preview.ruinSkeletonHealthMultiplier,3);
const replay=await m.makeEntity({...o,zoneId:'map_dev_arena',previewRuinTheme:'tothal',previewRuinWallCoffin:true,preserveRoster:true,roster:preview.rosterRecord});
assert.equal(replay.rosterRecord.enchantedWeapon,preview.rosterRecord.enchantedWeapon);assert.equal(replay.rosterRecord.ruinSkeletonSeed,preview.rosterRecord.ruinSkeletonSeed);
const c={health:10,ruinSkeletonTheme:'hronal',physicalFeetY:4};m.trailMovement(c,0,0,128,0,'move',64);assert.equal(fires.length,0);
m.trailMovement(c,0,0,128,0,'lunge',64);assert.equal(fires.length,3);assert.ok(fires.every(f=>f.y===4));
theme='kanthic';const k={health:10,ruinSkeletonTheme:theme,physicalFeetY:4};m.trailMovement(k,0,0,128,0,'dodge',64);
assert.ok(plasm.length>=2);const count=plasm.length;
window.DynamicSurfaces.sampleSupport=()=>({y:null});m.trailMovement(k,128,0,256,0,'move',64);assert.equal(plasm.length,count);
window.DynamicSurfaces.sampleSupport=()=>({y:4});k.prone=true;m.trailMovement(k,256,0,384,0,'move',64);assert.equal(plasm.length,count);assert.ok(plasm.every(p=>p.tiles.length===1&&p.opts.ttl===5));
// Exercise the actual shared hit publisher, enchantment listener and bound-loot helper, not just mocks.
const gear={weaponEnchantments:{sameWeapon:{base:['mirrored','soulweight'],flourishes:{tap1:'fury'}},control:{base:['burning'],flourishes:{}}}};
let grants=0;const nativeWindow={Combat:{deps:{getGearInventory:()=>gear,player:{}},loadout:{SLOT_IDS:['tap1','tap2','hold1','hold2']}},
  ResourceSystem:{addAffliction(a,id,n){a[id]=(a[id]||0)+n;return n;},addEnhancedResource(a,id,n){a[id]=(a[id]||0)+n;return n;}},
  GameRandom:{random:()=>.9},__farmLog(){},HarlyaoRelics:{SHAPES:{warhammer:{label:'Harlyao Warhammer'}},makeRelic:shape=>({shape}),grantBoundRelic:relic=>{grants++;assert.equal(relic.shape,'warhammer');assert.equal(relic.enchantments.base.length,1);assert.equal(relic.enchantments.base[0],'burning');return 'bound';}}};
const nativeCtx={window:nativeWindow,console,performance:{now:()=>3000}};
for(const path of ['combat-attack-events','combat-enchantments','ghoul-special-variants'])vm.runInNewContext(fs.readFileSync('docs/js/combat/'+path+'.js','utf8'),nativeCtx);
const weapon=nativeWindow.GhoulSpecialVariants.rollEnchantedWeapon(()=>.1,{singleBase:true,baseIds:['burning']});
assert.equal(weapon.enchantments.base.length,1);assert.equal(Object.keys(weapon.enchantments.flourishes).length,0);weapon.relicShape='warhammer';
const guard={health:100,ruinWallCoffin:true,rosterRecord:{enchantedWeapon:weapon}},victim={health:30},control={health:30};
const hit=(attacker,target,key)=>nativeWindow.CombatAttackEvents.hit(null,{attacker,target,weaponKey:key,slotId:'tap1',attackCategory:'combo',comboFinisher:true,actualDamage:12});
hit(guard,victim,'sameWeapon');hit({health:100},control,'control');
assert.ok(victim.burningHealth>0);assert.equal(victim.burningHealth,control.burningHealth);
assert.equal(victim.soulweightedHealth,undefined);assert.equal(guard.mirroredHealth,undefined);assert.equal(guard.furiousStamina,undefined);
assert.equal(gear.weaponEnchantments.sameWeapon.base.length,2);
assert.equal(nativeWindow.GhoulSpecialVariants.lootEnchantedWeapon(guard).key,'bound');assert.equal(nativeWindow.GhoulSpecialVariants.lootEnchantedWeapon(guard).key,'bound');assert.equal(grants,1);
console.log('ruin themed skeleton regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1;});