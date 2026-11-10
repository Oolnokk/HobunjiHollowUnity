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
    assert(['wood','stone'].includes(component.materialRole), 'new structure uses existing material roles');
    assert.equal(component.materialTexture, component.materialRole === 'wood' ? 'boards.png' : 'carved_smooth.png',
      'wood matches authored aging barrels; stone matches carved architecture');
  }
}

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
assert.equal(rec.props.filter(prop => prop.strongholdProp).length,7,'two towers, barricades and one arch');
assert.equal(layout.transitions.length,1,'one native cave entrance');
assert.equal(layout.transitions[0].targetMapId,rec.stronghold.mapId);
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
assert.equal(caves.fortifiedStrongholdCleared(mapId),true);
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

const index=read('docs/index.html');
assert(index.indexOf('bandit-strongholds.js')>index.indexOf('cave-site-system.js'), 'stronghold module loads after cave owner');
assert(index.indexOf('bandit-strongholds.js')<index.indexOf('src="game.js'), 'feature is registered before gameplay boot');
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
  console.log('Bandit stronghold placement, saved cave reentry, styled furniture, physical barrels and once-only loot: OK');
}
testPhysicalBarrels().catch(error => { console.error(error);process.exitCode=1; });
