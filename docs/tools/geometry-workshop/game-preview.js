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
  function surfacePath(role, sourcePath = '') {
    if (role === 'bone') return 'assets/textures/carved_smooth.png';
    if (role === 'keratin') return /\/feet\//.test(sourcePath) ? 'assets/textures/boards.png' : null;
    return 'assets/textures/wavy_surface.png'; // Hand keratin is untextured; foot keratin uses boards.png in gameplay.
  }
  function stretchFitUvs(geometry) {
    // Exact biggest-two-axes stretch-fit contract in procedural-hand-attachments and
    // procedural-leg-animation. Operates solely on a preview-owned geometry clone.
    const position = geometry?.getAttribute?.('position');
    if (!position?.count || !position.getX || !geometry.computeBoundingBox) return false;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return false;
    const axes = [
      { key: 'x', min: box.min.x, size: Math.max(1e-6, box.max.x - box.min.x) },
      { key: 'y', min: box.min.y, size: Math.max(1e-6, box.max.y - box.min.y) },
      { key: 'z', min: box.min.z, size: Math.max(1e-6, box.max.z - box.min.z) },
    ].sort((a, b) => b.size - a.size);
    const uAxis = axes[0], vAxis = axes[1];
    const read = (axis, i) => axis.key === 'x' ? position.getX(i) : axis.key === 'y' ? position.getY(i) : position.getZ(i);
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uv[i * 2] = Math.max(0, Math.min(1, (read(uAxis, i) - uAxis.min) / uAxis.size));
      uv[i * 2 + 1] = Math.max(0, Math.min(1, (read(vAxis, i) - vAxis.min) / vAxis.size));
    }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geometry.userData = { ...(geometry.userData || {}), hobunjiStretchFitUvAxes: uAxis.key + vAxis.key };
    return true;
  }
  function previewableMesh(mesh) {
    if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('normal')) return false;
    if (mesh.userData?.noOutline || mesh.userData?.hobunjiNoOutline ||
      mesh.userData?.facetedSurfaceTextureOutline || mesh.userData?.isPngPlane) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.length) return false;
    const isCharacterSolid = mesh.userData?.workshopHandFoot === true; // Game registers true 3D hands/feet on layer 1 even with cutout materials.
    return materials.every(material => material && material.visible !== false &&
      !material.isShaderMaterial && !material.isRawShaderMaterial &&
      (isCharacterSolid || (!material.transparent && !material.alphaTest)) && material.opacity !== 0);
  }

  function decorate(source, sourcePath, useGameSurfaces, bodyColor, options = {}) {
    if (!source) return null;
    const display = source.clone(true);
    const ownedGeometries = new Set(); // New UV buffers for display-only body/foot surface mapping.
    const ownedMaterials = new Set(); // Cloned PNG materials can be safely released on re-preview.
    const wireframes = []; // Paired edge overlays expose real topology without changing either export mesh.
    const MAX_WIREFRAME_TRIANGLES = 40000; // Keep edge inspection fast even on mobile GPU drivers.
    let wireTriangleCount = 0; // Total triangles considered for the optional visual wireframe.
    const surfaces = window.NaturalSurfaceMaterials;
    const isRoleModel = /^assets\/models\/(?:hands|feet)\//.test(sourcePath || '');
    const materialRoles = isRoleModel ? rolesFor(sourcePath) : {};
    const roleTreatments = useGameSurfaces && isRoleModel && surfaces?.naturalizeMesh;
    display.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (isRoleModel) mesh.userData.workshopHandFoot = true; // Display-only outline eligibility, matching character rig registration.
      if (roleTreatments && mesh.geometry?.getAttribute?.('position')) {
        // The game maps the authored PNG on every hand/foot component; never mutate
        // shared source geometry, source materials, or optimized export materials.
        const geometry = mesh.geometry.clone();
        ownedGeometries.add(geometry);
        mesh.geometry = geometry;
        stretchFitUvs(geometry); // Runtime 3D hand/foot PNG projection, without touching source geometry.
        const originalMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const displayMaterials = originalMaterials.map(material => {
          if (!material || material.isShaderMaterial || material.isRawShaderMaterial) return material;
          const role = materialRoles[material.name] || 'body';
          const color = role === 'bone'
            ? window.HobunjiHandModelProfiles?.data?.colors?.bone || '#D8C7A3'
            : role === 'keratin' ? '#44484D' : bodyColor || DEFAULT_BODY;
          let made;
          const texture = surfacePath(role, sourcePath);
          if (!texture) {
            // The parrot's hand keratin uses the game's flat unlit color; only
            // feet use the authored boards PNG for keratin-role materials.
            made = new T.MeshBasicMaterial({ color, side: material.side, name: material.name });
          } else {
            const proxy = new T.Mesh(geometry, material);
            surfaces.naturalizeMesh(proxy, 'trunks', 'authored-stretch-fit', {
              texture, tint: color, tintTreatment: 'body-sprite-tint',
            }); // Use runtime PNG material creation but preserve the actual hand/foot UV projection.
            made = proxy.material?.clone?.() || material;
          }
          if (made !== material) ownedMaterials.add(made);
          return made;
        });
        mesh.material = Array.isArray(mesh.material) ? displayMaterials : displayMaterials[0];
      }
      if (/^assets\/models\/trees\//.test(sourcePath || '')) {
        // TreeAssetLibrary.demoteSpecularBarkMaterial makes loaded untextured
        // GLB bark non-metallic/rough in gameplay (glTF r128's Lambert export
        // otherwise becomes shiny StandardMaterial). Keep this display-only.
        const normalizeBark = material => {
          if (!material?.isMeshStandardMaterial || material.map) return material;
          const copy = material.clone();
          copy.metalness = 0;
          copy.roughness = 1;
          ownedMaterials.add(copy);
          return copy;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(normalizeBark) : normalizeBark(mesh.material);
      }
      if (previewableMesh(mesh)) mesh.layers.enable(OUTLINE_LAYER);
      else mesh.layers.disable(OUTLINE_LAYER);
      if (options.wireframe) wireframes.push(mesh);
    });
    if (options.wireframe) {
      // Add line topology after traversal. Edges are never exported, and they
      // remain layer 0 so the game's shell ShaderMaterial never inflates them.
      for (const mesh of wireframes) {
        const triangles = Math.floor((mesh.geometry?.index?.count ?? mesh.geometry?.getAttribute?.('position')?.count ?? 0) / 3);
        if (!triangles || wireTriangleCount + triangles > MAX_WIREFRAME_TRIANGLES) continue;
        wireTriangleCount += triangles;
        const geometry = new T.WireframeGeometry(mesh.geometry);
        const material = new T.LineBasicMaterial({
          color: options.isCandidate ? 0xffbd65 : 0x66dafa,
          opacity: 0.82, transparent: true, depthTest: true, depthWrite: false,
        });
        const edges = new T.LineSegments(geometry, material);
        edges.name = 'workshop_triangle_edges';
        edges.layers.set(0);
        edges.renderOrder = 1; // Draw after the filled surface for clear triangle comparisons.
        mesh.add(edges);
        ownedGeometries.add(geometry);
        ownedMaterials.add(material);
      }
    }
    display.userData.workshopWireframeTriangles = wireTriangleCount; // On-screen verification of actually drawn overlay geometry.
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

  function inspectMeshIntegrity(root) {
    // On-demand, non-destructive topology check. Weld only coincident POSITIONs
    // within each mesh for connectivity; preserve original normals/UVs/GLB bytes.
    const result = { meshes: 0, triangles: 0, components: 0, boundaryEdges: 0, nonManifoldEdges: 0, skipped: 0 };
    if (!root?.traverse) return result;
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry, position = geometry?.getAttribute?.('position');
      if (!position?.count || typeof position.getX !== 'function') return;
      const index = geometry.getIndex?.() || geometry.index;
      const indexCount = index?.count ?? position.count;
      const faces = Math.floor(indexCount / 3);
      result.meshes++;
      result.triangles += faces;
      if (!faces) return;
      if (faces > 250000) { result.skipped++; return; } // Avoid blocking mobile UI for huge procedural environments.
      const weld = new Map(); // Rounded, coincident local positions identify shared surface edges despite normal seams.
      const vertexIds = new Map(); // Source vertex index -> welded vertex index.
      const parent = []; // Union-find tracks genuine disconnected surface components.
      const edgeCounts = new Map(); // Undirected edge incidence determines missing/open vs manifold edges.
      const getVertex = originalIndex => {
        if (vertexIds.has(originalIndex)) return vertexIds.get(originalIndex);
        const key = [position.getX(originalIndex), position.getY(originalIndex), position.getZ(originalIndex)]
          .map(n => Math.round(n * 100000)).join(',');
        if (!weld.has(key)) { const id = weld.size; weld.set(key, id); parent.push(id); }
        const id = weld.get(key);
        vertexIds.set(originalIndex, id);
        return id;
      };
      const find = node => {
        while (parent[node] !== node) { parent[node] = parent[parent[node]]; node = parent[node]; }
        return node;
      };
      const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
      const edge = (a, b) => {
        const key = a < b ? a + ':' + b : b + ':' + a;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      };
      for (let i = 0; i < faces * 3; i += 3) {
        const a = getVertex(index ? index.getX(i) : i);
        const b = getVertex(index ? index.getX(i + 1) : i + 1);
        const c = getVertex(index ? index.getX(i + 2) : i + 2);
        if (a === b || b === c || a === c) continue;
        union(a, b); union(a, c);
        edge(a, b); edge(b, c); edge(c, a);
      }
      result.components += new Set(parent.map((_, i) => find(i))).size;
      for (const count of edgeCounts.values()) {
        if (count === 1) result.boundaryEdges++;
        else if (count > 2) result.nonManifoldEdges++;
      }
    });
    return result;
  }
  function topologyDescription(stats) {
    const count = stats.triangles.toLocaleString();
    if (stats.skipped) return 'Topology: ' + count + ' triangles; ' + stats.skipped + ' very large mesh(es) skipped.';
    const status = stats.boundaryEdges === 0 && stats.nonManifoldEdges === 0
      ? 'All inspected surfaces are closed; no missing polygon faces.'
      : 'Open/nonmanifold edges found; inspect model geometry before export.';
    return 'Mesh integrity: ' + count + ' triangles · ' + stats.components +
      ' separate component(s) · ' + stats.boundaryEdges + ' open boundary edges · ' +
      stats.nonManifoldEdges + ' nonmanifold edges. ' + status +
      (stats.components > 1 ? ' Separate closed parts can still leave physical gaps at their intersections.' : '');
  }
  function build(renderer, scenes, camera, host, writeStatus) {
    let shaders = null; // Latest parsed game material/lighting factories.
    let shell = null; // Shared read-only shell ShaderMaterial for both viewports.
    let sceneLights = []; // Actual day/weather lights, one set for each scene.
    let lighting = null; // WeatherFX day/sky-tint data used by both viewports.
    let mode = 'noon'; // UI-selected gameplay lighting condition.
    let ready = false; // Whether both viewports can claim game-source render parity.
    let shellEnabled = true; // Preview-only outline visibility toggle for comparing solid surfaces against shell rendering.
    let lastError = ''; // Visible diagnostic for mobile users.
    const overlay = document.createElement('canvas'); // Sky tint composited above both viewport halves.
    overlay.className = 'workshop-lighting-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    host.appendChild(overlay);
    const context = overlay.getContext('2d');

    function setShellEnabled(value) {
      shellEnabled = !!value; // Disables only the comparison outline overlay, never source/export geometry.
      writeStatus('Shell outlines ' + (shellEnabled ? 'enabled' : 'disabled') + '; lighting remains ' + mode + '.');
    }
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
          const originalBackground = scene.background; // THREE r128 forcibly clears on a Color background, even with autoClear=false.
          const originalOverride = scene.overrideMaterial; // Restore arbitrary caller state if an outline shader throws.
          try {
            renderer.render(scene, camera);
            if (ready && shell && shellEnabled) {
              // CRITICAL: Rendering again with scene.background still set to a Color
              // clears BOTH the shaded hand and its depth. The black back-face
              // shell then fills the whole mesh, revealing fake 'holes' between
              // its six closed parts. Temporarily omit that background solely
              // on the second pass; keep the original color/depth buffer intact.
              scene.background = null;
              scene.overrideMaterial = shell;
              camera.layers.set(OUTLINE_LAYER);
              renderer.render(scene, camera); // Real game shader over the PRESERVED first-pass depth.
            }
          } finally {
            scene.background = originalBackground;
            scene.overrideMaterial = originalOverride;
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
    return { init, render, setMode, setShellEnabled, decorate, disposeDisplay, dispose, get ready() { return ready; }, get error() { return lastError; } };
  }

  window.GeometryWorkshopGamePreview = Object.freeze({ build, decorate, disposeDisplay, rolesFor, surfacePath, previewableMesh, inspectMeshIntegrity, topologyDescription });
})();
