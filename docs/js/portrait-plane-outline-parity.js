// Keeps the flat portrait plane's occlusion-depth draws on the exact transform used
// by its ordinary visible draw.
//
// game.js's outline/held-item pipeline redraws PNG-plane avatars (depth-only,
// colorWrite=false) twice more per frame so their silhouette can occlude 3D held
// items and tools appropriately (PngPlaneOutlineOccluder.renderDepth in js/png-plane-outline-occluder.js, and
// held-object-render-order.js's own non-ground depth rebuild). Both of those
// depth-only passes are classified as "secondary" by outline-render-performance.js
// and run with scene.autoUpdate=false as a performance optimization. Confirmed live
// that this leaves the portrait's own matrixWorld stuck at a stale, differently-
// rotated pose during those passes specifically (e.g. yaw 19deg on the visible base
// draw vs 59deg on the depth-only redraws immediately after, same mesh, same frame) —
// so the reconstructed occlusion silhouette lands in the wrong place whenever the
// body is turned by composer channels (weapon-idle-stance body yaw, drunk sway, ...),
// incorrectly masking outline geometry (hands, feet) that should be fully visible.
// Mirrors procedural-hand-outline-parity.js / procedural-feet-outline-parity.js for
// the same class of bug, keyed on colorWrite instead of an override-material shader
// signature since these depth-only passes don't use one.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const avatarApi = global.PNGPlaneAvatar;
  if (!THREE || !avatarApi?.buildSinglePlaneAvatarModel || avatarApi.buildSinglePlaneAvatarModel.__hobunjiPortraitOutlineParityWrapped) return;

  // PNGPlaneAvatar owns source-pixel deformation and attachment-frame sampling.
  // Do not replace its resolver here: a second implementation can drift from
  // the actual portrait weights and from Animation Author previews.

  const PNG_PLANE_OUTLINE_OCCLUDER_LAYER = globalThis.HobunjiRenderLayers?.PNG_OCCLUDER ?? 4; // Mirrors js/png-plane-outline-occluder.js's LAYER (game.js's _markPngPlane/depth replay).
  const MAX_SNAPSHOT_AGE_MS = 160; // Allows the adjacent base->depth-replay sequence without accepting old frames.
  const RESCAN_INTERVAL_MS = 100; // game.js's own _markPngPlane call (which enables the layer bit below) runs synchronously right after build, but poll briefly in case that ordering ever changes.
  const RESCAN_ATTEMPTS = 20; // ~2s.

  const activeRoots = new Set();
  let baseMatrixCaptures = 0;
  let lockedDepthDraws = 0;
  let missedDepthSnapshots = 0;

  function isVisibleDraw(scene, material) {
    return !scene?.overrideMaterial && material?.colorWrite !== false;
  }

  function isOcclusionDepthPass(scene, material) {
    return !scene?.overrideMaterial && material?.colorWrite === false;
  }

  function installMeshHook(mesh) {
    if (!mesh?.isMesh || mesh.userData?.__hobunjiPortraitOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Last matrix used by an ordinary visible draw.
      visibleCapturedAt: -Infinity, // Timestamp paired with visibleMatrixWorld for adjacency validation.
      restoreMatrices: [], // Reusable per-nesting-level matrices; no per-frame Matrix4 clones.
      restoreStack: [], // Supports grouped/multiple draw callbacks without leaking a temporary occlusion-pass matrix.
    };

    mesh.onBeforeRender = function portraitOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();

      if (isVisibleDraw(scene, material)) {
        state.visibleMatrixWorld.copy(this.matrixWorld);
        state.visibleCapturedAt = now;
        state.restoreStack.push(null);
        baseMatrixCaptures++;
        return;
      }

      if (!isOcclusionDepthPass(scene, material)) {
        state.restoreStack.push(null);
        return;
      }

      const ageMs = now - state.visibleCapturedAt;
      if (!(ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS)) {
        state.restoreStack.push(null);
        missedDepthSnapshots++;
        return;
      }

      // Object3D.onBeforeRender runs before WebGLRenderer derives modelViewMatrix
      // and normalMatrix. Replacing matrixWorld here therefore freezes this
      // depth-only redraw to the exact transform that produced the visible portrait.
      const slot = state.restoreStack.length; // Nested draw callbacks each retain their own temporary pose.
      const restoreMatrix = state.restoreMatrices[slot] ||= new THREE.Matrix4();
      state.restoreStack.push(restoreMatrix.copy(this.matrixWorld));
      this.matrixWorld.copy(state.visibleMatrixWorld);
      lockedDepthDraws++;
    };

    // Same bounded pose change as the hand/foot adapters: a depth-only redraw
    // may use the last visible matrix instead of matrixWorld. Advertise both so
    // the held replay scissor (held-object-render-order.js) can bound this
    // portrait — skinned ones included — instead of redrawing the whole screen.
    // Only when this is the first hook: unknown chains stay unbounded.
    if (!previousBefore || previousBefore === THREE.Object3D?.prototype?.onBeforeRender) {
      Object.defineProperty(mesh, '__hobunjiXrayBoundParity', {
        configurable: true,
        value: {
          hook: mesh.onBeforeRender,
          visibleMatrixWorld: state.visibleMatrixWorld,
          isFresh: () => {
            const age = performance.now() - state.visibleCapturedAt;
            return age >= 0 && age <= MAX_SNAPSHOT_AGE_MS;
          },
        },
      });
    }

    mesh.onAfterRender = function portraitOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
    };

    // This pair only changes this mesh's matrix and restores it afterwards.
    // Advertise the exact pair, never a custom wrapper or an unknown prior
    // after-hook, so private water passes may safely prune unrelated branches.
    const parity = mesh.__hobunjiXrayBoundParity;
    if (parity?.hook === mesh.onBeforeRender &&
        (!previousAfter || previousAfter === THREE.Object3D?.prototype?.onAfterRender)) {
      parity.localRestoreHook = mesh.onAfterRender;
    }
    mesh.userData.__hobunjiPortraitOutlineParity = true;
    return true;
  }

  const PNG_PLANE_OUTLINE_OCCLUDER_MASK = (1 << PNG_PLANE_OUTLINE_OCCLUDER_LAYER) >>> 0;
  function hasOccluderLayer(mesh) {
    // THREE.Layers (r128) has no isEnabled(); membership is a raw mask bit test.
    return !!(Number(mesh?.layers?.mask ?? 0) & PNG_PLANE_OUTLINE_OCCLUDER_MASK);
  }

  function scanRoot(root) {
    root?.traverse?.(child => {
      if (child.isMesh && hasOccluderLayer(child)) installMeshHook(child);
    });
  }

  function rescanUntilStable(root, attempt = 0) {
    if (!activeRoots.has(root)) return;
    scanRoot(root);
    if (attempt >= RESCAN_ATTEMPTS) return;
    global.setTimeout?.(() => rescanUntilStable(root, attempt + 1), RESCAN_INTERVAL_MS);
  }

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const wrappedBuild = function portraitOutlineParityBuild(...args) {
    const avatarRoot = originalBuild.apply(this, args);
    if (!avatarRoot) return avatarRoot;
    activeRoots.add(avatarRoot);
    rescanUntilStable(avatarRoot);
    return avatarRoot;
  };
  wrappedBuild.__hobunjiPortraitOutlineParityWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  if (avatarApi.disposeAvatarModel && !avatarApi.disposeAvatarModel.__hobunjiPortraitOutlineParityWrapped) {
    const originalDispose = avatarApi.disposeAvatarModel.bind(avatarApi);
    avatarApi.disposeAvatarModel = function portraitOutlineParityDispose(avatarRoot) {
      activeRoots.delete(avatarRoot);
      return originalDispose(avatarRoot);
    };
    avatarApi.disposeAvatarModel.__hobunjiPortraitOutlineParityWrapped = true;
  }

  global.HobunjiPortraitOutlineParity = Object.freeze({
    installMeshHook, // Carry-specific PNGs created outside the normal avatar builder use the same visible-pose replay.
    getMirrorShoulderPerchWithPortrait: () => true,
    setMirrorShoulderPerchWithPortrait: () => true, // Compatibility no-op: portrait-aware perch mirroring is now fixed on and has no Settings surface.
    getDebug() {
      return {
        activeRoots: activeRoots.size,
        baseMatrixCaptures,
        lockedDepthDraws,
        missedDepthSnapshots,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
        skinnedPixelCpuParity: !!avatarApi.__hobunjiSkinnedPixelCpuParityInstalled,
        mirrorShoulderPerchWithPortrait: true,
        shoulderPetXrayEnabled: false,
      };
    },
  });
})(window);
