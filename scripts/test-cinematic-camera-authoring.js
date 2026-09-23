const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const banubu = require('../docs/config/locales/locale_banubu_cave_interior.json');

function parseInlineScripts(filePath) {
  const source = read(filePath);
  const chunks = source.split('<script').slice(1);
  let parsed = 0;
  for (const chunk of chunks) {
    const openEnd = chunk.indexOf('>');
    const close = chunk.indexOf('</script>', openEnd + 1);
    if (openEnd < 0 || close < 0) continue;
    const attrs = chunk.slice(0, openEnd);
    if (/\bsrc\s*=/.test(attrs) || /application\/(?:json|ld\+json)/i.test(attrs)) continue;
    const code = chunk.slice(openEnd + 1, close);
    if (!code.trim()) continue;
    new vm.Script(code, { filename: filePath + '#inline-' + parsed });
    parsed++;
  }
  assert(parsed > 0, filePath + ' should contain parseable inline JavaScript');
}

const runtimeSource = read('docs/js/cinematic-camera-runtime.js');
const indexSource = read('docs/index.html');
const gameSource = read('docs/game.js');
const generatorSource = read('docs/js/cavern-generator.js');
const wildernessSource = read('docs/js/wilderness-map-generator.js');
const builderSource = read('docs/js/interior-scene-builder.js');
const mapEditorSource = read('docs/tools/map-editor/index.html');
const localeEditorSource = read('docs/tools/locale-editor/index.html');
const localePreview3dSource = read('docs/tools/locale-editor/locale-preview3d.js');
const directorSource = read('docs/tools/cutscene-director/index.html');

for (const [label, source] of [
  ['cinematic camera runtime', runtimeSource],
  ['wilderness map generator', wildernessSource],
  ['cavern generator', generatorSource],
  ['interior scene builder', builderSource],
  ['dialogue content', read('docs/js/dialogue-content.js')],
  ['game runtime', gameSource],
]) {
  new vm.Script(source, { filename: label });
}

const runtimeLoad = indexSource.indexOf('src="js/cinematic-camera-runtime.js');
const dialogueLoad = indexSource.indexOf('src="js/dialogue-content.js');
assert(runtimeLoad >= 0 && dialogueLoad >= 0 && runtimeLoad < dialogueLoad, 'cinematic camera runtime must load before DialogueContent');
assert(gameSource.includes('window.CinematicCameraRuntime?.init?.({'), 'game must initialize the cinematic camera runtime');
assert(gameSource.includes('window.CinematicCameraRuntime?.beginDialogue?.({'), 'ordinary NPC dialogue must activate authored dialogue cameras');
assert(gameSource.includes('window.CinematicCameraRuntime?.endDialogue?.();'), 'closing dialogue must release authored dialogue cameras');
const closeDialogueStart = gameSource.indexOf('function closeNpcDialogue()');
const closeDialogueEnd = gameSource.indexOf('// renderRelationshipHearts now lives', closeDialogueStart);
const closeDialogueBlock = gameSource.slice(closeDialogueStart, closeDialogueEnd);
assert(closeDialogueStart >= 0 && closeDialogueEnd > closeDialogueStart && closeDialogueBlock.includes('_snapCameraTarget();'), 'closing dialogue must snap the normal follow target back to the staged player before gameplay camera resumes');
assert(gameSource.includes('window.CinematicCameraRuntime?.update?.(dt);'), 'pet fading must use the existing gameplay frame driver');
assert(runtimeSource.includes('function resolvedTargetFor(') && runtimeSource.includes('targetNpcId'), 'cinematic runtime must support NPC-targeted face-relative camera records');
assert(gameSource.includes('getNpcFacePosition: walker =>') && gameSource.includes('_npcFaceWorldPosition(walker)'), 'camera runtime hook must resolve the NPC\'s live visible face rather than a raw station/root point');
assert(gameSource.includes('PNGPlaneAvatar.resolveSkinnedPixelWorldPosition(walker.avatarGroup, centroid)'), 'humanoid camera targets must follow the live skinned head centroid');
assert(gameSource.includes('AnimalChatheadFrame?.frameCenterForKind?.(kind)') && gameSource.includes('avatarRef.headRig?.frontHeadBone'), 'named-animal camera targets must use the authored species face frame and live head bone');
assert(gameSource.includes('AnimalSleepPresentation?.forceHeadDown?.(avatarRef, walker)') && gameSource.indexOf('AnimalSleepPresentation?.forceHeadDown?.(avatarRef, walker)') < gameSource.indexOf('const headBone = avatarRef.headRig?.frontHeadBone'), 'sleep head pose must be applied before the named-animal face point is resolved');
assert(gameSource.includes('walker._animalSleepRequested === true') && gameSource.includes('projectExternalSleeperWorldPoint(walker, face)'), 'sleeping named-animal camera targets must project through the exact render-time sleep transform');
assert(gameSource.includes('CinematicCameraRuntime?.resolvedTarget?.()'), 'authored camera application must resolve a live NPC target every frame');
assert(localeEditorSource.includes('id="cinTargetNpc"') && localeEditorSource.includes('Face offset X'), 'Locale Editor must author NPC targets with face-offset fields');
assert(mapEditorSource.includes('id="cinTargetNpc"') && mapEditorSource.includes('Face offset X'), 'Map Editor must author the same generic NPC face-target camera schema');
assert(localePreview3dSource.includes('id="localeCameraTargetNpc"') && localePreview3dSource.includes('resolvedPreviewCameraTarget'), 'Locale 3D preview must edit and resolve NPC face-relative camera targets');
assert(!runtimeSource.includes('requestAnimationFrame('), 'camera runtime must not add another frame loop');

