(() => {
  'use strict';

  // Shipping Box world presentation + footprint adapter. FarmCrates owns the
  // actual shipping inventory/timing; this module owns only configured farm
  // occupancy/collision registration and authored furniture presentation.
  if (window.__shippingBoxWorldInstalled) return;
  window.__shippingBoxWorldInstalled = true;

  const cfg = () => window.ShippingBoxConfig || {};
  let panelDeps = null; // Used for the Farm tab's authoritative worldObjects map.
  const boxes = new Set(); // Used to register boxes created before FarmPanel.init runs.
  const texturePromises = new Map(); // Used to load each configured PNG once, then clone per material.

  function objectCfg() { return cfg().object || {}; }
  function materialCfg() { return cfg().material || {}; }
  function footprintCfg() { return objectCfg().footprint || {}; }

  function footprintSize() {
    return {
      width: Math.max(1, Math.round(Number(footprintCfg().width) || 1)),
      height: Math.max(1, Math.round(Number(footprintCfg().height) || 1)),
    };
  }

  function footprintKeys(box, col = box?.col, row = box?.row) {
    col = Math.round(Number(col));
    row = Math.round(Number(row));
    if (!Number.isFinite(col) || !Number.isFinite(row)) return [];
    const { width, height } = footprintSize();
    const keys = [];
    for (let dz = 0; dz < height; dz++) {
      for (let dx = 0; dx < width; dx++) keys.push(`${col + dx},${row + dz}`);
    }
    return keys;
  }

  function unregisterFootprint(box, col = box?.col, row = box?.row) {
    const map = panelDeps?.worldObjects;
    if (!map) return;
    footprintKeys(box, col, row).forEach(key => {
      if (map.get(key) === box) map.delete(key);
    });
  }

  function registerFootprint(box) {
    const map = panelDeps?.worldObjects;
    if (!map) return;
    const wanted = new Set(footprintKeys(box));
    for (const [key, value] of map) {
      if (value === box && !wanted.has(key)) map.delete(key);
    }
    wanted.forEach(key => map.set(key, box));
  }

  function patchFarmPanel(panel) {
    if (!panel?.init || panel.__shippingBoxFootprintPatched) return;
    const originalInit = panel.init.bind(panel); // Used to preserve existing FarmPanel wrappers.
    panel.init = function shippingBoxFootprintInit(injectedDeps, ...rest) {
      panelDeps = injectedDeps;
      const result = originalInit(injectedDeps, ...rest);
      boxes.forEach(registerFootprint);
      return result;
    };
    panel.__shippingBoxFootprintPatched = true;
  }

  function hookFarmPanel() {
    if (window.FarmPanel) {
      patchFarmPanel(window.FarmPanel);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel'); // Used to chain with FarmCrates' lazy hook.
    if (descriptor && !descriptor.configurable) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next);
        else value = next;
        patchFarmPanel(previousGet ? previousGet.call(window) : value);
      },
    });
  }

  function materialList(mesh) {
    return (Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]).filter(Boolean);
  }

  function authoredPartForMesh(mesh) {
    return mesh?.userData?.authoredPart || null;
  }

  function disposeRoot(root) {
    if (!root) return;
    root.removeFromParent?.();
    root.traverse?.(object => {
      object.geometry?.dispose?.();
      materialList(object).forEach(material => {
        if (material.userData?.shippingOwnedTexture) material.map?.dispose?.();
        material.dispose?.();
      });
    });
  }

  function configuredWrap() {
    const mode = String(materialCfg().wrap || '').toLowerCase();
    if (mode === 'clamp') return THREE.ClampToEdgeWrapping;
    if (mode === 'mirror') return THREE.MirroredRepeatWrapping;
    return THREE.RepeatWrapping;
  }

  function loadBaseTexture(filename) {
    if (texturePromises.has(filename)) return texturePromises.get(filename);
    const material = materialCfg();
    const basePath = material.textureBasePath || '';
    const promise = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(basePath + filename, texture => {
        const center = material.center || [];
        const repeat = material.repeat || [];
        texture.wrapS = texture.wrapT = configuredWrap();
        texture.center.set(Number(center[0]) || 0, Number(center[1]) || 0);
        texture.repeat.set(Number(repeat[0]) || 1, Number(repeat[1]) || 1);
        texture.rotation = (Number(material.rotationDeg) || 0) * Math.PI / 180;
        texture.needsUpdate = true;
        resolve(texture);
      }, undefined, reject);
    });
    texturePromises.set(filename, promise);
    return promise;
  }

  async function enforceConfiguredMaterials(group) {
    const material = materialCfg();
    const forcedTexture = material.texture;
    const forceEveryPart = material.forceTextureOnEveryPart !== false;
    const jobs = group.children.map(async mesh => {
      const part = authoredPartForMesh(mesh);
      if (!part) return;
      const filename = forceEveryPart ? forcedTexture : (part.materialTexture || forcedTexture);
      if (!filename) return;
      const base = await loadBaseTexture(filename);
      materialList(mesh).forEach(meshMaterial => {
        const texture = base.clone();
        texture.needsUpdate = true;
        meshMaterial.map = texture;
        meshMaterial.userData.shippingOwnedTexture = true;
        if (material.multiplyAuthoredColor !== false && part.color) meshMaterial.color.set(part.color);
        meshMaterial.transparent = material.transparent != null ? !!material.transparent : !!part.textureTransparent;
        meshMaterial.opacity = material.opacity == null ? Number(part.surfaceOpacity ?? 1) : Number(material.opacity);
        meshMaterial.needsUpdate = true;
      });
    });
    await Promise.all(jobs);
  }

  function findPartMesh(group, id) {
    return group.children.find(mesh => authoredPartForMesh(mesh)?.id === id) || null;
  }

  function isMovingLidPart(mesh) {
    const id = authoredPartForMesh(mesh)?.id || '';
    const parts = objectCfg().parts || {};
    return id === parts.lid || id === parts.lock || (!!parts.lidRimPrefix && id.startsWith(parts.lidRimPrefix));
  }

  function installAuthoredShippingBox(box) {
    const authored = window.AuthoredFurniture;
    const object = objectCfg();
    const furnitureKey = object.authoredFurnitureKey;
    if (!furnitureKey || !authored?.load || !authored?.buildGroup || !box?.mesh?.parent) return;
    const scene = box.mesh.parent;
    const fallbackBodyY = Number(box.mesh.position?.y) || 0;

    authored.load(furnitureKey).then(async data => {
      if (!boxes.has(box) || !box.mesh?.parent || !Array.isArray(data?.parts)) return;
      const group = authored.buildGroup(data, object.fallback?.baseColor || '#8b6540');
      if (!group.children.length) return;

      // Do not trust the generic async furniture texture path for this feature:
      // wait for the configured texture, put a resolved clone on EVERY part,
      // then restore each authored tint. This guarantees wood body/lid and the
      // verdigris rim/lock all retain the same PNG-backed surface treatment.
      await enforceConfiguredMaterials(group);
      if (!boxes.has(box) || !box.mesh?.parent) { disposeRoot(group); return; }

      const parts = object.parts || {};
      const bodyPart = data.parts.find(part => part.id === parts.body) || data.parts[0];
      const fallbackBodyLocalY = Number(object.fallback?.body?.position?.[1]) || 0;
      const groundY = fallbackBodyY - (Number(bodyPart?.transform?.y) || fallbackBodyLocalY);
      const oldBody = box.mesh;
      const oldLid = box.lid;
      scene.add(group);
      disposeRoot(oldBody);
      if (oldLid && oldLid !== oldBody) disposeRoot(oldLid);

      const lidPanel = findPartMesh(group, parts.lid);
      const lock = findPartMesh(group, parts.lock);
      const lidMovingMeshes = group.children.filter(isMovingLidPart);
      const restY = new Map(lidMovingMeshes.map(mesh => [mesh, mesh.position.y]));

      box.mesh = group;
      box.lid = lidPanel;
      box.latch = lock;
      box.visualSource = object.visualSource || furnitureKey;
      box.authoredFurnitureKey = furnitureKey;
      box.__syncShippingArt = () => {
        const center = object.centerOffset || {};
        group.position.set(Number(box.col) + (Number(center.x) || 0), groundY, Number(box.row) + (Number(center.z) || 0));
        const lift = box.getTotalItems?.() > 0 ? (Number(object.lidLiftWhenOccupied) || 0) : 0;
        lidMovingMeshes.forEach(mesh => { mesh.position.y = (restY.get(mesh) || 0) + lift; });
      };
      box.__syncShippingArt();
      registerFootprint(box);
    }).catch(error => {
      console.warn('[ShippingBoxWorld] authored Shipping Box load failed; using configured fallback', error);
    });
  }

  function decorateShippingBox(box) {
    if (!box || box.__shippingBoxWorldDecorated) return box;
    const object = objectCfg();
    const { width, height } = footprintSize();
    box.__shippingBoxWorldDecorated = true;
    box.w = width;
    box.h = height;
    box.blocksMovement = object.blocksMovement !== false;
    box.getOccupiedTiles = () => footprintKeys(box).map(key => {
      const [col, row] = key.split(',').map(Number);
      return { col, row };
    });
    boxes.add(box);

    const originalMoveTo = box.moveTo?.bind(box);
    if (originalMoveTo) {
      box.moveTo = (col, row) => {
        const oldCol = box.col;
        const oldRow = box.row;
        unregisterFootprint(box, oldCol, oldRow);
        const result = originalMoveTo(col, row);
        registerFootprint(box);
        box.__syncShippingArt?.();
        return result;
      };
    }

    for (const property of ['col', 'row']) {
      const descriptor = Object.getOwnPropertyDescriptor(box, property);
      if (!descriptor?.get || !descriptor?.set) continue;
      Object.defineProperty(box, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          const oldCol = box.col;
          const oldRow = box.row;
          unregisterFootprint(box, oldCol, oldRow);
          descriptor.set.call(box, value);
          registerFootprint(box);
          box.__syncShippingArt?.();
        },
      });
    }

    const wrappedMethods = cfg().world?.syncAfterMethods || ['refreshVisual', 'depositItem', 'withdrawItem', 'tick', 'onAction', 'reset'];
    for (const methodName of wrappedMethods) {
      const original = box[methodName];
      if (typeof original !== 'function') continue;
      box[methodName] = function shippingBoxWorldWrappedMethod(...args) {
        const result = original.apply(this, args);
        registerFootprint(box);
        box.__syncShippingArt?.();
        return result;
      };
    }

    registerFootprint(box);
    installAuthoredShippingBox(box);
    return box;
  }

  function patchFarmCrates() {
    const crates = window.FarmCrates;
    if (!crates?.makeSellCrate || crates.__shippingBoxWorldPatched) return;
    const originalMakeSellCrate = crates.makeSellCrate.bind(crates);
    crates.makeSellCrate = (col, row, ...rest) => decorateShippingBox(originalMakeSellCrate(col, row, ...rest));
    crates.__shippingBoxWorldPatched = true;
  }

  hookFarmPanel();
  patchFarmCrates();

  window.ShippingBoxWorld = {
    sync: () => boxes.forEach(registerFootprint),
    reloadMaterials: () => boxes.forEach(box => installAuthoredShippingBox(box)),
    debug: () => [...boxes].map(box => ({
      configVersion: cfg().version || null,
      col: box.col,
      row: box.row,
      occupiedTiles: box.getOccupiedTiles?.() || [],
      registeredKeys: panelDeps?.worldObjects
        ? [...panelDeps.worldObjects].filter(([, value]) => value === box).map(([key]) => key)
        : [],
      visualSource: box.visualSource || 'fallback',
      authoredFurnitureKey: box.authoredFurnitureKey || null,
      blocksMovement: box.blocksMovement === true,
      materials: cfg().debug?.materialDiagnostics === false ? [] : (box.mesh?.children?.map(mesh => {
        const part = authoredPartForMesh(mesh);
        const meshMaterial = materialList(mesh)[0];
        return {
          id: part?.id || mesh.name,
          role: part?.materialRole || null,
          configuredTexture: materialCfg().texture || null,
          hasRuntimeTexture: !!meshMaterial?.map?.image,
          authoredColor: part?.color || null,
          runtimeColor: meshMaterial?.color ? `#${meshMaterial.color.getHexString()}` : null,
        };
      }) || []),
    })),
  };
})();
