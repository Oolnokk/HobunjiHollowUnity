'use strict';

// Run: node scripts/test-bandit-strongholds.js
// Exercises the production camp adapter and cave save owner without a browser/GPU.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8'); // Production sources used below instead of duplicated planners.
const plain = value => JSON.parse(JSON.stringify(value)); // Cross-VM arrays/objects compare as plain Node values.

class Group {
  constructor() { this.children = []; this.position = { set(x,y,z) { this.x=x;this.y=y;this.z=z; } }; this.rotation = {}; }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
  traverse(fn) { fn(this); for (const child of this.children) fn(child); }
}

const saved = new Map(); // Mimics the world-scoped persistence engine used by CaveSiteSystem.
let writes = 0; // Counts durable cave saves after an occupancy state transition.
const environment = {
  console, Promise, Math, Map, Set, JSON, Number, String, Object, Array, setTimeout, clearTimeout,
  __hobunjiPlayerProfile: { worldId: 'test-fortified-world' },
  CalendarSystem: { tothalCycle: () => 4 },
  localStorage: { getItem: key => saved.get(key) || null, setItem: (key,value) => saved.set(key,value) },
  ProceduralFurniture: {
    CATALOG: {},
    buildFurnitureGroup(key) { assert(this.CATALOG[key], 'registered furniture recipe ' + key); return new Group(); },
  },
  THREE: { Group },
  __farmLog() {},
};
environment.window = environment;
vm.createContext(environment);
vm.runInContext(read('docs/js/cave-site-system.js'), environment, { filename:'cave-site-system.js' });
vm.runInContext(read('docs/js/bandit-strongholds.js'), environment, { filename:'bandit-strongholds.js' });
const eventHandlers = new Map(); // Same scoped events used by Shattercask explosions and melee impacts.
environment.WorldEvents = {
  on(kind,fn) { if (!eventHandlers.has(kind)) eventHandlers.set(kind,new Set()); eventHandlers.get(kind).add(fn); return ()=>eventHandlers.get(kind)?.delete(fn); },
  emit(kind,data) { for(const fn of eventHandlers.get(kind)||[]) fn(data); },
};
let fireIsActive = false; // Controls the shared PersistentGroundFire.intersects result in the burn regression.
let coverInvalidations = 0; // Checks that breaking a barrier refreshes the existing projectile/LOS cover cache.
environment.PersistentGroundFire = { intersects:()=>fireIsActive };
environment.NearbyVolumeCollision = { invalidate:()=>{coverInvalidations++;} };
vm.runInContext(read('docs/js/bandit-stronghold-cover.js'), environment, { filename:'bandit-stronghold-cover.js' });
vm.runInContext(read('docs/js/bandit-stronghold-wolves.js'), environment, { filename:'bandit-stronghold-wolves.js' });
vm.runInContext(read('docs/js/bandit-stronghold-combat.js'), environment, { filename:'bandit-stronghold-combat.js' });

const caves = environment.CaveSiteSystem;
const strongholds = environment.BanditStrongholds;
caves.init({ save: () => { writes++; } });

const cfg = { fortifiedStrongholds: { replacementFraction: .3 } }; // Tunable replacement ratio must not alter the ordinary camp count.
assert.equal(strongholds.shouldFortify('map_western_slope',0,{fortifiedStrongholds:{replacementFraction:0}}),false);
assert.equal(strongholds.shouldFortify('map_western_slope',0,{fortifiedStrongholds:{replacementFraction:1}}),true);
assert.equal(strongholds.shouldFortify('map_western_slope',0,cfg),strongholds.shouldFortify('map_western_slope',0,cfg),
  'site selection is independent of the combat RNG');
const hitCount = Array.from({ length: 1000 }, (_,slot) => strongholds.shouldFortify('map_western_slope',slot,cfg)).filter(Boolean).length;
assert(hitCount > 220 && hitCount < 380, 'deterministic campsite conversion preserves configured density');

