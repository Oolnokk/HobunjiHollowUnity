'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'); // Reads the exact shipping author handler rather than a copied implementation.
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8');
const first = source.indexOf('    async function openLayerPatternAuthor(role, roleKey, slotIndex = 0) {');
const end = source.indexOf('    async function refreshPatternLayerControls()', first);
assert(first >= 0 && end > first, 'Advanced Loom authoring handler remains present');
const handlerSource = source.slice(first, end); // Runs the shipping closure with explicit mock services and slot state.
const originalPrimary = { motifDataUrl: 'data:primary', meshScale: .9 };
const originalOverpass = { motifDataUrl: 'data:overpass', meshScale: 1.4 };
const clone = item => item == null ? item : JSON.parse(JSON.stringify(item));
function harness(advanced) {
  const state = {
    layerPatterns: { base: { pattern: clone(originalPrimary), patternId: 'primary-lib', patternLabel: 'Primary', swapPatternColors: true } },
    overpassPatterns: { base: { pattern: clone(originalOverpass), patternId: 'overpass-lib', patternLabel: 'Overpass', inkColorHex: '#335577', inkDyeId: 'blue' } },
  }; // Two distinct garment-owned pattern snapshots are the source of truth.
  let modal = null; // Captures the editor's real initial pattern and save/preview callbacks.
  let preview = null; // Verifies the preview stack routes the authoring draft to slot 1 or slot 2.
  let refreshed = 0; // Confirms saving routes through the same loom control/preview refresh path.
  const window = {
    PatternAuthoring: { openEditor: options => { modal = options; } },
    PatternLibrary: { listAvailable: () => [
      { id: 'primary-lib', label: 'Primary' }, { id: 'overpass-lib', label: 'Overpass' },
    ], getById: () => null, saveToLibrary: () => null, removeSaved: () => null },
  };
  const sandbox = {
    window, state, advanced, clone,
    selectedBlueprint: () => ({ baseCosmeticId: 'test-garment', label: 'Test Garment' }),
    resolvedForEditing: async pattern => pattern,
    hasBehindView: async () => false,
    patternRoles: () => [{ role: 'base', key: 'base' }],
    layerLabel: () => 'Base',
    normalizePatternStack: value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean).slice(0,2),
    weavingFromState: () => ({ layers: { base: {
      pattern: clone(state.layerPatterns.base.pattern),
      patterns: [clone(state.layerPatterns.base.pattern), ...(state.overpassPatterns.base ? [clone(state.overpassPatterns.base.pattern)] : [])],
      swapPatternColors: state.layerPatterns.base.swapPatternColors,
    } } }),
    renderClothingLayers: async (_id, settings) => { preview = settings.weaving; return { canvas: {} }; },
    refreshPatternLayerControls: async () => { refreshed++; },
    selectedPrimaryHex: () => '#ffffff', selectedSecondaryHex: () => '#dddddd', selectedPatternHex: () => '#aaaaaa',
    reweaveItem: null, hybridCap: false,
  };
  vm.runInNewContext(handlerSource + '\nthis.invokeAuthor = openLayerPatternAuthor;', sandbox);
  return {
    state, invoke: sandbox.invokeAuthor, getModal: () => modal, getPreview: () => preview,
    refreshed: () => refreshed,
  };
}

(async () => {
  const loom = harness(true);
  await loom.invoke('base', 'base', 1);
  let modal = loom.getModal();
  assert.equal(modal.initialPattern.motifDataUrl, 'data:overpass', 'slot 2 must open its own motif for editing');
  assert.equal(modal.initialPatternLibraryId, 'overpass-lib');
  assert.equal(modal.offloadCustomMotif, false, 'crafted garments keep portable motif snapshots');

  await modal.renderPreview({ motifDataUrl:'data:preview-overpass', meshScale: 2 });
  let preview = loom.getPreview().layers.base;
  assert.equal(preview.patterns[0].motifDataUrl, 'data:primary', 'overpass preview leaves slot 1 intact');
  assert.equal(preview.patterns[1].motifDataUrl, 'data:preview-overpass', 'draft appears only in slot 2');
  assert.equal(preview.patterns[1].inkColorHex, '#335577', 'draft preview preserves the independent overpass dye');
  assert.equal(preview.swapPatternColors, true, 'garment-specific dye swap survives overpass preview');

  assert.equal(await modal.onSave({ motifDataUrl:'data:saved-overpass', meshScale: 2 }, 'overpass-lib'), true);
  assert.equal(loom.state.layerPatterns.base.pattern.motifDataUrl, 'data:primary', 'saving slot 2 never changes slot 1');
  assert.equal(loom.state.overpassPatterns.base.pattern.motifDataUrl, 'data:saved-overpass');
  assert.equal(loom.state.overpassPatterns.base.inkColorHex, '#335577', 'overpass dye survives save');
  assert.equal(loom.state.overpassPatterns.base.inkDyeId, 'blue', 'overpass named dye survives save');
  assert.equal(loom.refreshed(), 1, 'overpass save refreshes loom controls');

  await loom.invoke('base', 'base', 0);
  modal = loom.getModal();
  assert.equal(modal.initialPattern.motifDataUrl, 'data:primary', 'primary still opens separately');
  await modal.renderPreview({ motifDataUrl:'data:preview-primary', meshScale: .7 });
  preview = loom.getPreview().layers.base;
  assert.equal(preview.patterns[0].motifDataUrl, 'data:preview-primary');
  assert.equal(preview.patterns[1].motifDataUrl, 'data:saved-overpass', 'primary preview retains slot 2');
  await modal.onSave({ motifDataUrl:'data:saved-primary', meshScale: .7 }, 'primary-lib');
  assert.equal(loom.state.layerPatterns.base.pattern.motifDataUrl, 'data:saved-primary');
  assert.equal(loom.state.layerPatterns.base.swapPatternColors, true, 'primary save retains garment dye-swap');
  assert.equal(loom.state.overpassPatterns.base.pattern.motifDataUrl, 'data:saved-overpass');
  assert.equal(loom.refreshed(), 2);

  const simple = harness(false);
  await simple.invoke('base', 'base', 1);
  assert.equal(simple.getModal(), null, 'Simple Loom cannot author an Advanced Loom overpass');

  const withoutPrimary = harness(true);
  delete withoutPrimary.state.layerPatterns.base;
  await withoutPrimary.invoke('base', 'base', 1);
  assert.equal(withoutPrimary.getModal(), null, 'an overpass cannot be authored without a primary pattern');
  console.log('Advanced Loom independent overpass author, previews, dyes and saves passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
