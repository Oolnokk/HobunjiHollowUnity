'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8'); // Tests execute the shipping story and camera authorities.
const story = read('docs/js/opening-story-cutscene.js');
const game = read('docs/game.js');
const db = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json'));
const room = JSON.parse(read('docs/config/maps/map_i_temple_basement_hunundi.json'));
const saved = new Map(); // Durable state belongs to the world rather than one character.
const calls = []; // Holds tour payloads until the actual Continue callback is exercised.
let finish = null;
const profile = {characterId:'owner-a',worldId:'new-world',isWorldOwner:true};
const context = {window:{__hobunjiPlayerProfile:profile,__hobunjiGameStarted:true,LocalDBOverrides:{loadDatabase:async()=>db},AuthoredCutsceneRuntime:{farmTourPoints:()=>({entry:{c:2,r:3},guide:{c:3,r:3},porch:{c:8,r:9},playerPorch:{c:7,r:9}}),run(scene,options){calls.push({scene,options});return new Promise(resolve=>{finish=resolve;});}}},document:{addEventListener(){},getElementById(){return null;}},localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},requestAnimationFrame:fn=>fn(),queueMicrotask(){},performance:{now:()=>0},setTimeout,clearTimeout,console,fetch(){throw Error('unexpected fetch');}};
vm.runInNewContext(story,context);
const api = context.window.OpeningStoryCutscene; // Uses the public surface called by farm-entry travel and owner login.
const records = new Map(db.npcs.map(record=>[record.id,record]));
for (const scene of [api.buildRescueScene(records,profile),api.buildHunundiMeetingScene(records,profile),api.buildFarmTourScene(records,profile,context.window.AuthoredCutsceneRuntime.farmTourPoints())]) {
  assert(!scene.stages.some(stage=>stage.type==='talk'&&stage.speakerId==='player'),'the player never speaks a forced NPC line');
  for (const stage of scene.stages.filter(stage=>stage.type==='choice')) assert(stage.options.length>=2);
}
const meeting = api.buildHunundiMeetingScene(records,profile); // Company introduction must distinguish it from the empire.
assert.match(meeting.stages.find(stage=>stage.id==='meeting_hark_intro').text,/the Imperial Khanibarri Mining Company/);
for (const stage of meeting.stages.filter(stage=>stage.id!=='meeting_hark_intro')) assert(!/Khan+ibarri/i.test(stage.text||''));
assert.equal(db.npcs.find(record=>record.id==='khannibarri_agent').appearance.speciesId,'mammakhbuur');
assert.equal(api.needsTempleArrival(profile),true);
assert.equal(api.canEnterWilderness(profile),false);
assert.equal(api.canEnterWilderness({...profile,isWorldOwner:false}),true);
assert.equal(api.stateKey({...profile,characterId:'owner-b'}),api.stateKey(profile));
assert.equal(api.tourKey({...profile,characterId:'owner-b'}),api.tourKey(profile));
// Execute the common live cleanup on a scene switch; rig disposal and matrix invalidation happen before hand synchronization.
const events = []; // Captures ownership changes, including the active scene seen by the hand driver.
const root = {parent:{remove(){events.push('remove');}},position:{x:8.5,y:0,z:9.5},rotation:{y:0}};
const transform = () => ({copy(){events.push('copy');}}); // Minimal Three-style pose copying for restored player/tool parents.
const cleanup = {furniturePlayback:null,liveMode:true,hiddenLivePlayerNodes:[],runtimeOptions:{},entities:new Map([['player',{root,walker:{legs:{dispose(){events.push('legs');}},avatarGroup:{}}}]]),despawnCreature(){},currentArea:'map_i_temple_basement_hunundi',previousArea:'farm',_currentBuildingMapId:'map_i_temple_basement_hunundi',previousBuildingMapId:null,previousPlayerParent:{add(){events.push('playerParent');}},previousToolParent:{add(){events.push('toolParent');}},previousToolPosition:{},previousToolQuaternion:{},playerMesh:{position:transform(),updateMatrixWorld(){events.push('playerMatrix');}},toolHolder:{position:transform(),quaternion:transform(),updateMatrixWorld(){events.push('toolMatrix');}},window:{PNGPlaneAvatar:{disposeAvatarModel(){events.push('handsDisposed');}},CinematicCameraRuntime:{deactivate(){}},WeaponToolStances:{invalidateHolderMatrixWorld(){events.push('invalidate');}},ProceduralHandFrameDriver:{syncNow(){assert.equal(cleanup.currentArea,'farm');events.push('sync');}}}};
const cleanupStart = game.indexOf('        const restoreLiveGameplay = () => {');
const cleanupEnd = game.indexOf('}; // One cleanup path',cleanupStart)+2;
vm.runInNewContext(game.slice(cleanupStart,cleanupEnd)+'\nrestoreLiveGameplay();',cleanup);
assert.equal(cleanup.entities.size,0);
assert(events.indexOf('handsDisposed')<events.indexOf('sync'));
assert(events.indexOf('invalidate')<events.indexOf('sync'));
// One wall-mounted camera uses the same shared runtime as Banubu and changes only its aim as the speaker moves.
assert.equal(room.cinematicCameras.length,1);
assert.equal(room.cinematicCameras[0].trackSpeaker,true);
const cameras = {window:{},performance:{now:()=>0},console};
vm.runInNewContext(read('docs/js/cinematic-camera-runtime.js'),cameras);
const camera = cameras.window.CinematicCameraRuntime;
camera.init({getNpcFacePosition:walker=>walker.root.position});
camera.registerArea(room.id,room.cinematicCameras);
const first = {root:{position:{x:8,y:1,z:9}}};
const second = {root:{position:{x:11,y:1.2,z:8}}};
camera.activate(room.id,'hunundi_office_wall',{targetWalker:first});
assert.deepEqual(JSON.parse(JSON.stringify(camera.resolvedTarget())),first.root.position);
const fixedPosition = JSON.parse(JSON.stringify(camera.activeRecord().camera.position));
camera.activate(room.id,'hunundi_office_wall',{targetWalker:second});
second.root.position.x=10;
assert.equal(camera.resolvedTarget().x,10);
assert.deepEqual(JSON.parse(JSON.stringify(camera.activeRecord().camera.position)),fixedPosition);
// Round-trip the office through the real Map Editor adapters, including the new speaker-tracking fields.
const editor = read('docs/tools/map-editor/index.html');
const adapterStart = editor.indexOf('function buildingInteriorToWorkspaceMap(');
const adapterEnd = editor.indexOf('\nfunction ',editor.indexOf('function buildBuildingInteriorMapV1(',adapterStart)+1);
const adapter = {window:{FurniturePuzzleProperties:{normalizeWiring:value=>value||{}}},clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),uid:()=> 'generated',room};
vm.runInNewContext(editor.slice(adapterStart,adapterEnd)+'\nresult = buildBuildingInteriorMapV1(buildingInteriorToWorkspaceMap(room));',adapter);
assert.deepEqual(JSON.parse(JSON.stringify(adapter.result.cinematicCameras)),room.cinematicCameras);
assert(editor.includes('id="showCinematicCameras"')&&read('docs/index.html').includes('id="mapEditShowCameras"'));
// Exercise the actual entrance resolver against live town transitions, avoiding the door trigger and solid neighbors.
const townTiles = Array.from({length:12},()=>Array.from({length:12},()=>({type:'grass'}))); // Small real-shaped grid with a blocked first candidate.
townTiles[5][6].type='rock';
const arrivals = []; // Captures the chosen outside-temple tile and outgoing tool-cache invalidation.
const temple = {townGrid:townTiles,worldTownTransitions:[{targetMapId:'map_i_temple',col:5,row:5}],buildTownScene(){},isSolid:type=>type==='rock',enterTown:(c,r)=>arrivals.push([c,r]),travelAreaKey:()=> 'town:4,5',window:{WeaponToolStances:{invalidateHolderMatrixWorld(){arrivals.push('invalidated');}}}};
const templeStart = game.indexOf('      async function placeOpeningPlayerOutsideTemple() {');
const templeEnd = game.indexOf('      function openingFarmTourPoints()',templeStart);
const arrivalPromise = vm.runInNewContext(game.slice(templeStart,templeEnd)+'\nplaceOpeningPlayerOutsideTemple();',temple);
// The normal transition picker must hide wilderness exits while retaining farm travel.
const pickerStart = game.indexOf('        const t = pool.find(x =>');
const pickerEnd = game.indexOf('        // Deliberately once per frame',pickerStart);
const picker = {area:'town',pc:2,pr:3,pool:[{area:'town',col:2,row:3,target:'zone',targetMapId:'map_southern_cloud_forest'}],_isBuildingArea:()=>false,_isZoneArea:()=>false,_playerData:profile,window:context.window};
vm.runInNewContext(game.slice(pickerStart,pickerEnd),picker);
assert.equal(picker._pendingSpotTransition,null,'locked wilderness exits offer no transition');
picker.pool=[{area:'town',col:2,row:3,target:'farm',targetCol:2,targetRow:3}];
vm.runInNewContext('{'+game.slice(pickerStart,pickerEnd)+'}',picker);
assert.equal(picker._pendingSpotTransition.target,'farm','farm remains reachable during onboarding');
async function checkTour() {
  await arrivalPromise;
  assert.deepEqual(arrivals,[[4,5],'invalidated']);
  assert.equal(await api.onFarmEntered(profile),false,'farm tour waits for the opening');
  saved.set(api.stateKey(profile),'complete');
  const pending = api.onFarmEntered(profile); // Entering the farm starts exactly one tour.
  for(let i=0;i<10&&!calls.length;i++) await Promise.resolve();
  assert.equal(calls.length,1);
  assert.equal(await api.onFarmEntered(profile),false,'concurrent travel cannot duplicate the tour');
  assert.equal(calls[0].scene.mapId,'farm');
  assert(calls[0].scene.stages.some(stage=>/mess inside/.test(stage.text||'')&&/bed was still intact/.test(stage.text||'')));
  assert.equal(api.canEnterWilderness(profile),false,'displaying final dialogue leaves gates closed');
  calls[0].options.onDialogueContinue({id:'farm_house'});
  assert.equal(api.canEnterWilderness(profile),false,'an earlier Continue does not unlock wilderness');
  finish({ok:true});
  assert.equal(await pending,false,'an interrupted tour remains incomplete');
  const retry = api.onFarmEntered(profile); // A later farm entry can replay an interrupted introduction.
  for(let i=0;i<10&&calls.length<2;i++) await Promise.resolve();
  calls[1].options.onDialogueContinue({id:'farm_tour_final'});
  assert.equal(api.canEnterWilderness({...profile,characterId:'owner-b'}),true,'completion is shared by owners in the same world');
  finish({ok:true});
  assert.equal(await retry,true);
  assert.equal(api.needsTempleArrival(profile),false);
  assert.equal(await api.onFarmEntered(profile),false,'completed worlds do not replay');
  assert.equal(api.canEnterWilderness({...profile,worldId:'another-world'}),false,'a new world has its own introduction');
  assert.equal(await api.onFarmEntered({...profile,isWorldOwner:false}),false,'farmhands do not start the owner tour');
}
checkTour().then(()=>console.log('Opening dialogue choices, world tour gates, rig cleanup, office tracking and editor round-trip passed.')).catch(error=>{console.error(error);process.exitCode=1;});
