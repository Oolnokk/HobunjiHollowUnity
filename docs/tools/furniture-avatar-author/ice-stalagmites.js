// Furniture V58: dedicated Ice Stalagmites tab. It edits only the ice recipes
// inside state.surfaceGrowth, preserving roots/vines and the existing undo/export pipeline.
(function () {
  'use strict';

  const panel = document.getElementById('tab-ice'); // Existing left editor tab owns the controls and their accessible status.
  if (!panel || !window.FoliageGenerator || !window.IceStalagmiteCoverage) {
    document.getElementById('debugLog')?.append('\n[Ice Stalagmites] Required growth modules or editor tab missing.');
    return;
  }
  const fields = [ // Numeric controls are saved in the shared ice-growth recipe and reused in gameplay.
    ['count', 'Cluster budget', 26, 1, 80, 1],
    ['density', 'Coverage density', .9, .05, 1, .05],
    ['iceHeightMin', 'Minimum spike height', .2, .03, 10, .05],
    ['iceHeightMax', 'Maximum spike height', 1.4, .03, 10, .05],
    ['radius', 'Spike base radius', .11, .002, .6, .01],
    ['iceCluster', 'Spikes per cluster (max)', 4, 1, 8, 1],
    ['iceEngulf', 'Furniture engulf (0–1)', .5, 0, 1, .05],
    ['iceFootprintPadding', 'Perimeter padding', .08, 0, 2, .02],
    ['iceLean', 'Tip lean variance', .15, 0, .8, .05],
    ['iceFacets', 'Crystal facets', 5, 3, 9, 1],
    ['iceTipSharpness', 'Tip sharpness', .8, .1, 1, .05],
    ['iceRoughness', 'Material roughness', .22, .02, 1, .05],
    ['iceOpacity', 'Ice opacity', .93, .4, 1, .05]
  ];
  const defaults = window.FoliageGenerator.normalizeSurfaceGrowth({ // New recipes start tuned for blue-white ground ice.
    kind: 'iceStalagmites', seed: 'furniture-ice-1', target: 'all', count: 26, density: .9,
    iceHeightMin: .2, iceHeightMax: 1.4, radius: .11, iceCluster: 4,
    iceEngulf: .5, iceFootprintPadding: .08, iceLean: .15, iceFacets: 5,
    iceTipSharpness: .8, iceRoughness: .22, iceOpacity: .93
  });
  let shown = true; // Preview-only visibility; it never changes the exported layer.
  const get = id => document.getElementById('ice-' + id); // Centralized lookup isolates IDs from other furniture tabs.
  function element(tag, props = {}, text = null) {
    const node = document.createElement(tag); // Build controls without introducing a second giant inline HTML block.
    Object.assign(node, props);
    if (text !== null) node.textContent = text;
    return node;
  }
  function status(message, level = 'info') {
    get('status').textContent = message; // Mobile users can inspect all diagnostics without devtools.
    if (typeof log === 'function') log('[Ice Stalagmites] ' + message, level);
  }
  function recipes() { return Array.isArray(state.surfaceGrowth) ? state.surfaceGrowth : []; } // Uses the editor's canonical saved growth list.
  function selectedLayer() { const id = Number(get('layer').value); return Number.isInteger(id) && id >= 0 && recipes()[id]?.kind === 'iceStalagmites' ? id : -1; }
  function iceSceneLayers() { return root.children.filter(child => child.userData?.iceStalagmites); } // Owned generated groups are siblings of existing root/vine layers.
  function updateVisibility() {
    for (const layer of iceSceneLayers()) layer.visible = shown;
    get('visibility').textContent = shown ? 'Hide ice preview' : 'Show ice preview';
  }
  function populateChoices(preferred = -1) {
    const select = get('layer'); // Actual array indices remain correct even when root/vine layers are interleaved.
    select.replaceChildren(new Option('New ice layer', '-1'));
    recipes().forEach((recipe, index) => {
      if (recipe?.kind === 'iceStalagmites') select.add(new Option('Ice layer ' + (index + 1) + ' · ' + (recipe.seed || 'unseeded'), String(index)));
    });
    select.value = recipes()[preferred]?.kind === 'iceStalagmites' ? String(preferred) : '-1';
  }
  function loadFields(index) {
    const saved = index >= 0 ? recipes()[index] : null; // Missing or legacy settings receive normalized safe defaults.
    const recipe = window.FoliageGenerator.normalizeSurfaceGrowth(saved || defaults);
    get('seed').value = recipe.seed;
    get('target').value = recipe.target === 'selected' ? 'selected' : 'all';
    get('color').value = recipe.color;
    for (const [name] of fields) get(name).value = recipe[name];
    const captured = recipe.target === 'selected' ? recipe.targetIds?.length || 0 : 0;
    get('selection').textContent = captured ? 'Saved selected-piece IDs: ' + captured + '. Keeping these unless you capture a new selection.' :
      'For Selected pieces, select furniture parts in the viewport before generating.';
  }
  function refresh(preferred) {
    const preserve = preferred === undefined ? selectedLayer() : preferred; // Editor re-entry restores the selected recipe.
    populateChoices(preserve);
    loadFields(selectedLayer());
    updateVisibility();
    const count = recipes().filter(recipe => recipe?.kind === 'iceStalagmites').length;
    get('savedCount').textContent = count + ' saved ice layer' + (count === 1 ? '' : 's');
  }
  function readForm() {
    const original = recipes()[selectedLayer()] || defaults; // Preserve captured part IDs on edits with no active viewport selection.
    const target = get('target').value;
    const ids = target === 'selected' ? activePartIds() : []; // Uses the exact same selected-part workflow as Roots & Vines.
    const targetIds = target === 'selected' ? (ids.length ? ids : original.targetIds || []) : [];
    if (target === 'selected' && !targetIds.length) throw new Error('Select furniture pieces in the viewport first, then choose Selected pieces.');
    if (!state.parts.length) throw new Error('Add or import furniture pieces before adding ice.');
    const config = { ...original, kind: 'iceStalagmites', style: 'natural', target, targetIds,
      seed: get('seed').value.trim() || 'furniture-ice-1', color: get('color').value, texture: '' };
    for (const [name] of fields) {
      if (get(name).value.trim() === '' || !Number.isFinite(Number(get(name).value))) throw new Error('Invalid ' + name + ' value.');
      config[name] = Number(get(name).value);
    }
    return window.FoliageGenerator.normalizeSurfaceGrowth(config); // Bounds UI and imported values consistently with gameplay.
  }
  function apply() {
    try {
      const recipe = readForm(); // No saved layer mutates until validation succeeds.
      const list = recipes().slice(); // Other root/vine recipes remain intact.
      let index = selectedLayer();
      if (index < 0) {
        if (list.length >= 32) throw new Error('The furniture already has 32 surface-growth layers. Remove one first.');
        index = list.length; list.push(recipe);
      } else list[index] = recipe;
      state.surfaceGrowth = list;
      shown = true; // Display newly generated ice immediately.
      const report = rebuildSurfaceFoliage(); // Same geometry lifecycle as every existing root/vine layer.
      queueUndoHistory('ice stalagmite coverage');
      refresh(index);
      status('Saved and generated ice. ' + report);
    } catch (error) { status(error.message, 'warn'); }
  }
  function remove() {
    const index = selectedLayer(); // The clear button acts only on the chosen ice recipe.
    if (index < 0) { status('Choose a saved ice layer to remove.', 'warn'); return; }
    const list = recipes().slice();
    list.splice(index, 1);
    state.surfaceGrowth = list;
    const report = rebuildSurfaceFoliage();
    queueUndoHistory('remove ice stalagmite coverage');
    refresh(-1);
    status('Removed selected ice layer. ' + report);
  }

  const card = element('div', { className: 'section' }); // Main control surface uses the editor's existing responsive layout.
  card.appendChild(element('h2', {}, 'Ice Stalagmites'));
  card.appendChild(element('p', { className: 'muted' }, 'Grow faceted ice spikes UP from the ground around the lower furniture geometry. No ceiling stalactites or floating ice; layer JSON and in-game visuals use the shared Roots & Vines growth system.'));
  const header = element('div', { className: 'g2' }); // Layer and scope selectors live together for quick mobile editing.
  const layerLabel = element('label', {}, 'Saved layer');
  layerLabel.appendChild(element('select', { id: 'ice-layer' }));
  const targetLabel = element('label', {}, 'Coverage target');
  const target = element('select', { id: 'ice-target' }); // Captured part IDs survive JSON export, import, and undo.
  target.add(new Option('All furniture parts', 'all'));
  target.add(new Option('Selected pieces', 'selected'));
  targetLabel.appendChild(target);
  header.append(layerLabel, targetLabel);
  card.appendChild(header);
  const seedLabel = element('label', {}, 'Generation seed');
  seedLabel.appendChild(element('input', { id: 'ice-seed', type: 'text', maxLength: 128 }));
  card.appendChild(seedLabel);
  const selection = element('p', { id: 'ice-selection', className: 'muted' }); // Explicit selection scope feedback avoids silently applying to all.
  card.appendChild(selection);
  const grid = element('div', { className: 'g2' }); // Shared numerical controls retain the furniture tool's familiar appearance.
  for (const [name, title, initial, min, max, step] of fields) {
    const label = element('label', {}, title);
    label.appendChild(element('input', { id: 'ice-' + name, type: 'number', value: String(initial), min: String(min), max: String(max), step: String(step) }));
    grid.appendChild(label);
  }
  card.appendChild(grid);
  const colorLabel = element('label', {}, 'Ice color');
  colorLabel.appendChild(element('input', { id: 'ice-color', type: 'color', value: '#bcecff' }));
  card.appendChild(colorLabel);
  const actions = element('div', { className: 'g2' }); // Save, clear, and visibility actions never reach root/vine recipes.
  actions.appendChild(element('button', { id: 'ice-generate', className: 'ok', type: 'button' }, 'Generate / Save Ice'));
  actions.appendChild(element('button', { id: 'ice-remove', className: 'bad', type: 'button' }, 'Remove Selected Layer'));
  actions.appendChild(element('button', { id: 'ice-visibility', type: 'button' }, 'Hide ice preview'));
  actions.appendChild(element('button', { id: 'ice-test', type: 'button' }, 'Run geometry self-check'));
  card.appendChild(actions);
  card.appendChild(element('p', { id: 'ice-savedCount', className: 'muted' }, '0 saved ice layers'));
  card.appendChild(element('div', { id: 'ice-status', className: 'pill', role: 'status', ariaLive: 'polite' }, 'Ice authoring ready.'));
  panel.appendChild(card);

  get('layer').addEventListener('change', function () { loadFields(selectedLayer()); }); // Switching layers exposes their saved settings.
  get('target').addEventListener('change', function () {
    get('selection').textContent = this.value === 'selected' ? 'Select pieces in the viewport; the next save captures those part IDs.' : 'All furniture parts will be eligible.';
  });
  get('generate').onclick = apply;
  get('remove').onclick = remove;
  get('visibility').onclick = function () { shown = !shown; updateVisibility(); status(shown ? 'Ice preview visible.' : 'Ice preview hidden (saved JSON unchanged).'); };
  get('test').onclick = function () {
    try {
      const report = window.IceStalagmiteCoverage.selfTest(THREE); // Runs in isolation, leaving the authored furniture untouched.
      status(report.message, report.ok ? 'info' : 'error');
    } catch (error) { status('Self-check failed: ' + error.message, 'error'); }
  };
  refresh(-1);
  window.IceStalagmiteAuthoring = { refresh, apply, selfTest: () => window.IceStalagmiteCoverage.selfTest(THREE) }; // Editor mode switching can refresh after JSON imports and undo.
})();
