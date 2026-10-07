'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..'); // Resolves the checked runtime/tool files from the repository root.
const panelBootstrap = fs.readFileSync(path.join(ROOT, 'docs/js/panel-ui.js'), 'utf8'); // Verifies Cutscene Director receives the repo-selector module without changing its monolithic HTML.
const selectorSource = fs.readFileSync(path.join(ROOT, 'docs/js/cutscene-director-repo-scenes.js'), 'utf8'); // Verifies the selector points at shipping builders and reuses the Director import/startup normalization paths.
const openingStorySource = fs.readFileSync(path.join(ROOT, 'docs/js/opening-story-cutscene.js'), 'utf8'); // Executes every catalog builder from the live opening-story module.
const npcDb = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/npcs/hobunji-starter-npc-database.json'), 'utf8')); // Supplies canonical NPC records while materializing all repo-selector scenes.
const hunundiRoom = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/maps/map_i_temple_basement_hunundi.json'), 'utf8')); // Pins the manually requested office camera height.

new Function(panelBootstrap); // Syntax-check the shared bootstrap as ordinary browser JavaScript.
new Function(selectorSource); // Syntax-check the injected selector before any browser-only globals are needed.

assert(panelBootstrap.includes('cutscene-director-repo-scenes.js'), 'PanelUI bootstrap must load the repo selector module.');
assert(panelBootstrap.includes('/\\/tools\\/cutscene-director\\//'), 'Repo selector loading must stay scoped to Cutscene Director.');

const selectorBrowser = {
  window: {},
  document: { readyState: 'loading', addEventListener() {} },
  location: { pathname: '/tools/cutscene-director/index.html', href: 'https://example.test/tools/cutscene-director/index.html' },
  URL,
  structuredClone,
  setTimeout,
  clearTimeout,
  console,
}; // Prevents UI initialization while still exposing the selector's public inspection/debug surface.
vm.runInNewContext(selectorSource, selectorBrowser);
const selectorApi = selectorBrowser.window.CutsceneDirectorRepoScenes;
assert(selectorApi, 'Repo selector must expose its debug/inspection API.');
assert.deepStrictEqual(Array.from(selectorApi.catalog, scene => scene.id), ['opening-rescue', 'opening-hunundi-room', 'opening-farm-tour', 'banubu-intro', 'banubu-key', 'wedding']);
assert.deepStrictEqual(Array.from(selectorApi.catalog, scene => scene.builder).filter(Boolean), ['buildRescueScene', 'buildHunundiMeetingScene', 'buildFarmTourScene']);

const farmPoints = selectorApi.authoringFarmTourPoints();
assert.deepStrictEqual(JSON.parse(JSON.stringify(farmPoints.entry)), { c: 2, r: 3 });
assert.deepStrictEqual(JSON.parse(JSON.stringify(farmPoints.porch)), { c: 8, r: 9 });
assert.strictEqual(farmPoints.camera.id, 'farm_introduction_south');
assert.strictEqual(farmPoints.camera.position.z, 25.5);
assert.strictEqual(farmPoints.camera.position.y, 17);
assert.strictEqual(farmPoints.houseCamera.id, 'farm_introduction_house');
assert.strictEqual(farmPoints.houseCamera.position.y, 3);

const storyBrowser = { window: {}, document: { addEventListener() {} }, console }; // Materializes the exact live scene builders without starting the game runtime.
vm.runInNewContext(openingStorySource, storyBrowser);
const storyApi = storyBrowser.window.OpeningStoryCutscene;
for (const { builder } of selectorApi.catalog.filter(s=>s.builder)) assert.strictEqual(typeof storyApi[builder], 'function', `OpeningStoryCutscene must publicly export ${builder}.`);

const records = new Map(npcDb.npcs.map(record => [record.id, record]));
const profile = { nickname: 'Director Test Player', characterId: 'director-test', worldId: 'director-test', isWorldOwner: true };
const scenes = [
  storyApi.buildRescueScene(records, profile),
  storyApi.buildHunundiMeetingScene(records, profile),
  storyApi.buildFarmTourScene(records, profile, farmPoints),
];

function assertSceneReferences(scene) {
  assert(Array.isArray(scene.actors) && scene.actors.length, `${scene.title} must have actors.`);
  assert(Array.isArray(scene.stages) && scene.stages.length, `${scene.title} must have stages.`);
  const actorIds = new Set(scene.actors.map(actor => actor.id));
  const stageIds = new Set(scene.stages.map(stage => stage.id));
  assert.strictEqual(actorIds.size, scene.actors.length, `${scene.title} actor ids must be unique.`);
  assert.strictEqual(stageIds.size, scene.stages.length, `${scene.title} stage ids must be unique.`);

  const requireActor = (actorId, context) => {
    if (actorId == null || actorId === '') return;
    assert(actorIds.has(actorId), `${scene.title}: ${context} references missing actor ${actorId}.`);
  };
  const requireStage = (next, context) => {
    if (!next || next === '__next__' || next === '__end__') return;
    assert(stageIds.has(next), `${scene.title}: ${context} references missing stage ${next}.`);
  };

  requireActor(scene.cameraTargetActorId, 'cameraTargetActorId');
  for (const stage of scene.stages) {
    for (const [field, actorId] of Object.entries({ speakerId: stage.speakerId, actorId: stage.actorId, targetActorId: stage.targetActorId, addressedActorId: stage.addressedActorId })) requireActor(actorId, `${stage.id}.${field}`);
    for (const actorId of stage.followActorIds || []) requireActor(actorId, `${stage.id}.followActorIds`);
    for (const actorId of stage.waitForActors || []) requireActor(actorId, `${stage.id}.waitForActors`);
    for (const participant of stage.participants || []) requireActor(participant.actorId, `${stage.id}.participants`);
    requireStage(stage.next, `${stage.id}.next`);
    requireStage(stage.lossNext, `${stage.id}.lossNext`);
    for (const option of stage.options || []) requireStage(option.next, `${stage.id}.options`);
  }
}

