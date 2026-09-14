(() => {
  'use strict';

  if (window.__hobunjiToolTerrainParityBootstrap) return;
  window.__hobunjiToolTerrainParityBootstrap = true;

  const SELF_SRC = document.currentScript?.src || new URL('../js/tool-terrain-preview-parity.js', location.href).href; // Used to resolve the same shared modules from the Tool Hub and nested tool iframes.
  const JS_ROOT = new URL('./', SELF_SRC); // Used as canonical docs/js/ for runtime terrain dependencies.
  const STORE_KEY = 'hobunji:tool-terrain-native-pixel-scale:v2'; // Used so the same unstretched-pixel experiment follows the user between terrain tools.
  const LEGACY_STORE_KEY = 'hobunji:tool-terrain-native-png-scale:v1'; // Used to migrate the first full-PNG-span control without throwing away the user's authored value.
  const PANEL_ID = 'hobunjiTerrainParityPanel'; // Used to keep injected controls idempotent.
  const INJECT_ID = 'hobunjiToolTerrainParityInjected'; // Used to keep parent-to-iframe injection idempotent.
  const DEFAULT_SPAN = 6; // Used as the current gameplay-compatible world span occupied by one complete source PNG at 1x pixel scale.
  const DEFAULT_PIXEL_SCALE = 1; // Used as the current in-game unstretched source-pixel density.
  const DEFAULT_EDGE = 0.16; // Used as the current gameplay-compatible protected source-border fraction.
  const STEEP_NORMAL_Y_MAX = 0.72; // Used to recognize legacy anonymous cliff-only meshes while rejecting mostly horizontal beds/floors.
  const STEEP_RATIO_MIN = 0.55; // Used as the minimum area fraction that must be cliff-like before a legacy color fallback is trusted.
  const LEGACY_CLIFF_COLORS = new Set(['6a6460', '79807c', '6b5638']); // Used only for old Map Editor/Cutscene preview meshes that carry neither names nor terrain metadata.
  const seenMeshes = new Set(); // Used to invalidate already-rendered terrain when a slider moves.
  const classifiedMeshes = new WeakSet(); // Used to count unique parity surfaces without increasing the count every render frame.
  let revision = 1; // Used to remap each terrain mesh once per authored scale state.
  let installPromise = null; // Used to serialize runtime dependency loading.
  let invalidateFrame = 0; // Used to collapse rapid slider events into one remap per animation frame.
  let mappedPasses = 0; // Used by the mobile-visible parity status readout.
  let uniqueMatches = 0; // Used by the mobile-visible parity status readout.
  let sourceImageWidth = 0; // Used to translate the multiplier into actual world-units-per-source-pixel once the authored PNG finishes loading.
  let sourceImageHeight = 0; // Used with sourceImageWidth for rectangular source textures.

  function clampNumber(value, fallback, min, max) {
    const n = Number(value); // Used to sanitize localStorage and range-input values through one path.
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); // Used as shared unstretched-pixel authoring state across all terrain tools.
      if (saved) {
        return {
          pixelScale: clampNumber(saved.pixelScale, DEFAULT_PIXEL_SCALE, 0.1, 8),
          edge: clampNumber(saved.edge, DEFAULT_EDGE, 0, 0.495),
        };
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY) || 'null'); // Used to convert the earlier full-PNG span into the equivalent pixel-size multiplier.
      if (legacy) {
        return {
          pixelScale: clampNumber(Number(legacy.span) / DEFAULT_SPAN, DEFAULT_PIXEL_SCALE, 0.1, 8),
          edge: clampNumber(legacy.edge, DEFAULT_EDGE, 0, 0.495),
        };
      }
    } catch (_) {}
    return { pixelScale: DEFAULT_PIXEL_SCALE, edge: DEFAULT_EDGE };
  }

  const settings = readSettings(); // Used by every recognized preview cliff/rock surface.
  const nativeSpan = () => DEFAULT_SPAN * settings.pixelScale; // Used to translate direct source-pixel scale into the mapper's backward-compatible one-PNG world span.
  const saveSettings = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {} };

  function ensureScript(relativeUrl, ready) {
    if (ready?.()) return Promise.resolve();
    const src = new URL(relativeUrl, JS_ROOT).href; // Used to deduplicate shared game dependencies regardless of tool nesting depth.
    const existing = Array.from(document.scripts).find(script => script.src === src);
    if (existing) return new Promise(resolve => {
      if (ready?.()) return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 1200);
    });
    return new Promise(resolve => {
      const script = document.createElement('script'); // Used to load the exact game material/UV module rather than another tool-local imitation.
      script.src = src;
      script.async = false;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', resolve, { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function absolutizeSurfaceConfig() {
    const config = window.NaturalSurfaceMaterialConfig; // Used as the same authored natural-surface config consumed by gameplay.
    if (!config || config.__toolTerrainPathsAbsolute) return;
    const absolute = value => {
      const path = String(value || ''); // Used to leave absolute/data/blob URLs untouched while fixing repo-relative texture paths inside nested tools.
      if (!path || /^(?:[a-z]+:|\/)/i.test(path)) return value;
      return new URL('../' + path.replace(/^\.\//, ''), JS_ROOT).href;
    };
    if (config.texture) config.texture = absolute(config.texture);
    for (const surface of Object.values(config.surfaces || {})) if (surface?.texture) surface.texture = absolute(surface.texture);
    Object.defineProperty(config, '__toolTerrainPathsAbsolute', { value: true, configurable: true });
  }

  async function loadRuntimeParity() {
    if (installPromise) return installPromise;
    installPromise = (async () => {
      await ensureScript('../config/natural-surface-materials.js', () => !!window.NaturalSurfaceMaterialConfig);
      absolutizeSurfaceConfig();
      await ensureScript('./natural-surface-materials.js', () => !!window.NaturalSurfaceMaterials?.installed);
      await ensureScript('./surface-stretch-uv-furniture.js', () => !!window.HobunjiSurfaceStretchUV?.installed);
    })();
    return installPromise;
  }

  function materialList(mesh) {
    return Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]; // Used by semantic terrain-key, name, and fallback-color classification.
  }

  function materialHex(material) {
    return material?.color?.isColor ? material.color.getHexString().toLowerCase() : ''; // Used only as the final compatibility fallback for anonymous legacy preview terrain.
  }

  function geometrySteepRatio(geometry) {
    if (!geometry?.getAttribute?.('position')) return 0;
    geometry.userData = geometry.userData || {};
    const cached = Number(geometry.userData.toolTerrainSteepRatio); // Used to avoid recomputing triangle slope classification every render frame.
    if (Number.isFinite(cached)) return cached;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex?.();
    const triangleCount = Math.floor((index?.count ?? position.count) / 3);
    let totalArea = 0;
    let steepArea = 0;
    const vertexIndex = i => index ? index.getX(i) : i;
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const ia = vertexIndex(triangle * 3);
      const ib = vertexIndex(triangle * 3 + 1);
      const ic = vertexIndex(triangle * 3 + 2);
      const ax = position.getX(ib) - position.getX(ia);
      const ay = position.getY(ib) - position.getY(ia);
      const az = position.getZ(ib) - position.getZ(ia);
      const bx = position.getX(ic) - position.getX(ia);
      const by = position.getY(ic) - position.getY(ia);
      const bz = position.getZ(ic) - position.getZ(ia);
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      const twiceArea = Math.hypot(cx, cy, cz);
      if (!(twiceArea > 1e-9)) continue;
      totalArea += twiceArea;
      if (Math.abs(cy) / twiceArea < STEEP_NORMAL_Y_MAX) steepArea += twiceArea;
    }
    const ratio = totalArea > 0 ? steepArea / totalArea : 0;
    geometry.userData.toolTerrainSteepRatio = ratio;
    return ratio;
  }

  function explicitTerrainKey(mesh) {
    const meshKey = String(mesh?.userData?.terrainKey || '').toLowerCase(); // Used first because Wilderness Lab and newer previews already author this exact semantic tag.
    if (meshKey) return meshKey;
    for (const material of materialList(mesh)) {
      const key = String(material?.userData?.terrainKey || '').toLowerCase();
      if (key) return key;
    }
    return '';
  }

  function classify(mesh) {
    if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('position')) return null;
    if (mesh.userData?.naturalSurface === 'cliffs' || mesh.userData?.naturalSurface === 'rocks') {
      return { surface: mesh.userData.naturalSurface, slot: mesh.userData.naturalSurfaceCliffSlot ?? null, reason: 'natural-surface' };
    }
    if (mesh.userData?.naturalSurfaceCliffSlot != null) {
      return { surface: 'cliffs', slot: Number(mesh.userData.naturalSurfaceCliffSlot), reason: 'cliff-slot' };
    }

    const materials = materialList(mesh);
    const materialNames = materials.map(material => material?.name || '').join(' ');
    const label = `${mesh.name || ''} ${materialNames} ${mesh.userData?.type || ''} ${mesh.userData?.kind || ''}`.toLowerCase(); // Used as a compatibility bridge for existing previews that predate semantic terrain metadata.
    const terrainKey = explicitTerrainKey(mesh);
    if (terrainKey === 'cliff') return { surface: 'cliffs', slot: null, reason: 'terrain-key:cliff' };
    if (terrainKey === 'rock' && geometrySteepRatio(mesh.geometry) >= STEEP_RATIO_MIN) return { surface: 'cliffs', slot: null, reason: 'terrain-key:rock-steep' };

    if (/(?:undiggable[_ -]?boulder|boulder[_ -]?shell|rock[_ -]?mound)/.test(label)) return { surface: 'rocks', slot: null, reason: 'named-rock' };
    if (/(?:cliff|plateau[_ -]?side|mesa[_ -]?side|ramp[_ -]?cliff|tier[_ -]?seam|border[_ -]?terrain|escarpment)/.test(label)) return { surface: 'cliffs', slot: null, reason: 'named-cliff' };
    if (/(?:rock[_ -]?formation)/.test(label)) return { surface: 'rocks', slot: null, reason: 'rock-formation' };
    if (/plateau|mesa/.test(label) && Array.isArray(mesh.material) && mesh.material.length > 1) return { surface: 'cliffs', slot: 1, reason: 'named-multimaterial-mesa' };

    const steepRatio = geometrySteepRatio(mesh.geometry); // Used only after stronger semantic/name checks so arbitrary non-terrain meshes never pay the fallback cost unless their material is a known legacy terrain color.
    if (steepRatio >= STEEP_RATIO_MIN && materials.some(material => LEGACY_CLIFF_COLORS.has(materialHex(material)))) {
      return { surface: 'cliffs', slot: null, reason: 'legacy-steep-color' };
    }
    return null;
  }

  function observeSourceImage(material) {
    const texture = material?.map;
    const state = String(texture?.userData?.hobunjiAuthoredSurfaceState || '');
    if (state.startsWith('flat-')) return;
    const image = texture?.image;
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 0);
    if (!(width > 4) || !(height > 4)) return;
    if (width === sourceImageWidth && height === sourceImageHeight) return;
    sourceImageWidth = width; sourceImageHeight = height;
    updatePanelStatus();
  }

  function protectSharedResource(resource) {
    if (!resource || resource.userData?.toolTerrainParityProtected) return resource;
    resource.userData = Object.assign({}, resource.userData, { toolTerrainParityProtected: true });
    if (typeof resource.dispose === 'function') resource.dispose = () => {}; // Used because some preview tools dispose every material/texture on rebuild even though NaturalSurfaceMaterials caches these shared game-parity resources.
    return resource;
  }

  function canonicalMaterial(sourceMaterial, surface) {
    const THREE = window.THREE; // Used to ask the exact game NaturalSurfaceMaterials module for its canonical texture/tint material.
    const natural = window.NaturalSurfaceMaterials;
    if (!THREE || !natural?.naturalizeMesh) return sourceMaterial;
    const scratch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sourceMaterial); // Used only to obtain the game material without mutating a real shared plateau geometry.
    natural.naturalizeMesh(scratch, surface, surface === 'cliffs' ? 'world-stretch' : null);
    const material = protectSharedResource(scratch.material);
    protectSharedResource(material?.map);
    scratch.geometry?.dispose?.();
    return material;
  }

  function mapOptions(mesh, slot) {
    return {
      label: `tool-parity:${mesh.name || 'terrain'}`,
      materialIndex: slot == null ? undefined : Number(slot),
      edgeReferenceWorldSize: nativeSpan(),
      edgeSourceFraction: settings.edge,
    }; // Used to make direct source-pixel scaling drive the same centralized edge-preserving mapper as gameplay.
  }

  function noteMatch(mesh, hit) {
    if (classifiedMeshes.has(mesh)) return;
    classifiedMeshes.add(mesh);
    uniqueMatches++;
    mesh.userData = Object.assign({}, mesh.userData, { toolTerrainParityReason: hit.reason || 'classified' });
    updatePanelStatus();
  }

  function applyMesh(mesh, hit) {
    const mapper = window.HobunjiSurfaceStretchUV;
    const natural = window.NaturalSurfaceMaterials;
    if (!mapper?.installed || !natural?.installed || !hit) return;
    seenMeshes.add(mesh);
    mesh.userData = mesh.userData || {};
    noteMatch(mesh, hit);
    for (const material of materialList(mesh)) observeSourceImage(material);
    if (mesh.userData.toolTerrainParityRevision === revision) return;

    if (hit.slot != null && Array.isArray(mesh.material) && mesh.material[hit.slot]) {
      const slot = Number(hit.slot); // Used to preserve grass/top material and UVs while upgrading only the stone group of a shared plateau mesh.
      if (!mesh.userData.toolTerrainCanonicalCliffMaterial) {
        const materials = mesh.material.slice();
        materials[slot] = canonicalMaterial(materials[slot], hit.surface);
        mesh.material = materials;
        mesh.userData.toolTerrainCanonicalCliffMaterial = true;
      }
      mesh.userData.naturalSurfaceCliffSlot = slot;
      mesh.geometry = mapper.mapGeometry(mesh.geometry, mapOptions(mesh, slot));
    } else {
      if (mesh.userData.naturalSurface !== hit.surface) natural.naturalizeMesh(mesh, hit.surface, hit.surface === 'cliffs' ? 'world-stretch' : null);
      protectSharedResource(Array.isArray(mesh.material) ? null : mesh.material);
      protectSharedResource(!Array.isArray(mesh.material) ? mesh.material?.map : null);
      mesh.geometry = mapper.mapGeometry(mesh.geometry, mapOptions(mesh, null));
      mesh.userData.naturalSurface = hit.surface;
    }
    for (const material of materialList(mesh)) observeSourceImage(material);
    mesh.userData.toolTerrainParityRevision = revision;
    mappedPasses++;
    updatePanelStatus();
  }

  function applyScene(scene) {
    scene?.traverse?.(object => { const hit = classify(object); if (hit) applyMesh(object, hit); }); // Used to upgrade newly created/replaced tool terrain lazily without rewriting each editor's private build function.
  }

  function wrapRenderer() {
    const proto = window.THREE?.WebGLRenderer?.prototype;
    if (!proto || proto.__hobunjiToolTerrainParityWrapped) return;
    const originalRender = proto.render; // Used to run parity immediately before whatever scene the tool already renders.
    proto.render = function (scene, camera) { applyScene(scene); return originalRender.call(this, scene, camera); };
    proto.__hobunjiToolTerrainParityWrapped = true;
  }

  function updatePanelStatus() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const scaleOut = panel.querySelector('[data-out="pixelScale"]');
    const spanOut = panel.querySelector('[data-out="span"]');
    const edgeOut = panel.querySelector('[data-out="edge"]');
    const status = panel.querySelector('[data-role="status"]');
    const pixelUnits = panel.querySelector('[data-role="pixelUnits"]');
    if (scaleOut) scaleOut.textContent = settings.pixelScale.toFixed(2);
    if (spanOut) spanOut.textContent = nativeSpan().toFixed(2);
    if (edgeOut) edgeOut.textContent = Math.round(settings.edge * 100);
    if (status) status.textContent = `${uniqueMatches} terrain surface${uniqueMatches === 1 ? '' : 's'} matched · ${mappedPasses} mapping pass${mappedPasses === 1 ? '' : 'es'}`;
    if (pixelUnits) {
      if (sourceImageWidth > 0 && sourceImageHeight > 0) {
        const ux = nativeSpan() / sourceImageWidth;
        const uy = nativeSpan() / sourceImageHeight;
        pixelUnits.textContent = sourceImageWidth === sourceImageHeight
          ? `${ux.toFixed(4)}u per source pixel (${sourceImageWidth}×${sourceImageHeight})`
          : `${ux.toFixed(4)}u × ${uy.toFixed(4)}u per source pixel (${sourceImageWidth}×${sourceImageHeight})`;
      } else pixelUnits.textContent = 'waiting for authored texture dimensions…';
    }
  }

  function invalidateNow() {
    revision++;
    for (const mesh of seenMeshes) if (mesh?.userData) mesh.userData.toolTerrainParityRevision = 0;
    updatePanelStatus();
    window.dispatchEvent(new Event('resize')); // Used to prod tools that render on resize rather than continuously.
  }
  function invalidate() {
    if (invalidateFrame) return;
    invalidateFrame = requestAnimationFrame(() => { invalidateFrame = 0; invalidateNow(); });
  }

  function injectControls() {
    if (document.getElementById(PANEL_ID) || !window.THREE || !(window.TerrainPreview || window.BorderTerrain)) return;
    const panel = document.createElement('section'); // Used as one mobile-accessible control surface independent of each tool's private sidebar implementation.
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <button type="button" class="tp-title" aria-expanded="true">Live terrain texture parity <span>▾</span></button>
      <div class="tp-body">
        <label>Unstretched pixel scale <output data-out="pixelScale">${settings.pixelScale.toFixed(2)}</output>×<input data-setting="pixelScale" type="range" min="0.25" max="4" step="0.05" value="${settings.pixelScale}"></label>
        <label>Protected source edge <output data-out="edge">${Math.round(settings.edge * 100)}</output>%<input data-setting="edge" type="range" min="0" max="0.4" step="0.01" value="${settings.edge}"></label>
        <div class="tp-note">1× is the current in-game unstretched source-pixel density. At this scale one full PNG spans <output data-out="span">${nativeSpan().toFixed(2)}</output> world units; only the center absorbs extra stretch.</div>
        <div class="tp-pixels" data-role="pixelUnits">waiting for authored texture dimensions…</div>
        <div class="tp-status" data-role="status">0 terrain surfaces matched</div>
        <button type="button" class="tp-reset">Reset gameplay defaults (1× / 16%)</button>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `#${PANEL_ID}{position:fixed;right:10px;bottom:10px;z-index:2147483000;width:min(330px,calc(100vw - 20px));border:1px solid #ffffff38;border-radius:10px;background:#07101aee;color:#edf5ff;font:11px system-ui;box-shadow:0 8px 28px #0007;backdrop-filter:blur(7px)}#${PANEL_ID} button{font:inherit;color:inherit;border:1px solid #6aa7ff59;background:#6aa7ff21;border-radius:7px;cursor:pointer}#${PANEL_ID} .tp-title{width:100%;display:flex;justify-content:space-between;padding:7px 9px;border:0;background:transparent;font-weight:800}#${PANEL_ID} .tp-body{display:grid;gap:7px;padding:0 9px 9px}#${PANEL_ID}[data-collapsed="1"] .tp-body{display:none}#${PANEL_ID} label{display:grid;grid-template-columns:1fr auto auto;gap:4px 6px;align-items:center;color:#dbeafe}#${PANEL_ID} label input{grid-column:1/-1;width:100%;margin:0;accent-color:#6aa7ff}#${PANEL_ID} output{font:700 11px ui-monospace,monospace;color:#fff}#${PANEL_ID} .tp-note{color:#9fb4cf;line-height:1.35}#${PANEL_ID} .tp-pixels{color:#cfe0f3;font:10px ui-monospace,monospace}#${PANEL_ID} .tp-status{color:#79c987;font:10px ui-monospace,monospace}#${PANEL_ID} .tp-reset{justify-self:start;padding:5px 8px}`;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    const title = panel.querySelector('.tp-title');
    title.addEventListener('click', () => {
      const open = panel.dataset.collapsed === '1'; // Used to keep controls unobtrusive over small/mobile preview canvases.
      panel.dataset.collapsed = open ? '0' : '1';
      title.setAttribute('aria-expanded', open ? 'true' : 'false');
      title.querySelector('span').textContent = open ? '▾' : '▸';
    });
    panel.querySelectorAll('input[data-setting]').forEach(input => input.addEventListener('input', () => {
      if (input.dataset.setting === 'pixelScale') settings.pixelScale = clampNumber(input.value, DEFAULT_PIXEL_SCALE, 0.1, 8);
      else settings.edge = clampNumber(input.value, DEFAULT_EDGE, 0, 0.495);
      saveSettings(); updatePanelStatus(); invalidate();
    }));
    panel.querySelector('.tp-reset').addEventListener('click', () => {
      settings.pixelScale = DEFAULT_PIXEL_SCALE; settings.edge = DEFAULT_EDGE;
      panel.querySelector('[data-setting="pixelScale"]').value = settings.pixelScale;
      panel.querySelector('[data-setting="edge"]').value = settings.edge;
      saveSettings(); updatePanelStatus(); invalidate();
    });
    updatePanelStatus();
  }

  function snapshot() {
    return {
      installed: true,
      revision,
      pixelScale: settings.pixelScale,
      edgeSourceFraction: settings.edge,
      nativePngWorldSpan: nativeSpan(),
      uniqueMatches,
      mappedPasses,
      seenMeshes: seenMeshes.size,
      sourceImageWidth,
      sourceImageHeight,
      sourcePixelWorldSizeX: sourceImageWidth > 0 ? nativeSpan() / sourceImageWidth : null,
      sourcePixelWorldSizeY: sourceImageHeight > 0 ? nativeSpan() / sourceImageHeight : null,
      steepNormalYMax: STEEP_NORMAL_Y_MAX,
      steepRatioMin: STEEP_RATIO_MIN,
    };
  }

  async function installInTerrainTool() {
    if (!window.THREE || !(window.TerrainPreview || window.BorderTerrain)) return false;
    await loadRuntimeParity();
    wrapRenderer(); injectControls();
    window.HobunjiToolTerrainParity = { installed: true, snapshot, classify, geometrySteepRatio, invalidate }; // Used by mobile-visible debugging and targeted regression probes without exposing private implementation state.
    return true;
  }

  function injectIntoFrame(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement || doc.getElementById(INJECT_ID)) return;
      const script = doc.createElement('script'); // Used so all same-origin Tool Hub terrain iframes inherit one parity implementation without duplicating edits in large tool pages.
      script.id = INJECT_ID; script.src = SELF_SRC;
      (doc.head || doc.documentElement).appendChild(script);
    } catch (_) {}
  }

  function installHubInjector() {
    if (!/\/tools\/?(?:index\.html)?$/.test(location.pathname)) return;
    const attach = frame => {
      if (!(frame instanceof HTMLIFrameElement) || frame.dataset.terrainParityHooked === '1') return;
      frame.dataset.terrainParityHooked = '1';
      frame.addEventListener('load', () => injectIntoFrame(frame));
      if (frame.contentDocument?.readyState === 'complete') injectIntoFrame(frame);
    };
    document.querySelectorAll('iframe').forEach(attach);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof HTMLIFrameElement) attach(node);
      node.querySelectorAll?.('iframe').forEach(attach);
    }))).observe(document.documentElement, { childList: true, subtree: true });
  }

  function boot() {
    installHubInjector();
    let attempts = 0; // Used to catch tools that load TerrainPreview/BorderTerrain later than panel-ui.js without permanent polling.
    const tryInstall = async () => { if (await installInTerrainTool()) return; if (++attempts < 80) setTimeout(tryInstall, 100); };
    tryInstall();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
