const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const editorSource = fs.readFileSync('docs/js/character-studio-animal-appearance.js', 'utf8'); // Animal form/genetics editor added to Character Studio.
const geneticsSource = fs.readFileSync('docs/js/creature-genetics.js', 'utf8'); // Breeding source of truth for patterns and Grehlr stripe constraints.
const configSource = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8'); // Real breeding palettes, including Drenkirra's species-specific palette.
const runtimeSource = fs.readFileSync('docs/js/animal-chathead-frame.js', 'utf8'); // Runtime NPC-profile/world-plane bridge for animal-form NPCs.
const repoPickerSource = fs.readFileSync('docs/js/repo-picker.js', 'utf8'); // Character Studio enhancement loader.

assert.match(editorSource, /avatarType:\s*'animal'|avatarType = 'animal'/,
  'Character Studio must persist an explicit animal avatar type');
assert.match(editorSource, /creatureKind/,
  'Character Studio must persist the selected creature kind');
assert.match(editorSource, /creatureGenotype/,
  'Character Studio must persist breeding-compatible genotype data');
assert.match(editorSource, /grehlr:\s*\['mitts', 'spectacles', 'coloredstripe'\]/,
  'Grehlr editor fallback patterns must include the same colored stripe used by breeding');
assert.match(editorSource, /drenkirra:\s*\['bodystripes', 'spectacles'\]/,
  'Drenkirra editor fallback patterns must match breeding');