for (const recipe of Object.values(environment.ProceduralFurniture.CATALOG)) {
  for (const component of recipe) {
    assert(['wood','stone','metal'].includes(component.materialRole), 'new structure uses existing material roles');
    assert.equal(component.materialTexture, component.materialRole === 'wood' ? 'boards.png' : 'carved_smooth.png',
      'wood matches authored aging barrels; stone/verdigris metal match carved architecture');
    assert.match(component.materialTextureTint,/^#[0-9a-f]{6}$/i,
      'worn materials use the renderer\'s valid opt-in shared-texture tint');
  }
}

// Authoring contract: war damage is geometry, not pristine walls with a new texture.
// Use the same existing board, carved stone and verdigris material roles for every salvage piece.
const coverHeights = environment.BanditStrongholdCover.__test.HEIGHT_BY_KEY; // Physics targetables must encompass the visible damaged cover.
for (const key of ['fortifiedWatchtower','fortifiedLowRail','fortifiedHighCover']) {
  const parts = environment.ProceduralFurniture.CATALOG[key]; // Authored tilted/broken parts are drawn by the existing furniture renderer.
  const tilted = parts.filter(piece => ['rx','ry','rz'].some(axis => Math.abs(piece.transform[axis] || 0) > 0));
  const irregular = parts.filter(piece => piece.topScaleX !== undefined || piece.topScaleZ !== undefined);
  const damaged = parts.filter(piece => /repair|scrap|patch|splinter|broken|shattered|battered|jagged/i.test(piece.name));
  assert(tilted.length >= 4, key + ' should look assembled crookedly, not made of square stock walls');
  assert(irregular.length >= 4, key + ' should have uneven/tapered, damaged plank ends');
  assert(damaged.length >= 4, key + ' should include visible scraps, splinters and repairs');
  const top = Math.max(...parts.map(piece => piece.transform.y + piece.transform.sy / 2));
  assert(top < coverHeights[key], key + ' projectile/target height must clear the highest damaged plank');
}
const woodTints = new Set(Object.values(environment.ProceduralFurniture.CATALOG)
  .flat().filter(piece => piece.materialRole === 'wood').map(piece => piece.materialTextureTint)); // Test dark, worn, and faded wood remain separate colors with one cached board PNG.
assert(woodTints.size >= 3, 'battle damage needs distinct dusty, dark and old splintered wood colors');
const towerParts = environment.ProceduralFurniture.CATALOG.fortifiedWatchtower; // Broken deck/roof keep line-of-sight gaps.
assert(!towerParts.some(piece => piece.name === 'tower-roof' || piece.name === 'tower-deck'),
  'one pristine full roof or deck must not visually erase the broken board gaps');
assert(towerParts.some(piece => piece.name === 'roof-repair-scrap'), 'watchtower receives an obvious salvage roof patch');
const sampleDamage = () => ({ children:[ // Stable visual variation must never displace load-bearing posts.
  {name:'roof-patch-1',position:{x:0,y:3,z:0},rotation:{z:0},visible:true},
  {name:'tower-post-0-0',position:{x:0,y:1,z:0},rotation:{z:0},visible:true},
] });
const damageA=sampleDamage(),damageB=sampleDamage(),damageC=sampleDamage();
strongholds.distressFurnitureGroup(damageA,'camp-a');
strongholds.distressFurnitureGroup(damageB,'camp-a');
strongholds.distressFurnitureGroup(damageC,'camp-b');
assert.equal(JSON.stringify(damageA),JSON.stringify(damageB),'site-specific wear is deterministic after reentry');
assert.notEqual(JSON.stringify(damageA),JSON.stringify(damageC),'different camps get visibly different roof patches');
assert.equal(damageA.children[1].position.y,1,'repair variation must not shift the structural posts');

