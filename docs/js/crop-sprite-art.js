// Authored crop PNG integration for inventory/held art and placeholder world crops.
//
// Needlegrain and heftroot retain their foliage-builder lifecycle. Garlink and
// ongyums upgrade the generic crop cube into a three-plant PNG cluster while
// game.js continues to own growth, tile position, readiness, and persistence.
(() => {
  'use strict';

  if (window.HobunjiCropSpriteArt) return;

  const CROP_ART = Object.freeze({ // Used as the single crop-key -> authored PNG/world-render policy table.
    needlegrain: Object.freeze({ spriteIcon: 'pile_needlegrain.png', worldMode: 'procedural' }),
    heftroot: Object.freeze({ spriteIcon: 'heftroot.png', worldMode: 'procedural' }),
    garlink: Object.freeze({ spriteIcon: 'garlink_bunch.png', worldMode: 'billboard' }),
    ongyums: Object.freeze({ spriteIcon: 'ongyum.png', worldMode: 'billboard' }),
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
  let renderScanTick = 0; // Used to discover newly planted placeholder crops periodically instead of traversing the full scene every frame.
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
        delete def.spriteColor;
        patchedDefs++;
      }
      if (Array.isArray(inventoryItems)) {
        const entry = inventoryItems.find(item => item?.key === cropKey); // Used so current item-scroll selections see PNG metadata without waiting for a later registry refresh.
        if (entry) {
          entry.spriteIcon = art.spriteIcon;
          entry.spriteMode = 'direct';
          delete entry.spriteColor;
          patchedEntries++;
        }
      }
    }

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
    const color = mesh.material.color?.getHex?.(); // Used to distinguish crop placeholders from unrelated unit cubes by the authored crop palette.
    if (!WORLD_COLOR_TO_CROP.has(color)) return false;
    const sx = Number(mesh.scale?.x); // Used with sy/sz to reject ordinary world cubes that happen to share a crop color.
    const sy = Number(mesh.scale?.y); // Used to verify game.js's crop placeholder keeps a uniform growth scale.
    const sz = Number(mesh.scale?.z); // Used to verify game.js's crop placeholder keeps a uniform growth scale.
    if (!Number.isFinite(sx) || Math.abs(sx - sy) > 0.0001 || Math.abs(sx - sz) > 0.0001 || sx < 0.14 || sx > 1.01) return false;
    const xFrac = Math.abs((Number(mesh.position?.x) || 0) % 1 - 0.5); // Used to require the half-tile X center game.js assigns to planted crops.
    const zFrac = Math.abs((Number(mesh.position?.z) || 0) % 1 - 0.5); // Used to require the half-tile Z center game.js assigns to planted crops.
    return xFrac < 0.01 && zFrac < 0.01;
  }

  function makeClusterPlant(cropKey, aspect, texture, index) {
    const geometry = new window.THREE.PlaneGeometry(aspect, 1); // Used to preserve the authored PNG aspect for this cluster member.
    const material = new window.THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.04,
      side: window.THREE.DoubleSide,
      depthWrite: true,
    });
    const plant = new window.THREE.Mesh(geometry, material); // Used as one of the three visible plants attached to the game-owned crop anchor.
    const [x, y, z] = CLUSTER_OFFSETS[index];
    plant.position.set(x, y, z);
    plant.scale.setScalar(CLUSTER_PLANT_SCALE);
    plant.castShadow = false;
    plant.receiveShadow = false;
    plant.userData.hobunjiCropSpriteKey = cropKey;
    plant.userData.hobunjiCropClusterMember = true;
    plant.userData.hobunjiCropClusterIndex = index;
    return plant;
  }

  function convertMeshToBillboard(mesh, cropKey, texture) {
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
    mesh.userData.hobunjiCropClusterCount = CLUSTER_OFFSETS.length;

    for (let index = 0; index < CLUSTER_OFFSETS.length; index++) {
      mesh.add(makeClusterPlant(cropKey, aspect, texture, index));
    }
    activeBillboards.add(mesh);
  }

  function flushPending(cropKey, texture) {
    const meshes = pendingMeshes.get(cropKey); // Used to upgrade every crop tile that waited on this one shared PNG load.
    if (!meshes) return;
    for (const mesh of meshes) convertMeshToBillboard(mesh, cropKey, texture);
    pendingMeshes.delete(cropKey);
  }

  function ensureTexture(cropKey) {
    const art = CROP_ART[cropKey]; // Used to resolve the authored filename for a billboard-eligible crop.
    if (!art || art.worldMode !== 'billboard' || !window.THREE?.TextureLoader) return null;
    const existing = textureRecords.get(cropKey); // Used to reuse a loaded or in-flight texture request for all matching crop meshes.
    if (existing) return existing;
    const record = { texture: null, loaded: false, failed: false }; // Used to track this crop texture's async state without issuing duplicate requests.
    textureRecords.set(cropKey, record);
    const loader = new window.THREE.TextureLoader(); // Used for the same browser/Three.js asset path semantics as other game object sprites.
    record.texture = loader.load(
      `assets/objectsprites/${art.spriteIcon}`,
      texture => {
        if (window.THREE.sRGBEncoding !== undefined) texture.encoding = window.THREE.sRGBEncoding;
        texture.needsUpdate = true;
        record.loaded = true;
        flushPending(cropKey, texture);
      },
      undefined,
      error => {
        record.failed = true;
        pendingMeshes.delete(cropKey);
        window.__farmLog?.(`[crop-art] failed to load ${art.spriteIcon}: ${error?.message || error || 'unknown error'}`, 'warn');
      },
    );
    return record;
  }

  function queueBillboard(mesh, cropKey) {
    const record = ensureTexture(cropKey); // Used to either convert immediately or park this mesh until its shared texture finishes loading.
    if (!record || record.failed) return;
    if (record.loaded && record.texture?.image) {
      convertMeshToBillboard(mesh, cropKey, record.texture);
      return;
    }
    let meshes = pendingMeshes.get(cropKey); // Used to collect all currently visible placeholder tiles for the same pending crop PNG.
    if (!meshes) {
      meshes = new Set();
      pendingMeshes.set(cropKey, meshes);
    }
    meshes.add(mesh);
  }

  function discoverPlaceholderCrops(scene) {
    scene?.traverse?.(object => {
      if (!isUnitCropCube(object)) return;
      const color = object.material.color.getHex(); // Used to map game.js's exact current growth/ripe palette back to a crop key.
      const cropKey = WORLD_COLOR_TO_CROP.get(color);
      if (!cropKey) return;
      object.userData.hobunjiCropRootKey = cropKey; // Used by crop-billboard-presentation to remove water-surface lift from every generic farm crop, even ones that stay cubes.
      if (CROP_ART[cropKey]?.worldMode === 'billboard') queueBillboard(object, cropKey);
    });
  }

  function updateBillboards(scene, camera) {
    renderScanTick = (renderScanTick + 1) % 12;
    if (renderScanTick === 0 || activeBillboards.size === 0) discoverPlaceholderCrops(scene);
    for (const anchor of [...activeBillboards]) {
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
        plant.material?.color?.setHex?.(0xffffff);
        if (camera?.quaternion && plant.userData?.hobunjiCropClusterMember) plant.quaternion.copy(camera.quaternion);
      }
    }
  }

  function installRenderHook() {
    const prototype = window.THREE?.WebGLRenderer?.prototype; // Used as the shared render boundary after combat-config-loader makes r128 render hookable.
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
    getDebug: () => ({
      ...lastItemSync,
      activeBillboards: activeBillboards.size,
      loadedTextures: [...textureRecords.values()].filter(record => record.loaded).length,
      clusterCount: CLUSTER_OFFSETS.length,
      clusterPlantScale: CLUSTER_PLANT_SCALE,
    }),
  };
})();