assert.match(geneticsSource, /grehlr:\s*\{\s*coloredstripe:\s*\{\s*minLightnessColorId:\s*'fawn'/,
  'breeding must retain the authored Fawn lightness floor for Grehlr colored stripe');
assert.match(editorSource, /coloredstripe:\s*Object\.freeze\(\{\s*minLightnessColorId:\s*'fawn'/,
  'Character Studio must mirror the same Grehlr colored-stripe lightness floor');
assert.match(editorSource, /normalizedPaletteColor\(layer\.color, paletteFor\(kind, patternId\)\)/,
  'imported/legacy breeding genotype colors must still normalize into the legal pattern palette');
assert.match(editorSource, /const palette = paletteFor\(kind, layerId\)/,
  'ordinary breeding swatches must be generated from the specific layer palette');

const configSandbox = { window: {} };
configSandbox.globalThis = configSandbox.window;
vm.createContext(configSandbox);
vm.runInContext(configSource, configSandbox, { filename: 'scratchbones-config.js' });
const scratchbonesConfig = configSandbox.window.SCRATCHBONES_CONFIG;
assert(scratchbonesConfig?.game?.creatureGenetics?.palettes?.default?.length,
  'real creature genetics default palette must load in the test sandbox');

const documentStub = {
  currentScript: { src: 'https://example.invalid/docs/js/character-studio-animal-appearance.js' },
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
}; // Keeping readyState=loading exposes the pure API without installing DOM controls.
const editorSandbox = {
  console,
  URL,
  Uint8Array,
  document: documentStub,
  location: { pathname: '/tools/character-studio/' },
  window: { SCRATCHBONES_CONFIG: scratchbonesConfig },
};
editorSandbox.globalThis = editorSandbox.window;
vm.createContext(editorSandbox);
vm.runInContext(editorSource, editorSandbox, { filename: 'character-studio-animal-appearance.js' });
const api = editorSandbox.window.CharacterStudioAnimalAppearance;
assert(api, 'Character Studio animal appearance API must initialize');

const defaultPalette = scratchbonesConfig.game.creatureGenetics.palettes.default;
const stripePalette = api.paletteFor('grehlr', 'coloredstripe');
const fawn = defaultPalette.find(entry => entry.id === 'fawn');
assert(fawn, 'default breeding palette must contain the authored Fawn threshold color');
assert(stripePalette.some(entry => entry.id === 'fawn'),
  'Fawn itself must remain legal for Grehlr colored stripe');
assert(stripePalette.length > 0 && stripePalette.length < defaultPalette.length,
  'Grehlr colored stripe must expose a filtered bright subset for ordinary breeding presets');
const forbiddenStripeColor = defaultPalette.find(entry => !stripePalette.some(allowed => allowed.id === entry.id));
assert(forbiddenStripeColor,
  'real default palette must contain at least one coat color below the Grehlr colored-stripe floor');

const normalizedGrehlr = api.normalizeGenotype('grehlr', {
  sizeClass: 'medium',
  base: { color: defaultPalette[0].hex, copies: 2, inheritance: 'dominant' },
  mitts: { color: defaultPalette[1].hex, copies: 0, inheritance: 'dominant', enabled: false },
  spectacles: { color: defaultPalette[1].hex, copies: 0, inheritance: 'dominant', enabled: false },
  coloredstripe: { color: forbiddenStripeColor.hex, copies: 1, inheritance: 'dominant', enabled: true },
});
assert(stripePalette.some(entry => entry.hex.toLowerCase() === normalizedGrehlr.coloredstripe.color.toLowerCase()),
  'an invalid imported breeding genotype color must normalize to a legal breeding color');
assert.strictEqual(normalizedGrehlr.coloredstripe.enabled, true,
  'normalizing the colored-stripe breeding color must not silently disable an expressed pattern');

const drenkirraPalette = scratchbonesConfig.game.creatureGenetics.palettes.drenkirra;
assert(drenkirraPalette?.length, 'Drenkirra must retain its configured species palette');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api.paletteFor('drenkirra', 'bodystripes').map(entry => entry.hex))),
  JSON.parse(JSON.stringify(drenkirraPalette.map(entry => entry.hex))),
  'Drenkirra breeding preset choices must use the same species-specific colors as breeding'
);

assert.match(runtimeSource, /banubu:\s*'grehlr'/,
  'Banubu must remain a Grehlr through the backward-compatible runtime mapping');
assert.match(runtimeSource, /hiki_hiki:\s*'drenkirra'/,
  'Hiki-hiki must remain a Drenkirra through the backward-compatible runtime mapping');
assert.match(runtimeSource, /preview\.buildProfileFromNpcExport = function animalNpcAwareProfileBuild/,
  'runtime must intercept the ordinary NPC profile builder for animal-form NPC records');
assert.match(runtimeSource, /renderCreatureFullFrame\(targetCanvas, kind/,
  'non-dialogue NPC surfaces must render the full creature frame');
assert.match(runtimeSource, /isAnimalChatheadSurface\(targetCanvas, options\)[\s\S]*renderCreatureChathead/,
  'dialogue/ambient surfaces must retain the animal head crop instead of the full-body frame');
assert.match(repoPickerSource, /moduleUrl\('character-studio-animal-appearance\.js', '20260905animalnpc1'\)/,
  'Character Studio must load the animal appearance enhancement');
assert.match(repoPickerSource, /moduleUrl\('animal-chathead-frame\.js', '20260905feyhat1'\)/,
  'Character Studio must load the same updated animal NPC profile bridge used by runtime');

const sourceCanvas = { width: 120, height: 60, naturalWidth: 120, naturalHeight: 60 }; // Fake canonical creature composite returned by the renderer bridge.
let lastCompose = null;
const originalHumanProfile = npc => ({ human: true, npc });
const originalHumanRender = async () => 'human-fallback';
const runtimeSandbox = {
  console,
  Uint16Array,
  Image: undefined,
  setTimeout: () => 0,
  window: {
    SCRATCHBONES_CONFIG: scratchbonesConfig,
    HOBUNJI_ATTACHMENT_RIG_PROFILES: {
      creatures: {
        grehlr: { chatheadFrame: { x: 0.2, y: 0.1, width: 0.4, height: 0.5 } },
        drenkirra: { chatheadFrame: { x: 0.3, y: 0.12, width: 0.35, height: 0.42 } },
      },
    },
    CreatureGeneticsRender: {
      SPECIES: { grehlr: { base: { idle: 'grehlr.png' } }, drenkirra: { base: { idle: 'drenkirra.png' } } },
      async composeFrame(kind, frame, genotype, blinkShut) {
        lastCompose = { kind, frame, genotype, blinkShut };
        return sourceCanvas;
      },
    },
    NpcAvatarPreview: {
      buildProfileFromNpcExport: originalHumanProfile,
      renderProfileToCanvas: originalHumanRender,
    },
  },
};
runtimeSandbox.globalThis = runtimeSandbox.window;
vm.createContext(runtimeSandbox);
vm.runInContext(runtimeSource, runtimeSandbox, { filename: 'animal-chathead-frame.js' });
const runtimeApi = runtimeSandbox.window.AnimalChatheadFrame;
const preview = runtimeSandbox.window.NpcAvatarPreview;
assert(runtimeApi, 'animal runtime bridge must expose its public API');

const banubuProfile = preview.buildProfileFromNpcExport({ id: 'banubu', name: 'Banubu', appearance: {} });
assert.strictEqual(banubuProfile.creatureKind, 'grehlr', 'legacy Banubu must build a Grehlr NPC profile');
assert.strictEqual(banubuProfile.isAnimalNpc, true, 'legacy Banubu profile must be marked as an animal NPC');
const hikiProfile = preview.buildProfileFromNpcExport({ id: 'hiki_hiki', name: 'Hiki-hiki', appearance: {} });
assert.strictEqual(hikiProfile.creatureKind, 'drenkirra', 'legacy Hiki-hiki must build a Drenkirra NPC profile');
const humanProfile = preview.buildProfileFromNpcExport({ id: 'human_test', appearance: { avatarType: 'person' } });
assert.strictEqual(humanProfile.human, true, 'ordinary humanoid NPCs must continue through the original profile builder');

const authoredGenotype = normalizedGrehlr;
const authoredProfile = preview.buildProfileFromNpcExport({
  id: 'animal_test',
  name: 'Animal Test',
  appearance: { avatarType: 'animal', creatureKind: 'grehlr', creatureGenotype: authoredGenotype },
});
assert.strictEqual(authoredProfile.creatureGenotype, authoredGenotype,
  'explicit animal NPC genotype must flow unchanged from the NPC appearance record into the render profile');

function fakeCanvas(id) {
  const draws = [];
  const context = {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    clearRect() {},
    save() {},
    restore() {},
    drawImage(...args) { draws.push(args); },
  };
  return { id, width: 200, height: 200, draws, getContext: () => context };
}

(async () => {
  const worldCanvas = fakeCanvas('npcWorldCanvas');
  const fullResult = await preview.renderProfileToCanvas(worldCanvas, authoredProfile, {});
  assert.strictEqual(fullResult, worldCanvas, 'animal NPC world render must resolve through the creature bridge');
  assert.strictEqual(lastCompose.kind, 'grehlr');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(lastCompose.genotype)),
    JSON.parse(JSON.stringify(authoredGenotype)),
    'world render without fey overrides must preserve the authored animal NPC genotype values'
  );
  assert.strictEqual(worldCanvas.draws.length, 1, 'world render must draw exactly one composed creature frame');
  assert.deepStrictEqual(worldCanvas.draws[0].slice(1, 5), [0, 0, 120, 60],
    'world render must use the full creature sprite rather than the dialogue head crop');
  assert.strictEqual(worldCanvas.__hobunjiAnimalNpcAppearance.kind, 'grehlr',
    'world canvas must carry mobile/debug metadata identifying the animal NPC kind');

  const dialogueCanvas = fakeCanvas('npcPortraitCanvas');
  await preview.renderProfileToCanvas(dialogueCanvas, authoredProfile, {});
  assert.strictEqual(dialogueCanvas.draws.length, 1, 'animal dialogue portrait must draw one cropped creature frame');
  assert.deepStrictEqual(dialogueCanvas.draws[0].slice(1, 5), [24, 6, 48, 30],
    'dialogue portrait must crop to the authored Grehlr chathead rectangle');

  const humanCanvas = fakeCanvas('humanWorldCanvas');
  const humanResult = await preview.renderProfileToCanvas(humanCanvas, humanProfile, {});
  assert.strictEqual(humanResult, 'human-fallback', 'humanoid rendering must remain on the original portrait renderer');

  console.log('animal NPC appearance tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
