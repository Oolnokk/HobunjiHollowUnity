#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Exercises the real Longoran bridge without a canvas.
const fs = require('node:fs'); // Loads shipped source files.
const vm = require('node:vm'); // Isolates editor and gameplay browser contexts.
const runtime = fs.readFileSync('docs/js/longoran-species-runtime.js', 'utf8'); // Canonical Longoran inheritance and tunings.
const authored = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Full Character Scale controls.
const authorHtml = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Real Animation Author loader, not a mock runtime that silently has CharacterSpine preloaded.
const state = new Map(); // Simulated same-origin storage shared by author and gameplay.
const localStorage = {
  getItem(key) { return state.has(key) ? state.get(key) : null; },
  setItem(key, value) { state.set(key, value); },
  removeItem(key) { state.delete(key); },
}; // Retains the exact text payload the editor writes, not an in-memory object alias.

function makeContext(pathname) {
  const rig = { characters: {
    'tletingan::male': { species: 'tletingan', gender: 'male', anatomy: { handScale: 1 } },
    'tletingan::female': { species: 'tletingan', gender: 'female', anatomy: { handScale: 1 } },
  } }; // Both baseline Tletingan genders have authorable attachment rigs.
  const win = {
    localStorage,
    HOBUNJI_ATTACHMENT_RIG_PROFILES: rig,
    SCRATCHBONES_CONFIG: { game: {
      appearanceEditor: {
        species: { tletingan: { label: 'Tletingan', genders: ['male','female'], male: {}, female: {} } },
        bodyPalettes: { tletingan: { male: [], female: [] } },
      },
      assets: { pngPlaneAvatar: { behindView: { headUrls: { tletingan: { male: 'back', female: 'back' } } }, proceduralFeet: {} } },
      portrait: { armOnlyOpacityMask: { profiles: {} } },
    } },
  }; // Minimal complete early config ensures real inherited species profiles are registered.
  const ctx = { window: win, location: { pathname }, document: { addEventListener() {} }, console };
  vm.runInNewContext(runtime, ctx);
  return win;
}

// Previously stored default slider values must not override a newly approved repository posture.
state.set('hobunjiLongoranSpeciesTuning.v1', JSON.stringify({ spineProfile: { hunch: .75, sway: 0, kyphosis: .8 }, gaitProfile: { cadence: .66 } }));
state.set('hobunjiLongoranAuthorTuning.v1', JSON.stringify({
  male: { spine: { hunch: .37, sway: 0, kyphosis: .8 }, gait: { lurchDegrees: 22 } },
  female: { spine: { hunch: .75, sway: 0, kyphosis: .8 }, gait: { lurchDegrees: 19 } },
}));
const migrated = makeContext('/index.html');
assert.equal(migrated.HobunjiLongoranSpecies.spineProfile.hunch, .1, 'old global default hunch migrates without changing explicit gait');
assert.equal(migrated.HobunjiLongoranSpecies.spineProfile.kyphosis, 1);
assert.equal(migrated.HobunjiLongoranSpecies.gaitProfile.cadence, .66);
assert.equal(migrated.HobunjiLongoranSpecies.spineFor('female').hunch, .1, 'former female author defaults migrate');
assert.equal(migrated.HobunjiLongoranSpecies.spineFor('female').kyphosis, 1);
assert.equal(migrated.HobunjiLongoranSpecies.spineFor('male').hunch, .37, 'user-customized male posture survives default migration');
assert.equal(migrated.HobunjiLongoranSpecies.gaitFor('male').lurchDegrees, 22, 'independently customized gait survives');
assert.equal(JSON.parse(state.get('hobunjiLongoranAuthorTuning.v1')).female.spine.hunch, .1, 'migration persists across reloads');
state.clear();
const author = makeContext('/tools/animation-author/index.html');
const api = author.HobunjiLongoranSpecies;
assert(api, 'Longoran bridge must load in Animation Author');
for (const gender of ['male','female']) {
  assert(author.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['longoran::' + gender], 'Longoran ' + gender + ' needs a rig descriptor in the full-character lineup');
  assert.equal(api.gaitFor(gender).lurchDegrees, 19);
  assert.equal(api.spineFor(gender).hunch, .1);
  assert.equal(api.spineFor(gender).kyphosis, 1); // Canonical 100% hook applies to both genders.
}
assert.equal(api.setAuthorTuning('male', { spine: { hunch: .91, kyphosis: .94 }, gait: { lurchDegrees: 22.5, cadence: .59, dragSide: 'left' } }), true);
assert.equal(api.spineFor('male').hunch, .91);
assert.equal(api.spineFor('female').hunch, .1, 'The female profile must not inherit male editor changes');
assert.equal(api.gaitFor('male').lurchDegrees, 22.5);
assert.equal(api.gaitFor('male').dragSide, 'left');
assert.equal(api.gaitFor('female').lurchDegrees, 19);
assert(state.has('hobunjiLongoranAuthorTuning.v1'), 'Tuning must persist after leaving Full Character Scale');
assert.equal(author.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters['longoran::male'].anatomy.longoranSpine.hunch, .91);
assert.equal(api.exportAuthorTuning().male.gait.cadence, .59);
assert.equal(api.setAuthorTuning('male', { spine: { hunch: .91, kyphosis: .92 } }), true);
assert.equal(api.gaitFor('male').lurchDegrees, 22.5, 'editing posture cannot reset the saved walking lurch');
assert.equal(api.gaitFor('male').dragSide, 'left', 'editing posture cannot reset the dragged foot');

