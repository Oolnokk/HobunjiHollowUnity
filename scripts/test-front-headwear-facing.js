#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Executes the shared portrait parser and rear-view replacement rules.

const read = path => fs.readFileSync(path, 'utf8');
const avatarPreview = read('docs/js/npc-avatar-preview-utils.js');
const hats = read('docs/js/front-hat-head-facing.js');
const hatXray = read('docs/js/hat-xray-head-facing.js');
const loader = read('docs/js/combat/combat-config-loader.js');
const game = read('docs/game.js');
const basicHeadband = JSON.parse(read('docs/config/cosmetics/basic_headband.json'));
const leatherHeadband = JSON.parse(read('docs/config/cosmetics/leather_headband.json'));
const wideKasa = JSON.parse(read('docs/config/cosmetics/riverlandskasa_wide.json'));
const tangedCirclet = JSON.parse(read('docs/config/cosmetics/clothes/hat/tangedcirclet.json')); // Used below to guard its species-specific behind-the-head band art.
const bzabagHelm = JSON.parse(read('docs/config/cosmetics/clothes/hat/replica_bzabag_helm.json')); // Guards front cap and its explicitly authored rear counterparts.

const forbiddenAngleBehavior = /TILT_CUTOFF|yawCutoff|tiltCutoff|FacingGate|facingUniform|worldFront|worldUp|toCamera|uprightDot|yawDot|smoothstep\s*\(|hobunjiFrontHatless|material\.opacity\s*=|currentMaterial\.opacity\s*=/i;
assert.doesNotMatch(hats, forbiddenAngleBehavior, 'normal hats have no camera/head-angle visibility system');
assert.doesNotMatch(hatXray, forbiddenAngleBehavior, 'hat x-rays have no camera/head-angle visibility system');
assert.match(hats, /angleVisibility:\s*'disabled'/, 'legacy normal-hat adapter explicitly reports angle visibility disabled');
assert.match(hatXray, /angleVisibility:\s*'disabled'/, 'hat x-ray debug explicitly reports angle visibility disabled');
assert.doesNotMatch(hats, /renderProfileToCanvas|buildSinglePlaneAvatarModel|onBeforeCompile|onBeforeRender/, 'normal-hat compatibility shim installs no rendering hooks');

assert.doesNotMatch(loader, /fine-hood-trim-head-facing\.js/i, 'Fine Hood angle-facing adapter is no longer bootstrapped');
assert.doesNotMatch(
  avatarPreview,
  /FineHoodTrimHeadOn|fineHoodTrimHeadOn|hobunjiFineHoodTrim|finehood-trim-head-on/i,
  'shared avatar preview has no Fine Hood angle-gating or trimless blend path'
);
assert.match(
  avatarPreview,
  /renderProfileWithWovenPatterns\(renderer, canvas, profile, renderOptions\);[\s\S]{0,80}await renderer\(canvas, profile, renderOptions\);\s*\}\s*return true;/,
  'shared avatar preview renders authored headwear without angle substitution'
);

