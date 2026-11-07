'use strict';
const assert = require('node:assert/strict'); // Test actual editor/game implementations, not copied algorithms.
const fs = require('node:fs'); // Read production code and committed weapon catalog.
const vm = require('node:vm'); // Simulate same-origin browser reloads.
const registry = fs.readFileSync('docs/config/modular-weapons.js', 'utf8'); // Source of authored weapon definitions.
const runtime = fs.readFileSync('docs/js/modular-weapons.js', 'utf8'); // Live authoring and gameplay logic.
const editor = fs.readFileSync('docs/tools/modular-weapon-editor/editor.js', 'utf8'); // Interactive recipe operations.
const provenanceSource = fs.readFileSync('docs/tools/modular-weapon-editor/recipe-provenance.js', 'utf8'); // October 29 fingerprints.
const helperWindow = {}; // Pure browser module, shared with the real editor page.
vm.runInContext(provenanceSource, vm.createContext({ window: helperWindow }));
const audit = helperWindow.ModularWeaponRecipeProvenance; // Canonical identification and multi-ended eligibility.

function boot(pathname, storage = {}) {
  const window = { location: { pathname },
    localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; } } }; // Same-origin draft store.
  const context = vm.createContext({ window, console });
  vm.runInContext(registry, context); vm.runInContext(runtime, context);
  return window;
}

const game = boot('/index.html'); // No saved authoring draft.
const draft = JSON.parse(JSON.stringify(game.MODULAR_WEAPON_CONFIG)); // Unpublished test calibration.
draft.shafts.kylie.editorOnly = true;
const store = { 'hobunji.modularWeapons.v5': JSON.stringify(draft) };
for (const path of ['/index.html', '/HobunjiHollowUnity/', '/tools/modular-weapon-editor/index.html',
  '/tools/enemy-loadout-editor/index.html']) {
  assert.equal(boot(path, store).ModularWeapons.getConfig().shafts.kylie.editorOnly, true,
    path + ': local authoring draft must still be previewable in gameplay');
}
assert.equal(game.ModularWeapons.getConfig().shafts.kylie.editorOnly, false, 'No-draft game uses committed catalog');
const api = game.ModularWeapons; // Shared compatibility authority.
assert.equal(api.decode('modular:constructor:dagger:nativeCopper'), null);
assert.equal(api.decode('modular:dagger:toString:nativeCopper'), null);
assert.equal(api.isDisallowed('constructor', 'dagger'), true);
assert.equal(api.isDisallowed('dagger', 'toString'), true);
// A duplicated shaft donor is also a part key. An inherited constructor or toString must not be used as a clone source.
for (const reservedId of ['constructor', 'toString', 'hasOwnProperty']) {
  const importDraft = JSON.parse(JSON.stringify(api.getConfig()));
  Object.defineProperty(importDraft.shafts, reservedId, { enumerable:true, configurable:true, value:{
    duplicateFrom:'kylie', label:'Reserved name', sprite:'assets/toolsprites/modular_pieces/weaponshaft_kylie.png',
  } });
  const checked = api.replace(importDraft);
  assert.equal(Object.hasOwn(checked.shafts, reservedId), false,
    'Imported shaft definitions cannot create reserved prototype-property part keys');
  assert.equal(api.decode('modular:' + reservedId + ':dagger:nativeCopper'), null);
}
for (const invalidDonor of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  const importDraft = JSON.parse(JSON.stringify(api.getConfig()));
  importDraft.shafts.invalidPrototypeClone = {
    duplicateFrom: invalidDonor, label: 'Invalid', sprite: 'assets/toolsprites/modular_pieces/weaponshaft_kylie.png',
  };
  const checked = api.replace(importDraft);
  assert.equal(Object.hasOwn(checked.shafts, 'invalidPrototypeClone'), false,
    invalidDonor + ' must be rejected without crashing the editor or game');
}
const validDonorDraft = JSON.parse(JSON.stringify(api.getConfig()));
validDonorDraft.shafts.validSourceClone = {
  duplicateFrom: 'kylie', label: 'Kylie Copy', sprite: 'assets/toolsprites/modular_pieces/weaponshaft_kylie.png',
};
assert.equal(api.replace(validDonorDraft).shafts.validSourceClone?.duplicateFrom, 'kylie',
  'Actual author-approved shaft donor keys must still clone normally');
