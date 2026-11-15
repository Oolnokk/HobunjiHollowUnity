// Dedicated animal hat-authoring workbench. The neck/shoulder editor remains intact.
// Pixel brushes reuse the modular weapon editor's pixel displacement functions,
// but classify every opaque hat pixel as movable (not just metal-coloured pixels).
(() => {
  'use strict';
  const el = id => document.getElementById(id); // Hat controls and existing rigger controls.
  const bounds = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(+v) ? +v : min)); // Safe user input clamp.
  const rigWorkspace = document.querySelector('.app'); // Existing neck/shoulder workspace, switched by top-level tabs.
  const brushApi = window.ModularWeaponBridgeFill; // Shared, tested modular weapon smudge/plow/revert implementation.
  const hatApi = window.AnimalNpcHeadwear; // Runtime attachment normalization, for authoring/runtime parity.
  const HAT_PREVIEW_STORAGE_KEY = 'hobunji_animal_hat_fits_v1'; // Separate preview key, never shadows the animal's neck rig.
  if (!rigWorkspace || !brushApi?.smudgeStep || !hatApi?.normalizeAttachment) return;

  const style = document.createElement('style'); // Responsive hat editor styles without touching the existing controls.
  style.textContent = [
    '.app[hidden]{display:none!important}.hat-rigger-tabs{display:flex;gap:8px;padding:12px 12px 0;position:sticky;top:0;z-index:5;background:#0f1114}',
    '.hat-rigger-tabs button{flex:1;max-width:240px}.hat-rigger-tabs button[aria-selected=true]{background:#4c432a;border-color:#f0c878}',
    '.hat-workbench .controls{min-width:0}.hat-workbench .hat-stage{height:calc(100dvh - 24px);position:sticky;top:12px;display:grid;grid-template-rows:auto minmax(130px,1fr) auto minmax(130px,1fr) auto;gap:8px;min-width:0}',
    '.hat-workbench .canvas-wrap{min-height:0}.hat-workbench canvas{width:100%;height:100%;touch-action:none;cursor:crosshair;image-rendering:pixelated}',
    '.hat-workbench .hat-stage .hint{min-height:40px}.hat-workbench .row>select{min-width:0;flex:1}',
    '.hat-workbench .hat-status{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#c8d2df}',
    '@media(max-width:810px){.hat-workbench .hat-stage{position:static;height:auto;grid-template-rows:auto 280px auto 280px auto}.hat-rigger-tabs{position:static}}'
  ].join('');
  document.head.appendChild(style);
  const tabs = document.createElement('nav'); // Top-level switch, preserving all existing neck editor state and event handlers.
  tabs.className = 'hat-rigger-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button id="riggerNeckTab" role="tab" aria-selected="true">Neck &amp; shoulder</button>' +
    '<button id="riggerHatsTab" role="tab" aria-selected="false">Hats</button>';
  rigWorkspace.before(tabs);
  const workspace = document.createElement('div'); // Independent hat controls and two canvases, not another neck-paint mode.
  workspace.id = 'hatWorkspace';
  workspace.className = 'app hat-workbench';
  workspace.hidden = true;
  workspace.innerHTML = [
    '<section class="panel controls">',
    '<div><h1>Animal hats</h1><div class="hint">Author species attachment and reshape hat artwork. Neck/shoulder paint is unchanged.</div></div>',
    '<div><h2>Animal</h2><div class="row"><button id="hatLoadBestiary">Load bestiary</button><button id="hatLoadJson">Import animal JSON</button></div>',
    '<label>Species<select id="hatSpecies"><option value="">New / custom animal</option></select></label><div id="hatSpeciesLabel" class="hint">Choose an animal using either tab.</div></div>',
    '<div><h2>Hat artwork</h2><div class="row"><button id="hatLoadCatalog">Load hat catalog</button><button id="hatChoosePng">Choose PNG</button><input id="hatPngFile" type="file" accept="image/png,image/*" hidden></div>',
    '<label>Existing cosmetic<select id="hatCosmetic"><option value="">Choose a hat or import a PNG</option></select></label>',
    '<label>Asset PNG path<input id="hatPath" placeholder="assets/cosmetics/clothes/hat/...png"></label><button id="hatLoadPath">Load asset PNG</button>',
    '<label>Editable artwork layer<select id="hatLayer"><option value="">No layer loaded</option></select></label>',
    '<div class="hint">Multi-layer cosmetics remain separate. Export every modified layer as its own PNG; the source cosmetic files are not overwritten.</div></div>',
    '<div><h2>Hat attachment and geometric deformation</h2>',
    '<label class="row"><input id="hatEnabled" type="checkbox" checked> Hat attachment enabled</label>',
    '<div class="grid2">',
    '<label>Anchor X (0–1)<input id="hatAnchorX" type="number" min="0" max="1" step=".005" value=".5"></label>',
    '<label>Anchor Y (0–1)<input id="hatAnchorY" type="number" min="0" max="1" step=".005" value=".2"></label>',
    '<label>Width / sprite width<input id="hatWidth" type="number" min=".02" max="2" step=".01" value=".34"></label>',
    '<label>Vertical scale<input id="hatHeightScale" type="number" min=".2" max="3" step=".05" value="1"></label>',
    '<label>Rotation °<input id="hatRotation" type="number" min="-180" max="180" step="1" value="0"></label>',
    '<label>Horizontal skew °<input id="hatSkew" type="number" min="-45" max="45" step="1" value="0"></label>',
    '<label>Hat art pivot X<input id="hatArtX" type="number" min="0" max="1" step=".01" value=".5"></label>',
    '<label>Hat art pivot Y<input id="hatArtY" type="number" min="0" max="1" step=".01" value=".86"></label>',
    '</div><label class="row"><input id="hatFlip" type="checkbox"> Mirror hat horizontally</label>',
    '<div class="row"><button id="hatPlace" class="active">Drag hat position on preview</button><button id="hatResetFit">Reset fit from neck rig</button></div>',
    '<div class="hint">Geometry is non-destructive and saved as <code>hatAttachment</code>. Drag the hat on the animal preview, or enter exact values.</div></div>',
    '<div><h2>Pixel deformation brushes</h2>',
    '<div class="row"><button id="hatSmudge" class="active">Smudge</button><button id="hatPlow">Plow</button><button id="hatRestore">Restore</button></div>',
    '<label>Radius <span id="hatRadiusText">12 px</span><input id="hatRadius" type="range" min="1" max="128" value="12"></label>',
    '<label>Strength <span id="hatStrengthText">100%</span><input id="hatStrength" type="range" min="1" max="100" value="100"></label>',
    '<div class="row"><button id="hatUndo" disabled>↶ Undo</button><button id="hatRedo" disabled>↷ Redo</button><button id="hatResetPixels">Reset art</button></div>',
    '<div class="hint">Smudge and Plow use the modular weapon editor’s pixel-moving algorithms, adapted for opaque fabric, feathers and dark outlines. Restore paints back original pixels. Each drag is one undo step.</div></div>',
    '<div><h2>Save and export</h2><div class="row"><button id="hatPreviewSave" class="primary">Save in-game fit preview</button><button id="hatPreviewClear">Clear hat preview</button><button id="hatExportPng" class="primary">Export edited PNG</button></div>',
    '<div class="row"><button id="hatExportAll">Export all changed layers</button><button id="hatCopyAttachment">Copy attachment JSON</button></div>',
    '<div class="row"><button id="hatExportRecord">Download animal record</button></div>',
    '<div class="hint">Hat fits use their own browser preview storage so they cannot override neck weights. Authored fits export to animal JSON. Pixel edits become game art only after replacing the source PNGs.</div></div>',
    '</section>',
    '<section class="panel hat-stage">',
    '<div class="row"><strong>Animal with hat</strong><span id="hatPlacementBadge" class="badge">No animal</span></div>',
    '<div class="canvas-wrap"><canvas id="hatPlacementCanvas"></canvas></div>',
    '<div class="row"><strong>Hat raster · drag to deform</strong><span id="hatArtBadge" class="badge">No hat</span></div>',
    '<div class="canvas-wrap"><canvas id="hatArtCanvas"></canvas></div>',
    '<div><div id="hatStatus" class="hat-status" role="status">Load a species and hat to begin.</div><details><summary class="hint">Hat editor diagnostics</summary><pre id="hatDiagnostics" class="hint" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details></div>',
    '</section>'
  ].join('');
  rigWorkspace.after(workspace);

  const view = { layers: [], layerIndex: -1, selectedCosmetic: '', options: [], authored: false,
    attachment: null, brush: 'smudge', drag: null, placing: false, cursor: null,
    redraw: false, token: 0 }; // Hat-only editable art, fit, and pointer state.
  const artCanvas = el('hatArtCanvas'), artCtx = artCanvas.getContext('2d'); // Raw pixel deformation canvas.
  const placementCanvas = el('hatPlacementCanvas'), placementCtx = placementCanvas.getContext('2d'); // Species preview canvas.

  function status(message, good = true) {
    el('hatStatus').textContent = message;
    el('hatStatus').style.color = good ? '#c8d2df' : '#ff9d99';
  }
  function switchTab(tab) {
    const hats = tab === 'hats'; // Only one workspace is visible at a time.
    rigWorkspace.hidden = hats;
    workspace.hidden = !hats;
    el('riggerNeckTab').setAttribute('aria-selected', String(!hats));
    el('riggerHatsTab').setAttribute('aria-selected', String(hats));
    if (hats) { if (!view.authored) fillAttachment(null); syncSpecies(); resize(); } // Derive from latest painted neck state.
    else resizeCanvases();
  }
  el('riggerNeckTab').onclick = () => switchTab('neck');
  el('riggerHatsTab').onclick = () => switchTab('hats');

  function attachmentFromControls() {
    return hatApi.normalizeAttachment({
      enabled: el('hatEnabled').checked,
      anchor: { x: bounds(el('hatAnchorX').value, 0, 1), y: bounds(el('hatAnchorY').value, 0, 1) },
      width: bounds(el('hatWidth').value, .02, 2),
      heightScale: bounds(el('hatHeightScale').value, .2, 3),
      skewXDeg: bounds(el('hatSkew').value, -45, 45),
      rotationDeg: bounds(el('hatRotation').value, -180, 180),
      flipX: el('hatFlip').checked,
      artAnchor: { x: bounds(el('hatArtX').value, 0, 1), y: bounds(el('hatArtY').value, 0, 1) }
    });
  }
  function fillAttachment(raw) {
    const a = hatApi.normalizeAttachment(raw, normalizedRig() || state.pendingRig || state.baseRecord?.headRig); // Use current head-paint edits when no hat fit was authored.
    view.attachment = a;
    el('hatEnabled').checked = a.enabled;
    el('hatAnchorX').value = a.anchor.x;
    el('hatAnchorY').value = a.anchor.y;
    el('hatWidth').value = a.width;
    el('hatHeightScale').value = a.heightScale;
    el('hatSkew').value = a.skewXDeg;
    el('hatRotation').value = a.rotationDeg;
    el('hatFlip').checked = a.flipX;
    el('hatArtX').value = a.artAnchor.x;
    el('hatArtY').value = a.artAnchor.y;
    drawSoon();
  }
  function readAnimal(record) {
    const raw = record?.hatAttachment || record?.headRig?.hatAttachment || null;
    view.authored = !!raw;
    fillAttachment(raw);
    el('hatSpeciesLabel').textContent = (record?.label || record?.id || 'New animal') +
      (view.authored ? ' · authored hat fit' : ' · derived from head rig until edited');
    syncSpecies();
    updateOutput(); // Original applyRecord serialized before this tab restored the selected animal's fit.
  }
  function changedFit() {
    view.authored = true;
    view.attachment = attachmentFromControls();
    drawSoon();
    updateOutput();
  }
  const originalApplyRecord = applyRecord; // Integrates imports, bestiary selection and blank records without replacing neck behavior.
  applyRecord = function applyRecordWithHats(record, index) {
    const result = originalApplyRecord(record, index);
    readAnimal(record);
    return result;
  };
  const originalNormalizedRig = normalizedRig; // Adds authored placement to existing browser preview rig.
  normalizedRig = function normalizedRigWithHats() {
    const rig = originalNormalizedRig();
    if (rig && view.authored) rig.hatAttachment = attachmentFromControls();
    return rig;
  };
  const originalBuildRecord = buildRecord; // Keeps hatAttachment in normal animal exports, not in additional variables.
  buildRecord = function buildRecordWithHats() {
    const record = originalBuildRecord();
    if (view.authored) record.hatAttachment = attachmentFromControls();
    else delete record.hatAttachment; // Reset fit removes previously authored species placement from loaded JSON.
    return record;
  };
  const originalPopulateAnimalSelect = populateAnimalSelect; // Mirror the one authoritative animal selector.
  populateAnimalSelect = function populateAnimalSelectWithHats(records, indexes) {
    const result = originalPopulateAnimalSelect(records, indexes);
    syncSpecies();
    return result;
  };
  function syncSpecies() {
    const source = el('animalSelect'), target = el('hatSpecies'), old = target.value;
    target.innerHTML = source.innerHTML;
    target.value = source.value || '';
    if (target.selectedIndex < 0) target.value = old || '';
    el('hatSpeciesLabel').textContent = (el('animalLabel').value || el('animalId').value || 'New animal') +
      (view.authored ? ' · authored hat fit' : ' · default fit');
  }
  el('hatSpecies').onchange = () => {
    el('animalSelect').value = el('hatSpecies').value;
    el('animalSelect').dispatchEvent(new Event('change', { bubbles: true }));
  };
  el('hatLoadBestiary').onclick = () => loadRepoBestiary();
  el('hatLoadJson').onclick = () => el('loadJsonButton').click();

  ['hatEnabled', 'hatAnchorX', 'hatAnchorY', 'hatWidth', 'hatHeightScale', 'hatSkew',
    'hatRotation', 'hatArtX', 'hatArtY', 'hatFlip'].forEach(id => {
    el(id).addEventListener('input', changedFit);
    el(id).addEventListener('change', changedFit);
  });
  el('hatResetFit').onclick = () => {
    view.authored = false;
    fillAttachment(null);
    updateOutput();
    status('Reset to head-rig-derived placement. Edit a fit field to save a new species attachment.');
  };
  el('hatPlace').onclick = () => {
    view.placing = !view.placing;
    el('hatPlace').classList.toggle('active', view.placing);
    status(view.placing ? 'Drag on the animal preview to place the hat anchor.' : 'Hat drag placement disabled.');
  };
  view.placing = true;

  async function loadHatImage(path, role = 'front', label = path) {
    const token = view.token; // An older selection cannot replace a newer request.
    const url = /^(?:blob:|data:|https?:)/i.test(path) ? path : repoSpriteUrl(path); // Local uploads must not be prefixed with the docs directory.
    return new Promise((resolve, reject) => {
      const image = new Image(); // Original source may be any PNG accessible under docs/assets.
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (token !== view.token) return resolve(null);
        const w = image.naturalWidth, h = image.naturalHeight;
        if (!w || !h || w > 2048 || h > 2048 || w * h > 2097152) return reject(new Error('Hat image exceeds the 2 megapixel / 2048px editor limit.'));
        const canvas = document.createElement('canvas'); // Source-resolution RGBA working image for each independently exported layer.
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        try {
          ctx.drawImage(image, 0, 0);
          const data = ctx.getImageData(0, 0, w, h).data;
          const pixels = new Uint8ClampedArray(data);
          resolve({ path, label, role, canvas, ctx, pixels, original: new Uint8ClampedArray(pixels),
            undo: [], redo: [], dirty: false, revision: 0 }); // Crop bounds are cached against the pixel revision.
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error('Could not load hat PNG: ' + path));
      image.src = url;
    });
  }
  async function setLayers(specs, cosmetic = '') {
    view.token++;
    const token = view.token;
    view.layers = []; view.layerIndex = -1; view.selectedCosmetic = cosmetic;
    el('hatLayer').innerHTML = '<option value="">Loading...</option>';
    drawSoon();
    try {
      const layers = [];
      for (const spec of specs) {
        const layer = await loadHatImage(spec.path, spec.role, spec.label || spec.path);
        if (token !== view.token) return;
        if (layer) layers.push(layer);
      }
      if (!layers.length) throw new Error('No usable image layers were found for that hat.');
      view.layers = layers;
      el('hatLayer').innerHTML = '';
      layers.forEach((layer, i) => {
        const option = document.createElement('option');
        option.value = String(i); option.textContent = layer.role + ' · ' + layer.label;
        el('hatLayer').appendChild(option);
      });
      selectLayer(0);
      status('Loaded ' + layers.length + ' editable hat layer(s). Drag on the lower canvas to deform.');
    } catch (error) {
      if (token !== view.token) return;
      el('hatLayer').innerHTML = '<option value="">No layer loaded</option>';
      status(error.message, false);
    }
  }
  function selectedLayer() { return view.layers[view.layerIndex] || null; }
  function selectLayer(index) {
    view.layerIndex = index >= 0 && index < view.layers.length ? index : -1;
    el('hatLayer').value = String(view.layerIndex);
    const layer = selectedLayer();
    if (layer) {
      el('hatPath').value = layer.path;
      el('hatRadius').max = String(Math.max(1, Math.min(128, Math.max(layer.canvas.width, layer.canvas.height))));
      el('hatArtBadge').textContent = layer.canvas.width + '×' + layer.canvas.height;
    }
    refreshUndo();
    drawSoon();
  }
  el('hatLayer').onchange = () => selectLayer(Number(el('hatLayer').value));

  function layerSpecsFromCosmetic(json) {
    const layers = json?.parts?.head?.layers || json?.parts?.hat?.layers || {};
    const variants = json?.speciesVariants || {};
    const fallbackLayers = Object.keys(layers).length ? layers :
      Object.values(variants).map(v => v?.parts?.head?.layers).find(v => v && Object.keys(v).length) || {};
    return Object.entries(fallbackLayers).filter(([, v]) => v?.image?.url)
      .map(([role, v]) => ({ path: v.image.url, role, label: role }));
  }
  function niceLabel(entry) {
    return String(entry.id || '').split('::').pop().replace(/[_-]/g, ' ');
  }
  el('hatLoadCatalog').onclick = async () => {
    try {
      status('Loading cosmetic catalog...');
      const response = await fetch('../../config/cosmetics/index.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Cosmetics catalog HTTP ' + response.status);
      const catalog = await response.json();
      view.options = (catalog.entries || []).filter(e => {
        const value = (e.id + ' ' + e.path).toLowerCase();
        return /appearance::hat::|\/hat\/|hat|helmet|helm|circlet|headband|kasa/.test(value);
      }); // Prefilter candidate hat configs without loading every cosmetic and species asset.
      const select = el('hatCosmetic');
      select.innerHTML = '<option value="">Choose an existing hat</option>';
      view.options.forEach((entry, i) => {
        const opt = document.createElement('option');
        opt.value = String(i); opt.textContent = niceLabel(entry);
        select.appendChild(opt);
      });
      status('Found ' + view.options.length + ' candidate hat cosmetics. Select one to load its real source layers.');
    } catch (error) { status('Catalog unavailable: ' + error.message + '. You can load any PNG path directly.', false); }
  };
  el('hatCosmetic').onchange = async () => {
    const entry = view.options[Number(el('hatCosmetic').value)];
    if (!entry) return;
    const selected = el('hatCosmetic').value;
    try {
      const url = new URL(entry.path, new URL('../../config/cosmetics/index.json', location.href));
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Cosmetic config HTTP ' + response.status);
      const json = await response.json();
      if (selected !== el('hatCosmetic').value) return;
      if (json.slot !== 'hat' && !entry.id.startsWith('appearance::hat::')) throw new Error('This cosmetic is not a hat.');
      const layers = layerSpecsFromCosmetic(json);
      if (!layers.length) throw new Error('This cosmetic has no directly editable hat sprite.');
      await setLayers(layers, entry.id);
    } catch (error) { status('Hat load failed: ' + error.message, false); }
  };
  el('hatLoadPath').onclick = () => {
    const path = el('hatPath').value.trim();
    if (!path) return status('Enter a PNG path, or choose a file.', false);
    setLayers([{ path, role: 'front' }]);
  };
  el('hatChoosePng').onclick = () => el('hatPngFile').click();
  el('hatPngFile').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return status('Choose an image file.', false);
    const url = URL.createObjectURL(file); // Local PNG is not an asset path and only lasts until this browser session ends.
    await setLayers([{ path: url, role: 'front', label: file.name }]);
    const layer = selectedLayer();
    if (layer) { layer.exportName = file.name; el('hatPath').value = file.name; }
    URL.revokeObjectURL(url);
  };

  const classifier = (pixels, offset) => pixels[offset + 3] >= 8 ? 2 : 0; // Every sufficiently opaque hat pixel is movable.
  function radius() { return bounds(el('hatRadius').value, 1, 128); }
  function strength() { return bounds(el('hatStrength').value, 1, 100) / 100; }
  function brushMode(name) {
    view.brush = name;
    for (const [id, mode] of [['hatSmudge', 'smudge'], ['hatPlow', 'plow'], ['hatRestore', 'restore']])
      el(id).classList.toggle('active', name === mode);
  }
  el('hatSmudge').onclick = () => brushMode('smudge');
  el('hatPlow').onclick = () => brushMode('plow');
  el('hatRestore').onclick = () => brushMode('restore');
  for (const [id, label, suffix] of [['hatRadius', 'hatRadiusText', ' px'], ['hatStrength', 'hatStrengthText', '%']])
    el(id).oninput = () => { el(label).textContent = el(id).value + suffix; drawSoon(); };
  function refreshUndo() {
    const layer = selectedLayer();
    el('hatUndo').disabled = !layer?.undo.length;
    el('hatRedo').disabled = !layer?.redo.length;
  }
  function snapshot(layer) {
    const redoBeforeStroke = layer.redo.splice(0); // Restore this future history if the stroke is cancelled or has no effect.
    layer.undo.push(new Uint8ClampedArray(layer.pixels));
    layer.pendingRedo = redoBeforeStroke; // One pointer gesture temporarily owns redo history.
    const maxHistory = Math.min(8, Math.max(1, Math.floor((24 * 1024 * 1024) / layer.pixels.byteLength))); // Per-layer mobile history budget.
    while (layer.undo.length > maxHistory) layer.undo.shift();
    refreshUndo();
  }
  function writePixels(layer, compareOriginal = false) {
    layer.revision++; // Invalidates cropped artwork bounds after a committed paint operation.
    layer.ctx.putImageData(new ImageData(layer.pixels, layer.canvas.width, layer.canvas.height), 0, 0);
    if (compareOriginal) layer.dirty = layer.pixels.some((v, i) => v !== layer.original[i]);
    else layer.dirty = true; // Avoid a full-image comparison on every drag frame, especially on mobile.
    drawSoon();
  }
  function undoRedo(direction) {
    const layer = selectedLayer();
    if (!layer) return;
    const from = direction === 'undo' ? layer.undo : layer.redo;
    const to = direction === 'undo' ? layer.redo : layer.undo;
    if (!from.length) return;
    to.push(new Uint8ClampedArray(layer.pixels));
    layer.pixels = from.pop();
    writePixels(layer, true); refreshUndo();
  }
  el('hatUndo').onclick = () => undoRedo('undo');
  el('hatRedo').onclick = () => undoRedo('redo');
  el('hatResetPixels').onclick = () => {
    const layer = selectedLayer();
    if (!layer) return;
    snapshot(layer);
    layer.pixels = new Uint8ClampedArray(layer.original);
    writePixels(layer, true); refreshUndo();
    status('Restored the selected PNG layer. Undo returns to the previous version.');
  };
  function brushStroke(from, to) {
    const layer = view.drag?.layer || selectedLayer(); // Keep one entire touch stroke on its original layer.
    if (!layer || !from || !to) return;
    const width = layer.canvas.width, height = layer.canvas.height, power = strength();
    if (view.brush === 'restore') {
      brushApi.revertStep(layer.pixels, layer.original, width, height, from, to, radius(),
        { strength: power, random: Math.random });
    } else {
      const adjusted = { x: from.x + (to.x - from.x) * power, y: from.y + (to.y - from.y) * power };
      if (view.brush === 'smudge') brushApi.smudgeStep(layer.pixels, width, height, from, adjusted, radius(), { classify: classifier });
      else brushApi.plowStep(layer.pixels, width, height, from, adjusted, radius(), { classify: classifier });
    }
    writePixels(layer);
  }

  function backingSize(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function resize() { if (workspace.hidden) return; backingSize(artCanvas); backingSize(placementCanvas); drawSoon(); }
  function fitted(canvas, w, h) {
    const scale = Math.min(canvas.width / w, canvas.height / h) * .92;
    return { x: (canvas.width - w * scale) / 2, y: (canvas.height - h * scale) / 2, scale,
      width: w * scale, height: h * scale };
  }
  function pointOnCanvas(event, canvas, fit, w, h) {
    const rect = canvas.getBoundingClientRect();
    const cx = (event.clientX - rect.left) / rect.width * canvas.width;
    const cy = (event.clientY - rect.top) / rect.height * canvas.height;
    return { x: bounds((cx - fit.x) / fit.scale, 0, w - 1), y: bounds((cy - fit.y) / fit.scale, 0, h - 1) };
  }
  artCanvas.addEventListener('pointerdown', event => {
    const layer = selectedLayer();
    if (!layer || view.drag) return;
    event.preventDefault();
    const fit = fitted(artCanvas, layer.canvas.width, layer.canvas.height);
    const p = pointOnCanvas(event, artCanvas, fit, layer.canvas.width, layer.canvas.height);
    snapshot(layer);
    view.drag = { id: event.pointerId, last: p, layer }; // Pin the undo snapshot to its source layer for this pointer.
    artCanvas.setPointerCapture(event.pointerId);
    if (view.brush === 'restore') brushStroke(p, p); // Taps restore locally even with zero movement.
  });
  artCanvas.addEventListener('pointermove', event => {
    const layer = selectedLayer();
    if (!layer) return;
    const fit = fitted(artCanvas, layer.canvas.width, layer.canvas.height);
    view.cursor = pointOnCanvas(event, artCanvas, fit, layer.canvas.width, layer.canvas.height);
    if (view.drag && view.drag.id === event.pointerId) {
      event.preventDefault();
      brushStroke(view.drag.last, view.cursor);
      view.drag.last = view.cursor;
    }
    drawSoon();
  });
  function finishArt(event, cancelled = false) {
    if (!view.drag || view.drag.id !== event.pointerId) return;
    const layer = view.drag.layer; // The layer captured at pointerdown, even if UI selection changes.
    if (layer && !cancelled) {
      const fit = fitted(artCanvas, layer.canvas.width, layer.canvas.height);
      const last = pointOnCanvas(event, artCanvas, fit, layer.canvas.width, layer.canvas.height);
      if (last.x !== view.drag.last.x || last.y !== view.drag.last.y) brushStroke(view.drag.last, last); // Capture final touch segment.
    }
    view.drag = null;
    if (artCanvas.hasPointerCapture?.(event.pointerId)) artCanvas.releasePointerCapture(event.pointerId);
    if (layer) {
      const before = layer.undo[layer.undo.length - 1]; // Snapshot pushed on pointerdown for this gesture.
      if (cancelled && before) {
        layer.pixels = layer.undo.pop();
        writePixels(layer, true);
        layer.redo = layer.pendingRedo || [];
      } else if (before && layer.pixels.every((v, i) => v === before[i])) {
        layer.undo.pop(); // No-op taps do not consume Undo history.
        layer.redo = layer.pendingRedo || [];
      }
      layer.pendingRedo = null;
    }
    refreshUndo();
    status(cancelled ? 'Cancelled the hat brush stroke; previous pixels restored.' :
      'Hat pixels updated. Export the edited PNG to make the change permanent in game assets.');
    drawSoon();
  }
  artCanvas.addEventListener('pointerup', e => finishArt(e));
  artCanvas.addEventListener('pointercancel', e => finishArt(e, true));
  artCanvas.addEventListener('pointerleave', () => { if (!view.drag) { view.cursor = null; drawSoon(); } });

  function animalSize() {
    const img = state.image;
    return img ? { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height } : null;
  }
  placementCanvas.addEventListener('pointerdown', event => {
    const s = animalSize();
    if (!view.placing || !s) return;
    event.preventDefault();
    placementCanvas.setPointerCapture(event.pointerId);
    view.dragPlacement = event.pointerId; // Active touch/mouse pointer for anchored placement.
    positionFromEvent(event);
  });
  function positionFromEvent(event) {
    const s = animalSize();
    if (!s) return;
    const fit = fitted(placementCanvas, s.width, s.height);
    const p = pointOnCanvas(event, placementCanvas, fit, s.width, s.height);
    el('hatAnchorX').value = (p.x / Math.max(1, s.width)).toFixed(4);
    el('hatAnchorY').value = (p.y / Math.max(1, s.height)).toFixed(4);
    changedFit();
  }
  placementCanvas.addEventListener('pointermove', event => {
    if (view.dragPlacement === event.pointerId) { event.preventDefault(); positionFromEvent(event); }
  });
  for (const name of ['pointerup', 'pointercancel'])
    placementCanvas.addEventListener(name, event => {
      if (view.dragPlacement !== event.pointerId) return;
      view.dragPlacement = null;
      if (placementCanvas.hasPointerCapture?.(event.pointerId)) placementCanvas.releasePointerCapture(event.pointerId);
    });

  function cropRect(layer) {
    if (layer.cropRevision === layer.revision ||
        (view.drag?.layer === layer && layer.cropRevision !== undefined))
      return layer.cropCache; // Reuse opaque bounds while a long mobile brush drag runs.
    const w = layer.canvas.width, h = layer.canvas.height, p = layer.pixels;
    let x0 = w, y0 = h, x1 = -1, y1 = -1; // Opaque bounds match the runtime's cropped hat placement.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (p[(y * w + x) * 4 + 3] >= 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    layer.cropCache = x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    layer.cropRevision = layer.revision;
    return layer.cropCache;
  }
  function drawAttached(ctx, layer, s, a) {
    if (!layer || !a.enabled) return;
    const b = cropRect(layer);
    if (!b) return;
    const w = a.width * s.width, h = w * b.h / Math.max(1, b.w) * a.heightScale;
    ctx.save();
    ctx.translate(a.anchor.x * s.width, a.anchor.y * s.height);
    ctx.rotate(a.rotationDeg * Math.PI / 180);
    ctx.transform(1, 0, Math.tan(a.skewXDeg * Math.PI / 180), 1, 0, 0);
    if (a.flipX) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer.canvas, b.x, b.y, b.w, b.h, -a.artAnchor.x * w, -a.artAnchor.y * h, w, h);
    ctx.restore();
  }
  function drawNow() {
    view.redraw = false;
    const diagnostics = el('hatDiagnostics'); // Expandable in-page support information for mobile authoring.
    if (diagnostics) diagnostics.textContent = JSON.stringify({
      animal: el('animalId').value || null,
      hat: view.selectedCosmetic || 'custom',
      attachment: attachmentFromControls(),
      activeLayer: view.layerIndex,
      layers: view.layers.map(item => ({ role: item.role, path: item.path, width: item.canvas.width,
        height: item.canvas.height, changed: item.dirty, undo: item.undo.length, redo: item.redo.length }))
    }, null, 2);
    artCtx.clearRect(0, 0, artCanvas.width, artCanvas.height);
    placementCtx.clearRect(0, 0, placementCanvas.width, placementCanvas.height);
    const layer = selectedLayer();
    if (layer) {
      const b = fitted(artCanvas, layer.canvas.width, layer.canvas.height);
      artCtx.imageSmoothingEnabled = false;
      artCtx.drawImage(layer.canvas, b.x, b.y, b.width, b.height);
      if (view.cursor) {
        artCtx.save(); artCtx.strokeStyle = '#f0c878'; artCtx.lineWidth = 2;
        artCtx.beginPath(); artCtx.arc(b.x + view.cursor.x * b.scale, b.y + view.cursor.y * b.scale, radius() * b.scale, 0, Math.PI * 2);
        artCtx.stroke(); artCtx.restore();
      }
    }
    const s = animalSize();
    if (!s) { el('hatPlacementBadge').textContent = 'No animal'; return; }
    const fit = fitted(placementCanvas, s.width, s.height);
    placementCtx.save();
    placementCtx.translate(fit.x, fit.y); placementCtx.scale(fit.scale, fit.scale);
    placementCtx.imageSmoothingEnabled = false;
    const a = attachmentFromControls();
    for (const each of view.layers) if (each.role === 'back') drawAttached(placementCtx, each, s, a);
    placementCtx.drawImage(state.image, 0, 0, s.width, s.height);
    for (const each of view.layers) if (each.role !== 'back') drawAttached(placementCtx, each, s, a);
    const x = a.anchor.x * s.width, y = a.anchor.y * s.height;
    placementCtx.strokeStyle = '#f0c878'; placementCtx.lineWidth = 2 / fit.scale;
    placementCtx.beginPath(); placementCtx.moveTo(x - 8, y); placementCtx.lineTo(x + 8, y);
    placementCtx.moveTo(x, y - 8); placementCtx.lineTo(x, y + 8); placementCtx.stroke();
    placementCtx.restore();
    el('hatPlacementBadge').textContent = (el('animalId').value || 'Animal') +
      (view.authored ? ' · authored fit' : ' · derived fit');
  }
  function drawSoon() {
    if (view.redraw || workspace.hidden) return;
    view.redraw = true;
    requestAnimationFrame(drawNow);
  }
  const observer = new ResizeObserver(resize); // Mobile rotations and panel-size changes update backing canvases.
  observer.observe(artCanvas.parentElement);
  observer.observe(placementCanvas.parentElement);
  window.addEventListener('resize', resize);

  function safePngName(layer) {
    const stem = String(layer.exportName || layer.path.split('/').pop() || 'hat.png').replace(/[^\w.-]+/g, '_');
    return stem.toLowerCase().endsWith('.png') ? stem : stem + '.png';
  }
  function exportLayer(layer) {
    if (!layer) return status('Load a hat image first.', false);
    layer.canvas.toBlob(blob => {
      if (!blob) return status('PNG export failed.', false);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = safePngName(layer);
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }
  el('hatExportPng').onclick = () => exportLayer(selectedLayer());
  el('hatExportAll').onclick = () => {
    const changed = view.layers.filter(layer => layer.dirty);
    if (!changed.length) return status('No edited layers to export.');
    changed.forEach(exportLayer);
    status('Exported ' + changed.length + ' edited layer(s). Mobile browsers may request multiple-download permission.');
  };
  el('hatCopyAttachment').onclick = () => copyText(pretty(attachmentFromControls()));
  el('hatExportRecord').onclick = () => {
    try { const record = buildRecord(); downloadJson(record, (record.id || 'animal') + '-hat-rig.json'); }
    catch (error) { status(error.message, false); }
  };
  function readHatPreviews() {
    try {
      const data = JSON.parse(localStorage.getItem(HAT_PREVIEW_STORAGE_KEY) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function writeHatPreviews(previews) { localStorage.setItem(HAT_PREVIEW_STORAGE_KEY, JSON.stringify(previews)); }
  el('hatPreviewSave').onclick = () => {
    try {
      const id = el('animalId').value.trim().toLowerCase().replace(/_/g, '-'); // Canonical species key shared with headwear runtime.
      if (!id) throw new Error('Animal ID is required to save an in-game hat preview.');
      if (!view.authored) fillAttachment(null); // Derive from the latest neck paint when no explicit fit exists.
      const previews = readHatPreviews(); // Writes to hats ONLY. No head-rig preview record is changed.
      previews[id] = attachmentFromControls();
      writeHatPreviews(previews);
      if (JSON.stringify(readHatPreviews()[id]) !== JSON.stringify(previews[id]))
        throw new Error('Hat preview did not round-trip through browser storage.');
      status('Saved ' + (view.authored ? 'authored' : 'head-derived') + ' hat fit preview for ' + id +
        '. Neck-rig preview was not modified. Reload/respawn the animal. Edited PNG pixels still require exported assets.');
    } catch (error) { status(error.message || String(error), false); }
  };
  el('hatPreviewClear').onclick = () => {
    try {
      const id = el('animalId').value.trim().toLowerCase().replace(/_/g, '-');
      if (!id) throw new Error('Animal ID is required to clear the hat preview.');
      const previews = readHatPreviews(); // Clears only this hat without touching any neck-rig data.
      delete previews[id];
      writeHatPreviews(previews);
      if (Object.prototype.hasOwnProperty.call(readHatPreviews(), id))
        throw new Error('Hat preview did not clear from browser storage.');
      status('Cleared hat preview for ' + id + '. Runtime uses its committed animal hat fit.');
    } catch (error) { status(error.message || String(error), false); }
  };
  const clearAllRigsOriginal = el('clearAllPreviewRigs').onclick; // Existing clear-all must include both independent preview stores.
  el('clearAllPreviewRigs').onclick = () => {
    clearAllRigsOriginal?.();
    try { writeHatPreviews({}); } catch (error) { status('Unable to clear hat previews: ' + error.message, false); }
  };
  el('animalId').addEventListener('input', syncSpecies);
  el('animalLabel').addEventListener('input', syncSpecies);
  readAnimal(state.baseRecord);
  brushMode('smudge');
  window.HobunjiAnimalHatWorkbench = Object.freeze({
    getAttachment: () => attachmentFromControls(),
    getDebug: () => ({ active: !workspace.hidden, animal: el('animalId').value,
      cosmetic: view.selectedCosmetic, layers: view.layers.map(layer => ({ path: layer.path, role: layer.role, dirty: layer.dirty,
        undo: layer.undo.length, redo: layer.redo.length })), brush: view.brush, authored: view.authored })
  }); // On-page diagnostic hook without requiring a console.
})();