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
  const proxies = new Set();

  function activeRoot() {
    if (GridTileAccessors.getCurrentArea?.() !== MAP_ID) return null;
    const scene = GridTileAccessors.getActiveScene?.();
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

  function disposeProxy(proxy) {
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
    preparedRoot = null;
  }

  function buildProxy(wall) {
    const geometry = cloneGeometry(wall.geometry);
    if (!geometry) return null;
    const source = sourceMaterials(wall)[0] || null;
    const material = cloneMaterial(source);
    const proxy = new THREE.Mesh(geometry, material);
    proxy.name = `${wall.name || `ruin_wall_${wall.id}`}_runtime_render`;
    proxy.userData.devRuinWallRenderProxy = true;
    proxy.userData.prototypeWallName = wall.name || null;
    proxy.frustumCulled = false;
    proxy.castShadow = true;
    proxy.receiveShadow = true;
    proxy.renderOrder = wall.renderOrder || 0;
    // Identity child transform = exact V50 wall plane geometry at the exact V50
    // wall transform. The original wall remains the collision/source object.
    wall.add(proxy);
    proxies.add(proxy);
    wall.userData.devRuinWallRenderProxy = proxy;
    wall.userData.runtimeWallPlaneRenderRealm = 'game';
    return proxy;
  }

  function desiredVisible() {
    return window.DevRandomRuinWallPlanes?.isVisible?.() !== false;
  }

  function prepare(root = activeRoot()) {
    if (!root) {
      if (preparedRoot) clearProxies();
      return snapshot();
    }
    if (root !== preparedRoot) {
      clearProxies();
      preparedRoot = root;
      root.traverse(object => {
        if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
        // The source mesh stays visible for collision/bounds, but its iframe
        // material never renders. The parent-realm proxy is the visible wall.
        object.visible = true;
        for (const material of sourceMaterials(object)) {
          material.visible = false;
          material.needsUpdate = true;
        }
        buildProxy(object);
      });
    }
    const visible = desiredVisible();
    for (const proxy of proxies) {
      const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
      for (const material of materials) material.visible = visible;
      proxy.visible = true;
    }
    // The older optional-wall controller may re-enable the source iframe
    // materials earlier in the frame. Force source materials off after it runs.
    root.traverse(object => {
      if (!object.userData?.ruinInteriorWall || !object.isMesh) return;
      for (const material of sourceMaterials(object)) material.visible = false;
    });
    return snapshot(root);
  }

  function raycastProbe(proxy) {
    if (!proxy?.geometry) return false;
    proxy.updateWorldMatrix?.(true, false);
    proxy.geometry.computeBoundingBox?.();
    const box = proxy.geometry.boundingBox;
    if (!box) return false;
    const localCenter = box.getCenter(new THREE.Vector3());
    const worldCenter = proxy.localToWorld(localCenter.clone());
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(proxy.matrixWorld).normalize();
    const ray = new THREE.Raycaster(worldCenter.clone().addScaledVector(normal, 2), normal.clone().negate(), 0, 4);
    return ray.intersectObject(proxy, false).length > 0;
  }

  function snapshot(root = activeRoot()) {
    let sourceWalls = 0;
    root?.traverse?.(object => { if (object.userData?.ruinInteriorWall && object.isMesh) sourceWalls++; });
    const live = [...proxies].filter(proxy => proxy.parent);
    return {
      active: !!root,
      enabled: desiredVisible(),
      sourceWalls,
      renderProxyCount: live.length,
      proxyMaterialsVisible: live.filter(proxy => {
        const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
        return materials.every(material => material?.visible !== false);
      }).length,
      raycastableProxies: live.filter(raycastProbe).length,
      mainRealmMaterials: live.filter(proxy => proxy.material instanceof THREE.Material).length,
      blockerCount: DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0,
    };
  }

  DS.addBeforeRenderClient(() => prepare());
  window.DevRandomRuinWallRenderProxy = Object.freeze({ prepare, snapshot, clear:clearProxies });
})();
