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
    id, slot, label: id,
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
    node => node?.parts?.torso?.layers?.back?.image?.url ?
      [{url: node.parts.torso.layers.back.image.url}] : [],
    () => Promise.resolve({naturalWidth: 190, naturalHeight: 210}), value => value, () => {}
  );
  const sourceRaster = await sourceReference('kenkari', 'female', 'tunic', {width: 100, height: 90});
  assert.equal(sourceRaster.width, 190);
  assert.equal(sourceRaster.height, 210);
  const emptySource = await sourceReference('nuhongan', 'male', 'missing-garment', {width: 100, height: 90});
  assert.equal(emptySource.width, 100);
  assert.equal(emptySource.height, 90);

  console.log('PASS clothing-fit source layers, patch composition, fallback rasters, fit keys and script syntax');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
