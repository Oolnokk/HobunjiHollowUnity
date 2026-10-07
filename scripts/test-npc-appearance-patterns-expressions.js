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
for (const file of ['docs/js/portrait-breathing.js', 'docs/js/npc-avatar-preview-utils.js', 'docs/js/clothing-weaving-system.js', 'docs/config/npcs/clothing-patterns.js', 'docs/js/npc-wardrobe.js']) vm.runInContext(read(file), runtime, { filename: file });

function editorFunction(name) {
  const source = read('docs/tools/character-studio/index.html'); // Reads handlers from the real editor instead of recreating their behavior.
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm')); // Locates the top-level function.
  const next = source.slice(start + 1).search(/^(?:async )?function \w+\(/m); // Nested callbacks are indented, so only the next top-level function ends this slice.
  return source.slice(start, next < 0 ? source.indexOf('// ── Player profile', start) : start + next + 1);
}

async function main() {
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
  vm.runInContext("work.restingExpression='smile'; work.appliedDyes.CLOTH='new_dye'; syncNpcPatternColors(); applyWorkToNpc(); exportAppearance();", editor);
  const result = copy(editor.db.npcs[0]); // Verifies Apply writes the canonical record, not only raw avatar JSON.
  assert.equal(result.restingExpression, 'smile');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].repoPatternId, 'new_pattern');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.weaving.layers.poncho.patterns[0].motifUrl, 'assets/patterns/new.png');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.weaving.layers.trim.patterns[0].repoPatternId, 'b');
  assert.equal(result.clothingPatterns.defaultClothing.overwear.colorA, 'new_dye');
  assert.deepEqual(saved[0].clothingPatterns, result.clothingPatterns);
  assert.equal(saved[0].restingExpression, 'smile');

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
