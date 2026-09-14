// Main-game render proxies for Debris-ifier V50 wall planes.
// V50's exact PlaneGeometry and transforms remain authoritative for layout/collision;
// this module only recreates their render resources in the parent game THREE realm.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!window.THREE || !GridTileAccessors || !DS) return;

  let preparedRoot = null;
  let preparedScene = null; // Used to detect scene swaps even if a stale V50 root survives briefly.
  let proxyRoot = null; // Used as the game-realm-only parent for all visible wall proxies.
  const proxies = new Set();

  function activeScene() {
    if (GridTileAccessors.getCurrentArea?.() !== MAP_ID) return null;
    return GridTileAccessors.getActiveScene?.() || null;
  }

  function activeRoot(scene = activeScene()) {
    if (!scene) return null;
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  function sourceMaterials(mesh) {
    if (!mesh?.material) return [];
    return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
  }

  function cloneGeometry(source) {
    if (!source?.attributes?.position) return null;
    const geometry = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(source.attributes || {})) {
      if (!attr?.array || !attr.itemSize) continue;
      // V50 wall planes use ordinary float attributes. Rebuilding them here
      // prevents the game renderer from depending on an iframe THREE prototype.
      const values = Array.from(attr.array, Number);
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attr.itemSize, !!attr.normalized));
    }
    if (source.index?.array) geometry.setIndex(Array.from(source.index.array, Number));
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function cloneTexture(source) {
    if (!source?.image) return null;
    let image = source.image;
    try {
      const width = Number(image.videoWidth || image.naturalWidth || image.width) || 0;
      const height = Number(image.videoHeight || image.naturalHeight || image.height) || 0;
      if (width > 0 && height > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(image, 0, 0, width, height);
        if (ctx) image = canvas;
      }
    } catch (_) {
      // Same-origin V50 normally lets us copy the image. If a browser refuses,
      // the parent THREE texture can still consume the original image object.
    }
    const texture = new THREE.Texture(image);
    if (source.wrapS != null) texture.wrapS = source.wrapS;
    if (source.wrapT != null) texture.wrapT = source.wrapT;
    if (source.magFilter != null) texture.magFilter = source.magFilter;
    if (source.minFilter != null) texture.minFilter = source.minFilter;
    if (source.flipY != null) texture.flipY = source.flipY;
    if (source.repeat) texture.repeat.copy?.(source.repeat);
    if (source.offset) texture.offset.copy?.(source.offset);
    if (source.center) texture.center.copy?.(source.center);
    if (Number.isFinite(Number(source.rotation))) texture.rotation = Number(source.rotation);
    if ('colorSpace' in texture && source.colorSpace != null) texture.colorSpace = source.colorSpace;
    if ('encoding' in texture && source.encoding != null) texture.encoding = source.encoding;
    texture.needsUpdate = true;
    return texture;
  }

  function cloneMaterial(source) {
    const color = source?.color?.getHex?.() ?? 0x545039;
    const material = new THREE.MeshStandardMaterial({
      color,
      map: cloneTexture(source?.map),
      roughness: Number.isFinite(Number(source?.roughness)) ? Number(source.roughness) : .92,
      metalness: Number.isFinite(Number(source?.metalness)) ? Number(source.metalness) : .02,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
    });
    material.name = `${source?.name || 'v50_wall'}_game_realm`;
    material.needsUpdate = true;
    return material;
  }

  function matrixElementsAreFinite(matrix) {
    const elements = matrix?.elements; // Used to reject stale/incomplete source transforms before copying them.
    return !!elements && elements.length === 16 && Array.from(elements).every(value => Number.isFinite(Number(value)));
  }

  function ensureProxyRoot(scene) {
    if (!scene) return null;
    if (proxyRoot?.parent === scene) return proxyRoot;
    if (proxyRoot?.parent) proxyRoot.parent.remove(proxyRoot);
    proxyRoot = new THREE.Group();
    proxyRoot.name = 'dev_random_ruin_wall_render_proxies';
    proxyRoot.userData.devRandomRuinWallProxyRoot = true;
    scene.add(proxyRoot);
    proxyRoot.updateWorldMatrix?.(true, false);
    return proxyRoot;
  }

  function copySourceWorldTransform(wall, proxy, scene) {
    if (!wall || !proxy || !scene) return false;
    wall.updateWorldMatrix?.(true, false);
    if (!wall.updateWorldMatrix) wall.updateMatrixWorld?.(true);
    scene.updateWorldMatrix?.(true, false);
    proxyRoot?.updateWorldMatrix?.(true, false);
    if (!matrixElementsAreFinite(wall.matrixWorld) || !matrixElementsAreFinite(proxyRoot?.matrixWorld)) return false;

    const sourceWorld = new THREE.Matrix4(); // Used to hold the V50 wall's numeric world transform in the game THREE realm.
    const parentWorldInverse = new THREE.Matrix4(); // Used to convert source world space into the proxy root's local space.
    const localMatrix = new THREE.Matrix4(); // Used as the proxy's fixed local matrix beneath the game-realm proxy root.
    sourceWorld.fromArray(Array.from(wall.matrixWorld.elements, Number));
    parentWorldInverse.fromArray(Array.from(proxyRoot.matrixWorld.elements, Number)).invert();
    localMatrix.multiplyMatrices(parentWorldInverse, sourceWorld);
    if (!matrixElementsAreFinite(localMatrix)) return false;

    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(localMatrix);
    proxy.matrixWorldNeedsUpdate = true;
    proxy.updateMatrixWorld?.(true);
    return true;
  }

  function disposeProxy(proxy) {
    const sourceWall = proxy?.userData?.sourceRuinWall || null; // Used to remove the source-to-proxy back-reference during cleanup.
    if (sourceWall?.userData?.devRuinWallRenderProxy === proxy) {
      delete sourceWall.userData.devRuinWallRenderProxy;
      delete sourceWall.userData.runtimeWallPlaneRenderRealm;
    }
    if (proxy?.userData) delete proxy.userData.sourceRuinWall;
    proxy?.geometry?.dispose?.();
    const materials = Array.isArray(proxy?.material) ? proxy.material : proxy?.material ? [proxy.material] : [];
    for (const material of materials) {
      material?.map?.dispose?.();
      material?.dispose?.();
    }
    proxy?.parent?.remove?.(proxy);
    proxies.delete(proxy);
  }

  function clearProxies() {
    for (const proxy of [...proxies]) disposeProxy(proxy);
    proxyRoot?.parent?.remove?.(proxyRoot);
    proxyRoot = null;
    preparedRoot = null;
    preparedScene = null;
  }

  function buildProxy(wall, scene) {
    const geometry = cloneGeometry(wall.geometry);
    if (!geometry) return null;
    const source = sourceMaterials(wall)[0] || null;
    const material = cloneMaterial(source);
    const proxy = new THREE.Mesh(geometry, material);
    proxy.name = `${wall.name || `ruin_wall_${wall.id}`}_runtime_render`;
    proxy.userData.devRuinWallRenderProxy = true;
    proxy.userData.prototypeWallName = wall.name || null;
    proxy.userData.sourceRuinWall = wall;
    proxy.frustumCulled = false;
    proxy.castShadow = true;
    proxy.receiveShadow = true;
    proxy.renderOrder = Number(wall.renderOrder) || 0;
    // These are visual-only meshes. Prevent broad scene raycasts from choosing a
    // render proxy instead of the V50 ladder/mechanism that owns an interaction.
    proxy.raycast = () => {};

    const root = ensureProxyRoot(scene); // Used to keep the visible mesh wholly inside the game THREE object graph.
    if (!root) {
      disposeProxy(proxy);
      return null;
    }
    root.add(proxy);
    if (!copySourceWorldTransform(wall, proxy, scene)) {
      disposeProxy(proxy);
      return null;
    }

    proxies.add(proxy);
    wall.userData.devRuinWallRenderProxy = proxy;
    wall.userData.runtimeWallPlaneRenderRealm = 'game-scene-proxy';
    return proxy;
  }

  function desiredVisible() {
    return window.DevRandomRuinWallPlanes?.isVisible?.() !== false;
  }

  function prepare(root = null) {
    const scene = activeScene(); // Used as the only parent realm for visible proxy geometry this frame.
    const resolvedRoot = root || activeRoot(scene); // Used as the V50 source hierarchy for wall layout/collision data.
    if (!scene || !resolvedRoot) {
      if (preparedRoot || preparedScene || proxyRoot) clearProxies();
      return snapshot(resolvedRoot, scene);
    }
    if (resolvedRoot !== preparedRoot || scene !== preparedScene) {
      clearProxies();
      preparedRoot = resolvedRoot;
      preparedScene = scene;
      ensureProxyRoot(scene);
      resolvedRoot.traverse(object => {
        if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
        // The source mesh stays present for collision/bounds, but its iframe
        // material never participates in the game renderer.
        object.visible = true;
        for (const material of sourceMaterials(object)) {
          material.visible = false;
          material.needsUpdate = true;
        }
        buildProxy(object, scene);
      });
    }

    const visible = desiredVisible();
    for (const proxy of [...proxies]) {
      const sourceWall = proxy?.userData?.sourceRuinWall || null; // Used to refresh source-derived placement before each render.
      if (!proxy.parent || !sourceWall || !copySourceWorldTransform(sourceWall, proxy, scene)) {
        disposeProxy(proxy);
        continue;
      }
      const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
      for (const material of materials) material.visible = visible;
      proxy.visible = visible;
    }

    // The older optional-wall controller may re-enable the source iframe
    // materials earlier in the frame. Force source materials off after it runs.
    resolvedRoot.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      for (const material of sourceMaterials(object)) material.visible = false;
    });
    return snapshot(resolvedRoot, scene);
  }

  function geometryProbe(proxy) {
    if (!proxy?.geometry) return false;
    proxy.updateWorldMatrix?.(true, false);
    proxy.geometry.computeBoundingBox?.();
    const box = proxy.geometry.boundingBox;
    if (!box) return false;
    const localCenter = box.getCenter(new THREE.Vector3());
    const worldCenter = proxy.localToWorld(localCenter.clone());
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(proxy.matrixWorld).normalize();
    const ray = new THREE.Raycaster(worldCenter.clone().addScaledVector(normal, 2), normal.clone().negate(), 0, 4);
    const hits = []; // Used to probe geometry directly without re-enabling the proxy's public interaction raycast.
    THREE.Mesh.prototype.raycast.call(proxy, ray, hits);
    return hits.length > 0;
  }

  function snapshot(root = activeRoot(), scene = activeScene()) {
    let sourceWalls = 0;
    root?.traverse?.(object => { if (object.userData?.ruinInteriorWall && object.isMesh) sourceWalls++; });
    const live = [...proxies].filter(proxy => proxy.parent === proxyRoot);
    const transformed = live.filter(proxy => matrixElementsAreFinite(proxy.matrixWorld)); // Used to distinguish attached proxies from valid placed proxies.
    const geometryProbeHits = live.filter(geometryProbe).length; // Used as a geometry sanity check, not as proof of framebuffer visibility.
    return {
      active: !!root && !!scene,
      enabled: desiredVisible(),
      sourceWalls,
      renderProxyCount: live.length,
      proxyRootAttached: !!proxyRoot && proxyRoot.parent === scene,
      transformSyncedProxies: transformed.length,
      proxyMaterialsVisible: live.filter(proxy => {
        const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
        return proxy.visible !== false && materials.every(material => material?.visible !== false);
      }).length,
      geometryProbeHits,
      raycastableProxies: 0,
      interactionRaycastDisabled: live.filter(proxy => proxy.raycast !== THREE.Mesh.prototype.raycast).length,
      mainRealmMaterials: live.filter(proxy => proxy.material instanceof THREE.Material).length,
      blockerCount: DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0,
    };
  }

  DS.addBeforeRenderClient(() => prepare());
  window.DevRandomRuinWallRenderProxy = Object.freeze({ prepare, snapshot, clear: clearProxies });
})();
