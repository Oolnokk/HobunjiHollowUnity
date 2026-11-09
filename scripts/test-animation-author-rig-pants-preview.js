'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const author = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
const dump = fs.readFileSync('docs/js/transform-dump-utils.js', 'utf8');
const bootstrap = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8');
const parity = fs.readFileSync('docs/js/animation-author-rig-gameplay-appearance.js', 'utf8');
assert.match(author, /'config\/pants-rigs\.js'[\s\S]*'js\/pants-rig-core\.js'[\s\S]*'js\/pants-garment-renderer\.js'/,
  'Animation Author must load the same authored pants config/core/renderer used by gameplay');
assert.match(author, /function installRigPantsPreviewV1546\(actor\)/, 'Rig Coordinates must own an explicit pants preview installer');
assert.match(author, /Renderer\.garmentForCosmetics\?\.\(npc\?\.equippedCosmetics \|\| \[\]\)/,
  'Rig pants must follow the NPC database authored pants\/skirt instead of inventing clothing');
assert.match(author, /Renderer\.attachToLegs\(state\.three\.THREE, actor\.rigFeetPreview/,
  'Rig pants must bind to the exact gameplay ProceduralLegAnimation handle already shown in the character rig animator');
assert.match(author, /avatarGroup: actor\.model/, 'garment mapping must use the rendered portrait model as its coordinate space');
assert.match(author, /garment\.imageLayers = garment\.imageLayers\.map/,
  'multi-sprite draped pants and layered skirts must retain every authored image layer');
assert.match(author, /Renderer\.buildOverlayMask\(sourceFront, profile/,
  'pants must respect overwear\/arm\/pauldron\/hood occlusion in the rig preview');
assert.match(author, /installRigPantsPreviewV1546\(actor\);[\s\S]*actor\.rigFeetPreview\?\.update/,
  'pants must attach before the initial procedural-leg tick so the first visible rig frame is clothed');
assert.match(bootstrap, /animation-author-rig-gameplay-appearance\.js\?v=/,
  'Animation Author bootstrap must load the gameplay-appearance parity bridge');
assert.match(parity, /buildProfileFromNpcExport\?\.\(descriptor\)/,
  'Rig parity must resolve NPC dyes/body colors through the same portrait-profile builder used by gameplay-compatible previews');
assert.match(parity, /garmentForCosmetics\?\.\(descriptor\.equippedCosmetics \|\| \[\]\)/,
  'Rig parity must choose the garment from the normalized raw NPC export');
assert.match(parity, /appearanceFromBodyColors\?\.\(bodyColors\)/,
  'Rig parity must feed the renderer resolved PANTS\/PANTS_B\/PANTS_C body colors');
assert.match(parity, /await pants\.setAppearance\?\.\(appearance\)/,
  'Rig parity must refresh the existing gameplay garment handle instead of drawing an editor-only substitute');
assert.match(parity, /pantsHandleFor\(actor\)[\s\S]*actor\?\.rigFeetPreview\?\.pants/,
  'Rig parity must retain attachToLegs ownership of per-frame garment updates and disposal');
assert.match(parity, /Renderer\.buildOverlayMask\(sourceFront, portraitProfile/,
  'Rig parity must rebuild gameplay occlusion from the same normalized profile as its dyes');
assert.match(dump, /LEGACY_POSTERIOR_FLOORS/, 'Animation Author stale-profile repair must migrate the superseded posterior defaults');

// Pure descriptor behavior: avatar-editor export data is normalized exactly like
// Full Character Scale/gameplay preview data, while explicit top-level appearance
// fields remain the final visual override.
const context = {
  console,
  URL,
  location: { pathname: '/tools/animation-author/index.html', href: 'https://example.test/docs/tools/animation-author/index.html' },
  document: {
    currentScript: { src: 'https://example.test/docs/js/animation-author-rig-gameplay-appearance.js' },
    body: { dataset: { animationAuthorMode: 'multi' } },
  },
  setInterval: () => 1,
  clearInterval: () => {},
  addEventListener: () => {},
};
context.window = context;
vm.createContext(context);
vm.runInContext(parity, context, { filename: 'animation-author-rig-gameplay-appearance.js' });
const api = context.HobunjiAnimationAuthorRigGameplayAppearance;
assert(api, 'gameplay-appearance parity bridge must expose diagnostics/test API');
const descriptor = api.gameplayNpcDescriptor({
  id: 'npc_test',
  gender: 'male',
  equippedCosmetics: ['pants_basic'],
  appliedDyes: { PANTS: 'top-level-dye' },
  appearance: { speciesId: 'mao-ao', gender: 'male', bodyColors: { PANTS: { hex: '#333333' } }, cosmetics: { top: 'top' } },
  avatarEditor: { rawExport: {
    equippedCosmetics: ['layered_skirt'],
    appliedDyes: { PANTS: 'raw-export-dye' },
    profile: { appearance: { bodyColors: { PANTS: { hex: '#000000' }, PANTS_C: { hex: '#cccccc' } }, cosmetics: { profile: 'profile' } } },
    appearance: { speciesId: 'kenkari', gender: 'female', bodyColors: { PANTS: { hex: '#111111' }, PANTS_B: { hex: '#222222' } }, cosmetics: { raw: 'raw' } },
  } },
});
assert.strictEqual(descriptor.appearance.speciesId, 'mao-ao');
assert.strictEqual(descriptor.appearance.gender, 'male');
assert.strictEqual(descriptor.appearance.bodyColors.PANTS.hex, '#333333');
assert.strictEqual(descriptor.appearance.bodyColors.PANTS_B.hex, '#222222');
assert.strictEqual(descriptor.appearance.bodyColors.PANTS_C.hex, '#cccccc');
assert.deepStrictEqual(Array.from(descriptor.equippedCosmetics), ['layered_skirt']);
assert.strictEqual(descriptor.appliedDyes.PANTS, 'raw-export-dye');
assert.strictEqual(descriptor.appearance.cosmetics.profile, 'profile');
assert.strictEqual(descriptor.appearance.cosmetics.raw, 'raw');
assert.strictEqual(descriptor.appearance.cosmetics.top, 'top');
console.log('Animation Author rig pants/posterior/gameplay-appearance preview guards passed');
