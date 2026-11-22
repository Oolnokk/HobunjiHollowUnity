'use strict';
// Uses real authored TzatzulFlightRuntime source with a fake wildlife world,
// not duplicated flight logic. Run: node scripts/test-tzatzul-flight-runtime.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const file=path=>fs.readFileSync(path,'utf8');
const native=new Map(); // Registered actual cliff ledges, keyed by area.
const drops=[]; // Verify a killed flying carrier releases its original victim at the actual midair position.
const flightEndpoints=[]; // Records actual generated flight legs to catch out-of-grid scout destinations.
const supports={
  point:(id,x,y,worldY)=>({id,dimension:0,x,y,worldY}),
  line:(id,start,end)=>{flightEndpoints.push(end);return {id,dimension:1,start,end};},
  register(area,p){if(!native.has(area))native.set(area,new Map());native.get(area).set(p.id,p);return true;},
  unregister(area,id){return native.get(area)?.delete(id)||false;},
  attach(c,p,t=0){if(c.health<=0)return false;c.onPerch=p;c.branchT=t;c.x=p.dimension? p.start.x:p.x;c.y=p.dimension?p.start.y:p.y;c.branchSurfaceY=p.dimension?p.start.worldY:p.worldY;return true;},
  constrain(c){const p=c.onPerch;if(!p)return false;const t=Math.max(0,Math.min(1,c.branchT));if(p.dimension===1){c.x=p.start.x+(p.end.x-p.start.x)*t;c.y=p.start.y+(p.end.y-p.start.y)*t;c.branchSurfaceY=p.start.worldY+(p.end.worldY-p.start.worldY)*t;}return true;},
  forget(c){if(!c.onPerch)return false;c.onPerch=null;return true;},
  release(c,reason){if(!c.onPerch)return null;drops.push({c,reason,x:c.x,y:c.y});c.onPerch=null;return {fell:true};},
};
const zone='map_northern_cliffs'; // The real selected cliff biome.
const creatures=new Set(); // Shared hostiles Set from the production injection contract.
const companions=new Set(); // The same shared companion Set available to wildlife prey selection.
const player={x:128,y:128,health:100}; // Real Tzatzul prey type is the player.
const targetFoot = a => a?.onBranch ? a.branchSurfaceY : 0; // In test the world floor is at y=0, except for explicitly perched prey.
let hits=0; // Counts exact damage calls; a single swoop cannot hit repeatedly.
const w={PerchSupport:supports,__farmLog(){},
  CliffRouteNetwork:{forArea:()=>({cols:48,rows:48})}, // Real route graphs expose the active grid dimensions used by scouting bounds.
  RangedWeapons: { actorHitbox(actor) {
    const width = actor.creatureKey === 'tzatzul' ? 2.2 : .72; // Mimics the canonical 3D actorHitbox width/height contract.
    const height = actor.creatureKey === 'tzatzul' ? 2.2 : 1.16;
    const x = actor.x/64, z = actor.y/64, floor = targetFoot(actor);
    return { width, depth: width, height, center: {x,y:floor+height/2,z},
      box:{min:{x:x-width/2,y:floor,z:z-width/2},max:{x:x+width/2,y:floor+height,z:z+width/2}} };
  } },
  TzatzulRegistration:{identityFor:(a,i)=>({id:a+':'+i,tintHex:'#bb7777'})},
  TzatzulLiveVisuals:{release(){}},
  TzatzulCliffSites:{ensure:(area)=>area===zone?[
    {id:'tzatzul:roost:a', support:{id:'tzatzul:roost:a',dimension:0,x:128,y:128,worldY:6}},
    {id:'tzatzul:roost:b', support:{id:'tzatzul:roost:b',dimension:0,x:2240,y:128,worldY:7}},
  ].map(r=>{supports.register(area,r.support);return r;}):[],releaseInactive(){}},
  Combat:{deps:{damagePlayer(damage){hits++;player.health-=damage;}}},
};
vm.runInNewContext(file('docs/js/attack-readiness.js'),{window:w,Map,console});
vm.runInNewContext(file('docs/js/flying-combat-orbit.js'),{window:w,Math,console});
vm.runInNewContext(file('docs/js/tzatzul-flight-runtime.js'),{window:w,Math,Date,Set,Map,console});
const deps={TILE:64,player,hostileObjects:creatures,companionObjects:companions,getCurrentArea:()=>zone,worldSurfaceY:()=>0,
  makeCreatureEntity:(creatureKey,x,y,opts)=>({creatureKey,x,y,areaId:zone,
    health:100,maxHealth:100,def:{attackDamage:24},...opts})};