const finishBlock = gameSource.match(/const finish = message => \{[\s\S]*?\n        \};/);
assert(finishBlock && finishBlock[0].includes('CinematicCameraRuntime?.deactivate?.()'), 'cutscene finish must release a fixed camera');
assert(gameSource.includes("if (stage.type === 'camera') return runCamera(stage);"), 'runtime cutscene playback must support Camera cards');
assert(gameSource.includes("reason: 'cutscene'"), 'runtime Camera cards must activate through the shared camera runtime');

assert(generatorSource.includes('cinematicCameras: Array.isArray(locale.cinematicCameras)'), 'locale cavern synthesis must preserve authored camera records');
assert(gameSource.includes('registerArea?.(mapId, mapData.cinematicCameras || [])'), 'building/cavern scenes must register authored cameras');
assert(gameSource.includes('cavernMaterialOpts.doubleSided = mapData.isLocaleCavern === true'), 'only authored locale caverns should opt into the double-sided shell fix');
assert(builderSource.includes('options.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide'), 'cavern mesh builder must honor authored double-sided shells');

assert(wildernessSource.includes('const toWorldContinuous = (col, row)'), 'stamped locale cameras need a non-snapping coordinate transform');
assert(wildernessSource.includes('const worldP = toWorldContinuous('), 'camera positions must retain fractional coordinates after Tothal scaling');
assert(wildernessSource.includes('const npcTargeted = !!camera.targetNpcId'), 'stamped locale cameras must distinguish NPC face-relative targets from absolute map targets');
assert(wildernessSource.includes('neither locale translation nor Tothal density scaling'), 'NPC face-relative target offsets must stay in live NPC/world units rather than being transformed like locale coordinates');
assert(wildernessSource.includes('const worldStage = toWorldContinuous('), 'player staging points must retain fractional coordinates after Tothal scaling');

