// Daylight-window runtime: authored furniture surfaces marked `daylightWindow`
// become locally tinted window panes and screen-space daylight apertures inside
// ordinary building interiors. It deliberately reuses the existing WeatherFX
// lighting canvas instead of creating a second interior lighting renderer.
(() => {
  'use strict';

  if (Number(window.DaylightWindowRuntime?.version) >= 3) return;

  const VERSION = 3; // v3 keeps mullions coplanar with the authored frame while preserving the shared construction-time visual root.
  const ROLE = 'daylightWindow'; // Recognized-surface role authored by Furniture + Avatar Author.
  const PREVIEW_TINT = '#dce9f4'; // Neutral daylight shown by authored presets before runtime weather/time tinting.
  const DEFAULT_RADIUS_TILES = 2.8; // Used when an older authored daylight surface has no explicit radius.
  const DEFAULT_STRENGTH = 1; // Used when an older authored daylight surface has no explicit strength.
  const AMBIENT_WINDOW_WEIGHT = 0.32; // Shared documentation/debug value: CloudForestFog's unified room atmosphere deliberately weights windows below real local lights.
  const WINDOW_KEYS = Object.freeze(['simpleWindow', 'crossbarWindow', 'wideWindow']); // First player/dev presets sharing this generic runtime.
  const moduleUrl = typeof document !== 'undefined' && document.currentScript?.src ? document.currentScript.src : ''; // Captured during evaluation so tool pages resolve shared assets from /docs/ rather than their own nested URL.
  const docsBaseUrl = moduleUrl ? new URL('../', moduleUrl) : null; // Base for assets shared by the game and Building Interior Editor.
  const registeredSources = new Set(); // All live pane source descriptors; detached roots are pruned lazily on query.
  const neutralTextureCache = new Map(); // Texture filename -> one grayscale CanvasTexture shared by all matching panes.
  let lightingDeps = null; // Captured from WeatherFX.init so the wrapper can project world-space window centers into the existing overlay.
  let lastOutdoorState = { r: 255, g: 255, b: 255, a: 0 }; // Most recent outdoor time/weather state used by pane tint + debug UI.
  let lastError = null; // Most recent recoverable runtime error, surfaced through mobile-friendly diagnostics.
  let lightingInstallAttempts = 0; // Finite retry counter while CloudForestFog/WeatherFX wrappers settle during boot.
  let mapEditorInstallAttempts = 0; // Finite retry counter while the Map Editor declares its inline DECOR catalog/UI.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0)); // Shared safe alpha/strength clamp.
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback; // Normalizes imported numeric authoring fields.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value)); // Keeps injected preset/metadata objects independent.

  const WINDOW_PARTS = Object.freeze({
    simpleWindow: Object.freeze([
      Object.freeze({ id: 'simple_window_pane', kind: 'box', name: 'Daylight Pane', color: '#dce9f4', materialTexture: 'wavy_surface.png', textureTransparent: true, materialFillEnabled: true, materialFillColor: PREVIEW_TINT, transform: { x: 0, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.76, sy: 0.96, sz: 0.025 } }),
      Object.freeze({ id: 'simple_window_frame_l', kind: 'box', name: 'Left Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: -0.43, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.10, sy: 1.16, sz: 0.08 } }),
      Object.freeze({ id: 'simple_window_frame_r', kind: 'box', name: 'Right Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0.43, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.10, sy: 1.16, sz: 0.08 } }),
      Object.freeze({ id: 'simple_window_frame_t', kind: 'box', name: 'Top Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 1.65, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.76, sy: 0.10, sz: 0.08 } }),
      Object.freeze({ id: 'simple_window_frame_b', kind: 'box', name: 'Bottom Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 0.59, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.76, sy: 0.10, sz: 0.08 } }),
    ]),
    crossbarWindow: Object.freeze([
      Object.freeze({ id: 'crossbar_window_pane', kind: 'box', name: 'Daylight Pane', color: '#dce9f4', materialTexture: 'wavy_surface.png', textureTransparent: true, materialFillEnabled: true, materialFillColor: PREVIEW_TINT, transform: { x: 0, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.90, sy: 1.04, sz: 0.025 } }),
      Object.freeze({ id: 'crossbar_window_frame_l', kind: 'box', name: 'Left Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: -0.50, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.10, sy: 1.24, sz: 0.08 } }),
      Object.freeze({ id: 'crossbar_window_frame_r', kind: 'box', name: 'Right Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0.50, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.10, sy: 1.24, sz: 0.08 } }),
      Object.freeze({ id: 'crossbar_window_frame_t', kind: 'box', name: 'Top Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 1.69, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.90, sy: 0.10, sz: 0.08 } }),
      Object.freeze({ id: 'crossbar_window_frame_b', kind: 'box', name: 'Bottom Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 0.55, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.90, sy: 0.10, sz: 0.08 } }),
      Object.freeze({ id: 'crossbar_window_mullion_v', kind: 'box', name: 'Vertical Mullion', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.055, sy: 1.04, sz: 0.055 } }),
      Object.freeze({ id: 'crossbar_window_mullion_h', kind: 'box', name: 'Horizontal Mullion', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 1.12, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.90, sy: 0.055, sz: 0.055 } }),
    ]),
    wideWindow: Object.freeze([
      Object.freeze({ id: 'wide_window_pane', kind: 'box', name: 'Wide Daylight Pane', color: '#dce9f4', materialTexture: 'wavy_surface.png', textureTransparent: true, materialFillEnabled: true, materialFillColor: PREVIEW_TINT, transform: { x: 0, y: 1.10, z: 0, rx: 0, ry: 0, rz: 0, sx: 1.34, sy: 0.76, sz: 0.025 } }),
      Object.freeze({ id: 'wide_window_frame_l', kind: 'box', name: 'Left Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: -0.72, y: 1.10, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.10, sy: 0.96, sz: 0.08 } }),
      Object.freeze({ id: 'wide_window_frame_r', kind: 'box', name: 'Right Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0.72, y: 1.10, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.10, sy: 0.96, sz: 0.08 } }),
      Object.freeze({ id: 'wide_window_frame_t', kind: 'box', name: 'Top Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 1.53, z: 0, rx: 0, ry: 0, rz: 0, sx: 1.34, sy: 0.10, sz: 0.08 } }),
      Object.freeze({ id: 'wide_window_frame_b', kind: 'box', name: 'Bottom Frame', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0, y: 0.67, z: 0, rx: 0, ry: 0, rz: 0, sx: 1.34, sy: 0.10, sz: 0.08 } }),
      Object.freeze({ id: 'wide_window_mullion_l', kind: 'box', name: 'Left Mullion', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: -0.45, y: 1.10, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.05, sy: 0.76, sz: 0.055 } }),
      Object.freeze({ id: 'wide_window_mullion_r', kind: 'box', name: 'Right Mullion', color: '#6a4c31', materialTexture: 'carved_smooth.png', transform: { x: 0.45, y: 1.10, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.05, sy: 0.76, sz: 0.055 } }),
    ]),
  }); // Fallback recipes mirror the authored JSON presets so cold async loads never show an empty object.

  const FALLBACK_SURFACES = Object.freeze({
    simpleWindow: Object.freeze({ id: 'simple_window_pane:surface:front', partId: 'simple_window_pane', localCentroid: [0, 0, 0.0125], localNormal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], bounds: { minU: -0.38, maxU: 0.38, minV: -0.48, maxV: 0.48 }, role: ROLE, materialTexture: 'wavy_surface.png', textureTransparent: true, materialFillEnabled: true, materialFillColor: PREVIEW_TINT, daylightRadiusTiles: 2.6, daylightStrength: 1 }),
    crossbarWindow: Object.freeze({ id: 'crossbar_window_pane:surface:front', partId: 'crossbar_window_pane', localCentroid: [0, 0, 0.0125], localNormal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], bounds: { minU: -0.45, maxU: 0.45, minV: -0.52, maxV: 0.52 }, role: ROLE, materialTexture: 'wavy_surface.png', textureTransparent: true, materialFillEnabled: true, materialFillColor: PREVIEW_TINT, daylightRadiusTiles: 3.0, daylightStrength: 1 }),
    wideWindow: Object.freeze({ id: 'wide_window_pane:surface:front', partId: 'wide_window_pane', localCentroid: [0, 0, 0.0125], localNormal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], bounds: { minU: -0.67, maxU: 0.67, minV: -0.38, maxV: 0.38 }, role: ROLE, materialTexture: 'wavy_surface.png', textureTransparent: true, materialFillEnabled: true, materialFillColor: PREVIEW_TINT, daylightRadiusTiles: 3.6, daylightStrength: 1 }),
  }); // Used by the procedural fallback and static tests; normal authored furniture consumes recognizedSurfaces from JSON.

  function currentOutdoorLighting() {
    const base = window.HobunjiSkyDome?.getLightingState?.() || window.WeatherFX?.getLightingState?.() || { r: 255, g: 255, b: 255, a: 0 }; // Same authority used by the game's shared day/night overlay.
    const lunarAddition = finite(window.CloudForestFog?.getDebugState?.()?.lunarDarknessAddition, 0); // Mirrors the full-day overlay's additional new-moon darkness without duplicating lunar math.
    lastOutdoorState = {
      r: Math.max(0, Math.min(255, finite(base.r, 255))),
      g: Math.max(0, Math.min(255, finite(base.g, 255))),
      b: Math.max(0, Math.min(255, finite(base.b, 255))),
      a: clamp01(finite(base.a, 0) + lunarAddition),
    };
    return lastOutdoorState;
  }

  function neutralTextureFor(filename) {
    const key = String(filename || '').trim(); // Cache key is the author-facing texture filename used by furniture surfaces.
    if (!key || !window.THREE?.CanvasTexture || typeof document === 'undefined') return null;
    if (neutralTextureCache.has(key)) return neutralTextureCache.get(key);
    const canvas = document.createElement('canvas'); // One mutable canvas backs the shared grayscale texture while its image loads.
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); // Used once to apply the editor's existing shade-preserving fill algorithm.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    const texture = new window.THREE.CanvasTexture(canvas); // Material color later supplies live outdoor RGB, so the texture itself remains neutral.
    texture.needsUpdate = true;
    neutralTextureCache.set(key, texture);
    const image = new Image(); // Shared furniture texture loader; failures leave a harmless white fallback.
    image.crossOrigin = 'anonymous'; // Must be set before src because the image is read with getImageData and uploaded as a CanvasTexture.
    image.onload = () => {
      try {
        canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
        canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); // Runtime mirror of Furniture Author's material fill operation.
        for (let i = 0; i < pixels.data.length; i += 4) {
          const neutral = (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / (255 * 3); // Existing fill method preserves authored light/dark texture detail.
          const shade = Math.round(255 * neutral); // Used for all RGB channels; alpha remains untouched.
          pixels.data[i] = shade;
          pixels.data[i + 1] = shade;
          pixels.data[i + 2] = shade;
        }
        ctx.putImageData(pixels, 0, 0);
        texture.needsUpdate = true;
      } catch (error) { lastError = `window texture ${key}: ${error?.message || error}`; }
    };
    image.onerror = () => { lastError = `window texture failed to load: ${key}`; };
    image.src = docsBaseUrl
      ? new URL(`assets/textures/${key.replace(/^.*\//, '')}`, docsBaseUrl).href
      : `assets/textures/${key.replace(/^.*\//, '')}`;
    return texture;
  }

  function vector3(values, fallback = [0, 0, 0]) {
    const source = Array.isArray(values) ? values : fallback; // Normalizes authoring triples before Three vector construction.
    return new window.THREE.Vector3(finite(source[0]), finite(source[1]), finite(source[2]));
  }

  function windowSurfaceCenter(surface) {
    const bounds = surface?.bounds || {}; // Recognized-surface bounds describe the same local U/V frame used by decals.
    const basisU = vector3(surface?.basisU, [1, 0, 0]).normalize(); // Pane-local horizontal axis.
    const basisV = vector3(surface?.basisV, [0, 1, 0]).normalize(); // Pane-local vertical axis.
    const normal = vector3(surface?.localNormal, [0, 0, 1]).normalize(); // Pane outward normal used for tiny z-fight lift.
    const centroid = vector3(surface?.localCentroid); // Supplies the plane's position along its normal.
    const centerU = (finite(bounds.minU) + finite(bounds.maxU)) * 0.5; // Geometric center along U.
    const centerV = (finite(bounds.minV) + finite(bounds.maxV)) * 0.5; // Geometric center along V.
    const center = basisU.clone().multiplyScalar(centerU).addScaledVector(basisV, centerV).addScaledVector(normal, centroid.dot(normal)); // Exact same recognized-surface center reconstruction as furniture decals.
    return { center, basisU, basisV, normal };
  }

  function ensureWindowVisualRoot(group) {
    const THREE = window.THREE; // Uses the active renderer's Three instance so the hierarchy is shared by authored and procedural windows.
    if (!THREE?.Group || !group?.add) return null;
    group.userData ||= {};
    let visualRoot = group.userData.daylightWindowVisualRoot; // Stable boundary for pane, frame, mullions, nested overlays, and any authored animation pivots.
    if (!visualRoot) {
      visualRoot = new THREE.Group(); // Created while the furniture graph is still unscaled, so reparenting cannot inherit an already-applied farmhouse transform.
      visualRoot.name = 'DaylightWindowVisualRoot';
      group.add(visualRoot);
      group.userData.daylightWindowVisualRoot = visualRoot;
    }
    const directVisuals = Array.from(group.children || []).filter(child => child !== visualRoot); // Captures the complete builder graph rather than assuming meshById entries stay direct children forever.
    directVisuals.forEach(child => visualRoot.add(child));
    group.userData.daylightWindowVisualRootPartCount = group.userData.meshById?.size || 0; // Mobile/debuggable proof that every authored part belongs to the shared window assembly.
    return visualRoot;
  }

  function attachDaylightSurfaces(group, data) {
    const THREE = window.THREE; // Runtime pane overlay uses the page's active Three instance.
    if (!THREE?.PlaneGeometry || !group?.userData?.meshById) return group;
    const surfaces = (data?.recognizedSurfaces || []).filter(surface => surface?.role === ROLE); // Any authored furniture can become a window without a furniture-key special case.
    if (!surfaces.length) return group;
    const descriptors = []; // Stored on the group for diagnostics and later pruning.
    for (const surface of surfaces) {
      const partMesh = group.userData.meshById.get(surface.partId); // Surface plane must inherit the owning authored primitive transform.
      if (!partMesh) continue;
      const bounds = surface.bounds || {}; // Used to size the pane overlay to the actual marked recognized surface.
      const width = Math.max(0.001, finite(bounds.maxU) - finite(bounds.minU)); // Pane width in furniture-local units.
      const height = Math.max(0.001, finite(bounds.maxV) - finite(bounds.minV)); // Pane height in furniture-local units.
      const frame = windowSurfaceCenter(surface); // Reuses recognized local U/V/normal metadata.
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: neutralTextureFor(surface.materialTexture),
        transparent: true,
        opacity: surface.textureTransparent === false ? 1 : 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
        alphaTest: 0.001,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }); // Basic material intentionally ignores interior lamps; its color is the current outdoor light itself.
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material); // Runtime overlay visually replaces the marked surface with live outdoor tint.
      pane.name = `DaylightWindowSurface:${surface.id || surface.partId}`;
      pane.castShadow = false;
      pane.receiveShadow = false;
      pane.raycast = () => {}; // The wall/furniture mesh remains the placement target instead of this cosmetic overlay.
      pane.position.copy(frame.center).addScaledVector(frame.normal, 0.002);
      const basis = new THREE.Matrix4().makeBasis(frame.basisU, frame.basisV, frame.normal); // Aligns PlaneGeometry with the authoring surface frame.
      pane.quaternion.setFromRotationMatrix(basis);
      partMesh.add(pane);
      const descriptor = {
        mesh: pane,
        surfaceId: surface.id || null,
        furnitureKey: data?.key || data?.id || null,
        radiusTiles: Math.max(0.25, finite(surface.daylightRadiusTiles, DEFAULT_RADIUS_TILES)),
        strength: clamp01(surface.daylightStrength == null ? DEFAULT_STRENGTH : surface.daylightStrength),
      }; // Lighting pass reads only these small stable fields plus live world position.
      pane.userData.daylightWindowSource = descriptor;
      descriptors.push(descriptor);
      registeredSources.add(descriptor);
    }
    group.userData.daylightWindowSources = descriptors;
    group.userData.daylightWindowCount = descriptors.length;
    updatePaneTint(currentOutdoorLighting());
    return group;
  }

  function rootOf(object) {
    let node = object; // Used to distinguish a live scene-attached pane from stale furniture detached during scene rebuilds.
    while (node?.parent) node = node.parent;
    return node || null;
  }

  function getActiveSources(activeScene = null) {
    const output = []; // Returned in stable registration order for deterministic debug readouts.
    for (const source of [...registeredSources]) {
      const root = rootOf(source.mesh); // A detached authored group ends at a non-Scene root and can be forgotten permanently.
      if (!root?.isScene) { registeredSources.delete(source); continue; }
      if (activeScene && root !== activeScene) continue;
      if (!source.mesh.visible || !source.mesh.parent) continue;
      output.push(source);
    }
    return output;
  }

  function updatePaneTint(state = currentOutdoorLighting()) {
    const THREE = window.THREE; // Color setter uses the active Three implementation.
    if (!THREE?.Color) return;
    const tint = new THREE.Color(clamp01(state.r / 255), clamp01(state.g / 255), clamp01(state.b / 255)); // Same RGB tint currently applied by the outdoor lighting overlay.
    for (const source of registeredSources) {
      const material = source.mesh?.material; // Each pane owns a material so opacity/debug can vary independently later.
      if (material?.color) { material.color.copy(tint); material.needsUpdate = true; }
    }
  }

  function isOrdinaryBuildingInterior(area) {
    return area === 'interior' || !!lightingDeps?._isBuildingArea?.(area); // Deliberately excludes mines/dens/caverns; those retain their authored underground darkness rules.
  }

  function drawDaylightWindows() {
    if (!isOrdinaryBuildingInterior(lightingDeps?.getCurrentArea?.())) return false;
    updatePaneTint(currentOutdoorLighting()); // Room lighting itself is now composed once by CloudForestFog from all nearby source colors.
    return true;
  }

  function drawAtmosphere() {
    try {
      drawDaylightWindows(); // Unified lighting calls this after enclosed darkness but before any real local-light masks.
      return true;
    } catch (error) {
      lastError = `daylight atmosphere: ${error?.message || error}`; // Mobile diagnostics retain compositor failures without breaking the rest of the lighting pass.
      return false;
    }
  }

  function patchWeatherFx(api) {
    if (!api) return false;
    if (typeof api.init === 'function' && !api.init.__daylightWindowInitWrapped) {
      const originalInit = api.init.bind(api); // Captures the same injected overlay/camera helpers consumed by the unified CloudForestFog lighting pass.
      const wrappedInit = function daylightWindowWeatherInit(injected, ...rest) {
        lightingDeps = injected; // Stored once; the unified compositor hook later uses these exact live references.
        return originalInit(injected, ...rest);
      };
      wrappedInit.__daylightWindowInitWrapped = true;
      api.init = wrappedInit;
    }
    return !!api.init?.__daylightWindowInitWrapped;
  }

  function installLightingPatch() {
    lightingInstallAttempts += 1; // Finite retries handle CloudForestFog replacing the outer WeatherFX init wrapper shortly after this companion loads.
    const ready = patchWeatherFx(window.WeatherFX);
    if (!ready && lightingInstallAttempts < 40) window.setTimeout(installLightingPatch, 100);
  }

  function syntheticData(key) {
    const surface = FALLBACK_SURFACES[key]; // Procedural cold-load fallback still registers exactly one daylight source.
    return surface ? { key, recognizedSurfaces: [clone(surface)] } : null;
  }

  function buildWindowFallback(api, key, baseColor) {
    const THREE = window.THREE; // Uses the shared procedural part builder so textures/outlines behave like ordinary furniture.
    const parts = WINDOW_PARTS[key];
    if (!THREE?.Group || !parts || !api?.buildPartMesh) return null;
    const group = new THREE.Group(); // Local origin remains footprint center at floor level, matching ordinary decor placement.
    group.name = `procedural_furniture_${key}`;
    group.userData.meshById = new Map(); // Daylight surface attachment uses the same authored-runtime lookup contract.
    for (const part of parts) {
      const mesh = api.buildPartMesh(clone(part), baseColor); // Reuses existing material texture handling and part transforms.
      if (!mesh) continue;
      group.add(mesh);
      group.userData.meshById.set(part.id, mesh);
    }
    ensureWindowVisualRoot(group); // Establish the shared pane/frame/mullion boundary before cosmetic daylight children are attached.
    attachDaylightSurfaces(group, syntheticData(key));
    return group;
  }

  function patchProceduralFurniture(api) {
    if (!api || api.__daylightWindowPatched || typeof api.buildFurnitureGroup !== 'function') return;
    const originalBuild = api.buildFurnitureGroup.bind(api); // Preserves wall-torch and every existing furniture wrapper before this extension.
    api.buildFurnitureGroup = function daylightWindowBuildFurnitureGroup(key, baseColor) {
      if (WINDOW_KEYS.includes(key)) return buildWindowFallback(api, key, baseColor) || originalBuild(key, baseColor);
      return originalBuild(key, baseColor);
    };
    api.__daylightWindowPatched = true;
  }

  function patchAuthoredFurniture(api) {
    if (!api || api.__daylightWindowPatched || typeof api.buildGroup !== 'function') return;
    const originalBuild = api.buildGroup.bind(api); // Decals/piece animation wrappers already installed remain inside this call chain.
    api.buildGroup = function daylightWindowAuthoredGroup(data, baseColor) {
      const group = originalBuild(data, baseColor);
      if (WINDOW_KEYS.includes(String(data?.key || data?.id || ''))) ensureWindowVisualRoot(group); // Keep all authored pieces under one stable boundary before linkage applies any exterior scale.
      return attachDaylightSurfaces(group, data);
    };
    api.__daylightWindowPatched = true;
  }

  function registerDecorDefs(defs) {
    if (!defs || typeof defs !== 'object') return;
    const entries = {
      simpleWindow: { itemKey: 'simpleWindowFurniture', name: 'Simple Window', icon: '🪟', color: 0x7f6648, fw: 1, fd: 1, area: 'any', procKey: 'simpleWindow', wallOrnament: true, wallOrnamentSourceKey: 'simpleWindow' },
      crossbarWindow: { itemKey: 'crossbarWindowFurniture', name: 'Crossbar Window', icon: '🪟', color: 0x7f6648, fw: 1, fd: 1, area: 'any', procKey: 'crossbarWindow', wallOrnament: true, wallOrnamentSourceKey: 'crossbarWindow', playerFurnitureDisabled: true }, // Retained for old saves/dev authoring, but hidden from normal player furniture placement.
      wideWindow: { itemKey: 'wideWindowFurniture', name: 'Wide Window', icon: '🪟', color: 0x7f6648, fw: 2, fd: 1, area: 'any', procKey: 'wideWindow', wallOrnament: true, wallOrnamentSourceKey: 'wideWindow' },
    }; // Standard decorative definitions make windows inventory-placeable and automatically wall-capable through the existing wall API's def flag.
    for (const [key, definition] of Object.entries(entries)) if (!defs[key]) defs[key] = definition;
  }

  function patchFarmEditor(api) {
    if (!api || api.__daylightWindowPatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Captures the same decorative registry FarmEditor passes into ordinary restoration/placement.
    api.init = function daylightWindowFarmInit(injected, ...rest) {
      registerDecorDefs(injected?.DECORATIVE_FURNITURE_DEFS);
      return originalInit(injected, ...rest);
    };
    api.__daylightWindowPatched = true;
  }

  function patchFurniturePlacer(api) {
    if (!api || api.__daylightWindowPatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Ensures the inventory catalog sees window definitions before first render.
    api.init = function daylightWindowPlacerInit(injected, ...rest) {
      registerDecorDefs(injected?.getDecorativeFurnitureDefs?.());
      const result = originalInit(injected, ...rest);
      const originalRender = api.render?.bind(api); // Readout is injected only after the normal furniture list has rendered.
      if (originalRender && !api.render.__daylightWindowWrapped) {
        const wrappedRender = function daylightWindowPlacerRender(...renderArgs) {
          const renderResult = originalRender(...renderArgs);
          const list = document.getElementById('furniturePlacerList'); // Mobile-visible status avoids requiring browser console/devtools.
          if (list && registeredSources.size) {
            let readout = document.getElementById('daylightWindowRuntimeReadout'); // Reused across panel rerenders.
            if (!readout) { readout = document.createElement('div'); readout.id = 'daylightWindowRuntimeReadout'; readout.className = 'farm-note'; list.prepend(readout); }
            const state = currentOutdoorLighting(); // Shows the exact tint currently driving window panes/daylight.
            readout.textContent = `Windows: ${getActiveSources().length} live · outdoor rgb ${Math.round(state.r)},${Math.round(state.g)},${Math.round(state.b)} · darkness ${state.a.toFixed(2)}`;
          }
          return renderResult;
        };
        wrappedRender.__daylightWindowWrapped = true;
        api.render = wrappedRender;
      }
      return result;
    };
    api.__daylightWindowPatched = true;
  }

  function futureGlobal(name, patch) {
    if (window[name]) patch(window[name]);
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Chains cleanly with the existing wall-ornament future-global wrappers.
    if (descriptor && descriptor.configurable === false) return;
    const previousGet = descriptor?.get; // Preserves earlier lazy integration getter.
    const previousSet = descriptor?.set; // Preserves earlier lazy integration setter.
    let value = descriptor?.value; // Backing value for an ordinary global assignment.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        patch(previousGet ? previousGet.call(window) : (previousSet ? next : value));
      },
    });
  }

  function installMapEditorCatalog() {
    mapEditorInstallAttempts += 1; // Map Editor declares DECOR and Wall Ornament UI after shared scripts in its head.
    if (typeof document === 'undefined' || !/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;
    try {
      if (typeof DECOR !== 'undefined') {
        DECOR.simpleWindow ||= { icon: '🪟', label: 'Simple Window', fw: 1, fd: 1, area: 'any', wallOrnament: true };
        DECOR.crossbarWindow ||= { icon: '🪟', label: 'Crossbar Window', fw: 1, fd: 1, area: 'any', wallOrnament: true };
        DECOR.wideWindow ||= { icon: '🪟', label: 'Wide Window', fw: 2, fd: 1, area: 'any', wallOrnament: true };
      }
      const select = document.getElementById('wallOrnamentMapPreset'); // Existing dev wall-placement mode remains the single placement UX for signs, torches, and windows.
      if (select) {
        for (const [value, label] of [['simpleWindow','Simple Window'],['crossbarWindow','Crossbar Window'],['wideWindow','Wide Window']]) {
          if (!select.querySelector(`option[value="${value}"]`)) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option); }
        }
        return;
      }
    } catch (error) { lastError = `map window catalog: ${error?.message || error}`; }
    if (mapEditorInstallAttempts < 150) window.setTimeout(installMapEditorCatalog, 100);
  }

  function debugSnapshot() {
    const state = currentOutdoorLighting(); // Snapshot uses current rather than stale tint for mobile copy/debug tools.
    return {
      version: VERSION,
      role: ROLE,
      registered: registeredSources.size,
      active: getActiveSources(lightingDeps?.getActiveScene?.()).map(source => ({ furnitureKey: source.furnitureKey, surfaceId: source.surfaceId, radiusTiles: source.radiusTiles, strength: source.strength })),
      outdoorLighting: { ...state },
      lightingReady: !!lightingDeps,
      compositorHookReady: !!window.WeatherFX?.__daylightWindowAtmosphereHook,
      lastError,
    };
  }

  window.DaylightWindowRuntime = Object.freeze({
    version: VERSION,
    role: ROLE,
    attachDaylightSurfaces,
    getActiveSources,
    currentOutdoorLighting,
    updatePaneTint,
    drawAtmosphere,
    registerDecorDefs,
    debugSnapshot,
    __test: Object.freeze({ WINDOW_KEYS, WINDOW_PARTS, FALLBACK_SURFACES, AMBIENT_WINDOW_WEIGHT, isOrdinaryBuildingInterior, ensureWindowVisualRoot }),
  });
  window.__daylightWindowDebug = debugSnapshot;

  futureGlobal('ProceduralFurniture', patchProceduralFurniture);
  futureGlobal('AuthoredFurniture', patchAuthoredFurniture);
  futureGlobal('FarmEditor', patchFarmEditor);
  futureGlobal('FurniturePlacer', patchFurniturePlacer);
  installLightingPatch();
  if (typeof document !== 'undefined' && /\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) window.setTimeout(installMapEditorCatalog, 0);
})();
