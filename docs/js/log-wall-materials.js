// Tree-PNG material bridge for generated/baked log-cabin walls.
// Loaded after log-wall-extension.js and wood-cut-surfaces.js in both the game
// and Wall Builder tool. Bark + cut ends intentionally share ONE atlas material
// so glTF cannot split the caps into a second primitive that WallBuilder drops.
(() => {
  'use strict';

  const api = window.LogWallExtension; // Shared log-wall API patched below so tool exports and runtime generation use the same geometry/material contract.
  const wood = window.WoodCutSurfaces; // Shared tree PNG + cut-cap authority used by walls, stumps, and fallen logs.
  const INSTALL_FLAG = '__hobunjiLogWallTreePngInstalled'; // WallBuilder prototype guard used by installRuntimeMaterialBridge().
  const MATERIAL_BRIDGE_VERSION = 'tree-png-atlas-v2'; // Cache/userData marker replacing prior flat/two-material generated prototypes.
  if (!api || !wood) return;

  function createTreePngLogPrototype(THREE, raw) {
    if (!THREE) throw new Error('LogWallMaterials.createTreePngLogPrototype requires THREE.');
    const meta = api.normalizeLogMeta(raw); // Canonical log metadata shared with recipe signatures and generated/baked parity.
    const geometry = wood.remapLogAtlasUv(api.createLogGeometry(THREE, meta), meta); // Existing bark/cap vertices kept together while their UVs select atlas halves.
    const material = wood.makeLogAtlasMaterial(THREE, meta.barkColor); // wavy_surface.png bark + log.png cut wood in one unlit/double-sided material.
    const mesh = new THREE.Mesh(geometry, material); // Single-material mesh remains one glTF primitive, so WallBuilder's first-mesh import retains the actual cap triangles.
    mesh.name = 'GeneratedCabinLog';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      ...(mesh.userData || {}),
      logWallPrototype: true,
      logWallSignature: api.signature(meta),
      logWall: { ...meta },
      treeWoodMaterials: true,
      treePngBark: 'wavy_surface.png',
      cutWoodPng: 'log.png',
      materialBridge: MATERIAL_BRIDGE_VERSION,
      latestChange: 'Log bark uses the tree PNG; both end caps are real double-sided cut-wood faces in the same GLB primitive.',
    };
    return mesh;
  }

  function generatedLibraryName(meta) {
    const safeName = String(meta.glbName || api.DEFAULTS.glbName).replace(/[^a-z0-9_.-]+/gi, '_'); // Same private key format used inside log-wall-extension.js's generated cache.
    return `__generated_logwall_${api.signature(meta)}_${safeName}`;
  }

  function perUnitScale(THREE, mesh) {
    const box = new THREE.Box3().setFromObject(mesh); // Prototype bounds normalized exactly like WallBuilder's imported/generated model path.
    const size = new THREE.Vector3(); // Scratch vector receiving the reusable log prototype's world-space source dimensions.
    box.getSize(size);
    return new THREE.Vector3(
      size.x > 1e-6 ? 1 / size.x : 1,
      size.y > 1e-6 ? 1 / size.y : 1,
      size.z > 1e-6 ? 1 / size.z : 1,
    );
  }

  function ensureTreePngPrototype(builder, THREE, raw) {
    const meta = api.normalizeLogMeta(raw); // Generated-mode metadata used to calculate the same private cache key as the base extension.
    const name = generatedLibraryName(meta); // Generated model cache key inspected/replaced before the base extension can reuse a stale material/cap prototype.
    const cached = builder.glbLibrary?.get(name); // Existing generated entry possibly created before this bridge version installed.
    if (cached?.materialBridge === MATERIAL_BRIDGE_VERSION) return name;
    const mesh = createTreePngLogPrototype(THREE, meta); // Fresh one-primitive PNG prototype inserted under the base extension's expected cache key.
    builder.glbLibrary.set(name, {
      mesh,
      perUnitScale: perUnitScale(THREE, mesh),
      sourceName: `generated tree-PNG foliage log ${api.signature(meta)}`,
      logWallSignature: api.signature(meta),
      generatedLogWall: true,
      treeWoodMaterials: true,
      materialBridge: MATERIAL_BRIDGE_VERSION,
    });
    return name;
  }

  function installRuntimeMaterialBridge(target = window) {
    const THREE = target?.THREE; // Game-global Three.js namespace required for runtime generated-log model caching.
    const WallBuilder = target?.WallBuilder; // Existing WallBuilder whose generated preparation/build path is wrapped in place.
    const prototype = WallBuilder?.prototype; // Shared prototype patched once after the base log-wall extension has installed.
    if (!THREE || !prototype || prototype[INSTALL_FLAG]) return false;
    const previousPrepare = prototype.prepareLogWallRecipe; // Base extension's optional eager preparation path delegated for baked GLBs.
    const previousBuild = prototype.build; // Base extension's panel/opening/instancing path remains authoritative after cache pre-seeding.
    if (typeof previousBuild !== 'function') return false;

    if (typeof previousPrepare === 'function') {
      prototype.prepareLogWallRecipe = function (idOrRecipe) {
        const recipe = typeof idOrRecipe === 'string' ? this.recipeLibrary.get(idOrRecipe) : idOrRecipe; // Same recipe resolution rule as the base extension's prepare hook.
        const meta = api.recipeLogMeta(recipe); // Normalized log metadata deciding whether to generate PNG wood or delegate baked loading.
        if (meta?.sourceMode === 'generated') return Promise.resolve(ensureTreePngPrototype(this, THREE, meta));
        return previousPrepare.call(this, idOrRecipe);
      };
    }

    prototype.build = function (panels, opts) {
      const inputPanels = Array.isArray(panels) ? panels : []; // Incoming panel set scanned only to pre-seed generated model entries before normal log-wall build logic runs.
      const options = opts || {}; // Existing WallBuilder options used to resolve the same default recipe id as the base extension.
      const defaultId = options.defaultRecipeId || this.defaultRecipeId; // Default recipe key used when a panel has no explicit wallRecipeId.
      for (const panel of inputPanels) {
        const recipe = this.recipeLibrary.get(panel?.wallRecipeId || defaultId); // Candidate recipe inspected without mutating caller or recipe library.
        const meta = api.recipeLogMeta(recipe); // Generated log metadata, or null for ordinary/baked wall recipes.
        if (meta?.sourceMode === 'generated') ensureTreePngPrototype(this, THREE, meta);
      }
      const result = previousBuild.call(this, inputPanels, options); // Existing extension build result retained while adding mobile-visible material diagnostics below.
      if (result?.userData?.logWallStats) {
        result.userData.logWallStats.materialBridge = MATERIAL_BRIDGE_VERSION;
        result.userData.logWallStats.barkMaterial = 'wavy_surface.png · tree body-sprite tint · unlit';
        result.userData.logWallStats.capMaterial = 'log.png · cut wood · double-sided';
        result.userData.logWallStats.singlePrimitiveGlb = true;
        result.userData.latestChange = 'Log walls use the tree bark PNG and real cut-wood caps; export remains one GLB primitive.';
      }
      return result;
    };

    Object.defineProperty(prototype, INSTALL_FLAG, { value: true, configurable: false });
    return true;
  }

  api.createLogPrototype = createTreePngLogPrototype;
  api.installTreeMaterials = installRuntimeMaterialBridge;
  api.latestChange = 'Log walls now use wavy_surface.png bark plus log.png cut caps in one GLB-safe primitive.';
  window.LogWallMaterials = {
    MATERIAL_BRIDGE_VERSION,
    createTreePngLogPrototype,
    installRuntimeMaterialBridge,
    waitForTextures: wood.waitForObjectTextures,
    latestChange: api.latestChange,
  };
  installRuntimeMaterialBridge(window);
})();
