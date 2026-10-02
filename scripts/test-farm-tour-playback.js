'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync('docs/game.js','utf8'); // Executes the shipping choice, camera and move handlers together.
const storySource = fs.readFileSync('docs/js/opening-story-cutscene.js','utf8');
const story = {window:{},document:{addEventListener(){}},console};
vm.runInNewContext(storySource,story);
const select = (start,end) => game.slice(game.indexOf(start),game.indexOf(end,game.indexOf(start))); // Extracts owning runner closures without rebuilding their implementation.
const pointsContext = {player:{x:1.5,y:1.5},TILE:1,COLS:36,ROWS:26,grid:Array.from({length:26},()=>Array.from({length:36},()=>({type:'grass'}))),isSolid:()=>false,getWorldObjectAt:()=>null,cameraContainerAspect:()=>16/9,window:{FarmhouseLoginSpawn:{frontDoor:()=>({approach:{c:5,r:4}})}}}; // Exercises the actual farm door and south-shot authoring seam.
vm.runInNewContext(select('      function openingFarmTourPoints() {','      window.AuthoredCutsceneRuntime')+'\npoints = openingFarmTourPoints();',pointsContext);
const points = pointsContext.points;
assert.equal(points.camera.position.z,25.5);
assert(points.camera.target.z<points.camera.position.z,'south camera looks north');
assert.equal(points.camera.fovDeg,75);
assert.equal(points.camera.blendSeconds,1.25);
const desktopHeight = points.camera.position.y; // Narrow phone displays retain the farmhouse/yard width with additional camera height.
pointsContext.cameraContainerAspect=()=>9/16;
vm.runInNewContext('phonePoints = openingFarmTourPoints();',pointsContext);
assert(pointsContext.phonePoints.camera.position.y>desktopHeight);
for (const [shot, aspect] of [[points.camera,16/9],[pointsContext.phonePoints.camera,9/16]]) {
  const dy = shot.target.y - shot.position.y, dz = shot.target.z - shot.position.z; // Builds the north-facing camera basis from the authored shot.
  const distance = Math.hypot(dy,dz), fy = dy/distance, fz = dz/distance;
  const halfFov = Math.tan(shot.fovDeg*Math.PI/360); // All farm corners, including an eight-tile roof allowance, must project inside both screen dimensions.
  for(const x of [0,36]) for(const z of [0,26]) for(const y of [0,8]) {
    const relativeY = y-shot.position.y, relativeZ = z-shot.position.z;
    const depth = relativeY*fy+relativeZ*fz;
    const vertical = relativeY*(-fz)+relativeZ*fy;
    assert(depth>0&&Math.abs(vertical)/depth<halfFov&&Math.abs(x-shot.position.x)/(depth*aspect)<halfFov,'wide shot contains the full farmhouse/yard envelope on desktop and phone');
  }
}
const ui = () => ({textContent:'',style:{},classList:{add(){},remove(){}},setAttribute(){}}); // Minimal dialogue elements; camera/movement state remains real.
async function playChoice(index) {
  const scene = story.window.OpeningStoryCutscene.buildFarmTourScene(new Map(),{nickname:'Farmer'},points); // Both responses must enter the same successful navigation sequence.
  const frames = []; // Runs bounded movement RAFs deterministically, without a browser or real-time waits.
  const visited = new Map(); // Captures every actual path hop consumed by the runner.
  let choices = [];
  let clock = 0;
  let activations = 0;
  const context = {window:{},performance:{now:()=>clock},requestAnimationFrame:fn=>frames.push(fn),console,area:'farm',payload:scene,runtimeOptions:{},running:true,dialogueOpen:false,cinematicCameraReady:false,cutscenePreviewStageId:null,cutscenePreviewAdvance:null,cutscenePreviewDialogueSpeaker:null,_dialogueWalker:null,activeCameraMode:'initial',activeCameraTarget:null,idleCameraMode:'idle',idleCameraTarget:null,dlgModeKey:'dialogue',dlgModeKeyCreature:'creature',_npcDialogueNameEl:ui(),_npcDialogueHeartsEl:ui(),_npcDialogueEl:ui(),_arcContainerEl:ui(),report(){},isNpcTileWalkable:(_area,c,r)=>c>=0&&r>=0&&c<36&&r<26&&!(c===3&&r===2),externallyDrivenActorIds:new Set(),desiredFacingDeg:new Map(),stagesById:new Map(scene.stages.map(stage=>[stage.id,stage])),stageOrder:scene.stages.map(stage=>stage.id),actorsById:new Map(scene.actors.map(actor=>[actor.id,actor])),actorStates:new Map(scene.actors.map(actor=>[actor.id,{c:actor.worldC,r:actor.worldR,rotation:0}])),entities:new Map(scene.actors.map(actor=>[actor.id,{kind:'npc',walker:{},root:{position:{x:actor.worldC+.5,y:0,z:actor.worldR+.5}}}])),showChoiceOptions:options=>{choices=options;},finish(){context.running=false;}};
  vm.runInNewContext(fs.readFileSync('docs/js/tile-pathfinding.js','utf8'),context);
  vm.runInNewContext(fs.readFileSync('docs/js/cinematic-camera-runtime.js','utf8'),context);
  const activate = context.window.CinematicCameraRuntime.activate; // Count transitions while retaining the real shared camera normalizer and activation timestamps.
  context.window.CinematicCameraRuntime.activate=(...args)=>{activations++;return activate(...args);};
  context.advanceActorToward=(id,x,z)=>{
    assert(Number.isFinite(x)&&Number.isFinite(z),'pathfinder col/row produces finite walker destinations');
    const tile = {col:x-.5,row:z-.5}; // First returned hop is already outside the starting tile.
    assert(context.isNpcTileWalkable('farm',tile.col,tile.row),'tour respects obstacles');
    if (!visited.has(id)) visited.set(id,[]);
    visited.get(id).push(tile);
    Object.assign(context.actorStates.get(id),{c:tile.col,r:tile.row});
    return true;
  };
  vm.runInNewContext(select('        const getResolvedNext =','        const angleTowardState')+select('        async function openLine(','        function showChoiceOptions(')+select('        function continueTo(','        function runAnimation('),context);
  context.runStage('farm_intro');
  await Promise.resolve();
  assert.equal(activations,0,'opening line retains the initial speaker angle');
  context.cutscenePreviewAdvance();
  await Promise.resolve();
  assert.equal(context.cutscenePreviewStageId,'farm_choice');
  assert.equal(activations,1,'first dialogue Continue activates the wide camera blend');
  assert.equal(context.window.CinematicCameraRuntime.activeRecord().camera.blendSeconds,1.25);
  choices[index].onClick();
  for(let i=0;frames.length&&i<100;i++){clock+=16;frames.shift()();}
  assert.equal(frames.length,0,'navigation terminates');
  assert.equal(context.cutscenePreviewStageId,'farm_house','both initial choices continue to the house dialogue');
  for(const [id,target] of [['spearhead',points.porch],['player',points.playerPorch]]) {
    const path = context.window.TilePathfinding.findPath(scene.actors.find(actor=>actor.id===id).worldC,scene.actors.find(actor=>actor.id===id).worldR,target.c,target.r,(c,r)=>context.isNpcTileWalkable('farm',c,r),{bounds:context.window.TilePathfinding.boxAround(0,0,target.c,target.r,8)});
    assert.deepEqual(JSON.parse(JSON.stringify(visited.get(id))),JSON.parse(JSON.stringify(path)),'every hop, including the first, is visited');
  }
  assert.equal(activations,1,'later dialogue does not restart or replace the fixed wide shot');
  context.cutscenePreviewAdvance(); await Promise.resolve();
  choices[0].onClick(); await Promise.resolve();
  assert.equal(context.cutscenePreviewStageId,'farm_tour_final');
  context.cutscenePreviewAdvance();
  assert.equal(context.running,false,'tour reaches final Continue and finishes');
}
// Exercise actual visibility capture and the shared cleanup used by both finish() and setup-failure handling.
const playerMesh = {visible:true,position:{copy(){}},updateMatrixWorld(){}};
const toolHolder = {visible:false,position:{copy(){}},quaternion:{copy(){}},updateMatrixWorld(){}};
const playerGroundShadow = {visible:true};
const heldItemHolder = {visible:true};
const visibility = {liveMode:true,payload:{actors:[{isPlayer:true}]},playerMesh,toolHolder,playerGroundShadow,heldItemHolder,runtimeOptions:{},entities:new Map(),currentArea:'farm',previousArea:'farm',previousBuildingMapId:null,previousPlayerParent:{add(){}},previousToolParent:{add(){}},previousToolPosition:{},previousToolQuaternion:{},window:{}}; // Cleanup should restore hidden and previously visible nodes to their own original values.
const hiddenSource = select('        const hiddenLivePlayerNodes =','        const hiddenLiveWalkers =');
const restoreStart = game.indexOf('        const restoreLiveGameplay = () => {');
const restoreEnd = game.indexOf('}; // One cleanup path',restoreStart)+2;
vm.runInNewContext(hiddenSource+game.slice(restoreStart,restoreEnd),visibility);
assert([playerMesh,playerGroundShadow,toolHolder,heldItemHolder].every(node=>!node.visible),'gameplay avatar/shadow/held visuals hide under the stand-in');
vm.runInNewContext('restoreLiveGameplay();',visibility);
assert.equal(playerMesh.visible,true);assert.equal(playerGroundShadow.visible,true);assert.equal(toolHolder.visible,false);assert.equal(heldItemHolder.visible,true);
Promise.all([playChoice(0),playChoice(1)]).then(()=>console.log('Farm tour: both choices finish; every col/row hop, restored visibility and deferred south-camera blend passed.')).catch(error=>{console.error(error);process.exitCode=1;});