api.replace(game.MODULAR_WEAPON_CONFIG); // Leave the ordinary test catalog free of temporary clone definitions.
assert.deepEqual(JSON.parse(JSON.stringify(api.decode('modular:dagger:warhammer:nativeCopper'))),
  { shaft: 'dagger', head: 'warhammer', metal: 'nativeCopper' });

// Extract and run the actual editor handlers with minimal DOM/mount stubs.
function extract(name, next) {
  const start = editor.indexOf('  function ' + name + '(');
  const end = editor.indexOf('\n  ' + next, start);
  assert(start >= 0 && end > start, 'Missing editor handler: ' + name);
  return editor.slice(start, end);
}
const placed = []; // Captures which pairs the bulk sleeve action actually selects.
const selection = { 'recipe-list': { value: 'test-sleeve' }, 'recipe-skip-existing': { checked: false } };
const bulkApproval = { approved: false, questions: [] }; // A bulk change is staged until the user approves its full scope.
const placementEnv = {
  data: { shafts: JSON.parse(JSON.stringify(api.getConfig().shafts)),
    heads: JSON.parse(JSON.stringify(api.getConfig().heads)), recipes: { 'test-sleeve': {} } },
  api, byId: id => selection[id], recipeStatus() {}, save() {}, syncRecipeControls() {},
  mountFrames: () => [{}], defaultRecipeBox: () => ({ x0: 0, y0: 0, x1: 10, y1: 10 }),
  newPlacedOp: name => ({ recipe: name }),
  addPlacedOp: (shaft, head) => { placed.push(shaft + '|' + head); return 0; },
  window: { ModularWeaponRecipeProvenance: audit,
    confirm: message => { bulkApproval.questions.push(message); return bulkApproval.approved; } },
};
const place = new Function('env', 'const { data, api, byId, recipeStatus, save, syncRecipeControls, mountFrames, defaultRecipeBox, newPlacedOp, addPlacedOp, window } = env;\n'
  + extract('placeOnAllEligible', 'function deleteRecipe') + '\nreturn placeOnAllEligible;')(placementEnv);
place();
assert.equal(placed.length, 0, 'Declining mass placement must make no changes');
bulkApproval.approved = true; place();
const expected = Object.entries(api.getConfig().shafts).flatMap(([shaft, record]) =>
  Object.entries(api.getConfig().heads).filter(([head, part]) =>
    audit.isMultiEndedSleeveHaft(record) && part.mount.type === 'blade'
    && !api.isDisallowed(shaft, head)).map(([head]) => shaft + '|' + head));
assert.deepEqual(placed.sort(), expected.sort(), 'Bulk sleeves only target true multi-ended hafts');
assert(placed.includes('bshuakauitl|dagger-sword'), 'Two-ended B\'Shuakauitl is eligible');
assert(placed.some(pair => pair.startsWith('pick-shovel|')), 'Two-ended Pick-Shovel remains eligible');
assert(!placed.some(pair => ['kylie', 'hatchet', 'hoe', 'warhammer', 'fishing-mace', 'bgungku', 'dagger'].some(shaft => pair.startsWith(shaft + '|'))),
  'Single-ended hafts never receive mass recipe placements');
assert(bulkApproval.questions.every(question => question.includes('Kylie') && question.includes('Undo')),
  'Bulk placement confirms the scope and explicitly warns about single-ended hafts');

const startBox = { x0: 20, y0: 20, x1: 60, y1: 60 }; // Placed recipe box before drag.
const movedOp = { recipe: 'test-sleeve', box: { x0: 80, y0: 80, x1: 120, y1: 120 } }; // Unsaved live drag.
const effects = { saved: 0, replaced: 0, previewed: 0 }; // Observes what an aborted pointer gesture changes.
const onCancel = new Function('op', 'original', 'effects',
  'let recipeDrag = { pointer: 1, target: "op", mode: "move", orig: { ...original } }; let recipeDraft = null, redoTimer = null, data = {};\n'
  + 'const selectedOp = () => op; const api = { replace: () => effects.replaced++ }; const preview = () => effects.previewed++;\n'
  + 'const drawBridgeOverlay = () => {}; const syncRecipeControls = () => {}; const recipeStatus = () => {};\n'
  + 'const save = () => effects.saved++; const clearTimeout = () => {};\n'
  + extract('recipePointerUp', 'let redoTimer =') + '\nreturn recipePointerUp;')(movedOp, startBox, effects);
