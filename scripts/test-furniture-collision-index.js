#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); // Checks indexed queries against the same production collision authority without its broad phase.
const fs=require('node:fs'), vm=require('node:vm'); // Loads actual furniture and puzzle modules in isolated browser namespaces.
function runtime(indexed,source=fs.readFileSync('docs/js/furniture-table-system.js','utf8')) {
  const window={}; // Minimal game namespace; no WebGL is needed for oriented footprint queries.
  for(const path of ['furniture-puzzle-properties','interior-furniture-grid'])vm.runInNewContext(fs.readFileSync(`docs/js/${path}.js`,'utf8'),{window});
  vm.runInNewContext(source,{window});
  let frame=1; // Explicit frame advancement exercises live editing and per-frame invalidation.
  window.FurnitureTableSystem.init({frameId:indexed?()=>frame:undefined});
  return {api:window.FurnitureTableSystem,next:()=>frame++};
}
function piece(api,id,x,z,yaw=0,w=1,d=1,options={}) {
  const record={id,key:'chairSimple',col:x,row:z,rotY:yaw,...options}; // Live saved record used for mutation checks.
  const root={parent:{},position:{x,z,y:0},scale:{x:1,y:1,z:1},userData:{}}; // Ordinary placed root, with transforms read by production placementFrame.
  api.registerPlacement('town',record,root,{fw:w,fd:d});
  return {record,root};
}
const indexed=runtime(true), reference=runtime(false); // Reference executes production SAT tests through the uncached editor path.
for(const target of [indexed,reference]) {
  for(let i=0;i<180;i++)piece(target.api,`p${i}`,(i%18)*4-35.9,Math.floor(i/18)*4-19.9,i*17,1+(i%3),.4+(i%2));
  piece(target.api,'wide',-4,-4,37,14,2);
  piece(target.api,'stage',2,2,0,5,4,{walkableElevation:true});
  piece(target.api,'door',7,7,0,2,2,{key:'woodenDoor'});
  piece(target.api,'mechanism',8,8,0,2,2,{puzzle:{role:'mechanism',blocksMovement:true}});
}
let seed=71; // Deterministic sampling covers negative cells, rotations, borders, body radii and projectile heights.
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<12000;i++) {
  const args=['map_hobunji_town',random()*90-45,random()*65-30,i%3===0?random()*3:0,i%5===0?2:null]; // Large boxes span buckets; no misses or duplicated semantics allowed.
  assert.equal(indexed.api.blocksBox(...args),reference.api.blocksBox(...args),`query ${i}`);
}
const stats=indexed.api.snapshot('town').collision; // Work-count regression guards the hot path independently of machine timing.
assert.equal(stats.builds,1);
assert.equal(stats.classifications,184,'mechanism classification runs once per placement, not per query');
assert(stats.candidates<12000*184/10,'broad phase rejects at least 90% of the all-furniture scan');
for(const target of [indexed,reference]) {
  target.api.clearArea('town');
  const moved=piece(target.api,'moving',-.5,-.5); // Next-frame root movement and collision-flag edits must be visible.
  assert.equal(target.api.blocksBox('town',-.5,-.5),true);
  moved.root.position.x=16;target.next();
  assert.equal(target.api.blocksBox('town',-.5,-.5),false);
  assert.equal(target.api.blocksBox('town',16,-.5),true);
  moved.record.nonColliding=true;target.next();
  assert.equal(target.api.blocksBox('town',16,-.5),false);
  piece(target.api,'added',20,20);
  assert.equal(target.api.blocksBox('town',20,20),true,'same-frame addition invalidates index');
  piece(target.api,'added',24,24);
  assert.equal(target.api.blocksBox('town',20,20),false,'same-frame replacement removes stale bounds');
  assert.equal(target.api.blocksBox('town',24,24),true);
  target.api.clearArea('town');
  assert.equal(target.api.blocksBox('town',24,24),false,'cleared areas retain no colliders');
  assert.equal(target.api.blocksBox('town',Infinity,0),false);
  assert.equal(target.api.blocksBox('town',0,0,-1),false);
}
console.log(`Collision equivalence: 12,000 probes; ${stats.candidates} candidates instead of up to ${12000*184}.`);

for (const target of [runtime(true),runtime(false)]) {
  const tall=piece(target.api,'scaled',0,0); // Projectile height follows the same scale as visible furniture.
  tall.root.scale.y=3;target.next();
  assert.equal(target.api.blocksBox('town',0,0,0,2),true);
  tall.root.scale.y=.25;target.next();
  assert.equal(target.api.blocksBox('town',0,0,0,.5),false);
}
