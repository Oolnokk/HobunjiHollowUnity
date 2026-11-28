'use strict';
// Exercise the production impact resolver and finite terrain sweep without initializing the entire ranged renderer.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/js/combat/ranged-weapons.js','utf8');
const start=source.indexOf('  function liquidImpactSurfaceY('),end=source.indexOf('  function terrainImpactForStep(',start);
assert(start>=0&&end>start);
let supportY=3,shaftT=.35,floorT=.5,terrain=null;
const deps={TILE:64,getCurrentArea:()=> 'ruin',worldSurfaceY:()=>0};
const context=vm.createContext({deps,THREE:{MathUtils:{lerp:(a,b,t)=>a+(b-a)*t}},window:{DynamicSurfaces:{sampleSupport:(x,z,opts)=>Number.isFinite(supportY)&&supportY>=opts.minY&&supportY<=opts.maxY?{y:supportY}:null}},
 shaftCoverT:()=>shaftT,dynamicSupportHitT:()=>floorT,steppedTerrainImpact:()=>terrain});
vm.runInContext(source.slice(start,end)+'\nglobalThis.api={traceLiquidSegment,liquidImpactSurfaceY};',context);
const a=context.api;
const p=(x,y,z)=>({x,y,z});
let impact=a.traceLiquidSegment(p(.5,3.05,.5),p(.5,2.95,.5));
assert.equal(impact.kind,'floor','Voxel top contacts before a center-plane crossing must still wet the upper floor');
assert.equal(impact.y,3);
shaftT=.15;floorT=null;
impact=a.traceLiquidSegment(p(.5,4,.5),p(1.5,3.9,.5));
assert.equal(impact.kind,'solid-tile','A wall above a support cannot be mistaken for a wettable floor');
shaftT=null;floorT=.5;
impact=a.traceLiquidSegment(p(.5,2.95,.5),p(.5,3.05,.5));
assert.equal(impact.kind,'solid-tile','A ceiling struck from below must not wet the upstairs surface');
assert.equal(a.liquidImpactSurfaceY('solid-tile',p(.5,3.2,.5),.2,3.4,3.0,'ruin'),3,'Finite burning torch radius gets the same top-of-floor treatment');
assert.equal(a.liquidImpactSurfaceY('solid-tile',p(.5,3.2,.5),.2,3.2,3.2,'ruin'),null,'A horizontal torch wall hit does not ignite tiles');
assert.equal(a.liquidImpactSurfaceY('ground',p(.5,.08,.5),.015,1,0,'ruin'),0);
console.log('PASS jug and torch finite voxel-floor impact classification');
