'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8'); // Execute shipped owners against deterministic movement, camera and audio fixtures.
const game=read('docs/game.js');
const story={window:{},document:{addEventListener(){}},console};
vm.runInNewContext(read('docs/js/opening-story-cutscene.js'),story);
const api=story.window.OpeningStoryCutscene,rescue=api.buildRescueScene(new Map(),{}),meeting=api.buildHunundiMeetingScene(new Map(),{});
assert.equal(rescue.stages.find(s=>s.type==='combat').cameraMode,'establishing');
assert.equal(rescue.actors.find(a=>a.id==='spearhead').visible,false);
assert.equal(rescue.stages.find(s=>s.id==='rescue_spearhead_enter').spawnOutsideView,true);
const chair=JSON.parse(read('docs/config/maps/map_i_temple_basement_hunundi.json')).furniture.find(f=>f.id==='f_tbhunundi_guest_chair_near');
assert.equal(chair.row,6);assert.equal(meeting.actors.find(a=>a.id==='harkharash').seatTarget.r,6);
assert(meeting.stages.filter(s=>s.speakerId==='harkharash').every(s=>s.cameraDistanceMultiplier===.7));
assert.equal(meeting.stages[meeting.stages.findIndex(s=>s.id==='meeting_hark_leave')+1].visible,false);
class V {constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}copy(v){Object.assign(this,v);return this;}clone(){return new V(this.x,this.y,this.z);}applyQuaternion(q){const x=this.x,z=this.z;this.x=x*Math.cos(q.yaw)+z*Math.sin(q.yaw);this.z=-x*Math.sin(q.yaw)+z*Math.cos(q.yaw);return this;}project(){this.x/=2;this.y=0;this.z=0;return this;}}
class Q {constructor(yaw=0){this.yaw=yaw;}identity(){this.yaw=0;return this;}premultiply(q){this.yaw+=q.yaw;return this;}setFromAxisAngle(axis,angle){this.yaw=angle;return this;}}
const cut= (source,a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a))); // Extract owning closures without mirroring their implementation.
// Real travel method drives the gait of every humanoid, with floor grounding and current displacement speed.
const gait=[];
const travel={entities:new Map(),actorStates:new Map(),area:'forest',npcSurfaceY:()=>3,window:{NpcHeldEquipment:{updateCutsceneWalker(){}}},THREE:{MathUtils:{radToDeg:r=>r*180/Math.PI}}};
vm.runInNewContext(cut(game,'        const advanceActorToward =','        const finish =')+'\nadvance=advanceActorToward;',travel);
for(const id of ['spearhead','jubmir','player']) {
 const root={position:new V()},walker={rot:0,moveToward(){root.position.x+=.1;return false;},legs:{update:(dt,speed,suppressed)=>gait.push({id,dt,speed,suppressed})}};
 travel.entities.set(id,{kind:'npc',root,walker});travel.actorStates.set(id,{});
 assert.equal(travel.advance(id,2,2,.05),false);
 assert.equal(root.position.y,3);assert.equal(gait.at(-1).speed,2);assert.equal(gait.at(-1).suppressed,false);
}
// Entrance projection runs before visibility changes and before selecting the next shot.
const entrance={stage:{actorId:'spearhead',spawnOutsideView:true,visible:true,targetWorld:{c:1,r:1}},actorStates:new Map([['spearhead',{c:1,r:1}]]),entities:new Map([['spearhead',{root:{visible:false},walker:{avatarHeight:1}}]]),THREE:{Vector3:V},camera:{updateMatrixWorld(){}},area:'forest',npcSurfaceY:()=>0,isNpcTileWalkable:()=>true,applyState(id){assert.equal(this?.unused,undefined);assert.equal(entrance.entities.get(id).root.visible,false);entrance.applied=true;}};
vm.runInNewContext(cut(game,'          if (stage.spawnOutsideView)','          if (povShot &&'),entrance);
assert(entrance.applied);assert.equal(entrance.entities.get('spearhead').root.visible,true);
assert(Math.abs(entrance.actorStates.get('spearhead').c/2)>1.4,'spawn falls outside the preceding frustum');
// The final rendered body clamp includes stance yaw and preserves feet, logical gaze and owned tool alignment.
const rotation={window:{},THREE:{Quaternion:Q,Vector3:V,MathUtils:{degToRad:d=>d*Math.PI/180}},performance:{now:()=>0}};
vm.runInNewContext(read('docs/js/perp-rotation.js'),rotation);
rotation.window.PerpRotation.init({angleDiff:(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b))});
const body={visible:true,position:new V(),rotation:{y:Math.PI/2},localToWorld:v=>v},feet={rotation:{y:0}},neck={rotation:{y:-.4}},tool={rotation:{y:Math.PI/2}};
const rendered={window:rotation.window,THREE:{Vector3:V,Quaternion:Q},playerMesh:body,playerLegRoot:feet,playerPosteriorY:.4,wrapSignedAngle:a=>Math.atan2(Math.sin(a),Math.cos(a)),hierarchyWorldQuaternion:node=>new Q(node.rotation.y),currentPlayerNeckJoint:()=>neck,currentOwnedRootEntries:()=>[{root:body},{root:tool}],applyWorldDelta(root,pivot,q,t,undo){const before=root.rotation.y;root.rotation.y+=q.yaw;undo.push(()=>root.rotation.y=before);}};
vm.runInNewContext(cut(read('docs/js/player-body-transform-composer.js'),'  let renderFacingState','  function registerPlayerRig')+'\nundo=[];debug={};applyRenderedFacingDeadzone({position:{x:0,z:5}},undo,debug);',rendered);
assert(Math.abs(Math.abs(body.rotation.y-Math.PI/2)-40*Math.PI/180)<1e-8);
assert.equal(body.rotation.y,tool.rotation.y);assert(Math.abs(body.rotation.y+feet.rotation.y-Math.PI/2)<1e-8);
assert(Math.abs(body.rotation.y+neck.rotation.y-(Math.PI/2-.4))<1e-8);
for(const undo of rendered.undo.reverse())undo();assert.equal(body.rotation.y,Math.PI/2);assert.equal(feet.rotation.y,0);assert.equal(neck.rotation.y,-.4);
// Wind-only loading mutes the existing owners, survives a rejected autoplay request and restores the exact master setting.
class Media {constructor(src){this.src=src;this.paused=true;this.dataset={};}pause(){this.paused=true;}play(){this.paused=false;return Promise.resolve();}}
const config={sfxVolume:.7},calls=[];
const audio={Audio:Media,introductionMix:null,activeSfx:new Set([{pause:()=>calls.push('sfx-stop')}]),gameAudioConfig:()=>config,window:{Music:{beginQuietLoading:()=>{calls.push('music-stop');return()=>calls.push('music-resume');}},HobunjiAmbientBgs:{silence:()=>calls.push('ambient-stop'),updateNow:()=>calls.push('ambient-resume')},EnvironmentalReverb:{stopAll:()=>calls.push('wet-stop')},AnimalVoiceIndependentPlayback:{stopAll:()=>calls.push('voices-stop')},_footstepAudioCtx:{state:'running',suspend:()=>{calls.push('context-stop');return Promise.resolve();},resume:()=>{calls.push('context-resume');return Promise.resolve();}}}};
vm.runInNewContext(cut(read('docs/js/audio-system.js'),'  function beginIntroductionMix()','  window.AudioSystem =')+'\nsession=beginIntroductionMix();',audio);
assert.equal(config.enabled,false);assert.equal(audio.session.debug().playing,true);assert(audio.session.debug().wind.endsWith('bgs_wind2.mp3'));
audio.session.finish();audio.session.finish();assert(!Object.hasOwn(config,'enabled'));assert.equal(config.sfxVolume,.7);assert.equal(calls.filter(x=>x==='music-resume').length,1);
assert(calls.includes('voices-stop')&&calls.includes('context-stop')&&calls.includes('sfx-stop'));
config.enabled=false;vm.runInNewContext('session=beginIntroductionMix();session.finish();',audio);assert.equal(config.enabled,false);
console.log('Rescue fight/entrance, all humanoid gaits, stance-aware rendered clamp and wind-only audio restoration passed');
