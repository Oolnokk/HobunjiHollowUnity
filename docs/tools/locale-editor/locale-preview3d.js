// Locale Editor 3D preview + relative-height authoring helpers.
(() => {
  'use strict';

  if (window.__localeEditorPreview3dInstalled) return;
  window.__localeEditorPreview3dInstalled = true;

  const WORKSPACE_KEY = 'hobunji_locale_editor_workspace_v1';
  const RULE_STORE_KEY = 'hobunji_locale_editor_terrain_rules_v1';
  const TILE_COLORS = {
    grass: 0x4a7c43, weeds: 0x6b8c3a, tilled: 0x7a5230, trench: 0x3d2c1e,
    raised: 0xa8835a, paddy: 0x3f7fae, rock: 0x8a8f98, shrub: 0x2f6f3f,
    path: 0xb8956a, river: 0x2f6fb8, stream: 0x4f9bd9, waterfall: 0xbfe9f7, ramp: 0xc2b280,
  };

  let previewVisible = false; // Main viewport toggle state for the 3D authoring preview.
  let renderer = null; // Lazily created Three renderer so the 2D editor pays no WebGL cost until requested.
  let scene = null;
  let camera = null;
  let controls = null;
  let previewRoot = null;
  let resizeObserver = null;
  let lastSignature = '';
  let lastLocaleId = '';
  let caveTemplatePromise = null;
  let renderLoopStarted = false;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

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
    return output;
  }

  function fireChange(element) {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

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
      <div class="muted" style="margin-top:4px">Positive Δ means the required/embedded host terrain is above the locale floor. For example, Δ+2 means the locale sits two tiers lower than that plateau. Banubu-style caves use “Host above”.</div>`;
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

  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => test() ? resolve() : reject(new Error(`loaded ${src} but expected API is missing`));
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureThree() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', () => !!window.THREE?.WebGLRenderer);
    await loadScript('https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js', () => !!window.THREE?.OrbitControls);
    await loadScript(new URL('../../js/GLTFLoader.js', location.href).href, () => !!window.THREE?.GLTFLoader);
  }

  function injectPreviewUi() {
    if (document.getElementById('locale3dPreview')) return true;
    const view = document.getElementById('view');
    const modeBar = document.getElementById('modeBar');
    if (!view || !modeBar) return false;

    const button = document.createElement('button');
    button.id = 'locale3dPreviewBtn';
    button.type = 'button';
    button.className = 'sec';
    button.textContent = '◫ 3D Preview';
    button.title = 'Toggle a live 3D authoring preview of the active locale';
    const fit = document.getElementById('fitBtn');
    modeBar.insertBefore(button, fit || null);

    const overlay = document.createElement('div');
    overlay.id = 'locale3dPreview';
    Object.assign(overlay.style, {
      display: 'none', position: 'absolute', inset: '0', zIndex: '15', background: '#081018', touchAction: 'none', overflow: 'hidden'
    });
    overlay.innerHTML = `
      <canvas id="locale3dCanvas" style="display:block;width:100%;height:100%;touch-action:none"></canvas>
      <div style="position:absolute;left:8px;top:8px;display:flex;gap:5px;flex-wrap:wrap;pointer-events:none">
        <span class="pill" id="locale3dStatus">3D preview</span>
        <span class="pill">drag = orbit · pinch/wheel = zoom · right-drag = pan</span>
      </div>
      <div style="position:absolute;right:8px;top:8px;display:flex;gap:5px">
        <button class="sec" id="locale3dFitBtn" type="button">Fit 3D</button>
      </div>
      <div style="position:absolute;left:8px;bottom:8px;max-width:min(520px,calc(100% - 16px));background:rgba(5,10,16,.82);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 8px;font-size:11px;color:#c7d7ea;pointer-events:none">
        Locale floor = y0. Translucent/wireframe columns show the host terrain height required by embedded cells before carving. Cyan = internal plateau cliff/probe, violet = boundary cliff, yellow = preferred, red = avoid, magenta = embedded host volume.
      </div>`;
    view.appendChild(overlay);

    button.addEventListener('click', async () => {
      previewVisible = !previewVisible;
      button.classList.toggle('act', previewVisible);
      overlay.style.display = previewVisible ? 'block' : 'none';
      if (!previewVisible) return;
      const status = document.getElementById('locale3dStatus');
      if (status) status.textContent = 'Loading 3D…';
      try {
        await ensureThree();
        ensureRenderer();
        rebuildIfChanged(true);
      } catch (error) {
        if (status) status.textContent = `3D unavailable: ${error.message}`;
        console.error('[LocaleEditor3D]', error);
      }
    });
    document.getElementById('locale3dFitBtn').addEventListener('click', () => fitCamera(activeMergedLocale()));
    return true;
  }

  function ensureRenderer() {
    if (renderer) return;
    const canvas = document.getElementById('locale3dCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x081018, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x081018, 35, 110);
    camera = new THREE.PerspectiveCamera(52, 1, 0.05, 500);
    camera.position.set(12, 10, 14);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 2;
    controls.maxDistance = 160;

    scene.add(new THREE.HemisphereLight(0xd8edff, 0x27311f, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(8, 18, 10);
    sun.castShadow = true;
    scene.add(sun);

    previewRoot = new THREE.Group();
    previewRoot.name = 'locale_preview_root';
    scene.add(previewRoot);

    resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(document.getElementById('locale3dPreview'));
    resizeRenderer();
    startRenderLoop();
  }

  function resizeRenderer() {
    if (!renderer || !camera) return;
    const host = document.getElementById('locale3dPreview');
    const rect = host?.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  function startRenderLoop() {
    if (renderLoopStarted) return;
    renderLoopStarted = true;
    const tick = () => {
      requestAnimationFrame(tick);
      if (!previewVisible || !renderer || !scene || !camera) return;
      controls?.update();
      renderer.render(scene, camera);
    };
    tick();
  }

  function disposeObject(root) {
    root.traverse?.(node => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
      else node.material?.dispose?.();
    });
  }

  function clearPreviewRoot() {
    if (!previewRoot) return;
    while (previewRoot.children.length) {
      const child = previewRoot.children[previewRoot.children.length - 1];
      previewRoot.remove(child);
      disposeObject(child);
    }
  }

  function parseCellKey(key) {
    const [c, r] = String(key).split(',').map(Number);
    return Number.isFinite(c) && Number.isFinite(r) ? { c, r } : null;
  }

  function rulePreviewDelta(height) {
    if (!height || height.mode === 'any') return 0;
    if (height.mode === 'relativeRange') {
      const min = height.min == null || height.min === '' ? NaN : Number(height.min); // Open-ended relative ranges must stay open; Number(null) would incorrectly collapse them to Δ0.
      const max = height.max == null || height.max === '' ? NaN : Number(height.max);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        if (min <= 0 && max >= 0) return 0;
        return Math.abs(min) <= Math.abs(max) ? min : max;
      }
      if (Number.isFinite(min)) return min;
      if (Number.isFinite(max)) return max;
    }
    if (height.mode === 'range') {
      const min = Number(height.min);
      return Number.isFinite(min) ? min : 0;
    }
    return 0;
  }

  function addBox(parent, x, y, z, w, h, d, color, options = {}) {
    const geometry = new THREE.BoxGeometry(w, Math.max(0.02, h), d);
    const material = new THREE.MeshStandardMaterial({
      color,
      transparent: !!options.transparent,
      opacity: options.opacity == null ? 1 : options.opacity,
      roughness: options.roughness == null ? 0.85 : options.roughness,
      metalness: 0,
      depthWrite: options.depthWrite !== false,
      wireframe: !!options.wireframe,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addHostVolume(parent, cell, rule) {
    const delta = rulePreviewDelta(rule?.height);
    const magnitude = Math.max(0.15, Math.abs(delta));
    const centerY = delta >= 0 ? magnitude * 0.5 : -magnitude * 0.5;
    addBox(parent, cell.c + 0.5, centerY, cell.r + 0.5, 0.94, magnitude, 0.94, 0xd56bff, {
      transparent: true, opacity: 0.16, depthWrite: false, castShadow: false
    });
    addBox(parent, cell.c + 0.5, centerY, cell.r + 0.5, 0.95, magnitude + 0.01, 0.95, 0xf1c4ff, {
      transparent: true, opacity: 0.55, depthWrite: false, wireframe: true, castShadow: false
    });
  }

  function probeColor(rule) {
    if (rule?.strength === 'avoid') return 0xfb7185;
    if (rule?.strength === 'preferred') return 0xfacc15;
    if (rule?.terrain === 'boundaryCliff') return 0xa78bfa;
    return 0x55e6ff;
  }

  function addProbe(parent, cell, rule) {
    const delta = rulePreviewDelta(rule?.height);
    const y = delta + 0.34;
    const geometry = new THREE.ConeGeometry(0.20, 0.62, 8);
    const material = new THREE.MeshStandardMaterial({ color: probeColor(rule), emissive: probeColor(rule), emissiveIntensity: 0.18, roughness: 0.55 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cell.c + 0.5, y, cell.r + 0.5);
    mesh.castShadow = true;
    parent.add(mesh);
  }

  function loadCaveTemplate() {
    if (caveTemplatePromise) return caveTemplatePromise;
    caveTemplatePromise = new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(new URL('../../assets/models/cave_small.glb', location.href).href, gltf => resolve(gltf.scene), undefined, reject);
    });
    return caveTemplatePromise;
  }

  async function addCaveObject(parent, object) {
    const fallback = addBox(parent, object.col + (object.w || 1) / 2, 0.55, object.row + (object.h || 1) / 2, object.w || 1, 1.0, object.h || 1, 0x6f665c, { transparent: true, opacity: 0.55 });
    try {
      const template = await loadCaveTemplate();
      if (!previewRoot || parent !== previewRoot || !previewRoot.parent) return;
      const cave = template.clone(true);
      cave.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = node.material?.clone?.() || new THREE.MeshStandardMaterial({ color: 0x71685e, roughness: 0.95 });
      });
      const box = new THREE.Box3().setFromObject(cave);
      const size = box.getSize(new THREE.Vector3());
      const desired = Math.max(object.w || 1, object.h || 1) * Math.max(0.5, Number(object.visual?.scale) || 1) / 2;
      const denom = Math.max(size.x, size.z, 0.001);
      const scale = desired / denom;
      cave.scale.setScalar(scale);
      cave.rotation.y = THREE.MathUtils.degToRad(Number(object.rot) || 0);
      const scaledBox = new THREE.Box3().setFromObject(cave);
      const center = scaledBox.getCenter(new THREE.Vector3());
      cave.position.set(object.col + (object.w || 1) / 2 - center.x, -scaledBox.min.y, object.row + (object.h || 1) / 2 - center.z);
      parent.add(cave);
      parent.remove(fallback);
      disposeObject(fallback);
    } catch (error) {
      console.warn('[LocaleEditor3D] cave_small preview load failed:', error);
    }
  }

  function addObjectMarkers(parent, locale) {
    for (const object of locale.objects || []) {
      const w = Math.max(0.5, Number(object.w) || 1);
      const h = Math.max(0.5, Number(object.h) || 1);
      if (object.key === 'cave_small' || object.visual?.renderer === 'cave_small') {
        addCaveObject(parent, object);
        continue;
      }
      const mesh = addBox(parent, Number(object.col) + w / 2, 0.42, Number(object.row) + h / 2, w * 0.82, 0.76, h * 0.82, 0xf59e0b, { transparent: true, opacity: 0.78 });
      mesh.rotation.y = THREE.MathUtils.degToRad(Number(object.rot) || 0);
    }

    for (const anchor of locale.npcAnchors || []) {
      const c = Number(anchor.col) + 0.5;
      const r = Number(anchor.row) + 0.5;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.62, 10), new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.7 }));
      body.position.set(c, 0.38, r);
      body.castShadow = true;
      parent.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshStandardMaterial({ color: 0xb9d7ff, roughness: 0.7 }));
      head.position.set(c, 0.80, r);
      parent.add(head);
    }

    for (const connector of locale.connectors || []) {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.065, 8, 20), new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0.22 }));
      torus.rotation.x = Math.PI * 0.5;
      torus.position.set(Number(connector.col) + 0.5, 0.12, Number(connector.row) + 0.5);
      parent.add(torus);
    }
  }

  function buildLocalePreview(locale) {
    if (!previewRoot || !locale) return;
    clearPreviewRoot();

    const ground = addBox(previewRoot, locale.cols / 2, -0.055, locale.rows / 2, locale.cols, 0.10, locale.rows, 0x101a24, { castShadow: false, roughness: 1 });
    ground.receiveShadow = true;
    const grid = new THREE.GridHelper(Math.max(locale.cols, locale.rows), Math.max(locale.cols, locale.rows), 0x314357, 0x1b2a38);
    grid.position.set(locale.cols / 2, 0.006, locale.rows / 2);
    previewRoot.add(grid);

    for (const [key, tile] of Object.entries(locale.tiles || {})) {
      const cell = parseCellKey(key);
      if (!cell) continue;
      const color = TILE_COLORS[tile?.type] || 0x4a7c43;
      addBox(previewRoot, cell.c + 0.5, 0.055, cell.r + 0.5, 0.94, 0.10, 0.94, color, { castShadow: false });
    }

    for (const [key, rule] of Object.entries(locale.embeddedTiles || {})) {
      const cell = parseCellKey(key);
      if (cell) addHostVolume(previewRoot, cell, rule);
    }

    for (const [key, rule] of Object.entries(locale.terrainAnchors || {})) {
      const cell = parseCellKey(key);
      if (cell) addProbe(previewRoot, cell, rule);
    }

    addObjectMarkers(previewRoot, locale);
    const status = document.getElementById('locale3dStatus');
    if (status) status.textContent = `${locale.name || locale.id} · floor y0 · ${Object.keys(locale.embeddedTiles || {}).length} embedded`;
    fitCamera(locale);
  }

  function fitCamera(locale) {
    if (!camera || !controls || !locale) return;
    const deltas = Object.values(locale.embeddedTiles || {}).map(rule => Math.abs(rulePreviewDelta(rule?.height)));
    const vertical = Math.max(2, ...deltas);
    const span = Math.max(4, locale.cols || 1, locale.rows || 1, vertical * 1.4);
    const center = new THREE.Vector3((locale.cols || 1) / 2, Math.max(0.4, vertical * 0.28), (locale.rows || 1) / 2);
    controls.target.copy(center);
    camera.position.set(center.x + span * 0.95, center.y + span * 0.78, center.z + span * 1.05);
    camera.near = Math.max(0.02, span / 500);
    camera.far = Math.max(120, span * 18);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function previewSignature(locale) {
    if (!locale) return '';
    return JSON.stringify({
      id: locale.id, cols: locale.cols, rows: locale.rows,
      tiles: locale.tiles, terrainAnchors: locale.terrainAnchors, embeddedTiles: locale.embeddedTiles,
      objects: locale.objects, npcAnchors: locale.npcAnchors, connectors: locale.connectors,
    });
  }

  function rebuildIfChanged(force = false) {
    if (!previewVisible || !renderer) return;
    const locale = activeMergedLocale();
    const signature = previewSignature(locale);
    if (!locale) {
      clearPreviewRoot();
      const status = document.getElementById('locale3dStatus');
      if (status) status.textContent = 'No active locale';
      lastSignature = '';
      lastLocaleId = '';
      return;
    }
    if (!force && signature === lastSignature) return;
    const localeChanged = locale.id !== lastLocaleId;
    lastSignature = signature;
    lastLocaleId = locale.id;
    buildLocalePreview(locale);
    if (!localeChanged && !force) controls?.update();
  }

  function install() {
    const ready = injectRelativeHeightHelpers() && injectPreviewUi();
    if (!ready) {
      setTimeout(install, 120);
      return;
    }
    setInterval(() => rebuildIfChanged(false), 250);
    console.log('[LocaleEditor3D] relative-height helpers + 3D preview ready');
  }

  install();
})();
