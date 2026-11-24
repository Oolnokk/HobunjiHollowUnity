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
  const LAYER = globalThis.HobunjiRenderLayers?.PNG_OCCLUDER ?? 4; // Named in js/render-layers.js.

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
  let sharedAncestorRefreshesAvoided = 0; // Counts repeated native ancestor matrix work eliminated inside the PNG depth pass.

  function init(injectedDeps) { deps = injectedDeps; }

  function registerDepthMesh(mesh) {
    if (!mesh?.isMesh) return false;
    mesh.layers.enable(LAYER);
    if (registered.has(mesh)) return false;
    registered.add(mesh);
    meshes.push(mesh);
    return true;
  }

  // Tagging the root group lets depth-only source passes hide PNG planes
  // temporarily without touching the main colour pass that actually shows
  // them. Each child mesh also joins the dedicated outline-occluder layer.
  function markPngPlane(obj) {
    if (!obj) return;
    obj.userData.isPngPlane = true;
    obj.traverse(child => {
      if (!child.isMesh) return;
      // A hostile's portrait root also contains real GLB hands/feet. Those
      // already own volume-shell and visible-matrix hooks; tagging the whole
      // avatar as PNG must never disable their outlines or repaint their color.
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (child.userData.hobunjiProceduralHand || child.userData.hobunjiProceduralFoot
          || materials.some(material => material?.userData?.hobunjiHandRole || material?.userData?.hobunjiFootRole)) return;
      // PNG art supplies its own outline. Disable the shell layer on the
      // mesh itself, while retaining this layer for depth-only occlusion of
      // genuine 3D outlines behind the sprite.
      child.userData.isPngPlane = true;
      child.userData.noOutline = true;
      child.layers.disable(1);
      child.layers.enable(LAYER);
      registerDepthMesh(child);
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
  // Match native updateWorldMatrix(true, false) using the ancestry already walked for
  // scene ownership. Custom world/local transform hooks keep the old recursive path.
  function refreshDepthWorldMatrix(object, chain, refreshed, nativeUpdate, nativeLocalUpdate) {
    if (!refreshed || !nativeUpdate) { object.updateWorldMatrix?.(true, false); return; }
    // Check the complete chain, even past cached parents: a custom local method can
    // change another object's transform or have observable side effects.
    for (const node of chain) {
      if (node.updateWorldMatrix !== nativeUpdate
          || (node.matrixAutoUpdate !== false && node.updateMatrix !== nativeLocalUpdate)) {
        refreshed.clear();
        object.updateWorldMatrix?.(true, false);
        return;
      }
    }
    let first = chain.length - 1; // Root-to-leaf order, omitting the already refreshed prefix.
    while (first >= 0 && refreshed.has(chain[first])) first--;
    if (first < chain.length - 1) sharedAncestorRefreshesAvoided++;
    for (let i = first; i >= 0; i--) {
      nativeUpdate.call(chain[i], false, false);
      refreshed.add(chain[i]);
    }
  }

  function collectDepthMeshes(activeScene) {
    const nativeUpdate = activeScene && THREE.Object3D?.prototype?.updateWorldMatrix;
    const nativeLocalUpdate = THREE.Object3D?.prototype?.updateMatrix;
    const refreshed = nativeUpdate ? new Set() : null; // Never share stale matrices between frames.
    const chain = []; // Reuse one ancestry array for all registered meshes; pruning needs no transform path.
    let writeIdx = 0;
    let meshCount = 0; // Counts active-scene depth participants while pruning detached registrations in the same parent walk.
    for (let i = 0; i < meshes.length; i++) {
      const object = meshes[i];
      let root = object;
      chain.length = 0;
      if (refreshed) chain.push(root);
      let hierarchyVisible = root.visible !== false; // NPC render-only culling hides roots, not every child plane.
      while (root.parent) {
        root = root.parent;
        if (refreshed) chain.push(root);
        if (root.visible === false) hierarchyVisible = false;
      }
      if (!root.isScene) { // Despawned -- drop from the registry.
        registered.delete(object);
        continue;
      }
      meshes[writeIdx++] = object;
      if (root !== activeScene) continue; // Retain inactive-area actors without modifying their materials.
      if (!object.isMesh || !hierarchyVisible || !(object.layers.mask & (1 << LAYER))) continue;
      meshCount++;
      // The base colour pass already updated the scene. Refresh only this depth participant
      // and its ancestors for any late animation-hook changes before skipping another whole-scene update.
      refreshDepthWorldMatrix(object, chain, refreshed, nativeUpdate, nativeLocalUpdate);
      if (Array.isArray(object.material)) {
        for (const material of object.material) captureMaterial(material);
      } else {
        captureMaterial(object.material);
      }
    }
    meshes.length = writeIdx;
    return meshCount;
  }

  function prune() { collectDepthMeshes(null); }

  function captureMaterial(material) {
    if (!material || materialStates.has(material)) return;
    materialStates.set(material, { colorWrite: material.colorWrite, depthWrite: material.depthWrite, depthTest: material.depthTest, depthFunc: material.depthFunc, alphaTest: material.alphaTest });
    material.colorWrite = false;
    material.depthWrite = true;
    // Color-only portraits may normally avoid depth writing, but this replay
    // must still ignore faint anti-alias fringe when building an outline mask.
    if (material.map && Number(material.alphaTest) > 0) {
      const maskCutoff = Number(window.HobunjiSpritePngSurface?.maskAlphaTest?.()) || 0.35; // Matches the shared PNG plane's solid-coverage threshold.
      material.alphaTest = Math.max(material.alphaTest, maskCutoff);
    }
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
    const renderer = deps?.renderer;
    const camera = deps?.camera;
    // Combines the former prune() and active-scene scan so each registered mesh climbs to its scene only once per outlined frame.
    const meshCount = collectDepthMeshes(renderer && camera ? activeScene : null);
    if (!renderer || !camera || meshCount === 0) return;

    const previousLayerMask = camera.layers.mask; // Restored even if the depth replay throws.
    const previousSceneAutoUpdate = activeScene.autoUpdate; // Reinstated after this additional render pass.
    // Depth-only has to hold for EVERY layer-4 mesh, not just the registered ones whose materials
    // captureMaterial() silenced: a mesh that inherited the layer without being registered (e.g. a cloned
    // dual-wield weapon copy) would otherwise paint itself in colour over the finished frame, outside the
    // owner's portrait stencil and depth, so it showed through a shoulder pet's depth-write-free front card.
    // Locking the GL colour mask is the same primitive the held-object compositor uses for its depth passes.
    const colorBuffer = renderer.state?.buffers?.color;
    const lockColor = !!colorBuffer?.setMask && !!colorBuffer?.setLocked;
    try {
      if (lockColor) {
        colorBuffer.setMask(false);
        colorBuffer.setLocked(true);
      }
      camera.layers.set(LAYER);
      activeScene.autoUpdate = false; // The colour pass resolved the world; only registered depth meshes need a fresh transform.
      renderer.render(activeScene, camera);
    } finally {
      if (lockColor) {
        colorBuffer.setLocked(false);
        colorBuffer.setMask(true);
      }
      camera.layers.mask = previousLayerMask;
      activeScene.autoUpdate = previousSceneAutoUpdate;
      for (const [material, state] of materialStates) {
        material.colorWrite = state.colorWrite;
        material.depthWrite = state.depthWrite;
        material.depthTest = state.depthTest;
        material.depthFunc = state.depthFunc;
        if (state.alphaTest !== undefined) material.alphaTest = state.alphaTest;
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
    registerDepthMesh, // Depth-only participants can retain their own 3D shell outlines.
    prune,
    renderDepth,
    snapshot: () => ({ registered: meshes.length, lastOccluderCount, sharedAncestorRefreshesAvoided }),
  };
})();
