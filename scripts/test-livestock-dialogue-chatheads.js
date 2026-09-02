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
assert(game.includes('async function openNpcDialogue(walker, options = {})'), 'NPC dialogue shell must accept restricted reuse options');
assert(game.includes('npcDialogueCameraMode()'), 'livestock must retain NPC dialogue camera mode');
assert(game.includes('activeCameraTarget = options.cameraTarget || walker.root;'), 'dialogue must accept head focus target');
assert(game.includes('if (options.skipStaging !== true) beginNpcDialogueStaging(walker);'), 'livestock must skip humanoid staging');
assert(game.includes('if (options.skipNpcMeta === true)'), 'livestock must skip NPC quest/favor/shop paths');
assert(game.includes('function createLivestockDialogueCameraTarget(animal, kind)'), 'head target helper must exist');
assert(game.includes('window.AnimalChatheadFrame?.frameForKind?.(kind)'), 'world camera target must use authored head frame');
assert(game.includes('(centerX - 0.5) * modelWidth'), 'frame center X must target world head position');
assert(game.includes('(0.5 - centerY) * modelHeight'), 'frame center Y must target world head position');
assert(game.includes('chatheadCreatureKind: kind'), 'portrait must use animal chathead renderer');
assert(game.includes('creatureGenotype: livestockRec.genotype || animal.genotype || null'), 'portrait must preserve actual livestock genotype');
assert(game.includes('_dialogueWalker._onDialogueClose?.()'), 'dialogue close must clean up livestock target/freeze');
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
