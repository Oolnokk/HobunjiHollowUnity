// Authored crop PNG integration for inventory/held art and placeholder world crops.
//
// Needlegrain and heftroot retain their foliage-builder lifecycle. Garlink and
// ongyums upgrade the generic crop cube into a three-plant PNG cluster while
// game.js continues to own growth, tile position, readiness, and persistence.
(() => {
  'use strict';

  if (window.HobunjiCropSpriteArt) return;

  const CROP_ART = Object.freeze({ // Used as the single crop-key -> authored PNG/world-render/ingredient-color policy table.
    needlegrain: Object.freeze({ spriteIcon: 'pile_needlegrain.png', worldMode: 'procedural', ingredientColor: 0x293827 }),
    heftroot: Object.freeze({ spriteIcon: 'heftroot.png', worldMode: 'procedural', ingredientColor: 0xAAA07C }),
    garlink: Object.freeze({ spriteIcon: 'garlink_bunch.png', worldMode: 'billboard', ingredientColor: 0xD1D1CB }),
    ongyums: Object.freeze({ spriteIcon: 'ongyum.png', worldMode: 'billboard', ingredientColor: 0x627F20 }),
  });
  const CROP_WORLD_ART = Object.freeze({ // Garlink/ongyums keep PNG clusters; berry crop world art is now owned by VegetationCropRendering's real shrub meshes.
    ...CROP_ART,
    redberries: Object.freeze({ spriteIcon: 'berries.png', worldMode: 'procedural', worldTint: 0xff4f62 }),
    blueberries: Object.freeze({ spriteIcon: 'berries.png', worldMode: 'procedural', worldTint: 0x5f80ff }),
    yellowberries: Object.freeze({ spriteIcon: 'berries.png', worldMode: 'procedural', worldTint: 0xffe86a }),
    whiteberries: Object.freeze({ spriteIcon: 'berries.png', worldMode: 'procedural', worldTint: 0xffffff }),
    blackberries: Object.freeze({ spriteIcon: 'berries.png', worldMode: 'procedural', worldTint: 0x17121f }),
  });
  const WORLD_COLOR_TO_CROP = new Map([ // Used to identify generic crop cubes and tag every crop root for soil anchoring; only garlink/ongyums are converted to PNGs.
    [0xd8d0b0, 'garlink'], [0xf2ead0, 'garlink'], [0x8bbf6a, 'garlink'],
    [0xc07a3d, 'ongyums'], [0xe09a4b, 'ongyums'], [0x86b95a, 'ongyums'],
    [0xb83b42, 'redberries'], [0xff4f62, 'redberries'], [0x4c9b43, 'redberries'],
    [0x3d62c8, 'blueberries'], [0x5f80ff, 'blueberries'], [0x4c9b74, 'blueberries'],
    [0xd6c345, 'yellowberries'], [0xffe86a, 'yellowberries'], [0x7ca84b, 'yellowberries'],
    [0xdcded2, 'whiteberries'], [0xffffff, 'whiteberries'], [0x8bbf8a, 'whiteberries'],
    [0x3d2a52, 'blackberries'], [0x17121f, 'blackberries'], [0x4d8a4a, 'blackberries'],
    [0x4a3b2f, 'blackMustard'], [0x1f1812, 'blackMustard'], [0x789b3a, 'blackMustard'],
    [0x6da64a, 'greenMustard'], [0x9bd66b, 'greenMustard'], [0x75b957, 'greenMustard'],
  ]);
  const CLUSTER_OFFSETS = Object.freeze([ // Used to match game.js's legacy three-heftroot triangle footprint for garlink and ongyums too.
    Object.freeze([-0.20, 0, 0.14]),
    Object.freeze([0.22, 0, 0.14]),
    Object.freeze([0.0, 0, -0.22]),
  ]);
  const CLUSTER_PLANT_SCALE = 0.25; // Used to make each garlink/ongyums plant half the size of the former 0.5-scale single billboard.
  const textureRecords = new Map(); // Used to load each authored crop PNG once and share it across every planted tile.
  const pendingMeshes = new Map(); // Used to retain placeholder meshes while their shared crop texture is loading.
  const activeBillboards = new Set(); // Used to re-face converted crop cluster anchors toward the current camera every render.
  const CROP_DISCOVERY_SCAN_INTERVAL_MS = 250; // Used to discover newly planted placeholders promptly without tying full-scene traversal frequency to frame rate or extra render passes.
  const registeredPlaceholders = new Set(); // Newly created modern crop anchors, consumed before the next world draw.
  let legacyDiscoveryForced = false; // Compatibility/debug escape hatch for older custom crop builders.
  let registeredCropCount = 0; // Mobile diagnostics count explicit crop registrations.
  const hasRegisteredSources = () => window.VegetationCropRendering?.registersCropSpritePlaceholders === true
    && window.NpcFarmPlots?.registersCropSpritePlaceholders === true; // Both producers must be current before stopping periodic legacy scans.
  const sceneScanDeadlines = new WeakMap(); // Used to throttle each rendered scene independently when UI/depth replay passes render more than one scene.
  let discoveryScanCount = 0; // Used by the mobile-readable crop diagnostics to confirm crop-free scenes are no longer traversed every render.
  let lastDiscoveryObjectCount = 0; // Used to expose the most recent scan's scene size when investigating an unexpectedly expensive wilderness area.
  let lastDiscoveryScanAt = 0; // Used to expose when the last throttled placeholder scan actually ran.
  let lastItemSync = { ok: false, patchedDefs: 0, patchedEntries: 0 }; // Used by lightweight debug/tests to verify canonical item art wiring.

  function applyItemArt(injectedDeps) {
    const ITEM_DEFS = injectedDeps?.ITEM_DEFS; // Used to patch the canonical definitions read by inventory icons and held-item planes.
    const inventoryItems = injectedDeps?.inventoryItems; // Used to patch selectable scroll entries immediately, before/alongside metadata synchronization.
    if (!ITEM_DEFS) {
      lastItemSync = { ok: false, patchedDefs: 0, patchedEntries: 0 };
      return { ...lastItemSync };
    }

    let patchedDefs = 0; // Used to report how many canonical harvested-crop definitions received authored PNG art.
    let patchedEntries = 0; // Used to report how many selectable inventory entries received the same direct sprite metadata.
    for (const [cropKey, art] of Object.entries(CROP_ART)) {
      const def = ITEM_DEFS[cropKey]; // Used as the authoritative item definition consumed by applyItemSpriteIcon/updateHeldItemHolder.
      if (def) {
        def.spriteIcon = art.spriteIcon;
        def.spriteMode = 'direct';
        def.ingredientColor = art.ingredientColor; // Used by processed foods/drinks without tinting the crop's own source PNG.
        delete def.spriteColor;
        patchedDefs++;
      }
      if (Array.isArray(inventoryItems)) {
        const entry = inventoryItems.find(item => item?.key === cropKey); // Used so current item-scroll selections see PNG metadata without waiting for a later registry refresh.
        if (entry) {
          entry.spriteIcon = art.spriteIcon;
          entry.spriteMode = 'direct';
          entry.ingredientColor = art.ingredientColor; // Mirrors the canonical definition for processors reading the selectable entry.
          delete entry.spriteColor;
          patchedEntries++;
        }
      }
    }

    window.ObjectSpriteCatalog?.applyAll?.(injectedDeps); // Covers static gathered/processed inventory items alongside the crop-specific authored art.
    lastItemSync = { ok: true, patchedDefs, patchedEntries };
    return { ...lastItemSync };
  }

  function patchCookingSystem(api) {
    if (!api?.init || api.__cropSpriteArtPatched) return;
    const originalInit = api.init.bind(api); // Used to preserve CookingSystem initialization before applying crop-specific presentation metadata.
    api.init = function cropSpriteArtInit(injectedDeps = {}, ...rest) {
      const result = originalInit(injectedDeps, ...rest);
      applyItemArt(injectedDeps);
      return result;
    };
    api.__cropSpriteArtPatched = true;
  }

  function installCookingSystemHook() {
    if (window.CookingSystem) {
      patchCookingSystem(window.CookingSystem);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'CookingSystem'); // Used to chain cleanly with the inventory metadata bridge's own future-global hook.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get; // Used to preserve any earlier lazy/global CookingSystem reader.
    const previousSet = descriptor?.set; // Used to preserve any earlier CookingSystem assignment hook.
    let value = descriptor?.value; // Used as local storage only when no earlier accessor owns the global.
    Object.defineProperty(window, 'CookingSystem', {
      configurable: true,
      get() {
        return previousGet ? previousGet.call(window) : value;
      },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        const current = previousGet ? previousGet.call(window) : value; // Used to patch whichever API the chained accessor exposes after assignment.
        patchCookingSystem(current);
      },
    });
  }

  function installNeedlegrainRootTag() {
    const foliage = window.FoliageGenerator; // Used to tag procedural needlegrain roots for flood/soil presentation without changing its geometry.
    if (!foliage?.buildNeedlegrainMesh || foliage.__hobunjiNeedlegrainCropRootTagged) return;
    const originalBuildNeedlegrainMesh = foliage.buildNeedlegrainMesh.bind(foliage); // Used to preserve the procedural builder byte-for-byte apart from presentation metadata.
    foliage.buildNeedlegrainMesh = function taggedNeedlegrainMesh(...args) {
      const group = originalBuildNeedlegrainMesh(...args);
      if (group?.userData) group.userData.hobunjiCropRootKey = 'needlegrain';
      return group;
    };
    foliage.__hobunjiNeedlegrainCropRootTagged = true;
  }

  function isUnitCropCube(mesh) {
    const geometry = mesh?.geometry; // Used to constrain crop discovery to game.js's generic 1x1x1 crop placeholder geometry.
    const params = geometry?.parameters; // Used to verify exact BoxGeometry authoring dimensions rather than matching unrelated Lambert meshes.
    if (!mesh?.isMesh || mesh.userData?.hobunjiCropSpriteKey || !mesh.material?.isMeshLambertMaterial || !params) return false;
    if (geometry.type !== 'BoxGeometry') return false;
    if (Math.abs(Number(params.width) - 1) > 0.0001 || Math.abs(Number(params.height) - 1) > 0.0001 || Math.abs(Number(params.depth) - 1) > 0.0001) return false;
    const color = mesh.material.color?.getHex?.(); // Used only as a legacy fallback for the two formerly supported untagged PNG crops.
    const baseKey = mesh.userData?.hobunjiCropBaseKey; // Modern farm and NPC crop builders tag their genuine species, including every regional genotype.
    const legacyKey = WORLD_COLOR_TO_CROP.get(color); // Old garlink/ongyums cube meshes may predate the species tag.
    if (baseKey ? !CROP_WORLD_ART[baseKey] : legacyKey !== 'garlink' && legacyKey !== 'ongyums') return false; // Never turn unrelated white/berry-colored scenery into crops.
    const sx = Number(mesh.scale?.x); // Used with sy/sz to reject ordinary world cubes that happen to share a crop color.
    const sy = Number(mesh.scale?.y); // Used to verify game.js's crop placeholder keeps a uniform growth scale.
    const sz = Number(mesh.scale?.z); // Used to verify game.js's crop placeholder keeps a uniform growth scale.
    if (!Number.isFinite(sx) || Math.abs(sx - sy) > 0.0001 || Math.abs(sx - sz) > 0.0001 || sx < 0.14 || sx > 1.01) return false;
    const xFrac = Math.abs((Number(mesh.position?.x) || 0) % 1 - 0.5); // Used to require the half-tile X center game.js assigns to planted crops.
    const zFrac = Math.abs((Number(mesh.position?.z) || 0) % 1 - 0.5); // Used to require the half-tile Z center game.js assigns to planted crops.
    return xFrac < 0.01 && zFrac < 0.01;
  }

  function makeClusterPlant(cropKey, aspect, texture, index, pigment = null, painted = false) {
    const geometry = new window.THREE.PlaneGeometry(aspect, 1); // Used to preserve the authored PNG aspect for this cluster member.
    const material = new window.THREE.MeshBasicMaterial({
      map: texture,
      color: painted ? 0xffffff : (pigment ?? 0xffffff), // A shade-filled texture already carries the entire inherited color; never tint it twice.
      transparent: false,
      alphaTest: window.HobunjiSpritePngSurface?.alphaTest?.() ?? 0.04,
      side: window.THREE.DoubleSide,
      depthWrite: true,
    });
    const plant = new window.THREE.Mesh(geometry, material); // Used as one of the three visible plants attached to the game-owned crop anchor.
    const [x, y, z] = CLUSTER_OFFSETS[index];
    plant.position.set(x, y, z);
    plant.scale.setScalar(CLUSTER_PLANT_SCALE);
    plant.castShadow = false;
    plant.receiveShadow = false;
    plant.userData.noOutline = true; // Inverted hull outlines would fill the transparent area of the authored berry/vegetable sprite.
    plant.userData.hobunjiCropSpriteKey = cropKey;
    plant.userData.hobunjiCropClusterMember = true;
    plant.userData.hobunjiCropClusterIndex = index;
    return plant;
  }

  function convertMeshToBillboard(mesh, cropKey, texture, pigment = null, painted = false) {
    if (!mesh?.parent || mesh.userData?.hobunjiCropSpriteKey || !texture?.image) return;
    const imageWidth = Math.max(1, Number(texture.image.naturalWidth || texture.image.width) || 1); // Used to preserve the authored PNG's horizontal aspect ratio in world space.
    const imageHeight = Math.max(1, Number(texture.image.naturalHeight || texture.image.height) || 1); // Used with imageWidth to keep the billboard from stretching square.
    const aspect = imageWidth / imageHeight; // Used as every cluster plane's width while game.js continues owning the anchor's scalar growth size.

    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
    mesh.geometry = new window.THREE.BufferGeometry(); // Used to turn the former cube into an invisible transform anchor without changing game.js's cropMeshes ownership.
    mesh.material = new window.THREE.MeshBasicMaterial({ color: 0xffffff, visible: false }); // Used to keep game.js's material.color writes valid while the anchor itself draws no geometry.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.hobunjiCropSpriteKey = cropKey;
    mesh.userData.hobunjiCropRootKey = cropKey;
    mesh.userData.hobunjiCropSpriteAspect = aspect;
    mesh.userData.hobunjiCropSpritePigment = pigment;
    mesh.userData.hobunjiCropSpritePainted = painted;
    mesh.userData.hobunjiCropClusterCount = CLUSTER_OFFSETS.length;

    for (let index = 0; index < CLUSTER_OFFSETS.length; index++) {
      mesh.add(makeClusterPlant(cropKey, aspect, texture, index, pigment, painted));
    }
    activeBillboards.add(mesh);
  }

  function textureKeyFor(cropKey, pigment) {
    return cropKey + ':' + (pigment == null ? 'native' : pigment.toString(16).padStart(6, '0'));
  }

  function flushPending(textureKey, cropKey, pigment, texture, painted) {
    const meshes = pendingMeshes.get(textureKey); // Used to upgrade all crops sharing exactly this source image and inherited color.
    if (!meshes) return;
    for (const mesh of meshes) convertMeshToBillboard(mesh, cropKey, texture, pigment, painted);
    pendingMeshes.delete(textureKey);
  }

  function ensureTexture(cropKey, pigment) {
    const art = CROP_WORLD_ART[cropKey]; // All berry species share authored berries.png while each inherited color has its own cached fill.
    if (!art || art.worldMode !== 'billboard' || !window.THREE?.TextureLoader) return null;
    const textureKey = textureKeyFor(cropKey, pigment); // Keeps existing native art separate from every hue-coded cultivar.
    const existing = textureRecords.get(textureKey);
    if (existing) return existing;
    const record = { textureKey, texture: null, loaded: false, failed: false, painted: false, pigment }; // Shared loading state for one crop/source/color combination.
    textureRecords.set(textureKey, record);
    const sourcePath = `assets/objectsprites/${art.spriteIcon}`; // Reuses the same authored PNG as pack art, with no duplicate species asset.

    if (pigment != null && window.SpriteRecolor?.getRecoloredCanvas && window.HobunjiSpritePngSurface?.makeCanvasTexture) {
      // The inventory's existing shade-fill routine retains painted highlights and silhouette alpha.
      // A Three.js material multiplier would turn red or white berries nearly black on the green source sprite.
      window.SpriteRecolor.getRecoloredCanvas(sourcePath, pigment, 'direct')
        .then(canvas => {
          const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(window.THREE, canvas, 'crop-' + textureKey);
          record.texture = texture;
          record.loaded = true;
          record.painted = true;
          flushPending(textureKey, cropKey, pigment, texture, true);
        })
        .catch(error => {
          record.failed = true; // No silent green base art that misrepresents a cultivar's inherited pigment.
          pendingMeshes.delete(textureKey);
          window.__farmLog?.(`[crop-art] recolor failed ${textureKey}: ${error?.message || error}`, 'warn');
        });
      return record;
    }

    const loader = new window.THREE.TextureLoader(); // Native garlink/ongyums use original PNGs; test harnesses without a recolorer preserve the legacy tint fallback.
    record.texture = loader.load(
      sourcePath,
      texture => {
        if (window.THREE.sRGBEncoding !== undefined) texture.encoding = window.THREE.sRGBEncoding;
        texture.needsUpdate = true;
        record.loaded = true;
        flushPending(textureKey, cropKey, pigment, texture, false);
      },
      undefined,
      error => {
        record.failed = true;
        pendingMeshes.delete(textureKey);
        window.__farmLog?.(`[crop-art] failed to load ${art.spriteIcon}: ${error?.message || error || 'unknown error'}`, 'warn');
      },
    );
    return record;
  }

  function queueBillboard(mesh, cropKey) {
    const art = CROP_WORLD_ART[cropKey]; // Base species selects the actual PNG; genotype only changes its color.
    const rawColor = mesh.userData?.hobunjiCropVarietyColor ?? art?.worldTint ?? null; // Native berries need their own fruit color too.
    const pigment = rawColor != null && Number.isFinite(Number(rawColor)) ? (Number(rawColor) & 0xffffff) : null;
    const record = ensureTexture(cropKey, pigment);
    if (!record || record.failed) return;
    if (record.loaded && record.texture?.image) {
      convertMeshToBillboard(mesh, cropKey, record.texture, pigment, record.painted);
      return;
    }
    let meshes = pendingMeshes.get(record.textureKey); // One async shade-fill result services every plant with the same genotype pigment.
    if (!meshes) {
      meshes = new Set();
      pendingMeshes.set(record.textureKey, meshes);
    }
    meshes.add(mesh);
  }

  function onPlaceholderAdded() { registerPlaceholder(this); } // Object3D event catches standalone crops attached after their builder returns.

  function registerPlaceholder(mesh) {
    const cropKey = mesh?.userData?.hobunjiCropBaseKey; // Authoritative species identity from the farm/NPC crop builder.
    if (!mesh?.isMesh || mesh.userData.hobunjiCropSpriteKey || CROP_WORLD_ART[cropKey]?.worldMode !== 'billboard') return false;
    if (!mesh.parent && mesh.addEventListener) {
      mesh.addEventListener('added', onPlaceholderAdded);
      return true;
    }
    if (!registeredPlaceholders.has(mesh)) registeredCropCount++;
    registeredPlaceholders.add(mesh);
    return true;
  }

  function processRegisteredPlaceholders() {
    for (const mesh of registeredPlaceholders) {
      registeredPlaceholders.delete(mesh);
      // The producer queues on creation/attachment, and finishes its transform
      // before this frame hook. A harvested or replaced crop must not convert.
      if (!mesh.parent || mesh.userData.hobunjiCropSpriteKey) continue;
      const cropKey = mesh.userData.hobunjiCropBaseKey;
      if (CROP_WORLD_ART[cropKey]?.worldMode === 'billboard') queueBillboard(mesh, cropKey);
    }
  }

  function discoverPlaceholderCrops(scene) {
    let inspected = 0; // Counts visited scene nodes for the debug snapshot without requiring a second traversal.
    scene?.traverse?.(object => {
      inspected++;
      if (!isUnitCropCube(object)) return;
      const color = object.material.color.getHex(); // Used to map game.js's exact current growth/ripe palette back to a crop key.
      const cropKey = object.userData?.hobunjiCropBaseKey || WORLD_COLOR_TO_CROP.get(color); // Regional garlink/ongyums keep their three-plant PNGs.
      if (!cropKey) return;
      object.userData.hobunjiCropRootKey = cropKey; // Used by crop-billboard-presentation to remove water-surface lift from every generic farm crop, even ones that stay cubes.
      if (CROP_WORLD_ART[cropKey]?.worldMode === 'billboard') queueBillboard(object, cropKey);
    });
    discoveryScanCount++;
    lastDiscoveryObjectCount = inspected;
    lastDiscoveryScanAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function updateBillboards(scene, camera) {
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); // Used to make discovery cadence independent of FPS and renderer pass count.
    const nextScanAt = scene && sceneScanDeadlines.get(scene);
    // Initial scan adopts any pre-existing anchors (including legacy saves or
    // module load-order races). Current producers then register new anchors;
    // older/standalone integrations retain their original 250ms discovery.
    const periodicDiscovery = legacyDiscoveryForced || !hasRegisteredSources();
    processRegisteredPlaceholders();
    if (scene && (!Number.isFinite(nextScanAt) || (periodicDiscovery && now >= nextScanAt))) {
      sceneScanDeadlines.set(scene, now + CROP_DISCOVERY_SCAN_INTERVAL_MS);
      discoverPlaceholderCrops(scene);
    }
    for (const anchor of activeBillboards) {
      if (!anchor?.parent) {
        activeBillboards.delete(anchor);
        continue;
      }
      // game.js writes the old placeholder color/rotation each frame. The
      // invisible anchor keeps its authored world-space triangle unrotated;
      // each child plane independently copies the active camera quaternion.
      anchor.material?.color?.setHex?.(0xffffff);
      anchor.quaternion?.identity?.();
      for (const plant of anchor.children || []) {
        plant.material?.color?.setHex?.(anchor.userData.hobunjiCropSpritePainted ? 0xffffff : (anchor.userData.hobunjiCropSpritePigment ?? 0xffffff)); // Keep shade-filled textures untinted on every render pass.
        if (camera?.quaternion && plant.userData?.hobunjiCropClusterMember) plant.quaternion.copy(camera.quaternion);
      }
    }
  }

  function installRenderHook() {
    // Billboard facing is idempotent for one camera, so it runs once per world
    // frame (js/render-hooks.js) instead of on every outline/replay pass.
    if (window.RenderHooks?.register) {
      window.RenderHooks.register({
        id: 'crop-sprite-art',
        owner: 'crop-sprite-art.js',
        order: window.RenderHooks.ORDER.CROP_SPRITE_ART,
        scope: 'frame',
        before: ctx => updateBillboards(ctx.scene, ctx.camera),
      });
      return;
    }
    const prototype = window.THREE?.WebGLRenderer?.prototype; // Fallback for pages without render-hooks.js: wrap render() directly.
    if (!prototype || prototype.__hobunjiCropSpriteArtHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render; // Used to preserve the full existing render hook chain while crop billboards update first.
    prototype.render = function cropSpriteArtRender(scene, camera, ...rest) {
      updateBillboards(scene, camera);
      return previousRender.call(this, scene, camera, ...rest);
    };
    // held-object-render-order.js's internal depth-replay passes look for the
    // TRUE, undecorated render() by walking a chain of __hobunji*Original
    // markers (see its unwrapRendererRender) — without this marker those
    // replay passes stop unwrapping here instead of reaching the real render.
    prototype.render.__hobunjiCropSpriteArtOriginal = previousRender;
    prototype.__hobunjiCropSpriteArtHooked = true;
  }

  installNeedlegrainRootTag();
  installCookingSystemHook();
  installRenderHook();

  window.HobunjiCropSpriteArt = {
    getArt: cropKey => CROP_ART[cropKey] ? { ...CROP_ART[cropKey] } : null,
    applyItemArt,
    registerPlaceholder,
    setLegacyDiscoveryEnabled(value) { legacyDiscoveryForced = value === true; return legacyDiscoveryForced; },
    getDebug: () => ({
      ...lastItemSync,
      activeBillboards: activeBillboards.size,
      loadedTextures: [...textureRecords.values()].filter(record => record.loaded).length,
      paintedTextures: [...textureRecords.values()].filter(record => record.painted).length, // Mobile diagnostics distinguish real shade-fill from the legacy multiplier fallback.
      pendingTextures: [...textureRecords.values()].filter(record => !record.loaded && !record.failed).length,
      failedTextures: [...textureRecords.values()].filter(record => record.failed).length,
      clusterCount: CLUSTER_OFFSETS.length,
      clusterPlantScale: CLUSTER_PLANT_SCALE,
      discoveryScanIntervalMs: CROP_DISCOVERY_SCAN_INTERVAL_MS,
      discoveryScanCount,
      registeredCropCount,
      pendingRegisteredCrops: registeredPlaceholders.size,
      periodicDiscovery: legacyDiscoveryForced || !hasRegisteredSources(),
      lastDiscoveryObjectCount,
      lastDiscoveryScanAt: Math.round(lastDiscoveryScanAt),
      lastChange: 'Modern farm and NPC crop builders register new anchors; legacy discovery stays time-throttled per scene.',
    }),
  };
})();