const zoneId = 'map_western_slope';
const layout = { transitions: [] }; // Real zone placement owner has already reserved a footprint for this existing camp.
const deps = { zoneLayouts:new Map([[zoneId,layout]]), zoneScenes:new Map() };
const rec = {
  zoneId, discoverySlot:1,
  instance:{ id:'original-camp-1', site:{ x:10,y:15,w:9,h:8 },stampedObjectIds:['tent-a'] },
  props:[{id:'tent-a',type:'tent',destroyed:false}],
};
assert.equal(strongholds.upgradeCamp(rec,deps),true);
assert.equal(rec.props[0].destroyed,true, 'tent appearance is replaced, not another camp generated');
assert.equal(rec.props.filter(prop => prop.strongholdProp).length,9,'two towers, barricades, an arch and two wolf stakes');
assert.equal(rec.props.filter(prop => prop.strongholdStake).length,2,'each wolf receives a separate stake and native interaction');
assert.equal(new Set(rec.props.filter(prop=>prop.strongholdProp).map(prop=>prop.id)).size,9,'twin watchtowers and barricades have distinct mesh IDs');
assert.equal(new Set(rec.props.filter(prop=>prop.strongholdProp).map(prop=>prop.coverId)).size,9,'cover and stake save keys are individually stable');
assert.equal(layout.transitions.length,1,'one native cave entrance');
assert.equal(layout.transitions[0].targetMapId,rec.stronghold.mapId);
assert.equal(caves.__test.isWildlifeLabelTransition(layout.transitions[0]),false,
  'wildlife den name refresh cannot overwrite the fortified entrance label');
assert.equal(caves.__test.isWildlifeLabelTransition({ targetMapId:rec.stronghold.mapId+'_boss' }),false,
  'wildlife den name refresh cannot overwrite the boss annex label');
const ordinaryDen = { mapId:'test-animal-den', zoneId, contents:caves.TYPES.EMPTY }; // Test-only ordinary wildlife cave.
caves.__test.sitesByMapId.set(ordinaryDen.mapId,ordinaryDen);
assert.equal(caves.__test.isWildlifeLabelTransition({ targetMapId:ordinaryDen.mapId }),true,
  'ordinary animal cave labels remain synchronized with wildlife turnover');
assert.equal(caves.__test.isWildlifeLabelTransition({ targetMapId:ordinaryDen.mapId,puzzleCaveOnly:true }),false,
  'puzzle cliff-door labels remain owned by their puzzle entrance');
caves.__test.sitesByMapId.delete(ordinaryDen.mapId);
const count = rec.props.length;
assert.equal(strongholds.upgradeCamp(rec,deps),true);
assert.equal(rec.props.length,count,'repeated initialization does not duplicate props');
assert.equal(layout.transitions.length,1);

const mapId=rec.stronghold.mapId;
const profile=caves.profileForMapId(mapId);
assert.equal(profile.fortifiedStronghold,true);
assert.equal(profile.inhabitant,caves.TYPES.BANDIT_HIDEOUT);
assert.equal(caves.sitesForZone(zoneId).length,0,'fortress is never counted as a wildlife cave/den');
assert.equal(caves.fortifiedStrongholdCleared(mapId),false);
const state=caves.__test.runtimeStateBySignature.get(profile.signature);
state.occupantsCleared=true;
caves.__test.persistState();
assert(writes>0, 'cleared garrison is saved through the original cave save owner');
assert.equal(caves.fortifiedStrongholdCleared(mapId),false,'garrison alone never clears the camp before the Bandit Lord dies');
const bossProfile=caves.profileForMapId(mapId+'_boss'); // Boss arena now carries its own persistent population state.
caves.strongholdStage(mapId); // Allocates the child record through the same cave-state owner.
const bossState=caves.__test.runtimeStateBySignature.get(bossProfile.signature);
bossState.occupantsCleared=true;
caves.__test.persistState();
assert.equal(caves.fortifiedStrongholdCleared(mapId),true,'boss death completes the stronghold lifecycle');
const worldSave=caves.serialize();

// Save recovery must work while loading directly inside this synthetic cave, before
// bandit-camps has regenerated the exterior zone or re-registered its portal.
caves.restore(worldSave);
assert.equal(caves.profileForMapId(mapId).fortifiedStronghold,true);
assert.equal(caves.fortifiedStrongholdCleared(mapId),true,'cleared-state survives reentry from world save');

