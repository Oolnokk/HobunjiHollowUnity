// Geometry Workshop gameplay render/texture adapter.
// The shader and lighting functions are extracted from current game.js via
// EnemyLoadoutSourceData.renderingFromGame; both editors share one source of truth.
// All texture/UV overrides live on disposable DISPLAY clones; GLB exports stay untouched.
(() => {
  'use strict';
  const T = window.THREE;
  const OUTLINE_LAYER = 1; // The same shell-outline layer used in gameplay.
  const DEFAULT_BODY = '#7dc89a'; // Representative body dye for the material preview, adjustable in the workshop.
  const ORIGINAL_BACKGROUND = '#162118'; // Matches the game-facing Enemy Loadout Editor background.
  const STATES = Object.freeze({ noon: 12, sunset: 18.5, night: 22, storm: 12 });
  const MAX_SHADER_BYTES = 50000000; // Prevent accidentally parsing an unexpected huge response.

  function rolesFor(path) {
    const hands = window.HobunjiHandModelProfiles?.data?.models || {};
    const feet = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.species || {};
    for (const model of Object.values(hands)) {
      if (model?.glb === path) return model.materialRoles || {};
    }
    for (const model of Object.values(feet)) {
      if (model?.glb === path) return model.materialRoles || {};
    }
    return {};
  }
  function surfacePath(role) {
    return role === 'bone' ? 'assets/textures/carved_smooth.png'
      : role === 'keratin' ? 'assets/textures/boards.png'
      : 'assets/textures/wavy_surface.png'; // Exact paths selected in both procedural hand and foot rigs.
  }
  function previewableMesh(mesh) {
    if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('normal')) return false;
    if (mesh.userData?.noOutline || mesh.userData?.hobunjiNoOutline ||
      mesh.userData?.facetedSurfaceTextureOutline || mesh.userData?.isPngPlane) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.length) return false;
    return materials.every(material => material && material.visible !== false &&
      !material.isShaderMaterial && !material.isRawShaderMaterial &&
      !material.transparent && !material.alphaTest && material.opacity !== 0);
  }

  function decorate(source, sourcePath, useGameSurfaces, bodyColor) {
    if (!source) return null;
    const display = source.clone(true);
    const ownedGeometries = new Set(); // New UV buffers for display-only body/foot surface mapping.
    const ownedMaterials = new Set(); // Cloned PNG materials can be safely released on re-preview.
    const surfaces = window.NaturalSurfaceMaterials;
    const isRoleModel = /^assets\/models\/(?:hands|feet)\//.test(sourcePath || '');
    const materialRoles = isRoleModel ? rolesFor(sourcePath) : {};
    const roleTreatments = useGameSurfaces && isRoleModel && surfaces?.naturalizeMesh;
    display.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (roleTreatments && mesh.geometry?.getAttribute?.('position')) {
        // The game maps the authored PNG on every hand/foot component; never mutate
        // shared source geometry, source materials, or optimized export materials.
        const geometry = mesh.geometry.clone();
        ownedGeometries.add(geometry);
        mesh.geometry = geometry;
        const originalMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const displayMaterials = originalMaterials.map(material => {
          if (!material || material.isShaderMaterial || material.isRawShaderMaterial) return material;
          const role = materialRoles[material.name] || 'body';
          const color = role === 'bone'
            ? window.HobunjiHandModelProfiles?.data?.colors?.bone || '#D8C7A3'
            : role === 'keratin' ? '#44484D' : bodyColor || DEFAULT_BODY;
          const proxy = new T.Mesh(geometry, material);
          surfaces.naturalizeMesh(proxy, 'trunks', 'cylindrical-stretch', {
            texture: surfacePath(role), tint: color, tintTreatment: 'body-sprite-tint',
          }); // Reuse game's own PNG tint, UV and material construction rather than inventing a second shader.
          const made = proxy.material?.clone?.() || material;
          if (made !== material) ownedMaterials.add(made);
          return made;
        });
        mesh.material = Array.isArray(mesh.material) ? displayMaterials : displayMaterials[0];
      }
      if (previewableMesh(mesh)) mesh.layers.enable(OUTLINE_LAYER);
      else mesh.layers.disable(OUTLINE_LAYER);
    });
    display.userData.workshopDisplayResources = { ownedGeometries, ownedMaterials }; // Preview-only resources, never exported.
    return display;
  }

  function disposeDisplay(scene, display) {
    if (!display) return;
    scene.remove(display);
    const resources = display.userData?.workshopDisplayResources;
    for (const material of resources?.ownedMaterials || []) material.dispose?.();
    for (const geometry of resources?.ownedGeometries || []) geometry.dispose?.();
  }

  function build(renderer, scenes, camera, host, writeStatus) {
    let shaders = null; // Latest parsed game material/lighting factories.
    let shell = null; // Shared read-only shell ShaderMaterial for both viewports.
    let sceneLights = []; // Actual day/weather lights, one set for each scene.
    let lighting = null; // WeatherFX day/sky-tint data used by both viewports.
    let mode = 'noon'; // UI-selected gameplay lighting condition.
    let ready = false; // Whether both viewports can claim game-source render parity.
    let lastError = ''; // Visible diagnostic for mobile users.
    const overlay = document.createElement('canvas'); // Sky tint composited above both viewport halves.
    overlay.className = 'workshop-lighting-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    host.appendChild(overlay);
    const context = overlay.getContext('2d');

    function setMode(value) {
      mode = Object.hasOwn(STATES, value) ? value : 'noon';
      if (!ready) return;
      const weather = window.WeatherFX;
      lighting = weather.lightingStateFor(STATES[mode], {
        isRaining: mode === 'storm', rainStrength: mode === 'storm' ? 3 : 0,
      });
      for (let i = 0; i < scenes.length; i++) {
        const lights = sceneLights[i];
        shaders.applyLighting(scenes[i], lights.ambientLight, lights.sunLight, lighting);
      }
      writeStatus('Gameplay render: ' + mode + ', live game lighting and shell shader loaded.');
    }

    async function init() {
      try {
        const [gameResult, outlineResult] = await Promise.all([
          fetch('game.js'), fetch('config/outline-rendering.json'),
        ]);
        if (!gameResult.ok || !outlineResult.ok) throw Error('Game visual source failed to load: HTTP ' + gameResult.status + '/' + outlineResult.status);
        const game = await gameResult.text();
        if (game.length > MAX_SHADER_BYTES) throw Error('Unexpected game renderer source size.');
        const outline = await outlineResult.json();
        if (!Number.isFinite(outline?.shell?.thicknessNdc)) throw Error('Game outline thickness not available.');
        if (!window.EnemyLoadoutSourceData?.renderingFromGame || !window.WeatherFX?.lightingStateFor) {
          throw Error('Shared game renderer adapter or WeatherFX is unavailable.');
        }
        shaders = window.EnemyLoadoutSourceData.renderingFromGame(game);
        shell = shaders.makeShellMaterial(T);
        shell.uniforms.uThickness.value = outline.shell.thicknessNdc;
        for (const scene of scenes) {
          scene.background = new T.Color(ORIGINAL_BACKGROUND);
          scene.fog = new T.FogExp2(scene.background, 0.018);
          sceneLights.push(shaders.makeLighting(T, scene));
        }
        renderer.outputEncoding = T.LinearEncoding; // game.js and the shared enemy preview use linear r128 output, not forced sRGB.
        renderer.toneMapping = T.NoToneMapping;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;
        ready = true;
        setMode(mode);
      } catch (error) {
        lastError = String(error?.message || error);
        writeStatus('Game rendering unavailable: ' + lastError + '. Source textures still render; lighting/outline comparison is NOT game-accurate.', true);
        // Label fallback explicitly; never leave a black preview or claim parity.
        for (const scene of scenes) scene.add(new T.HemisphereLight(0xffffff, 0x334455, 1));
      }
      return ready;
    }

    function render(rendererWidth, rendererHeight) {
      const half = Math.floor(rendererWidth / 2);
      const regions = [[0,half],[half,rendererWidth-half]];
      const oldAutoClear = renderer.autoClear;
      const oldColor = renderer.autoClearColor, oldDepth = renderer.autoClearDepth;
      const oldStencil = renderer.autoClearStencil;
      const oldLayer = camera.layers.mask;
      renderer.autoClear = false;
      renderer.setScissorTest(true);
      try {
        for (let i = 0; i < scenes.length; i++) {
          const [left, width] = regions[i];
          if (width <= 0) continue;
          const scene = scenes[i];
          renderer.setViewport(left, 0, width, rendererHeight);
          renderer.setScissor(left, 0, width, rendererHeight);
          renderer.clear(true, true, true); // Each half needs an independent color/depth buffer.
          camera.layers.mask = oldLayer;
          renderer.render(scene, camera);
          if (ready && shell) {
            scene.overrideMaterial = shell;
            camera.layers.set(OUTLINE_LAYER);
            renderer.render(scene, camera); // Same inverted-hull shader, composited against the base depth.
            scene.overrideMaterial = null;
            camera.layers.mask = oldLayer;
          }
        }
      } finally {
        for (const scene of scenes) scene.overrideMaterial = null;
        camera.layers.mask = oldLayer;
        renderer.setScissorTest(false);
        renderer.autoClear = oldAutoClear;
        renderer.autoClearColor = oldColor;
        renderer.autoClearDepth = oldDepth;
        renderer.autoClearStencil = oldStencil;
      }
      if (!context) return;
      const cssWidth = host.clientWidth, cssHeight = host.clientHeight;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      const pixelsW = Math.max(1, Math.round(cssWidth * ratio)), pixelsH = Math.max(1, Math.round(cssHeight * ratio));
      if (overlay.width !== pixelsW || overlay.height !== pixelsH) {
        overlay.width = pixelsW; overlay.height = pixelsH;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      if (!ready || !lighting) return;
      for (let i = 0; i < 2; i++) {
        context.save();
        context.beginPath();
        context.rect(i * cssWidth / 2, 0, cssWidth / 2, cssHeight);
        context.clip();
        context.translate(i * cssWidth / 2, 0);
        window.WeatherFX.drawSkyTint(context, cssWidth / 2, cssHeight, lighting);
        context.restore();
      }
    }

    function dispose() {
      shell?.dispose?.();
      overlay.remove();
    }
    return { init, render, setMode, decorate, disposeDisplay, dispose, get ready() { return ready; }, get error() { return lastError; } };
  }

  window.GeometryWorkshopGamePreview = Object.freeze({ build, decorate, disposeDisplay, rolesFor, surfacePath, previewableMesh });
})();