for (const [label, source] of [['Map Editor', mapEditorSource], ['Locale Editor', localeEditorSource]]) {
  assert(source.includes('showCinematicCameras'), label + ' needs the camera-marker visibility checkbox');
  assert(source.includes('cinematicCameras'), label + ' must round-trip cinematic camera data');
  assert(source.includes('🎥'), label + ' must render visible cinematic camera markers');
}
assert(directorSource.includes('stage.type === "camera"'), 'Cutscene Director preview must dispatch Camera cards');
assert(directorSource.includes('cinematicCameraSelectHtml'), 'Cutscene Director must offer authored camera IDs');
assert(directorSource.includes('runCameraStage'), 'Cutscene Director must preview authored camera shots');
assert(localePreview3dSource.includes('id="localeCameraSliderPanel"'), 'Locale Editor 3D preview must expose in-shot camera sliders');
assert(localeEditorSource.includes('updateCinematicCamera: (localeId, cameraId, next) =>'), 'Locale Editor must persist preview-slider camera edits through its workspace bridge');
assert(localeEditorSource.includes('cinematicCameras: m.cinematicCameras || []'), 'Locale Editor export must retain authored cinematic cameras');

parseInlineScripts('docs/tools/map-editor/index.html');
parseInlineScripts('docs/tools/locale-editor/index.html');
parseInlineScripts('docs/tools/cutscene-director/index.html');

const stations = new Map((banubu.npcAnchors || []).map(station => [station.id, station]));
const sleepStation = stations.get('station_banubu_cave_sleep');
const banubuStations = (banubu.npcAnchors || []).filter(station => station.npcId === 'banubu');
const cameras = new Map((banubu.cinematicCameras || []).map(camera => [camera.id, camera]));
const awakeCamera = cameras.get('banubu_dialogue_awake');
const sleepCamera = cameras.get('banubu_dialogue_sleep');
assert.strictEqual(banubuStations.length, 1, 'Banubu is one NPC with one physical station; awake/sleep are presentation states, not duplicate NPC anchors');
assert(sleepStation && sleepStation.pose === 'lie', 'Banubu must retain his one schedule-driven sleeping station');
assert.deepStrictEqual({ col: sleepStation.col, row: sleepStation.row }, { col: 6, row: 5 }, 'latest authored Banubu cavern export must place his one real sleeping station at the edited anchor');
assert(!stations.has('station_banubu_cave_awake'), 'the stale unused awake Banubu station must stay removed');
assert(awakeCamera && sleepCamera, 'Banubu still needs separate awake and sleeping dialogue shots');
for (const camera of [awakeCamera, sleepCamera]) {
  assert.strictEqual(camera.targetNpcId, 'banubu', camera.id + ' must target the live Banubu NPC');
  assert.strictEqual(camera.targetAnchorId, 'station_banubu_cave_sleep', camera.id + ' preview hint must point at Banubu\'s one physical station');
  assert.deepStrictEqual(camera.target, { x: 0, y: 0, z: 0 }, camera.id + ' target transform must start as a neutral face-relative offset');
  assert(camera.position.y < 0.5, camera.id + ' should remain near ground level');
  assert.strictEqual(camera.fadePets, true);
  assert(Number.isFinite(camera.playerStage?.x) && Number.isFinite(camera.playerStage?.z), camera.id + ' needs an authored off-shot player staging point');
}
assert.strictEqual(sleepCamera.dialogueNpcId, 'banubu', 'sleeping Banubu shot should be the automatic dialogue camera');
assert.strictEqual(awakeCamera.dialogueNpcId, '', 'awake Banubu shot should only activate explicitly from dialogue content');
assert.deepStrictEqual(sleepCamera.position, { x: 7.6, y: -0.78, z: 8.3 }, 'repo camera must preserve the user\'s latest sleeping-shot position while discarding the old absolute target');
assert.strictEqual(sleepCamera.fovDeg, 57, 'repo camera must preserve the latest authored sleeping-shot FOV');
assert.deepStrictEqual(awakeCamera.position, { x: 7.2, y: 0.28, z: 9.4 }, 'awake shot must be translated with the removed awake anchor so it keeps its original composition around the one real Banubu');
assert.deepStrictEqual(awakeCamera.playerStage, { x: 6.5, z: 10.5 }, 'awake player staging must move with the translated awake composition');

