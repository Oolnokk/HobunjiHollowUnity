'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8'); // Loads the shipped modules and editor handlers under test.
const copy = value => JSON.parse(JSON.stringify(value)); // Compares saved data independently of VM prototypes.
const renders = []; // Captures the seat and expression used by actual adapter calls.
const document = { documentElement: { dataset: {} }, readyState: 'loading', addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, currentScript: { src: 'https://example.test/docs/js/clothing-weaving-system.js' } }; // Skips browser boot while retaining production module initialization.
const cosmetics = { optionCache: new Map(), hatOptions: [], hoodOptions: [], torsoPortraitOptions: [], armPortraitOptions: [] }; // Supplies the minimal valid avatar asset catalog.
const window = {
  SCRATCHBONES_CONFIG: { game: { portrait: { expressions: { available: ['neutral', 'smile', 'frown', 'laugh'], defaultResting: 'neutral' }, cosmetics: {} }, account: { shopCatalog: [{ id: 'rugged_poncho', category: 'overwear' }] } } },
  loadPortraitCosmetics: async () => cosmetics,
  getPortraitFighters: () => [{ id: 'mao_m', speciesId: 'mao-ao', gender: 'male' }],
  randomPortraitProfileSeeded: (_rng, fighters) => ({ fighter: fighters[0], bodyColors: {} }),
  renderPortraitProfile: async (_canvas, profile, options) => { renders.push({ seat: options.seatId, expression: window.portraitBreathingComposer.getExpression(options.seatId), view: options.portraitView, profile }); },
}; // Real modules share one browser-like namespace.
const runtime = vm.createContext({ window, document, console, URL, Date, setTimeout, clearTimeout, setInterval, clearInterval }); // Executes production code without a browser asset download.
for (const file of ['docs/js/portrait-breathing.js', 'docs/js/npc-avatar-preview-utils.js', 'docs/js/clothing-weaving-system.js', 'docs/js/metal-armor-system.js', 'docs/config/npcs/clothing-patterns.js', 'docs/js/npc-wardrobe.js']) vm.runInContext(read(file), runtime, { filename: file });

