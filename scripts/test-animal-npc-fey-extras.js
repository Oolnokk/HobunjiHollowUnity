const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const runtimeSource = fs.readFileSync('docs/js/animal-chathead-frame.js', 'utf8');
const headwearSource = fs.readFileSync('docs/js/animal-npc-headwear.js', 'utf8');
const studioExtrasSource = fs.readFileSync('docs/js/character-studio-animal-fey-extras.js', 'utf8');
const hatAuthorSource = fs.readFileSync('docs/js/animal-head-rig-hat-authoring.js', 'utf8');
const headRigHtml = fs.readFileSync('docs/tools/animal-head-rig/index.html', 'utf8');
const actionLocksSource = fs.readFileSync('docs/js/character-action-locks.js', 'utf8');
const repoPickerSource = fs.readFileSync('docs/js/repo-picker.js', 'utf8');

// Character Studio: arbitrary fey colors are an NPC-only override layer, not a mutation of breeding palette rules.
assert.match(studioExtrasSource, /creatureColorOverrides/,
  'Character Studio must persist unrestricted creature color overrides separately from breeding genetics');
assert.match(studioExtrasSource, /class=\"animalNpcCustomHex\"/,
  'each animal/fey color layer must expose a custom hex input');
assert.match(studioExtrasSource, /Each base\/pattern layer has its own independent #RRGGBB override/,
  'custom hex UI must make per-layer independence explicit');
assert.match(studioExtrasSource, /Invalid hex color/,
  'custom hex authoring must reject malformed values instead of silently recoloring');
assert.match(studioExtrasSource, /id=\"animalNpcOpacity\" type=\"range\" min=\"0\" max=\"1\"/,
  'animal/fey NPC appearance must expose a 0..1 opacity control');
assert.match(studioExtrasSource, /id=\"animalNpcHatSelect\"/,
  'animal/fey NPC appearance must expose an existing-hat selector');
assert.match(studioExtrasSource, /controlsSignature/,
  'fey controls must track a state signature instead of destroying focused controls on every poll');
assert.match(studioExtrasSource, /signature === controlsSignature/,
  'unchanged controls must survive polling so text inputs and native selects remain interactive/open');
assert.match(studioExtrasSource, /original\.__characterStudioAnimalAppearanceWrapped[\s\S]*wrapped\.__characterStudioAnimalAppearanceWrapped = true/,
  'fey render wrapper must preserve the base wrapper marker and prevent infinite wrapper ping-pong');
assert.match(studioExtrasSource, /renderEpochByCanvas/,
  'async fey renders must reject stale frames so old opacity cannot overwrite a newer appearance');
assert.match(studioExtrasSource, /\.animalNpcColor[\s\S]*clearCustomColor/,
  'choosing a normal breeding swatch must explicitly leave custom-hex mode for that layer');

// Runtime: overrides, opacity, and hats all converge at the same animal-NPC render seam.
assert.match(runtimeSource, /function genotypeForProfile/,
  'runtime must derive an effective genotype for NPC-only color overrides');
assert.match(runtimeSource, /appearance\.creatureColorOverrides/,
  'runtime must read unrestricted color overrides from the appearance payload');
