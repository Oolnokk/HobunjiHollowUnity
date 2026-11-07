'use strict';
// Execute real flight/perch/nest owners together: original portraits, visible-only
// deposition, native egg records, safe player delivery and persisted searched state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zone = 'map_northern_cliffs', nestId = 'map_i_den_tzatzul_map_northern_cliffs_0'; // Real indexed destination IDs.
let area = zone; // Drives actual lifecycle transitions in the production modules.
const living = new Set(), companions = new Set(), corpses = new Set(), denNests = new Map(); // Game-owned collections, never replaced by the modules.
const entries = [], eggBuilds = []; // Record only boundary calls, while the owners execute their actual state machines.
const scene = { add(group) { group.parent = this; }, remove(group) { group.parent = null; } };
function avatar() {
  return { group: { parent: scene, visible:true },
    frontPlane: { visible:true, material:{map:{image:{width:64}}} },
    headRig:{ frontHeadBone:{ scale:{setScalar(value){this.value=value;}} },
      backHeadBone:{ scale:{setScalar(value){this.value=value;}} } } };
}
const player = { x:6000, y:6000, health:500 }; // Stay outside ordinary hunt range until the explicit player-capture check.
const plan = require('../docs/config/locales/locale_tzatzul_nest_map_northern_cliffs_0.json').cavern.features.tzatzulNest;
const W = { __farmLog(){}, TzatzulRegistration:{identityFor:(id,slot,parent)=>parent||{id:id+slot,tintHex:'#c0c080'}},
  TzatzulLiveVisuals:{release(){}},
  DenNestSystem:{ensureCavernNestFurniture(nest){eggBuilds.push(nest);}},
  TzatzulNestInterior:{isNestMap:id=>id===nestId,getArena:()=>plan,getFloorY:()=>0,releaseInactive(){},
    ensurePerches:()=>plan.wallPerches.map(p=>W.PerchSupport.point(p.id,(p.col+.5)*64,(p.row+.5)*64,p.height))},
  CreatureDeath:{settleAsCorpse(prey){prey.health=0;prey.state='corpse';corpses.add(prey);return true;}},
};
const context = {window:W,Math,Date,Set,Map,console};
for (const name of ['perch-support','tzatzul-flight-runtime','tzatzul-nest-encounter'])
  vm.runInNewContext(fs.readFileSync('docs/js/'+name+'.js','utf8'),context);