const gameplay = makeContext('/index.html');
const gameApi = gameplay.HobunjiLongoranSpecies;
assert.equal(gameApi.gaitFor('male').lurchDegrees, 22.5, 'Game must load same-origin edited Longoran gait');
assert.equal(gameApi.spineFor('male').hunch, .91, 'Game must load the edited forward-curve values');
assert.equal(gameApi.gaitFor('female').lurchDegrees, 19, 'Unedited female gait keeps the shipped defaults');
assert.equal(gameApi.setAuthorTuning('female', { spine: { hunch: 1 } }), false, 'Game pages must not mutate authoring settings');


// The original author loaded the legs and skinned avatar but NOT CharacterSpine;
// optional chaining silently produced an upright Longoran, while all other tests passed.
const spineLoad = authorHtml.indexOf("  'js/character-spine.js'");
const avatarLoad = authorHtml.indexOf("  'js/png-plane-avatar.js'");
assert(spineLoad >= 0 && spineLoad < avatarLoad, 'Animation Author must load CharacterSpine before constructing its skinned portrait');
assert(authorHtml.includes('AUTHOR_SPINE_RUNTIME_SCRIPT') &&
  authorHtml.includes("relativePath === 'js/character-spine.js' ? AUTHOR_SPINE_RUNTIME_SCRIPT"),
  'Animation Author must pair its spine module with the live preview, not load an incompatible repository revision');
assert(authorHtml.includes("if (!window.HobunjiCharacterSpine?.bind || !window.HobunjiCharacterSpine?.applyToRig)"),
  'missing spine deformation must be reported in mobile diagnostics instead of silently skipped');

const authorSpineRuntime = fs.readFileSync('docs/js/character-spine.js', 'utf8'); // The actual shared spline solver, loaded below into the author context.
vm.runInNewContext(authorSpineRuntime, { window: author });
const authorSpine = author.HobunjiCharacterSpine; // Used to validate the same true deformation that was missing in the author page.
const makeBone = () => ({ position: { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } }, userData: {}, updateMatrix() {} }); // Minimal THREE-like bone for deterministic spline deformation.
const bones = Array.from({ length: authorSpine.splineNodes }, makeBone); // Seven live nodes as constructed by PNGPlaneAvatar's neck rig.
const portraitRig = { splineNodes: bones, spinePosteriorY: -0.3, spineBase: { x: 0, y: 0.23 }, neckLocal: { x: 0, y: 0.33 } }; // Same plane-local anchor frame the real portrait builder supplies.
const bound = authorSpine.bind({ userData: {} }, { speciesId: 'longoran', gender: 'male', spine: api.spineFor('male') }); // Uses the current authored Longoran gender profile.
assert(authorSpine.applyToRig(portraitRig, bound, 1), 'Longoran preview must have a real skinned spline');
assert(bones.at(-1).position.z > 0.03, 'Kyphosis must move the neck bone visibly forward in 3D');
assert(bones.at(-1).position.y < 0, 'Hunch must lower the neck alongside the forward curl');

vm.runInNewContext(fs.readFileSync('docs/js/character-spine.js', 'utf8'), { window: gameplay });
assert.equal(gameplay.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', gender: 'male' }).hunch, .91);
assert.equal(gameplay.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', gender: 'female' }).hunch, .1);
assert.equal(gameplay.HobunjiCharacterSpine.resolve({ speciesId: 'longoran', gender: 'male', spine: { hunch: .2 } }).hunch, .2, 'Explicit NPC/Maskbound posture must win');

assert(authored.includes("longoranRow('Hunch'") && authored.includes("longoranRow('Kyphosis'"), 'Full Character Scale matches Enemy Loadout Editor spine controls');
assert(!authored.includes("longoranRow('Lurch'") && !authored.includes('maaLongoranDragSide'), 'Maskbound gait stays in the shared solver, not extra posture sliders');
assert(authored.includes('focusSelected') && authored.includes('distance * 0.7'), 'explicit focus action exposes forward-curved Longoran Z posture');
assert(!authored.includes('frameLongoran()') && !authored.includes('longoranFocused'), 'editing a Longoran cannot force automatic camera framing');
assert(authored.includes('spinePreviewApplied'), 'portrait skinning is reported in mobile diagnostics');
assert(authored.includes('syncLongoranKyphosisAvailability'), 'kyphosis controls disable at zero hunch like Enemy Loadout Editor');
assert(authored.includes('speed: 3.6, velocityX: 0, velocityZ: 3.6'), 'walking preview passes the real gait motion inputs');
assert(authored.includes('window.HobunjiLongoranSpecies?.setAuthorTuning'), 'Animation Author sliders must publish runtime tuning');
assert(authored.includes('refreshLongoranSpine'), 'Spine sliders must visibly deform the portrait');
assert(authored.includes('rebuildLongoranFeet'), 'Gait changes must rebuild the actual procedural leg solver');
assert(authored.includes('toggleLongoranWalk'), 'Walking pose must be previewable in the author');
assert(authored.includes('stopLongoranWalk();'), 'Closing the tool must dispose the opt-in preview');
assert(fs.readFileSync('docs/game.js', 'utf8').includes("this._npcRunning || appearance.speciesId === 'longoran'"), 'Ordinary walking Longoran NPCs must apply the same body pitch as their feet');
console.log('Longoran male/female Animation Author tuning, persistence, gameplay posture and walking preview: PASS');
