// Tree-material bridge for generated/baked log-cabin walls.
// Loaded after log-wall-extension.js in both the game and Wall Builder tool.
(() => {
  'use strict';

  const api = window.LogWallExtension; // Shared log-wall API patched below so tool exports and runtime generation use the same material contract.
  const BARK_EMISSIVE_FLOOR = 0.3; // Same bark brightness floor used by foliage-generator.js's hslMat/hexBarkMat tree materials.
  const INSTALL_FLAG = '__hobunjiLogWallTreeMaterialsInstalled'; // WallBuilder prototype guard used by installRuntimeMaterialBridge().
  const MATERIAL_BRIDGE_VERSION = 'tree-wood-v1'; // Cache/userData marker used to replace any prototype generated before this bridge loaded.
  if (!api) return;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function treeWoodMaterial(THREE, color, name, surface) {
    const baseColor = color?.isColor ? color.clone() : new THREE.Color(color); // Base albedo cloned so emissive derivation cannot mutate the material color.
    const emissiveColor = baseColor.clone().multiplyScalar(BARK_EMISSIVE_FLOOR); // Tree-style 30% emissive floor retained through night/storm lighting and GLB export.
    const material = new THREE.MeshStandardMaterial({ // Export-stable equivalent of the tree generator's Lambert bark after the tree GLB pipeline normalizes it.
      color: baseColor,
      emissive: emissiveColor,
      metalness: 0,
      roughness: 1,
    });
    material.name = name;
    material.userData = { ...(material.userData || {}), treeWoodMaterial: true, logWallSurface: surface, materialBridge: MATERIAL_BRIDGE_VERSION };
    return material;
  }

  function cutWoodColor(THREE, barkColor) {
    const bark = barkColor?.isColor ? barkColor.clone() : new THREE.Color(barkColor); // Authored bark color used to derive a related fresh-cut interior tone.
    const hsl = { h: 0, s: 0, l: 0 }; // Temporary HSL target populated by THREE.Color.getHSL().
    bark.getHSL(hsl);
    const cut = new THREE.Color(); // Lighter/desaturated end-grain color used only by the two cap material groups.
    cut.setHSL(hsl.h, clamp(hsl.s * 0.48 + 0.08, 0.16, 0.48), clamp(hsl.l * 1.75 + 0.14, 0.46, 0.72));
    return cut;
  }

  function assignMaterialGroups(geometry, meta) {
    const sideIndexCount = Math.max(0, (meta.ringSegments - 1) * meta.radialSegments * 6); // Tube-side index span assigned to bark material slot 0.
    const capIndexCount = Math.max(0, meta.radialSegments * 3 * 2); // Both end-cap triangle fans assigned to cut-wood material slot 1.
    geometry.clearGroups();
    geometry.addGroup(0, sideIndexCount, 0);
    geometry.addGroup(sideIndexCount, capIndexCount, 1);
    geometry.userData = {
      ...(geometry.userData || {}),
      logWallMaterialGroups: { bark: 0, cutWood: 1, sideIndexCount, capIndexCount },
      materialBridge: MATERIAL_BRIDGE_VERSION,
    };
    return geometry;
  }

  function createTreeWoodLogPrototype(THREE, raw) {
    if (!THREE) throw new Error('LogWallMaterials.createTreeWoodLogPrototype requires THREE.');
    const meta = api.normalizeLogMeta(raw); // Canonical log metadata shared with recipe signatures and generated/baked parity.
    const geometry = assignMaterialGroups(api.createLogGeometry(THREE, meta), meta); // Existing deterministic geometry divided into bark sides and fresh-cut caps.
    const barkColor = new THREE.Color(meta.barkColor); // Authored bark color rendered with the same emissive/non-metallic tree wood response.
    const cutColor = cutWoodColor(THREE, barkColor); // Derived fresh-cut end-grain color kept automatically coherent with custom bark colors.
    const barkMaterial = treeWoodMaterial(THREE, barkColor, 'Tree Bark', 'bark'); // Material slot 0 used by the cylindrical log sides.
    const cutMaterial = treeWoodMaterial(THREE, cutColor, 'Cut Wood', 'cutWood'); // Material slot 1 used only by both flat end caps.
    const mesh = new THREE.Mesh(geometry, [barkMaterial, cutMaterial]); // One two-material reusable prototype consumed by runtime instancing and GLB export.
    mesh.name = 'GeneratedCabinLog';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      ...(mesh.userData || {}),
      logWallPrototype: true,
      logWallSignature: api.signature(meta),
      logWall: { ...meta },
      treeWoodMaterials: true,
      materialBridge: MATERIAL_BRIDGE_VERSION,
      latestChange: 'Log sides use in-game tree bark response; end caps use cut wood.',
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

  function ensureTreeMaterialPrototype(builder, THREE, raw) {
    const meta = api.normalizeLogMeta(raw); // Generated-mode metadata used to calculate the same private cache key as the base extension.
    const name = generatedLibraryName(meta); // Generated model cache key inspected/replaced before the base extension can reuse stale single-material geometry.
    const cached = builder.glbLibrary?.get(name); // Existing generated entry possibly created before this material bridge installed.
    if (cached?.treeWoodMaterials && cached?.materialBridge === MATERIAL_BRIDGE_VERSION) return name;
    const mesh = createTreeWoodLogPrototype(THREE, meta); // Fresh two-material prototype inserted under the base extension's expected cache key.
    builder.glbLibrary.set(name, {
      mesh,
      perUnitScale: perUnitScale(THREE, mesh),
      sourceName: `generated tree-material foliage log ${api.signature(meta)}`,
      logWallSignature: api.signature(meta),
      generatedLogWall: true,
      treeWoodMaterials: true,
      materialBridge: MATERIAL_BRIDGE_VERSION,
    });
    return name;
  }

  function installRuntimeMaterialBridge(target = window) {
    const THREE = target?.THREE; // Game-global Three.js namespace used only for runtime generated-log model caching.
    const WallBuilder = target?.WallBuilder; // Existing WallBuilder whose generated preparation/build path is wrapped in place.
    const prototype = WallBuilder?.prototype; // Shared prototype patched once after the base log-wall extension has already installed.
    if (!THREE || !prototype || prototype[INSTALL_FLAG]) return false;
    const previousPrepare = prototype.prepareLogWallRecipe; // Base extension's optional eager preparation path delegated for baked GLBs.
    const previousBuild = prototype.build; // Base extension's panel/opening/instancing path remains authoritative after cache pre-seeding.
    if (typeof previousBuild !== 'function') return false;

    if (typeof previousPrepare === 'function') {
      prototype.prepareLogWallRecipe = function (idOrRecipe) {
        const recipe = typeof idOrRecipe === 'string' ? this.recipeLibrary.get(idOrRecipe) : idOrRecipe; // Same recipe resolution rule as the base extension's prepare hook.
        const meta = api.recipeLogMeta(recipe); // Normalized log metadata deciding whether to generate tree-material wood or delegate baked loading.
        if (meta?.sourceMode === 'generated') return Promise.resolve(ensureTreeMaterialPrototype(this, THREE, meta));
        return previousPrepare.call(this, idOrRecipe);
      };
    }

    prototype.build = function (panels, opts) {
      const inputPanels = Array.isArray(panels) ? panels : []; // Incoming panel set scanned only to pre-seed generated model entries before normal log-wall build logic runs.
      const options = opts || {}; // Existing WallBuilder options used to resolve the same default recipe id as the base extension.
      const defaultId = options.defaultRecipeId || this.defaultRecipeId; // Default recipe key used when a panel has no explicit wallRecipeId.
      for (const panel of inputPanels) {
        const recipe = this.recipeLibrary.get(panel?.wallRecipeId || defaultId); // Candidate recipe inspected without mutating the caller or recipe library.
        const meta = api.recipeLogMeta(recipe); // Generated log metadata, or null for ordinary/baked wall recipes.
        if (meta?.sourceMode === 'generated') ensureTreeMaterialPrototype(this, THREE, meta);
      }
      return previousBuild.call(this, inputPanels, options);
    };

    Object.defineProperty(prototype, INSTALL_FLAG, { value: true, configurable: false });
    return true;
  }

  api.createLogPrototype = createTreeWoodLogPrototype;
  api.installTreeMaterials = installRuntimeMaterialBridge;
  api.latestChange = 'Log walls now use tree-style wood materials with fresh-cut end caps.';
  window.LogWallMaterials = {
    BARK_EMISSIVE_FLOOR,
    MATERIAL_BRIDGE_VERSION,
    createTreeWoodLogPrototype,
    installRuntimeMaterialBridge,
    latestChange: api.latestChange,
  };
  installRuntimeMaterialBridge(window);
})();
