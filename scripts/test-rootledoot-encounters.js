'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = (path, w, doc, Image) => new Function('window','document','Image','performance',fs.readFileSync('docs/js/'+path,'utf8'))(w,doc,Image,{now:()=>1000});
async function main() {
  let day=1, hour=6;
  const providers=new Map();
  const w={CalendarSystem:{isInitialized:()=>true,timeDebugSnapshot:()=>({rawDay:day,time01:0}),getHour:()=>hour},EffectBuffBar:{refresh(){},registerProvider:(id,p)=>providers.set(id,p)}};
  const doc={getElementById:()=>({})};
  load('cooking-data.js',w,doc);load('cooking-system.js',w,doc);load('item-processing.js',w,doc);
  const bag={},defs={heftroot:{label:'Heftroot',cat:'crop',icon:'root',sellPrice:34},plantFodder:{icon:'feed',label:'Plant Fodder',sellPrice:2,tags:['Fodder'],desc:'Feed'}};
  const deps={ITEM_DEFS:defs,inventory:bag,inventoryItems:[],cropData:{heftroot:{}},clampInventoryStack(){},refreshItemScroll(){},buildInventoryGrid(){},refreshActionBar(){},saveMemberWorldData(){}};
  const cooking=w.CookingSystem; cooking.init(deps);w.ItemProcessing.init(deps);
  assert.equal(defs.feyHeftroot.cookingPrimaryEffect,'feySight');
  assert.deepEqual(defs.feyHeftroot.cookingCategories,defs.heftroot.cookingCategories);
  for(const method of ['mashing','grinding','barrelAging','composting','grindingFeed']){
    const ordinary=w.ItemProcessing.getProcessingOutputs(method,'heftroot')?.[0];
    const fey=w.ItemProcessing.getProcessingOutputs(method,'feyHeftroot')?.[0];
    assert.ok(ordinary&&fey,method+' preserves ordinary processing eligibility');
    if(fey.cat!=='material'){
      assert.equal(fey.cookingPrimaryEffect,'feySight');
      assert.ok(cooking.ingredientEffectTotals(fey,3).feySight>cooking.ingredientEffectTotals(defs.feyHeftroot,3).feySight);
      w.ItemProcessing.ensureProcessedItemDef(fey);
      assert.equal(defs[fey.key].cookingPrimaryEffect,'feySight');
    }
  }
  cooking.grantFeySight(2);cooking.grantFeySight(1);
  assert.equal(cooking.getFoodEffectStacks('feySight'),3);
  assert.equal(cooking.feyEncounterChance(.125),.5);
  cooking.registerFeyEncounterMultiplier('double',()=>2);assert.equal(cooking.feyEncounterChance(.125),1);
  cooking.registerFeyEncounterMultiplier('double',null);
  const saved=JSON.parse(JSON.stringify(cooking.serialize()));cooking.consumeFeySight();cooking.restore(saved);
  assert.equal(cooking.getFoodEffectStacks('feySight'),3);
  assert.equal(providers.get('food')()[0].persistent,true);
  assert.equal(defs.feyHeftrootFlour.cookingPrimaryEffect,'feySight');
  cooking.consumeFeySight();
  cooking.registerCookedDefinition('food_root_test',{label:'Fey Meal',foodEffects:{feySight:4,fortitude:2},foodQuality:3});
  bag.food_root_test=1;cooking.recordItemQuality('food_root_test',3);
  assert.equal(cooking.eat('food_root_test',3).ok,true);
  assert.equal(cooking.getFoodEffectStacks('fortitude'),2);
  day+=5;cooking.update();
  assert.equal(cooking.getFoodEffectStacks('fortitude'),0);
  assert.equal(cooking.getFoodEffectStacks('feySight'),4);

  // Use the actual encounter and atomic save owners. Only the renderer, NPC
  // factory and persistence device are mocked, not the state machine.
  let zone='map_northern_cliffs',seed=17,deficit=-1,spawnCount=0,block=null,allowSave=true,inCombat=false,canActivate=true;
  const player={x:7*64,y:7*64,health:100,maxHealth:100},grid=Array.from({length:48},()=>Array.from({length:48},()=>({type:'grass',elevTier:0,water:0})));
  const hostiles=new Set(),walkers=[],gear={tools:{}},retired=[];
  w.RangedWeapons={retireOwnerProjectiles:actor=>retired.push(actor)};
  const rand=()=>((seed=Math.imul(1664525,seed)+1013904223|0)>>>0)/4294967296;
  const scene={children:[],add(c){c.parent=this;this.children.push(c)},remove(c){c.parent=null;this.children=this.children.filter(v=>v!==c)}},pos=()=>({set(x,y,z){Object.assign(this,{x,y,z})}});
  let activeScene=scene; // Simulate replacement of the rendered scene without changing its area ID.
  class Img{set src(s){this.width=2;this.height=2;this.onload()}}
  const canvasDoc={createElement:()=>({width:2,height:2,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8Array(16).fill(255)})})})};
  w.THREE={CanvasTexture:class{},SpriteMaterial:class{dispose(){}},Sprite:class{constructor(m){this.material=m;this.position=pos();this.scale=pos();this.userData={}}}};
  w.PlayerDowned={isDowned:()=>false};w.HobunjiAlcohol={triggerFeyBlackout:n=>{deficit=n;}};
  const boundWeaponKey='captainBound_testFey'; // A bound item must roll back with the ordinary root reward, not merely with gear.
  w.BanditCaptainArmaments={discard(){},boundKeyFor:()=>boundWeaponKey,grantCorpseWeapon:(_c,opts)=>{assert.equal(opts.deferSave,true);bag[boundWeaponKey]=1;return 'Bound Fey weapon';}};
  w.BanditCombat={loadGangConfig:async()=>({}),makeEntity:async(cfg,rank,tier,x,y,o)=>{
    spawnCount++;if(block&&spawnCount===block.index)await block.promise;
    return {...o.extra,x,y,health:100,areaId:zone,avatarRef:{group:{parent:scene},modelHeight:1.35},_banditCaptainArmament:rank==='captain'?{key:'captain-test-fey',origin:'Fey',enchantments:{base:['test'],flourishes:{}}}:null};
  }};
  load('gear-member-transaction.js',w,doc);
  w.CharacterMetaSave={update(fn){if(!allowSave)return false;fn({},{});return true;}};
  w.GearMemberTransaction.init({inventory:bag,getGearInventory:()=>gear,captureMemberWorldData:()=>({}),showToast(){}});
  load('wilderness-encounter-runtime.js',w,canvasDoc,Img);
  load('rootledoot-encounter.js',w,canvasDoc,Img);
  const root=w.Rootledoots;
  // Nohuknuk-style extremities are registered independently; the ordinary hostile front-card assembler still owns the Rootledoot's body.
  const rigWindow={};new Function('window',fs.readFileSync('docs/config/attachment-rig-profiles.js','utf8'))(rigWindow);
  const rigs=rigWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters;
  assert.deepEqual(rigs['rootledoot::male'].anchors,rigs['nohuknuk::male'].anchors);
  assert.deepEqual(rigs['rootledoot::male'].posteriorRule,rigs['nohuknuk::male'].posteriorRule);
  const hands={models:{sloth:{glb:'donor'}},speciesModels:{}};let rigChanges=0;
  w.HobunjiHandModelProfiles={data:hands,mutate(fn){rigChanges++;fn(hands);}};
  const feet={species:{}};w.SCRATCHBONES_CONFIG={game:{assets:{pngPlaneAvatar:{proceduralFeet:feet}}}};
  root.ensureRig();root.ensureRig();assert.equal(rigChanges,1);assert.equal(hands.speciesModels.rootledoot,'primate');assert.equal(hands.models.primate.glb,'assets/models/hands/hand_primate.glb');assert.equal(feet.species.rootledoot.glb,'assets/models/feet/foot_primate.glb');assert.equal(hands.speciesModels.nohuknuk,undefined);assert.equal(feet.species.nohuknuk,undefined);
  root.init({player,TILE:64,rnd:rand,hostiles,worldId:()=>'test',cycle:()=>1,day:()=>day,getArea:()=>zone,getGrid:()=>grid,walkable:(c,r)=>!!grid[r]?.[c]&&!grid[r][c].blocked,isBareGround:()=>true,getNpcWalkers:()=>walkers,isInCombat:()=>inCombat,canActivate:()=>canActivate,surfaceY:()=>0,getScene:()=>activeScene,despawn:c=>c.avatarRef.group.parent=null,canReceiveRoot:()=>true,giveRoot:()=>bag.feyHeftroot=(bag.feyHeftroot||0)+1});
  // Every suitable chunk owns one 3x3 footprint, and a wall separates even same-tier spawn tiles.
  for(let r=0;r<3;r++)for(let c=0;c<3;c++){
    const site=root.__test.siteInChunk(zone,{c,r});
    assert.ok(site,'flat chunk has a locale');
    assert.equal(Math.floor((site.c-1)/16),c);
    assert.equal(Math.floor((site.c+1)/16),c);
    assert.equal(Math.floor((site.r-1)/16),r);
    assert.equal(Math.floor((site.r+1)/16),r);
  }
  for(let r=0;r<16;r++)grid[r][8].blocked=true;
  const connected=root.__test.connectedSpawnTiles({chunk:{c:0,r:0},site:{c:7,r:7}});
  assert.ok(connected.near.length>0,'reachable emergence positions exist');
  assert.ok([...connected.near,...connected.far].every(p=>p.c<8),'individually walkable cells behind a solid wall are not valid emergence points');
  for(let r=0;r<16;r++)delete grid[r][8].blocked;
  cooking.registerFeyEncounterMultiplier('force',()=>1000);
  const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  const aim=()=>{const s=root.debugSnapshot().active.site;player.x=(s.c+.5)*64;player.y=(s.r+.5)*64;return s;};
  root.tick(.3);zone='map_western_slope';root.tick(.1);zone='map_northern_cliffs';root.tick(.3);await flush();
  assert.equal(root.debugSnapshot().active,null,'leaving eligible regions discards partial activation time');
  walkers.push({area:zone,root:{position:{x:7,z:7}}});
  root.tick(.5);assert.equal(root.debugSnapshot().active,null,'humanoid blocks bait');
  walkers[0].avatarGroup={userData:{namedAnimalNpc:true}}; // Real named-animal marker, not an invented test flag.
  canActivate=false;root.tick(.5);assert.equal(root.debugSnapshot().active,null,'area transition cannot activate a locale');
  canActivate=true;root.tick(.5);await flush();assert.equal(root.debugSnapshot().active.phase,'bait');
  assert.equal(scene.children[0].scale.y,.5625*.68*.96,'bait matches the actual mature farm sprite scale');
  inCombat=true;let bait=aim();assert.equal(root.action(bait.c,bait.r),null,'bait does not override attack buttons');
  assert.equal(root.pick(bait.c,bait.r),false,'stale bait action cannot fire during combat');inCombat=false;
  canActivate=false;assert.equal(root.pick(bait.c,bait.r),false,'visible bait cannot be picked during scene transition');canActivate=true;
  let s=aim();walkers.push({area:zone,root:{position:{x:7,z:7}}});assert.equal(root.pick(s.c,s.r),false,'NPC entering after activation blocks trigger');
  walkers.pop();root.tick(.5);await flush();s=aim();assert.equal(root.debugSnapshot().active.phase,'bait','same-day bait reactivates without reroll');
  let releaseFirst;block={index:spawnCount+1,promise:new Promise(r=>{releaseFirst=r;})};
  assert.equal(root.pick(s.c,s.r),true);await flush();
  walkers.push({area:zone,root:{position:{x:7,z:7}}});
  releaseFirst();await flush();
  assert.equal(hostiles.size,0,'NPC arriving during first async build prevents combat activation');
  assert.equal(root.debugSnapshot().active,null);
  walkers.pop();block=null;root.tick(.5);await flush();s=aim();
  assert.equal(root.debugSnapshot().active.phase,'bait','suppressed first wave retains the daily roll');
  let releaseScene;block={index:spawnCount+1,promise:new Promise(r=>{releaseScene=r;})};
  assert.equal(root.pick(s.c,s.r),true);await flush();
  activeScene={...scene,children:[]};releaseScene();await flush();
  assert.equal(hostiles.size,0,'same-zone scene replacement rejects stale actors');
  root.tick(.5);assert.equal(root.debugSnapshot().active,null,'replaced scene encounter resets');
  activeScene=scene;block=null;day++;root.tick(.5);await flush();s=aim();
  retired.length=0;
  let release;block={index:spawnCount+2,promise:new Promise(r=>{release=r;})};
  assert.equal(root.pick(s.c,s.r),true);await flush();assert.equal(hostiles.size,1);
  let a=[...hostiles][0];day++;root.noteDown(a,20);root.noteDownedHit(a,10); // Fight started yesterday, defeat happens today.
  assert.equal(root.handleDefeat(),true);assert.equal(deficit,30);assert.equal(cooking.getFoodEffectStacks('feySight'),5);assert.equal(hostiles.size,0);
  release();await flush();assert.equal(hostiles.size,0,'late actor cannot revive defeated encounter');
  assert.equal(retired.length,2,'both spawned and late-arriving actors retire their projectiles');
  assert.equal(a.health,0,'defeat invalidates the old combat actor');
  root.tick(.5);assert.equal(root.debugSnapshot().active,null,'defeat prevents same-day reroll');
  block=null;day++;root.tick(.5);await flush();s=aim();root.pick(s.c,s.r);await flush();
  for(const n of [2,3,1]){
    assert.equal(hostiles.size,n);
    if(n===1)assert.equal([...hostiles][0].rootledootBig,true);
    for(const actor of [...hostiles])assert.equal(root.onDeath(actor),true);
    root.tick(1.5);await flush();
  }
  assert.equal(root.debugSnapshot().active.phase,'reward');s=aim();
  const rewardSave=JSON.parse(JSON.stringify(root.serialize()));
  assert.equal(rewardSave.pendingRewards.length,1,'boss victory stores the unclaimed weapon and harvest');
  assert.equal(cooking.getFoodEffectStacks('feySight'),5,'defeating boss alone does not consume Fey-sight');
  zone='map_western_slope';root.reset('area hostiles cleared');root.tick(.5);
  assert.equal(root.debugSnapshot().active,null,'no boss mesh in another area');
  assert.equal(root.debugSnapshot().pendingRewards,1,'area teardown retains earned reward');
  root.restore(rewardSave);zone='map_northern_cliffs';root.tick(.5);await flush();s=aim();
  assert.equal(root.debugSnapshot().active.phase,'reward','unclaimed boss harvest reappears after reload');
  assert.equal(hostiles.size,0,'restoring the reward does not recreate enemies');
  allowSave=false;assert.equal(root.pick(s.c,s.r),false);assert.equal(bag.feyHeftroot,undefined);assert.equal(gear.tools.fey,undefined);assert.equal(bag[boundWeaponKey],undefined);assert.equal(cooking.getFoodEffectStacks('feySight'),5);
  assert.equal(root.debugSnapshot().active.phase,'reward','failed save leaves reward retriable');
  assert.equal(root.serialize().pendingRewards.length,1,'failed transaction restores pending reward');
  allowSave=true;assert.equal(root.pick(s.c,s.r),true);assert.equal(bag.feyHeftroot,1);assert.equal(gear.tools.fey,undefined);assert.equal(bag[boundWeaponKey],1);assert.equal(cooking.getFoodEffectStacks('feySight'),0);
  assert.equal(root.pick(s.c,s.r),false,'reward claimed once');
  assert.equal(root.serialize().pendingRewards.length,0,'successful claim removes pending reward from the save');
  const ledger=JSON.parse(JSON.stringify(root.serialize()));root.restore(ledger);day++;root.tick(.5);assert.equal(root.debugSnapshot().active,null,'cleared locale survives reload');
  zone='map_western_slope';root.tick(10);assert.equal(root.debugSnapshot().active,null,'excluded zone');
  // Co-op: the encounter belongs to every participant in its zone, not to the local avatar alone.
  load('actor-registry.js',w,doc);
  const reg=w.ActorRegistry;reg.registerPlayer(player,{local:true});reg.setLocalAreaResolver(()=>zone);
  const guest={x:0,y:0,health:100,maxHealth:100,areaId:'map_northern_cliffs'};reg.registerPlayer(guest,{playerId:'guest-1'});
  const activateAtChunk11=async()=>{zone='map_northern_cliffs';guest.areaId=zone;guest.x=guest.y=2*64;player.x=player.y=24*64;day++;root.tick(.5);await flush();return root.debugSnapshot().active;};
  let act=await activateAtChunk11();assert.equal(act?.phase,'bait','bait activates for the local player with a guest registered elsewhere');
  const site=act.site;guest.x=(site.c+.5)*64;guest.y=(site.r+.5)*64; // Guest arrives at the locale.
  player.x=player.y=2*64;root.tick(.5);await flush();
  assert.equal(root.debugSnapshot().active?.phase,'bait','a guest at the locale keeps it alive after the local player leaves');
  guest.x=guest.y=2*64;root.tick(.5);assert.equal(root.debugSnapshot().active,null,'bait goes dormant when every participant has left');
  act=await activateAtChunk11();assert.equal(act?.phase,'bait');
  guest.areaId='cave';guest.x=(act.site.c+.5)*64;guest.y=(act.site.r+.5)*64; // Same coordinates, different zone.
  player.x=player.y=2*64;root.tick(.5);assert.equal(root.debugSnapshot().active,null,'a player in another zone does not hold the locale open');
  reg.unregisterPlayer(guest);reg.unregisterPlayer(player);
  console.log('Rootledoot encounter, food, persistence and rollback regressions passed');
}
module.exports=main;
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
