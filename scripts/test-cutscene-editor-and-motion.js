'use strict';
const assert=require('assert'), fs=require('fs'), vm=require('vm');
const read=p=>fs.readFileSync(p,'utf8'); // Shipping sources drive each regression below.
const game=read('docs/game.js'), editor=read('docs/tools/cutscene-director/index.html');
const story={window:{},document:{addEventListener(){}},console};
vm.runInNewContext(read('docs/js/opening-story-cutscene.js'),story);
const meeting=story.window.OpeningStoryCutscene.buildHunundiMeetingScene(new Map(),{});
const intro=meeting.stages.find(s=>s.id==='meeting_hark_enter');
assert.equal(intro.type,'animation'); // Doorway shot holds its initial tile through the invitation to sit.
assert(!intro.targetWorld);
assert(meeting.stages.findIndex(s=>s.id==='meeting_hunundi_rise')<meeting.stages.findIndex(s=>s.id==='meeting_hark_intro'));
assert(meeting.stages.findIndex(s=>s.id==='meeting_hunundi_reseat')>meeting.stages.findIndex(s=>s.id==='meeting_hark_sit'));
assert.equal(meeting.furnitureTransforms[0].transform.rotationDeg.y,-90);
assert.equal(meeting.stages.find(s=>s.id==='meeting_hunundi_no_leader').cameraMode,'pov');
assert(story.window.OpeningStoryCutscene.buildRescueScene(new Map(),{}).randomCreatureDialogueAngles===true);
for(const stage of meeting.stages.filter(s=>s.speakerId==='harkharash'))assert.equal(stage.cameraMode,'npcRelative');
const hunundiShot=meeting.stages.find(s=>s.cameraMode==='pov');assert.equal(hunundiShot.povBack,.4);assert(hunundiShot.povSide<0);
// Shipping game-format scenes survive the editor's normalization and game-preview export.
const edit={clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),normalizeAngle:n=>Number(n)||0,uid:()=> 'generated',ACTOR_COLORS:['#123456'],EMOTE_NAMES:['laugh'],STAGE_TYPES:new Set(['move','talk','choice','animation','turn','combat','fade','zoom','caption','furniture','camera'])};
const normalStart=editor.indexOf('  function normalizeAnchorRotation('),normalEnd=editor.indexOf('  function saveLocal()',normalStart);
vm.runInNewContext(editor.slice(normalStart,normalEnd)+'\nnormalize=normalizeProject;',edit);
const project=edit.normalize({...meeting,stages:[...meeting.stages,{id:'chair_move',type:'furniture',furnitureId:'f_tbhunundi_chair',transform:{translation:{x:1}},duration:1,next:'__end__'}]});
assert.equal(project.actors.find(a=>a.id==='hunundi').pose,'sit');
assert.equal(project.actors.find(a=>a.id==='harkharash').visible,false);
assert.equal(project.stages.find(s=>s.id==='meeting_knock').type,'caption');
assert.equal(project.stages.find(s=>s.id==='chair_move').type,'furniture');
assert.equal(project.stages.find(s=>s.id==='meeting_hunundi_no_leader').targetActorId,'harkharash');
const payloadContext={state:{project,mapMeta:{loaded:true,kind:'interior',id:meeting.mapId}},pointById:id=>project.points.find(p=>p.id===id),worldOfPoint:p=>({c:p.lc,r:p.lr}),npcById:()=>({id:'canonical'})};
const payloadStart=editor.indexOf('  function buildPreviewPayload()'),payloadEnd=editor.indexOf('  function previewInGame()',payloadStart);
vm.runInNewContext(editor.slice(payloadStart,payloadEnd)+'\nresult=buildPreviewPayload();',payloadContext);
assert.equal(payloadContext.result.payload.furnitureTransforms[0].furnitureId,'f_tbhunundi_chair');
assert.equal(payloadContext.result.payload.actors.find(a=>a.id==='hunundi').seatTarget.furnitureId,'f_tbhunundi_chair');
assert.equal(payloadContext.result.payload.stages.find(s=>s.id==='meeting_hark_to_seat').targetWorld.c,9);
// Minimal deterministic Three-compatible math exercises the production interpolation/seat logic.
class Q {constructor(y=0){this.yaw=y;}clone(){return new Q(this.yaw);}copy(q){this.yaw=q.yaw;return this;}setFromEuler(e){this.yaw=e.y;return this;}multiply(q){this.yaw+=q.yaw;return this;}slerp(q,t){let d=q.yaw-this.yaw;while(d>Math.PI)d-=2*Math.PI;while(d< -Math.PI)d+=2*Math.PI;this.yaw+=d*t;return this;}}
class V {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}clone(){return new V(this.x,this.y,this.z);}copy(v){Object.assign(this,v);return this;}set(x,y,z){Object.assign(this,{x,y,z});return this;}lerp(v,t){for(const a of ['x','y','z'])this[a]+=(v[a]-this[a])*t;return this;}applyMatrix4(m){const c=Math.cos(m.yaw),s=Math.sin(m.yaw);if(m.inverse){this.x-=m.x;this.y-=m.y;this.z-=m.z;const x=this.x,z=this.z;this.x=(x*c-z*s)/m.sx;this.z=(x*s+z*c)/m.sz;this.y/=m.sy;}else{const x=this.x*m.sx,z=this.z*m.sz;this.x=x*c+z*s+m.x;this.z=-x*s+z*c+m.z;this.y=this.y*m.sy+m.y;}return this;}}
class M {constructor(node){this.node=node;this.capture();}capture(){if(this.node)Object.assign(this,{x:this.node.position.x,y:this.node.position.y,z:this.node.position.z,yaw:this.node.quaternion.yaw,sx:this.node.scale.x,sy:this.node.scale.y,sz:this.node.scale.z});return this;}clone(){return Object.assign(new M(),this,{node:null});}invert(){this.inverse=true;return this;}}
class E {set(x,y,z){Object.assign(this,{x,y,z});return this;}}
const chair={userData:{cutsceneFurnitureId:'chair'},position:new V(11.5,0,8.5),quaternion:new Q(),scale:new V(1,1,1),get rotation(){return{y:this.quaternion.yaw};},updateMatrix(){this.matrix.capture();}};
chair.matrix=new M(chair);
const furniture={window:{},THREE:{Vector3:V,Quaternion:Q,Euler:E}};
vm.runInNewContext(read('docs/js/cutscene-furniture-runtime.js'),furniture);
const playback=furniture.window.CutsceneFurnitureRuntime.create({traverse:f=>f(chair)});
assert(playback.set({furnitureId:'chair',transform:{rotationDeg:{y:-90}},duration:1}));
playback.update(.5);
assert(Math.abs(chair.rotation.y+Math.PI/4)<1e-8);
const seat=playback.seat('chair',{x:11.5,y:.234,z:8.5,facingRad:Math.PI/2});
assert(Math.abs(seat.facingRad-3*Math.PI/4)<1e-8);
playback.set({furnitureId:'chair',transform:{rotationDeg:{y:90},translation:{x:2}},duration:1});
playback.update(.5);assert.equal(chair.position.x,12.5); // Repeated transforms blend from the interrupted current pose.
playback.update(.5);assert.equal(chair.position.x,13.5);
assert.equal(playback.seat('chair',{x:11.5,y:.234,z:8.5,facingRad:0}).x,13.5);
assert.equal(playback.set({furnitureId:'missing',duration:1}),false);
playback.restore();assert.equal(chair.position.x,11.5);assert.equal(chair.rotation.y,0);
// Real actor tick uses wall time for smooth pose transitions, neck gaze and held-equipment updates.
const actor={kind:'npc',root:{position:new V()},walker:{avatarHeight:1,neckJoint:{},applyFacingDeadzone(){}}},speaker={kind:'npc',root:{position:new V(2,0,1)},walker:{avatarHeight:1}};
actor.walker.root = actor.root;
const st={pose:'sit',rotation:0,proneBlend:1,poseTransition:{from:1,to:0,elapsed:0,duration:1}};
let aimed=0,equipment=0,povAimed=0;
const tick={actorsById:new Map(),running:true,performance:{now:()=>500},cutsceneRotLastT:0,furniturePlayback:null,povShot:{source:actor,targetProvider:()=>new V(2,1,1)},_aimNeckAtWorldPoint(_neck,_root,_height,_target,_yaw,pitch){if(pitch===60)povAimed++;else aimed++;},_npcFaceWorldPosition:walker=>walker.root?.position || new V(),externallyDrivenActorIds:new Set(),actorStates:new Map([['actor',st]]),entities:new Map([['actor',actor]]),desiredFacingDeg:new Map(),THREE:{MathUtils:{degToRad:n=>n*Math.PI/180}},applyState(){},resolveActorSeat:()=>({facingRad:0}),cutscenePreviewDialogueSpeaker:speaker,dialogueAddressedActorId:'actor',_aimNeckAtEyeContact(){aimed++;},npcDialogueStagingConfig:()=>({}),window:{NpcHeldEquipment:{updateCutsceneWalker(){equipment++;}}},requestAnimationFrame(){}};
const tickStart=game.indexOf('        function cutsceneRotationTick()'),tickEnd=game.indexOf('\n        cutsceneRotationTick();',tickStart);
vm.runInNewContext(game.slice(tickStart,tickEnd)+'\ncutsceneRotationTick();',tick);
assert.equal(st.proneBlend,.5);assert.equal(aimed,0);assert.equal(equipment,1);assert.equal(povAimed,1);
// Standing Jubmir reads the downed head after all actor poses update, even when he precedes the player in map order.
speaker.walker.root=speaker.root;speaker.walker.neckJoint={};speaker.walker.applyFacingDeadzone=()=>{};
tick.povShot=null;tick.actorStates=new Map([['jubmir',{pose:'standing',rotation:0}],['player',st]]);
tick.entities=new Map([['jubmir',speaker],['player',actor]]);tick.actorsById=new Map([['jubmir',{lookAtActorId:'player'}]]);
tick.cutscenePreviewDialogueSpeaker=speaker;tick.dialogueAddressedActorId='player';
let posedHeadY=1, jubmirTargetY;
tick.applyState=id=>{if(id==='player')posedHeadY=.2;};
tick._npcFaceWorldPosition=walker=>new V(0,walker===actor.walker?posedHeadY:1,0);
tick._aimNeckAtWorldPoint=(neck,root,height,target)=>{if(neck===speaker.walker.neckJoint)jubmirTargetY=target.y;};
vm.runInNewContext(game.slice(tickStart,tickEnd)+'\ncutsceneRotationTick();',tick);
assert.equal(jubmirTargetY,.2,'Jubmir looks down at the current prone head, not standing-height fallback');
// Procedural camera providers remain live through the canonical camera authority.
const cameras={window:{},performance:{now:()=>0}};
vm.runInNewContext(read('docs/js/cinematic-camera-runtime.js'),cameras);
const origin=new V(1,2,3),target=new V(4,2,6);
cameras.window.CinematicCameraRuntime.activate('office',{id:'pov',positionProvider:()=>origin,targetProvider:()=>target});
origin.x=2;target.z=7;
assert.equal(cameras.window.CinematicCameraRuntime.resolvedPosition().x,2);
const originalRecord=cameras.window.CinematicCameraRuntime.activeRecord();
cameras.performance.now=()=>500;
cameras.window.CinematicCameraRuntime.activate('office',{id:'pov',positionProvider:()=>origin,targetProvider:()=>target});
assert.equal(cameras.window.CinematicCameraRuntime.activeRecord(),originalRecord,'same view retains its blend record');
assert.equal(originalRecord.activatedAt,0);
assert.equal(cameras.window.CinematicCameraRuntime.resolvedTarget().z,7);
// Execute the actual POV camera card, including visibility restoration and live actor providers.
actor.walker.avatarGroup = {visible:true};
speaker.walker.root = speaker.root;
const povStage={id:'view',type:'camera',cameraMode:'pov',actorId:'actor',targetActorId:'speaker',duration:0};
const shotContext={running:true,povShot:null,payload:{},entities:new Map([['actor',actor],['speaker',speaker]]),stagesById:new Map([['view',povStage]]),area:'office',report(){},window:cameras.window,THREE:{Vector3:V},_npcFaceWorldPosition:walker=>new V(walker.root.position.x,walker.root.position.y+1,walker.root.position.z),setTimeout:f=>f(),continueTo(){},getResolvedNext(){return null;}};
const clearStart=game.indexOf('        const clearPovShot ='),clearEnd=game.indexOf('\n',clearStart);
const stageStart=game.indexOf('        function runStage(stageId)'),stageEnd=game.indexOf('        function runMove(stage)',stageStart);
vm.runInNewContext(game.slice(clearStart,clearEnd)+game.slice(stageStart,stageEnd)+'\nrunStage("view"); exitPov=clearPovShot;',shotContext);
assert.equal(actor.walker.avatarGroup.visible,false);
actor.root.position.x=3;speaker.root.position.z=4;
assert.equal(cameras.window.CinematicCameraRuntime.resolvedPosition().x,3);
assert.equal(cameras.window.CinematicCameraRuntime.resolvedTarget().z,4);
shotContext.exitPov();assert.equal(actor.walker.avatarGroup.visible,true);
// The reticle owner suppresses every ordinary mesh before checking tools or tiles.
const meshes=[{visible:true},{visible:true},{visible:true},{visible:true}];
const hud={cutscenePreviewActive:true,reticleMesh:meshes[0],reticleCircleMesh:meshes[1],reticleRingMesh:meshes[2],reticleWavyGroup:meshes[3],clearTargetHighlights(){}};
const hudStart=game.indexOf('      function updateReticleMesh()'),hudEnd=game.indexOf('        const reticle =',hudStart);
vm.runInNewContext(game.slice(hudStart,hudEnd)+'}\nupdateReticleMesh();',hud);
assert(meshes.every(mesh=>!mesh.visible));
console.log('Director round-trip, furniture interpolation/restoration, smooth poses, gaze, equipment cadence, procedural POV and HUD suppression passed');

