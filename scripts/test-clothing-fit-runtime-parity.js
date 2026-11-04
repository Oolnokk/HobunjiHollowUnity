'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../docs/tools/clothing-species-fit');
const part = index => fs.readFileSync(path.join(root, `app.part${index}.txt`), 'utf8');
const sourceBetween = (source, first, last) => {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert(start >= 0 && end > start, `Missing fit editor function: ${first}`);
  return source.slice(start, end);
}; // Extracts the shipped editor functions, not a hand-written duplicate.

const canvas = label => {
  const value = { label, width: 200, height: 200, draws: [] };
  value.getContext = () => ({ drawImage: image => value.draws.push(image.label) });
  return value;
}; // Records the actual composition draw order without WebGL.

async function main() {
  const six = part(6), eight = part(8);
  const presetB = { ax: -0.0983, ay: -0.0809, sx: 2.49, sy: 2.49 };
  const xformSource = sourceBetween(eight, 'function targetGarmentLayerXform()', 'function canonicalHeadReference(');
  const garmentXform = new Function('window', 'normalizedLayerXform',
    xformSource + '\nreturn targetGarmentLayerXform;')(
      { getPortraitXformPreset(name) {
        assert.equal(name, 'B', 'the game applies preset B to all cosmetic portrait layers');
        return presetB;
      } },
      raw => ({ ...raw })
    );
  assert.deepEqual(garmentXform(), presetB,
    'the tool must never use the body A transform or the cosmetic spriteStyle over game preset B');

  const calls = [];
  const three = { portraitCache: new Map(), runtimeDocsBase: 'test' };
  const runtimeWindow = {
    SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { previewPortraitCanvasSize: 200 } } } },
    NpcAvatarPreview: {
      buildProfileFromNpcExport: () => ({ fighter: { headUrl: 'head.png', bodyLayers: [] } }),
      renderProfileToCanvas: async (out, profile, options) => { calls.push(options.seatId); }
    }
  };
  const E = { species: { value: 'tletingan' }, gender: { value: 'male' } };
  const runtimeCode = sourceBetween(six, 'function runtimeProfileKey()', 'function normalizedLayerXform(');
  const runtimePortraitSet = new Function(
    'R', 'E', 'window', 'document', 'ensureRigRuntime', 'currentMaskTransform',
    'withPreviewCloudMaskTransform', 'safeName', 'fitRegion',
    runtimeCode + '\nreturn runtimePortraitSet;'
  )(
    { three }, E, runtimeWindow, { createElement: () => canvas('render') },
    async () => true, () => ({ scaleX: 1, scaleY: 1, translateY: 0 }),
    async callback => callback(), v => String(v), () => 'body'
  );
  const bodyPortrait = await runtimePortraitSet();
  assert(bodyPortrait.headOnlyFront, 'body fitting needs the isolated head for correct front depth');
  assert(calls.includes('clothing-fit-head-front'), 'body fitting actually renders the isolated head');

  let selectedSlot = 'torso';
  const state = { body: {}, authoredTargetCloth: null };
  const options = {
    showGarment: { checked: true }, opacity: { value: '1' },
    showAuthored: { checked: false }, authoredOpacity: { value: '1' },
    showBody: { checked: true }
  };
  const composedSource = sourceBetween(eight, 'async function composeRuntimePortrait()', 'async function extendedRuntimeCanvas(');
  const compose = new Function(
    'R', 'E', 'document', 'runtimePortraitSet', 'routedPatchIsBody',
    'mainClothSource', 'currentWarp', 'renderRoutedBodyPatchOverlay', 'fitRegion',
    'rawGarmentToRuntimeLayer', 'flipCanvasX', 'garmentRecord', 'mode',
    composedSource + '\nreturn composeRuntimePortrait;'
  )(
    state, options, { createElement: () => canvas('composed') },
    async () => ({ front: canvas('baseFront'), back: canvas('baseBack'), headOnlyFront: canvas('headOnly') }),
    () => false, () => canvas('source'), () => canvas('warped'),
    async () => null, () => 'body', async () => canvas('garment'),
    () => canvas('rearGarment'), () => ({ slot: selectedSlot }), 'fit'
  );

  const torso = await compose();
  assert.deepEqual(torso.frontComposed.draws, ['baseFront', 'garment', 'headOnly'],
    'front torso clothing must be painted before the head as in the live game');
  assert.deepEqual(torso.backComposed.draws, ['baseBack', 'rearGarment'],
    'rear torso clothing remains over the rear skull as in the live game');

  selectedSlot = 'pauldron';
  const pauldron = await compose();
  assert.deepEqual(pauldron.frontComposed.draws, ['baseFront', 'garment'],
    'front pauldrons stay above the head in game layer order');

  options.showGarment.checked = false;
  const bare = await compose();
  assert.deepEqual(bare.frontComposed.draws, ['baseFront'],
    'hiding the garment must not render a redundant head overlay');
  console.log('clothing fit/game portrait preset and front/back layer parity passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
