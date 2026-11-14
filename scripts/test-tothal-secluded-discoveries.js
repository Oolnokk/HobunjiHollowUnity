'use strict';
// Real module tests: LOS concealment, stable Shift sites, and complete old-cave retirement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Scorer = require('../docs/js/wilderness-seclusion.js');

const SIZE = 61; // Fixture's full map width/height for observer rings and ledge profiles.
const grid = Array.from({length: SIZE}, (_,row) => Array.from({length:SIZE},(_,col) => ({
  type:'grass',elevTier:0,col,row,
}))); // Ordinary accessible ground for sightline measurements.
for(let row=14;row<=47;row++) {
  grid[row][29]={type:'rock',elevTier:3}; // West wall of a sheltered clearing.
  grid[row][44]={type:'rock',elevTier:3}; // East wall of the same clearing.
}
for(let col=29;col<=44;col++){
  grid[14][col]={type:'rock',elevTier:3}; // Northern cliff overhang hides the pocket from distant observers.
  if(col!==36)grid[47][col]={type:'rock',elevTier:3}; // Single accessible approach, not an enclosed unreachable void.
}
const options={
  cols:SIZE,rows:SIZE,getTile:(c,r)=>grid[r]?.[c],
  canStand:tile=>tile.type==='grass',
  blocksSight:tile=>tile.type==='rock',
  elevation:tile=>tile.elevTier||0,
};
const hidden=Scorer.sampleVisibility(options,36,31);
const open=Scorer.sampleVisibility(options,12,31);
assert(hidden.observerSampleCount>0&&open.observerSampleCount>0,'sampled viewpoints must be valid reachable floor cells');
assert(hidden.visibilityRatio<open.visibilityRatio,'a cliff-enclosed pocket must be less visible than an exposed field');
assert(hidden.concealmentScore>open.concealmentScore,'concealment score must reward genuinely screened terrain');
assert.deepEqual(Scorer.sampleVisibility(options,36,31),hidden,'same map must yield the same deterministic score');
assert.equal(Scorer.sampleVisibility({cols:0,rows:0,getTile:()=>null},0,0).concealmentScore,0,
  'an unsampled or invalid map is never interpreted as perfectly hidden');

let cycle=1; // The mock Tothal calendar advances to prove solved old cave identities cannot survive a Shift.
const context={console,Map,Set,Math,Promise,setTimeout,clearTimeout,__hobunjiPlayerProfile:{worldId:'seclusion-test-world'}};
context.window=context;
context.__farmLog=()=>{};
context.CalendarSystem={tothalCycle:()=>cycle};
context.WildernessSeclusion=Scorer;
context.WildlifeSpawn={init(){}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/cave-site-system.js','utf8'),context,{filename:'docs/js/cave-site-system.js'});
const Cave=context.CaveSiteSystem;
assert(Cave,'real CaveSiteSystem must be installed');
const zone='map_seclusion_regression';
const layout={grid,dens:[],transitions:[]}; // Same zoneLayout contract consumed by the live puzzle cave registrar.
context.WildlifeSpawn.init({zoneLayouts:new Map([[zone,layout]]),zoneScenes:new Map()});
const shelves=Array.from({length:34},(_,index)=>{
  const tucked=index<17;
  const x=tucked?33+(index%9):7+(index%9);
  const z=tucked?22+Math.floor(index/9)*3:19+Math.floor(index/9)*3;
  return {id:'shelf_'+index,base:{footprint:[[1,1]]},footprint:[{c:x,r:z},{c:x+1,r:z}],
    x,z,y:3,width:2.1,depth:1.6,normal:{x:0,z:1},tangent:{x:1,z:0}};
}); // 17 concealed, 17 exposed balcony candidates with identical legal entrance geometry.
const first=Cave.registerOutdoorPuzzleSites(zone,shelves);
assert(first.length>=4&&first.length<=24,'existing min/max cave density remains intact');
assert(first.every(site=>site.contents==='puzzle_cave'&&site.source==='independent_cliff'),
  'all generated puzzle sites remain dedicated non-animal caves');
assert(first.every(site=>site.seclusion?.observerSampleCount>0),
  'live landscape must produce mobile-readable measured cave sightlines');
assert.equal(JSON.stringify(Cave.registerOutdoorPuzzleSites(zone,shelves)),JSON.stringify(first),
  'the same world and cycle must reuse identical cave positions and identities');
const selectedHidden=first.filter(site=>shelves.find(s=>s.id===site.shelfId)?.x>=29).length;
assert(selectedHidden>=Math.min(12,first.length-3),'hidden ledges must be preferred over equally valid exposed ledges');
Cave.markExteriorPuzzleSolved(first[0].mapId,3);
assert.equal(Cave.exteriorPuzzleState(first[0].mapId).solved,true,'solved gate persists within its original Shift');
const oldIds=new Set(first.map(site=>site.mapId));
cycle=2;
const next=Cave.registerOutdoorPuzzleSites(zone,shelves);
assert(next.length>=4&&next.length<=24,'new year rerolls the cave population inside the existing density bounds');
assert(next.every(site=>!oldIds.has(site.mapId)),'all old site identities are retired on a new Tothal cycle');
assert([...oldIds].every(id=>!Cave.__test.sitesByMapId.has(id)),'old cached cave map ids must be removed from registry');
assert(next.every(site=>!Cave.exteriorPuzzleState(site.mapId).solved),
  'new Shift puzzle doors start unsolved even if their ledge resembles the previous terrain');
assert.equal(Cave.serialize()?.identity,'seclusion-test-world|2','old puzzle progress is replaced by the new cycle save identity');

console.log('Tothal concealed-discovery tests passed');