// Execute the real browser runtime in a tiny VM to cover camera selection,
// node-level camera swaps, player staging lookup, and pet fade/restore.
const context = {
  console,
  Math,
  Map,
  Set,
  WeakMap,
  JSON,
  performance: { now: () => 1234 },
};
context.window = context;
vm.createContext(context);
vm.runInContext(runtimeSource, context, { filename: 'cinematic-camera-runtime.js' });

const player = { id: 'player' };
const material = {
  opacity: 1,
  transparent: false,
  depthWrite: true,
  needsUpdate: false,
  clone() { return { ...this, clone: this.clone }; },
};
const petMesh = { isMesh: true, material, parent: {} };
const petRoot = { traverse(fn) { fn(petMesh); } };
const pet = { health: 10, areaId: 'map_i_den_banubu', master: player, stableRole: 'companion', avatarRef: { group: petRoot } };
const banubuWalker = {
  rec: { id: 'banubu' },
  root: { position: { x: 9.5, y: -0.95, z: 7.5 } },
  avatarHeight: 3,
  currentScheduleTarget: { stationId: 'station_banubu_cave_sleep' },
};
context.CinematicCameraRuntime.init({
  getCurrentArea: () => 'map_i_den_banubu',
  getCompanionObjects: () => [pet],
  getPlayer: () => player,
  getNpcWalker: npcId => npcId === 'banubu' ? banubuWalker : null,
  getNpcFacePosition: walker => ({ x: walker.root.position.x, y: walker.root.position.y + 2.25, z: walker.root.position.z }),
});
context.CinematicCameraRuntime.registerArea('map_i_den_banubu', banubu.cinematicCameras);

const selected = context.CinematicCameraRuntime.beginDialogue({
  areaId: 'map_i_den_banubu',
  npcId: 'banubu',
  walker: banubuWalker,
});
assert.strictEqual(selected.camera.id, 'banubu_dialogue_sleep', 'Banubu dialogue should automatically select the one authored default sleeping shot');
assert.strictEqual(context.CinematicCameraRuntime.currentPlayerStage().z, sleepCamera.playerStage.z);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.CinematicCameraRuntime.resolvedTarget())),
  { x: 9.5, y: 1.3, z: 7.5 },
  'NPC-targeted camera must resolve target transform from the live face plus authored offset'
);
banubuWalker.root.position.x = 10.25;
assert.strictEqual(context.CinematicCameraRuntime.resolvedTarget().x, 10.25, 'NPC-targeted camera must keep following the live face after the NPC moves');

for (let i = 0; i < 30; i++) context.CinematicCameraRuntime.update(0.1);
assert(petMesh.material.opacity < 0.01, 'active Banubu shot should fade player pets out');

context.CinematicCameraRuntime.applyDialogueNodeCamera({ cameraId: 'banubu_dialogue_awake' });
assert.strictEqual(context.CinematicCameraRuntime.activeCamera().id, 'banubu_dialogue_awake', 'dialogue nodes should be able to swap authored cameras');
assert.strictEqual(context.CinematicCameraRuntime.resolvedTarget().x, 10.25, 'awake shot must keep targeting the same live Banubu face rather than a second NPC/station');

context.CinematicCameraRuntime.endDialogue();
for (let i = 0; i < 30; i++) context.CinematicCameraRuntime.update(0.1);
assert.strictEqual(petMesh.material, material, 'ending dialogue should restore the exact original pet material object');
assert(Math.abs(petMesh.material.opacity - 1) < 0.01, 'ending dialogue should fade player pets back in');
assert.strictEqual(context.CinematicCameraRuntime.isActive(), false);

console.log('Cinematic camera runtime, Banubu staging, editor authoring, and cutscene integration checks passed');
