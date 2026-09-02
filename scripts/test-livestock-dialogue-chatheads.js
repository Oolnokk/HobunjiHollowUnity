const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const rigWindow = {};
vm.runInNewContext(fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'), { window: rigWindow, console });
const frames = rigWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures;
const expected = {
  grehlr: [0.12899040207823892, 0.38396704728631864, 0.24202339114154608, 0.3445860779359126],
  'gar-wolf': [0, 0.2575, 0.25, 0.3575],
  'dabinggi-hound': [0.05321196485715341, 0.2621006265961596, 0.17863723264419087, 0.350903183334192],
  drenkirra: [0.1925, 0.3575, 0.2078, 0.305],
  uumkaoii: [0.009564166583519832, 0.2923510947804583, 0.4656387672084861, 0.47038721094834346],
};
for (const [kind, values] of Object.entries(expected)) {
  const frame = frames[kind]?.chatheadFrame;
  assert(frame, `${kind} must have an authored chathead frame`);
  assert.strictEqual(frame.coordinateSpace, 'sprite-normalized-top-left');
  assert.deepStrictEqual([frame.x, frame.y, frame.width, frame.height], values, `${kind} frame must match supplied export`);
}

const farm = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
const bs = farm.indexOf('function _farmAnimalGetButtons');
const be = farm.indexOf('function _farmAnimalOnAction', bs);
const buttons = farm.slice(bs, be);
const collectAt = buttons.indexOf("action: 'obj_collect_' + animal.id");
const talkAt = buttons.indexOf("action: 'obj_talk_' + animal.id");
assert(collectAt >= 0 && talkAt > collectAt, 'ready goods must be Action 1 and Talk Action 2');
assert(buttons.includes('const resourceReady ='), 'button order must explicitly depend on harvest readiness');
assert(farm.includes("if (action === 'obj_talk_' + animal.id)"), 'Talk action must route');
assert(farm.includes('deps.openLivestockDialogue?.(animal, rec, [line]);'), 'Talk must open full dialogue');
assert(farm.includes('window.AnimalVocalizations?.dialogueLinesFor?.(animal)'), 'Talk text must come from animal dialogue config');
assert(farm.includes('modelWidth: ANIMAL_W, modelHeight: ANIMAL_H'), 'rendered dimensions must be available for frame targeting');
assert(farm.includes('this._harvestFrozen || this._dialogueFrozen'), 'dialogue must freeze wandering');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert(game.includes('async function openNpcDialogue(walker, options = {})'), 'NPC dialogue shell must remain the shared entry point');
assert(game.includes('npcDialogueCameraMode()'), 'livestock must use NPC dialogue camera mode');
assert(game.includes('if (options.skipStaging !== true) beginNpcDialogueStaging(walker);'), 'shared NPC dialogue shell must retain auto-approach staging');
assert(game.includes('if (options.skipNpcMeta === true)'), 'livestock may skip NPC quest/favor/shop metadata only');
assert(game.includes('function createLivestockNpcDialogueAdapter(animal, livestockRec, kind, dialogueLines = [])'), 'livestock must adapt to the NPC walker contract');
assert(game.includes('function dialogueWalkerWorldPosition(walker, out = new THREE.Vector3())'), 'shared dialogue staging/facing needs an explicit world-position resolver');
assert(game.includes("typeof root.getWorldPosition === 'function'"), 'dialogue root resolver must use Three.js world matrices when available');
assert(game.includes('const npcWorld = dialogueWalkerWorldPosition(walker, new THREE.Vector3())'), 'dialogue auto-approach staging must use the speaker world position');
const adapterStart = game.indexOf('function createLivestockNpcDialogueAdapter');
const adapterEnd = game.indexOf('async function openLivestockDialogue', adapterStart);
const adapter = game.slice(adapterStart, adapterEnd);
assert(adapter.includes('applyFacingDeadzone(targetRot, lerp)'), 'animal adapter must implement NPC body-facing contract');
assert(adapter.includes('dialogueHeadWorldPosition(out = new THREE.Vector3())'), 'animal adapter must expose authored head world position');
assert(adapter.includes('const dialogueCameraTarget = {'), 'animal adapter must expose a live shared-camera target');
assert(adapter.includes('get position()'), 'animal camera target must resolve live each frame rather than snapshotting the head');
assert(adapter.includes('_livestockDialogueHeadWorldPosition(animal, kind, cameraHeadScratch)'), 'animal camera target must use the authored head world point');
assert(adapter.includes('applyDialogueEyeContact(targetWorld, dt)'), 'animal adapter must implement dialogue gaze math');
assert(adapter.includes('avatarRef.updateHeadYaw?.(yawDeg'), 'animal eye contact must drive authored head yaw');
assert(adapter.includes('avatarRef.updateHeadRotation?.(pitchDeg'), 'animal eye contact must drive authored head pitch');
assert(game.includes('window.AnimalChatheadFrame?.frameForKind?.(kind)'), 'animal dialogue head point must use authored chathead frame');
assert(game.includes('(centerX - 0.5) * modelWidth'), 'authored frame center X must map to animal plane space');
assert(game.includes('(0.5 - centerY) * modelHeight'), 'authored frame center Y must map to animal plane space');
assert(game.includes('walker.applyFacingDeadzone(npcTargetRot'), 'shared NPC body-facing call must remain authoritative');
assert(game.includes('const npcWorld = dialogueWalkerWorldPosition(walker, _dialogueWalkerWorldScratch)'), 'continuous dialogue facing must use the speaker world position');
assert(!game.slice(game.indexOf('function faceNpcDialogueParticipants'), game.indexOf('function updateNpcDialogueStaging')).includes('walker.root.position, walker.avatarHeight'), 'continuous dialogue eye-contact must not feed parent-relative root coordinates into world-space aiming');
assert(game.includes("typeof walker.applyDialogueEyeContact === 'function'"), 'shared eye-contact loop must accept non-skeletal actor gaze math');
assert(game.includes("typeof walker.dialogueHeadWorldPosition === 'function'"), 'player gaze must accept an authored animal head point');
assert(game.includes('_aimNeckAtWorldPoint(playerNeckJoint'), 'player neck must aim at the adapted actor head point');
const livestockStart = game.indexOf('async function openLivestockDialogue');
const livestockEnd = game.indexOf('// advanceNpcDialogue now lives', livestockStart);
const livestockDialogue = game.slice(livestockStart, livestockEnd);
assert(!livestockDialogue.includes('skipStaging: true'), 'livestock must use ordinary NPC player auto-approach');
assert(livestockDialogue.includes('cameraTarget: walker.dialogueCameraTarget'), 'shared camera follow must track the livestock authored head in world space');
assert(!game.includes('skipSpeakerFacing'), 'animal dialogue must not branch around shared speaker facing');
assert(!game.includes('skipEyeContact'), 'animal dialogue must not branch around shared eye contact');
assert(!game.includes('walker._dialogueOptions = options;'), 'shared dialogue face loop must not carry animal-specific option state');
assert(!adapter.includes('profile:'), 'triggered livestock dialogue must not expose a portrait profile');
assert(!adapter.includes('chatheadCreatureKind'), 'triggered livestock dialogue must not render a popup-chathead crop into the full dialogue UI');
assert(!adapter.includes('creatureGenotype:'), 'triggered livestock dialogue must not repeatedly composite a genotype portrait');
assert(game.includes("typeof _dialogueWalker.dialogueHeadWorldPosition === 'function'"), 'NPC camera calculation must accept the animal head point');
assert(game.includes("? _dialogueWalker.dialogueHeadWorldPosition(new THREE.Vector3())"), 'NPC camera calculation must use the adapter head point directly');
assert(game.includes("cameraY: npcCenter.y + Math.sin(baseAngle) * distance"), 'animal dialogue camera must use npcDialogue angle/distance relative to the authored head point');
assert(game.includes("lookY: npcCenter.y"), 'animal dialogue camera must look directly at the authored head point instead of extrapolating below ground');
assert(game.includes("targetX: npcCenter.x"), 'animal dialogue camera X target must be the authored head point');
assert(game.includes("targetZ: npcCenter.z"), 'animal dialogue camera Z target must be the authored head point');
assert(game.includes("if (hasAuthoredSpeakerHead)"), 'animal head camera branch must be isolated from ordinary NPC portrait-center math');
assert(game.includes(": portraitAvatarCenterWorldPosition(_dialogueWalker.root);"), 'ordinary NPCs must keep their existing portrait-center fallback');
assert(game.includes('frame.x + frame.width * 0.5'), 'triggered dialogue head X must be the exact center pixel of the authored frame');
assert(game.includes('frame.y + frame.height * 0.5'), 'triggered dialogue head Y must be the exact center pixel of the authored frame');
assert(game.includes("clearRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height)"), 'no-profile dialogue must clear any stale NPC portrait without rendering a livestock sprite');
assert(game.includes('_dialogueWalker._onDialogueClose?.()'), 'dialogue close must clean up livestock freeze/head state');
assert(game.includes('openLivestockDialogue,'), 'FarmAnimals must receive shared dialogue opener');

const vocal = fs.readFileSync('docs/js/animal-vocalizations.js', 'utf8');
assert(vocal.includes('c?.animalKey'), 'livestock species must resolve through animalKey');
assert(vocal.includes('dialogueLinesFor'), 'animal profiles must expose ordinary dialogue lines');
const ambient = JSON.parse(fs.readFileSync('docs/config/dialogue/ambient-dialogue.json', 'utf8'));
for (const kind of Object.keys(expected)) {
  const lines = ambient.animalVocalizations?.[kind]?.dialogueLines;
  assert(Array.isArray(lines) && lines.length > 0, `${kind} needs configurable dialogue lines`);
}
console.log('livestock dialogue chathead regression: ok');
