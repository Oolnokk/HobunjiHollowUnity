'use strict';
// Node-only shared aerial orbit regression: tests the shipped geometry and its existing collision-owning integrations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8');
const window={}; // The real browser helper exposes only pure geometry and does not need a render loop.
vm.runInNewContext(read('docs/js/flying-combat-orbit.js'),{window,Math});
const orbit=window.FlyingCombatOrbit;
assert(orbit?.waypoint&&orbit?.tangent,'the game exports one shared aerial evasion planner');
const target={x:0,y:0}; // A stationary foe first proves circular rather than repeated straight escape.
let bird={x:4,y:0}; // Initial safe four-tile ring used by eight consecutive 45-degree flights.
let totalTurn=0; // Accumulates orbital angle to confirm continuous encirclement without sudden reversals.
for(let i=0;i<8;i++){
  const p=orbit.waypoint(bird,target,{minRadius:3,maxRadius:5,unit:1,direction:1});
  assert(p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  const distance=Math.hypot(p.x-target.x,p.y-target.y);
  assert(Math.abs(distance-4)<1e-9,'every leg preserves a safe orbital radius');
  const before=Math.atan2(bird.y,bird.x),after=Math.atan2(p.y,p.x);
  const advance=Math.atan2(Math.sin(after-before),Math.cos(after-before));
  assert(advance>.7&&advance<.9,'each leg advances around the foe instead of fleeing in one direction');
  totalTurn+=advance;bird={x:p.x,y:p.y};
}
assert(Math.abs(totalTurn-2*Math.PI)<1e-8,'eight chords complete a full circle');
assert(Math.hypot(bird.x-4,bird.y)<1e-8,'the orbit returns to its initial ring position');
const shifted=orbit.waypoint(bird,{x:1,y:1},{unit:1,minRadius:3,maxRadius:5,direction:-1});
assert(shifted&&Math.hypot(shifted.x-1,shifted.y-1)>=3,'the next leg tracks the new live foe position');
const tangent=orbit.tangent({x:4,y:0},target,{direction:1,radius:4});
assert(Math.abs(tangent.x)<1e-10&&Math.abs(tangent.y-1)<1e-10,'dodge starts tangentially around the opponent');
const reverse=orbit.tangent({x:4,y:0},target,{direction:-1,radius:4});
assert(reverse.y<-.99,'opposite direction rotates the other way');
const tooFar=orbit.tangent({x:8,y:0},target,{direction:1,radius:4});
assert(tooFar.x<0,'radial correction pulls a drifting enemy toward its chosen combat ring');
assert.equal(orbit.waypoint({x:Infinity,y:2},target),null,'non-finite actor coordinates are rejected');
assert.equal(orbit.waypoint(bird,{x:NaN,y:0}),null,'invalid combat targets are rejected');
assert.equal(orbit.tangent(target,target),null,'coincident positions cannot generate undefined flight vectors');
const skeeri=read('docs/js/skeeri-ruins.js'),tzatzul=read('docs/js/tzatzul-flight-runtime.js');
const boss=read('docs/js/combat/combat-special-liches.js'),nest=read('docs/js/tzatzul-nest-encounter.js');
const html=read('docs/index.html');
assert(html.indexOf('js/flying-combat-orbit.js')<html.indexOf('js/skeeri-ruins.js'),
  'shared geometry loads before Skeeri and Tzatzul');
assert(skeeri.includes("flightTo(session,state,to,'orbit'")&&skeeri.includes("lineClear(start,to)"),
  'Skeeri must still use the real ruin voxel flight collision gate');
assert(tzatzul.includes("startLeg(bird, endpoint, 'orbit'")&&tzatzul.includes("clearAirPath?.(bird, endpoint)"),
  'Tzatzul orbit retains the real elevated flight leg and cave obstacle check');
assert(nest.includes('nearestObstacle(map, start, end, half)'),'indoor boss orbit checks the existing physical cave obstacles');
assert(boss.includes('FlyingCombatOrbit?.tangent?.')&&boss.includes('deps?.sweptMove?.'),
  'Azgarlu curves its evasive dodge while keeping swept wall collision');
const mobileDebug=read('docs/js/wildlife-debug-panel.js'); // This existing in-game panel is available on mobile without DevTools.
assert(mobileDebug.includes('no-perch orbits: ')&&mobileDebug.includes('Skeeri aerial combat'),
  'Tzatzul and Skeeri fallback phases/counters remain visible in the mobile debug panel');
assert(/wildlife-debug-panel\\.js\\?v=[A-Za-z0-9_-]+/.test(html),
  'the deployed mobile diagnostics use a properly versioned debug-panel asset');
console.log('Flying combat orbital evasion geometry and collision integrations PASS');