// Interior barricades come from the exact same furniture material factory.
const scene=new Group();
const floor=[];
for(let col=0;col<20;col++)for(let row=0;row<15;row++)floor.push([col,row]);
const data={caveSite:profile, floor, exitCol:2,exitRow:2,floorSurfaceY:0};
assert(strongholds.buildInteriorProps(mapId,data,scene)>0);
assert.equal(scene.children.length,1);
assert.equal(strongholds.buildInteriorProps(mapId,data,scene),scene.children[0].children.length,'cached scene does not duplicate cover');
assert.equal(strongholds.forgetInterior(mapId),true);
assert.equal(scene.children.length,0,'cave reset removes its decorations');

// Unloading the exterior scene cannot erase a previously cleared fortress.
strongholds.removeCamp(rec,deps,false);
assert.equal(layout.transitions.length,0);
assert.equal(caves.fortifiedStrongholdCleared(mapId),true);
assert.equal(caves.profileForMapId(mapId).fortifiedStronghold,true);

// Physical boards share the native WorldEvents blast/fire signal and the original tile collision marker.
const cover = environment.BanditStrongholdCover;
const coverTile = {}; // Exact tile object must be restored when this specific board breaks.
const coverGrid = Array.from({length:8},()=>Array.from({length:8},()=>({})));
coverGrid[3][4] = coverTile;
const coverScene = new Group(), coverMesh = new Group();
coverScene.add(coverMesh);
let removedCover=0;
assert.equal(cover.register({scope:zoneId,saveMapId:mapId,id:'exterior:1:test',
  key:'fortifiedHighCover',mesh:coverMesh,col:4,row:3,y:0,getGrid:()=>coverGrid,
  onDestroyed:()=>{removedCover++;}}),true);
assert.equal(coverTile._banditTentCollisionId,'stronghold-cover:exterior:1:test','same game collision mask blocks movement');
environment.WorldEvents.emit('blast',{scope:'other-map',x:4.5,z:3.5,radius:2});
assert.equal(removedCover,0,'other areas cannot destroy this board');
environment.WorldEvents.emit('blast',{scope:zoneId,x:4.5,z:3.5,radius:2});
assert.equal(removedCover,1,'existing Shattercask blast event destroys the matching board');
assert.equal(coverTile._banditTentCollisionId,undefined,'destroying cover restores its walkable grid tile');
assert.equal(coverMesh.parent,null,'destroyed barricade stops blocking projectile and sight cover');
assert.equal(caves.fortifiedCoverDestroyed(mapId,'exterior:1:test'),true,'destruction belongs to existing cave save');
assert(coverInvalidations>0,'existing NearbyVolumeCollision index invalidated');
assert.equal(cover.register({scope:zoneId,saveMapId:mapId,id:'exterior:1:test',key:'fortifiedHighCover',
  mesh:new Group(),col:4,row:3,getGrid:()=>coverGrid,onDestroyed:()=>{removedCover++;}}),false,'saved cover remains gone after scene rebuild');
assert.equal(removedCover,2,'saved destruction removes new rendering immediately without a duplicate reward');
const fireMesh = new Group();coverScene.add(fireMesh);
assert.equal(cover.register({scope:zoneId,saveMapId:mapId,id:'exterior:1:fire',
  key:'fortifiedLowRail',mesh:fireMesh,col:5,row:4,getGrid:()=>coverGrid}),true);
fireIsActive=true;
for(let step=0;step<7;step++)cover.tick(zoneId,.4);
fireIsActive=false;
assert.equal(caves.fortifiedCoverDestroyed(mapId,'exterior:1:fire'),true,'sustained real ground-fire contact burns through low wood');
assert.equal(fireMesh.parent,null,'burnt boards no longer intercept projectiles');
assert.equal(cover.debugSnapshot(zoneId).active.length,0,'destroyed props leave no per-frame fire candidates');

