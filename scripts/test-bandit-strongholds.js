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
console.log('Bandit stronghold placement, styled assets, native entrance, save/reentry and teardown: OK');
