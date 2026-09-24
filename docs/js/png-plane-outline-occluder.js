// PNG-plane outline occluder registry + depth-only replay, extracted from
// game.js. PNG-plane avatars (player/NPCs/animals/creatures, held items) are
// flat cutout sprites: they opt out of the shell-outline layer, and instead
// join a dedicated outline-occluder layer that is replayed depth-only into
// the main render target right before the outline passes, so avatars whose
// normal depthWrite is disabled (for avatar-vs-avatar ordering) still hide
// the furniture shell/material-seam outlines behind them.
//
// game.js calls init({ renderer, camera }) once both exist; markPngPlane()
// needs no deps and may be called before that.
(() => {
  'use strict';

  if (window.PngPlaneOutlineOccluder) return;

  // Layer 4 is a depth-only replay of visible PNG silhouettes immediately
  // before outline rendering (layers 1-3 are the shell, target and furniture
  // material-ID passes in game.js).
  const LAYER = 4;

  let deps = null;

  // Registered here once per avatar mesh instead of being rediscovered by a
  // full activeScene.traverse() every frame in renderDepth() below -- the
  // active scene can hold thousands of terrain/foliage/instanced-mesh nodes,
  // so scanning all of them every single frame just to find the handful
  // tagged with this layer scaled with total scene size, not with how many
  // avatars actually exist. See prune() for how entries get cleaned up once
  // an avatar is actually despawned.
  const meshes = [];
  const registered = new Set(); // Mirrors `meshes` so re-marking the same avatar can't duplicate its entries.

  let lastOccluderCount = -1; // Used to keep mobile outline diagnostics useful without per-frame log spam.
  // Reused across calls instead of allocated fresh each frame -- this runs
  // unconditionally every frame outlines are on (the default), for every
  // visible player/NPC/creature/mount mesh, so a per-frame Map plus a
  // per-mesh temp array here was pure steady-state GC churn.
  const materialStates = new Map();

  function init(injectedDeps) { deps = injectedDeps; }

  // Tagging the root group lets depth-only source passes hide PNG planes
  // temporarily without touching the main colour pass that actually shows
  // them. Each child mesh also joins the dedicated outline-occluder layer.
  function markPngPlane(obj) {
    if (!obj) return;
    obj.userData.isPngPlane = true;
    obj.traverse(child => {
      if (!child.isMesh) return;
      // PNG art supplies its own outline. Disable the shell layer on the
      // mesh itself, while retaining this layer for depth-only occlusion of
      // genuine 3D outlines behind the sprite.
      child.userData.isPngPlane = true;
      child.userData.noOutline = true;
      child.layers.disable(1);
      child.layers.enable(LAYER);
      if (registered.has(child)) return;
      registered.add(child);
      meshes.push(child);
    });
  }

  // Walks each registered mesh up to its root instead of traversing the
  // whole scene graph. Areas keep their own persistent scene per the
  // building/zone maps in grid-tile-accessors.js, so a mesh whose root is
  // some *other* THREE.Scene just belongs to a currently-inactive area --
  // it's kept in the registry, not pruned. Only a root that isn't a Scene at
  // all (the avatar's group was actually removed from every scene) means the
  // entry is truly dead and gets dropped for good.
  //
  // game.js calls this every frame regardless of outlines: markPngPlane()
  // registers unconditionally as avatars/tools/held items are created, but
  // renderDepth() (which also compacts this registry) only runs while
  // outlines are on. With outlines off, despawned entries would never get
  // dropped and the registry would grow for the entire session.
  function prune() {
    let writeIdx = 0;
    for (let i = 0; i < meshes.length; i++) {
      const object = meshes[i];
      let root = object;
      while (root.parent) root = root.parent;
      if (!root.isScene) { // Despawned -- drop from the registry.
        registered.delete(object);
        continue;
      }
      meshes[writeIdx++] = object;
    }
    meshes.length = writeIdx;
  }

  function captureMaterial(material) {
    if (!material || materialStates.has(material)) return;
    materialStates.set(material, { colorWrite: material.colorWrite, depthWrite: material.depthWrite, depthTest: material.depthTest, depthFunc: material.depthFunc });
    material.colorWrite = false;
    material.depthWrite = true;
    // The replay must obey the completed scene depth. AlwaysDepth let a
    // player behind furniture overwrite that nearer furniture depth, so the
    // later black shell appeared through benches and walls.
    material.depthTest = true;
    material.depthFunc = THREE.LessEqualDepth;
  }

  // Replays only PNG-plane meshes into the current render target's existing
  // depth buffer. Their original alpha-tested materials preserve the real
  // sprite silhouette; forcing colorWrite off avoids touching the finished
  // color image, while forcing depthWrite on makes every visible
  // pet/player/NPC capable of blocking the shell and material-seam passes
  // that follow.
  function renderDepth(activeScene) {
    prune();
    const renderer = deps?.renderer;
    const camera = deps?.camera;
    if (!renderer || !camera) return;
    let meshCount = 0; // Reported through the existing mobile-visible farm log when it changes.
    for (let i = 0; i < meshes.length; i++) {
      const object = meshes[i];
      let root = object;
      while (root.parent) root = root.parent;
      if (root !== activeScene) continue; // Alive, but in a different area's scene right now.
      if (!object.isMesh || !object.visible || !(object.layers.mask & (1 << LAYER))) continue;
      meshCount++;
      if (Array.isArray(object.material)) {
        for (const material of object.material) captureMaterial(material);
      } else {
        captureMaterial(object.material);
      }
    }
    if (meshCount === 0) return;

    const previousLayerMask = camera.layers.mask; // Restored even if the depth replay throws.
    try {
      camera.layers.set(LAYER);
      renderer.render(activeScene, camera);
    } finally {
      camera.layers.mask = previousLayerMask;
      for (const [material, state] of materialStates) {
        material.colorWrite = state.colorWrite;
        material.depthWrite = state.depthWrite;
        material.depthTest = state.depthTest;
        material.depthFunc = state.depthFunc;
      }
      materialStates.clear();
    }
    if (meshCount !== lastOccluderCount) {
      lastOccluderCount = meshCount;
      window.__farmLog?.(`[outline] ${meshCount} PNG avatar plane(s) writing occlusion depth`, 'render');
    }
  }

  window.PngPlaneOutlineOccluder = {
    LAYER,
    init,
    markPngPlane,
    prune,
    renderDepth,
    snapshot: () => ({ registered: meshes.length, lastOccluderCount }),
  };
})();
