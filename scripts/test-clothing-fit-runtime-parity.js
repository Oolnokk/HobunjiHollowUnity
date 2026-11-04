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
    clothPng: {}, compositePng: {}, label: {}, threeStatus: {}, match3DStatus: {},
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

  // The 2D appearance-matching path must use the EXACT front texture passed
  // to the 3D rig, inverse-projected by the same game-space preset B rectangle.
  const rectCode = sourceBetween(part(7), 'function portraitLayerRect(', 'function previewedCloudMaskXform(');
  const portraitLayerRect = new Function(rectCode + '\nreturn portraitLayerRect;')();
  const projectCode = sourceBetween(eight, 'function projectRuntimeFrontToFittingCanvas(source)', 'function canonicalHeadReference(');
  const inverseDraws = [];
  const project = new Function('R', 'document', 'portraitLayerRect', 'targetGarmentLayerXform',
    projectCode + '\nreturn projectRuntimeFrontToFittingCanvas;')(
      { body: { width: 120, height: 240 } },
      { createElement: () => ({ getContext: () => ({
        drawImage: (...args) => inverseDraws.push(args)
      }) }) },
      portraitLayerRect, garmentXform
    );
  const gameFrontTexture = canvas('same 3D front pixels');
  const projected = project(gameFrontTexture);
  assert.equal(projected.width, 120, 'matching 2D artwork uses native target sprite width');
  assert.equal(projected.height, 240, 'matching 2D artwork uses native target sprite height');
  assert.equal(inverseDraws[0][0], gameFrontTexture, '2D must use the identical 3D portrait raster');
  const expectedRect = portraitLayerRect(120, 240, presetB, 200, 200);
  for (const [index, expected] of [
    -expectedRect.x * 120 / expectedRect.w,
    -expectedRect.y * 240 / expectedRect.h,
    200 * 120 / expectedRect.w,
    200 * 240 / expectedRect.h
  ].entries()) {
    assert(Math.abs(inverseDraws[0][index+1]-expected)<1e-7,
      'inverse projection must cancel the preset B placement on axis '+index);
  }

  // A real 2D render reads the completed texture; edits invalidate it until
  // the paired 3D build updates. An obsolete painted character must not survive.
  const nine = part(9);
  assert(nine.includes('buildSinglePlaneAvatarModel(THREE,avatar.frontComposed'),
    '3D construction uses the same frontComposed texture offered to 2D');
  assert(nine.includes('canvas:projectRuntimeFrontToFittingCanvas(avatar.frontComposed)'),
    '3D commit must provide its final frontComposed pixels to the 2D fitting canvas');
  const renderCode = sourceBetween(nine, 'function render(scheduleRig=true)', 'function refreshHelp()');
  const paintCalls = [];
  const matchR = {
    assetGeneration: 3, body: canvas('raw pixels'), authoredTargetCloth: null,
    three: { buildGeneration: 7, matchedFront2D: {
      canvas: projected, buildGeneration: 7, assetGeneration: 3,
      species: 'tletingan', gender: 'female'
    } }
  };
  const matchE = {
    stage: { width: 120, height: 240 }, label: {}, match3D: { checked: true },
    match3DStatus: {}, showBody: { checked: true }, showGarment: { checked: true },
    showMeshes: { checked: false }, showAuthored: { checked: false },
    species: { value: 'tletingan', selectedIndex: 0, options: [{ text: 'Tletingan' }] },
    gender: { value: 'female' }, sourceSpecies: { value: 'mao-ao' }, sourceGender: { value: 'male' },
    garment: { value: '' }
  };
  const matchC = {
    setTransform: () => {}, clearRect: () => {},
    drawImage: image => paintCalls.push(image===projected?'game-matched':image.label),
    imageSmoothingEnabled: false
  };
  let rebuilds = 0;
  const renderMatched = new Function(
    'R','E','C','fitRegion','sizeStage','headwearWarpForView','mode','routedPatchIsBody',
    'currentWarp','mainClothSource','garmentRecord','drawGrid','SOURCE_GRID',
    'transformedSourceGrid','targetGrid','refreshHelp','refreshDebug','scheduleThreePreview',
    renderCode + '\nreturn render;'
  )(
    matchR,matchE,matchC,()=> 'body',()=>{},()=>null,'preview',
    ()=>false,()=>null,()=>null,()=>null,()=>{},[],
    ()=>[],()=>[],()=>{},()=>{},()=>{rebuilds++;}
  );
  renderMatched(false);
  assert.deepEqual(paintCalls, ['game-matched'],
    'the 2D canvas must paint the same 3D front texture, not a separate raw character');
  assert(matchE.match3DStatus.textContent.startsWith('Game-matched:'),
    'mobile status must confirm that both portrait textures agree');
  assert.equal(rebuilds, 0, 'synchronizing the 2D canvas must not trigger a recursive 3D build');
  matchE.match3D.checked = false;
  paintCalls.length = 0;
  renderMatched(false);
  assert.deepEqual(paintCalls, ['raw pixels'],
    'turning off game matching must reveal the original fitting art without a 3D rebuild');
  matchE.match3D.checked = true;
  paintCalls.length = 0;
  renderMatched(false);
  assert.deepEqual(paintCalls, ['game-matched'],
    'turning game matching back on restores the exact current 3D texture');
  renderMatched();
  assert.equal(matchR.three.matchedFront2D, null,
    'a transform update invalidates the old 3D portrait before the next 2D paint');
  assert(paintCalls.includes('raw pixels'),
    'the temporary raw artwork remains available during an asynchronous rig rebuild');
  assert.equal(rebuilds, 1, 'editing still schedules the paired 3D refresh');

  // Both front portraits must hide the source garment in Grid Only mode.
  options.showGarment.checked=true;
  const gridOnlyCompose = new Function(
    'R', 'E', 'document', 'runtimePortraitSet', 'routedPatchIsBody',
    'mainClothSource', 'currentWarp', 'renderRoutedBodyPatchOverlay', 'fitRegion',
    'rawGarmentToRuntimeLayer', 'flipCanvasX', 'garmentRecord', 'mode',
    composedSource + '\nreturn composeRuntimePortrait;'
  )(
    state, options, { createElement: () => canvas('composed') },
    async () => ({ front: canvas('baseFront'), back: canvas('baseBack'), headOnlyFront: canvas('headOnly') }),
    () => false, () => canvas('source'), () => canvas('warped'),
    async () => null, () => 'body', async () => canvas('garment'),
    () => canvas('rearGarment'), () => ({ slot: 'torso' }), 'body'
  );
  const gridOnlyPortrait = await gridOnlyCompose();
  assert.deepEqual(gridOnlyPortrait.frontComposed.draws, ['baseFront'],
    'Grid Only cannot display clothing on 3D while 2D hides it');

  // The game's full-portrait cloud mask was retired. A fitted torso texture
  // must NOT be destination-out clipped by an obsolete preview-only helper.
  const rawSource = sourceBetween(part(7) + '\n' + eight,
    'async function rawGarmentToRuntimeLayer(', 'function targetGarmentLayerXform()');
  let obsoleteMaskCalls = 0; // Any call is a regression: it removes valid clothing pixels.
  const canvasDraws = [];
  const makeDrawingCanvas = () => ({
    width: 0, height: 0, getContext: () => ({
      drawImage: (...args) => canvasDraws.push(args),
      imageSmoothingEnabled: false, globalAlpha: 1
    })
  });
  const garmentLayer = new Function('R','document','window','targetGarmentLayerXform',
    'portraitLayerRect','fitRegion','applyRuntimeCloudMask',
    rawSource + '\nreturn rawGarmentToRuntimeLayer;'
  )(
    { body: { width: 234, height: 173 } }, { createElement: makeDrawingCanvas },
    { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { previewPortraitCanvasSize: 200 } } } } },
    garmentXform,portraitLayerRect,() => 'body', () => { obsoleteMaskCalls++; }
  );
  const raw = { width: 234, height: 173 };
  const renderedGarment = await garmentLayer(raw,0.8);
  assert.equal(renderedGarment.width,200,'garment preview renders in the game portrait coordinate space');
  assert.equal(canvasDraws[0][0],raw,'garment preview uses the current fitted PNG');
  assert.equal(obsoleteMaskCalls,0,'runtime garment overlay must not erase pixels with the old cloud mask');

  // The canonical game's torso and head are both B. An A-preset reference
  // misaligns 2D head/hood fitting even when 3D is otherwise correct.
  const bodyXformSource=sourceBetween(six,'function targetBodyLayerXform()', 'function routedBodyTintSlot(');
  const bodyXform=new Function('window','normalizedLayerXform',
    bodyXformSource+'\nreturn targetBodyLayerXform;')(
      { getPortraitXformPreset:()=>presetB }, value=>({ ...value })
    );
  assert.deepEqual(bodyXform(),presetB,'body/head reference inverse projection must use game preset B');

  const headRefCode=sourceBetween(part(2),'async function buildHeadReferenceCanvas(', 'async function buildVariantGarmentCanvas(');
  const headDraws=[];
  const headRef=new Function('R','window','document','loadImage','assetUrl',
    'portraitLayerRect','normalizedLayerXform','log',
    headRefCode+'\nreturn buildHeadReferenceCanvas;'
  )(
    { speciesCfg: new Map([['tletingan', { male: {
      headSprite: 'tletingan.png',
      portraitBodyLayers: [{ id: 'torso', xform: { ax:-0.2, ay:0, sx:2.55, sy:2.55 } }]
    }}]]) },
    { getPortraitXformPreset:()=>presetB },
    { createElement: () => ({ getContext: () => ({ drawImage: (...args) => headDraws.push(args) }) }) },
    async()=>({width:234,height:173,naturalWidth:234,naturalHeight:173}),
    url=>url,portraitLayerRect,value=>({...value}),()=>{}
  );
  await headRef('tletingan','male',234,173);
  assert.equal(headDraws.length,1,'head reference renders from the selected target');
  for(const [i,n] of [0,0,234,173].entries()) {
    assert(Math.abs(headDraws[0][i+1]-n)<1e-7,
      'headwear reference and game base torso must share preset B on axis '+i);
  }

  // Extended custom art must also remain unaffected by the retired mask.
  const extendedCode=sourceBetween(eight,'async function extendedRuntimeCanvas()','function disposeObjectTree(');
  const extended=new Function('R','window','document','currentExtendedWarp','targetBodyLayerXform',
    'portraitLayerRect','applyRuntimeCloudMask',extendedCode+'\nreturn extendedRuntimeCanvas;')(
    { extendedSource:{}, body:{width:234,height:173} },
    { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { previewPortraitCanvasSize:200 } } } } },
    { createElement:makeDrawingCanvas },
    ()=>({width:234,height:290}),bodyXform,portraitLayerRect,
    ()=>{obsoleteMaskCalls++;}
  );
  const ext=await extended();
  assert(ext&&ext.width===200&&ext.height>200,'extended art stays in game portrait width and may grow downward');
  assert.equal(obsoleteMaskCalls,0,'extended art must not be destroyed by the removed cloud mask');

  // Grid-only truly excludes BOTH fitted and already-authored overlays.
  state.authoredTargetCloth=canvas('authored');
  options.showAuthored.checked=true;
  const gridOnlyAuthored=await gridOnlyCompose();
  assert.deepEqual(gridOnlyAuthored.frontComposed.draws,['baseFront'],
    'grid-only mode must not leak an authored garment into 3D');
  state.authoredTargetCloth=null;
  options.showAuthored.checked=false;

  // Hiding the raw body in the 2D editor must not hide a routed body patch
  // from 3D; the two checkboxes intentionally have different scopes.
  const patchedCompose=new Function(
    'R','E','document','runtimePortraitSet','routedPatchIsBody',
    'mainClothSource','currentWarp','renderRoutedBodyPatchOverlay','fitRegion',
    'rawGarmentToRuntimeLayer','flipCanvasX','garmentRecord','mode',
    composedSource+'\nreturn composeRuntimePortrait;'
  )(
    state,{ ...options, showBody:{checked:false} },
    { createElement:()=>canvas('composed') },
    async()=>({front:canvas('front'),back:canvas('back')}),
    ()=>true,()=>canvas('source'),()=>canvas('warped'),
    async()=>canvas('bodyPatch'),()=> 'body',async()=>canvas('garment'),
    ()=>canvas('rearGarment'),()=>({slot:'torso'}),'fit'
  );
  const patched=await patchedCompose();
  assert.deepEqual(patched.backComposed.draws,['back','bodyPatch'],
    'hide-body checkbox in 2D cannot silently remove a 3D body patch');

  // Failed rebuilds cannot keep the previous successful 3D avatar visible.
  const updateCode=sourceBetween(nine,'async function updateThreePreview()','function scheduleThreePreview(');
  const failedRig={ body:canvas('body'),three:{buildGeneration:0,matchedFront2D:projected} };
  const failedE={ match3D:{checked:true},match3DStatus:{},threeStatus:{} };
  const failEvents=[];
  const previewUpdate=new Function('R','E','startOptionalThreePreview',
    'withThreePreviewDeadline','ensureRigRuntime','disposeRuntimeRig','render','console','log',
    updateCode+'\nreturn updateThreePreview;'
  )(failedRig,failedE,()=>true,async promise=>promise,
    async()=>{throw Error('simulated runtime load failure');},
    ()=>failEvents.push('dispose'),schedule=>failEvents.push('fallback:'+schedule),
    {error:()=>{}},()=>{});
  await previewUpdate();
  assert.deepEqual(failEvents,['dispose','fallback:false'],
    'a failed 3D build disposes the old rig and paints the 2D fallback exactly once');
  assert.equal(failedRig.three.matchedFront2D,null,
    'failed rebuild cannot keep a stale game-matched 2D character');
  assert(failedE.threeStatus.textContent.includes('simulated runtime load failure'),
    '3D failure is reported visibly on mobile');

  console.log('clothing fit/game portrait, head/body B alignment, retired cloud mask, 2D/3D parity, grid-only and failed-rig cleanup tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
