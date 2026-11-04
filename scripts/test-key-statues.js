'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8');
const json=path=>JSON.parse(read(path));
const statue=json('docs/config/furniture-authored/keyStatue.json');
const dispenser=json('docs/config/furniture-authored/keyStatueDispenser.json');
const index=json('docs/config/furniture-authored/index.json');

assert.equal(statue.key,'keyStatue');
assert(statue.carryable.enabled);
assert(statue.carryable.handTargets.left&&statue.carryable.handTargets.right);
assert(statue.parts.some(part=>part.id==='key_statue_key_bow'),'the statue visibly carries a key crest');
assert.equal(dispenser.puzzle.role,'activator');
assert.equal(dispenser.puzzle.behavior,'keyStatue');
assert.equal(dispenser.puzzle.payloadPartId,'key_statue_button');
const button=dispenser.parts.find(part=>part.id==='key_statue_button');
const cavity=dispenser.parts.find(part=>part.id==='key_statue_cavity');
assert(button&&cavity,'the dispenser has a moving button and a separate cavity surface');
assert.equal(cavity.color,'#050505');
const states=dispenser.puzzle.motion.parts.key_statue_button;
assert(states.off.y>states.on.y,'the statue button starts halfway raised and sinks when the payload is taken');
assert.equal(states.off.sy,states.on.sy,'the button moves without changing its size');
assert.equal(dispenser.puzzle.motion.durationSeconds,.72);
assert(index.furniture.some(item=>item.key==='keyStatue'));
assert(index.furniture.some(item=>item.key==='keyStatueDispenser'));

const window={};
vm.runInNewContext(read('docs/js/furniture-puzzle-properties.js'),{window});
const puzzle=window.FurniturePuzzleProperties;
assert(puzzle.ACTIVATORS.includes('keyStatue'));
const normalized=puzzle.normalizePuzzle(dispenser.puzzle);
assert.equal(normalized.behavior,'keyStatue');
assert.equal(normalized.payloadPartId,'key_statue_button');
assert.deepEqual(
 JSON.parse(JSON.stringify(normalized.motion.parts.key_statue_button.off)),
 JSON.parse(JSON.stringify(states.off)),
 'the authored OFF button transform survives puzzle normalization'
);
assert.deepEqual(
 JSON.parse(JSON.stringify(normalized.motion.parts.key_statue_button.on)),
 JSON.parse(JSON.stringify(states.on)),
 'the authored ON button transform survives puzzle normalization'
);

const runtime=read('docs/js/furniture-puzzle-runtime.js');
assert(runtime.includes("['burdenPlate','keyStatue'].includes(puzzle.behavior)"));
assert(runtime.includes('function keyStatueButtons('));
assert(runtime.includes('function interactKeyStatue('));
assert(runtime.includes('function setKeyStatueTaken('));
assert(runtime.includes('window.Shattercasks?.pickUp?.(payload)'));
assert(runtime.includes('activate(mapId, id, !!taken)'),'taking/returning the statue emits its activator channel');

const keyRuntime=read('docs/js/key-statues.js');
assert(keyRuntime.includes('payloadAttachmentAnchors'));
assert(keyRuntime.includes('payloadPartId'));
assert(keyRuntime.includes("kind:'keyStatue'"));
assert(keyRuntime.includes("onPickup:record=>"));
assert(keyRuntime.includes("onLost:(record,cause)=>lostStatue"));
assert(keyRuntime.includes("setKeyStatueTaken?.(state.mapId,state.id,false)"),'a replacement begins its ON→OFF reset animation');
assert(keyRuntime.includes('queueRespawn(state,reason)'));
assert(keyRuntime.includes("discardBurden?.(lost)"),'orphaned Burdens are removed from the shared registry');
assert(keyRuntime.includes('keyStatueMounted'),'the floor hazard check excludes the mounted initial payload');

