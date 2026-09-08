// Runtime corrections for authored interior fire furniture and the exterior
// void seen around building interiors. Loaded by interior-fire-floor-integration
// after the normal authored/procedural furniture runtimes are available.
(() => {
  'use strict';

  if (window.InteriorFireVoidRuntime?.installed) return;

  const THREE = window.THREE; // Used for the unlit black interior backdrop.
  const furniture = window.ProceduralFurniture; // Shared procedural fallback path used by gameplay and the editor.
  if (!THREE || !furniture?.buildFurnitureGroup || !furniture?.CATALOG) {
    window.InteriorFireVoidRuntime = { installed: false, reason: 'missing THREE/ProceduralFurniture' };
    return;
  }

  const FIRE_KEY_ALIASES = Object.freeze({ // Converts authored item keys into the visual keys consumed by both furniture runtimes.
    campfireFurniture: 'campfire',
    bonfireFurniture: 'bonfire',
  });
  const FIRE_DEFS = Object.freeze({ // Mirrors runtime + editor catalog fields so early lookups cannot fall through to a gray placeholder cube.
    campfireFurniture: Object.freeze({
      key: 'campfireFurniture', label: 'Campfire', name: 'Campfire', icon: '🔥', fw: 1, fd: 1,
      procKey: 'campfire', col: 0x6d3e20, color: 0x6d3e20,
      desc: 'A compact stone-ring campfire using the authored campfire furniture preset.',
    }),
    bonfireFurniture: Object.freeze({
      key: 'bonfireFurniture', label: 'Bonfire', name: 'Bonfire', icon: '🔥', fw: 2, fd: 2,
      procKey: 'bonfire', col: 0x6d3e20, color: 0x6d3e20,
      desc: 'A two-by-two bonfire derived from the authored campfire at double scale.',
    }),
  });
  const VOID_NAME = 'hobunji_interior_unlit_black_void'; // Stable name used to update/reuse one backdrop per loaded interior.
  let buildingSceneMap = null; // The private building-scene map exposed by GridTileAccessors.init.
  let lastVoidMapId = null; // Debug snapshot of the most recently blackened interior.
  let lastFireKey = null; // Debug snapshot of the most recently canonicalized fire furniture key.
  let definitionBridgeInstalled = false; // Confirms the early decorative-definition compatibility bridge is active.
  let catalogFallbackInstalled = false; // Confirms the bonfire has non-empty immediate procedural geometry.

  function canonicalFireKey(key) {
    const raw = String(key || '').trim();
    return FIRE_KEY_ALIASES[raw] || raw;
  }

  function scaleRecipe(source, scale) {
    return (Array.isArray(source) ? source : []).map(part => {
      const clone = JSON.parse(JSON.stringify(part)); // Recipes are plain JSON-shaped objects; clone keeps the campfire recipe independent.
      const t = clone.transform || {};
      for (const field of ['x', 'y', 'z', 'sx', 'sy', 'sz']) {
        if (Number.isFinite(Number(t[field]))) t[field] = Number(t[field]) * scale;
      }
      return clone;
    });
  }

  function installImmediateFireCatalog() {
    const catalog = furniture.CATALOG;
    const campfire = catalog.campfire;
    if (Array.isArray(campfire) && campfire.length && (!Array.isArray(catalog.bonfire) || !catalog.bonfire.length)) {
      // The authored bonfire still replaces this when its JSON resolves; this
      // only prevents an empty group from causing the caller's generic cube
      // fallback during that asynchronous window.
      catalog.bonfire = scaleRecipe(campfire, 2);
      catalogFallbackInstalled = true;
    }
    for (const [itemKey, visualKey] of Object.entries(FIRE_KEY_ALIASES)) {
      if (Object.prototype.hasOwnProperty.call(catalog, itemKey)) continue;
      Object.defineProperty(catalog, itemKey, {
        configurable: true,
        enumerable: false,
        get() { return catalog[visualKey]; },
        set(value) { Object.defineProperty(catalog, itemKey, { configurable: true, enumerable: true, writable: true, value }); },
      });
    }
  }

  function isDecorativeDefinitionMap(value) {
    return !!value && typeof value === 'object'
      && Object.prototype.hasOwnProperty.call(value, 'basicBedFurniture')
      && Object.prototype.hasOwnProperty.call(value, 'chairSimpleFurniture')
      && Object.prototype.hasOwnProperty.call(value, 'rugFurniture');
  }

  function installDecorativeDefinitionBridge() {
    for (const [itemKey, definition] of Object.entries(FIRE_DEFS)) {
      if (Object.prototype.hasOwnProperty.call(Object.prototype, itemKey)) continue;
      Object.defineProperty(Object.prototype, itemKey, {
        configurable: true,
        enumerable: false,
        get() { return isDecorativeDefinitionMap(this) ? definition : undefined; },
        set(value) {
          // Preserve ordinary assignment semantics for unrelated objects that genuinely use this property name.
          Object.defineProperty(this, itemKey, { configurable: true, enumerable: true, writable: true, value });
        },
      });
    }
    definitionBridgeInstalled = true;
  }

  function installFurnitureKeyBridge() {
    const existing = furniture.buildFurnitureGroup;
    if (existing.__hobunjiFireItemKeyCanonicalized) return true;
    function buildFurnitureGroupWithFireAliases(key, baseColor) {
      const canonical = canonicalFireKey(key);
      if (canonical !== key) lastFireKey = `${key}->${canonical}`;
      return existing.call(this, canonical, baseColor);
    }
    Object.assign(buildFurnitureGroupWithFireAliases, existing);
    buildFurnitureGroupWithFireAliases.__hobunjiFireItemKeyCanonicalized = true;
    buildFurnitureGroupWithFireAliases.__hobunjiFireItemKeyOriginal = existing;
    furniture.buildFurnitureGroup = buildFurnitureGroupWithFireAliases;
    return true;
  }

  function blackVoidForScene(sceneRecord, mapId) {
    const root = sceneRecord?.scene;
    if (!root?.add) return null;
    let backdrop = root.getObjectByName?.(VOID_NAME) || null;
    if (!backdrop) {
      const bounds = new THREE.Box3().setFromObject(root); // Centers the backdrop around the authored room instead of assuming maps start at 0,0.
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      if (!bounds.isEmpty()) {
        bounds.getCenter(center);
        bounds.getSize(size);
      }
      const horizontalSpan = Math.max(size.x || 0, size.z || 0, 20);
      const boxSize = Math.max(240, horizontalSpan * 8); // Large enough that normal interior cameras never see past an edge.
      const boxHeight = Math.max(160, (size.y || 0) * 10 + 40);
      // This is the actual outside-of-room atmosphere: pure black and
      // deliberately unlit. Neither ambient/daylight/local lights nor fog can
      // turn it brown/gray as the church lighting changes.
      const material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthWrite: false });
      material.fog = false;
      material.toneMapped = false;
      backdrop = new THREE.Mesh(new THREE.BoxGeometry(boxSize, boxHeight, boxSize), material);
      backdrop.name = VOID_NAME;
      backdrop.position.set(center.x, 0, center.z);
      backdrop.renderOrder = -10000;
      backdrop.frustumCulled = false;
      backdrop.userData.hobunjiInteriorVoid = true;
      backdrop.userData.unlitBlack = true;
      backdrop.raycast = () => {}; // Backdrop must never block gameplay/camera interaction rays.
      root.add(backdrop);
    } else {
      for (const material of (Array.isArray(backdrop.material) ? backdrop.material : [backdrop.material]).filter(Boolean)) {
        material.color?.set?.(0x000000);
        material.fog = false;
        material.toneMapped = false;
        material.needsUpdate = true;
      }
    }
    lastVoidMapId = mapId;
    return backdrop;
  }

  function hookBuildingSceneMap(map) {
    if (!map?.set || map.__hobunjiInteriorBlackVoidSetHook) return false;
    buildingSceneMap = map;
    const originalSet = map.set.bind(map); // Chains cleanly with the floor/environment Map.set wrappers already installed.
    map.set = function setBuildingSceneWithBlackVoid(mapId, sceneRecord) {
      const result = originalSet(mapId, sceneRecord);
      queueMicrotask(() => { blackVoidForScene(sceneRecord, mapId); });
      return result;
    };
    Object.defineProperty(map, '__hobunjiInteriorBlackVoidSetHook', { value: true, configurable: true });
    for (const [mapId, sceneRecord] of map.entries()) queueMicrotask(() => { blackVoidForScene(sceneRecord, mapId); });
    return true;
  }

  function wrapGridTileAccessorsInit() {
    const namespace = window.GridTileAccessors;
    if (!namespace?.init || namespace.__hobunjiInteriorBlackVoidInitHook) return false;
    const originalInit = namespace.init;
    namespace.init = function initWithInteriorBlackVoid(injectedDeps) {
      hookBuildingSceneMap(injectedDeps?._buildingScenes);
      return originalInit.call(this, injectedDeps);
    };
    namespace.__hobunjiInteriorBlackVoidInitHook = true;
    return true;
  }

  installImmediateFireCatalog();
  installDecorativeDefinitionBridge();
  installFurnitureKeyBridge();
  wrapGridTileAccessorsInit();
  setTimeout(() => { // One bounded retry covers alternate script load order on dev/editor pages.
    installImmediateFireCatalog();
    installFurnitureKeyBridge();
    wrapGridTileAccessorsInit();
  }, 0);

  function debugSnapshot() {
    return {
      installed: true,
      definitionBridgeInstalled,
      catalogFallbackInstalled,
      campfireParts: Array.isArray(furniture.CATALOG?.campfire) ? furniture.CATALOG.campfire.length : 0,
      bonfireParts: Array.isArray(furniture.CATALOG?.bonfire) ? furniture.CATALOG.bonfire.length : 0,
      lastFireKey,
      buildingSceneMapHooked: !!buildingSceneMap?.__hobunjiInteriorBlackVoidSetHook,
      lastVoidMapId,
    };
  }

  window.InteriorFireVoidRuntime = Object.freeze({
    installed: true,
    canonicalFireKey,
    blackVoidForScene,
    debugSnapshot,
  });
  window.__interiorFireVoidDebug = debugSnapshot;
})();
