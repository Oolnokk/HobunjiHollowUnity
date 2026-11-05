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
const player={x:128,y:128,health:100}; // Real Tzatzul prey type is the player.
let hits=0; // Counts exact damage calls; a single swoop cannot hit repeatedly.
const w={PerchSupport:supports,__farmLog(){},
  TzatzulRegistration:{identityFor:(a,i)=>({id:a+':'+i,tintHex:'#bb7777'})},
  TzatzulLiveVisuals:{release(){}},
  CliffRouteNetwork:{forArea:id=>id===zone?{balconies:[
    {id:'a',x:2,z:2,y:6},{id:'b',x:35,z:2,y:7},{id:'bad',x:4,z:5,y:0}]}:null},
  Combat:{deps:{damagePlayer(damage){hits++;player.health-=damage;}}},
};
vm.runInNewContext(file('docs/js/tzatzul-flight-runtime.js'),{window:w,Math,Date,Set,Map,console});
const deps={TILE:64,player,hostileObjects:creatures,getCurrentArea:()=>zone,worldSurfaceY:()=>0,
  makeCreatureEntity:(creatureKey,x,y,opts)=>({creatureKey,x,y,areaId:zone,
    health:100,maxHealth:100,def:{attackDamage:24},...opts})};
assert(w.TzatzulFlightRuntime.init(deps));
assert.equal(w.TzatzulFlightRuntime.ensureZone(zone),2,'one visible mother per distant high cliff roost');
assert.equal(w.TzatzulFlightRuntime.ensureZone(zone),0,'repeated checks cannot duplicate mothers');
assert.equal(native.get(zone).size,2,'ground-level or empty ledges never receive imaginary perches');
assert.equal(w.TzatzulFlightRuntime.ensureZone('map_southern_cloud_forest'),0);
const bird=[...creatures][0];
assert.equal(bird.onPerch.dimension,0,'bird rests on registered zero-dimensional rock support');
assert(bird.tzatzulIdentity.tintHex,'bird holds a unique palette key for live visuals');
for(let i=0;i<80;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().swoops>0,'nearby player provokes an actual flight');
assert(bird.onPerch.dimension===1||bird._tzFlight.phase==='perched','flight uses 1D elevated support');
for(let i=0;i<160;i++)w.TzatzulFlightRuntime.update(.1);
assert(w.TzatzulFlightRuntime.debugSnapshot().flights>0);
assert(hits<=w.TzatzulFlightRuntime.debugSnapshot().swoops,'at most one damage transaction per swoop');
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
