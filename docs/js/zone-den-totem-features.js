(() => {
  'use strict';

  // Wilderness-zone landmark meshes tied to authored placement data rather
  // than the tile grid itself: animal den cave entrances, locale cave mouths,
  // and composed living Root Totems. Farm and wilderness Root Totems share
  // this renderer.
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
  ensureCompanionScript('FurnitureDecalRuntime', 'furniture-decal-runtime.js');
  ensureCompanionScript('StructuralWrap', 'structural-wrap.js');
  ensureCompanionScript('DeadzoneBillboard', 'deadzone-billboard.js?v=20260923texready1');
  ensureCompanionScript('LocaleCaveRuntime', 'locale-cave-runtime.js');
  // Generic rigid piece animation reuses the Root Totem wind helpers and
  // patches AuthoredFurniture.buildGroup before any live furniture is built.
  ensureCompanionScript('FurniturePieceAnimationRuntime', 'furniture-piece-animation-runtime.js?v=20260923texready1');
  ensureCompanionScript('FoliageGenerator', 'foliage-generator.js');
  ensureCompanionScript('RootTotemSurfaceStyle', 'root-totem-surface-style.js');
  ensureCompanionScript('RootTotemPlants', 'root-totem-plants.js');
  ensureCompanionScript('LifeTotemFurniture', 'life-totem-furniture.js');

  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    loadAnimalDenEntranceLocaleObject(); // Preload the shared den facade/collider so movement can use it as soon as the zone is interactive.
  }
  function canonicalRootTotemRecipe() {
    return window.HOBUNJI_ROOT_TOTEM_CONFIG?.canonicalRecipe || null;
  }

  // Animal den / authored locale cave entrance prop: cave_small.glb, shared by
  // every den and cave locale in the game. Dens can recolor it per den family;
  // locale caves default to the ordinary carved-stone surface unless their
  // authored visual metadata asks for the grehlr soil variant.
  const ZONE_FEATURE_SCRIPT_SRC = typeof document !== 'undefined' ? (document.currentScript?.src || '') : ''; // Resolves cave assets correctly from docs/index.html and nested preview tools.
  function zoneFeatureAssetUrl(path) {
    if (!ZONE_FEATURE_SCRIPT_SRC || typeof URL === 'undefined') return path;
    try { return new URL('../' + String(path || '').replace(/^\/+/, ''), ZONE_FEATURE_SCRIPT_SRC).href; }
    catch (_) { return path; }
  }
  const CAVE_SMALL_GLB_PATH = zoneFeatureAssetUrl('assets/models/cave_small.glb');
  const ANIMAL_DEN_ENTRANCE_LOCALE_ID = 'locale_animal_den_entrance'; // Shared Locale Editor document cloned by every procedural den.
  const ANIMAL_DEN_ENTRANCE_LOCALE_URL = zoneFeatureAssetUrl('config/locales/locale_animal_den_entrance.json');
  let _animalDenEntranceLocalePromise = null; // Repo-backed template request shared across all zone builds.
  let _animalDenEntranceObject = null; // Synchronous cache used by movement collision after the template has loaded.

  function localAnimalDenEntranceLocale() {
    try {
      if (window.LocalDBOverrides?.getSourceMode?.() !== 'local') return null;
      const override = window.LocalDBOverrides.getOverride?.('locales');
      const locales = Array.isArray(override) ? override : override?.locales;
      return Array.isArray(locales) ? locales.find(locale => locale?.id === ANIMAL_DEN_ENTRANCE_LOCALE_ID) || null : null;
    } catch (_) { return null; }
  }

  function denEntranceObjectFromLocale(locale) {
    return (locale?.objects || []).find(object => object?.key === 'cave_small' || object?.visual?.renderer === 'cave_small') || null;
  }

  function loadAnimalDenEntranceLocaleObject() {
    const local = denEntranceObjectFromLocale(localAnimalDenEntranceLocale());
    if (local) {
      _animalDenEntranceObject = local;
      return Promise.resolve(local);
    }
    if (_animalDenEntranceLocalePromise) return _animalDenEntranceLocalePromise;
    if (typeof fetch !== 'function') return Promise.resolve(null); // Headless/unit-test runtimes keep the legacy facade without browser fetch.
    _animalDenEntranceLocalePromise = fetch(ANIMAL_DEN_ENTRANCE_LOCALE_URL, { cache:'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(locale => {
        _animalDenEntranceObject = denEntranceObjectFromLocale(locale);
        return _animalDenEntranceObject;
      })
      .catch(error => {
        console.warn('[den entrance locale] shared template failed to load; keeping legacy den facade:', error);
        return null;
      });
    return _animalDenEntranceLocalePromise;
  }

  function denEntranceCollisionFor(den) {
    const source = denEntranceObjectFromLocale(localAnimalDenEntranceLocale()) || _animalDenEntranceObject;
    const collision = source?.collision;
    if (!collision || collision.mode === 'auto') return null; // Null deliberately means “use the legacy doorway-gap rule”.
    if (collision.mode === 'none') return { mode:'none', x:0, y:0, w:0, h:0 };
    const denW = Math.max(.1, Number(den?.w) || 1), denH = Math.max(.1, Number(den?.h) || 1);
    if (collision.mode === 'footprint') return { mode:'rect', x:Number(den?.x) || 0, y:Number(den?.y) || 0, w:denW, h:denH };
    if (collision.mode !== 'custom') return null;
    const sourceW = Math.max(.1, Number(source?.w) || 1), sourceH = Math.max(.1, Number(source?.h) || 1);
    const scaleX = denW / sourceW, scaleY = denH / sourceH;
    return {
      mode:'rect',
      x:(Number(den?.x) || 0) + (Number(collision.colOffset) || 0) * scaleX,
      y:(Number(den?.y) || 0) + (Number(collision.rowOffset) || 0) * scaleY,
      w:Math.max(.1, Number(collision.w) || sourceW) * scaleX,
      h:Math.max(.1, Number(collision.h) || sourceH) * scaleY,
    };
  }
  // Halves a normal den's visual footprint (see buildAnimalDenMeshes). Locale
  // caves multiply this by visual.scale, so visual.scale:2 fills the complete
  // authored footprint while still using the exact den-rendering geometry path.
  const DEN_SIZE_SCALE = 0.5;
  const DEN_SINK = 0.35; // Settles the model's base slightly below ground level so it doesn't look like it's floating on top of the terrain.
  const DEN_CAVE_VARIANTS = {
    grehlr: { textureUrl: zoneFeatureAssetUrl('assets/textures/canvas.png'), color: 0x423d35 },
    default: { textureUrl: zoneFeatureAssetUrl('assets/textures/carved_smooth.png'), color: 0x808080 },
  };
  function denCaveVariantFor(denMotherKind) {
    return (typeof denMotherKind === 'string' && denMotherKind.startsWith('grehlr')) ? DEN_CAVE_VARIANTS.grehlr : DEN_CAVE_VARIANTS.default;
  }

  const _caveTextureCache = new Map(); // textureUrl -> THREE.Texture
  function caveTextureFor(url) {
    let tex = _caveTextureCache.get(url);
    if (tex) return tex;
    tex = new THREE.TextureLoader().load(url);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    // TextureLoader marks the texture dirty after assigning its decoded image.
    // Do not set needsUpdate here while image is still undefined.
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    _caveTextureCache.set(url, tex);
    return tex;
  }

  const _caveMaterialCache = new Map(); // color -> THREE.Material, shared by every den/locale cave of that family
  function caveMaterialFor(variant) {
    let mat = _caveMaterialCache.get(variant.color);
    if (mat) return mat;
    mat = new THREE.MeshLambertMaterial({ color: variant.color, map: caveTextureFor(variant.textureUrl), side: THREE.DoubleSide });
    _caveMaterialCache.set(variant.color, mat);
    return mat;
  }

  function fitCaveUvToTexture(geometry) {
    const pos = geometry.getAttribute('position');
    let sourceUv = geometry.getAttribute('uv');
    if (!sourceUv) {
      if (!pos) return;
      const generated = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { generated[i * 2] = pos.getX(i); generated[i * 2 + 1] = pos.getZ(i); }
      sourceUv = new THREE.BufferAttribute(generated, 2);
    }
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < sourceUv.count; i++) {
      const u = sourceUv.getX(i), v = sourceUv.getY(i);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const spanU = Math.max(1e-6, maxU - minU);
    const spanV = Math.max(1e-6, maxV - minV);
    const fitted = new Float32Array(sourceUv.count * 2);
    for (let i = 0; i < sourceUv.count; i++) {
      fitted[i * 2] = (sourceUv.getX(i) - minU) / spanU;
      fitted[i * 2 + 1] = (sourceUv.getY(i) - minV) / spanV;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(fitted, 2));
  }

  let _caveTemplate = null, _caveTemplatePromise = null;
  function loadCaveSmallTemplate() {
    if (_caveTemplate) return Promise.resolve(_caveTemplate);
    if (_caveTemplatePromise) return _caveTemplatePromise;
    const Loader = THREE.GLTFLoader;
    if (!Loader) {
      console.warn('[zone den] THREE.GLTFLoader unavailable; cave entrances cannot load.');
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
        fitCaveUvToTexture(mesh.geometry);
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

  function caveFacingRotation(facing, rotDegrees) {
    if (Number.isFinite(Number(rotDegrees))) return Number(rotDegrees) * Math.PI / 180;
    switch (String(facing || 'south').toLowerCase()) {
      case 'north': return Math.PI;
      case 'east': return -Math.PI / 2;
      case 'west': return Math.PI / 2;
      default: return 0;
    }
  }

  function buildAnimalDenMeshes(zScene, zGrid, dens, mapId) {
    const denList = Array.isArray(dens) ? dens : [];
    const localeCaves = window.LocaleCaveRuntime?.cavesForZone?.(mapId) || []; // Authored caves are registered from placed localeInstances after wilderness generation.
    if (!denList.length && !localeCaves.length) return;
    Promise.all([loadCaveSmallTemplate(), loadAnimalDenEntranceLocaleObject()]).then(([template, denEntranceObject]) => {
      if (!template) return;
      const box = template.geometry.boundingBox;
      const templateWidth = Math.max(1e-4, box.max.x - box.min.x);
      const templateDepth = Math.max(1e-4, box.max.z - box.min.z);
      const templateSpan = Math.max(templateWidth, templateDepth);
      const group = new THREE.Group();
      group.name = 'animalDenEntrances';
      for (const den of denList) {
        const w = den.w || 1, h = den.h || 1;
        const centerCol = den.x + w / 2, centerRow = den.y + h / 2;
        const elevTier = zGrid?.[Math.floor(centerRow)]?.[Math.floor(centerCol)]?.elevTier || 0;
        const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT;
        const cavernMapId = window.WildlifeSpawn?.denCavernMapId?.(mapId, den.id) || null;
        const denMotherKind = cavernMapId ? window.CavernGenerator?.pickDenMotherKind?.(cavernMapId) : null;
        const visual = denEntranceObject?.visual || {};
        const familyVariant = denCaveVariantFor(denMotherKind);
        const variant = visual.surface === 'grehlr' ? DEN_CAVE_VARIANTS.grehlr
          : visual.surface === 'default' ? DEN_CAVE_VARIANTS.default
          : familyVariant;
        const authoredScale = Math.max(.05, Number(visual.scale) || 1);
        const baseScale = (Math.min(w, h) / templateSpan) * DEN_SIZE_SCALE * authoredScale;
        const scaleX = baseScale * Math.max(.05, Number(visual.scaleX) || 1);
        const scaleY = baseScale * Math.max(.05, Number(visual.scaleY) || 1);
        const scaleZ = baseScale * Math.max(.05, Number(visual.scaleZ) || 1);
        const sink = Number.isFinite(Number(visual.sink)) ? Number(visual.sink) : DEN_SINK;
        const mesh = template.clone();
        mesh.material = caveMaterialFor(variant);
        mesh.scale.set(scaleX, scaleY, scaleZ);
        mesh.rotation.y = caveFacingRotation(visual.facing, Number.isFinite(Number(denEntranceObject?.rot)) ? denEntranceObject.rot : null);
        mesh.position.set(
          centerCol + (Number(visual.offsetX) || 0),
          groundY + (Number(visual.offsetY) || 0) - sink - box.min.y * scaleY,
          centerRow + (Number(visual.offsetZ) || 0)
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.cameraObstacle = true;
        mesh.userData.denEntranceLocaleId = ANIMAL_DEN_ENTRANCE_LOCALE_ID;
        mesh.userData.denEntranceLocaleObjectId = denEntranceObject?.id || null;
        deps.markOutline(mesh);
        group.add(mesh);
      }
      for (const cave of localeCaves) {
        const w = Math.max(1, Number(cave.w) || 1), h = Math.max(1, Number(cave.h) || 1);
        const centerCol = Number(cave.x) + w / 2, centerRow = Number(cave.y) + h / 2;
        const sampledTier = zGrid?.[Math.floor(centerRow)]?.[Math.floor(centerCol)]?.elevTier || 0; // Center sampling is only a fallback for old/non-terrain-aware cave records.
        const elevTier = cave.floorTier != null && Number.isFinite(Number(cave.floorTier)) ? Number(cave.floorTier) : sampledTier; // Terrain-aware caves sit on their locale floor, not a higher embedded plateau cell under the model center.
        const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT;
        const visual = cave.visual || {}; // Authored scale/facing controls modify the same normal den cave prop rather than creating a second renderer.
        const variant = visual.surface === 'grehlr' ? DEN_CAVE_VARIANTS.grehlr : DEN_CAVE_VARIANTS.default;
        const authoredScale = Math.max(0.1, Number(visual.scale) || 1); // Legacy uniform cave scale still multiplies all authored axes.
        const baseScale = (Math.min(w, h) / templateSpan) * DEN_SIZE_SCALE * authoredScale; // Shared footprint fit used before facade-only axis overrides.
        const scaleX = baseScale * Math.max(0.1, Number(visual.scaleX) || 1); // Used to widen authored cave mouths without pushing them deeper into cliffs.
        const scaleY = baseScale * Math.max(0.1, Number(visual.scaleY) || 1); // Used to raise authored cave mouths while preserving their ground contact.
        const scaleZ = baseScale * Math.max(0.1, Number(visual.scaleZ) || 1); // Used to keep or independently tune cave depth into the host cliff.
        const mesh = template.clone();
        mesh.material = caveMaterialFor(variant);
        mesh.scale.set(scaleX, scaleY, scaleZ);
        mesh.rotation.y = caveFacingRotation(visual.facing, Number.isFinite(Number(cave.rot)) ? cave.rot : null);
        const sink = Number.isFinite(Number(visual.sink)) ? Number(visual.sink) : DEN_SINK;
        mesh.position.set(
          centerCol + (Number(visual.offsetX) || 0),
          groundY + (Number(visual.offsetY) || 0) - sink - box.min.y * scaleY,
          centerRow + (Number(visual.offsetZ) || 0)
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.cameraObstacle = true;
        mesh.userData.localeCave = true;
        mesh.userData.localeId = cave.localeId || null;
        mesh.userData.localeObjectId = cave.sourceObjectId || cave.id || null;
        deps.markOutline(mesh);
        group.add(mesh);
      }
      zScene.add(group);
      console.log(`%c[zone:${mapId}] cave entrances built: ${denList.length} animal dens + ${localeCaves.length} locale caves`, 'color:#22c55e;font-weight:bold');
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

  const api = { init, canonicalRootTotemRecipe, denCaveVariantFor, denEntranceCollisionFor, loadAnimalDenEntranceLocaleObject, buildAnimalDenMeshes, buildRootTotemMeshes };
  Object.defineProperty(api, 'CANONICAL_ROOT_TOTEM_RECIPE', { enumerable: true, get: canonicalRootTotemRecipe });
  window.ZoneDenTotemFeatures = api;
})();