const index=read('docs/index.html');
assert(index.includes('bandit-stronghold-cover.js'), 'new reusable cover module loads before game boot');
assert(index.includes('bandit-stronghold-wolves.js'), 'wolf stakes and chase reuse the game loop before gameplay boot');
assert(index.indexOf('bandit-strongholds.js')>index.indexOf('cave-site-system.js'), 'stronghold module loads after cave owner');
assert(index.indexOf('bandit-strongholds.js')<index.indexOf('src="game.js'), 'feature is registered before gameplay boot');
// Rescued gar-wolves use native creature entities, never their own combat damage.
const wolves=environment.BanditStrongholdWolves;
const secondCamp={
  zoneId,discoverySlot:2,homeX:0,homeY:0,gangIds:new Set(),
  instance:{id:'original-camp-2',site:{x:25,y:15,w:9,h:8},stampedObjectIds:['tent-b']},
  props:[{id:'tent-b',type:'tent',destroyed:false}],
};
assert(strongholds.upgradeCamp(secondCamp,deps));
secondCamp.homeX=(25+4.5)*64;secondCamp.homeY=(15+4)*64;
const zoneScene=new Group(), zoneGrid=Array.from({length:38},()=>Array.from({length:46},()=>({})));
let wolfSerial=0,activeArea=zoneId,despawned=0;
const wolfHostiles=new Set();
const wolfDeps={
  TILE:64,zoneLayouts:deps.zoneLayouts,zoneScenes:new Map([[zoneId,{scene:zoneScene,grid:zoneGrid}]]),
  hostileObjects:wolfHostiles,
  player:{x:19*64,y:20*64,health:100},
  getCurrentArea:()=>activeArea,getActiveScene:()=>zoneScene,getActiveGrid:()=>zoneGrid,
  getActiveCols:()=>46,getActiveRows:()=>38,tileSurfaceYInArea:()=>0,
  makeCreatureEntity(kind,x,y,options){assert.equal(kind,'gar-wolf');
    return {id:'wolf-'+(++wolfSerial),creatureKey:kind,health:24,def:{aggroRangePx:256,leashRangePx:512},x,y,areaId:activeArea,...options};
  },
  despawnCreature(wolf){despawned++;wolfHostiles.delete(wolf);},
  showToast(){},
};
assert.equal(wolves.ensureExterior(secondCamp,wolfDeps),2,'two real chained gar-wolf entities spawn at each stake');
assert([...wolfHostiles].filter(actor=>actor.banditStrongholdWolf).every(wolf=>wolf.def.hostile===false),
  'neither chained wolf can aggro the player before the actual cave threshold');
assert.equal(wolves.ensureExterior(secondCamp,wolfDeps),0,'exterior wolf setup is idempotent');
const wolfStake=secondCamp.props.find(prop=>prop.strongholdStake&&prop.wolfSlot===0);
const secondMap=secondCamp.stronghold.mapId;
assert.equal(wolves.freeStake(secondCamp,wolfStake,wolfDeps),true,'stake interaction releases its own living wolf');
assert.equal(wolfStake.freed,true);
assert.equal(caves.strongholdWolfStatus(secondMap,0).freed,true,'release is persisted in the parent cave');
assert.equal(wolves.freeStake(secondCamp,wolfStake,wolfDeps),false,'one stake cannot unlock the same wolf twice');
for(let tick=0;tick<42;tick++)wolves.tickExterior(zoneId,.2,wolfDeps);
assert(wolves.debugSnapshot().escaped>0,'released wolf visibly reaches the cave entrance instead of teleporting on interaction');
const enemy={id:'enemy-native',isBandit:true,health:50,caveSiteMapId:secondMap,x:21*64,y:20*64};
wolfHostiles.add(enemy);
activeArea=secondMap;
assert.equal(caves.markStrongholdWolfAttackActivated(secondMap),true,
  'the first interior transition, not approaching the stake, arms wolf hostility');
