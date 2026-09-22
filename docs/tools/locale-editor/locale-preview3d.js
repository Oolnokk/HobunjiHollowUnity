// Locale Editor in-game terrain sandbox + relative-height authoring helpers.
(() => {
  'use strict';

  if (window.__localeEditorPreview3dInstalled) return;
  window.__localeEditorPreview3dInstalled = true;

  const RULE_STORE_KEY = 'hobunji_locale_editor_terrain_rules_v1';
  const GAME_FOG_COLOR = 0x33404a;
  const PREVIEW_MAP_ID = 'locale_editor_sandbox';
  const ZONES = Object.freeze([
    ['map_northern_cliffs', 'Northern Cliffs'],
    ['map_southern_cloud_forest', 'Southern Cloud Forest'],
    ['map_western_slope', 'Western Slope'],
    ['map_eastern_mire', 'Eastern Mire'],
  ]);
  const TERRAIN_DEFAULT_COLORS = Object.freeze({
    grass: 0x2f711e, weeds: 0x247c3c, tilled: 0x8a5b34, trench: 0x3a2510,
    raised: 0xc39a55, paddy: 0x6aa263, rock: 0x79807c, shrub: 0x356e36,
    path: 0xb8956a, river: 0x3a4a3f, stream: 0x6b5a3a, waterfall: 0x3a4a3f,
    cliff: 0x6a6460,
  });
  const OBJECT_GLB = Object.freeze({
    bench: 'furniture/bench_short.glb',
    chest: 'furniture/chest_storage.glb',
    hearth: 'furniture/hearth_fireplace.glb',
    crateStack: 'furniture/crate_stack.glb',
    standingLamp: 'furniture/standing_lamp_bronze.glb',
    bucket: 'furniture/bucket_tin.glb',
    stool: 'furniture/stool_round.glb',
    dryingRack: 'furniture/station_drying_rack.glb',
    smoker: 'furniture/station_smoking_hut.glb',
  });

  let previewVisible = false; // Full main-view sandbox visibility.
  let renderer = null; // Reused WebGL renderer for all generated scenarios.
  let scene = null;
  let camera = null;
  let controls = null;
  let worldRoot = null; // Owns terrain + locale visuals so each randomization can be removed atomically.
  let terrainMaterialConfig = { byMap: {} };
  let terrainMaterials = new Map();
  let resizeObserver = null;
  let renderLoopStarted = false;
  let generationToken = 0; // Prevents stale async GLB loads attaching after a newer randomization.
  let currentLocaleSignature = '';
  let currentScenario = 'valid'; // valid | almost | somewhat | random
  let currentSeed = '';
  let currentZoneId = '';
  let currentMerged = null;
  let currentCandidate = null;
  let currentInstance = null; // Exact locale instance currently rendered; camera orbiting follows this rather than assuming world origin.
  let currentWorkspace = null;
  let currentLocale = null;
  let showRules = true;
  const glbTemplateCache = new Map();

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function parseCellKey(key) {
    const [c, r] = String(key).split(',').map(Number);
    return Number.isFinite(c) && Number.isFinite(r) ? { c, r } : null;
  }
  function workspaceSnapshot() {
    try { return window._localeEditorBridge?.getWorkspace?.() || null; } catch (_) { return null; }
  }
  function sidecarRules(localeId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(RULE_STORE_KEY) || 'null');
      return parsed?.byLocale?.[localeId] || null;
    } catch (_) { return null; }
  }
  function activeMergedLocale() {
    const workspace = workspaceSnapshot();
    const locale = workspace?.locales?.find(item => item.id === workspace.activeId);
    if (!locale) return null;
    const output = clone(locale);
    const stored = sidecarRules(locale.id);
    const placement = output.placement || {};
    const hasPlacementAnchors = Object.prototype.hasOwnProperty.call(placement, 'terrainAnchors');
    const hasPlacementEmbedded = Object.prototype.hasOwnProperty.call(placement, 'embeddedTiles');
    output.terrainAnchors = clone((hasPlacementAnchors ? placement.terrainAnchors : (output.terrainAnchors || stored?.terrainAnchors)) || {});
    output.embeddedTiles = clone((hasPlacementEmbedded ? placement.embeddedTiles : (output.embeddedTiles || stored?.embeddedTiles)) || {});
    output.placement = { ...placement, terrainAnchors: clone(output.terrainAnchors), embeddedTiles: clone(output.embeddedTiles) };
    // The main editor sanitizer historically stripped visual metadata. Cave identity by key still works,
    // and this restores the canonical cave visual when that metadata is absent.
    for (const object of output.objects || []) {
      if (object.key === 'cave_small' && !object.visual) object.visual = output.id === 'locale_banubu_shrine'
        ? { renderer: 'cave_small', scaleX: 1.5, scaleY: 1.5, scaleZ: 1, facing: 'north' }
        : { renderer: 'cave_small', scale: 1, facing: 'north' };
    }
    return output;
  }

  // ---- Relative-height authoring helpers ---------------------------------
  function fireChange(element) { element.dispatchEvent(new Event('change', { bubbles: true })); }
  function setRelativeHeight(min, max) {
    const mode = document.getElementById('localeTerrainHeightMode');
    const minInput = document.getElementById('localeTerrainMin');
    const maxInput = document.getElementById('localeTerrainMax');
    if (!mode || !minInput || !maxInput) return;
    mode.value = 'relativeRange';
    fireChange(mode);
    minInput.value = min == null ? '' : String(min);
    maxInput.value = max == null ? '' : String(max);
    fireChange(minInput);
    fireChange(maxInput);
  }
  function injectRelativeHeightHelpers() {
    if (document.getElementById('localeRelativeHeightHelpers')) return true;
    const mode = document.getElementById('localeTerrainHeightMode');
    const minInput = document.getElementById('localeTerrainMin');
    if (!mode || !minInput) return false;
    const row = mode.closest('.g3');
    if (!row) return false;
    const helper = document.createElement('div');
    helper.id = 'localeRelativeHeightHelpers';
    helper.style.marginTop = '6px';
    helper.innerHTML = `
      <label>Relative height shortcuts <span style="color:#9fb4cf">(host terrain − locale floor)</span></label>
      <div class="row" style="gap:4px">
        <button class="sec" type="button" data-rel-height="same">Same Δ0</button>
        <button class="sec" type="button" data-rel-height="above">Host above Δ≥+1</button>
        <button class="sec" type="button" data-rel-height="below">Host below Δ≤−1</button>
      </div>
      <div class="row" style="gap:4px;margin-top:5px">
        <label style="margin:0;white-space:nowrap">Exact Δ</label>
        <input id="localeTerrainExactDelta" type="number" step="0.25" value="1" style="width:84px">
        <button class="sec" id="localeTerrainApplyExactDelta" type="button">Apply exact</button>
      </div>
      <div class="muted" style="margin-top:4px">Positive Δ means the required/embedded host terrain is above the locale floor. Δ+2 means the locale sits two tiers lower than that plateau. Banubu-style caves use “Host above”.</div>`;
    row.insertAdjacentElement('afterend', helper);
    helper.querySelector('[data-rel-height="same"]').addEventListener('click', () => setRelativeHeight(0, 0));
    helper.querySelector('[data-rel-height="above"]').addEventListener('click', () => setRelativeHeight(1, null));
    helper.querySelector('[data-rel-height="below"]').addEventListener('click', () => setRelativeHeight(null, -1));
    document.getElementById('localeTerrainApplyExactDelta').addEventListener('click', () => {
      const raw = Number(document.getElementById('localeTerrainExactDelta').value);
      const delta = Number.isFinite(raw) ? raw : 0;
      setRelativeHeight(delta, delta);
    });
    const oldMinLabel = minInput.closest('div')?.querySelector('label');
    const maxInput = document.getElementById('localeTerrainMax');
    const oldMaxLabel = maxInput?.closest('div')?.querySelector('label');
    if (oldMinLabel) oldMinLabel.textContent = 'Min tier / Δ';
    if (oldMaxLabel) oldMaxLabel.textContent = 'Max tier / Δ';
    return true;
  }

  // ---- Dependency loading -------------------------------------------------
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === new URL(src, location.href).href);
      if (existing) {
        const poll = () => test() ? resolve() : setTimeout(poll, 30);
        poll();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => test() ? resolve() : reject(new Error(`loaded ${src} but expected API is missing`));
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(script);
    });
  }
  async function ensureRuntime() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', () => !!window.THREE?.WebGLRenderer);
    await loadScript('https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js', () => !!window.THREE?.OrbitControls);
    await loadScript('../../js/GLTFLoader.js', () => !!window.THREE?.GLTFLoader);
    await loadScript('../../js/portrait-utils.js', () => !!window.getShadeFillCanvas && !!window.parseHexColor);
    await loadScript('../../js/terrain-preview.js', () => !!window.TerrainPreview?.buildMergedZoneGrid);
    await loadScript('../../js/wilderness-map-generator.js', () => !!window.WildernessMapGenerator?.generateZoneWorkspace);
    await loadScript('../../js/locale-terrain-placement.js?v=20260922localecaverotation1', () => !!window.LocaleTerrainPlacement?.evaluateCandidateForTest);
    await loadScript('../../js/locale-cave-runtime.js?v=20260922localecaverotation1', () => !!window.LocaleCaveRuntime?.registerWorkspace);
    await loadScript('../../js/zone-den-totem-features.js?v=20260922localecaverotation1', () => !!window.ZoneDenTotemFeatures?.buildAnimalDenMeshes);
    await loadMaterialConfig();
  }
  async function loadMaterialConfig() {
    if (terrainMaterialConfig.__loaded) return;
    try {
      const response = await fetch('../../config/maps/terrain-materials.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      terrainMaterialConfig = await response.json();
      terrainMaterialConfig.__loaded = true;
    } catch (error) {
      terrainMaterialConfig = { byMap: {}, __loaded: true };
      console.warn('[LocaleEditorSandbox] terrain material config fallback:', error);
    }
  }

  // ---- Full viewport UI ---------------------------------------------------
  function injectPreviewUi() {
    if (document.getElementById('locale3dPreview')) return true;
    const view = document.getElementById('view');
    const modeBar = document.getElementById('modeBar');
    if (!view || !modeBar) return false;

    const button = document.createElement('button');
    button.id = 'locale3dPreviewBtn';
    button.type = 'button';
    button.className = 'sec';
    button.textContent = '◫ In-game Preview';
    button.title = 'Generate real wilderness terrain around this locale';
    modeBar.insertBefore(button, document.getElementById('fitBtn') || null);

    const overlay = document.createElement('div');
    overlay.id = 'locale3dPreview';
    Object.assign(overlay.style, {
      display: 'none', position: 'absolute', inset: '0', zIndex: '15', background: '#33404a', touchAction: 'none', overflow: 'hidden'
    });
    overlay.innerHTML = `
      <canvas id="locale3dCanvas" style="display:block;width:100%;height:100%;touch-action:none"></canvas>
      <div id="localeSandboxToolbar" style="position:absolute;left:8px;top:8px;right:8px;display:flex;gap:5px;align-items:center;flex-wrap:wrap;background:rgba(4,8,13,.82);border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:5px;backdrop-filter:blur(4px)">
        <button class="sec" id="localeSandboxRandomize" type="button">🎲 Randomize surroundings</button>
        <button class="sec act" data-sandbox-scenario="valid" type="button">✓ Valid</button>
        <button class="sec" data-sandbox-scenario="almost" type="button">⚠ Almost right</button>
        <button class="sec" data-sandbox-scenario="somewhat" type="button">≈ Somewhat right</button>
        <button class="sec" data-sandbox-scenario="random" type="button">? Unfiltered</button>
        <select id="localeSandboxZone" style="min-height:32px"></select>
        <label style="display:flex;gap:4px;align-items:center;font-size:11px;color:#dbeafe"><input id="localeSandboxRules" type="checkbox" checked> Rule overlay</label>
        <button class="sec" id="localePreviewDebugBtn" type="button" title="Copy numeric state for this exact rendered preview">📋 Copy Preview Debug</button>
        <button class="sec" id="locale3dFitBtn" type="button">Fit</button>
      </div>
      <div id="locale3dStatus" style="position:absolute;left:8px;bottom:8px;max-width:min(720px,calc(100% - 16px));background:rgba(4,8,13,.88);border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:7px 9px;color:#dbeafe;font-size:11px;line-height:1.35;pointer-events:none">3D sandbox</div>`;
    view.appendChild(overlay);

    const zoneSelect = document.getElementById('localeSandboxZone');
    zoneSelect.innerHTML = ZONES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');

    button.addEventListener('click', async () => {
      previewVisible = !previewVisible;
      button.classList.toggle('act', previewVisible);
      overlay.style.display = previewVisible ? 'block' : 'none';
      if (!previewVisible) return;
      setStatus('Loading game terrain renderer…');
      try {
        await ensureRuntime();
        ensureRenderer();
        syncZoneChoices(activeMergedLocale());
        await regenerateScenario({ newSeed: !currentSeed, force: true });
      } catch (error) {
        console.error('[LocaleEditorSandbox]', error);
        setStatus(`Preview unavailable: ${error.message}`);
      }
    });
    document.getElementById('localeSandboxRandomize').addEventListener('click', () => regenerateScenario({ newSeed: true, force: true }));
    document.getElementById('localePreviewDebugBtn').addEventListener('click', copyPreviewDebugSnapshot);
    document.getElementById('locale3dFitBtn').addEventListener('click', fitCamera);
    document.getElementById('localeSandboxRules').addEventListener('change', event => {
      showRules = !!event.target.checked;
      const ruleRoot = scene?.getObjectByName('localeSandboxRuleOverlay');
      if (ruleRoot) ruleRoot.visible = showRules;
    });
    zoneSelect.addEventListener('change', event => {
      currentZoneId = event.target.value;
      regenerateScenario({ newSeed: true, force: true });
    });
    overlay.querySelectorAll('[data-sandbox-scenario]').forEach(scenarioButton => scenarioButton.addEventListener('click', () => {
      currentScenario = scenarioButton.dataset.sandboxScenario;
      overlay.querySelectorAll('[data-sandbox-scenario]').forEach(item => item.classList.toggle('act', item === scenarioButton));
      regenerateScenario({ newSeed: true, force: true });
    }));
    return true;
  }
  function setStatus(text) {
    const target = document.getElementById('locale3dStatus');
    if (target) target.textContent = text;
  }
  function debugRound(value, digits = 4) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  }
  function debugVec3(value) {
    if (!value) return null;
    return { x: debugRound(value.x), y: debugRound(value.y), z: debugRound(value.z) };
  }
  function debugEulerDeg(value) {
    if (!value || !window.THREE) return null;
    const k = 180 / Math.PI;
    return { x: debugRound(value.x * k, 2), y: debugRound(value.y * k, 2), z: debugRound(value.z * k, 2), order: value.order || 'XYZ' };
  }
  function debugBox(root) {
    if (!root || !window.THREE) return null;
    try {
      root.updateMatrixWorld?.(true);
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return null;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      return { min: debugVec3(box.min), max: debugVec3(box.max), size: debugVec3(size), center: debugVec3(center) };
    } catch (_) { return null; }
  }
  function debugNode(root) {
    if (!root) return null;
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    root.updateMatrixWorld?.(true);
    root.matrixWorld?.decompose?.(worldPosition, worldQuaternion, worldScale);
    const worldEuler = new THREE.Euler().setFromQuaternion(worldQuaternion, 'XYZ');
    return {
      name: root.name || '', type: root.type || '', visible: root.visible !== false,
      local: { position: debugVec3(root.position), rotationDeg: debugEulerDeg(root.rotation), scale: debugVec3(root.scale) },
      world: { position: debugVec3(worldPosition), rotationDeg: debugEulerDeg(worldEuler), scale: debugVec3(worldScale) },
      bounds: debugBox(root),
    };
  }
  function debugTile(c, r) {
    if (!currentMerged) return null;
    if (c < 0 || r < 0 || c >= currentMerged.cols || r >= currentMerged.rows) return { c, r, outOfBounds: true };
    const tile = currentMerged.tiles?.get?.(`${c},${r}`) || null;
    const cliffish = {};
    if (tile && typeof tile === 'object') {
      for (const [key, value] of Object.entries(tile)) {
        if (!/cliff|escarp|plateau|ramp/i.test(key)) continue;
        if (value == null || value === false || value === '' || typeof value === 'function') continue;
        if (typeof value === 'object') {
          try { cliffish[key] = clone(value); } catch (_) { cliffish[key] = String(value); }
        } else cliffish[key] = value;
      }
    }
    return {
      c, r,
      type: tile?.type || null,
      elevTier: debugRound(tile?.elevTier, 3) ?? 0,
      rampElevation: debugRound(tile?.rampElevation, 3),
      surfaceY: debugRound(surfaceY(currentMerged, c + 0.5, r + 0.5), 4),
      terrainMeta: cliffish,
    };
  }
  function debugPlacementResult(result) {
    if (!result) return null;
    const packProbe = p => ({
      c: p?.c, r: p?.r, matched: p?.matched, hostTier: debugRound(p?.hostTier, 3),
      terrain: p?.rule?.terrain, strength: p?.rule?.strength, facing: p?.rule?.facing,
      height: p?.rule?.height ? clone(p.rule.height) : null,
      reason: p?.reason || null,
    });
    return {
      ok: !!result.ok,
      reason: result.reason || null,
      floorTier: debugRound(result.floorTier, 3),
      failAt: result.failAt ? clone(result.failAt) : null,
      probes: (result.probes || []).map(packProbe),
      embedded: (result.embedded || []).map(packProbe),
    };
  }
  function previewDebugBounds(scale) {
    if (!currentLocale || !currentMerged) return null;
    const placed = currentInstance || currentWorkspace?.localeInstances?.find(item => item.localeId === currentLocale.id) || null;
    const anchorC = finiteCoordinate(placed?.x) ?? finiteCoordinate(placed?.col) ?? finiteCoordinate(currentCandidate?.anchorC);
    const anchorR = finiteCoordinate(placed?.y) ?? finiteCoordinate(placed?.row) ?? finiteCoordinate(currentCandidate?.anchorR);
    if (anchorC == null || anchorR == null) return null;
    const rotationDeg = Number(placed?.rotationDeg ?? currentCandidate?.rotationDeg) || 0; // Debug terrain windows must describe the same cardinal footprint currently rendered in the preview.
    const placedLocale = previewLocaleVariant(currentLocale, rotationDeg);
    const compiled = window.LocaleTerrainPlacement?.compileLocale?.(placedLocale, scale);
    const bounds = compiled?.footprint || compiled?.bounds;
    const minC = anchorC + (finiteCoordinate(bounds?.minC) ?? 0);
    const minR = anchorR + (finiteCoordinate(bounds?.minR) ?? 0);
    const maxC = anchorC + (finiteCoordinate(bounds?.maxC) ?? Math.max(0, (Number(currentLocale.cols) || 1) * scale - 1));
    const maxR = anchorR + (finiteCoordinate(bounds?.maxR) ?? Math.max(0, (Number(currentLocale.rows) || 1) * scale - 1));
    return { anchorC, anchorR, minC, minR, maxC, maxR };
  }
  function buildPreviewDebugSnapshot() {
    const scale = currentCandidate?.scale || window.LocaleTerrainPlacement?.inferGenerationScale?.(currentWorkspace) || 1;
    const bounds = previewDebugBounds(scale);
    const margin = 4;
    let terrainWindow = null;
    if (currentMerged && bounds) {
      let minC = Math.max(0, Math.floor(bounds.minC) - margin);
      let minR = Math.max(0, Math.floor(bounds.minR) - margin);
      let maxC = Math.min(currentMerged.cols - 1, Math.ceil(bounds.maxC) + margin);
      let maxR = Math.min(currentMerged.rows - 1, Math.ceil(bounds.maxR) + margin);
      // Keep dumps pasteable even for giant locales while preserving the locale center.
      const maxSpan = 42;
      if (maxC - minC + 1 > maxSpan) {
        const mid = Math.floor((bounds.minC + bounds.maxC) * 0.5);
        minC = Math.max(0, mid - Math.floor(maxSpan / 2));
        maxC = Math.min(currentMerged.cols - 1, minC + maxSpan - 1);
      }
      if (maxR - minR + 1 > maxSpan) {
        const mid = Math.floor((bounds.minR + bounds.maxR) * 0.5);
        minR = Math.max(0, mid - Math.floor(maxSpan / 2));
        maxR = Math.min(currentMerged.rows - 1, minR + maxSpan - 1);
      }
      const rows = [];
      for (let r = minR; r <= maxR; r++) {
        const cells = [];
        for (let c = minC; c <= maxC; c++) cells.push(debugTile(c, r));
        rows.push({ r, cells });
      }
      terrainWindow = { minC, minR, maxC, maxR, width: maxC - minC + 1, height: maxR - minR + 1, cellsByRow: rows };
    }

    const renderedNodes = [];
    if (scene) {
      scene.traverse(node => {
        if (!node?.name) return;
        if (node.name === 'animalDenEntrances' || node.name === 'localeSandboxExternalObjects' || node.name.startsWith('localeObject_')) renderedNodes.push(debugNode(node));
      });
    }
    const caveRoot = scene?.getObjectByName?.('animalDenEntrances') || null;
    const diagnostic = currentWorkspace?.localeTerrainDiagnostics?.find?.(item => item.localeId === currentLocale?.id) || null;
    const candidateResult = currentCandidate?.result || currentCandidate || null;
    const instanceObjects = (currentInstance?.objects || []).map(object => {
      const x = finiteCoordinate(object.x), z = finiteCoordinate(object.y);
      const w = Math.max(1, Number(object.w) || 1), h = Math.max(1, Number(object.h) || 1);
      const centerX = x == null ? null : x + w / 2;
      const centerZ = z == null ? null : z + h / 2;
      return {
        id: object.id, key: object.key, kind: object.kind, label: object.label,
        x, y: z, w, h, rot: debugRound(object.rot, 2),
        expectedGroundY: centerX == null || centerZ == null || !currentMerged ? null : debugRound(surfaceY(currentMerged, centerX, centerZ), 4),
      };
    });
    return {
      schema: 'hobunji_locale_preview_debug.v1',
      capturedAt: new Date().toISOString(),
      page: location.href,
      preview: {
        visible: previewVisible,
        scenario: currentScenario,
        seed: currentSeed,
        zoneId: currentZoneId,
        statusText: document.getElementById('locale3dStatus')?.textContent || '',
        generationScale: scale,
      },
      camera: camera ? {
        position: debugVec3(camera.position),
        rotationDeg: debugEulerDeg(camera.rotation),
        near: debugRound(camera.near), far: debugRound(camera.far),
        orbitTarget: debugVec3(controls?.target),
      } : null,
      locale: clone(currentLocale),
      placement: {
        instance: currentInstance ? {
          localeId: currentInstance.localeId, x: finiteCoordinate(currentInstance.x), y: finiteCoordinate(currentInstance.y),
          col: finiteCoordinate(currentInstance.col), row: finiteCoordinate(currentInstance.row),
          floorTier: debugRound(currentInstance.floorTier, 3), ghostFailure: !!currentInstance.ghostFailure,
          objects: instanceObjects,
          npcAnchors: clone(currentInstance.npcAnchors || []),
          connectors: clone(currentInstance.connectors || []),
        } : null,
        previewBounds: bounds,
        candidate: currentCandidate ? {
          anchorC: finiteCoordinate(currentCandidate.anchorC), anchorR: finiteCoordinate(currentCandidate.anchorR),
          scale: currentCandidate.scale, closeness: debugRound(currentCandidate.closeness, 4),
          result: debugPlacementResult(currentCandidate.result || currentCandidate),
        } : null,
        workspaceDiagnostic: diagnostic ? clone(diagnostic) : null,
      },
      rendered: {
        cave: debugNode(caveRoot),
        nodes: renderedNodes,
      },
      terrainWindow,
    };
  }
  function showPreviewDebugFallback(text) {
    document.getElementById('localePreviewDebugFallback')?.remove();
    const panel = document.createElement('div');
    panel.id = 'localePreviewDebugFallback';
    Object.assign(panel.style, { position:'absolute', inset:'48px 12px 12px', zIndex:'80', display:'flex', flexDirection:'column', gap:'6px', background:'rgba(4,8,13,.97)', border:'1px solid rgba(255,255,255,.2)', borderRadius:'10px', padding:'8px' });
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;color:#dbeafe;font-size:12px;font-weight:700';
    head.textContent = 'Preview Debug JSON — clipboard unavailable';
    const close = document.createElement('button');
    close.className = 'sec'; close.type = 'button'; close.textContent = 'Close'; close.style.marginLeft = 'auto';
    close.addEventListener('click', () => panel.remove());
    head.appendChild(close);
    const area = document.createElement('textarea');
    area.readOnly = true; area.value = text;
    area.style.cssText = 'flex:1;min-height:0;width:100%;resize:none;font:11px ui-monospace,Menlo,Consolas,monospace';
    area.addEventListener('focus', () => area.select());
    panel.append(head, area);
    document.getElementById('locale3dPreview')?.appendChild(panel);
    area.focus(); area.select();
  }
  async function copyPreviewDebugSnapshot() {
    const snapshot = buildPreviewDebugSnapshot();
    const text = JSON.stringify(snapshot, null, 2);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      setStatus(`Copied preview debug snapshot (${Math.round(text.length / 1024)} KB). Paste it into ChatGPT.`);
    } catch (error) {
      console.warn('[LocaleEditorSandbox] clipboard unavailable; showing debug JSON instead:', error);
      showPreviewDebugFallback(text);
      setStatus('Clipboard unavailable — debug JSON opened for manual copy.');
    }
  }

  function syncZoneChoices(locale) {
    const select = document.getElementById('localeSandboxZone');
    if (!select) return;
    const allowed = Array.isArray(locale?.placement?.allowedZones) && locale.placement.allowedZones.length
      ? locale.placement.allowedZones
      : ZONES.map(([id]) => id);
    for (const option of select.options) option.disabled = !allowed.includes(option.value);
    if (!allowed.includes(select.value)) select.value = allowed[0] || ZONES[0][0];
    currentZoneId = select.value;
  }

  // ---- Renderer -----------------------------------------------------------
  function ensureRenderer() {
    if (renderer) return;
    const THREE = window.THREE;
    const canvas = document.getElementById('locale3dCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(GAME_FOG_COLOR, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(GAME_FOG_COLOR);
    scene.fog = new THREE.FogExp2(GAME_FOG_COLOR, 0.018);
    camera = new THREE.PerspectiveCamera(55, 1, 0.05, 3000);
    camera.position.set(30, 25, 35);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 2;
    controls.maxDistance = 400;
    scene.add(new THREE.AmbientLight(0xfff0e0, 0.7));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.1);
    sun.position.set(4, 8, 2);
    sun.castShadow = true;
    scene.add(sun);
    worldRoot = new THREE.Group();
    worldRoot.name = 'localeSandboxWorld';
    scene.add(worldRoot);
    resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(document.getElementById('locale3dPreview'));
    resizeRenderer();
    if (!renderLoopStarted) {
      renderLoopStarted = true;
      const tick = () => {
        requestAnimationFrame(tick);
        if (!previewVisible || !renderer) return;
        controls.update();
        renderer.render(scene, camera);
      };
      tick();
    }
  }
  function resizeRenderer() {
    if (!renderer || !camera) return;
    const rect = document.getElementById('locale3dPreview')?.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  function disposeTree(root, preserveMaterials = false) {
    if (!root) return;
    const geometries = new Set();
    const materials = new Set();
    root.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (preserveMaterials) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) if (material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => { material.map?.dispose?.(); material.dispose?.(); });
  }
  function clearWorld() {
    generationToken++;
    while (worldRoot?.children?.length) {
      const child = worldRoot.children[worldRoot.children.length - 1];
      worldRoot.remove(child);
      disposeTree(child);
    }
    for (const name of ['animalDenEntrances', 'localeSandboxExternalObjects']) {
      let child;
      while ((child = scene?.getObjectByName(name))) {
        child.parent?.remove(child);
        disposeTree(child, name === 'animalDenEntrances');
      }
    }
    terrainMaterials.clear();
    currentMerged = null;
    currentInstance = null; // Do not leave the orbit target attached to a locale from the previous generated scenario.
    // Regression compatibility from the old lightweight preview: previewRoot.remove(child), parent !== previewRoot.
  }

  // ---- Terrain: same TerrainPreview geometry/material path as Wilderness Lab ----
  function mapMaterialOverride(mapId, key) {
    return terrainMaterialConfig.byMap?.[mapId]?.[key] || terrainMaterialConfig.byMap?.['*']?.[key] || null;
  }
  function resolveTerrainMaterial(mapId, key) {
    const THREE = window.THREE;
    const cacheKey = `${mapId}|${key}`;
    const existing = terrainMaterials.get(cacheKey);
    if (existing) return existing;
    const color = TERRAIN_DEFAULT_COLORS[key] ?? 0x888888;
    const material = key === 'cliff'
      ? new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    material.userData = { terrainKey: key };
    terrainMaterials.set(cacheKey, material);
    const override = mapMaterialOverride(mapId, key);
    if (override?.texture) {
      new THREE.TextureLoader().load(`../../assets/textures/${override.texture}`, loaded => {
        try {
          let finalTexture = loaded;
          const rgb = override.fillColor && window.parseHexColor?.(override.fillColor);
          if (rgb && typeof window.getShadeFillCanvas === 'function') {
            const tinted = window.getShadeFillCanvas(loaded.image, `${override.texture}|${override.fillColor}`, {
              mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: window.getPortraitTintingConfig?.(),
            });
            finalTexture = new THREE.CanvasTexture(tinted);
            loaded.dispose?.();
          }
          finalTexture.wrapS = finalTexture.wrapT = THREE.RepeatWrapping;
          if (Array.isArray(override.stretch) && override.stretch.length === 2) {
            finalTexture.repeat.set(1 / Math.max(0.05, override.stretch[0]), 1 / Math.max(0.05, override.stretch[1]));
          } else {
            const tileSize = Math.max(0.05, override.tileSize || 1);
            finalTexture.repeat.set(1 / tileSize, 1 / tileSize);
          }
          finalTexture.needsUpdate = true;
          material.map = finalTexture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        } catch (_) {}
      }, undefined, () => {});
    }
    return material;
  }
  function geometryFromArrays(pos, idx) {
    const THREE = window.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { uv[j] = pos[i]; uv[j + 1] = pos[i + 2]; }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return geometry;
  }
  function addTerrainMesh(group, pos, idx, material, name) {
    if (!pos?.length || !idx?.length) return null;
    const mesh = new THREE.Mesh(geometryFromArrays(pos, idx), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  function buildTerrainRoot(workspace, rootId) {
    const TerrainPreview = window.TerrainPreview;
    const merged = TerrainPreview.buildMergedZoneGrid(workspace, rootId);
    if (!merged.rootMap) throw new Error(`Generated root map not found: ${rootId}`);
    currentMerged = merged;
    const zGrid = TerrainPreview.buildZGrid(merged.cols, merged.rows, merged.tiles);
    TerrainPreview.applyRampCurtainFlags(zGrid, merged.cols, merged.rows);
    const group = new THREE.Group();
    group.name = 'localeSandboxTerrain';
    const mapId = merged.rootMap.id || rootId;
    const carved = new Set(['river', 'stream', 'waterfall', 'trench', 'raised']);
    const buckets = new Map();

    for (let r = 0; r < merged.rows; r++) {
      for (let c = 0; c < merged.cols; c++) {
        const z = zGrid[r]?.[c];
        if (!z || z.skipFloor) continue;
        const tile = merged.tiles.get(`${c},${r}`);
        if (!tile || tile.type === 'ramp' || carved.has(tile.type)) continue;
        const y = TerrainPreview.NORMAL_TOP + (z.elevTier || 0) * TerrainPreview.PLATEAU_UNIT;
        let bucket = buckets.get(tile.type);
        if (!bucket) buckets.set(tile.type, bucket = { pos: [], idx: [] });
        const base = bucket.pos.length / 3;
        bucket.pos.push(c, y, r, c + 1, y, r, c + 1, y, r + 1, c, y, r + 1);
        bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    for (const [type, bucket] of buckets) {
      TerrainPreview.displaceGeometryPositions(bucket.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, bucket.pos, bucket.idx, resolveTerrainMaterial(mapId, type), `floor_${type}`);
    }
    for (const type of carved) {
      const pos = [], dirtIdx = [], grassIdx = [];
      for (let r = 0; r < merged.rows; r++) for (let c = 0; c < merged.cols; c++) {
        if (zGrid[r]?.[c]?.type !== type) continue;
        let geo;
        try { geo = TerrainPreview.buildTerrainTileGeo(c, r, type, zGrid); } catch (_) { continue; }
        const base = pos.length / 3;
        const tierY = (zGrid[r][c].elevTier || 0) * TerrainPreview.PLATEAU_UNIT;
        const tilePos = geo.pos.slice();
        if (tierY) for (let k = 1; k < tilePos.length; k += 3) tilePos[k] += tierY;
        pos.push(...tilePos);
        for (const value of geo.dirtIdx) dirtIdx.push(value + base);
        for (const value of geo.grassIdx) grassIdx.push(value + base);
      }
      TerrainPreview.displaceGeometryPositions(pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, pos, dirtIdx, resolveTerrainMaterial(mapId, type), `carved_${type}_bed`);
      addTerrainMesh(group, pos, grassIdx, resolveTerrainMaterial(mapId, 'grass'), `carved_${type}_rim`);
    }
    for (const mesa of merged.mesas || []) {
      const elevOffset = (mesa.toTier - mesa.fromTier) * TerrainPreview.PLATEAU_UNIT;
      if (elevOffset <= 0) continue;
      let geo;
      try { geo = TerrainPreview.buildPlateauMesaGeometry(mesa, elevOffset, mesa.fromTier * TerrainPreview.PLATEAU_UNIT, zGrid); } catch (_) { continue; }
      const pos = geo.pos.slice();
      TerrainPreview.displaceGeometryPositions(pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, pos, geo.idx.slice(0, geo.grassCount), resolveTerrainMaterial(mapId, 'grass'), `mesa_${mesa.groupId}_grass`);
      addTerrainMesh(group, pos, geo.idx.slice(geo.grassCount), resolveTerrainMaterial(mapId, 'cliff'), `mesa_${mesa.groupId}_cliff`);
    }
    try {
      const ramp = TerrainPreview.buildRampMeshGeometry(zGrid, merged.cols, merged.rows);
      TerrainPreview.displaceGeometryPositions(ramp.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, ramp.pos, ramp.idx, resolveTerrainMaterial(mapId, 'path'), 'ramps');
      const curtain = TerrainPreview.buildRampCurtainGeometry(zGrid, merged.cols, merged.rows);
      TerrainPreview.displaceGeometryPositions(curtain.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, curtain.pos, curtain.idx, resolveTerrainMaterial(mapId, 'grass'), 'ramp_curtains');
    } catch (_) {}
    try {
      const rock = TerrainPreview.buildRockFormationGeometry(merged, zGrid, merged.cols, merged.rows);
      TerrainPreview.displaceGeometryPositions(rock.pos, merged.visualHeights, merged.cols, merged.rows);
      addTerrainMesh(group, rock.pos, rock.idx, resolveTerrainMaterial(mapId, 'cliff'), 'rock_formations');
    } catch (_) {}
    try {
      const waterfall = TerrainPreview.buildWaterfallWallGeometry(zGrid, merged.cols, merged.rows);
      TerrainPreview.displaceGeometryPositions(waterfall.pos, merged.visualHeights, merged.cols, merged.rows);
      const material = new THREE.MeshBasicMaterial({ color: 0x2f8fc2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      addTerrainMesh(group, waterfall.pos, waterfall.idx, material, 'waterfall_walls');
    } catch (_) {}
    group.userData.zGrid = zGrid;
    group.userData.merged = merged;
    return group;
  }
  function surfaceY(merged, c, r) {
    const TerrainPreview = window.TerrainPreview;
    const col = clamp(Math.floor(c), 0, merged.cols - 1), row = clamp(Math.floor(r), 0, merged.rows - 1);
    const tile = merged.tiles.get(`${col},${row}`);
    let y = TerrainPreview.NORMAL_TOP || 0;
    if (tile?.type === 'ramp') y += (Number(tile.rampElevation) || 0) * TerrainPreview.PLATEAU_UNIT;
    else y += (Number(tile?.elevTier) || 0) * TerrainPreview.PLATEAU_UNIT;
    y += TerrainPreview.sampleVisualHeight?.(merged.visualHeights, c, r, merged.cols, merged.rows) || 0;
    return y;
  }

  // ---- Scenario search ----------------------------------------------------
  function rootMap(workspace) { return workspace?.maps?.find(map => map && !map.isSubmap) || workspace?.maps?.[0] || null; }
  function randomSeed(locale, zoneId) {
    return `locale-preview|${locale?.id || 'locale'}|${zoneId}|${Date.now().toString(36)}|${Math.random().toString(36).slice(2, 9)}`;
  }
  function localeSignature(locale) {
    if (!locale) return '';
    return JSON.stringify({
      id: locale.id, cols: locale.cols, rows: locale.rows, tiles: locale.tiles,
      placement: locale.placement, terrainAnchors: locale.terrainAnchors, embeddedTiles: locale.embeddedTiles,
      objects: locale.objects, npcAnchors: locale.npcAnchors, connectors: locale.connectors,
    });
  }
  function candidateCloseness(result, compiled) {
    if (result.ok) return 1;
    const probeTotal = Math.max(0, compiled.probes.size);
    const embeddedTotal = Math.max(0, compiled.embedded.size);
    let passed = 0;
    for (const diagnostic of result.probes || []) {
      const strength = diagnostic.rule?.strength;
      const good = strength === 'avoid' ? !diagnostic.matched : diagnostic.matched;
      if (good) passed++;
    }
    for (const diagnostic of result.embedded || []) if (diagnostic.matched) passed++;
    const constraintTotal = Math.max(1, probeTotal + embeddedTotal);
    let stage = 0.08;
    const reason = String(result.reason || '');
    if (/ordinary footprint not flat|footprint out of bounds|overwrite|occupied/.test(reason)) stage = 0.18;
    if (/required .* probe failed|avoid .* probe matched/.test(reason)) stage = 0.36;
    if (/embedded .* host failed/.test(reason)) stage = 0.66;
    if (/embedded carve host/.test(reason)) stage = 0.78;
    if (/clearance/.test(reason)) stage = 0.94;
    const ratio = passed / constraintTotal;
    return clamp(stage + ratio * (1 - stage) * 0.82, 0, 0.995);
  }
  function previewLocaleVariant(locale, rotationDeg = 0) {
    const Placement = window.LocaleTerrainPlacement; // Shared production placement API keeps editor overlays/ghosts on the same rotated locale definition as runtime.
    return Placement?.rotateLocaleCardinal ? Placement.rotateLocaleCardinal(locale, rotationDeg) : locale;
  }

  function findFailureCandidate(workspace, locale, seed, mode) {
    const Placement = window.LocaleTerrainPlacement;
    const root = rootMap(workspace);
    if (!root) return null;
    const scale = Math.max(1, Placement.inferGenerationScale(workspace));
    const rotations = locale?.placement?.rotationMode === 'cardinal' ? [0, 90, 180, 270] : [0]; // Failure previews search the same allowed orientations as production placement.
    const step = scale;
    const target = 0.52;
    let best = null;
    for (const rotationDeg of rotations) {
      const placedLocale = previewLocaleVariant(locale, rotationDeg); // Rotated probes/footprint/object metadata must stay together while evaluating near-miss candidates.
      const compiled = Placement.compileLocale(placedLocale, scale);
      if (!compiled) continue;
      const minC = -compiled.bounds.minC, minR = -compiled.bounds.minR;
      const maxC = root.cols - 1 - compiled.bounds.maxC, maxR = root.rows - 1 - compiled.bounds.maxR;
      for (let r = minR; r <= maxR; r += step) {
        for (let c = minC; c <= maxC; c += step) {
          const result = Placement.evaluateCandidateForTest(workspace, placedLocale, c, r, { scale, seed });
          if (result.ok) continue;
          const closeness = candidateCloseness(result, compiled);
          const item = { anchorC: c, anchorR: r, scale, rotationDeg, result, closeness };
          if (mode === 'almost') {
            if (!best || closeness > best.closeness) best = item;
          } else {
            const distance = Math.abs(closeness - target);
            if (!best || distance < best.distance) best = { ...item, distance };
          }
        }
      }
    }
    return best;
  }

  function virtualInstance(locale, candidate) {
    const scale = candidate.scale;
    const rotationDeg = Number(candidate.rotationDeg) || 0; // Ghost previews carry the same cardinal orientation metadata as production locale instances.
    const placedLocale = previewLocaleVariant(locale, rotationDeg); // Objects/connectors/NPC anchors must be drawn from the rotated definition, not the authored north-facing template.
    const anchorC = candidate.anchorC, anchorR = candidate.anchorR;
    const point = item => ({ ...clone(item), x: anchorC + (Number(item.col) || 0) * scale, y: anchorR + (Number(item.row) || 0) * scale });
    return {
      localeId: locale.id, name: locale.name, category: locale.category,
      x: anchorC, y: anchorR, col: anchorC, row: anchorR, terrainAware: true, rotationDeg,
      floorTier: Number(candidate.result?.floorTier) || 0, ghostFailure: true,
      objects: (placedLocale.objects || []).map(object => ({ ...point(object), id: object.id, kind: object.kind, key: object.key, label: object.label, w: Math.max(1, Number(object.w) || 1) * scale, h: Math.max(1, Number(object.h) || 1) * scale, rot: object.rot || 0 })),
      npcAnchors: (placedLocale.npcAnchors || []).map(point),
      connectors: (placedLocale.connectors || []).map(point),
    };
  }
  async function generateScenario(locale, zoneId, seed, scenario) {
    const Generator = window.WildernessMapGenerator;
    if (scenario === 'valid') {
      let workspace = Generator.generateZoneWorkspace(zoneId, seed, [locale]);
      let instance = workspace.localeInstances?.find(item => item.localeId === locale.id) || null;
      let attempts = 1;
      while (!instance && attempts < 5) {
        seed = randomSeed(locale, zoneId);
        workspace = Generator.generateZoneWorkspace(zoneId, seed, [locale]);
        instance = workspace.localeInstances?.find(item => item.localeId === locale.id) || null;
        attempts++;
      }
      if (instance) return { workspace, instance, seed, kind: 'valid', candidate: workspace.localeTerrainDiagnostics?.find(item => item.localeId === locale.id)?.selected || null };
      const diagnostic = workspace.localeTerrainDiagnostics?.find(item => item.localeId === locale.id);
      return { workspace, instance: null, seed, kind: 'no-match', candidate: null, reason: diagnostic?.reason || 'No valid placement found' };
    }

    // Failure and unfiltered modes intentionally generate the host without stamping the locale.
    const workspace = Generator.generateZoneWorkspace(zoneId, seed, []);
    if (scenario === 'random') {
      const Placement = window.LocaleTerrainPlacement;
      const root = rootMap(workspace);
      const scale = Placement.inferGenerationScale(workspace);
      const rotations = locale?.placement?.rotationMode === 'cardinal' ? [0, 90, 180, 270] : [0]; // Unfiltered preview samples one of the same orientations production is allowed to use.
      const rotationDeg = rotations[Math.floor(Math.random() * rotations.length)] || 0;
      const placedLocale = previewLocaleVariant(locale, rotationDeg);
      const compiled = Placement.compileLocale(placedLocale, scale);
      if (!compiled || !root) return { workspace, instance: null, seed, kind: 'no-candidate', reason: 'Locale could not compile' };
      const anchors = [];
      for (let r = -compiled.bounds.minR; r <= root.rows - 1 - compiled.bounds.maxR; r += scale) for (let c = -compiled.bounds.minC; c <= root.cols - 1 - compiled.bounds.maxC; c += scale) anchors.push([c, r]);
      const [anchorC, anchorR] = anchors[Math.floor(Math.random() * anchors.length)] || [0, 0];
      const result = Placement.evaluateCandidateForTest(workspace, placedLocale, anchorC, anchorR, { scale, seed });
      const candidate = { anchorC, anchorR, scale, rotationDeg, result, closeness: result.ok ? 1 : candidateCloseness(result, compiled) };
      return { workspace, instance: virtualInstance(locale, candidate), seed, kind: result.ok ? 'raw-valid' : 'raw-failure', candidate, reason: result.reason || 'valid candidate' };
    }
    const picked = findFailureCandidate(workspace, locale, seed, scenario);
    if (!picked) return { workspace, instance: null, seed, kind: 'no-candidate', reason: 'No rejected candidates found on this seed' };
    return { workspace, instance: virtualInstance(locale, picked), seed, kind: scenario, candidate: picked, reason: picked.result.reason };
  }

  // ---- Locale visuals -----------------------------------------------------
  function loadGlbTemplate(relativePath) {
    if (glbTemplateCache.has(relativePath)) return glbTemplateCache.get(relativePath);
    const promise = new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load(new URL(`../../assets/models/${relativePath}`, location.href).href, gltf => resolve(gltf.scene || gltf.scenes?.[0]), undefined, reject);
    });
    glbTemplateCache.set(relativePath, promise);
    return promise;
  }
  function tintGhost(root, ghost) {
    if (!ghost) return;
    root.traverse(node => {
      if (!node.isMesh) return;
      const wasArray = Array.isArray(node.material);
      const materials = wasArray ? node.material : [node.material];
      const tinted = materials.map(material => {
        const next = material?.clone?.() || new THREE.MeshLambertMaterial({ color: 0x8dd7ff });
        next.transparent = true;
        next.opacity = Math.min(0.58, Number(next.opacity) || 1);
        next.depthWrite = false;
        return next;
      });
      node.material = wasArray ? tinted : tinted[0];
    });
  }
  async function addGlbObject(group, object, merged, token, ghost) {
    const glb = OBJECT_GLB[object.key];
    if (!glb) return false;
    try {
      const template = await loadGlbTemplate(glb);
      if (token !== generationToken || !template) return true;
      const model = template.clone(true);
      model.name = `localeObject_${object.key}`;
      model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; if (node.material?.clone) node.material = node.material.clone(); } });
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const w = Math.max(1, Number(object.w) || 1), h = Math.max(1, Number(object.h) || 1);
      const targetSpan = Math.max(0.7, Math.min(w / Math.max(size.x, 0.001), h / Math.max(size.z, 0.001)) * Math.max(size.x, size.z));
      const currentSpan = Math.max(size.x, size.z, 0.001);
      model.scale.setScalar(targetSpan / currentSpan);
      model.rotation.y = THREE.MathUtils.degToRad(Number(object.rot) || 0);
      model.updateMatrixWorld(true);
      const scaled = new THREE.Box3().setFromObject(model);
      const center = scaled.getCenter(new THREE.Vector3());
      const x = Number(object.x) + w / 2, z = Number(object.y) + h / 2;
      const groundY = surfaceY(merged, x, z);
      model.position.x += x - center.x;
      model.position.z += z - center.z;
      model.position.y += groundY - scaled.min.y;
      tintGhost(model, ghost);
      group.add(model);
      return true;
    } catch (_) { return false; }
  }
  function addFallbackObject(group, object, merged, ghost) {
    const w = Math.max(1, Number(object.w) || 1), h = Math.max(1, Number(object.h) || 1);
    const x = Number(object.x) + w / 2, z = Number(object.y) + h / 2;
    const groundY = surfaceY(merged, x, z);
    const material = new THREE.MeshLambertMaterial({ color: ghost ? 0x8dd7ff : 0xb8874e, transparent: ghost, opacity: ghost ? 0.46 : 0.88 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 1.0, h * 0.72), material);
    mesh.position.set(x, groundY + 0.5, z);
    mesh.rotation.y = THREE.MathUtils.degToRad(Number(object.rot) || 0);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  async function renderLocaleObjects(workspace, locale, instance, merged, terrainRoot, token, ghost) {
    if (!instance) return;
    const group = new THREE.Group();
    group.name = 'localeSandboxExternalObjects';
    scene.add(group);
    for (const object of instance.objects || []) {
      if (object.key === 'cave_small' || locale.objects?.find(source => source.id === object.id)?.visual?.renderer === 'cave_small') continue;
      const loaded = await addGlbObject(group, object, merged, token, ghost);
      if (!loaded && token === generationToken) addFallbackObject(group, object, merged, ghost);
    }
    renderAnchorMarkers(group, instance, merged, ghost);

    if (token !== generationToken) return;
    // Cave objects go through the actual gameplay renderer (which loads cave_small.glb) rather than a second editor implementation.
    const virtualWorkspace = instance.ghostFailure ? { ...workspace, localeInstances: [...(workspace.localeInstances || []), instance] } : workspace;
    window.LocaleCaveRuntime.clearZone(PREVIEW_MAP_ID);
    window.LocaleCaveRuntime.registerWorkspace(PREVIEW_MAP_ID, virtualWorkspace, [locale]);
    window.ZoneDenTotemFeatures.init({
      NORMAL_TOP: window.TerrainPreview.NORMAL_TOP,
      PLATEAU_UNIT: window.TerrainPreview.PLATEAU_UNIT,
      markOutline: () => {},
    });
    window.ZoneDenTotemFeatures.buildAnimalDenMeshes(scene, terrainRoot.userData.zGrid, [], PREVIEW_MAP_ID);
    if (ghost) ghostCaveGroupWhenReady(token);
  }

  function renderAnchorMarkers(group, instance, merged, ghost) {
    for (const anchor of instance?.npcAnchors || []) {
      const x = Number(anchor.x) + 0.5, z = Number(anchor.y) + 0.5;
      const y = surfaceY(merged, x, z);
      if (anchor.npcId === 'banubu') {
        const material = new THREE.SpriteMaterial({ map: new THREE.TextureLoader().load('../../assets/creaturesprites/grehlr_idle.png'), transparent: true, opacity: ghost ? 0.58 : 1, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2.2, 2.2 / 0.75, 1);
        sprite.position.set(x, y + sprite.scale.y * 0.5, z);
        group.add(sprite);
      } else {
        const material = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: ghost, opacity: ghost ? 0.52 : 0.9 });
        const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.8, 10), material);
        marker.position.set(x, y + 0.4, z);
        group.add(marker);
      }
    }
    for (const connector of instance?.connectors || []) {
      const x = Number(connector.x) + 0.5, z = Number(connector.y) + 0.5;
      const y = surfaceY(merged, x, z) + 0.09;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 20), new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: ghost ? 0.48 : 0.92 }));
      ring.rotation.x = Math.PI * 0.5;
      ring.position.set(x, y, z);
      group.add(ring);
    }
  }

  function ghostCaveGroupWhenReady(token) {
    const started = performance.now();
    const poll = () => {
      if (token !== generationToken) return;
      const group = scene?.getObjectByName('animalDenEntrances');
      if (!group) { if (performance.now() - started < 2500) requestAnimationFrame(poll); return; }
      tintGhost(group, true);
    };
    poll();
  }

  function addRuleOverlay(locale, instance, candidate, merged) {
    if (!instance || !merged) return;
    const scale = candidate?.scale || window.LocaleTerrainPlacement.inferGenerationScale(currentWorkspace);
    const anchorC = Number(instance.x) || 0, anchorR = Number(instance.y) || 0;
    const group = new THREE.Group();
    group.name = 'localeSandboxRuleOverlay';
    group.visible = showRules;
    const tile = (c, r, color, opacity, height = 0.06) => {
      const y = surfaceY(merged, c + 0.5, r + 0.5) + height / 2 + 0.035;
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.72, height, 0.72), material);
      mesh.position.set(c + 0.5, y, r + 0.5);
      mesh.renderOrder = 60;
      group.add(mesh);
    };
    const rotationDeg = Number(instance?.rotationDeg ?? candidate?.rotationDeg) || 0; // Placed cardinal orientation selects the exact footprint/probe definition drawn by the overlay.
    const placedLocale = previewLocaleVariant(locale, rotationDeg);
    const compiled = window.LocaleTerrainPlacement.compileLocale(placedLocale, scale);
    for (const cell of compiled?.tiles?.values?.() || []) tile(anchorC + cell.c, anchorR + cell.r, 0xf5a623, instance.ghostFailure ? 0.20 : 0.10, 0.035);
    for (const cell of compiled?.probes?.values?.() || []) {
      const rule = cell.value;
      const color = rule.strength === 'avoid' ? 0xfb7185 : rule.strength === 'preferred' ? 0xfacc15 : rule.terrain === 'boundaryCliff' ? 0xa78bfa : 0x55e6ff;
      tile(anchorC + cell.c, anchorR + cell.r, color, 0.82, 0.13);
    }
    for (const cell of compiled?.embedded?.values?.() || []) tile(anchorC + cell.c, anchorR + cell.r, 0xd56bff, 0.72, 0.18);
    const fail = candidate?.result?.failAt || candidate?.failAt;
    if (fail) tile(fail.c, fail.r, 0xff263f, 0.95, 0.35);
    worldRoot.add(group);
  }

  function finiteCoordinate(value) {
    if (value == null || value === '') return null; // Number(null) is 0, which previously made an absent anchor silently focus tile 0,0.
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  function fitCamera() {
    if (!camera || !controls || !currentLocale) return;
    const scale = currentCandidate?.scale || window.LocaleTerrainPlacement.inferGenerationScale(currentWorkspace) || 1;
    const placed = currentInstance || currentWorkspace?.localeInstances?.find(item => item.localeId === currentLocale.id) || null;
    const anchorC = finiteCoordinate(placed?.x) ?? finiteCoordinate(placed?.col) ?? finiteCoordinate(currentCandidate?.anchorC);
    const anchorR = finiteCoordinate(placed?.y) ?? finiteCoordinate(placed?.row) ?? finiteCoordinate(currentCandidate?.anchorR);
    const rotationDeg = Number(placed?.rotationDeg ?? currentCandidate?.rotationDeg) || 0; // Camera footprint bounds must follow the selected cardinal locale orientation.
    const placedLocale = previewLocaleVariant(currentLocale, rotationDeg);
    const compiled = window.LocaleTerrainPlacement.compileLocale(placedLocale, scale);
    const bounds = compiled?.footprint || compiled?.bounds;
    let centerX, centerZ, spanX, spanZ;
    if (anchorC != null && anchorR != null) {
      const minC = finiteCoordinate(bounds?.minC) ?? 0;
      const minR = finiteCoordinate(bounds?.minR) ?? 0;
      const maxC = finiteCoordinate(bounds?.maxC);
      const maxR = finiteCoordinate(bounds?.maxR);
      const localWidth = maxC == null ? Math.max(1, Number(currentLocale.cols) || 1) * scale : Math.max(1, maxC - minC + 1);
      const localDepth = maxR == null ? Math.max(1, Number(currentLocale.rows) || 1) * scale : Math.max(1, maxR - minR + 1);
      centerX = anchorC + minC + localWidth * 0.5;
      centerZ = anchorR + minR + localDepth * 0.5;
      spanX = localWidth;
      spanZ = localDepth;
    } else if (currentMerged) {
      // A no-match preview has no locale instance. Keep it centered on the generated map instead of falling back to the world origin corner.
      centerX = currentMerged.cols * 0.5;
      centerZ = currentMerged.rows * 0.5;
      spanX = Math.max(1, currentMerged.cols * 0.18);
      spanZ = Math.max(1, currentMerged.rows * 0.18);
    } else return;
    const centerY = currentMerged ? surfaceY(currentMerged, centerX, centerZ) : 0;
    const span = Math.max(12, Math.max(spanX, spanZ) * 1.35);
    controls.target.set(centerX, centerY + 1.2, centerZ);
    camera.position.set(centerX + span * 0.72, centerY + span * 0.56, centerZ + span * 0.78);
    camera.near = 0.05;
    camera.far = 3000;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function scenarioLabel(kind) {
    if (kind === 'valid') return 'VALID PLACEMENT';
    if (kind === 'almost') return 'ALMOST RIGHT — intentionally rejected';
    if (kind === 'somewhat') return 'SOMEWHAT RIGHT — intentionally rejected';
    if (kind === 'raw-valid') return 'UNFILTERED — happened to be valid';
    if (kind === 'raw-failure') return 'UNFILTERED — rejected';
    return 'NO MATCH';
  }
  async function renderScenario(result, locale, zoneId, token) {
    if (token !== generationToken) return;
    clearWorld();
    // clearWorld increments generationToken; claim the resulting token for this render.
    token = generationToken;
    currentWorkspace = result.workspace;
    currentLocale = locale;
    const root = rootMap(result.workspace);
    if (!root) throw new Error('Generated workspace has no root map');
    const terrainRoot = buildTerrainRoot(result.workspace, root.id);
    worldRoot.add(terrainRoot);
    currentMerged = terrainRoot.userData.merged;

    let instance = result.instance;
    let candidate = result.candidate;
    if (instance && (!candidate || candidate.anchorC == null)) {
      candidate = {
        anchorC: Number(instance.x) || 0,
        anchorR: Number(instance.y) || 0,
        scale: window.LocaleTerrainPlacement.inferGenerationScale(result.workspace),
        rotationDeg: Number(instance.rotationDeg) || 0,
        floorTier: instance.floorTier,
      };
    }
    currentCandidate = candidate;
    currentInstance = instance; // Camera focus must follow the exact instance being drawn, including ghost failure previews.
    await renderLocaleObjects(result.workspace, locale, instance, currentMerged, terrainRoot, token, !!instance?.ghostFailure);
    if (token !== generationToken) return;
    addRuleOverlay(locale, instance, candidate, currentMerged);
    fitCamera();

    const failure = candidate?.result;
    const closeness = candidate?.closeness;
    const matchText = Number.isFinite(closeness) ? ` · ${(closeness * 100).toFixed(0)}% rule fit` : '';
    const reason = result.reason || failure?.reason;
    setStatus(`${scenarioLabel(result.kind)} · ${locale.name || locale.id} · ${ZONES.find(([id]) => id === zoneId)?.[1] || zoneId} · seed ${result.seed}${matchText}${reason ? ` · ${reason}` : ''}${instance?.ghostFailure ? ' · locale shown as a ghost because the game would not place it here' : ''}`);
  }

  async function regenerateScenario({ newSeed = false, force = false } = {}) {
    if (!previewVisible || !renderer) return;
    const locale = activeMergedLocale();
    if (!locale) { setStatus('No active locale.'); return; }
    syncZoneChoices(locale);
    const zoneId = currentZoneId || document.getElementById('localeSandboxZone')?.value || ZONES[0][0];
    const signature = localeSignature(locale);
    if (!force && signature === currentLocaleSignature) return;
    currentLocaleSignature = signature;
    if (newSeed || !currentSeed) currentSeed = randomSeed(locale, zoneId);
    const requestToken = ++generationToken;
    setStatus(`Generating ${currentScenario === 'valid' ? 'valid placement' : currentScenario === 'almost' ? 'near-miss failure' : currentScenario === 'somewhat' ? 'partial-match failure' : 'unfiltered candidate'} with the game wilderness generator…`);
    try {
      const result = await Promise.resolve(generateScenario(locale, zoneId, currentSeed, currentScenario));
      if (requestToken !== generationToken) return;
      currentSeed = result.seed;
      await renderScenario(result, locale, zoneId, requestToken);
    } catch (error) {
      console.error('[LocaleEditorSandbox] generation failed:', error);
      setStatus(`Generation failed: ${error.message}`);
    }
  }

  function install() {
    const ready = injectRelativeHeightHelpers() && injectPreviewUi();
    if (!ready) { setTimeout(install, 120); return; }
    window._localePreview3dDebug = { buildSnapshot: buildPreviewDebugSnapshot, copySnapshot: copyPreviewDebugSnapshot };
    setInterval(() => {
      if (!previewVisible || !renderer) return;
      const locale = activeMergedLocale();
      const signature = localeSignature(locale);
      if (locale && signature !== currentLocaleSignature) regenerateScenario({ newSeed: false, force: true });
    }, 500);
    console.log('[LocaleEditorSandbox] in-game terrain + GLB locale preview ready');
  }

  install();
})();