// Execute the authored shot path: its interpolated position must pass through the existing camera boom.
V.prototype.lerpVectors=function(a,b,t){return this.copy(a).lerp(b,t);};
let boomCalls=0;
const shot={id:'wall',position:{x:8,y:2,z:0},target:{x:0,y:1,z:0},blendSeconds:0,fovDeg:50};
const shotCamera={position:new V(10,2,0),fov:55,lookAt(){},updateProjectionMatrix(){}};
const boomContext={window:{CinematicCameraRuntime:{activeRecord:()=>({areaId:'office',camera:shot,activatedAt:0}),resolvedPosition:()=>shot.position,resolvedTarget:()=>shot.target},FormatUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}},performance:{now:()=>0},camera:shotCamera,_cinematicCameraBlend:null,_lastCameraLookPoint:new V(),_cinematicDesiredPosition:new V(),_cinematicDesiredTarget:new V(),_cinematicLookTarget:new V(),THREE:{MathUtils:{lerp:(a,b,t)=>a+(b-a)*t}},cameraContainerAspect:()=>1,occlusionSafeCameraPosition(x,y,z,ix,iy,iz){boomCalls++;assert.equal(ix,8);return{x:2,y:iy,z:iz};}};
const boomStart=game.indexOf('      function applyAuthoredCinematicCamera()'),boomEnd=game.indexOf('      // threeContainer',boomStart);
vm.runInNewContext(game.slice(boomStart,boomEnd)+'\napplyAuthoredCinematicCamera();',boomContext);
assert.equal(boomCalls,1);assert.equal(shotCamera.position.x,2,'cinematic shots render at the collision-safe boom position');