assert.equal(caves.strongholdWolfStatus(secondMap,1).activated,true);
const caveProfile=caves.profileForMapId(secondMap);
const caveState=caves.__test.runtimeStateBySignature.get(caveProfile.signature);
assert.equal(wolves.ensureInterior(caveProfile,{banditSpawns:[{col:21,row:20}],entranceTile:{col:17,row:19}},caveState,wolfDeps),2,
  'freed and unfreed wolves enter actual native cave combat in opposite factions');
const hostileWolf=[...wolfHostiles].find(actor=>actor.banditStrongholdGateWolf);
assert(hostileWolf && hostileWolf.targetPlayer===wolfDeps.player && hostileWolf.def.hostile,
  'only the unrescued wolf attacks the player after the cave threshold');
const ally=[...wolfHostiles].find(actor=>actor.banditStrongholdLiberated);
assert(ally && ally.targetCreature===enemy && ally.targetPlayer==null && ally.def.hostile===false,
  'liberated wolf uses native patrol-chase against bandits, never the player');
assert.equal(wolves.ensureInterior(caveProfile,{},caveState,wolfDeps),0,'native wolf ally cannot duplicate on runtime ticks');
ally.health=0;
wolves.tickInterior(secondMap,wolfDeps);
assert.equal(caves.strongholdWolfStatus(secondMap,0).dead,true,'fallen freed wolves do not respawn after a reload');
wolves.forgetInterior(secondMap,wolfDeps);
wolves.forgetExterior(secondCamp,wolfDeps);
strongholds.removeCamp(secondCamp,deps,false);

// Barrel gameplay uses the exact production stronghold and CaveSiteSystem modules.
// The authored Aging Barrel supplies its artwork, and the shared Shattercasks Burden
// supplies pickup, throw and impact behavior. Only those browser dependencies are stubbed.
const registered = new Map(); // Live ordinary Burden records, not a parallel barrel physics system.
const grants = []; // Each real impact must award its loot once, including after re-entry.
const furnitureLoads = []; // Ensures all new barrels reuse an authored furniture asset.
const itemDeps = { ITEM_DEFS: {}, inventoryItems: [] }; // Canonical inventory registration for inert Komanine.
environment.AlchemySystem = { RECIPE_DEFS: {
  fire: { id: 'fire', useMode:'throw' }, frost: { id: 'frost', useMode:'throw' },
  narcoticRush: { id:'narcoticRush', label:'Narcotic Rush' },
}, ensureRecipeItemDef(id) { return 'flask_' + id; } };
environment.BanditCombat = { availableFlaskRecipeIds() { return ['fire','frost']; } };
environment.ItemProcessing = {
  init(deps) { this.deps=deps; },
  getProcessingOutput(method, source) {
    assert.equal(method,'barrelAging');
    return { key:source === 'needlegrain' ? 'needlegrainSake' : 'heftrootVodka',label:'Aged liquor' };
  },
  ensureProcessedItemDef(item) { this.deps.ITEM_DEFS[item.key]=item; },
};
assert.equal(strongholds.installItemRegistration(),true,'registers on the canonical ItemProcessing initializer');
environment.ItemProcessing.init(itemDeps);
assert.equal(itemDeps.ITEM_DEFS.komanine.label,'Komanine');
assert.equal(itemDeps.ITEM_DEFS.komanine.consumeAction,undefined,'Komanine effects are intentionally unspecified');
environment.AuthoredFurniture = {
  peek(key) { return key === 'looseCrate' ? { carryable:{handTargets:{},billboardAnchor:{}} } : null; },
  async load(key) { furnitureLoads.push(key); return { key, parts:[{kind:'barrel',transform:{y:.4269,sy:.8327,sz:.76}}] }; },
  buildGroup() { const group = new Group(); group.isObject3D = true; return group; },
};
environment.Shattercasks = {
  registerBurden(data) { const burden={ ...data };registered.set(data.id,burden);return burden; },
  getBurden(id) { return registered.get(id) || null; },
  discardBurden(burden) { registered.delete(burden.id);return true; },
  grantBurdenLoot(loot) { grants.push(plain(loot)); return Object.keys(loot); },
};

