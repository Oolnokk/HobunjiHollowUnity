'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const TILE=64,ruin='map_i_dev_random_ruin'; // Stacked floors share a flat grid.
const grid=Array.from({length:8},()=>Array(8).fill(1)),corpses=new Set();
let area=ruin,wide=false,queries=0;
const heights=[];
const win={DynamicSurfaces:{sampleSupport(x,z,{minY=-Infinity,maxY=Infinity}={}){
  queries++;
  const floors=wide||Math.abs(x-1.6)<.01&&Math.abs(z-1.5)<.01?[0,8,16]:[0];
  const y=floors.filter(y=>y>=minY&&y<=maxY).pop();return Number.isFinite(y)?{y}:null;
},pointInPit:()=>false}};
vm.runInNewContext(fs.readFileSync('docs/js/creature-death.js','utf8'),{window:win,console,Math,Date});
const D=win.CreatureDeath;
D.init({TILE,COLS:8,ROWS:8,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),getGrid:()=>grid,getCurrentArea:()=>area,corpseObjects:corpses,tileSurfaceYInArea:()=>0,canOccupyAt:(x,y,r,h)=>{heights.push(h);return true;},characterGroundShadowSurfaceOffset:()=>.02});
function vector(){return {set(x,y,z){Object.assign(this,{x,y,z});}};}
function rig(){return {group:{position:vector(),rotation:vector(),scale:{y:1}}};}
function actor(floor,extra={}){
 const c={id:'skeleton',areaId:ruin,x:1.6*TILE,y:1.5*TILE,health:0,halfHeight:.5,shaftSupportY:floor,avatarRef:rig(),groundShadow:{position:vector()},...extra};
 c.avatarRef.group.position.set(c.x/TILE,floor+.5,c.y/TILE);return c;
}
function finish(c,floor,recorded=false){
 for(let i=0;i<20;i++){D.updateCorpses(.05);assert.ok(c.avatarRef.group.position.y>=floor);}
 assert.equal(c.state,'corpse');assert.equal(c.deathSurfaceY,floor);
 assert.equal(c.avatarRef.group.position.y,floor+.5*(recorded?.82:.12));
 assert.equal(c.groundShadow.position.y,floor+.02);
 assert.equal(c.physicalFeetY,floor);assert.equal(c.shaftSupportY,floor);assert.ok(corpses.has(c));
}
for(const floor of [0,8,16]){const c=actor(floor);D.begin(c,c.x,c.y);finish(c,floor);}
const edge=actor(16);D.begin(edge,edge.x-TILE,edge.y);
const before=queries;finish(edge,16);assert.equal(queries,before,'no support scans per death frame');
assert.equal(edge.x,1.6*TILE,'a narrow upper floor must not center-snap or slide into the void');
wide=true;win.ImpactRagdollPlayback={startCreatureDeath:()=>.7,sampleCreatureDeath:()=>{}};
const hit=actor(8);D.begin(hit,hit.x-TILE,hit.y);finish(hit,8,true);
assert.ok(heights.length>0&&heights.every(h=>h===8.25),'occupancy uses actor story');
hit.avatarRef=rig();assert.equal(D.restoreSettledPose(hit),true);assert.equal(hit.avatarRef.group.position.y,8+.5*.82);
delete win.ImpactRagdollPlayback;
const pre=actor(16);assert.equal(D.settleAsCorpse(pre),true);assert.equal(pre.avatarRef.group.position.y,16+.5*.12);
const fallback=actor(8,{shaftSupportY:undefined,surfaceYOverride:()=>NaN,physicalFeetY:8});
D.recover(fallback,0,0,new Error('fixture'));assert.equal(fallback.x,1.6*TILE);assert.equal(fallback.avatarRef.group.position.y,8+.5*.12);
const leave=actor(16);D.begin(leave);area='farm';D.updateCorpses(.01);assert.equal(leave.state,'corpse');assert.equal(leave.avatarRef.group.position.y,16+.5*.12);
const outdoor=actor(16,{areaId:'farm'});D.begin(outdoor);for(let i=0;i<20;i++)D.updateCorpses(.05);
assert.equal(outdoor.deathSurfaceY,undefined);assert.equal(outdoor.avatarRef.group.position.y,.5*.12);
console.log('Stacked ruin corpse floor regression passed');