assert(w.TzatzulFlightRuntime.init(deps));
assert.equal(w.TzatzulFlightRuntime.ensureZone(zone),2,'one visible mother per distant high cliff roost');
assert.equal(w.TzatzulFlightRuntime.owns([...creatures][0]),true,'flight module owns simulated Tzatzul movement');
assert.equal(w.TzatzulFlightRuntime.owns({ creatureKey:'tzatzul' }),false,'unregistered dev-spawned animals retain regular movement');
const game = file('docs/game.js'); // Verify the authoritative hostile renderer delegates motion rather than starting a second AI owner.
assert.match(game,/if \(window\.TzatzulFlightRuntime\?\.owns\?\.\(c\)\) \{[\s\S]{0,320}updateWildlifeVisualLod\(c, distanceTiles\)/);
assert.match(game,/updateCreatureAnimFrame\(c, dt, c\._tzFlight\?\.phase !== 'perched'\);\s*continue;/);
assert.match(file('docs/js/wildlife-visual-lod.js'),/c\.tzatzulCarrying/,
  'far-wing visibility is retained while prey is carried');
assert.equal(w.TzatzulFlightRuntime.ensureZone(zone),0,'repeated checks cannot duplicate mothers');
assert.equal(native.get(zone).size,2,'two bird-only spire points are registered');
assert(file('docs/js/tzatzul-cliff-sites.js').includes('s?.base?.footprint?.length'),
  'only actual cliff geometry can anchor an independent spire');
assert(file('docs/js/tzatzul-flight-runtime.js').includes('TzatzulCliffSites?.ensure'),
  'birds use the non-climbable spire builder rather than accessible mini-cliff caps');
assert.equal(w.TzatzulFlightRuntime.ensureZone('map_southern_cloud_forest'),0);
const bird=[...creatures][0];
const loyalAnimal={creatureKey:'gar-wolf',health:45,areaId:zone,x:bird.x+8,y:bird.y+8,isCompanion:true}; // Companions are explicitly excluded from the hatchling food roster.
companions.add(loyalAnimal);
const originalPlayerX=player.x,originalPlayerY=player.y;
player.x=50000;player.y=50000;
assert.strictEqual(w.TzatzulFlightRuntime.__test.choosePrey(bird),null,
  'Tzatzuls ignore animal companions and wildlife when provisioning hatchlings');
player.x=originalPlayerX;player.y=originalPlayerY;
companions.delete(loyalAnimal);
assert.equal(bird.onPerch.dimension,0,'bird rests on registered zero-dimensional rock support');
assert(bird.tzatzulIdentity.tintHex,'bird holds a unique palette key for live visuals');
for(let i=0;i<80;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().scouts>0,'a Tzatzul actively scouts when no suitable prey is nearby');
assert(bird.onPerch.dimension===1||bird._tzFlight.phase==='perched','flight uses 1D elevated support');
for(let i=0;i<160;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().flights>0);
assert(flightEndpoints.length>0 && flightEndpoints.every(end =>
  end.x>=2*64 && end.x<=46*64 && end.y>=2*64 && end.y<=46*64),
  'every generated scouting leg stays inside the real cliff grid even near map edges');
const bandit={creatureKey:'bandit',isBandit:true,health:100,areaId:zone,x:bird.x+7*64,y:bird.y}; // Shared hostile roster is the authoritative source of raiders.
creatures.add(bandit);
assert.strictEqual(w.TzatzulFlightRuntime.__test.choosePrey(bird),bandit,'bandits count as hatchling food');
const barbarian={creatureKey:'porakaneki',isTribeHunter:true,health:100,areaId:zone,x:bird.x+64,y:bird.y}; // Tribe hunters share the bandit combat entity pipeline.
creatures.add(barbarian);
assert.strictEqual(w.TzatzulFlightRuntime.__test.choosePrey(bird),barbarian,'barbarian hunters count as food');
creatures.delete(bandit); creatures.delete(barbarian);
assert(hits<=w.TzatzulFlightRuntime.debugSnapshot().swoops,'at most one damage transaction per swoop');
const farBird=[...creatures][1]; // Distinct mother used to test long dives at the actual contact point.
player.x=farBird.x-64*9;player.y=farBird.y;
const beforeContact=hits;
assert(w.TzatzulFlightRuntime.__test.swoop(farBird,player));
assert(farBird.tzatzulDivePitchRad<0,'bird angles downward headfirst as it begins the dive');
for(let i=0;i<60&&farBird._tzFlight.phase==='swoop';i++)w.TzatzulFlightRuntime.update(.1);
assert.equal(hits,beforeContact+1,'stationary prey nine tiles away is hit by the swept torso');
assert.equal(w.TzatzulFlightRuntime.debugSnapshot().lastBodyContact.collider,'body',
  'body, rather than talon or a timed attack, is the recorded damaging collider');
// A dive/scouting line must rise above a real plateau before crossing its horizontal footprint.
const previousSurface = deps.worldSurfaceY;
deps.worldSurfaceY = (x, y) => x >= 1400 && x <= 1750 ? 9 : 0;
const plateauLeg = { from:{x:1100,y:900,worldY:4},to:{x:2050,y:900,worldY:4},mode:'search' };
plateauLeg.terrain = w.TzatzulFlightRuntime.__test.terrainFlightProfile(plateauLeg.from,plateauLeg.to,{y:.5});
assert(plateauLeg.terrain.samples.some(height=>height===9),'planner samples high terrain between endpoints');
const safeHeights = plateauLeg.terrain.level;
for(let i=1;i<safeHeights.length;i++) {
  assert(Math.abs(safeHeights[i]-safeHeights[i-1])<=plateauLeg.terrain.heightDeltaPerStep+1e-6,
    'cliff clearance climbs and descends continuously rather than snapping to a future plateau top');
}
assert(w.TzatzulFlightRuntime.__test.flightHeightAt(plateauLeg,.45)>9.5,'flight body clears the high plateau');
assert(w.TzatzulFlightRuntime.__test.flightHeightAt({...plateauLeg,mode:'swoop'},.45)>9,'dives also clear plateau walls');
assert.equal(w.TzatzulFlightRuntime.__test.flightHeightAt({...plateauLeg,mode:'swoop'},1),4,'a body dive still reaches a clear ground-level target');
deps.worldSurfaceY = previousSurface;
const beforeDodge=hits;
farBird.x=2240;farBird.y=128;farBird.branchSurfaceY=7;
player.x=farBird.x-64*9;player.y=farBird.y;
assert(w.TzatzulFlightRuntime.__test.swoop(farBird,player));
player.y+=64*3; // Dodge sideways; stepping toward the bird along the attack path would still collide.
for(let i=0;i<60&&farBird._tzFlight.phase==='swoop';i++)w.TzatzulFlightRuntime.update(.1);
assert.equal(hits,beforeDodge,'three-tile lateral dodge avoids the entire swept body');
const beforeElevationDodge=hits;
farBird.x=2240;farBird.y=128;farBird.branchSurfaceY=7;
player.x=farBird.x-64*9;player.y=farBird.y; player.onBranch=null;
assert(w.TzatzulFlightRuntime.__test.swoop(farBird,player));
player.onBranch={};player.branchSurfaceY=6; // Dodge upward after attack commits: 2D proximity alone is not a 3D hit.
for(let i=0;i<60&&farBird._tzFlight.phase==='swoop';i++)w.TzatzulFlightRuntime.update(.1);
assert.equal(hits,beforeElevationDodge,'elevated target cannot be hit by a body diving to ground level');
player.onBranch=null;player.branchSurfaceY=0;
player.x=originalPlayerX;player.y=originalPlayerY;
// Capture uses the ORIGINAL live prey and its native elevated perch; no replacement corpse or cloned rig.
const carryPrey={creatureKey:'gar-wolf',health:40,areaId:zone,x:farBird.x,y:farBird.y,state:'patrol',
  avatarRef:{group:{quaternion:{angle:.41}}}}; // The grounded animal keeps the native rotation before talon-payload alignment.
assert(w.TzatzulFlightRuntime.__test.capture(farBird,carryPrey),'live animal is captured by the swooping bird');
assert.strictEqual(farBird._tzFlight.captive,carryPrey,'bird retains original prey object');
assert.equal(w.TzatzulFlightRuntime.carrierOf(carryPrey), farBird);
assert(w.TzatzulFlightRuntime.hasCaptives());
const activeCaptives = []; // The render hook uses the same live capture records as the gameplay owner.
w.TzatzulFlightRuntime.forEachCaptive((prey, carrier) => activeCaptives.push([prey, carrier]));
assert.deepEqual(activeCaptives, [[carryPrey, farBird]]);
assert.equal(farBird.tzatzulCarrying,true,'gripping art is selected');
assert.equal(carryPrey.tzatzulCapturedBy,farBird._tzFlight.identity.id,'prey is marked against double targeting');
assert(w.TzatzulFlightRuntime.__test.carryCaptive(farBird),'prey follows the native elevated flight support');
assert.strictEqual(carryPrey.onPerch,farBird.onPerch,'same support carries prey through 3D flight');
carryPrey.avatarRef.group.quaternion.angle=-1.5; // A native animation advances while the gameplay actor is airborne.
assert(w.TzatzulFlightRuntime.__test.releaseCaptive(carryPrey,'returned to roost'),'arrival safely releases surviving prey');
assert.equal(carryPrey.avatarRef.group.quaternion.angle,-1.5,'gameplay release preserves the current native rig pose');
assert.equal(w.TzatzulFlightRuntime.carrierOf(carryPrey), null, 'release removes the only source of carry presentation');
assert.equal(carryPrey.state,'patrol','native animal AI state restored');
assert.equal(carryPrey.tzatzulCapturedBy,null,'no stale capture owner');
assert.equal(farBird.tzatzulCarrying,false,'gripping pose cleared');
assert.equal(w.TzatzulFlightRuntime.__test.releaseCaptive(carryPrey,'duplicate'),false,'release is idempotent');
assert.equal(w.TzatzulFlightRuntime.debugSnapshot().captures,1,'mobile capture census counts only one event');
// Regression: an NPC grabbed in the middle of a bandit-vs-tribe fight must relinquish ALL ground movement owners.
const cancellations={ dodge:0, lunge:0, swing:0, ranged:0, impact:0 }; // Counts the actual subsystem handoffs on the live captive.
w.EnemyDodge={cancel(c){c._enemyDodgePending=null;c.dodging=false;cancellations.dodge++;}};
w.BanditCombat={cancelLunge(c){c._banditLunging=false;cancellations.lunge++;},finishAction(c){c._banditAction=null;cancellations.swing++;}};
w.RangedWeapons.cancelBanditAction=c=>{c._rangedAction=null;cancellations.ranged++;};
w.KnockbackCollisionImpact={cancel(){cancellations.impact++;}};
const liftedBandit={creatureKey:'bandit',isBandit:true,health:40,areaId:zone,
  x:farBird.x+64,y:farBird.y,state:'chase',knockbackT:.6,knockbackVX:120,knockbackVY:-30,
  vx:80,vy:-40,dodging:true,_enemyDodgePending:{remainingS:.2},_banditLunging:true,
  _rangedAction:{kind:'fire'}}; // Existing hostile, not a copied carry proxy.
const activeStaged = new Set(); // Models Combat-core's persistent action registry, not merely a boolean on the actor.
const stagedBanditAction = {
  cancelled:false,
  cancel() {
    if (this.cancelled) return;
    this.cancelled=true;
    activeStaged.delete(this); // The engine removes the cancelled strike before its next frame update.
    w.BanditCombat.finishAction(liftedBandit); // onCancel completes authored bandit pose cleanup.
  },
}; // A real staged strike has a cancel method and lives independently from the actor.
activeStaged.add(stagedBanditAction);
liftedBandit._banditAction=stagedBanditAction;
const liftStartX=liftedBandit.x; // Simulates the former duel's ground position trying to reassert itself midflight.
assert(w.TzatzulFlightRuntime.__test.capture(farBird,liftedBandit));
assert.equal(activeStaged.size,0,'capture must remove a pending strike from Combat-core, not only mark it cancelled');
assert.deepEqual(cancellations,{dodge:1,lunge:1,swing:1,ranged:1,impact:1},
  'capture cancels pending dodge, lunge, swing, ranged shot and collision impulse');
assert.equal(liftedBandit.knockbackT,0,'damage from the initiating swoop cannot continue to move the captive');
assert.equal(liftedBandit.knockbackVX,0);
assert.equal(liftedBandit.knockbackVY,0);
assert.equal(liftedBandit.vx,0);
assert.equal(liftedBandit.vy,0);
assert.equal(liftedBandit.state,'tzatzul-carried');
liftedBandit.x=liftStartX; liftedBandit.state='chase'; liftedBandit.prone=true; liftedBandit.knockbackT=.5;
assert(w.TzatzulFlightRuntime.__test.carryCaptive(farBird),'carrier reasserts its support after a stale ground-combat write');
assert.strictEqual(liftedBandit.onPerch,farBird.onPerch);
assert.notEqual(liftedBandit.x,liftStartX,'a combatant cannot drag the captive back to its former duel position');
assert.equal(liftedBandit.state,'tzatzul-carried');
assert.equal(liftedBandit.prone,false);
assert.equal(liftedBandit.knockbackT,0);
assert.equal(w.TzatzulFlightRuntime.carrierOf(liftedBandit),farBird);
assert(w.TzatzulFlightRuntime.__test.releaseCaptive(liftedBandit,'returned to roost'));
assert.equal(liftedBandit.state,'chase','a surviving released bandit returns to its prior AI state');

const pronePrey = { creatureKey: 'bandit', isBandit: true, health: 90, areaId: zone, x: farBird.x, y: farBird.y, state: 'chase' }; // Reuses the real carrier and keeps an original live actor.
assert(w.TzatzulFlightRuntime.__test.capture(farBird, pronePrey));
assert(w.TzatzulFlightRuntime.__test.carryCaptive(farBird));
const proneFlightPoint = { x: pronePrey.x, y: pronePrey.y, height: pronePrey.branchSurfaceY }; // The game fall owner snapshots this before calling releaseProneCaptive.
const perchInjuriesBefore = drops.length;
assert(w.TzatzulFlightRuntime.releaseProneCaptive(pronePrey), 'a prone captive is released without a second fixed perch injury');
assert.equal(pronePrey.x, proneFlightPoint.x, 'prone release retains the actual flight position rather than teleporting to pickup');
assert.equal(pronePrey.y, proneFlightPoint.y);
assert(proneFlightPoint.height > 0, 'a genuine elevated flight has a height for the later cliff resolver');
assert.equal(pronePrey.tzatzulCapturedBy, null);
assert.equal(pronePrey.onBranch, null, 'talon attachment is gone before prone falling physics');
assert.equal(drops.length, perchInjuriesBefore, 'deferred prone drop does not charge the old instantaneous perch collision');
assert.equal(farBird._tzFlight.captive, null, 'the bird cannot drag the falling actor back into its nest');
assert.equal(w.TzatzulFlightRuntime.releaseProneCaptive(pronePrey), false, 'the captive release remains idempotent');
const dyingPrey={creatureKey:'gar-wolf',health:10,areaId:zone,x:farBird.x,y:farBird.y,state:'chase'};
assert(w.TzatzulFlightRuntime.__test.capture(farBird,dyingPrey));
dyingPrey.health=0;dyingPrey.state='dying';
assert.equal(w.TzatzulFlightRuntime.__test.carryCaptive(farBird),false,'dead prey cannot remain attached to a living bird');
assert.equal(farBird._tzFlight.captive,null,'death cleanup clears the bird owner');
assert.equal(dyingPrey.state,'dying','capture cleanup must preserve the canonical death transition');
assert.equal(dyingPrey.tzatzulCapturedBy,null,'death cleanup clears the prey owner');
assert.equal(w.TzatzulFlightRuntime.__test.capture(farBird,player),false,'player capture waits for playable nest encounter');
const oversized={creatureKey:'nazgraku',health:200,def:{defaultSizeClass:'large'},
  areaId:zone,x:farBird.x,y:farBird.y};
assert.equal(w.TzatzulFlightRuntime.__test.capture(farBird,oversized),false,
  'a large animal can be attacked but is too heavy for Tzatzul talons');
const firstCaptive={creatureKey:'gar-wolf',health:10,areaId:zone,state:'patrol'};
const secondCaptive={creatureKey:'bandit',health:20,areaId:zone,state:'patrol'};
assert(w.TzatzulFlightRuntime.__test.capture(farBird,firstCaptive));
assert.equal(w.TzatzulFlightRuntime.__test.capture(farBird,secondCaptive),false,
  'one bird cannot replace a captive while the first remains suspended');
assert.strictEqual(farBird._tzFlight.captive,firstCaptive);
assert(w.TzatzulFlightRuntime.__test.releaseCaptive(firstCaptive,'test'));
const originalAttach=supports.attach;
supports.attach=function(actor,point,t){ // Simulate a destroyed physical roost while line flight remains valid.
  if(actor===farBird && point.dimension===0) return false;
  return originalAttach(actor,point,t);
};
assert(w.TzatzulFlightRuntime.__test.capture(farBird,secondCaptive));
farBird._tzFlight.fallbackFoe=player;player.health=100; // A living, established combat opponent must be circled when the original perch is gone.
assert(w.TzatzulFlightRuntime.__test.returnHome(farBird));
for(let i=0;i<80&&farBird._tzFlight.phase==='return';i++)w.TzatzulFlightRuntime.update(.1);
assert.equal(farBird._tzFlight.phase,'orbit','an unperchable flying enemy circles its foe instead of waiting indefinitely');
assert.equal(farBird._tzFlight.captive,null,'lost roost releases surviving prey without an invisible cave');
assert.equal(secondCaptive.tzatzulCapturedBy,null,'lost roost clears captive ownership');
const orbitLeg=farBird._tzFlight.segment; // The real flight line, not an independently teleported steering position.
assert(orbitLeg&&Math.hypot(orbitLeg.to.x-player.x,orbitLeg.to.y-player.y)/64<=5.01,
  'first evasive chord stays close to the current foe');
const orbitBefore=w.TzatzulFlightRuntime.debugSnapshot().orbits;
for(let i=0;i<50;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().orbits>orbitBefore,
  'unavailable perch produces successive ring arcs, not a one-time sidestep');
let recoveredRoost=false; // Confirms a rebuilt physical perch is reoccupied after real flight, without teleportation.
supports.attach=function(actor,point,t){if(actor===farBird&&point.dimension===0)recoveredRoost=true;return originalAttach(actor,point,t);};
w.TzatzulFlightRuntime.ensureZone(zone);
for(let i=0;i<100&&!recoveredRoost;i++)w.TzatzulFlightRuntime.update(.1);
assert(recoveredRoost,'the physical perch takes precedence again as soon as it can be reached');
supports.attach=originalAttach;
const recoveredPoint=farBird._tzFlight.roost; // Keep the real spire intact while testing a genuinely removed perch record.
farBird._tzFlight.roost=null;farBird._tzFlight.fallbackFoe=player;
assert(w.TzatzulFlightRuntime.__test.returnHome(farBird),'a missing roost record starts combat circling immediately');
assert.equal(farBird._tzFlight.phase,'orbit','null perch cannot leave the old swoop state running with no segment');
assert(farBird._tzFlight.segment,'no-perch orbit still owns an ordinary flight support');
farBird._tzFlight.roost=recoveredPoint;
let landedOnRealRoost=false; // Arrival must use the real point even if the healthy mother immediately starts another hunt.
supports.attach=function(actor,point,t) {
  if(actor===farBird&&point.dimension===0)landedOnRealRoost=true;
  return originalAttach(actor,point,t);
};
assert(w.TzatzulFlightRuntime.__test.returnHome(farBird));
for(let i=0;i<80&&!landedOnRealRoost;i++)w.TzatzulFlightRuntime.update(.1);
assert(landedOnRealRoost,'recovering a physical perch safely ends the missing-roost fallback');
supports.attach=originalAttach;
const blockedMother={x:320,y:128,branchSurfaceY:5,onPerch:{dimension:1},health:100,areaId:zone,
  _tzNestMother:true,def:{modelWidth:1.3},_tzFlight:{identity:{id:'blocked-mother'},roost:null,
    phase:'return',segment:null,fallbackFoe:player,orbitDirection:1,orbitLegs:0}};
w.TzatzulNestEncounter={clearAirPath:()=>false}; // Mimic a fully obstructed nest flight ring; no wall tunnelling is acceptable.
assert.equal(w.TzatzulFlightRuntime.__test.returnHome(blockedMother),false);
assert.equal(blockedMother._tzFlight.phase,'await-roost','fully blocked orbit waits instead of repeatedly spawning illegal paths');
for(let i=0;i<8;i++)w.TzatzulFlightRuntime.advanceNestFlight(blockedMother,.1);
assert.equal(blockedMother._tzFlight.phase,'await-roost','blocked circular geometry cannot force an unsafe route');
w.TzatzulNestEncounter.clearAirPath=()=>true; // A later opening must eventually permit normal combat circling.
for(let i=0;i<8&&blockedMother._tzFlight.phase!=='orbit';i++)
  w.TzatzulFlightRuntime.advanceNestFlight(blockedMother,.1);
assert.equal(blockedMother._tzFlight.phase,'orbit','indoor mother retries after obstructions clear instead of idling permanently');
assert(blockedMother._tzFlight.segment,'retry creates a real elevated flight leg');
blockedMother._tzFlight.orbitLegs=3; // This accepted orbit is the final evasive chord before the next normal attack.
for(let i=0;i<20&&blockedMother._tzFlight.phase==='orbit';i++)
  w.TzatzulFlightRuntime.advanceNestFlight(blockedMother,.1);
assert.equal(blockedMother._tzFlight.phase,'swoop',
  'the nest mother resumes a real body-first attack between no-perch circles');
assert(blockedMother._tzFlight.segment?.mode==='swoop','orbit combat reuses the existing flight/collision attack leg');
delete w.TzatzulNestEncounter;
// The generic readiness registry guards only the chosen player, not unrelated prey or combat.
player.health=100;player.tzatzulCapturedBy=null;
w.Fishing={state:{phase:'cast'}}; // The initial bait throw is protected before the ring appears.
assert.equal(w.AttackReadiness.activityFor(player),'fishing');
assert(w.AttackReadiness.shouldReady(farBird,player,player),'a fishing player is a readying target');
assert.equal(w.AttackReadiness.shouldReady(farBird,secondCaptive,player),false,
  'bandit prey is never given player-only QoL protection');
w.Fishing.state=null;
w.ChestLockpicking={isActive:()=>true};
assert.equal(w.AttackReadiness.activityFor(player),'lockpicking','the saved lock session is protected');
w.ChestLockpicking.isActive=()=>false;
w.MusicMinigame={state:{instrumentMode:'puzzle'}};
assert.equal(w.AttackReadiness.activityFor(player),'instrument','hosted music puzzle is protected');
w.MusicMinigame.state=null;
w.PuzzleCaveEntrances={isPlayerSolvingMelody:()=>true};
assert.equal(w.AttackReadiness.activityFor(player),'exterior-melody','standing on a timed exterior melody plate is protected');
w.PuzzleCaveEntrances.isPlayerSolvingMelody=()=>false;
let otherActivity=true; // Demonstrates future activities can opt into readying without editing Tzatzul or combat.
const unregisterOther=w.AttackReadiness.registerActivity('other-activity',()=>otherActivity);
assert.equal(w.AttackReadiness.activityFor(player),'other-activity');
otherActivity=false;assert.equal(w.AttackReadiness.activityFor(player),null);
unregisterOther();
const loaderHtml=file('docs/index.html');
assert(loaderHtml.indexOf('attack-readiness.js')>0&&loaderHtml.indexOf('attack-readiness.js')<loaderHtml.indexOf('tzatzul-flight-runtime.js'),
  'readiness policy is loaded before the flight consumer');
assert.match(file('docs/js/puzzle-cave-entrances.js'),/isPlayerSolvingMelody/,
  'the live exterior plate has a dedicated narrow activity predicate');
assert.match(file('docs/js/wildlife-debug-panel.js'),/bird\.readyingActivity/,
  'the mobile wildlife census exposes the actual reason a bird is circling');

// Perched outdoor hunters start a real sky orbit, never a damaging strike, until the player finishes.
assert(supports.attach(farBird,recoveredPoint));
farBird._tzFlight.phase='perched';farBird._tzFlight.segment=null;farBird._tzFlight.retreating=false;
farBird._tzFlight.readyingReleaseArmed=false;
player.x=farBird.x-4*64;player.y=farBird.y;
w.Fishing.state={phase:'active'};
const oldSite=farBird.tzatzulNestMapId; // Real player hunting requires an authored cave and a native entry owner.
farBird.tzatzulNestMapId='test-nest';
w.TzatzulNestInterior={isNestMap:id=>id==='test-nest'};
deps.enterBuilding=()=>{};
assert.strictEqual(w.TzatzulFlightRuntime.__test.choosePrey(farBird),player,
  'normal Tzatzul prey selection identifies the player when a valid nest is available');
const hitsBeforeReady=hits;
assert(w.TzatzulFlightRuntime.__test.seekFood(farBird),
  'the natural hunter decision starts a readying orbit rather than requiring a direct test-only swoop call');
farBird.tzatzulNestMapId=oldSite;delete w.TzatzulNestInterior;delete deps.enterBuilding;
assert.equal(farBird._tzFlight.phase,'readying','a Tzatzul circles above an occupied player instead of diving');
assert(farBird._tzFlight.segment?.to.worldY>=3,'the readying chord stays high above the player');
for(let i=0;i<60;i++) {
  w.TzatzulFlightRuntime.update(.1);
  assert.notEqual(farBird._tzFlight.phase,'swoop','occupied player cannot be grabbed by a new dive');
}
assert.equal(hits,hitsBeforeReady,'readying orbits cannot damage the player through body collision');
assert(w.TzatzulFlightRuntime.debugSnapshot().readiedLegs>0,'mobile debug records staging activity');
assert.equal(farBird._tzFlight.readyingActivity,'fishing','mobile diagnostics explain why the bird is waiting');
w.Fishing.state=null;
let sawReleaseChord=false,sawResumeDive=false; // A short post-interaction orbit provides a visible warning before the next real attack.
for(let i=0;i<80;i++) {
  w.TzatzulFlightRuntime.update(.1);
  if(farBird._tzFlight.phase==='readying'&&farBird._tzFlight.readyingWarning) {
    sawReleaseChord=true;
    assert.equal(w.TzatzulFlightRuntime.debugSnapshot().birds
      .find(b=>b.id===farBird._tzFlight.identity.id)?.releaseChord,true,
      'the in-game wildlife panel identifies the final warning DURING that chord');
  }
  if(farBird._tzFlight.phase==='swoop'){sawResumeDive=true;break;}
}
assert(sawReleaseChord,'finishing an activity adds one final warning orbit');
assert.equal(farBird._tzFlight.readyingWarning,false,'the warning flag clears when the real attack resumes');
assert.equal(w.TzatzulFlightRuntime.debugSnapshot().birds.find(b=>b.id===farBird._tzFlight.identity.id)?.releaseChord,
  farBird._tzFlight.readyingWarning,'mobile release status reflects the actual warning chord');
assert(sawResumeDive,'the predator eventually resumes its genuine swept-body swoop');
assert(supports.attach(farBird,recoveredPoint));
farBird._tzFlight.phase='perched';farBird._tzFlight.segment=null;
player.x=farBird.x-4*64;player.y=farBird.y;
assert(w.TzatzulFlightRuntime.__test.swoop(farBird,player),'normal combat remains possible outside protected activity');
w.Fishing.state={phase:'bite'};
w.TzatzulFlightRuntime.update(.1);
assert.equal(farBird._tzFlight.phase,'readying','a minigame starting mid-dive reroutes the still-airborne bird');
assert.equal(hits,hitsBeforeReady,'aborted committed dive never collides during the activity');
const oldNestMap=farBird.tzatzulNestMapId; // A playable nest validates the capture boundary instead of relying on a missing transition.
farBird.tzatzulNestMapId='test-nest';
w.TzatzulNestInterior={isNestMap:id=>id==='test-nest'};
deps.enterBuilding=()=>{};
farBird._tzFlight.readyingReleaseArmed=false; // Exercise the live activity guard independently of the warning-chord grace.
assert.equal(w.TzatzulFlightRuntime.__test.capture(farBird,player),false,
  'even a direct late talon capture is rejected during protected player activity');
farBird._tzFlight.readyingReleaseArmed=true;
farBird.tzatzulNestMapId=oldNestMap;delete w.TzatzulNestInterior;delete deps.enterBuilding;
w.Fishing.state=null;

// If a cave wall or unavailable line-support prevents a new orbit during a dive,
// the previously committed body path must finish harmlessly and enter safe recovery.
assert(supports.attach(farBird,recoveredPoint));
farBird._tzFlight.phase='perched';farBird._tzFlight.segment=null;
farBird._tzFlight.readyingReleaseArmed=false;farBird._tzFlight.readyingWarning=false;
player.x=farBird.x-4*64;player.y=farBird.y;
assert(w.TzatzulFlightRuntime.__test.swoop(farBird,player));
const beforeBlockedReady=hits;
const unblockedAttach=supports.attach; // The flight test intentionally rejects newly planned supports, not the existing committed line.
supports.attach=function(actor,support,t) {
  return actor===farBird&&support?.dimension===1 ? false : unblockedAttach(actor,support,t);
};
w.Fishing.state={phase:'waiting'};
for(let i=0;i<35;i++)w.TzatzulFlightRuntime.update(.1);
assert.equal(hits,beforeBlockedReady,'blocked orbit cannot cause a real body hit during fishing');
assert.equal(farBird._tzFlight.phase,'await-roost',
  'if no safe circling or return leg exists, the interrupted swoop does not immediately renew its attack');
supports.attach=unblockedAttach;w.Fishing.state=null;
for(let i=0;i<8;i++)w.TzatzulFlightRuntime.update(.1);
assert.equal(hits,beforeBlockedReady,'restoring a safe flight support does not retroactively hit the player');
assert(['orbit','readying','return','await-roost'].includes(farBird._tzFlight.phase),
  'the bird recovers through aerial locomotion rather than a surprise new attack');

const dropPrey={creatureKey:'bandit',isBandit:true,health:50,areaId:zone,x:farBird.x-64*2,y:farBird.y,state:'patrol'}; // Actual humanoid captive for companion rescue behavior.
farBird.health=100;farBird.maxHealth=100;farBird._tzFlight.phase='perched';farBird._tzFlight.retreating=false;farBird._tzFlight.rest=100;
assert(supports.attach(farBird,farBird._tzFlight.roost));
assert(w.TzatzulFlightRuntime.__test.capture(farBird,dropPrey),'a healthy parent carries bandit prey');
farBird.health=70; // A single modest hit is not enough to drive off this mother.
w.TzatzulFlightRuntime.update(.1);
assert.strictEqual(farBird._tzFlight.captive,dropPrey,'minor combat injury does not release prey');
assert.equal(w.TzatzulFlightRuntime.resistsCarryKnockback(farBird),true,'routine knockback cannot eject an active carrier');
farBird.health=29; // The existing thirty-percent wildlife escape threshold is now reached.
w.TzatzulFlightRuntime.update(.1);
assert.equal(farBird._tzFlight.captive,null,'threshold damage triggers prey release and real flee');
assert.equal(dropPrey.tzatzulCapturedBy,null,'flee clears original live prey capture state');
assert.equal(dropPrey.state,'patrol','flee restores the original bandit behavior');
assert.equal(w.TzatzulFlightRuntime.debugSnapshot().fleeDrops,1,'mobile debug counts threshold-triggered rescue drops');

assert.match(file('docs/js/wildlife-visual-lod.js'),/c\.tzatzulCapturedBy/,
  'captured wildlife bypass ordinary distance hiding while airborne');
player.x=originalPlayerX;player.y=originalPlayerY;
const initialKeyCount=w.TzatzulFlightRuntime.debugSnapshot().populationKeys;
assert(supports.attach(bird,bird._tzFlight.roost),'dying carrier starts above its physical spire');
const deathPrey={creatureKey:'bandit',isBandit:true,health:80,areaId:zone,
  x:bird.x+4*64,y:bird.y,state:'patrol'}; // A visible rider should fall where the Tzatzul actually dies, not teleport to the pickup.
const originalDropX=deathPrey.x; // Saved capture location is deliberately separated from the bird's flight position.
assert(w.TzatzulFlightRuntime.__test.capture(bird,deathPrey));
assert(w.TzatzulFlightRuntime.__test.carryCaptive(bird));
const actualDropX=deathPrey.x; // The carried actor now shares the raised flight support.
assert.notEqual(actualDropX,originalDropX,'capture moves prey away from its original pickup');
bird.health=0;w.TzatzulFlightRuntime.update(.1);
assert.equal(deathPrey.x,actualDropX,'death drops prey at its actual carried position');
assert.equal(drops.at(-1)?.c,deathPrey,'death invokes the canonical perch fall for the actual captive');
assert.equal(deathPrey.tzatzulCapturedBy,null,'the bird dying clears captured actor ownership');

assert.equal(w.TzatzulFlightRuntime.debugSnapshot().active,1);
assert.equal(w.TzatzulFlightRuntime.ensureZone(zone),0,'death does not immediately respawn');
w.TzatzulFlightRuntime.onDayAdvance();
assert.equal(w.TzatzulFlightRuntime.ensureZone(zone),1,'existing daily respawn boundary permits replacement only');
assert.equal(w.TzatzulFlightRuntime.debugSnapshot().populationKeys,initialKeyCount);
assert.match(file('docs/js/wildlife-spawn.js'),/TzatzulFlightRuntime\?\.update\?\.\(dt\)/,
  'simulation owned by the existing wilderness frame');
assert.match(file('docs/index.html'),/animal-shoulder-spline\.js\?v=[A-Za-z0-9_-]+/,
  'live rig loads the shoulder spline dependency before first mount');
assert.match(file('docs/js/wildlife-debug-panel.js'), /function renderTzatzulCensus\(/,
  'mobile wildlife developer tab displays flight activity and rig-loading errors');
console.log('Tzatzul real cliff roosts, bounded flight, swoops, and wildlife turnover PASS.');