async function testPhysicalBarrels() {
  const restoredProfile = caves.profileForMapId(mapId);
  const map = {
    caveSite:restoredProfile, exitCol:2,exitRow:2,floorSurfaceY:.42,
    floor:Array.from({length:20},(_,x)=>Array.from({length:20},(_,y)=>[x,y])).flat(),
    caveSitePlan:{ strongholdBarrels:[
      { id:'contraband-0',kind:'contrabandBarrel',col:9,row:10 },
      { id:'flasks-1',kind:'flaskBarrel',col:12,row:10 },
    ] },
  };
  const scene = new Group();
  const lane=strongholds.chargeLaneForMap(map);
  assert(lane?.placements?.length>=4,'at least four authentic low/high timber barricades flank the charged route');
  for(const p of lane.placements){
    const dx=p.col-lane.entry.col, dz=p.row-lane.entry.row;
    const crossDistance=Math.abs(dx*lane.lateral.x+dz*lane.lateral.z);
    assert(crossDistance>=1.7,'barricades leave a physical empty charge lane at least one tile to either side');
  }
  const count = strongholds.buildInteriorProps(mapId,map,scene);
  assert(count>0,'barrel visuals coexist with existing material-matched cover');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(plain(furnitureLoads),['agingBarrel','agingBarrel'],'uses the same authored Aging Barrel for both kinds');
  assert.equal(registered.size,2,'one physical Burden of each variant');
  const contraband = registered.get(mapId+':contraband-0');
  const flask = registered.get(mapId+':flasks-1');
  assert(contraband.data.carryable?.handTargets?.left && flask.data.carryable?.handTargets?.right,
    'barrels inherit existing held-item rig with geometry-sized hand targets');
  assert.equal(contraband.group.position.y,.42,'barrel sits at real cavern floor elevation');
  assert.equal(contraband.onImpact(contraband,'thrown'),true);
  assert.equal(contraband.onImpact(contraband,'duplicate'),true);
  assert.equal(grants.length,1,'same-barrel duplicate hit awards nothing');
  assert(Object.keys(grants[0]).some(key=>['needlegrainSake','heftrootVodka'].includes(key)),
    'contraband uses existing barrel-aged alcohol recipes');
  assert.equal(registered.size,1);
  const flaskId=flask.id;
  flask.onPickup(flask);
  assert.equal(caves.fortifiedBarrelStatus(mapId,flaskId).taken,true,'pickup persists before throw');
  assert.equal(flask.onImpact(flask,'thrown'),true);
  assert.equal(grants.length,2,'flask barrel has an independent once-only drop');
  assert(Object.keys(grants[1]).some(key=>key.startsWith('flask_')),'flask loot comes from real throwable recipe ids');
  const savedAfterClaims = caves.serialize();
  caves.restore(savedAfterClaims);
  assert.equal(caves.fortifiedBarrelStatus(mapId,flaskId).claimed,true,'world save retains claim on reload');
  assert.equal(strongholds.ensureBarrels(mapId,map,scene),0,'re-entry never regenerates spent barrels');
  assert.equal(strongholds.forgetInterior(mapId),false,'world restore already disposed the previous cave scene');
  assert.equal(scene.children.length,0,'world restore removes stale cave cover presentation');
  // Only selected cave garrison bandits should throw physical, friendly-fire Shattercasks.
  const throwApi = environment.BanditStrongholdCombat;
  const thrower = {
    id:'bandit-thrower',banditStrongholdThrower:true,_strongholdTileSize:64,
    areaId:mapId,scene,health:50,x:64*9,y:64*8,
    avatarRef:{group:{position:{y:1.2}}},def:{},telegraphState:null,
  };
  const target = {id:'player',areaId:mapId,health:100,x:64*16.5,y:64*9};
  assert.equal(throwApi.updateThrow({...thrower,banditStrongholdThrower:false},.1,target),null,
    'only explicit stronghold throwers use the optional ballistics');
  assert.equal(throwApi.__test.selfBlastSafe(thrower,{x:64*13,y:64*8},64),false,
    'thrower will never blast its own tile even if allies could be endangered');
  assert.equal(throwApi.__test.selfBlastSafe(thrower,target,64),true,
    'safe self-distance permits enemy Shattercasks without checking allied positions');
  const shotStart={x:1,y:1,z:2},shotEnd={x:5,y:.3,z:4};
  const initial=throwApi.arc(shotStart,shotEnd);
  const computedY=shotStart.y+initial.y*initial.flightSeconds-.5*13*initial.flightSeconds**2;
  assert(Math.abs(computedY-shotEnd.y)<1e-7,'planned arc uses the same 13 unit/s² gravity as Shattercasks');
  assert.equal(throwApi.__test.chooseKind(thrower),'shattercask');
  assert.equal(throwApi.__test.chooseKind(thrower),'flameShattercask');
  let staged=null, launched=null;
  environment.GridTileAccessors={getCurrentArea:()=>mapId};
  environment.RangedWeapons={hasLineOfSight:()=>true,actorHitbox:()=>({box:{min:{y:0}}})};
  environment.HeldActionAnimations={throwFlask:{poses:{neutral:{}},durationS:1,style:'chop'}};
  environment.Combat={beginStagedAction(spec){staged=spec;return{active:true}}};
  environment.BanditCombat.finishAction=c=>{c._banditAction=null;};
  environment.Shattercasks.createHangingBurden=async options=>{
    launched=options;return{id:options.id,kind:options.kind,mapId:options.mapId};
  };
  let release=null;
  environment.Shattercasks.releaseBurdenWithVelocity=(burden,velocity,cause)=>{
    release={burden,velocity,cause};return true;
  };
  thrower._strongholdThrowCooldown=0;
  assert.equal(throwApi.updateThrow(thrower,.1,target)?.handled,true,'native staged attack activates at valid range and LOS');
  assert(staged?.data?.strongholdCask,'staged attack carries native combat metadata');
  staged.onStrike();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(launched?.furnitureKey,'shattercaskBlasting','physical weapon uses authored Shattercask furniture');
  assert.equal(release?.cause,'bandit-thrown-shattercask','real Burden flight is used instead of bespoke projectile damage');
  assert([release.velocity.x,release.velocity.y,release.velocity.z].every(Number.isFinite));
  assert.equal(release.burden.kind,'shattercask');
  staged.onComplete();
  assert.equal(thrower._strongholdThrowPending,false,'completing the existing staged action releases its AI lock');
  assert(thrower._strongholdThrowCooldown>0);
  thrower._strongholdThrowCooldown=0;
  const blocked=environment.RangedWeapons.hasLineOfSight;
  environment.RangedWeapons.hasLineOfSight=()=>false;
  assert.equal(throwApi.updateThrow(thrower,.1,target),null,'existing LOS cover prevents throws behind intact boards');
  environment.RangedWeapons.hasLineOfSight=blocked;
  const stale=environment.Shattercasks.releaseBurdenWithVelocity;
  let discarded=0;
  environment.Shattercasks.discardBurden=()=>{discarded++;return true;};
  let completeBuild;
  environment.Shattercasks.createHangingBurden=()=>new Promise(resolve=>{completeBuild=resolve;});
  const canceled=throwApi.launch(thrower,target,'flameShattercask',mapId);
  thrower.areaId='elsewhere'; // A transition while authored furniture loads must never launch into the new scene.
  completeBuild({id:'late',kind:'flameShattercask',mapId});
  assert.equal(await canceled,false);
  assert.equal(discarded,1,'late Burden canceled after area transition without explosion');
  environment.Shattercasks.releaseBurdenWithVelocity=stale;
  console.log('Bandit stronghold placement, cover destruction, chained wolves, physical barrels and staged Shattercask throws: OK');
}
testPhysicalBarrels().catch(error => { console.error(error);process.exitCode=1; });
