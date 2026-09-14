(() => {
  'use strict';

  if (window.__hobunjiToolTerrainParityBootstrap) return;
  window.__hobunjiToolTerrainParityBootstrap = true;

  const SELF_SRC = document.currentScript?.src || new URL('../js/tool-terrain-preview-parity.js', location.href).href; // Used to resolve the same shared modules from the Tool Hub and nested tool iframes.
  const JS_ROOT = new URL('./', SELF_SRC); // Used as canonical docs/js/ for runtime terrain dependencies.
  const STORE_KEY = 'hobunji:tool-terrain-native-png-scale:v1'; // Used so the same texture-scale experiment follows the user between terrain tools.
  const PANEL_ID = 'hobunjiTerrainParityPanel'; // Used to keep injected controls idempotent.
  const INJECT_ID = 'hobunjiToolTerrainParityInjected'; // Used to keep parent-to-iframe injection idempotent.
  const DEFAULT_SPAN = 6; // Used as the current gameplay-compatible full-PNG world span.
  const DEFAULT_EDGE = 0.16; // Used as the current gameplay-compatible protected source-border fraction.
  const seenMeshes = new Set(); // Used to invalidate already-rendered terrain when a slider moves.
  let revision = 1; // Used to remap each terrain mesh once per authored scale state.
  let installPromise = null; // Used to serialize runtime dependency loading.
  let invalidateFrame = 0; // Used to collapse rapid slider events into one remap per animation frame.

  function clampNumber(value, fallback, min, max) {
    const n = Number(value); // Used to sanitize localStorage and range-input values through one path.
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); // Used as shared native-PNG authoring state across all terrain tools.
      return {
        span: clampNumber(saved?.span, DEFAULT_SPAN, 0.25, 48),
        edge: clampNumber(saved?.edge, DEFAULT_EDGE, 0, 0.495),
      };
    } catch (_) {
      return { span: DEFAULT_SPAN, edge: DEFAULT_EDGE };
    }
  }

  const settings = readSettings(); // Used by every recognized preview cliff/rock surface.
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

  function classify(mesh) {
    if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('position')) return null;
    if (mesh.userData?.naturalSurface === 'cliffs' || mesh.userData?.naturalSurface === 'rocks') {
      return { surface: mesh.userData.naturalSurface, slot: mesh.userData.naturalSurfaceCliffSlot ?? null };
    }
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(mat => mat?.name || '').join(' ');
    const label = `${mesh.name || ''} ${mats} ${mesh.userData?.type || ''} ${mesh.userData?.kind || ''}`.toLowerCase(); // Used as a compatibility bridge for existing previews that predate natural-surface metadata.
    if (/(?:rock[_ -]?formation|undiggable[_ -]?boulder|boulder[_ -]?shell|rock[_ -]?mound)/.test(label)) return { surface: 'rocks', slot: null };
    if (/(?:cliff|plateau[_ -]?side|mesa[_ -]?side|ramp[_ -]?curtain|tier[_ -]?seam|border[_ -]?terrain|escarpment)/.test(label)) return { surface: 'cliffs', slot: null };
    if (/plateau|mesa/.test(label) && Array.isArray(mesh.material) && mesh.material.length > 1) return { surface: 'cliffs', slot: 1 };
    if (mesh.userData?.naturalSurfaceCliffSlot != null) return { surface: 'cliffs', slot: Number(mesh.userData.naturalSurfaceCliffSlot) };
    return null;
  }

  function canonicalMaterial(sourceMaterial, surface) {
    const THREE = window.THREE; // Used to ask the exact game NaturalSurfaceMaterials module for its canonical texture/tint material.
    const natural = window.NaturalSurfaceMaterials;
    if (!THREE || !natural?.naturalizeMesh) return sourceMaterial;
    const scratch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sourceMaterial); // Used only to obtain the game material without mutating a real shared plateau geometry.
    natural.naturalizeMesh(scratch, surface, surface === 'cliffs' ? 'world-stretch' : null);
    const material = scratch.material;
    scratch.geometry?.dispose?.();
    return material;
  }

  function mapOptions(mesh, slot) {
    return {
      label: `tool-parity:${mesh.name || 'terrain'}`,
      materialIndex: slot == null ? undefined : Number(slot),
      edgeReferenceWorldSize: settings.span,
      edgeSourceFraction: settings.edge,
    }; // Used to make the tool controls drive the same centralized edge-preserving mapper as gameplay.
  }

  function applyMesh(mesh, hit) {
    const mapper = window.HobunjiSurfaceStretchUV;
    const natural = window.NaturalSurfaceMaterials;
    if (!mapper?.installed || !natural?.installed || !hit) return;
    seenMeshes.add(mesh);
    mesh.userData = mesh.userData || {};
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
      mesh.geometry = mapper.mapGeometry(mesh.geometry, mapOptions(mesh, null));
      mesh.userData.naturalSurface = hit.surface;
    }
    mesh.userData.toolTerrainParityRevision = revision;
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

  function invalidateNow() {
    revision++;
    for (const mesh of seenMeshes) if (mesh?.userData) mesh.userData.toolTerrainParityRevision = 0;
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
      <button type="button" class="tp-title" aria-expanded="true">Texture stretch parity <span>▾</span></button>
      <div class="tp-body">
        <label>Native full-PNG span <output data-out="span">${settings.span.toFixed(2)}</output>u<input data-setting="span" type="range" min="0.25" max="24" step="0.25" value="${settings.span}"></label>
        <label>Protected source edge <output data-out="edge">${Math.round(settings.edge * 100)}</output>%<input data-setting="edge" type="range" min="0" max="0.4" step="0.01" value="${settings.edge}"></label>
        <div class="tp-note">Uses the game's NaturalSurfaceMaterials + centralized edge-preserving UV mapper. “Native span” is how many world units the entire PNG covers when its pixels are treated as unstretched; the center absorbs extra stretch.</div>
        <button type="button" class="tp-reset">Reset gameplay defaults (6u / 16%)</button>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `#${PANEL_ID}{position:fixed;right:10px;bottom:10px;z-index:2147483000;width:min(320px,calc(100vw - 20px));border:1px solid #ffffff38;border-radius:10px;background:#07101aee;color:#edf5ff;font:11px system-ui;box-shadow:0 8px 28px #0007;backdrop-filter:blur(7px)}#${PANEL_ID} button{font:inherit;color:inherit;border:1px solid #6aa7ff59;background:#6aa7ff21;border-radius:7px;cursor:pointer}#${PANEL_ID} .tp-title{width:100%;display:flex;justify-content:space-between;padding:7px 9px;border:0;background:transparent;font-weight:800}#${PANEL_ID} .tp-body{display:grid;gap:7px;padding:0 9px 9px}#${PANEL_ID}[data-collapsed="1"] .tp-body{display:none}#${PANEL_ID} label{display:grid;grid-template-columns:1fr auto auto;gap:4px 6px;align-items:center;color:#dbeafe}#${PANEL_ID} label input{grid-column:1/-1;width:100%;margin:0;accent-color:#6aa7ff}#${PANEL_ID} output{font:700 11px ui-monospace,monospace;color:#fff}#${PANEL_ID} .tp-note{color:#9fb4cf;line-height:1.35}#${PANEL_ID} .tp-reset{justify-self:start;padding:5px 8px}`;
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
      if (input.dataset.setting === 'span') settings.span = clampNumber(input.value, DEFAULT_SPAN, 0.25, 48);
      else settings.edge = clampNumber(input.value, DEFAULT_EDGE, 0, 0.495);
      panel.querySelector('[data-out="span"]').textContent = settings.span.toFixed(2);
      panel.querySelector('[data-out="edge"]').textContent = Math.round(settings.edge * 100);
      saveSettings(); invalidate();
    }));
    panel.querySelector('.tp-reset').addEventListener('click', () => {
      settings.span = DEFAULT_SPAN; settings.edge = DEFAULT_EDGE;
      panel.querySelector('[data-setting="span"]').value = settings.span;
      panel.querySelector('[data-setting="edge"]').value = settings.edge;
      panel.querySelector('[data-out="span"]').textContent = settings.span.toFixed(2);
      panel.querySelector('[data-out="edge"]').textContent = Math.round(settings.edge * 100);
      saveSettings(); invalidate();
    });
  }

  async function installInTerrainTool() {
    if (!window.THREE || !(window.TerrainPreview || window.BorderTerrain)) return false;
    await loadRuntimeParity();
    wrapRenderer(); injectControls();
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
