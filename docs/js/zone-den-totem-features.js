(() => {
  'use strict';

  // Wilderness-zone landmark meshes tied to authored placement data rather
  // than the tile grid itself: animal den cave entrances and composed living
  // Root Totems. Farm and wilderness Root Totems share this renderer.
  function ensureCompanionScript(globalName, fileName) {
    if (window[globalName] || typeof document === 'undefined') return;
    if (document.readyState !== 'loading') {
      console.warn(`[zone root totem] ${globalName} is not loaded; expected ${fileName} before first root-totem build.`);
      return;
    }
    const currentSrc = document.currentScript?.src;
    const src = currentSrc ? new URL(fileName, currentSrc).href : `js/${fileName}`;
    document.write(`<script src="${src}"><\/script>`);
  }

  // Root Totem config first; shared natural-surface config stays authoritative
  // for Shadewood PNG textures/shading.
  ensureCompanionScript('HOBUNJI_ROOT_TOTEM_CONFIG', '../config/root-totem-config.js');
  ensureCompanionScript('NaturalSurfaceMaterialConfig', '../config/natural-surface-materials.js');
  ensureCompanionScript('NaturalSurfaceMaterials', 'natural-surface-materials.js');
  ensureCompanionScript('FurnitureVesselRuntime', 'furniture-vessel-runtime.js');
  ensureCompanionScript('StructuralWrap', 'structural-wrap.js');
  ensureCompanionScript('DeadzoneBillboard', 'deadzone-billboard.js');
  ensureCompanionScript('FoliageGenerator', 'foliage-generator.js');
  ensureCompanionScript('RootTotemSurfaceStyle', 'root-totem-surface-style.js');
  ensureCompanionScript('RootTotemPlants', 'root-totem-plants.js');
  ensureCompanionScript('LifeTotemFurniture', 'life-totem-furniture.js');

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }
  function canonicalRootTotemRecipe() {
    return window.HOBUNJI_ROOT_TOTEM_CONFIG?.canonicalRecipe || null;
  }

  // Animal den entrance prop: docs/assets/models/cave_small.glb, shared by
  // every den in the game — recolored per den family (see denCaveVariantFor)
  // rather than modeled once per look. The GLB ships with no UV attribute
  // at all (a single baked-color mesh), so a flat XZ planar projection
  // (assignCaveUv) stands in for authored UVs, same "generate UVs for a
  // mesh that never had any" need HousePieceGen.js's shingle GLB solves for
  // its own shell meshes.
  const CAVE_SMALL_GLB_PATH = 'assets/models/cave_small.glb';
  // Halves the den's visual footprint (see buildAnimalDenMeshes) — half of
  // whatever span the entrance prop would otherwise fill relative to the
  // den's tile footprint.
  const DEN_SIZE_SCALE = 0.5;
  const DEN_SINK = 0.35; // Settles the model's base slightly below ground level so it doesn't look like it's floating on top of the terrain.
  // Matches the tiling density buildCarvedCavernMesh already uses for the
  // mine's own carved_smooth.png cavern shell (game.js's mine wallStyle
  // texture options) — small enough that the little entrance prop and the
  // cavern beyond it read as the same continuous stone/soil surface.
  const DEN_CAVE_TEXTURE_REPEAT = 0.35;
  // Same two looks used for the den's cavern INTERIOR (see game.js's
  // 'cavern' wallStyle texture options, which reads this exact table via
  // denCaveVariantFor) — the farm border cliffs' own rock texture/tint for
  // gar-wolf/uumkao'ii dens, the trench floor's own soil texture/tint for
  // grehlr dens, so an entrance and the tunnel behind it always match.
  const DEN_CAVE_VARIANTS = {
    grehlr: { textureUrl: 'assets/textures/canvas.png', color: 0x423d35 },
    default: { textureUrl: 'assets/textures/carved_smooth.png', color: 0x808080 },
  };
  function denCaveVariantFor(denMotherKind) {
    return (typeof denMotherKind === 'string' && denMotherKind.startsWith('grehlr')) ? DEN_CAVE_VARIANTS.grehlr : DEN_CAVE_VARIANTS.default;
  }

  const _caveTextureCache = new Map(); // textureUrl -> THREE.Texture
  function caveTextureFor(url) {
    let tex = _caveTextureCache.get(url);
    if (tex) return tex;
    tex = new THREE.TextureLoader().load(url);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(DEN_CAVE_TEXTURE_REPEAT, DEN_CAVE_TEXTURE_REPEAT);
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    _caveTextureCache.set(url, tex);
    return tex;
  }

  const _caveMaterialCache = new Map(); // color -> THREE.Material, shared by every den of that family
  function caveMaterialFor(variant) {
    let mat = _caveMaterialCache.get(variant.color);
    if (mat) return mat;
    mat = new THREE.MeshLambertMaterial({ color: variant.color, map: caveTextureFor(variant.textureUrl), side: THREE.DoubleSide });
    _caveMaterialCache.set(variant.color, mat);
    return mat;
  }

  // Flat XZ projection straight off local vertex position — see the GLB
  // comment above. Deliberately not normalized to 0..1 (unlike a typical
  // planar-stretch UV): using raw local units lets a shared DEN_CAVE_TEXTURE_REPEAT
  // tile consistently across every den's clone regardless of its own scale.
  function assignCaveUv(geometry) {
    if (geometry.getAttribute('uv')) return;
    const pos = geometry.getAttribute('position');
    if (!pos) return;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getZ(i); }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  let _caveTemplate = null, _caveTemplatePromise = null;
  function loadCaveSmallTemplate() {
    if (_caveTemplate) return Promise.resolve(_caveTemplate);
    if (_caveTemplatePromise) return _caveTemplatePromise;
    const Loader = THREE.GLTFLoader;
    if (!Loader) {
      console.warn('[zone den] THREE.GLTFLoader unavailable; animal den cave entrances cannot load.');
      return Promise.resolve(null);
    }
    _caveTemplatePromise = new Promise(resolve => {
      new Loader().load(CAVE_SMALL_GLB_PATH, gltf => {
        const scene = gltf.scene || gltf.scenes?.[0];
        const mesh = scene?.isMesh ? scene : scene?.children?.find(child => child.isMesh);
        if (!mesh) {
          console.warn(`[zone den] ${CAVE_SMALL_GLB_PATH} contained no mesh.`);
          resolve(null);
          return;
        }
        assignCaveUv(mesh.geometry);
        mesh.geometry.computeBoundingBox();
        _caveTemplate = mesh;
        resolve(mesh);
      }, undefined, error => {
        console.warn(`[zone den] ${CAVE_SMALL_GLB_PATH} failed to load`, error);
        resolve(null);
      });
    });
    return _caveTemplatePromise;
  }

  function buildAnimalDenMeshes(zScene, zGrid, dens, mapId) {
    if (!dens || !dens.length) return;
    loadCaveSmallTemplate().then(template => {
      if (!template) return;
      const box = template.geometry.boundingBox;
      const templateWidth = Math.max(1e-4, box.max.x - box.min.x);
      const templateDepth = Math.max(1e-4, box.max.z - box.min.z);
      const group = new THREE.Group();
      group.name = 'animalDenEntrances';
      for (const den of dens) {
        const w = den.w || 1, h = den.h || 1;
        const centerCol = den.x + w / 2, centerRow = den.y + h / 2;
        const elevTier = zGrid?.[Math.floor(centerRow)]?.[Math.floor(centerCol)]?.elevTier || 0;
        const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT;
        // The den's own cavern species (see cavern-generator.js's
        // pickDenMotherKind) — the exact same deterministic per-den roll
        // its interior Den-Mother uses, so the entrance prop's color always
        // matches what's actually inside.
        const cavernMapId = window.WildlifeSpawn?.denCavernMapId?.(mapId, den.id) || null;
        const denMotherKind = cavernMapId ? window.CavernGenerator?.pickDenMotherKind?.(cavernMapId) : null;
        const variant = denCaveVariantFor(denMotherKind);
        const mesh = template.clone();
        mesh.material = caveMaterialFor(variant);
        const scale = (Math.min(w, h) / Math.max(templateWidth, templateDepth)) * DEN_SIZE_SCALE;
        mesh.scale.set(scale, scale, scale);
        mesh.position.set(centerCol, groundY - DEN_SINK - box.min.y * scale, centerRow);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.cameraObstacle = true;
        deps.markOutline(mesh);
        group.add(mesh);
      }
      zScene.add(group);
      console.log(`%c[zone:${mapId}] animal den cave entrances built: ${dens.length}`, 'color:#22c55e;font-weight:bold');
    });
  }

  function buildRootTotemMeshes(zScene, zGrid, totems, mapId) {
    if (!totems || !totems.length) return;
    const canonicalRecipe = canonicalRootTotemRecipe();
    if (!window.HOBUNJI_ROOT_TOTEM_CONFIG || !window.RootTotemPlants || !canonicalRecipe || !window.StructuralWrap || !window.FoliageGenerator || !window.DeadzoneBillboard || !window.RootTotemSurfaceStyle || !window.NaturalSurfaceMaterials || !window.LifeTotemFurniture?.build) {
      const missing = [
        !window.HOBUNJI_ROOT_TOTEM_CONFIG && 'HOBUNJI_ROOT_TOTEM_CONFIG',
        !window.NaturalSurfaceMaterials && 'NaturalSurfaceMaterials',
        !window.StructuralWrap && 'StructuralWrap',
        !window.FoliageGenerator && 'FoliageGenerator',
        !window.RootTotemSurfaceStyle && 'RootTotemSurfaceStyle',
        !window.DeadzoneBillboard && 'DeadzoneBillboard',
        !window.RootTotemPlants && 'RootTotemPlants',
        !canonicalRecipe && 'rootTotemConfig.canonicalRecipe',
        !window.LifeTotemFurniture?.build && 'LifeTotemFurniture.build',
      ].filter(Boolean).join(', ');
      console.error(`[zone:${mapId}] root-totem visual dependencies missing: ${missing}; checkpoint data remains valid.`);
      return;
    }

    window.RootTotemPlants.clearDiagnostics();
    const group = new THREE.Group();
    group.name = 'rootTotemWorldVisuals';
    for (const totem of totems) {
      const elevTier = zGrid?.[totem.y]?.[totem.x]?.elevTier || 0;
      const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT;
      const cx = totem.x + 0.5, cz = totem.y + 0.5;
      const worldTotem = window.LifeTotemFurniture.build({ rootTotemPlant: canonicalRecipe, worldRootTotem: true });
      worldTotem.name = 'rootTotemWorldVisual';
      worldTotem.position.set(cx, groundY, cz);
      worldTotem.userData.rootTotemWorldVisual = true;
      worldTotem.userData.rootTotemLocation = { mapId, x: totem.x, y: totem.y };
      worldTotem.userData.canonicalRootTotemRecipe = true;
      group.add(worldTotem);
      const plant = worldTotem.getObjectByName?.('lifeTotemFurniturePlant') || worldTotem;
      window.RootTotemPlants.recordPlacedTotem({ mapId, x: totem.x, y: totem.y, seedU32: canonicalRecipe.seedU32, plant });
    }
    zScene.add(group);
    const message = `root-totem world visuals built: ${totems.length} (configured authored basin + canonical ${canonicalRecipe.sourceTree} recipe)`;
    if (typeof window.__farmLog === 'function') window.__farmLog(`[zone:${mapId}] ${message}`, 'info');
    else console.log(`%c[zone:${mapId}] ${message}`, 'color:#22c55e;font-weight:bold');
    return group;
  }

  const api = { init, canonicalRootTotemRecipe, denCaveVariantFor, buildAnimalDenMeshes, buildRootTotemMeshes };
  Object.defineProperty(api, 'CANONICAL_ROOT_TOTEM_RECIPE', { enumerable: true, get: canonicalRootTotemRecipe });
  window.ZoneDenTotemFeatures = api;
})();
