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
    output.terrainAnchors = clone(stored?.terrainAnchors || placement.terrainAnchors || output.terrainAnchors || {});
    output.embeddedTiles = clone(stored?.embeddedTiles || placement.embeddedTiles || output.embeddedTiles || {});
    // The main editor sanitizer historically stripped visual metadata. Cave identity by key still works,
    // and this restores the canonical cave visual when that metadata is absent.
    for (const object of output.objects || []) {
      if (object.key === 'cave_small' && !object.visual) object.visual = { renderer: 'cave_small', scale: output.id === 'locale_banubu_shrine' ? 2 : 1, facing: 'north' };
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
    await loadScript('../../js/terrain-preview.js', () => !!window.TerrainPreview?.buildMergedZoneGrid);
    await loadScript('../../js/wilderness-map-generator.js', () => !!window.WildernessMapGenerator?.generateZoneWorkspace);
    await loadScript('../../js/locale-terrain-placement.js', () => !!window.LocaleTerrainPlacement?.evaluateCandidateForTest);
    await loadScript('../../js/locale-cave-runtime.js', () => !!window.LocaleCaveRuntime?.registerWorkspace);
    await loadScript('../../js/zone-den-totem-features.js', () => !!window.ZoneDenTotemFeatures?.buildAnimalDenMeshes);
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
        loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
        if (Array.isArray(override.stretch) && override.stretch.length === 2) {
          loaded.repeat.set(1 / Math.max(0.05, override.stretch[0]), 1 / Math.max(0.05, override.stretch[1]));
        } else {
          const tileSize = Math.max(0.05, override.tileSize || 1);
          loaded.repeat.set(1 / tileSize, 1 / tileSize);
        }
        loaded.needsUpdate = true;
        material.map = loaded;
        material.color.set(0xffffff);
        material.needsUpdate = true;
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
  function scanFailureCandidates(workspace, locale, seed) {
    const Placement = window.LocaleTerrainPlacement;
    const root = rootMap(workspace);
    if (!root) return [];
    const scale = Math.max(1, Placement.inferGenerationScale(workspace));
    const compiled = Placement.compileLocale(locale, scale);
    if (!compiled) return [];
    const failures = [];
    const step = scale;
    const minC = -compiled.bounds.minC, minR = -compiled.bounds.minR;
    const maxC = root.cols - 1 - compiled.bounds.maxC, maxR = root.rows - 1 - compiled.bounds.maxR;
    for (let r = minR; r <= maxR; r += step) {
      for (let c = minC; c <= maxC; c += step) {
        const result = Placement.evaluateCandidateForTest(workspace, locale, c, r, { scale, seed });
        if (result.ok) continue;
        failures.push({ anchorC: c, anchorR: r, scale, result, closeness: candidateCloseness(result, compiled) });
      }
    }
    return failures;
  }
  function chooseFailure(failures, mode) {
    if (!failures.length) return null;
    if (mode === 'almost') return failures.reduce((best, item) => !best || item.closeness > best.closeness ? item : best, null);
    const target = 0.52;
    return failures.reduce((best, item) => {
      const distance = Math.abs(item.closeness - target);
      return !best || distance < best.distance ? { ...item, distance } : best;
    }, null);
  }
  function virtualInstance(locale, candidate) {
    const scale = candidate.scale;
    const anchorC = candidate.anchorC, anchorR = candidate.anchorR;
    const point = item => ({ ...clone(item), x: anchorC + (Number(item.col) || 0) * scale, y: anchorR + (Number(item.row) || 0) * scale });
    return {
      localeId: locale.id, name: locale.name, category: locale.category,
      x: anchorC, y: anchorR, col: anchorC, row: anchorR, terrainAware: true,
      floorTier: Number(candidate.result?.floorTier) || 0, ghostFailure: true,
      objects: (locale.objects || []).map(object => ({ ...point(object), id: object.id, kind: object.kind, key: object.key, label: object.label, w: Math.max(1, Number(object.w) || 1) * scale, h: Math.max(1, Number(object.h) || 1) * scale, rot: object.rot || 0 })),
      npcAnchors: (locale.npcAnchors || []).map(point),
      connectors: (locale.connectors || []).map(point),
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
    const failures = scanFailureCandidates(workspace, locale, seed);
    if (scenario === 'random') {
      const Placement = window.LocaleTerrainPlacement;
      const root = rootMap(workspace);
      const scale = Placement.inferGenerationScale(workspace);
      const compiled = Placement.compileLocale(locale, scale);
      if (!compiled || !root) return { workspace, instance: null, seed, kind: 'no-candidate', reason: 'Locale could not compile' };
      const anchors = [];
      for (let r = -compiled.bounds.minR; r <= root.rows - 1 - compiled.bounds.maxR; r += scale) for (let c = -compiled.bounds.minC; c <= root.cols - 1 - compiled.bounds.maxC; c += scale) anchors.push([c, r]);
      const [anchorC, anchorR] = anchors[Math.floor(Math.random() * anchors.length)] || [0, 0];
      const result = Placement.evaluateCandidateForTest(workspace, locale, anchorC, anchorR, { scale, seed });
      const candidate = { anchorC, anchorR, scale, result, closeness: result.ok ? 1 : candidateCloseness(result, compiled) };
      return { workspace, instance: virtualInstance(locale, candidate), seed, kind: result.ok ? 'raw-valid' : 'raw-failure', candidate, reason: result.reason || 'valid candidate' };
    }
    const picked = chooseFailure(failures, scenario);
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
    const compiled = window.LocaleTerrainPlacement.compileLocale(locale, scale);
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

  function fitCamera() {
    if (!camera || !controls || !currentCandidate || !currentLocale) return;
    const scale = currentCandidate.scale || window.LocaleTerrainPlacement.inferGenerationScale(currentWorkspace);
    const placed = currentWorkspace?.localeInstances?.find(item => item.localeId === currentLocale.id);
    const anchorC = Number.isFinite(Number(currentCandidate.anchorC)) ? Number(currentCandidate.anchorC) : Number(placed?.x) || 0;
    const anchorR = Number.isFinite(Number(currentCandidate.anchorR)) ? Number(currentCandidate.anchorR) : Number(placed?.y) || 0;
    const centerX = anchorC + (currentLocale.cols * scale) / 2;
    const centerZ = anchorR + (currentLocale.rows * scale) / 2;
    const centerY = currentMerged ? surfaceY(currentMerged, centerX, centerZ) : 0;
    const span = Math.max(12, Math.max(currentLocale.cols, currentLocale.rows) * scale * 1.35);
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
        floorTier: instance.floorTier,
      };
    }
    currentCandidate = candidate;
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