onCancel({ type: 'pointercancel' });
assert.deepEqual(movedOp.box, startBox, 'Cancelled placed-box drag restores prior coordinates');
assert.equal(effects.saved, 0, 'Cancelling must not record a changed draft');
assert.equal(effects.replaced, 1, 'Cancelling invalidates the composed image');
assert.equal(effects.previewed, 1, 'Cancelling refreshes the preview');
assert(editor.includes('if (!input.value.trim() || !Number.isFinite(value))'),
  'A blank mobile mount coordinate must not turn into zero');

const shop = fs.readFileSync('docs/js/foundry-shop.js', 'utf8');
assert(shop.includes('serial === previewSerial && image.isConnected'),
  'Old failing preview must not overwrite a newer selection');
assert(shop.includes('!deps.VERDIGRIS_METAL_KEYS?.length'),
  'Empty forgeable metal selection must not crash the smith menu');

// The UI removes saved operations (not expanded head pixels), one pair or one haft at a time.
assert(editor.includes("syncElementList(); // Mount primitives"),
  'The assembly-element inventory must refresh whenever the selected pair changes');
const expectedIds = ['assembly-summary', 'assembly-mount-elements', 'assembly-operation-elements',
  'assembly-clear-pair-recipes', 'assembly-clear-haft-recipes', 'assembly-haft-recipe-count', 'assembly-status',
  'assembly-prune-legacy', 'assembly-legacy-summary'];
const editorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
for (const id of expectedIds) assert(editorHtml.includes('id="' + id + '"'), id + ' needs a visible DOM control');
const singleEnded = ['fishing-mace', 'warhammer', 'bgungku', 'hatchet', 'hoe', 'kylie']; // High-confidence bulk import targets.
for (const shaftKey of singleEnded) {
  const shaft = api.getConfig().shafts[shaftKey];
  assert.equal(shaft.mounts.filter(m => m.type === 'tang').length, 1, shaftKey + ': preserve original single tang');
  assert.equal(shaft.mounts.filter(m => m.type === 'eye').length, 1, shaftKey + ': preserve original eye');
  assert.equal(Object.values(shaft.overrides).flatMap(pair => pair.bridges?.strokes || []).filter(op => op.recipe).length, 0,
    shaftKey + ': remove all unchanged mass-placed recipe boxes without changing mount geometry');
}
for (const shaftKey of ['bshuakauitl', 'pick-shovel', 'hachutuTorchStaff'])
  assert(Object.values(api.getConfig().shafts[shaftKey].overrides).some(pair => pair.bridges?.strokes?.some(op => op.recipe)),
    shaftKey + ': preserve potentially intentional multi-ended recipe placements');
const originalKylie = JSON.parse(JSON.stringify(api.getConfig().shafts.kylie)); // Exact hand-adjusted Kylie mounts.
const legacyKylie = JSON.parse(JSON.stringify(originalKylie)); // Simulated outdated localStorage recipe placements.
const oldBoxes = [ // Fingerprints of the earlier 29 October mass import; one altered placement must remain untouched.
  { recipe: 'recipe-1', box: { x0: 338.7881062280972, y0: 908.9415575926496,
    x1: 398.33130614420867, y1: 1025.3933025613278 } },
  { recipe: 'tanged-head---sleeved-shaft', box: { x0: 222.33636125941896,
    y0: 729.7850268716061, x1: 546.9258404481329, y1: 1850.0402748508363 } },
];
for (const [headKey, head] of Object.entries(api.getConfig().heads))
  if (head.mount.type === 'blade' && !api.isDisallowed('kylie', headKey))
    (legacyKylie.overrides[headKey] ||= {}).bridges = { strokes: JSON.parse(JSON.stringify(oldBoxes)) };
assert.equal(Object.values(legacyKylie.overrides).flatMap(pair => pair.bridges?.strokes || []).length, 18);
const knownDraft = JSON.parse(JSON.stringify(api.getConfig())); // Do not modify the current runtime while auditing.
knownDraft.shafts.kylie = JSON.parse(JSON.stringify(legacyKylie));
assert.equal(audit.find(knownDraft).length, 18, 'All 18 old Kylie recipe placements are recognized');
const reauthoredPlacementDraft = JSON.parse(JSON.stringify(knownDraft)); // Modified box flags are independent authored work.
reauthoredPlacementDraft.shafts.kylie.overrides.dagger.bridges.strokes[0].flipX = true;
reauthoredPlacementDraft.shafts.kylie.overrides['dagger-sword'].bridges.strokes[0].uniform = true;
assert.equal(audit.find(reauthoredPlacementDraft).length, 16,
  'A manually mirrored or proportion-locked placement is no longer classified as the old default');
