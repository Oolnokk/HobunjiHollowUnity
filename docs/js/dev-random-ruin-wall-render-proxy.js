// Main-game render proxies for Debris-ifier V50 structural and puzzle geometry.
// V50's exact meshes and transforms remain authoritative; this module recreates
// wall, stone-door, and activator render resources in the parent game THREE realm.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const GridTileAccessors = window.GridTileAccessors;
  const DS = window.DynamicSurfaces;
  if (!window.THREE || !GridTileAccessors || !DS) return;

  let preparedRoot = null;
  let preparedScene = null; // Used to detect scene swaps even if a stale V50 root survives briefly.
  let proxyRoot = null; // Used as the game-realm-only parent for all visible ruin proxies.
  const proxies = new Set();
  const hiddenSourceMeshes = new Set(); // Private material clones suppress foreign draws without mutating V50's shared materials.

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

  function originalSourceMaterials(mesh) {
    const original = mesh?.userData?.devRuinProxyOriginalMaterial || mesh?.userData?.devRuinWallOriginalMaterial;
    if (!original) return sourceMaterials(mesh);
    return Array.isArray(original) ? original.filter(Boolean) : [original];
  }

  function hideSourceMesh(mesh, kind) {
    if (!mesh?.material) return false;
    if (mesh.userData?.devRuinProxyOriginalMaterial) return true;
    const original = mesh.material;
    const originals = Array.isArray(original) ? original.filter(Boolean) : [original];
    const hidden = originals.map(material => material?.clone?.()).filter(Boolean);
    if (!hidden.length || hidden.length !== originals.length) return false;
    for (const material of hidden) {
      material.visible = false;
      material.userData = { ...(material.userData || {}), devRuinPrivateHiddenClone:true };
      material.needsUpdate = true;
    }
    mesh.userData.devRuinProxyOriginalMaterial = original;
    mesh.userData.devRuinProxyHiddenMaterials = hidden;
    mesh.userData.devRuinProxyKind = kind;
    if (kind === 'wall') {
      mesh.userData.devRuinWallOriginalMaterial = original;
      mesh.userData.devRuinWallHiddenMaterials = hidden;
      for (const material of hidden) material.userData.devRuinWallPrivateHiddenClone = true;
    }
    mesh.material = Array.isArray(original) ? hidden : hidden[0];
    hiddenSourceMeshes.add(mesh);
    return true;
  }

  function restoreSourceMesh(mesh) {
    if (!mesh?.userData?.devRuinProxyOriginalMaterial) return;
    const original = mesh.userData.devRuinProxyOriginalMaterial;
    const hidden = mesh.userData.devRuinProxyHiddenMaterials || [];
    mesh.material = original;
    for (const material of hidden) material?.dispose?.();
    delete mesh.userData.devRuinProxyOriginalMaterial;
    delete mesh.userData.devRuinProxyHiddenMaterials;
    delete mesh.userData.devRuinProxyKind;
    delete mesh.userData.devRuinWallOriginalMaterial;
    delete mesh.userData.devRuinWallHiddenMaterials;
    hiddenSourceMeshes.delete(mesh);
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
      emissive: source?.emissive?.getHex?.() ?? 0x000000,
      emissiveMap: cloneTexture(source?.emissiveMap),
      emissiveIntensity: Number.isFinite(Number(source?.emissiveIntensity)) ? Number(source.emissiveIntensity) : 1,
      roughness: Number.isFinite(Number(source?.roughness)) ? Number(source.roughness) : .92,
      metalness: Number.isFinite(Number(source?.metalness)) ? Number(source.metalness) : .02,
      side: source?.side ?? THREE.DoubleSide,
      transparent: source?.transparent === true,
      opacity: Number.isFinite(Number(source?.opacity)) ? Number(source.opacity) : 1,
      alphaTest: Number.isFinite(Number(source?.alphaTest)) ? Number(source.alphaTest) : 0,
      depthTest: source?.depthTest !== false,
      depthWrite: source?.depthWrite !== false,
      vertexColors: source?.vertexColors === true,
    });
    material.name = `${source?.name || 'v50_ruin'}_game_realm`;
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
    proxyRoot.name = 'dev_random_ruin_render_proxies';
    proxyRoot.userData.devRandomRuinWallProxyRoot = true;
    proxyRoot.userData.devRandomRuinRenderProxyRoot = true;
    scene.add(proxyRoot);
    proxyRoot.updateWorldMatrix?.(true, false);
    return proxyRoot;
  }

  const _copyTransformSourceWorld = new THREE.Matrix4(); // Reused scratch matrices for copySourceWorldTransform, called once per live proxy every frame.
  const _copyTransformParentWorldInverse = new THREE.Matrix4();
  const _copyTransformLocalMatrix = new THREE.Matrix4();
  function copySourceWorldTransform(sourceObject, proxy, scene) {
    if (!sourceObject || !proxy || !scene) return false;
    sourceObject.updateWorldMatrix?.(true, false);
    if (!sourceObject.updateWorldMatrix) sourceObject.updateMatrixWorld?.(true);
    scene.updateWorldMatrix?.(true, false);
    proxyRoot?.updateWorldMatrix?.(true, false);
    if (!matrixElementsAreFinite(sourceObject.matrixWorld) || !matrixElementsAreFinite(proxyRoot?.matrixWorld)) return false;

    const sourceWorld = _copyTransformSourceWorld; // Holds the V50 wall's numeric world transform in the game THREE realm.
    const parentWorldInverse = _copyTransformParentWorldInverse; // Converts source world space into the proxy root's local space.
    const localMatrix = _copyTransformLocalMatrix; // The proxy's fixed local matrix beneath the game-realm proxy root.
    sourceWorld.fromArray(Array.from(sourceObject.matrixWorld.elements, Number));
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
    const sourceObject = proxy?.userData?.sourceRuinObject || proxy?.userData?.sourceRuinWall || null; // Used to remove source back-references during cleanup.
    if (sourceObject?.userData?.devRuinRenderProxy === proxy) delete sourceObject.userData.devRuinRenderProxy;
    if (sourceObject?.userData) delete sourceObject.userData.runtimeRuinRenderRealm;
    if (sourceObject?.userData?.devRuinWallRenderProxy === proxy) {
      delete sourceObject.userData.devRuinWallRenderProxy;
      delete sourceObject.userData.runtimeWallPlaneRenderRealm;
    }
    if (proxy?.userData) {
      delete proxy.userData.sourceRuinObject;
      delete proxy.userData.sourceRuinWall;
    }
    restoreSourceMesh(sourceObject);
    proxy?.geometry?.dispose?.();
    const materials = Array.isArray(proxy?.material) ? proxy.material : proxy?.material ? [proxy.material] : [];
    for (const material of materials) {
      material?.map?.dispose?.();
      if (material?.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose?.();
      material?.dispose?.();
    }
    proxy?.parent?.remove?.(proxy);
    proxies.delete(proxy);
  }

  function clearProxies() {
    for (const proxy of [...proxies]) disposeProxy(proxy);
    for (const mesh of [...hiddenSourceMeshes]) restoreSourceMesh(mesh);
    proxyRoot?.parent?.remove?.(proxyRoot);
    proxyRoot = null;
    preparedRoot = null;
    preparedScene = null;
  }

  function buildProxy(sourceObject, scene, kind, owner) {
    const geometry = cloneGeometry(sourceObject.geometry);
    if (!geometry) return null;
    const sourceMaterialsList = originalSourceMaterials(sourceObject);
    const clonedMaterials = sourceMaterialsList.map(cloneMaterial);
    const material = Array.isArray(sourceObject.material) ? clonedMaterials : clonedMaterials[0];
    if (!material || (Array.isArray(material) && !material.length)) {
      geometry.dispose?.();
      return null;
    }
    const proxy = new THREE.Mesh(geometry, material);
    proxy.name = `${sourceObject.name || `ruin_${kind}_${sourceObject.id}`}_runtime_render`;
    proxy.userData.devRuinRenderProxy = true;
    proxy.userData.devRuinRenderKind = kind;
    proxy.userData.devRuinRenderOwnerId = owner?.userData?.mechanismId || owner?.userData?.linkedMechanismId || null;
    proxy.userData.sourceRuinObject = sourceObject;
    if (kind === 'wall') {
      proxy.userData.devRuinWallRenderProxy = true;
      proxy.userData.prototypeWallName = sourceObject.name || null;
      proxy.userData.sourceRuinWall = sourceObject;
    }
    proxy.userData.devRuinRenderSubmitCount = 0; // Used to prove the game renderer actually submitted this proxy for drawing.
    proxy.userData.devRuinLastRenderAt = 0; // Used by diagnostics to show whether submission happened during the current runtime session.
    proxy.onBeforeRender = () => {
      proxy.userData.devRuinRenderSubmitCount = Number(proxy.userData.devRuinRenderSubmitCount || 0) + 1;
      proxy.userData.devRuinLastRenderAt = performance.now();
    };
    proxy.frustumCulled = false;
    proxy.castShadow = true;
    proxy.receiveShadow = true;
    proxy.renderOrder = Number(sourceObject.renderOrder) || 0;
    // These are visual-only meshes. Prevent broad scene raycasts from choosing a
    // render proxy instead of the V50 ladder/mechanism that owns an interaction.
    proxy.raycast = () => {};

    const root = ensureProxyRoot(scene); // Used to keep the visible mesh wholly inside the game THREE object graph.
    if (!root) {
      disposeProxy(proxy);
      return null;
    }
    root.add(proxy);
    if (!copySourceWorldTransform(sourceObject, proxy, scene) || !hideSourceMesh(sourceObject, kind)) {
      disposeProxy(proxy);
      return null;
    }

    proxies.add(proxy);
    sourceObject.userData.devRuinRenderProxy = proxy;
    sourceObject.userData.runtimeRuinRenderRealm = 'game-scene-proxy';
    if (kind === 'wall') {
      sourceObject.userData.devRuinWallRenderProxy = proxy;
      sourceObject.userData.runtimeWallPlaneRenderRealm = 'game-scene-proxy';
    }
    return proxy;
  }

  function desiredVisible() {
    return window.DevRandomRuinWallPlanes?.isVisible?.() !== false;
  }

  function normalizeDoorAssemblies(root) {
    const arches = [], doors = [];
    root?.traverse?.(object => {
      if (object.userData?.archFootprint) arches.push(object);
      if (object.userData?.transitDoor || (object.userData?.mechanismId && object.userData?.previewMotion?.type === 'stoneDoor')) doors.push(object);
    });
    for (const door of doors) {
      if (door.userData?.devRuinDoorAssemblyNormalized) continue;
      const arch = arches
        .map(candidate => ({ candidate, distance:(Number(candidate.position?.x)-Number(door.position?.x))**2 + (Number(candidate.position?.z)-Number(door.position?.z))**2 }))
        .filter(entry => entry.distance < .08 ** 2)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (!arch) continue;
      const panel = (door.children || []).find(child => child?.isMesh && child.geometry);
      panel?.geometry?.computeBoundingBox?.();
      const panelHeight = panel?.geometry?.boundingBox
        ? panel.geometry.boundingBox.max.y - panel.geometry.boundingBox.min.y
        : 1.9;
      // V50 anchors retracting panels by their top edge. Its authored anchor
      // was 0.45u above the matching arch opening, leaving a walk-through gap.
      // Keep the animation/top anchor model, but land the closed panel on the
      // floor and lock its yaw to the frame it visibly belongs to.
      door.position.y = Number(arch.position?.y) + panelHeight;
      door.rotation.y = Number(arch.rotation?.y) || 0;
      door.userData.devRuinDoorAssemblyNormalized = true;
      door.userData.devRuinDoorArch = arch;
      arch.userData.devRuinDoorArch = true;
      arch.userData.devRuinDoorRoot = door;
    }
  }

  function collectRenderSources(root) {
    const candidates = new Map(); // One entry per source mesh prevents nested activator roots from creating duplicate proxies.
    const rank = { activator:1, door:2, doorArch:3, wall:4 }; // Higher ranks preserve structural classification when tagged hierarchies overlap.
    const add = (mesh, kind, owner) => {
      if (!mesh?.isMesh || !mesh.geometry) return;
      const prior = candidates.get(mesh);
      if (!prior || rank[kind] > rank[prior.kind]) candidates.set(mesh, { mesh, kind, owner });
    };
    root?.traverse?.(object => {
      const data = object.userData || {};
      if (data.ruinInteriorWall) add(object, 'wall', object);
      if (data.archFootprint) object.traverse?.(mesh => add(mesh, 'doorArch', object));
      if (data.mechanismId && data.previewMotion?.type === 'stoneDoor') {
        object.traverse?.(mesh => add(mesh, 'door', object));
      }
      if (data.linkedMechanismId && data.activatorType) {
        object.traverse?.(mesh => add(mesh, 'activator', object));
      }
    });
    return [...candidates.values()];
  }

  function sourceHierarchyVisible(sourceObject, root) {
    for (let object = sourceObject; object; object = object.parent) {
      if (object.visible === false) return false;
      if (object === root) break;
    }
    return true;
  }

  function syncProxyAppearance(proxy) {
    const sourceObject = proxy?.userData?.sourceRuinObject;
    const sources = originalSourceMaterials(sourceObject);
    const targets = Array.isArray(proxy?.material) ? proxy.material : proxy?.material ? [proxy.material] : [];
    for (let index = 0; index < targets.length; index++) {
      const source = sources[Math.min(index, sources.length - 1)];
      const target = targets[index];
      if (!source || !target) continue;
      if (source.color?.getHex && target.color?.setHex) target.color.setHex(source.color.getHex());
      if (source.emissive?.getHex && target.emissive?.setHex) target.emissive.setHex(source.emissive.getHex());
      if (Number.isFinite(Number(source.emissiveIntensity))) target.emissiveIntensity = Number(source.emissiveIntensity);
      if (Number.isFinite(Number(source.opacity))) target.opacity = Number(source.opacity);
      if (Number.isFinite(Number(source.alphaTest))) target.alphaTest = Number(source.alphaTest);
      if (source.map && target.map) {
        target.map.offset?.copy?.(source.map.offset);
        target.map.repeat?.copy?.(source.map.repeat);
        target.map.center?.copy?.(source.map.center);
        if (Number.isFinite(Number(source.map.rotation))) target.map.rotation = Number(source.map.rotation);
      }
    }
  }

  function prepare(root = null) {
    const scene = activeScene(); // Used as the only parent realm for visible proxy geometry this frame.
    const resolvedRoot = root || activeRoot(scene); // Used as the V50 source hierarchy for wall layout/collision data.
    if (!scene || !resolvedRoot) {
      if (preparedRoot || preparedScene || proxyRoot) clearProxies();
      return null;
    }
    if (resolvedRoot !== preparedRoot || scene !== preparedScene) {
      clearProxies();
      preparedRoot = resolvedRoot;
      preparedScene = scene;
      normalizeDoorAssemblies(resolvedRoot);
      ensureProxyRoot(scene);
      for (const source of collectRenderSources(resolvedRoot)) {
        // Each source gets private hidden clones. V50 deliberately shares stone
        // materials, so mutating the original would erase floors and ladders too.
        if (source.kind === 'wall') source.mesh.visible = true;
        buildProxy(source.mesh, scene, source.kind, source.owner);
      }
    }

    for (const proxy of [...proxies]) {
      const sourceObject = proxy?.userData?.sourceRuinObject || null; // Used to refresh live door/activator placement before each render.
      if (!proxy.parent || !sourceObject || !copySourceWorldTransform(sourceObject, proxy, scene)) {
        disposeProxy(proxy);
        continue;
      }
      const visible = proxy.userData.devRuinRenderKind === 'wall'
        ? desiredVisible()
        : sourceHierarchyVisible(sourceObject, resolvedRoot);
      syncProxyAppearance(proxy);
      const sourceMaterialsList = originalSourceMaterials(sourceObject);
      const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
      for (let index = 0; index < materials.length; index++) {
        const sourceMaterial = sourceMaterialsList[Math.min(index, sourceMaterialsList.length - 1)];
        materials[index].visible = visible && sourceMaterial?.visible !== false;
      }
      proxy.visible = visible;
    }

    // Reassert only private source clones in case a preview controller changed
    // material visibility earlier in the frame; original shared materials stay intact.
    for (const sourceObject of hiddenSourceMeshes) {
      for (const material of sourceObject.userData?.devRuinProxyHiddenMaterials || []) material.visible = false;
    }
    return null; // Diagnostics-only snapshot() is intentionally not computed here — nothing in the per-frame render loop reads it; call window.DevRandomRuinWallRenderProxy.snapshot() directly when it's actually needed.
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
    let normalizedDoorAssemblies = 0;
    root?.traverse?.(object => { if (object.userData?.ruinInteriorWall && object.isMesh) sourceWalls++; });
    root?.traverse?.(object => { if (object.userData?.devRuinDoorAssemblyNormalized) normalizedDoorAssemblies++; });
    const sourceCounts = { wall:0, door:0, doorArch:0, activator:0 }; // Expected source totals are shown in the mobile Pixel Probe diagnostics.
    for (const source of collectRenderSources(root)) sourceCounts[source.kind]++;
    const allLive = [...proxies].filter(proxy => proxy.parent === proxyRoot);
    const live = allLive.filter(proxy => proxy.userData?.devRuinRenderKind === 'wall');
    const doors = allLive.filter(proxy => proxy.userData?.devRuinRenderKind === 'door');
    const doorArches = allLive.filter(proxy => proxy.userData?.devRuinRenderKind === 'doorArch');
    const activators = allLive.filter(proxy => proxy.userData?.devRuinRenderKind === 'activator');
    const transformed = live.filter(proxy => matrixElementsAreFinite(proxy.matrixWorld)); // Retains the wall-only metric consumed by existing CI.
    const geometryProbeHits = live.filter(geometryProbe).length; // Retains the existing wall framebuffer sanity metric.
    const rendererSubmittedProxies = live.filter(proxy => Number(proxy.userData?.devRuinRenderSubmitCount || 0) > 0).length; // Retains the existing wall submission metric.
    const renderSubmitCount = live.reduce((sum, proxy) => sum + Number(proxy.userData?.devRuinRenderSubmitCount || 0), 0); // Retains the existing wall aggregate metric.
    const sourceMaterialIsolation = live.filter(proxy => {
      const wall = proxy.userData?.sourceRuinWall;
      const hidden = wall?.userData?.devRuinWallHiddenMaterials || [];
      const originals = originalSourceMaterials(wall);
      return hidden.length > 0 &&
        hidden.every(material => material?.visible === false && material?.userData?.devRuinWallPrivateHiddenClone) &&
        originals.length > 0 && originals.every(material => material?.visible !== false);
    }).length; // Proves hiding a wall did not hide the shared V50 stone material on ladders/floors/props.
    return {
      active: !!root && !!scene,
      enabled: desiredVisible(),
      sourceWalls,
      renderProxyCount: live.length,
      totalProxyCount: allLive.length,
      sourceDoorMeshes: sourceCounts.door,
      doorProxyCount: doors.length,
      visibleDoorProxies: doors.filter(proxy => proxy.visible !== false).length,
      submittedDoorProxies: doors.filter(proxy => Number(proxy.userData?.devRuinRenderSubmitCount || 0) > 0).length,
      sourceDoorArchMeshes: sourceCounts.doorArch,
      doorArchProxyCount: doorArches.length,
      visibleDoorArchProxies: doorArches.filter(proxy => proxy.visible !== false).length,
      normalizedDoorAssemblies,
      sourceActivatorMeshes: sourceCounts.activator,
      activatorProxyCount: activators.length,
      visibleActivatorProxies: activators.filter(proxy => proxy.visible !== false).length,
      submittedActivatorProxies: activators.filter(proxy => Number(proxy.userData?.devRuinRenderSubmitCount || 0) > 0).length,
      allTransformSyncedProxies: allLive.filter(proxy => matrixElementsAreFinite(proxy.matrixWorld)).length,
      proxyRootAttached: !!proxyRoot && proxyRoot.parent === scene,
      transformSyncedProxies: transformed.length,
      proxyMaterialsVisible: live.filter(proxy => {
        const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
        return proxy.visible !== false && materials.every(material => material?.visible !== false);
      }).length,
      geometryProbeHits,
      rendererSubmittedProxies,
      renderSubmitCount,
      sourceMaterialIsolation,
      raycastableProxies: 0,
      interactionRaycastDisabled: live.filter(proxy => proxy.raycast !== THREE.Mesh.prototype.raycast).length,
      mainRealmMaterials: live.filter(proxy => proxy.material instanceof THREE.Material).length,
      allInteractionRaycastDisabled: allLive.filter(proxy => proxy.raycast !== THREE.Mesh.prototype.raycast).length,
      allMainRealmMaterials: allLive.filter(proxy => {
        const materials = Array.isArray(proxy.material) ? proxy.material : [proxy.material];
        return materials.length > 0 && materials.every(material => material instanceof THREE.Material);
      }).length,
      blockerCount: DS.debugSnapshot?.().blockers?.filter(record => String(record.id || '').startsWith('devruin-wall-')).length || 0,
    };
  }

  DS.addBeforeRenderClient(() => prepare());
  window.DevRandomRuinWallRenderProxy = Object.freeze({ prepare, snapshot, clear: clearProxies });
})();
