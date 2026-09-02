(() => {
  'use strict';

  // Shipping Box world presentation + footprint adapter. FarmCrates owns the
  // actual shipping inventory/timing; this module gives that service object a
  // real 2×1 farm footprint and the authored furniture-database presentation.
  if (window.__shippingBoxWorldInstalled) return;
  window.__shippingBoxWorldInstalled = true;

  const AUTHORED_KEY = 'shippingBox'; // Used as the single source of truth for Shipping Box geometry/materials.
  let panelDeps = null; // Used for the Farm tab's authoritative worldObjects map.
  const boxes = new Set(); // Used to register boxes created before FarmPanel.init runs.

  function footprintKeys(box, col = box?.col, row = box?.row) {
    col = Math.round(Number(col));
    row = Math.round(Number(row));
    if (!Number.isFinite(col) || !Number.isFinite(row)) return [];
    return [`${col},${row}`, `${col + 1},${row}`];
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
    const originalInit = panel.init.bind(panel); // Used to preserve FarmPanel's earlier shipping/UI wrappers.
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
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel'); // Used to chain with FarmCrates' lazy FarmPanel hook rather than replace it.
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

  function disposeRoot(root) {
    if (!root) return;
    root.removeFromParent?.();
    root.traverse?.(object => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(material => material.dispose?.());
    });
  }

  function authoredPartForMesh(mesh) {
    return mesh?.userData?.authoredPart || null;
  }

  function materialList(mesh) {
    return (Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]).filter(Boolean);
  }

  function applyAuthoredTextureColors(group) {
    // ProceduralFurniture deliberately resets textured materials to white so
    // most old furniture displays the PNG literally. Shipping Box is authored
    // to use texture × color instead: keep carved_smooth.png mapped on every
    // triangle, then multiply it by each part's database color. Because each
    // box mesh has one Lambert material and box-projected UVs, this applies to
    // top, bottom, front, back, left, and right surfaces—not just the top cap.
    group.children.forEach(mesh => {
      const part = authoredPartForMesh(mesh);
      if (!part?.materialTexture || !part?.color) return;
      materialList(mesh).forEach(material => {
        material.color.set(part.color);
        material.transparent = !!part.textureTransparent;
        material.opacity = Number(part.surfaceOpacity ?? 1);
        material.needsUpdate = true;
      });
    });
  }

  function findPartMesh(group, id) {
    return group.children.find(mesh => authoredPartForMesh(mesh)?.id === id) || null;
  }

  function installAuthoredShippingBox(box) {
    const authored = window.AuthoredFurniture;
    if (!authored?.load || !authored?.buildGroup || !box?.mesh?.parent) return;
    const scene = box.mesh.parent;
    const fallbackBodyY = Number(box.mesh.position?.y) || 0; // Used to keep the authored body's floor plane exactly where the fallback body already stood.

    authored.load(AUTHORED_KEY).then(data => {
      if (!boxes.has(box) || !box.mesh?.parent || !Array.isArray(data?.parts)) return;
      const group = authored.buildGroup(data, 0x8b6540);
      if (!group.children.length) return;
      applyAuthoredTextureColors(group);

      const bodyPart = data.parts.find(part => part.id === 'shipping_box_body') || data.parts[0];
      const groundY = fallbackBodyY - (Number(bodyPart?.transform?.y) || 0.19);
      const oldBody = box.mesh;
      const oldLid = box.lid;
      scene.add(group);
      disposeRoot(oldBody);
      if (oldLid && oldLid !== oldBody) disposeRoot(oldLid);

      const lidPanel = findPartMesh(group, 'shipping_box_lid_panel');
      const lock = findPartMesh(group, 'shipping_box_lock');
      const lidMovingMeshes = group.children.filter(mesh => {
        const id = authoredPartForMesh(mesh)?.id || '';
        return id === 'shipping_box_lid_panel' || id === 'shipping_box_lock' || id.startsWith('shipping_box_lid_rim_');
      });
      const restY = new Map(lidMovingMeshes.map(mesh => [mesh, mesh.position.y])); // Used to lift the complete lid assembly without accumulating offsets.

      box.mesh = group;
      box.lid = lidPanel;
      box.latch = lock;
      box.visualSource = 'authored-shipping-box';
      box.authoredFurnitureKey = AUTHORED_KEY;
      box.__syncShippingArt = () => {
        group.position.set(Number(box.col) + 1, groundY, Number(box.row) + 0.5);
        const lift = box.getTotalItems?.() > 0 ? 0.06 : 0;
        lidMovingMeshes.forEach(mesh => { mesh.position.y = (restY.get(mesh) || 0) + lift; });
      };
      box.__syncShippingArt();
      registerFootprint(box);
    }).catch(error => {
      console.warn('[ShippingBoxWorld] authored shippingBox load failed; using fallback chest', error);
    });
  }

  function decorateShippingBox(box) {
    if (!box || box.__twoTileShippingBox) return box;
    box.__twoTileShippingBox = true;
    box.w = 2;
    box.h = 1;
    box.blocksMovement = true;
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

    for (const methodName of ['refreshVisual', 'depositItem', 'withdrawItem', 'tick', 'onAction', 'reset']) {
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
    const originalMakeSellCrate = crates.makeSellCrate.bind(crates); // Used to preserve FarmCrates' shipping contents, midnight cutoff, and Farm-tab integration.
    crates.makeSellCrate = (col, row, ...rest) => decorateShippingBox(originalMakeSellCrate(col, row, ...rest));
    crates.__shippingBoxWorldPatched = true;
  }

  hookFarmPanel();
  patchFarmCrates();

  window.ShippingBoxWorld = {
    sync: () => boxes.forEach(registerFootprint),
    debug: () => [...boxes].map(box => ({
      col: box.col,
      row: box.row,
      occupiedTiles: box.getOccupiedTiles?.() || [],
      registeredKeys: panelDeps?.worldObjects
        ? [...panelDeps.worldObjects].filter(([, value]) => value === box).map(([key]) => key)
        : [],
      visualSource: box.visualSource || 'fallback-chest',
      authoredFurnitureKey: box.authoredFurnitureKey || null,
      blocksMovement: box.blocksMovement === true,
      materials: box.mesh?.children?.map(mesh => {
        const part = authoredPartForMesh(mesh);
        const material = materialList(mesh)[0];
        return {
          id: part?.id || mesh.name,
          role: part?.materialRole || null,
          texture: part?.materialTexture || null,
          authoredColor: part?.color || null,
          runtimeColor: material?.color ? `#${material.color.getHexString()}` : null,
        };
      }) || [],
    })),
  };
})();
