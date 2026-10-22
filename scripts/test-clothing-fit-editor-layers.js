'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const toolRoot = path.join(root, 'docs/tools/clothing-species-fit');
const read = name => fs.readFileSync(path.join(toolRoot, name), 'utf8');
const core = Array.from({length: 12}, (_, i) => read(`app.part${i + 1}.txt`)).join('\n');
const behind = Array.from({length: 5}, (_, i) => read(`behind.part${i + 1}.txt`)).join('\n');
const html = read('index.html');

function sourceBetween(start, end) {
  const from = core.indexOf(start);
  const to = core.indexOf(end, from);
  assert(from >= 0 && to > from, `Cannot locate editor function: ${start}`);
  return core.slice(from, to);
}

function makeCanvas() {
  return {
    width: 0, height: 0, draws: [],
    getContext() {
      return {
        drawImage: (...args) => this.draws.push(args),
        set imageSmoothingEnabled(value) { /* draw scale belongs to the sprite */ }
      };
    }
  };
}

async function main() {
  new Function(core); // Compiles every concatenated segment in the same order as loader.js.
  new Function(behind);
  for (const id of ['sourceSpecies', 'sourceGender', 'sourceLayerStatus', 'compositePng'])
    assert(html.includes(`id="${id}"`), `Missing editor UI control: ${id}`);
  assert(core.includes('function exportFittedGarment') || core.includes('async function exportFittedGarment'));
  assert(behind.includes('window.ClothingFitZip=Object.freeze'), 'The core ZIP export reuses the behind editor encoder');

  const cosmetics = [
    ['helm', 'hat', 'docs/config/cosmetics/clothes/hat/replica_bzabag_helm.json'],
    ['hood', 'hood', 'docs/config/cosmetics/fine_hood.json'],
    ['tunic', 'torso', 'docs/config/cosmetics/clothes/torso/tankan_tunic.json']
  ].map(([id, slot, file]) => ({
    id, slot, label: id, configPath: file.replace(/^docs\//,''),
    cfg: JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  }));
  const R = {garments: cosmetics, garmentCanvases: new Map()};
  const E = {sourceSpecies: {value: 'mao-ao'}, sourceGender: {value: 'male'}};
  let region = 'headwear'; // The harness tests both normal clothing and layered hats/hoods.
  const harness = [
    sourceBetween('function headwearLayerRecords(', 'async function buildHeadReferenceCanvas'),
    sourceBetween('function sourceHasGarmentArt(', 'function rebuildGarmentSelector'),
    sourceBetween('async function buildVariantGarmentCanvas(', 'async function buildGarmentCanvas'),
    sourceBetween('function collectPatchImageNodes(', 'function behindPatchCatalog'),
    sourceBetween('function targetKey(', 'function ensureTargetData')
  ].join('\n');
  const api = new Function('R', 'E', 'document', 'HEAD_SLOTS', 'assetUrl', 'loadImage', 'fitRegion', 'log',
    harness + '\nreturn {buildVariantGarmentCanvas, sourceHasGarmentArt, targetKey};')(
    R, E, {createElement: makeCanvas}, new Set(['hat', 'hood']), value => value,
    url => Promise.resolve({url, naturalWidth: 128, naturalHeight: 128}),
    () => region, () => {}
  );

  const helm = await api.buildVariantGarmentCanvas('helm', 'mao-ao', 'male', 128, 128);
  assert.equal(helm._layers.length, 3, 'Replica Bzabag Helm preserves cloth cap, faceguard and rear metal override');
  assert.deepEqual(helm._layers.map(layer => layer.name), [
    'head.layers.front_cap', 'head.layers.front', 'head.layers.front.behindImage'
  ]);
  assert(helm._layers[2].url.endsWith('headband.png'), 'Metal rear image uses the distinct circlet asset');
  assert.deepEqual(Array.from(helm._layers[2].path), ['parts', 'head', 'layers', 'front', 'behindImage']);
  assert(helm._layers.every(layer => layer.canvas.width === 128 && layer.canvas.height === 128));

  const hood = await api.buildVariantGarmentCanvas('hood', 'kenkari', 'female', 128, 128);
  assert.equal(hood._layers.length, 2, 'Kenkari female fine hood retains separate base and trim');
  assert.deepEqual(hood._layers.map(layer => layer.role), ['base', 'trim']);

  region = 'body';
  const tunic = await api.buildVariantGarmentCanvas('tunic', 'kenkari', 'female', 128, 128);
  assert.equal(tunic._layers.length, 1, 'Simple garments continue exporting as one fitted PNG');
  assert(tunic._layers[0].url.endsWith('tankantunic_kenk_f.png'));
  assert(!api.sourceHasGarmentArt(cosmetics[0], 'kenkari', 'female'),
    'The source picker never claims the Mao-only replica helm has Kenkari artwork');

  assert.equal(api.targetKey('kenkari', 'male'), 'kenkari_male',
    'Old Mao-ao same-gender body transforms stay intact');
  E.sourceSpecies.value = 'kenkari';
  assert.equal(api.targetKey('kenkari', 'male'), 'from::kenkari_male::kenkari_male',
    'A different source species cannot overwrite Mao calibration');
  E.sourceGender.value = 'female';
  assert.equal(api.targetKey('kenkari', 'male'), 'from::kenkari_female::kenkari_male',
    'Starting gender has its own calibration even when target gender is unchanged');
  region = 'headwear';
  assert.equal(api.targetKey('kenkari', 'male'), 'from::kenkari_female::headwear::kenkari_male');

  // Switching fit regions should restore each region's last selected garment.
  const garmentPicker = {options: [], _value: 'tunic', selectedIndex: 0,
    get value() {return this._value},
    set value(value) {this._value = this.options.some(option => option.value === value) ? value : ''},
    set innerHTML(value) {this.options = [];this._value = ''},
    appendChild(option) {this.options.push(option);if(this.options.length === 1)this._value = option.value}
  };
  const selectionE = {
    garment: garmentPicker, sourceSpecies: {value: 'mao-ao'}, sourceGender: {value: 'male'},
    exportHeadwearFront: {}, exportHeadwearBack: {}, bodyPng: {}, clothPng: {}, sourceLayerStatus: {},
    showBody: {parentElement: {lastChild: {textContent: ''}}}
  };
  const selectionState = {settings: {region: 'body', garment: 'tunic', headGarment: 'hood'}};
  let selectionRegion = 'headwear';
  const selectFn = new Function('A','R','E','document','fitRegion','BODY_SLOTS','HEAD_SLOTS','sourceHasGarmentArt',
    sourceBetween('function rebuildGarmentSelector()', 'function bodyLayers(') +
    '\nreturn rebuildGarmentSelector;')(
    selectionState, R, selectionE, {createElement: () => ({value: '', textContent: ''})},
    () => selectionRegion, new Set(['torso']), new Set(['hat', 'hood']), () => true
  );
  selectFn();
  assert.equal(garmentPicker.value, 'hood', 'Headwear selection restores the prior headwear choice');
  selectionRegion = 'body';
  selectionState.settings.region = 'headwear';
  selectFn();
  assert.equal(garmentPicker.value, 'tunic', 'Body selection restores the prior clothing choice');

  // A patch on one material must not suppress the garment's other materials in the preview.
  const baseLayer = {path: ['parts', 'torso', 'layers', 'base'], canvas: makeCanvas()};
  const trimLayer = {path: ['parts', 'torso', 'layers', 'trim'], canvas: makeCanvas()};
  const rawPatch = makeCanvas();rawPatch.width = 45;rawPatch.height = 37;
  R.cloth = {width: 128, height: 128, _layers: [baseLayer, trimLayer]};
  R.patchWorkflow = {active: true, descriptor: {kind: 'clothing', layerPath: trimLayer.path}, canvas: rawPatch};
  const patchHelpers = new Function('R', 'document', 'log',
    sourceBetween('function layerMatchesRoutedClothingPatch(', 'function routedPatchIsBody()') +
    '\nreturn {mainClothSource, fittedSourceCanvasForLayer};')(
    R, {createElement: makeCanvas}, () => {}
  );
  const composite = patchHelpers.mainClothSource();
  assert.deepEqual(composite.draws.map(args => args[0]), [
    baseLayer.canvas, R.patchWorkflow._patchedLayerCanvas
  ], 'The unaffected base material remains visible below the patched trim');
  assert.strictEqual(patchHelpers.mainClothSource(), composite,
    'Redraws reuse their merged source canvas instead of re-compositing on every frame');
  assert.equal(R.patchWorkflow._patchedLayerCanvas.width, 128);
  assert.equal(R.patchWorkflow._patchedLayerCanvas.height, 128);
  assert.strictEqual(R.patchWorkflow._patchedLayerCanvas.draws[0][0], rawPatch,
    'Native patch pixels are placed in the full garment frame without stretching');
  assert.deepEqual(R.patchWorkflow._patchedLayerCanvas.draws[0].slice(1), [0, 0]);
  R.patchWorkflow = {active: true, descriptor: {kind: 'body'}, canvas: rawPatch};
  assert.strictEqual(patchHelpers.mainClothSource(), rawPatch,
    'Body-only patch routing must not accidentally add garment layers');

  // A species without normal body portraits can still be a clothing source.
  const sourceReference = new Function('R', 'document', 'HEAD_SLOTS', 'bodyLayers',
    'buildBodyCanvas', 'headwearLayerRecords', 'collectPatchImageNodes', 'loadImage', 'assetUrl', 'log',
    sourceBetween('async function buildSourceReferenceCanvas(', 'async function refreshAssets(') +
    '\nreturn buildSourceReferenceCanvas;')(
    R, {createElement: makeCanvas}, new Set(['hat', 'hood']), () => [],
    () => {throw new Error('Unexpected body raster request')}, () => [],
    node => Object.values(node?.parts?.torso?.layers||{}).filter(layer => layer.image?.url)
      .map(layer => ({url: layer.image.url})),
    url => Promise.resolve(url.includes('larger') ?
      {naturalWidth: 240, naturalHeight: 260} : {naturalWidth: 190, naturalHeight: 210}),
    value => value, () => {}
  );
  const sourceRaster = await sourceReference('kenkari', 'female', 'tunic', {width: 100, height: 90});
  assert.equal(sourceRaster.width, 190);
  assert.equal(sourceRaster.height, 210);
  R.garments.push({id: 'layered-tunic', slot: 'torso', cfg: {
    speciesVariants: {nuhongan_male: {parts: {torso: {layers: {
      base: {image: {url: 'small.png'}}, trim: {image: {url: 'larger.png'}}
    }}}}}
  }});
  const emptySource = await sourceReference('nuhongan', 'male', 'missing-garment', {width: 100, height: 90});
  assert.equal(emptySource.width, 100);
  assert.equal(emptySource.height, 90);
  const layeredSource = await sourceReference('nuhongan', 'male', 'layered-tunic', {width: 100, height: 90});
  assert.equal(layeredSource.width, 240, 'Source frame spans the widest authored material');
  assert.equal(layeredSource.height, 260, 'Source frame spans the tallest authored material');

  // ZIP paths must be usable directly under docs/, not generated preview names.
  const getNode = (root, keys) => (keys||[]).reduce((node, key) => node?.[key], root);
  let archiveGarment = cosmetics[1];
  const archiveApi = new Function('R','HEAD_SLOTS','garmentRecord','patchNodeAtPath','safeName',
    sourceBetween('function archiveAssetPath(', 'async function exportFittedGarment(') +
    '\nreturn {buildFittedLayerArchivePlan, archiveAssetPath};')(
    R, new Set(['hat','hood']), () => archiveGarment, getNode,
    value => String(value||'sprite').replace(/[^a-z0-9_-]+/gi,'_')
  );
  const sourceHood = await api.buildVariantGarmentCanvas('hood', 'mao-ao', 'male', 128, 128);
  let selection = {sourceSpecies:'mao-ao',sourceGender:'male',targetSpecies:'engh-sho',targetGender:'female'};
  let plan = archiveApi.buildFittedLayerArchivePlan(sourceHood._layers, selection);
  assert.deepEqual(plan.files.map(file => file.outputName), [
    'assets/cosmetics/clothes/hood/engh_finehood_base_f.png',
    'assets/cosmetics/clothes/hood/engh_finehood_trim_f.png'
  ], 'Existing target sprites are exported with their exact configured PNG filenames and directories');
  assert.equal(plan.configPath, null, 'An existing unique target layer needs no config rewrite');

  selection = {...selection,targetSpecies:'kenkari'};
  plan = archiveApi.buildFittedLayerArchivePlan(sourceHood._layers, selection);
  assert(plan.configPath, 'A reused Kenkari/Rakakoan PNG must not be overwritten for both species');
  assert(plan.files.every(file => file.sharedTargetAssetAvoided));
  assert(plan.files[0].outputName.endsWith('finehood-base_kenkari_f.png'));
  assert.equal(plan.config.speciesVariants.kenkari_female.parts.head.layers.front.image.url,
    './'+plan.files[0].outputName, 'The packaged config maps a shared texture to its independent fitted file');

  archiveGarment = cosmetics[0];
  selection = {sourceSpecies:'mao-ao',sourceGender:'male',targetSpecies:'kenkari',targetGender:'female'};
  plan = archiveApi.buildFittedLayerArchivePlan(helm._layers, selection);
  assert.equal(plan.files.length, 3, 'Front cloth, faceguard and alternate rear metal all get individual paths');
  assert(plan.files[0].outputName.endsWith("replica_bzabag's_helm-cap_kenkari_f.png"),
    'A new target name retains the original -cap material name');
  assert(plan.files[1].outputName.endsWith("replica_bzabag's_helm-faceguard_kenkari_f.png"),
    'A new target name retains the original -faceguard material name');
  assert(plan.files[2].outputName.endsWith('headband_kenkari_f.png'),
    'The distinct rear headband image retains its source image name');
  assert.equal(plan.config.speciesVariants.kenkari_female.parts.head.layers.front_cap.behindImage.url,
    './'+plan.files[0].outputName, 'An equal front/behind cap asset continues pointing to the same new PNG');
  assert.equal(plan.config.speciesVariants.kenkari_female.parts.head.layers.front.behindImage.url,
    './'+plan.files[2].outputName, 'The separate back-view metal PNG gets its own target config URL');

  archiveGarment = cosmetics[2];
  selection = {sourceSpecies:'mao-ao',sourceGender:'male',targetSpecies:'engh-sho',targetGender:'female'};
  plan = archiveApi.buildFittedLayerArchivePlan(tunic._layers.map(layer=>({
    ...layer,url:'./assets/cosmetics/clothes/torso/portrait/tankantunic_mao-ao_m.png'
  })),selection);
  assert(plan.files[0].outputName.endsWith('tankantunic_engh_f.png'),
    'The same naming logic works for torso clothing too');
  assert.equal(plan.configPath,null);
  assert.equal(archiveApi.archiveAssetPath('./assets/../../outside.png'),null,
    'Unsafe path traversal is never included in an installable asset ZIP');

  // Test the actual async ZIP export names, manifest, and included target config.
  archiveGarment = cosmetics[0];
  selection = {sourceSpecies:'mao-ao',sourceGender:'male',targetSpecies:'kenkari',targetGender:'female'};
  const exported=[];
  const testE = {
    garment:{value:'helm'},fitRegion:{value:'headwear'},
    sourceSpecies:{value:selection.sourceSpecies},sourceGender:{value:selection.sourceGender},
    species:{value:selection.targetSpecies},gender:{value:selection.targetGender},
    clothPng:{disabled:false},sourceLayerStatus:{textContent:''}
  };
  const mockZip = {canvasToPngBytes:async()=>new Uint8Array([137,80,78,71]),
    buildStoredZip:entries=>entries,downloadBlob:(entries,name)=>exported.push({entries,name})};
  const exportCode = sourceBetween('async function exportFittedGarment()', 'function overlayOut()');
  const exportFn = new Function('R','E','window','TextEncoder','captureFitState','routedPatchIsBody',
    'clothOut','fittedClothingFilename','downloadCanvas','log','safeName','fittedLayerOutputs',
    'buildFittedLayerArchivePlan','fitRegion',exportCode+'\nreturn exportFittedGarment;')(
    {cloth:helm},testE,{ClothingFitZip:mockZip},class {encode(text){
      return Uint8Array.from([...text].map(char=>char.charCodeAt(0)&255));
    }},()=>({key:'test-fit',transform:{},offsets:[]}),()=>false,
    ()=>null,()=>'',()=>{},()=>{},value=>String(value).replace(/[^a-z0-9_-]/gi,'_'),
    ()=>helm._layers,archiveApi.buildFittedLayerArchivePlan,()=>testE.fitRegion.value
  );
  await exportFn();
  assert.equal(exported.length,1,'One downloadable ZIP is produced');
  const entryNames=exported[0].entries.map(entry=>entry.name);
  assert.deepEqual(entryNames.slice(0,3),plan.files.map(file=>file.outputName).slice(0,3).length===3
    ?archiveApi.buildFittedLayerArchivePlan(helm._layers,selection).files.map(file=>file.outputName)
    :[], 'The downloaded PNG entry names match the install plan');
  assert(entryNames.includes('config/cosmetics/clothes/hat/replica_bzabag_helm.json'),
    'When a target variant is missing its complete cosmetic JSON ships with the PNGs');
  assert(entryNames.includes('fitted-layers-manifest.json'));
  assert(entryNames.includes('README-FITTED-LAYERS.txt'));
  assert.equal(new Set(entryNames.map(name=>name.toLowerCase())).size,entryNames.length,
    'ZIP contains no conflicting entry names');
  assert.equal(testE.clothPng.disabled,false,'Export control is restored after ZIP encoding');

  console.log('PASS clothing-fit source layers, installable ZIP filenames/config, patch composition, fallback rasters, fit keys and script syntax');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