assert.match(runtimeSource, /composeFrame\([^\n]*genotype/,
  'runtime creature compositor must receive the effective fey genotype');
assert.match(runtimeSource, /context\.globalAlpha = normalizeOpacity\(opacity\)/,
  'runtime canvas render must apply authored animal/fey opacity');
assert.match(runtimeSource, /AnimalNpcHeadwear\?\.composeWithHat/,
  'runtime animal NPC renders must pass through the reusable headwear compositor');
assert.match(runtimeSource, /animalHatId/,
  'selected animal hats must survive the NPC profile bridge');

// Animal Head Rig Painter: species-level hat attachment is exported as an ordinary creature field.
assert.match(headRigHtml, /animal-head-rig-hat-authoring\.js\?v=20260905feyhat1/,
  'Animal Head Rig Painter must load its hat-attachment authoring enhancement');
assert.match(hatAuthorSource, /extras\.hatAttachment\s*=/,
  'hat attachment must be stored as a top-level creature field preserved by existing export code');
assert.match(hatAuthorSource, /Set hat anchor on sprite/,
  'hat authoring must provide direct pointer placement on the creature sprite');
assert.match(hatAuthorSource, /Derive from painted Head/,
  'hat authoring must be able to derive a sensible starting attachment from the painted head region');
assert.match(hatAuthorSource, /animalHatFlipX/,
  'hat authoring must expose a horizontal flip button for asymmetric hat sprites');
assert.match(hatAuthorSource, /flipX:\s*!!state\.attachment\.flipX/,
  'hat horizontal flip must persist into the exported hatAttachment record');
assert.match(hatAuthorSource, /state\.attachment\.flipX = !state\.attachment\.flipX/,
  'hat flip button must toggle the authored transform rather than only changing preview CSS');
assert.match(hatAuthorSource, /baseCanvas\.style\.position = 'absolute'/,
  'head-rig base canvas must be removed from layout flow so backing-store resize cannot cause vertical drift');
assert.match(hatAuthorSource, /state\.stageStabilized = true/,
  'head-rig drift stabilization must be visible in mobile/debug state');
assert.match(hatAuthorSource, /rigs\[id\]\.hatAttachment/,
  'same-origin game preview must save the hat attachment beside the browser head-rig override');
assert.match(hatAuthorSource, /window\.__animalHeadRigHatDebug/,
  'hat authoring must expose mobile-visible/debuggable state without requiring DevTools');

// Runtime headwear reuses the ordinary portrait hat catalog and species-level rig attachment.
assert.match(headwearSource, /ensurePortraitCosmetics/,
  'animal NPC headwear must reuse the existing portrait cosmetics catalog');
assert.match(headwearSource, /hatOptions/,
  'animal NPC headwear must expose the existing hat options');
assert.match(headwearSource, /record\?\.hatAttachment/,
  'committed species hat attachments must be read from the bestiary record');
assert.match(headwearSource, /PREVIEW_STORAGE_KEY/,
  'headwear runtime must honor same-origin hat rig previews');
assert.match(headwearSource, /if \(attachment\.flipX\) ctx\.scale\(-1, 1\)/,
  'runtime headwear compositor must apply the species-authored horizontal mirror');
assert.match(headwearSource, /layer\.pos === 'back'/,
  'existing two-sided hats must preserve their back-vs-front layer ordering around the creature');
assert.match(actionLocksSource, /animal-npc-headwear\.js\?v=20260905feyhat1[\s\S]*animal-chathead-frame\.js\?v=20260905feyhat1/,
  'game runtime must load headwear before the animal NPC rendering bridge');
assert.match(repoPickerSource, /animal-npc-headwear\.js[\s\S]*character-studio-animal-fey-extras\.js/,
  'Character Studio must load headwear and fey extras around the existing animal appearance module');

// Pure runtime behavior: profile metadata clamps opacity but preserves arbitrary valid hex colors.
const runtimeSandbox = {
  console,
  Uint16Array,
  Image: undefined,
  window: {
    SCRATCHBONES_CONFIG: {
      game: { creatureGenetics: { palettes: { default: [{ hex: '#443322' }, { hex: '#887766' }] } } },
    },
  },
};
runtimeSandbox.globalThis = runtimeSandbox.window;
vm.createContext(runtimeSandbox);
vm.runInContext(runtimeSource, runtimeSandbox, { filename: 'animal-chathead-frame.js' });
const runtimeApi = runtimeSandbox.window.AnimalChatheadFrame;
assert(runtimeApi, 'animal runtime API must initialize');
assert.strictEqual(runtimeApi.normalizeOpacity(2), 1, 'opacity above one must clamp to fully opaque');
assert.strictEqual(runtimeApi.normalizeOpacity(-0.5), 0, 'negative opacity must clamp to transparent');
assert.strictEqual(runtimeApi.normalizeCustomHex('12abEF'), '#12ABEF', 'valid custom hex must normalize without palette snapping');
assert.strictEqual(runtimeApi.normalizeCustomHex('purple'), null, 'non-hex custom colors must be rejected');

const feyNpc = {
  id: 'banubu',
  name: 'Banubu',
  appearance: {
    avatarType: 'animal',
    creatureKind: 'grehlr',
    animalOpacity: 0.42,
    animalHatId: 'appearance::hat::basic_headband',
    creatureGenotype: {
      base: { color: '#443322', copies: 2, inheritance: 'dominant' },
      coloredstripe: { color: '#887766', copies: 1, inheritance: 'dominant', enabled: true },
    },
    creatureColorOverrides: {
      base: '#00ffcc',
      coloredstripe: '#7B00FF',
      ignoredBadValue: 'not-a-hex',
    },
  },
};
const feyProfile = runtimeApi.buildAnimalProfileFromNpcExport(feyNpc);
assert.strictEqual(feyProfile.animalOpacity, 0.42, 'authored opacity must survive NPC profile conversion');
assert.strictEqual(feyProfile.animalHatId, 'appearance::hat::basic_headband', 'authored hat id must survive NPC profile conversion');
const effectiveGenotype = runtimeApi.genotypeForProfile({ profile: feyProfile });
assert.strictEqual(effectiveGenotype.base.color, '#00FFCC', 'custom base color must override breeding genotype exactly');
assert.strictEqual(effectiveGenotype.coloredstripe.color, '#7B00FF', 'custom pattern color must bypass breeding palette/lightness restrictions');
assert.strictEqual(effectiveGenotype.ignoredBadValue, undefined, 'malformed override colors must not create genotype layers');
assert.strictEqual(feyProfile.creatureGenotype.base.color, '#443322', 'render override must not mutate stored breeding-compatible genotype in place');

// Pure hat-rig behavior: derive attachment from the painted head region and clamp malformed authored values.
const localStorageState = {};
const headwearSandbox = {
  console,
  URL,
  Uint16Array,
  document: { currentScript: { src: 'https://example.invalid/docs/js/animal-npc-headwear.js' } },
  localStorage: {
    getItem(key) { return localStorageState[key] || null; },
    setItem(key, value) { localStorageState[key] = String(value); },
  },
  window: {},
};
headwearSandbox.window.localStorage = headwearSandbox.localStorage;
headwearSandbox.globalThis = headwearSandbox.window;
vm.createContext(headwearSandbox);
vm.runInContext(headwearSource, headwearSandbox, { filename: 'animal-npc-headwear.js' });
const headwearApi = headwearSandbox.window.AnimalNpcHeadwear;
assert(headwearApi, 'animal NPC headwear API must initialize');
const derived = headwearApi.deriveAttachmentFromHeadRig({
  weightMap: {
    width: 4,
    height: 4,
    encoding: 'rle-u9',
    unsetValue: 256,
    data: [4, 256, 1, 256, 2, 255, 1, 256, 8, 256],
  },
  pivot: { x: 0.5, y: 0.5 },
});
assert(Math.abs(derived.anchor.x - 0.5) < 1e-12, 'derived hat anchor must center over the painted head region');
assert(Math.abs(derived.anchor.y - 0.25) < 1e-12, 'derived hat anchor must sit at the painted head region top');
assert(derived.width > 0.5 && derived.width < 0.9, 'derived hat width must scale from painted head width');
assert.strictEqual(derived.flipX, false, 'derived hat attachments must start unflipped');
const clampedAttachment = headwearApi.normalizeAttachment({ anchor: { x: -3, y: 4 }, width: 99, rotationDeg: 999, flipX: true, artAnchor: { x: -1, y: 2 } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(clampedAttachment.anchor)), { x: 0, y: 1 }, 'authored hat anchor must clamp to normalized sprite coordinates');
assert.strictEqual(clampedAttachment.width, 2, 'hat width must clamp to the supported authoring range');
assert.strictEqual(clampedAttachment.rotationDeg, 180, 'hat rotation must clamp to the supported authoring range');
assert.strictEqual(clampedAttachment.flipX, true, 'hat horizontal flip must survive attachment normalization');

localStorageState.hobunji_animal_head_rigs_v1 = JSON.stringify({
  grehlr: { hatAttachment: { anchor: { x: 0.1, y: 0.2 }, width: 0.3, rotationDeg: 4, flipX: true, artAnchor: { x: 0.5, y: 0.8 } } },
});
assert.strictEqual(headwearApi.previewRigForKind('grehlr').hatAttachment.width, 0.3,
  'same-origin head-rig preview must expose the saved hat attachment to runtime');
assert.strictEqual(headwearApi.previewRigForKind('grehlr').hatAttachment.flipX, true,
  'same-origin head-rig preview must preserve the authored hat mirror');

console.log('animal/fey NPC color, opacity, stable-control, and hat tests passed');