const perch = W.PerchSupport.point('spire',128,128,6); // Repeated zone checks receive the same cached physical support.
W.TzatzulCliffSites={ensure:()=>[{id:'spire',support:perch,caveMapId:nestId}],releaseInactive(){}};
const deps = {TILE:64,player,hostileObjects:living,companionObjects:companions,corpseObjects:corpses,denNests,
  buildingScenes:new Map([[nestId,{scene,grid:[],cols:27,rows:27}]]),
  getCurrentArea:()=>area,worldSurfaceY:()=>0,
  enterBuilding(...args){entries.push(args);area=args[0];},canPlayerOccupy:()=>true,
  makeCreatureEntity:(key,x,y,opts={})=>({creatureKey:key,x,y,areaId:area,health:100,maxHealth:100,
    def:{attackDamage:24,modelWidth:1},avatarRef:avatar(),...opts}),
};
W.TzatzulFlightRuntime.init(deps); W.TzatzulNestEncounter.init(deps);
W.TzatzulFlightRuntime.ensureZone(zone);
const bird=[...living][0]; // This is the actual factory result retained by the flight owner.
const unseen=deps.makeCreatureEntity('gar-wolf',192,128,{state:'patrol'}); living.add(unseen);
assert(W.TzatzulFlightRuntime.__test.capture(bird,unseen));
W.TzatzulFlightRuntime.__test.carryCaptive(bird);
W.TzatzulFlightRuntime.__test.releaseCaptive(unseen,'returned to roost');
assert.equal(unseen.health,100,'an offscreen portrait never authorizes an invisible kill');
assert.equal(unseen.x,192,'unseen prey returns to its original walkable ground');
assert.equal(unseen.avatarRef.frontPlane.onAfterRender,undefined,'render hook restored on release');
const seen=deps.makeCreatureEntity('gar-wolf',192,128,{state:'patrol'}); living.add(seen);
assert(W.TzatzulFlightRuntime.__test.capture(bird,seen));
seen.avatarRef.frontPlane.onAfterRender(); // Mimics the renderer actually drawing the original prey portrait while attached.
W.TzatzulFlightRuntime.__test.releaseCaptive(seen,'returned to roost');
assert.equal(seen.health,0,'visibly carried prey becomes a nest victim');
assert(!living.has(seen),'ground wildlife cannot continue moving a deposited corpse');
assert.equal(seen.def.lootPool,'mixedCrateTreasurePuzzle');
assert.equal(W.TzatzulNestEncounter.debugSnapshot().deposited,1);
const immune=deps.makeCreatureEntity('gar-wolf',128,128); living.add(immune);
W.Combat={deps:{damageCreature(){},damagePlayer(){}}}; // Dodge/immune damage rejection changes no Health.
assert(W.TzatzulFlightRuntime.__test.swoop(bird,immune));
for(let i=0;i<20&&bird._tzFlight.phase==='swoop';i++)W.TzatzulFlightRuntime.update(.1);
assert(!immune.tzatzulCapturedBy,'a rejected body hit cannot abduct an immune target');
// Frequent ensureZone calls used to reset the hunt clock before REST_SECONDS elapsed.
W.PerchSupport.attach(bird,perch);bird._tzFlight.phase='perched';bird._tzFlight.elapsed=0;bird._tzFlight.rest=5;
for(let i=0;i<55;i++){W.TzatzulFlightRuntime.ensureZone(zone);W.TzatzulFlightRuntime.update(.1);}
assert(W.TzatzulFlightRuntime.debugSnapshot().scouts>0,'repeated zone census cannot suppress the active scouting cycle');
W.PerchSupport.attach(bird,perch);player.x=256;player.y=256;
assert(W.TzatzulFlightRuntime.__test.capture(bird,player));
W.TzatzulFlightRuntime.__test.releaseCaptive(player,'returned to roost');
assert.equal(entries[0][0],nestId,'real abduction uses the native indexed cavern loader');
assert.equal(entries[0][3],'tzatzul_delivery','arrival avoids the automatic cave exit');
assert(!player.tzatzulCapturedBy&&!player.onBranch,'native transition starts with no stale carry support');
const clock={day:8,time01:.4}; // Game calendar fractions are days; 1/48 day is half an in-game hour.
deps.calendar=clock;
area=zone; // Re-enter the outdoor map to exercise the complete flight delivery path.
W.PerchSupport.attach(bird,perch);bird._tzFlight.phase='perched';bird._tzFlight.retreating=false;bird.health=100;
player.health=500;player.x=256;player.y=256;
assert(W.TzatzulFlightRuntime.__test.capture(bird,player));
assert(W.TzatzulFlightRuntime.__test.returnHome(bird));
for(let i=0;i<90&&bird._tzFlight.phase==='return';i++)W.TzatzulFlightRuntime.update(.1);
assert.equal(bird._tzFlight.phase,'in-nest','successful player delivery sends the parent into its cave');
assert.equal(bird.tzatzulInNest,true,'the provisioning parent is hidden from exterior rendering');
assert.equal(bird._denHidden,true,'other combat systems cannot target a bird inside its nest');
area=zone; // Simulate exiting the native cave so the exterior hunt AI is active again.
clock.time01+=29/60/24;
W.TzatzulFlightRuntime.update(.1);
assert.equal(bird._tzFlight.phase,'in-nest','the parent stays inside for the first 29 game minutes');
clock.time01+=2/60/24;
W.TzatzulFlightRuntime.update(.1);
assert.notEqual(bird._tzFlight.phase,'in-nest','the parent emerges once thirty game minutes pass');
assert.equal(bird._denHidden,false,'an emerged parent returns to normal rendering and targeting');
area=nestId; // Subsequent assertions exercise the original interior egg/victim state.

W.TzatzulNestEncounter.buildNest(nestId,{cavernFeatures:{tzatzulNest:plan},floorSurfaceY:0},scene);
assert.equal(eggBuilds[0].itemKey,'tzatzulEgg');
assert.equal(eggBuilds[0].remaining,3,'native nest provides three individual non-fertile eggs');
W.TzatzulNestEncounter.update(.1);
(async()=>{
  await new Promise(resolve=>setImmediate(resolve)); // Finish the actual headless-portrait preparation task.
  assert(corpses.has(seen),'the exact original carried actor is laid into the nest, never replaced by generic remains');
  assert.equal(seen.areaId,nestId);
  assert.equal(seen.avatarRef.headRig.frontHeadBone.scale.value,.001,'animal head vertices collapse at the authored neck');
  seen.corpseLooted=true;denNests.get(nestId).remaining=2;
  const save=JSON.parse(JSON.stringify(W.TzatzulNestEncounter.serialize()));
  assert.equal(save.nests[0].eggs,2,'native hold-to-take count is persisted');
  assert.equal(save.nests[0].victims[0].looted,true,'searching a preserved corpse is persisted');
  W.TzatzulNestEncounter.restore(save);
  assert.equal(W.TzatzulNestEncounter.serialize().nests[0].victims.length,1,'restore cannot duplicate delivered victims');
  const room=W.TzatzulNestEncounter.ensure(nestId);
  room.mother.health=0;room.hatchlings[0].health=0;
  W.TzatzulNestEncounter.update(.1);
  const cleared=JSON.parse(JSON.stringify(W.TzatzulNestEncounter.serialize()));
  W.TzatzulNestEncounter.init(deps);W.TzatzulNestEncounter.restore(cleared);
  const restored=W.TzatzulNestEncounter.ensure(nestId);
  assert.equal(restored.mother,null,'reloading a cleared nest cannot resurrect its miniboss');
  assert.equal(restored.hatchlings.length,1,'surviving hatchling adds remain independent of mother defeat');
  console.log('Tzatzul rendered-only prey delivery, native eggs, player abduction and persistent nest state PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
