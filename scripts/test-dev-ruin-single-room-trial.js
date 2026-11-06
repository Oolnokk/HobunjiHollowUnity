'use strict';
// Focused regression coverage for the developer single-room no-loot puzzle lab.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const planner=require('../docs/js/ruin-layer-plan.js');
const solo=require('../docs/js/dev-ruin-single-room-trial.js');
const valid=new Set(solo.TYPES.map(([kind])=>kind)); // Shared authoring choices and normal planner output.
const challenges=require('../docs/js/ruin-layer-challenges.js'); // Geometry-only pit preview verifies standalone rope spacing without Three.js.
for(let length=11;length<=18;length++){
  const pit=challenges.ropePitForRoom({x:0,z:0,w:length,d:13},'E');
  assert.ok(pit,'large-preset rooms must have two actual rope banks');
  const span=pit.maxX-pit.minX,count=Math.max(3,Math.min(8,Math.ceil((span-1)/2.25)+1));
  assert.ok((span-1)/(count-1)<=2.25,'normal rope catch distances must be physically achievable');
}
assert.equal(valid.size,10);
assert.deepEqual(Object.values(solo.NATIVE_VARIANTS),['brazier','glyphObelisk','stackedObelisk','linkedCubePillars']);
for(const kind of valid){const selected=solo.pick(19,kind,planner);assert.equal(selected.kind,kind);assert.equal(selected.mode,'forced');}
assert.throws(()=>solo.pick(10,'unknown',planner),/Unknown single-room puzzle/);
assert.throws(()=>solo.pick(10,'pressurePlate',planner),/Unknown single-room puzzle/);
assert.throws(()=>solo.pick(10,'weighted',null),/RuinLayerPlan is unavailable/);
const counts=new Map(); // Measured output of the live dungeon stage weights.
for(let seed=1;seed<=200;seed++){
  const selected=solo.pick(seed,'weighted',planner);
  const plan=planner.compose({seed,nativeV50:false});
  const rooms=plan.floors.flatMap(f=>f.rooms.filter(room=>room.kind==='challenge-room'&&valid.has(room.challenge)));
  assert.equal(plan.ok,true);assert.equal(selected.population,rooms.length);
  assert.ok(rooms.some(room=>room.challenge===selected.kind));
  assert.deepEqual(solo.pick(seed,'weighted',planner),selected);
  counts.set(selected.kind,(counts.get(selected.kind)||0)+1);
}
assert.equal(counts.size,6,'weighted mode samples only normal layered challenge rooms');
assert.equal(counts.has('pressurePlate'),false,'retired pressure plate must never enter the random lab');
const interior=read('docs/js/dev-random-ruin-interior-map.js');
const simple=read('docs/js/dev-random-ruin-simple-puzzles.js');
const defense=read('docs/js/ruin-layer-defense.js');
const encounters=read('docs/js/ruin-encounters.js');
const corpses=read('docs/js/bandit-camps.js');
for(const needle of ['roomMax:singleVestibule?1','if(singleVestibule&&meta.rooms?.length!==1)','if(!singleRoomTrial)attachShaftHub','options.singleRoomTrial?null:requestedRuinType','singleRoomTrial:soloChoice,noLoot:singleRoomTrial','const stoneAgeRequested=!singleRoomTrial','puzzleType:soloSelector.value'])
  assert.ok(interior.includes(needle),'one-room contract: '+needle);
for(const needle of ['if(context.singleRoomTrial){','return; // Never run other composers','Challenge.compose({','Challenge.ropePitForRoom(room,side)','state.singleRoomChallenge?.dispose?.()','state.singleRoomChallenge?.tick?.(dt)'])
  assert.ok(simple.includes(needle),'puzzle lifecycle: '+needle);
assert.ok(defense.includes('noLoot:options.noLoot===true'));
assert.ok(encounters.includes('if(enc.noLoot)entity.ruinNoLoot=true'));
assert.ok(corpses.includes('if (c.ruinNoLoot===true)return [];')||corpses.includes('if(c.ruinNoLoot===true)return [];'));
assert.ok(corpses.includes('if(c.ruinNoLoot===true)return {ok:false'));
assert.ok(interior.includes('singleRoomLab:singleRoomTrial'));
assert.ok(interior.includes("soloChoice.kind==='statueDefense'?'veryLarge':'large'"));
assert.ok(read('docs/tools/debris-ifier/debrisifier-v50-api.js').includes('window.__devRuinSingleRoomLab ='));
assert.ok(read('docs/tools/debris-ifier/debrisifier-01.js').includes("['flat puzzle lab floor',"));
assert.ok(read('docs/tools/debris-ifier/debrisifier-01.js').includes("['clear solo chamber support pillars',")); // A normal V50 support column cannot overlap the selected challenge center.
assert.ok(read('docs/index.html').includes('dev-ruin-single-room-trial.js'));
assert.ok(interior.includes('nativePuzzle:nativeSoloType'));
assert.ok(simple.includes('if(nativeKind){'));
assert.ok(read('docs/tools/debris-ifier/debrisifier-01.js').includes('single_room_native_v50_goal'));
assert.ok(read('docs/tools/debris-ifier/debrisifier-v50-api.js').includes('__devRuinSingleRoomNativeCreated=null'));

assert.match(read('docs/js/dev-random-ruin-bootstrap.js'), /dev-random-ruin-simple-puzzles\.js\?v=[A-Za-z0-9_-]+/);
console.log('Single-room puzzle lab: 200 planner seeds, ten forced choices, isolation and no-loot contracts passed.');