assert.ok(loader.includes('js/front-hat-head-facing.js'), 'legacy front-hat shim remains loadable without a missing-script request');
assert.ok(loader.includes('js/hat-xray-head-facing.js'), 'hat x-ray coplanar correction remains bootstrapped');
assert.match(game, /freezePlayerAvatarPortraitComposer\(Date\.now\(\)\)/, 'player avatar rebuild freezes one portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessFrontCanvas, hatlessProfile, staticRenderOptions\)/, 'hatless xray source reuses the full portrait deformation sample');
assert.match(game, /renderProfileToCanvas\(hatlessBackCanvas, hatlessProfile, \{ \.\.\.staticRenderOptions, portraitView: 'behind' \}\)/, 'rear hatless xray source reuses the same deformation sample');

const headLayers = json => Object.keys(json?.parts?.head?.layers || {});
assert.deepEqual(headLayers(basicHeadband), ['front'], 'Basic Headband is authored front-only');
assert.deepEqual(headLayers(leatherHeadband), ['front'], 'Leather Headband is authored front-only');
assert.ok(headLayers(wideKasa).includes('front') && headLayers(wideKasa).includes('back'), 'Riverland Kasa keeps authored front and back art');
assert.deepEqual(headLayers(tangedCirclet), ['front'], 'Tanged Circlet has one sprite per portrait view');

const expectedTangedBack = { // Used by the loop below to keep circlet rear bands aligned with Basic Headband species art.
  'mao-ao_male': 'headband.png',
  'mao-ao_female': 'headband.png',
  'tletingan_male': 'tl_headband.png',
  'tletingan_female': 'tl_headband.png',
  'kenkari_male': 'kenk_headband_m.png',
  'kenkari_female': 'kenk_headband_f.png',
  'rakakoan_male': 'kenk_headband_m.png',
  'rakakoan_female': 'kenk_headband_f.png',
  'engh-sho_male': 'headband.png',
  'engh-sho_female': 'headband.png',
  'harlyao_male': 'headband.png',
  'harlyao_female': 'headband.png',
  'harlyao-skeleton_male': 'headband.png',
  'harlyao-skeleton_female': 'headband.png',
  'mashtzarr_male': 'mashtz_headband_m.png',
  'mashtzarr_female': 'mashtz_headband_m.png',
};
const portraitContext = vm.createContext({ window: {}, console }); // Uses the shipped config and portrait implementation, including species variants.
vm.runInContext(read('docs/config/scratchbones-config.js'), portraitContext);
vm.runInContext(read('docs/js/portrait-utils.js'), portraitContext);
const circletOption = portraitContext.portraitOptionFromJson({ id: 'tangedcirclet' }, tangedCirclet); // Actual runtime option, with no extra rear layer.
for (const [variant, filename] of Object.entries(expectedTangedBack)) {
  const layers = circletOption.variantLayers[variant]; // Exactly one front sprite is replaced when rendering the back plane.
  assert.equal(layers.length, 1, variant + ' has no additive headband layer');
  assert.equal(layers[0].pos, 'front');
  assert.equal(layers[0].paletteColorKey, 'A', 'rear replacement retains metal material routing');
  assert.equal(portraitContext._getBehindLayerUrl(layers[0], circletOption, variant.split('_').at(-1)), 'cosmetics/clothes/hat/' + filename);
  assert(layers[0].url.includes('tangedcirclet'), 'rear lookup does not mutate front art');
  assert(fs.existsSync('docs/assets/cosmetics/clothes/hat/' + filename));
}
assert.equal(portraitContext._getBehindLayerUrl(circletOption.layers[0], circletOption, 'male'), 'cosmetics/clothes/hat/headband.png');

const helmOption = portraitContext.portraitOptionFromJson({ id: 'replica_bzabag_helm' }, bzabagHelm);
const helmLayers = helmOption.variantLayers['mao-ao_male'];
assert.equal(helmLayers.length, 2, 'helm keeps precisely two head-front layers');
assert.deepEqual(Array.from(helmLayers, layer => layer.pos), ['front', 'front'], 'neither helm sprite goes beneath the front-view skull');
assert(helmLayers[0].url.endsWith("replica_bzabag's_helm-cap_m.png"), 'wool cap renders before the faceguard');
assert(helmLayers[1].url.endsWith("replica_bzabag's_helm-faceguard_m.png"), 'metal faceguard covers cap in front view');
assert.deepEqual(Array.from(helmLayers, layer => layer.materialKind), ['cloth', 'metal'], 'cap and band retain independent material treatment');
assert.equal(portraitContext._getBehindLayerUrl(helmLayers[0], helmOption, 'male'), helmLayers[0].url, 'rear cap retains its exact source PNG');
assert.equal(portraitContext._getBehindLayerUrl(helmLayers[1], helmOption, 'male'), 'cosmetics/clothes/hat/headband.png', 'rear metal band shares Tanged Circlet behind sprite');
assert.equal(portraitContext._getBehindLayerUrl(helmLayers[1], helmOption, 'male'), portraitContext._getBehindLayerUrl(circletOption.variantLayers['mao-ao_male'][0], circletOption, 'male'), 'the rear-band pixels use the existing Tanged Circlet path');
assert.equal(helmOption.variantLayers['mao-ao_female'], undefined, 'unillustrated gender does not inherit helm sprites');

// The loom/icon compositor must follow the same explicit headwear rear URL as the actual portrait.
const weavingSource = read('docs/js/clothing-weaving-system.js');
assert.match(weavingSource, /behindUrl:\s*layer\?\.behindImage\?\.url/, 'loom collects the per-layer rear sprite choice');
assert.match(weavingSource, /behindViewResultFor\(frontUrl, baseCosmeticIdValue, behindGender, behindUrl\)/, 'loom rear rendering passes each layer\'s alternate sprite');
assert.match(weavingSource, /behindViewResultFor\(url, baseCosmeticIdValue, resolvedGender, behindUrl\)/, 'loom offers rear view when a layer has its own back sprite');

// The fit editor builds the rear cap + band as a distinct view, not as cloth behind the skull.
const fitParts = Array.from({ length: 12 }, (_, i) => read('docs/tools/clothing-species-fit/app.part' + (i + 1) + '.txt'));
assert.doesNotThrow(() => new Function(fitParts.join('\n')), 'all split clothing-fit JavaScript compiles together');
const fitSource = fitParts.join('\n');
assert.match(fitSource, /canvas\._behindView=hasBehindOverride\?behindView:null/, 'headwear keeps rear-facing composite separate from under-skull artwork');
assert.match(fitSource, /headwearWarpForView\('back'\)/, 'headwear back export uses the authored rear composite');
assert.match(fitSource, /if\(behindView\)\{[\s\S]{0,220}rawGarmentToRuntimeLayer\(behindView,opacity\)/, 'full-character rear preview draws the dedicated back art');
assert.match(fitSource, /Missing rear \$\{garment\.label\} layer/, 'missing rear variant falls back without discarding the whole layer');
assert.match(fitSource, /const pinnedPreviewSha=location\.pathname\.match/, 'commit-pinned preview follows the matching repository data instead of main');

console.log('Headwear angle-visibility removal checks passed.');