for (const scene of scenes) assertSceneReferences(scene);
assert.strictEqual(scenes[0].mapId, 'map_opening_cloud_forest');
assert.strictEqual(scenes[1].mapId, 'map_i_temple_basement_hunundi');
const farmScene = scenes[2];
assert.strictEqual(farmScene.title, 'Nanjiri Farmstead');
assert.strictEqual(farmScene.mapId, 'farm');
assert.strictEqual(farmScene.cinematicCamera.id, 'farm_introduction_south');
const spearhead = farmScene.actors.find(actor => actor.id === 'spearhead');
assert(spearhead && spearhead.npcId === 'spearhead_unumanuk', 'Farm scene must use canonical Spearhead.');
const followStage = farmScene.stages.find(stage => stage.id === 'farm_walk_guide');
assert(followStage && followStage.cameraMode === 'follow', 'Farm tour must retain the moving player/Spearhead follow shot.');
assert.deepStrictEqual(Array.from(followStage.followActorIds), ['player', 'spearhead']);
const houseStage = farmScene.stages.find(stage => stage.id === 'farm_house');
assert(houseStage && houseStage.cameraMode === 'authored' && houseStage.camera.id === 'farm_introduction_house', 'Farmhouse beat must retain its authored facade camera.');
assert(farmScene.stages.some(stage => stage.id === 'farm_tour_final' && stage.speakerId === 'spearhead'), 'Spearhead must finish the farm introduction.');

const wallCamera = hunundiRoom.cinematicCameras.find(camera => camera.id === 'hunundi_office_wall');
assert(wallCamera, 'Father Hunundi room must retain the hunundi_office_wall camera.');
assert.deepStrictEqual(wallCamera.position, { x: 8.5, y: 1.4, z: 6.6 }, 'Hunundi wall camera must retain the latest authored transform.');

console.log('Cutscene Director repo selector: three live scene builders, graph references, farm cameras and Hunundi camera height passed.');

// The Banubu entries use shipping dialogue, camera records and entry-node branching.
const banubu={window:{},console};
vm.runInNewContext(fs.readFileSync(path.join(ROOT,'docs/js/banubu-quest-content.js'),'utf8'),banubu);
vm.runInNewContext(fs.readFileSync(path.join(ROOT,'docs/js/banubu-cutscene-authoring.js'),'utf8'),banubu);
const locale=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/config/locales/locale_banubu_cave_interior.json'),'utf8'));
for(const id of ['banubu_intro','banubu_q1_ready']){
 const tree=banubu.window.BanubuQuestContent.dialogueTrees.find(t=>t.id===id),before=JSON.stringify(tree);
 const scene=banubu.window.BanubuCutsceneAuthoring.build(tree,records.get('banubu'),locale);
 assertSceneReferences(scene);assert.equal(scene.stages[0].id,tree.entryNode);assert.equal(scene.actors[0].worldC,6);assert.equal(scene.actors[0].worldR,5);
 assert.equal(scene.mapId,'map_i_den_banubu');assert.equal(scene.cinematicCameras.length,locale.cinematicCameras.length);
 assert.equal(JSON.stringify(tree),before,'authoring must not mutate dialogue or quest rewards');
 assert(scene.stages.every(s=>!s.banubuPresentation.commitTurnIn&&!s.banubuPresentation.commitIntroAttempt&&!s.banubuPresentation.commitQuestAction));
 if(id==='banubu_q1_ready'){
 assert.equal(scene.stages.find(s=>s.id==='banubu_q1_ready_prestand_visual').duration,.8);
 assert.equal(scene.stages.find(s=>s.id==='banubu_q1_ready_stand_visual').duration,1.6);
 const move=scene.stages.find(s=>s.id==='banubu_q1_ready_move_visual');assert.equal(move.duration,1.8);assert.equal(move.banubuPresentation.move.duration,1.6);assert.equal(move.cameraId,'banubu_dialogue_awake');
 assert.equal(scene.stages.find(s=>s.id==='banubu_q1_ready_5').cameraId,'banubu_key_ground');
 }
}
console.log('Banubu canonical branching, cameras, timed presentation and isolated quest transactions passed');

const director=fs.readFileSync(path.join(ROOT,'docs/tools/cutscene-director/index.html'),'utf8');
const sample=banubu.window.BanubuCutsceneAuthoring.build(banubu.window.BanubuQuestContent.dialogueTrees.find(t=>t.id==='banubu_q1_ready'),records.get('banubu'),locale);
const validateContext={state:{project:sample,mapMeta:{loaded:true}},npcById:id=>records.get(id),creatureById(){}};
const validateStart=director.indexOf('  function validateProject()'),validateEnd=director.indexOf('  function renderValidation(',validateStart);
vm.runInNewContext(director.slice(validateStart,validateEnd)+'\nerrors=validateProject().filter(p=>p.level==="error");',validateContext);
assert.equal(validateContext.errors.length,0,'canonical single-answer dialogue must be playable without invented options');
