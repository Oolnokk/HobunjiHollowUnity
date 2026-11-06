'use strict';
// Uses real authored TzatzulFlightRuntime source with a fake wildlife world,
// not duplicated flight logic. Run: node scripts/test-tzatzul-flight-runtime.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const file=path=>fs.readFileSync(path,'utf8');
const native=new Map(); // Registered actual cliff ledges, keyed by area.
const supports={
  point:(id,x,y,worldY)=>({id,dimension:0,x,y,worldY}),
  line:(id,start,end)=>({id,dimension:1,start,end}),
  register(area,p){if(!native.has(area))native.set(area,new Map());native.get(area).set(p.id,p);return true;},
  unregister(area,id){return native.get(area)?.delete(id)||false;},
  attach(c,p,t=0){if(c.health<=0)return false;c.onPerch=p;c.branchT=t;c.x=p.dimension? p.start.x:p.x;c.y=p.dimension?p.start.y:p.y;c.branchSurfaceY=p.dimension?p.start.worldY:p.worldY;return true;},
  constrain(c){const p=c.onPerch;if(!p)return false;const t=Math.max(0,Math.min(1,c.branchT));if(p.dimension===1){c.x=p.start.x+(p.end.x-p.start.x)*t;c.y=p.start.y+(p.end.y-p.start.y)*t;c.branchSurfaceY=p.start.worldY+(p.end.worldY-p.start.worldY)*t;}return true;},
};
const zone='map_northern_cliffs'; // The real selected cliff biome.
const creatures=new Set(); // Shared hostiles Set from the production injection contract.
const companions=new Set(); // The same shared companion Set available to wildlife prey selection.
const player={x:128,y:128,health:100}; // Real Tzatzul prey type is the player.
const targetFoot = a => a?.onBranch ? a.branchSurfaceY : 0; // In test the world floor is at y=0, except for explicitly perched prey.
let hits=0; // Counts exact damage calls; a single swoop cannot hit repeatedly.
const w={PerchSupport:supports,__farmLog(){},
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
const loyalAnimal={creatureKey:'gar-wolf',health:45,areaId:zone,x:bird.x+8,y:bird.y+8,isCompanion:true}; // A player-owned wolf can be prey, not ignored for being outside the hostile collection.
companions.add(loyalAnimal);
const originalPlayerX=player.x,originalPlayerY=player.y;
player.x=50000;player.y=50000;
assert.strictEqual(w.TzatzulFlightRuntime.__test.choosePrey(bird),loyalAnimal,
  'a Tzatzul can select a nearby companion using the real shared animal target logic');
player.x=originalPlayerX;player.y=originalPlayerY;
companions.delete(loyalAnimal);
assert.equal(bird.onPerch.dimension,0,'bird rests on registered zero-dimensional rock support');
assert(bird.tzatzulIdentity.tintHex,'bird holds a unique palette key for live visuals');
for(let i=0;i<80;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().swoops>0,'nearby player provokes an actual flight');
assert(bird.onPerch.dimension===1||bird._tzFlight.phase==='perched','flight uses 1D elevated support');
for(let i=0;i<160;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().flights>0);
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
const initialKeyCount=w.TzatzulFlightRuntime.debugSnapshot().populationKeys;
bird.health=0;w.TzatzulFlightRuntime.update(.1);
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
