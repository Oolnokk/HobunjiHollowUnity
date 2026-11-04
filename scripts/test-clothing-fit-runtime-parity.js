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
  // Browser select controls must change the actual wearer, not only the donor garment.
  const twelve = part(12);
  const targetHandlers = sourceBetween(twelve, "let lastTargetSelection='';", 'E.garment.onchange=');
  const wearer = { species: { value: 'mao-ao' }, gender: {
    value: 'male', options: [{ value: 'male' }, { value: 'female' }]
  }, sourceSpecies: { value: 'tletingan' }, sourceGender: { value: 'female' }, useStartingAsTarget: {} };
  const wornSpecies = new Map([
    ['mao-ao', { genders: ['male', 'female'], male: { portraitBodyLayers: [{}] }, female: { portraitBodyLayers: [{}] } }],
    ['tletingan', { genders: ['male', 'female'], male: { portraitBodyLayers: [{}] }, female: { portraitBodyLayers: [{}] } }],
    ['porakaneki', { genders: ['male'], male: { portraitBodyLayers: [{}] } }]
  ]);
  let refreshed = 0;
  const selectors = new Function('E', 'R', 'refreshAssets',
    targetHandlers + '\nreturn { changeTargetSprite, syncTargetGenderChoices };')(
      wearer, { speciesCfg: wornSpecies, garmentSelectionEpoch: 0 }, () => { refreshed++; }
    );
  wearer.useStartingAsTarget.onclick();
  assert.equal(wearer.species.value, 'tletingan', 'source-as-target button changes the displayed wearer');
  assert.equal(wearer.gender.value, 'female', 'source-as-target button carries the source gender');
  assert.equal(refreshed, 1, 'button requests a new preview');
  wearer.species.oninput();
  wearer.species.onchange();
  assert.equal(refreshed, 1, 'input and change from one mobile selection must not reload twice');
  wearer.species.value = 'porakaneki';
  wearer.species.oninput();
  assert.equal(wearer.gender.value, 'male', 'target species switches to an authored gender');
  assert.equal(refreshed, 2, 'target change refreshes both previews');
  assert.equal(wearer.gender.options[1].disabled, true, 'invalid target gender is disabled');

  // If a selected species cannot load, the previous character must disappear;
  // otherwise both canvases misleadingly appear stuck on Mao-ao.
  const refreshCode = sourceBetween(part(4), 'async function refreshAssets()', 'function sizeStage(');
  const emptyPreviewCalls = [];
  const refR = {
    assetGeneration: 0, body: canvas('old Mao-ao'), sourceBody: null,
    cloth: null, headReference: null, authoredTargetCloth: null,
    patchWorkflow: { active: false, canvas: null, revision: 0 },
    three: { buildGeneration: 0, buildTimer: null }
  };
  const refE = {
    species: { value: 'tletingan' }, gender: { value: 'male' },
    garment: { value: 'hood' }, sourceSpecies: { value: 'mao-ao' },
    sourceGender: { value: 'male' }, fitRegion: { value: 'body' },
    clothPng: {}, compositePng: {}, label: {}, threeStatus: {},
    sourceLayerStatus: {}, authoredStatus: {}, exportHeadwearFront: {}, exportHeadwearBack: {}
  };
  const refC = {
    setTransform: (...args) => emptyPreviewCalls.push(['identity', ...args]),
    clearRect: (...args) => emptyPreviewCalls.push(['clear', ...args])
  };
  const viewport = { width: 200, height: 200 };
  refE.stage = viewport;
  let failTarget = false, rendered = 0;
  const refresh = new Function(
    'R','E','C','clearTimeout','disposeRuntimeRig','fitRegion',
    'buildBodyCanvas','buildSourceReferenceCanvas','buildHeadReferenceCanvas','buildGarmentCanvas',
    'buildVariantGarmentCanvas','ensureTargetData','syncTransformControls','syncMaskTransformControls',
    'saveState','render','status','log','console','window','CustomEvent',
    refreshCode + '\nreturn refreshAssets;'
  )(
    refR,refE,refC,()=>{},()=>emptyPreviewCalls.push(['dispose']),
    ()=>refE.fitRegion.value,
    async (species)=>{if(failTarget)throw Error('missing species art');return canvas(species);},
    async ()=>canvas('source'),async ()=>canvas('head'),async ()=>canvas('hood'),async ()=>canvas('authored'),
    ()=>{},()=>{},()=>{},()=>{},()=>{rendered++;},
    ()=>{},()=>{},console,{dispatchEvent:()=>{}},function(){}
  );
  await refresh();
  assert.equal(refR.body.label, 'tletingan', 'the 2D target canvas must use the selected species');
  assert.equal(rendered, 1, 'successful target load paints the replacement character');
  assert(emptyPreviewCalls.some(call=>call[0]==='clear'), 'switching species clears the old 2D character');
  assert(emptyPreviewCalls.some(call=>call[0]==='dispose'), 'switching species destroys the old 3D rig');
  assert(refE.threeStatus.textContent.includes('tletingan'), 'rig load status names the target');
  failTarget = true;
  refE.species.value='mammakhbuur';
  await refresh();
  assert.equal(refR.body, null, 'a failed target must never reuse the old Mao-ao/tletingan body');
  assert(refE.sourceLayerStatus.textContent.includes('mammakhbuur'), 'load failure names the missing target');
  assert(refE.threeStatus.textContent.includes('No rig for mammakhbuur'), 'load failure cannot leave a misleading old rig status');

  console.log('clothing fit/game portrait preset, front/back depth, and species switching parity passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