function editorFunction(name) {
  const source = read('docs/tools/character-studio/index.html'); // Reads handlers from the real editor instead of recreating their behavior.
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm')); // Locates the top-level function.
  const next = source.slice(start + 1).search(/^(?:async )?function \w+\(/m); // Nested callbacks are indented, so only the next top-level function ends this slice.
  return source.slice(start, next < 0 ? source.indexOf('// ── Player profile', start) : start + next + 1);
}

async function main() {
  window.SCRATCHBONES_CONFIG.game.dyes = { catalog: [{ id: 'dye:CLOTH:pure_yellow', hex: '#ffff00' }] }; // Reproduces the uploaded Surveyor's pattern dye without the gameplay DyeSystem.
  assert.equal(window.ClothingWeavingSystem.__test.resolvePatternHex({ dyeId: 'dye:CLOTH:pure_yellow' }), '#ffff00');
  assert.equal(window.ClothingWeavingSystem.__test.resolvePatternHex({ dyeId: 'missing' }), '#ffffff');
  const portrait = vm.createContext({ window: { SCRATCHBONES_CONFIG: {} }, console, URL }); // Loads the actual portrait variant authority for inheritance and nearest-variant regressions.
  vm.runInContext(read('docs/js/portrait-utils.js'), portrait);
  vm.runInContext("LAST_SPECIES_DATA_BY_ID={mammakhbuur:{parentSpecies:'mashtzarr'}}; LAST_COSMETIC_FALLBACK_GROUPS={bodyGroups:[{members:[{species:'tletingan',gender:'female',position:0},{species:'mao-ao',gender:'female',position:1}]}]};", portrait);
  window.portraitVariantKeysForFighter = portrait.portraitVariantKeysForFighter;
  const finePoncho = JSON.parse(read('docs/config/cosmetics/clothes/overwear/fine_poncho.json')); // Exercises the shipped multi-sprite garment rather than a synthetic single layer.
  for (const [speciesId, gender] of [['mammakhbuur', 'male'], ['tletingan', 'female']]) {
    const layers = window.ClothingWeavingSystem.__test.resolveIconLayerUrls(finePoncho, speciesId, gender); // Must expose every patterned role selected by the visible portrait.
    assert.deepEqual(copy(window.ClothingWeavingSystem.__test.patternRolesForLayers(layers).map(role => role.key)).sort(), ['poncho', 'trim']);
  }
  await window.NpcAvatarPreview.ensurePortraitCosmetics();
  const npc = { id: 'custom_npc', name: 'Custom NPC', restingExpression: ' FROWN ', appearance: { speciesId: 'mao-ao', gender: 'male', cosmetics: {} }, equippedCosmetics: ['rugged_poncho'], appliedDyes: {}, clothingPatterns: { defaultClothing: { overwear: { cosmeticId: 'rugged_poncho', weaving: { layers: { poncho: { patterns: [{ repoPatternId: 'a', motifUrl: 'assets/patterns/a.png' }] }, trim: { patterns: [{ repoPatternId: 'b', motifUrl: 'assets/patterns/b.png' }] } } }, colorC: { hex: '#123456' } } } } }; // Round-trip fixture includes distinct pattern-bearing sprite roles.
  const original = copy(npc); // Detects shared-definition mutation during profile construction.
  const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(npc); // Runs the same construction used by world/cutscene stand-ins.
  assert.equal(profile.restingExpression, 'frown');
  assert.equal(profile.portraitSeatId, npc.id);
  assert.equal(profile.bodyColors.__hobunjiWovenClothing[0].weaving.layers.trim.patterns[0].repoPatternId, 'b');
  assert.deepEqual(copy(npc), original);
  assert.equal(window.NpcAvatarPreview.restingExpressionForRecord({ restingExpression: 'invalid' }), 'neutral');

  const plain = window.NpcAvatarPreview.buildProfileFromNpcExport({ ...npc, equippedCosmetics: [], clothingPatterns: {} }); // Isolates expression lifecycle from raster asset requests.
  window.portraitBreathingComposer.setExpression(npc.id, 'frown', 1000);
  await window.NpcAvatarPreview.renderProfileToCanvas({}, plain);
  assert.equal(renders.at(-1).expression, 'frown');
  assert.equal(window.portraitBreathingComposer.getExpression(npc.id, Date.now() + 2000), 'frown', 'a matching timed face still registers its persistent default');
  await window.NpcAvatarPreview.renderProfileToCanvas({}, plain, { portraitView: 'behind' });
  assert.equal(renders.at(-1).seat, npc.id);
  window.portraitBreathingComposer.setExpression(npc.id, 'laugh', 1000);
  await window.NpcAvatarPreview.renderProfileToCanvas({}, plain);
  assert.equal(renders.at(-1).expression, 'laugh', 'explicit scene expression takes precedence');
  assert.equal(window.portraitBreathingComposer.getExpression(npc.id, Date.now() + 2000), 'frown', 'expired scene expression returns to authored default');
  window.portraitBreathingComposer.setExpression(npc.id, 'smile', 1000);
  window.portraitBreathingComposer.clearExpression(npc.id);
  await window.NpcAvatarPreview.renderProfileToCanvas({}, plain, { breathingComposer: window.portraitBreathingComposer });
  assert.equal(renders.at(-1).expression, 'frown', 'breathing/emote card keeps the default after dialogue ends');

  const guard = { ...npc, id: 'spearhead_unumanuk', clothingPatterns: {} }; // Existing role-scoped uniform policy must survive adding editor support.
  const guarded = window.NpcWardrobe.wornClothingItemsForRecord(guard, true)[0]; // Uses the production clothing policy merger.
  assert.equal(guarded.weaving.forcedOverpassPattern.repoPatternId, 'tankan_guard_emblem');
  assert.equal(window.ClothingWeavingSystem.patternStackForLayer(guarded.weaving, 'trim').length, 0);
  guard.clothingPatterns.forcedOverpassBySlot = { overwear: null };
  assert.equal(window.NpcWardrobe.wornClothingItemsForRecord(guard, true)[0].weaving, undefined, 'explicit None disables a forced emblem');
  const player = window.NpcAvatarPreview.buildProfileFromNpcExport({ ...npc, id: 'player', appearance: { ...npc.appearance, bodyColors: { __hobunjiWovenClothing: [{ uid: 'player_saved' }] } } }); // Cinematic player stand-ins already carry their equipped woven descriptors.
  assert.equal(player.bodyColors.__hobunjiWovenClothing[0].uid, 'player_saved');
  const armored = { ...npc, equippedCosmetics: ['rounded_pauldron'], clothingPatterns: { defaultClothing: { pauldron: { cosmeticId: 'rounded_pauldron', metalKey: 'tinBronze', temperXp: 15, smithTreatment: { mode: 'pattern', pattern: { repoPatternId: 'metal_pattern', motifUrl: 'assets/patterns/metal.png' } } } } } }; // NPC armor shares authored smith treatments with equipped player armor.
  const armoredProfile = window.NpcAvatarPreview.buildProfileFromNpcExport(armored); // Verifies world/cutscene profile construction retains metal treatment metadata.
  const metalState = armoredProfile.bodyColors[window.MetalArmorSystem.PORTRAIT_MARKER_KEY][0]; // Reads the same marker consumed by portraitStateForGroup.
  assert.equal(metalState.metalKey, 'tinBronze');
  assert.equal(metalState.smithTreatment.pattern.repoPatternId, 'metal_pattern');
  window.resolvePortraitAssetUrl = path => 'https://example.test/docs/assets/' + path;
  assert.equal(window.MetalArmorSystem.visualOptions(metalState).authoredPattern.motifUrl, 'https://example.test/docs/assets/patterns/metal.png');
  assert.equal(metalState.smithTreatment.pattern.motifUrl, 'assets/patterns/metal.png', 'render resolution must not mutate saved patterns');

  const elements = new Map(); // Minimal DOM records allow actual editor change handlers to run.
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', hidden: false, innerHTML: '', querySelectorAll: () => [] }); return elements.get(id); }; // Used by the editor's $ helper.
  const saved = []; // Captures full appearance exports for round-trip checks.
  const editor = vm.createContext({ window, console, Object, JSON, target: { kind: 'npc', id: npc.id }, work: copy(npc), db: { npcs: [copy(npc)] }, npcAppearancePass: 0, $: element, clone: copy, esc: String, normalizeRestingExpression: value => value || null, fillRestingExpressionOptions: value => { element('npcRestingExpression').value = value || ''; }, fillFields() {}, renderDb() {}, setStatus() {}, invalidatePreview() {}, log() {}, StudioAccount: { getDyeCatalog: () => [], getShopCatalog: () => [{ id: 'rugged_poncho', label: 'Rugged Poncho' }] }, downloadJson: (_name, value) => saved.push(copy(value)) }); // Executes the shipped editor handlers against the same runtime APIs.
  for (const name of ['workingNpcRecord', 'syncNpcPatternColors', 'renderNpcAppearanceControls', 'applyWorkToNpc', 'exportAppearance']) vm.runInContext(editorFunction(name), editor);
  const patternSelect = { dataset: { npcPatternSlot: 'overwear', patternIndex: '0', patternRole: 'poncho' }, value: 'new_pattern' }; // Exercises a real per-layer selection without replacing trim data.
  element('npcPatternControls').querySelectorAll = selector => selector === '[data-npc-pattern-slot]' ? [patternSelect] : [];
  window.RepoPatternLibrary = { listCached: () => [{ id: 'new_pattern', name: 'New Pattern', motifPng: 'assets/patterns/new.png' }], getCachedById: () => ({ repoPatternId: 'new_pattern', motifUrl: 'https://old-host.test/motif.png' }) }; // Repository picker returns the same portable motif metadata as the production library.
  const weaving = window.ClothingWeavingSystem; // Retains the real pattern resolver beneath mocked config-only layer discovery.
  window.ClothingWeavingSystem = { ...weaving, resolveLayersForCosmetic: async () => [{ role: 'poncho' }, { role: 'trim' }] };
  await vm.runInContext('renderNpcAppearanceControls()', editor);
  patternSelect.onchange();
  await Promise.resolve();
  const placement = { dataset: { npcPatternTransformSlot: 'overwear', patternRole: 'poncho', patternIndex: '0', patternField: 'usageScaleMultiplier' }, type: 'number', value: '2.5', min: '0.1', max: '20' }; // Real placement control changes only this piece's primary snapshot.
  element('npcPatternControls').querySelectorAll = selector => selector === '[data-npc-pattern-transform-slot]' ? [placement] : [];
  await vm.runInContext('renderNpcAppearanceControls()', editor);
  placement.onchange();
  assert.equal(editor.work.clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].usageScaleMultiplier, 2.5);
  placement.dataset.patternField = 'tiling'; placement.type = 'select-one'; placement.value = 'false';
  placement.onchange();
  placement.dataset.patternField = 'usageFlipX'; placement.type = 'checkbox'; placement.checked = true;
  placement.onchange();
  const placed = editor.work.clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0]; // Ensures subsequent controls preserve earlier edits and the motif identity.
  assert.equal(placed.tiling, false);
  assert.equal(placed.usageFlipX, true);
  assert.equal(placed.repoPatternId, 'new_pattern');
  assert.equal(editor.work.clothingPatterns.defaultClothing.overwear.weaving.layers.trim.patterns[0].usageScaleMultiplier, undefined);
  vm.runInContext("work.restingExpression='smile'; work.appliedDyes.CLOTH='new_dye'; syncNpcPatternColors(); applyWorkToNpc(); exportAppearance();", editor);
  const result = copy(editor.db.npcs[0]); // Verifies Apply writes the canonical record, not only raw avatar JSON.
  assert.equal(result.restingExpression, 'smile');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].repoPatternId, 'new_pattern');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].motifUrl, 'assets/patterns/new.png');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.weaving.layers.trim.patterns[0].repoPatternId, 'b');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.colorA, 'new_dye');
  assert.deepEqual(saved[0].clothingPatterns, result.clothingPatterns);
  assert.equal(saved[0].restingExpression, 'smile');
  assert.equal(saved[0].clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].usageScaleMultiplier, 2.5);
  const metalSelect = { dataset: { npcMetalPattern: 'pauldron' }, value: 'new_pattern' }; // Exercises the real NPC metal selector's save and clear paths.
  element('npcPatternControls').querySelectorAll = selector => selector === '[data-npc-metal-pattern]' ? [metalSelect] : [];
  editor.work = copy(armored);
  await vm.runInContext('renderNpcAppearanceControls()', editor);
  assert.match(element('npcPatternControls').innerHTML, /Verdigris removal pattern/);
  metalSelect.onchange();
  assert.equal(editor.work.clothingPatterns.defaultClothing.pauldron.smithTreatment.pattern.repoPatternId, 'new_pattern');
  assert.equal(editor.work.clothingPatterns.defaultClothing.pauldron.metalKey, 'tinBronze');
  placement.dataset = { npcPatternTransformSlot: 'pauldron', patternRole: '__metal', patternIndex: '0', patternField: 'usageOffsetX' };
  placement.type = 'number'; placement.min = '-4096'; placement.max = '4096'; placement.value = '12';
  element('npcPatternControls').querySelectorAll = selector => selector === '[data-npc-pattern-transform-slot]' ? [placement] : [];
  await vm.runInContext('renderNpcAppearanceControls()', editor);
  placement.onchange();
  assert.equal(editor.work.clothingPatterns.defaultClothing.pauldron.smithTreatment.pattern.usageOffsetX, 12);
  assert.equal(editor.work.clothingPatterns.defaultClothing.pauldron.smithTreatment.pattern.repoPatternId, 'new_pattern');
  metalSelect.value = '';
  metalSelect.onchange();
  assert.equal(editor.work.clothingPatterns.defaultClothing.pauldron.smithTreatment, null);
  const transforms = []; // Records canvas operations made by both production mask renderers.
  document.createElement = () => ({ width: 0, height: 0, getContext() { return new Proxy({ getImageData(_x, _y, width, height) { const data = new Uint8ClampedArray(width * height * 4); data[3] = 255; return { data }; }, createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; } }, { get(object, key) { return object[key] || ((...args) => transforms.push([key, ...args])); } }); } }); // A one-pixel motif exercises real stamping and transform math without native Canvas dependencies.
  vm.runInContext(read('docs/js/tool-metal-recolor.js'), runtime);
  const transformPattern = { meshScale: 1, usageScaleMultiplier: 2, meshRotationDeg: 10, usageRotationDeg: 30, usageOffsetX: 12, usageOffsetY: -8, usageFlipX: true, tiling: false }; // Asymmetric placement catches swapped axes and flipping the wrong coordinate space.
  window.ClothingWeavingSystem.__test.buildPatternMask(64, 64, transformPattern, { width: 4, height: 4 });
  assert(transforms.some(([operation, x, y]) => operation === 'translate' && x === 44 && y === 24));
  assert(transforms.some(([operation, x, y]) => operation === 'scale' && x === -0.5 && y === 0.5));
  assert(transforms.some(([operation, angle]) => operation === 'rotate' && Math.abs(angle - 40 * Math.PI / 180) < 1e-9));
  transforms.length = 0;
  window.ToolMetalRecolor.__test.buildAuthoredClearedMask(64, 64, transformPattern, { width: 4, height: 4 });
  assert(transforms.some(([operation, x, y]) => operation === 'translate' && x === 44 && y === 24));
  assert(transforms.some(([operation, x, y]) => operation === 'scale' && x === -2 && y === 2), 'metal preserves its authored physical scale');

  const dialogue = read('docs/js/dialogue-content.js'); // Verifies the live cutscene walker supersedes an earlier ordinary conversation's record.
  const resolver = dialogue.slice(dialogue.indexOf('  function _npcRestingExpression('), dialogue.indexOf('  function _playNpcDialogueLetterSfx(')); // Executes the production dialogue resolver with stale conversation state.
  const dialogueContext = vm.createContext({ window, deps: { getDialogueWalker: () => ({ rec: npc }) }, _dlgNpcRec: { restingExpression: 'smile' } }); // Represents the exact previous-speaker leak fixed by this change.
  vm.runInContext(resolver, dialogueContext);
  assert.equal(dialogueContext._npcRestingExpression(), 'frown');

  const director = read('docs/tools/cutscene-director/index.html'); // Verifies previews consume saved editor changes instead of silently fetching the unedited repo database.
  const fetchDb = director.slice(director.indexOf('  async function fetchNpcDb()'), director.indexOf("  window.addEventListener('storage'", director.indexOf('  async function fetchNpcDb()'))); // Isolates the Director's real database loader.
  const dbContext = vm.createContext({ window: { LocalDBOverrides: { getOverride: () => ({ npcs: [result] }) } }, state: { npcDb: {} }, log() {}, renderNpcPickerList() {}, renderActors() {}, fetch() { throw new Error('Saved override must precede repo fetch'); } }); // A repo request would prove the saved face/patterns were ignored.
  vm.runInContext(fetchDb, dbContext);
  await dbContext.fetchNpcDb();
  assert.equal(dbContext.state.npcDb.byId.get(npc.id).restingExpression, 'smile');
  assert.equal(dbContext.state.npcDb.byId.get(npc.id).clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].repoPatternId, 'new_pattern');

  // Execute the real cutscene dialogue entry/exit handlers with another NPC's stale conversation still recorded.
  const game = read('docs/game.js'); // Ensures stage-node forwarding and default restoration remain wired into playback.
  const openLine = game.slice(game.indexOf('        async function openLine('), game.indexOf('        function closeLine()', game.indexOf('        async function openLine('))); // Isolates the existing stage engine's actual entry point.
  const closeLine = game.slice(game.indexOf('        function closeLine()'), game.indexOf('\n        function ', game.indexOf('        function closeLine()') + 30)); // Exercises the actual cinematic exit path.
  const node = { expression: 'laugh', expressionHold: 2 }; // Temporary authored cutscene expression must reach DialogueContent.
  let passedNode = null; // Captures explicit stage presentation passed to the dialogue owner.
  const ui = { classList: { add() {}, remove() {} }, setAttribute() {} }; // Camera-free scene UI fixture.
  const scene = vm.createContext({ window: { portraitBreathingComposer: window.portraitBreathingComposer, DialogueContent: { hideChoiceButtons() {}, setNpcDialogueText(_text, value) { passedNode = value; }, renderNpcDialoguePortrait() {}, dialogueSeatId: () => npc.id, npcRestingExpression: rec => window.NpcAvatarPreview.restingExpressionForRecord(rec) }, DialogueCameraFraming: { invalidate() {} } }, dialogueOpen: false, _dialogueWalker: null, cutscenePreviewDialogueSpeaker: null, cutscenePreviewAdvance: null, povShot: true, _npcDialogueNameEl: {}, _npcDialogueHeartsEl: {}, _arcContainerEl: ui, _npcDialogueEl: ui }); // Reuses the expression composer used by the visible actor.
  vm.runInContext(openLine + closeLine, scene);
  await scene.openLine({ kind: 'npc', walker: { rec: npc, profile: plain } }, npc.name, 'Hello', { node });
  assert.equal(passedNode, node);
  scene.closeLine();
  assert.equal(window.portraitBreathingComposer.getExpression(npc.id), 'frown');
  console.log('NPC appearance patterns, export, dyes, and cutscene expression lifecycle passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