assert.equal(audit.clean(reauthoredPlacementDraft).length, 16);
assert.equal(reauthoredPlacementDraft.shafts.kylie.overrides.dagger.bridges.strokes.length, 1);
assert.equal(reauthoredPlacementDraft.shafts.kylie.overrides['dagger-sword'].bridges.strokes.length, 1);
const changedTemplateDraft = JSON.parse(JSON.stringify(knownDraft)); // Custom named recipe contents are also protected.
changedTemplateDraft.recipes['recipe-1'].box.x0 += 1;
assert.equal(audit.find(changedTemplateDraft).length, 9,
  'Editing the shared recipe template protects all nine original placements using that template');
assert.equal(audit.clean(changedTemplateDraft).length, 9);
assert.equal(Object.values(changedTemplateDraft.shafts.kylie.overrides)
  .flatMap(pair => pair.bridges?.strokes || []).filter(op => op.recipe === 'recipe-1').length, 9,
  'Template-specific authored work survives even when its placement coordinates were unchanged');
knownDraft.shafts.kylie.overrides.dagger.bridges.strokes[0].box.x0 += 0.125; // Individual edit since import.
assert.equal(audit.clean(knownDraft).length, 17, 'Cleanup only recognizes untouched mass copies');
assert.equal(knownDraft.shafts.kylie.overrides.dagger.bridges.strokes.length, 1,
  'User-adjusted recipe placement is preserved');
assert.deepEqual(knownDraft.shafts.kylie.mounts, originalKylie.mounts,
  'Cleanup never changes the user-authored mount calibration');
assert.equal(audit.find(knownDraft).length, 0, 'Cleanup is idempotent');
 // Real shipped Kylie configuration.
const caseShaft = {
  ...originalKylie,
  overrides: {
    dagger: { layerOrder: 'haft-over-head', bridges: { strokes: [
      { recipe: 'recipe-1', box: { x0: 3, y0: 4, x1: 50, y1: 70 } },
      { junction: 'joiner', x: 10, y: 20, rotation: 0, scale: 1 },
      { recipe: 'tanged-head---sleeved-shaft', box: { x0: 5, y0: 6, x1: 80, y1: 90 } },
    ] } },
    'dagger-sword': { bridges: { strokes: [{ recipe: 'recipe-1', box: { x0: 3, y0: 4, x1: 50, y1: 70 } }] } },
    kylie: { bridges: { strokes: [{ smudge: true, points: [[2, 2]], r: 8 }] } },
  },
};
const cleanupEnv = {
  shaft: caseShaft, approved: false, prompts: [], saves: 0,
  dom: { 'assembly-status': { textContent: '' } },
};
const removeRecipes = new Function('deps', 'let recipeSel = 2;\n'
  + 'const chosenShaft = () => deps.shaft; const chosenHead = () => ({ label: "Dagger" });\n'
  + 'const byId = id => id === "head" ? { value: "dagger" } : deps.dom[id];\n'
  + 'const window = { confirm: text => { deps.prompts.push(text); return deps.approved; } };\n'
  + 'const save = () => deps.saves++;\n'
  + extract('clearRecipeElements', "byId('assembly-clear-pair-recipes')") + '\n'
  + 'return { clear: clearRecipeElements, selection: () => recipeSel };')(cleanupEnv);
removeRecipes.clear(true);
assert.equal(cleanupEnv.saves, 0, 'Cancel confirmation makes no edits');
assert.equal(caseShaft.overrides.dagger.bridges.strokes.length, 3, 'Cancel preserves placements');
cleanupEnv.approved = true;
removeRecipes.clear(false);
assert.equal(cleanupEnv.saves, 1, 'Pair cleanup creates one Undo/save step');
assert.equal(caseShaft.overrides.dagger.bridges.strokes.length, 1, 'Pair cleanup keeps unrelated junctions');
assert.equal(caseShaft.overrides.dagger.bridges.strokes[0].junction, 'joiner');
assert.equal(caseShaft.overrides['dagger-sword'].bridges.strokes.length, 1,
  'Pair cleanup must not change another head on Kylie');