const table=read('docs/js/furniture-table-system.js');
assert(table.includes("['burdenPlate','keyStatue'].includes(puzzle.behavior)"));
assert(table.includes('keyStatueButtons?.(area, id)'));
assert(table.includes('interactKeyStatue?.(area, id, action)'));
assert(table.includes('KeyStatues?.registerDispenser?.(area, id, root, puzzle)'));
const puzzleRuntime=read('docs/js/furniture-puzzle-runtime.js');
assert(puzzleRuntime.includes('KeyStatues?.unregisterDispenser?.(mapId,id)'));

const carry=read('docs/js/shattercasks.js');
assert(carry.includes('onPickup:typeof options.onPickup'));
assert(carry.includes('onLost:typeof options.onLost'));
assert(carry.includes('function pickUp(cask)'));
assert(carry.includes('cask.onPickup?.(cask)'));

(async()=>{
// Runtime lifecycle regression: a late/missing furniture asset must not permanently block respawn.
class MockGroup {
 constructor(){this.isObject3D=true;this.children=[];this.parent=null;this.userData={};this.position={set(x,y,z){Object.assign(this,{x,y,z});}};this.quaternion={identity(){}};this.scale={setScalar(value){this.x=this.y=this.z=value;}};}
 add(child){child.parent=this;this.children.push(child);}
 remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}
 updateWorldMatrix(){}
}
const scene=new MockGroup();scene.isScene=true; // Authoritative scene root accepts a discarded statue during recovery.
const runtimeButton=new MockGroup();
const root=new MockGroup();
scene.add(root);
const plinth=new MockGroup(),plinthAnchor=new MockGroup(); // Linked defense plinth used to prove seated statues are protected from recall.
plinth.userData.burdenPlateAnchor=plinthAnchor;plinth.userData.puzzleInstanceId='trial_plinth';
plinth.userData.furniturePuzzle={behavior:'burdenPlate'};plinth.add(plinthAnchor);
const alternate=new MockGroup(),alternateAnchor=new MockGroup(); // An unrelated optional plinth can accept the same physical Key Statue kind.
alternate.userData.burdenPlateAnchor=alternateAnchor;alternate.userData.puzzleInstanceId='alternate_plinth';
alternate.userData.furniturePuzzle={behavior:'burdenPlate'};alternate.add(alternateAnchor);
let cancelledPlinths=0,alternateCancels=0;
root.userData.meshById=new Map([['key_statue_button',runtimeButton]]);
let assetLoads=0;
const registered=[];
const takenTransitions=[];
const runtimeWindow={
 THREE:{Group:MockGroup,Vector3:class{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}},
 GridTileAccessors:{getCurrentArea:()=> 'map_key_statue_runtime',getActiveScene:()=>scene,getActiveGrid:()=>null},
 AuthoredFurniture:{
  async load(){assetLoads++;return assetLoads===1?null:{key:'keyStatue'};},
  buildGroup(){return new MockGroup();},
 },
 Shattercasks:{
  registerBurden(options){const burden={...options,exploded:false,carried:false,flying:false};registered.push(burden);return burden;},
  discardBurden(burden){burden.exploded=true;burden.group.parent?.remove(burden.group);burden.onLost?.(burden,'discarded');return true;},
  pickUp(){return true;},
 },
 FurniturePuzzleRuntime:{
  setKeyStatueTaken(_map,_id,taken){takenTransitions.push(taken);return true;},
  getNode(_map,id){return id==='trial_plinth'?plinth:id==='alternate_plinth'?alternate:null;},
  cancelBurdenPlate(_map,id){
    if(id==='trial_plinth'){cancelledPlinths++;plinth.userData.burdenPlatePayload=null;return true;}
    if(id==='alternate_plinth'){alternateCancels++;alternate.userData.burdenPlatePayload=null;return true;}
    return false;
  },
 },
};
runtimeWindow.window=runtimeWindow;
vm.runInNewContext(read('docs/js/key-statues.js'),{window:runtimeWindow,console});
assert(runtimeWindow.KeyStatues.registerDispenser('map_key_statue_runtime','fixture',root,{payloadPartId:'key_statue_button'},{feedPlinthId:'trial_plinth'}));
await new Promise(resolve=>setImmediate(resolve));
assert.equal(assetLoads,1,'initial missing authored data is observed');
assert.equal(runtimeWindow.KeyStatues.debugSnapshot().dispensers[0].respawning,false,
 'failed asset lookup clears the respawn lock instead of wedging the dispenser');
runtimeWindow.KeyStatues.tick(.1);runtimeWindow.KeyStatues.tick(.1);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(registered.length,1,'the dispenser retries and registers the physical Key Statue');
assert.equal(registered[0].group.parent?.parent,runtimeButton,'the replacement is physically mounted on the moving runtimeButton');
assert.equal(takenTransitions[0],false,'initially mounted payload leaves the plinth in its OFF/raised state');
const first=registered[0];
runtimeWindow.Shattercasks.discardBurden(first);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(registered.length,2,'losing the statue spawns exactly one replacement');
assert.notStrictEqual(runtimeWindow.KeyStatues.debugSnapshot().dispensers[0].payload,first.id,
 'the live payload reference changes to the replacement');
assert.equal(registered[1].group.parent?.parent,runtimeButton,'replacement is attached while the runtimeButton animates back up');
assert.equal(runtimeWindow.KeyStatues.debugSnapshot().dispensers[0].respawning,false,'successful replacement releases the respawn lock');
const area='map_key_statue_runtime',api=runtimeWindow.KeyStatues,second=registered[1];
assert.equal(api.status(area,'fixture'),'ready','new statue is available on the dispenser');
second.carried=true;second.keyStatueMounted=false;second.onPickup?.(second);
assert.equal(api.status(area,'fixture'),'carried','carried statues are not duplicated by their dispenser');
assert.equal(api.recall(area,'fixture').ok,false,'recall cannot discard the statue currently in the player hands');
second.carried=false;scene.add(second.group); // A dropped statue can be made inaccessible without being destroyed.
assert.equal(api.status(area,'fixture'),'recallable');
assert.equal(api.recall(area,'fixture').ok,true,'the player can request a fresh statue from an unreachable drop');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(registered.length,3,'manual recall creates exactly one replacement after discarding the original');
const third=registered[2];
assert.equal(api.status(area,'fixture'),'ready');
third.carried=false;third.keyStatueMounted=false;
plinthAnchor.add(third.group);plinth.userData.burdenPlatePayload=third;
assert.equal(api.status(area,'fixture'),'seated','the linked plinth owns the statue during a defense');
assert.equal(api.recall(area,'fixture').ok,false,'the dispenser must not steal a statue from an active plinth');
runtimeWindow.Shattercasks.discardBurden(third);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(cancelledPlinths,1,'destroying the seated statue reverses its plinth instead of leaving a false completion');
assert.equal(registered.length,4,'destroying the seated statue restores exactly one replacement');
assert.equal(api.status(area,'fixture'),'ready','after a failed defense the dispenser is ready again');
assert.equal(api.debugSnapshot().dispensers[0].feedPlinthId,'trial_plinth','mobile debug reports the linked defense objective');
const swapped=registered[3];swapped.carried=false;swapped.keyStatueMounted=false;
swapped.plinthAttached=true;swapped.plinthAnchor=alternateAnchor;
alternateAnchor.add(swapped.group);alternate.userData.burdenPlatePayload=swapped;
assert.equal(api.status(area,'fixture'),'seated','a statue moved into another plinth is protected by its actual attachment');
assert.equal(api.recall(area,'fixture').ok,false,'the original dispenser cannot duplicate a statue seated at another plinth');
runtimeWindow.Shattercasks.discardBurden(swapped);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(alternateCancels,1,'destroying a swapped statue resets the plinth that actually held it');
assert.equal(registered.length,5,'a cross-placed destroyed statue still produces only one fresh replacement');
assert.equal(api.status(area,'fixture'),'ready');
console.log('Key Statue: authored dispenser + plinth feed, retry after failed loads, loss and drop recovery, protected in-progress or swapped statues, and reset on destruction passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
