// Wall Builder UI extension for deterministic log-cabin walls.
// Loaded only on docs/tools/wall-builder. It deliberately feeds generated GLB
// and recipe Files through the tool's existing import controls so preview uses
// the same library/build code as manually imported assets instead of a second
// private preview implementation.
(() => {
  'use strict';

  const TOOL_IMPORTS = Object.freeze({ // CDN modules matching the Wall Builder's existing Three.js r128 import map.
    three: 'https://unpkg.com/three@0.128.0/build/three.module.js',
    exporter: 'https://unpkg.com/three@0.128.0/examples/jsm/exporters/GLTFExporter.js',
  });
  let modulePromise = null; // Shared dynamic-import promise used by preview and export buttons.
  let lastPrototype = null; // Cached {key,buffer,meta} so repeated recipe downloads do not regenerate unchanged log geometry.

  function byId(id) {
    return document.getElementById(id);
  }

  function numberValue(id, fallback) {
    const raw = String(byId(id)?.value ?? '').trim().replace(',', '.'); // Mobile-friendly decimal input normalized for authored log settings.
    const value = Number(raw); // Finite authoring value consumed by LogWallExtension normalization.
    return Number.isFinite(value) ? value : fallback;
  }

  function status(message, level) {
    const output = byId('logWallToolStatus'); // In-card no-devtools diagnostics for the latest log generation/export action.
    if (output) output.textContent = message;
    const pill = byId('statusPill'); // Existing Wall Builder status surface mirrored so mobile users see failures/success immediately.
    if (pill) pill.textContent = message;
    const prefix = '[LogWallTool]'; // Console/debug prefix matching the in-card subsystem name.
    if (level === 'error') console.error(prefix, message);
    else if (level === 'warn') console.warn(prefix, message);
    else console.log(prefix, message);
  }

  async function modules() {
    if (!modulePromise) {
      modulePromise = Promise.all([import(TOOL_IMPORTS.three), import(TOOL_IMPORTS.exporter)])
        .then(([THREE, exporterModule]) => ({ THREE, GLTFExporter: exporterModule.GLTFExporter }));
    }
    return modulePromise;
  }

  function sanitizeGlbName(value) {
    const stem = String(value || 'CabinLog.glb').trim().replace(/[^a-z0-9_.-]+/gi, '_').replace(/^\.+/, '') || 'CabinLog.glb'; // Safe downloadable/runtime asset filename.
    return /\.glb$/i.test(stem) ? stem : `${stem}.glb`;
  }

  function authoredMeta(sourceMode) {
    const api = window.LogWallExtension; // Shared deterministic geometry/recipe authority loaded by PanelUI for this tool.
    if (!api) throw new Error('LogWallExtension is not loaded.');
    return api.normalizeLogMeta({
      sourceMode,
      seed: byId('logWallSeed')?.value || api.DEFAULTS.seed,
      glbName: sanitizeGlbName(byId('logWallGlbName')?.value),
      logDiameter: numberValue('logWallDiameter', api.DEFAULTS.logDiameter),
      trunkWonk: numberValue('logWallWonk', api.DEFAULTS.trunkWonk),
      trunkWonkScale: numberValue('logWallWonkScale', api.DEFAULTS.trunkWonkScale),
      trunkTaper: numberValue('logWallTaper', api.DEFAULTS.trunkTaper),
      trunkTwist: numberValue('logWallTwist', api.DEFAULTS.trunkTwist),
      trunkNoise: numberValue('logWallNoise', api.DEFAULTS.trunkNoise),
      trunkNoiseScale: numberValue('logWallNoiseScale', api.DEFAULTS.trunkNoiseScale),
      radialSegments: numberValue('logWallRadialSegments', api.DEFAULTS.radialSegments),
      ringSegments: numberValue('logWallRingSegments', api.DEFAULTS.ringSegments),
      barkColor: byId('logWallBarkColor')?.value || api.DEFAULTS.barkColor,
      overhang: numberValue('logWallOverhang', api.DEFAULTS.overhang),
      courseGap: numberValue('logWallCourseGap', api.DEFAULTS.courseGap),
      rowRollDeg: numberValue('logWallRowRoll', api.DEFAULTS.rowRollDeg),
      rowDepthJitter: numberValue('logWallDepthJitter', api.DEFAULTS.rowDepthJitter),
    });
  }

  function currentPanelSize() {
    return {
      width: Math.max(0.01, numberValue('panelWidth', 4)), // Current Wall Builder target width used only as recipe preview metadata; runtime re-fits every panel independently.
      height: Math.max(0.01, numberValue('panelHeight', 2.5)), // Current Wall Builder target height used for preview/course count.
    };
  }

  function prototypeKey(meta) {
    return `${window.LogWallExtension.signature(meta)}|${meta.glbName}`; // Cache key proving the GLB bytes match the exact current geometry settings.
  }

  async function buildPrototypeBuffer(meta) {
    const key = prototypeKey(meta); // Geometry cache key excluding sourceMode/placement-only settings.
    if (lastPrototype?.key === key) return lastPrototype.buffer;
    const { THREE, GLTFExporter } = await modules(); // Same r128 Three/GLTFExporter pair used by the main Wall Builder module.
    const mesh = window.LogWallExtension.createLogPrototype(THREE, meta); // Deterministic foliage-style prototype shared by live generation and exported GLB.
    const root = new THREE.Group(); // Export root holding the single reusable log mesh and its serialized extras.
    root.name = 'HobunjiCabinLogPrototype';
    root.userData = { logWallSignature: window.LogWallExtension.signature(meta), logWall: { ...meta } };
    root.add(mesh);
    const exporter = new GLTFExporter(); // Binary glTF exporter producing the reusable baked prototype asset.
    const buffer = await new Promise((resolve, reject) => {
      exporter.parse(root, (result) => {
        if (!(result instanceof ArrayBuffer)) return reject(new Error('Expected binary GLB output.'));
        resolve(result);
      }, reject, { binary: true, onlyVisible: true });
    });
    lastPrototype = { key, buffer, meta: { ...meta } };
    return buffer;
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob); // Temporary object URL used only for this user-initiated download.
    const anchor = document.createElement('a'); // Ephemeral download link needed for mobile/desktop browser save behavior.
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadJson(name, value) {
    downloadBlob(name, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  }

  async function injectFile(input, file) {
    if (!input) throw new Error('Wall Builder import input is unavailable.');
    if (typeof DataTransfer === 'undefined') throw new Error('This browser cannot programmatically hand generated files to the Wall Builder.');
    const transfer = new DataTransfer(); // Browser FileList builder used to route generated assets through existing import handlers.
    transfer.items.add(file);
    input.value = '';
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  async function waitForRecipeOption(label, previousValues) {
    const select = byId('panelRecipeSel'); // Existing recipe selector populated by the Wall Builder's own import handler.
    const started = performance.now(); // Timeout baseline for async File.text/import handling.
    while (performance.now() - started < 3000) {
      const options = [...(select?.options || [])]; // Current recipe options checked until the imported log recipe appears.
      const fresh = options.filter(option => !previousValues.has(option.value));
      const match = fresh.find(option => option.textContent.includes(label)) || options.find(option => option.textContent.includes(label));
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return null;
  }

  function recipeFor(meta) {
    const size = currentPanelSize(); // Current authoring panel dimensions included in downloaded recipe while runtime retains per-panel fitting.
    return window.LogWallExtension.makeRecipe(size.width, size.height, meta);
  }

  async function applyPreview(sourceMode) {
    try {
      status('Generating deterministic log prototype…');
      const meta = authoredMeta(sourceMode); // Live/baked metadata mode selected for the recipe being previewed.
      const buffer = await buildPrototypeBuffer(meta); // Exact GLB bytes loaded into the existing preview even for live mode to prove bake parity.
      const glbFile = new File([buffer], meta.glbName, { type: 'model/gltf-binary' }); // Generated reusable prototype passed through the normal GLB picker path.
      await injectFile(byId('glbFile'), glbFile);

      const recipe = recipeFor(meta); // Standard WallBuilder wall recipe carrying only extra logWall metadata.
      const safeMode = sourceMode === 'glb' ? 'baked' : 'live'; // Filename suffix distinguishing otherwise geometry-identical recipe exports/imports.
      const recipeName = `${meta.glbName.replace(/\.glb$/i, '')}_wall_${safeMode}.json`; // Imported recipe filename determines its unique Wall Builder library id.
      const previousValues = new Set([...(byId('panelRecipeSel')?.options || [])].map(option => option.value)); // Existing option ids used to prefer the newly imported duplicate-safe recipe.
      const recipeFile = new File([JSON.stringify(recipe, null, 2)], recipeName, { type: 'application/json' }); // Generated recipe passed through the normal recipe import handler.
      await injectFile(byId('recipeFile'), recipeFile);
      const option = await waitForRecipeOption(recipe.meta.instanceName, previousValues); // Newly imported recipe option assigned to the selected panel.
      if (!option) throw new Error('Generated recipe loaded but could not be selected.');
      byId('panelRecipeSel').value = option.value;
      byId('assignRecipeBtn')?.click();
      byId('buildWallsBtn')?.click();
      const signature = window.LogWallExtension.signature(meta); // Geometry signature shown in-tool for generated/baked parity checks.
      status(`Previewed ${sourceMode === 'glb' ? 'baked-GLB' : 'generated-live'} log wall · signature ${signature}. Preview always uses the exported prototype bytes, so switching source mode must not change the wall.`);
    } catch (error) {
      status(`Log wall preview failed: ${error.message}`, 'error');
    }
  }

  async function exportPrototype() {
    try {
      const meta = authoredMeta('generated'); // Geometry settings are mode-independent; generated metadata is canonical for prototype export.
      status('Exporting generated log GLB…');
      const buffer = await buildPrototypeBuffer(meta); // Same bytes injected into preview and referenced by baked recipes.
      downloadBlob(meta.glbName, new Blob([buffer], { type: 'model/gltf-binary' }));
      status(`Exported ${meta.glbName} · signature ${window.LogWallExtension.signature(meta)}. Put it at the baked recipe's GLB path to rebuild the same wall without live log generation.`);
    } catch (error) {
      status(`Log GLB export failed: ${error.message}`, 'error');
    }
  }

  function exportRecipe(sourceMode) {
    try {
      const meta = authoredMeta(sourceMode); // Requested runtime source mode embedded in this downloaded recipe.
      const recipe = recipeFor(meta); // Placement recipe identical between live and baked exports except sourceMode/label.
      const suffix = sourceMode === 'glb' ? 'baked' : 'live'; // Download suffix making the runtime behavior explicit outside the tool.
      const base = meta.glbName.replace(/\.glb$/i, ''); // Recipe filename stem paired with the reusable GLB filename.
      downloadJson(`${base}_wall_${suffix}.json`, recipe);
      status(`Exported ${suffix} recipe · signature ${window.LogWallExtension.signature(meta)}.`);
    } catch (error) {
      status(`Recipe export failed: ${error.message}`, 'error');
    }
  }

  function field(label, id, value, attrs = '') {
    return `<div class="col"><label>${label}</label><input id="${id}" value="${value}" ${attrs}></div>`;
  }

  function installUi() {
    if (byId('logWallToolCard')) return;
    const transformCard = byId('wallUnitMult')?.closest('.card'); // Existing Global wall transforms card used as insertion anchor.
    if (!transformCard) return setTimeout(installUi, 50);
    const defaults = window.LogWallExtension?.DEFAULTS; // Shared defaults ensure standalone authoring and runtime normalization start identically.
    if (!defaults) return setTimeout(installUi, 50);

    const card = document.createElement('div'); // New Wall Builder section housing log source/generation/recipe export controls.
    card.id = 'logWallToolCard';
    card.className = 'card section';
    card.style.cssText = '--sec:#a16207;--secBg:rgba(161,98,7,.12)';
    card.innerHTML = `
      <div class="sectionTitle"><b>Log cabin wall</b><span class="sectionTag">foliage logs</span></div>
      <div class="help">One foliage-style generated log spans each horizontal course. Panel width controls log length; diameter and wonkiness are authored here. Generated-live and baked-GLB recipes share the same seeded placement.</div>
      <div class="hr"></div>
      <div class="grid2">
        ${field('Log GLB filename','logWallGlbName',defaults.glbName)}
        ${field('Seed','logWallSeed',defaults.seed)}
      </div>
      <div class="grid3" style="margin-top:8px">
        ${field('Log diameter / width','logWallDiameter',defaults.logDiameter,'inputmode="decimal" min="0.02"')}
        ${field('End overhang','logWallOverhang',defaults.overhang,'inputmode="decimal" min="0"')}
        ${field('Course gap (+ gap / − overlap)','logWallCourseGap',defaults.courseGap,'inputmode="decimal"')}
      </div>
      <div class="grid3" style="margin-top:8px">
        ${field('Wonkiness','logWallWonk',defaults.trunkWonk,'inputmode="decimal" min="0"')}
        ${field('Wonk scale','logWallWonkScale',defaults.trunkWonkScale,'inputmode="decimal" min="0.01"')}
        ${field('Taper','logWallTaper',defaults.trunkTaper,'inputmode="decimal"')}
      </div>
      <div class="grid3" style="margin-top:8px">
        ${field('Surface noise','logWallNoise',defaults.trunkNoise,'inputmode="decimal" min="0"')}
        ${field('Noise scale','logWallNoiseScale',defaults.trunkNoiseScale,'inputmode="decimal" min="0.01"')}
        ${field('Twist','logWallTwist',defaults.trunkTwist,'inputmode="decimal"')}
      </div>
      <div class="grid3" style="margin-top:8px">
        ${field('Ring segments','logWallRingSegments',defaults.ringSegments,'inputmode="numeric" min="4" step="1"')}
        ${field('Radial segments','logWallRadialSegments',defaults.radialSegments,'inputmode="numeric" min="5" step="1"')}
        <div class="col"><label>Bark color</label><input id="logWallBarkColor" type="color" value="${defaults.barkColor}"></div>
      </div>
      <div class="grid2" style="margin-top:8px">
        ${field('Per-course roll ± degrees','logWallRowRoll',defaults.rowRollDeg,'inputmode="decimal" min="0"')}
        ${field('Per-course depth jitter','logWallDepthJitter',defaults.rowDepthJitter,'inputmode="decimal" min="0"')}
      </div>
      <div class="hr"></div>
      <div class="row">
        <button id="logWallPreviewLive">Preview generated-live</button>
        <button id="logWallPreviewBaked" class="secondary">Preview baked-GLB</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button id="logWallExportGlb" class="secondary">Export generated log GLB</button>
        <button id="logWallExportLiveRecipe" class="secondary">Download live recipe</button>
        <button id="logWallExportBakedRecipe" class="secondary">Download baked recipe</button>
      </div>
      <div id="logWallToolStatus" class="help" style="margin-top:8px;white-space:pre-wrap">Latest change: generated and exported logs now share one deterministic geometry signature.</div>
    `;
    transformCard.parentNode.insertBefore(card, transformCard);

    byId('logWallPreviewLive').onclick = () => applyPreview('generated');
    byId('logWallPreviewBaked').onclick = () => applyPreview('glb');
    byId('logWallExportGlb').onclick = exportPrototype;
    byId('logWallExportLiveRecipe').onclick = () => exportRecipe('generated');
    byId('logWallExportBakedRecipe').onclick = () => exportRecipe('glb');
    status('Log cabin wall controls ready. Panel width sets log length; diameter/wonkiness are independent.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi, { once: true });
  else installUi();
})();