assert.equal(removeRecipes.selection(), -1, 'Deleting selected recipe clears an old selection');
removeRecipes.clear(true);
assert.equal(cleanupEnv.saves, 2, 'Haft-wide cleanup is one further save');
assert.equal(caseShaft.overrides['dagger-sword'].bridges, null,
  'An emptied pair stays explicitly null, so committed recipes are not re-imported');
assert.equal(caseShaft.overrides.dagger.bridges.strokes[0].junction, 'joiner',
  'All-head cleanup preserves manually authored junctions');
assert.equal(caseShaft.overrides.kylie.bridges.strokes[0].smudge, true,
  'All-head cleanup preserves non-recipe metalwork on other heads');
assert(cleanupEnv.prompts.every(prompt => prompt.includes('Undo')),
  'Touch-friendly destructive cleanup always explains Undo and asks confirmation');


// Exercise the real element-inventory UI with touch-sized row buttons and a tiny DOM substitute.
const controls = {}; // Element IDs share the same fake panel across selection, cleanup, and redraw.
const element = tag => ({
  tag, children: [], textContent: '', disabled: false,
  appendChild(child) { this.children.push(child); },
  replaceChildren(...next) { this.children = next; },
  scrollIntoView() {},
});
for (const id of expectedIds) controls[id] = element('div');
controls.head = { value: 'dagger' }; controls.socket = element('select');
const uiState = { shaft: JSON.parse(JSON.stringify(legacyKylie)), edits: 0, renders: 0, prompts: [] };
const elementsStart = editor.indexOf('  function describeElement(');
const elementsEnd = editor.indexOf('  function render()', elementsStart);
assert(elementsStart >= 0 && elementsEnd > elementsStart, 'Assembly-element handlers must remain grouped before render');
const uiHandlers = new Function('env', 'let recipeSel = -1, mountIndex = 0;\n'
  + 'const byId = id => env.controls[id]; const document = { createElement: env.element };\n'
  + 'const data = { shafts: { kylie: env.state.shaft } };\n'
  + 'const chosenShaft = () => env.state.shaft; const chosenHead = () => env.api.getConfig().heads.dagger;\n'
  + 'const api = env.api; const save = () => env.state.edits++;\n'
  + 'const render = () => env.state.renders++;\n'
  + 'const syncRecipeControls = () => {}; const drawBridgeOverlay = () => {};\n'
  + 'const window = { ModularWeaponRecipeProvenance: env.audit, confirm: msg => { env.state.prompts.push(msg); return false; } };\n'
  + editor.slice(elementsStart, elementsEnd)
  + '\nreturn { syncElementList, selection: () => mountIndex };')({
    state: uiState, api, controls, element, audit,
  });
uiHandlers.syncElementList();
assert.equal(controls['assembly-mount-elements'].children.length, 2, 'Kylie shows its two mount primitives separately');
assert.equal(controls['assembly-operation-elements'].children.length, 2,
  'Kylie/Dagger shows its two recipe placements as separate removable rows');
assert(controls['assembly-summary'].textContent.includes('1 matching head primitive(s)'),
  'Kylie does not claim to repeat the selected blade head');
assert(controls['assembly-haft-recipe-count'].textContent.includes('18 recipe placement(s)'),
  'The UI reveals all 18 Kylie recipe placements across its head combinations');
controls['assembly-mount-elements'].children[1].children[1].onclick();
assert.equal(uiHandlers.selection(), 1, 'Selecting a mount row picks the matching editor line');
assert.equal(uiState.renders, 1, 'Selecting a mount refreshes the existing line controls');
controls['assembly-mount-elements'].children[1].children[2].onclick();
assert.equal(uiState.shaft.mounts.length, 2,
  'Declining the whole-haft mount-deletion confirmation preserves authored geometry');
assert.equal(uiState.edits, 0, 'Declining the mount confirmation creates no draft');
controls['assembly-operation-elements'].children[0].children[2].onclick();
assert.equal(uiState.shaft.overrides.dagger.bridges.strokes.length, 1,
  'Removing the selected recipe element removes exactly that operation');
assert.equal(uiState.edits, 1, 'Removing an individual element records one undoable save');
assert.equal(uiState.shaft.overrides['dagger-sword'].bridges.strokes.length, 2,
  'Removing an element from Kylie/Dagger preserves the other heads');

console.log('Modular editor behavior: authored mount preservation, 108-copy cleanup guard, reviewed multi-ended bulk placement, and touch UI passed.');
