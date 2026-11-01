// Keeps every procedural-hand outline pass on the exact transform used by the visible hand.
//
// Hand placement has a deliberate late pre-render sync: an invisible sentinel updates
// the hand sockets after toolHolder's render-time stance hook has produced its final
// matrix. Outline rendering then uses separate occluder-depth, shell, and material-ID
// passes, often with scene.autoUpdate=false. Snapshot each hand mesh's already-final
// matrixWorld directly in the visible draw's onBeforeRender (the same ordering used by
// feet), then temporarily reuse that exact matrix for every secondary draw. The same meshes
// are also registered with HeldObjectRenderOrder so hands x-ray grass/ground exactly
// like held tool sprites while ordinary scene occluders still block them.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const hands = global.ProceduralHandAttachments;
  if (!THREE || !hands?.attach || hands.attach.__hobunjiHandOutlineParityWrapped) return;

  const activeRigs = new Set(); // Rigs whose newly loaded/replaced hand meshes may need hooks.
  const meshRigStates = new WeakMap(); // Mesh -> owning rig, so held-overlay scissor bounds can be corrected before they are measured.
  const MAX_SNAPSHOT_AGE_MS = 160;
  const OUTLINE_THICKNESS_MULTIPLIER = 2; // Shared shell uniform is restored after each hand draw.
  const OUTLINE_REFERENCE_DEPTH = 5; // Distant outlines shrink beyond this depth; closer hands keep the feet's baseline thickness.
  let baseMatrixCaptures = 0; // Diagnostic count of visible hand matrices captured by this adapter.
  let lockedOccluderDepthDraws = 0; // Diagnostic count of pre-shell depth replays forced to the captured visible hand matrix.
  let lockedShellDraws = 0; // Diagnostic count of shell draws forced to the captured visible matrix.
  let lockedMaterialIdDraws = 0; // Diagnostic count of material-ID draws forced to the captured visible matrix.
  let missedOutlineSnapshots = 0; // Outline draws where no recent visible matrix was available.
  let heldXrayTaggedMeshes = 0; // Current-or-former procedural hand meshes registered with the selective ground x-ray system.
  let visualMatrixResyncs = 0; // Counts visible hand meshes repaired after late socket/body transforms.
  let largestVisualMatrixDrift = 0; // Largest repaired hand-origin displacement in world units for Pixel Probe.

  function isShellMaterial(material) {
    return !!(
      material?.isShaderMaterial
      && material.side === THREE.BackSide
      && material.uniforms?.uThickness
    );
  }

  function isMaterialIdMaterial(material) {
    return !!(
      material?.isShaderMaterial
      && material.uniforms?.uIdColor
    );
  }

  function secondaryPassKind(scene, camera, material) {
    if (
      !scene?.overrideMaterial
      && material?.colorWrite === false
      && camera?.layers?.mask === (1 << 4)
    ) return 'occluder-depth';
    if (!scene?.overrideMaterial) return null;
    if (isShellMaterial(material)) return 'shell';
    if (isMaterialIdMaterial(material)) return 'material-id';
    return null;
  }

  function isVisibleHandDraw(scene, material) {
    // Only a real COLOR-WRITING hand draw may become the outline transform source.
    // game.js replays PNG-plane materials with colorWrite=false immediately before
    // the shell pass to rebuild occluder depth. Treating that depth-only replay as
    // visible overwrote the correctly gripped hand matrix with a hierarchy-only one,
    // which produced a separate black hand-shaped shell.
    return !scene?.overrideMaterial
      && material?.colorWrite !== false
      && !isShellMaterial(material)
      && !isMaterialIdMaterial(material);
  }

  function markHeldXray(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    if (mesh.userData?.hobunjiPortraitOccludedWingLayer === true) return false;
    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiProceduralHand = true;
    mesh.userData.hobunjiProceduralHandSide = side || mesh.userData.hobunjiProceduralHandSide || null;
    if (mesh.userData.__hobunjiHandHeldXray) return false;

    // markHeldPlane accepts arbitrary Mesh/SkinnedMesh objects despite its legacy
    // name; it is the existing public entry point for the selective non-ground
    // depth replay used by tool sprites.
    const xray = global.HeldObjectRenderOrder;
    const registered = !!xray?.markHeldPlane?.(mesh);
    if (!registered && !xray?.installed) {
      // The game normally loads HeldObjectRenderOrder before hands. Keep the tag
      // anyway so its fallback scene scan can adopt the mesh if load order changes.
      mesh.userData.hobunjiHeldObjectPlane = true;
    }
    mesh.userData.__hobunjiHandHeldXray = true;
    rigState.heldXrayMeshes++;
    heldXrayTaggedMeshes++;
    return true;
  }

  // Body/weapon poses can move sockets after Three has traversed the scene.
  // Rebuild only the hand descendants against the ALREADY-BAKED parent world
  // matrix. Object3D.updateWorldMatrix(true) would recompute the entire parent
  // hierarchy and discard PlayerBodyTransformComposer's temporary render pose.
  function refreshVisibleHandMatrix(mesh, rig) {
    const authority = rig?.group?.parent; // The existing floor/body transform owns the final frame; never update it here.
    if (!authority?.matrixWorld || !mesh?.matrixWorld) return 0;
    const chain = []; // Small socket -> calibration -> visual -> GLB chain refreshed only for the visible color draw.
    for (let node = mesh; node && node !== authority; node = node.parent) {
      if (!node.matrixWorld || !node.matrix || typeof node.updateMatrix !== 'function') return 0;
      chain.push(node);
    }
    if (!chain.length || chain[chain.length - 1].parent !== authority) return 0;
    const old = mesh.matrixWorld.elements;
    const oldX = old[12], oldY = old[13], oldZ = old[14]; // Detects the detached-hand case without relying on debug-only ray casts.
    for (let i = chain.length - 1; i >= 0; i--) {
      const node = chain[i];
      if (node.matrixAutoUpdate !== false) node.updateMatrix();
      node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
    }
    const current = mesh.matrixWorld.elements;
    const drift = Math.hypot(current[12] - oldX, current[13] - oldY, current[14] - oldZ);
    return Number.isFinite(drift) ? drift : 0;
  }

  function syncHandMatrix(mesh, rigState) {
    const drift = refreshVisibleHandMatrix(mesh, rigState?.rig);
    if (drift > 0.0001 && rigState) {
      rigState.visualMatrixResyncs++;
      visualMatrixResyncs++;
      rigState.largestVisualMatrixDrift = Math.max(rigState.largestVisualMatrixDrift, drift);
      largestVisualMatrixDrift = Math.max(largestVisualMatrixDrift, drift);
    }
    return drift;
  }

  function installMeshHook(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    if (mesh.userData?.noOutline !== true) mesh.layers.enable(1); // Visual replacement/x-ray routing must never drop either hand from the shell layer.
    markHeldXray(mesh, rigState, side);
    meshRigStates.set(mesh, rigState); // Overlay scissor prep uses the same rig owner as the visible hand callback.
    if (mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Exact matrixWorld about to be used by the latest genuine color-writing hand draw.
      visibleCapturedAt: -Infinity,
      restoreStack: [], // Per-render temporary matrix restores for shell/material-ID passes.
      thicknessRestoreStack: [], // Per-render shell-thickness restores so the shared uniform cannot leak.
      indexRestoreStack: [], // Per-render index restores for body-coloured parrot shells trimmed before the portrait-covered wing.
    };

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      // Let any pre-existing hand/tool stance hook finish first. The snapshot below
      // must observe the same final matrixWorld that Three.js is about to use for
      // this color-writing draw — not a transform reconstructed after the fact.
      previousBefore?.apply(this, args);
      const scene = args[1];
      const camera = args[2];
      const material = args[4];
      const now = performance.now();

      if (isVisibleHandDraw(scene, material)) {
        // HeldObjectRenderOrder can draw this mesh after the base scene's
        // autoUpdate pass; use the final socket and cached body world transform.
        // Never perform this rebuild in outline/depth passes: those reuse the
        // exact visible matrix captured here.
        syncHandMatrix(this, rigState);
        state.visibleMatrixWorld.copy(this.matrixWorld);
        state.visibleCapturedAt = now;
        state.restoreStack.push(null);
        state.thicknessRestoreStack.push(null);
        state.indexRestoreStack.push(null);
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
        return;
      }

      const passKind = secondaryPassKind(scene, camera, material);
      if (!passKind) {
        state.restoreStack.push(null);
        state.thicknessRestoreStack.push(null);
        state.indexRestoreStack.push(null);
        return;
      }

      const shellIndex = passKind === 'shell' ? this.userData?.hobunjiShellIndex : null; // Restricts only the shell draw; base colour and occluder depth retain the full connected body/wing mesh.
      if (shellIndex && this.geometry?.index) {
        state.indexRestoreStack.push(this.geometry.index);
        this.geometry.setIndex(shellIndex);
      } else {
        state.indexRestoreStack.push(null);
      }

      const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;
      const previousThickness = Number(thicknessUniform?.value);
      if (thicknessUniform && Number.isFinite(previousThickness)) {
        state.thicknessRestoreStack.push({ uniform: thicknessUniform, value: previousThickness });
        // The shared shell shader cancels perspective with clip.w. Undo that
        // cancellation for hands using the final visible pose's camera depth.
        const matrix = now - state.visibleCapturedAt <= MAX_SNAPSHOT_AGE_MS ? state.visibleMatrixWorld : this.matrixWorld; // Uses the same pose as the shell below.
        const world = matrix.elements; // World-space hand origin used to measure view depth without allocating a vector.
        const view = camera?.matrixWorldInverse?.elements; // Camera view matrix is current before Three invokes mesh hooks.
        const depth = view ? -(view[2] * world[12] + view[6] * world[13] + view[10] * world[14] + view[14]) : OUTLINE_REFERENCE_DEPTH; // Perspective depth, not radial distance, matches projection.
        const distanceScale = camera?.isPerspectiveCamera && Number.isFinite(depth) ? Math.min(1, OUTLINE_REFERENCE_DEPTH / Math.max(0.1, depth)) : 1; // Match feet at close/default distances; perspective may thin the shell but never inflate it.
        thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER * distanceScale;
        material.uniformsNeedUpdate = true;
      } else {
        state.thicknessRestoreStack.push(null);
      }

      const ageMs = now - state.visibleCapturedAt;
      if (!(ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS)) {
        state.restoreStack.push(null);
        rigState.missedOutlineSnapshots++;
        missedOutlineSnapshots++;
        return;
      }

      // Three r128 calls Object3D.onBeforeRender BEFORE deriving modelViewMatrix
      // and normalMatrix. Copying the visible draw's direct matrixWorld here makes
      // the shell use precisely that pose. Do not call updateMatrixWorld and do not
      // reconstruct from modelViewMatrix after a draw; both alter the intended
      // base->secondary render ordering used by outline-render-performance.js.
      state.restoreStack.push(this.matrixWorld.clone());
      this.matrixWorld.copy(state.visibleMatrixWorld);
      if (passKind === 'occluder-depth') {
        rigState.lockedOccluderDepthDraws++;
        lockedOccluderDepthDraws++;
      } else if (passKind === 'shell') {
        rigState.lockedShellDraws++;
        lockedShellDraws++;
      } else {
        rigState.lockedMaterialIdDraws++;
        lockedMaterialIdDraws++;
      }
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      // Delegate first, matching the feet parity adapter: any older callback gets
      // to clean up its own temporary render state before we restore ours.
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
      const restoreIndex = state.indexRestoreStack.pop();
      if (restoreIndex) this.geometry?.setIndex?.(restoreIndex);
      const thicknessRestore = state.thicknessRestoreStack.pop();
      if (thicknessRestore) {
        thicknessRestore.uniform.value = thicknessRestore.value;
        const material = args[4];
        if (material?.isShaderMaterial) material.uniformsNeedUpdate = true;
      }
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-hand-pre-render';
    rigState.hookedMeshes++;
    return true;
  }

  function scanVisual(root, rigState, side) {
    root?.traverse?.(child => installMeshHook(child, rigState, side));
  }

  function scanRig(rig, rigState) {
    let found = false;
    for (const side of ['left', 'right']) {
      const socket = rig?.group?.getObjectByName?.(`${side}_hand_socket`) || null;
      if (!socket) continue;
      found = true;
      // The socket is authoritative. Do not depend on whether a fallback/GLB
      // visual happened to have the expected child name at the instant it was installed.
      for (const child of socket.children || []) {
        if (child?.name === `${side}_hand_grip_axes`) continue;
        scanVisual(child, rigState, side);
      }
    }
    if (!found) rig?.group?.traverse?.(child => installMeshHook(child, rigState, null));
  }

  function waitForInitialGlbs(rig, rigState, attempt = 0) {
    if (!activeRigs.has(rig)) return;
    scanRig(rig, rigState);

    // attach() installs same-named fallback visuals synchronously, then swaps the
    // real GLBs in asynchronously. Name presence alone therefore cannot mean the
    // permanent meshes have been hooked; the GLB visual exposes handModelKey while
    // the temporary fallback deliberately does not.
    const debug = rig.getDebug?.() || {};
    const expectsGlb = !!debug.glb;
    const leftVisual = rig.group?.getObjectByName?.('left_hand_visual') || null;
    const rightVisual = rig.group?.getObjectByName?.('right_hand_visual') || null;
    const leftLoaded = !!leftVisual?.userData?.handModelKey;
    const rightLoaded = !!rightVisual?.userData?.handModelKey;
    const failed = !!debug.loadError;

    rigState.initialGlbWaitAttempts = Math.max(rigState.initialGlbWaitAttempts, attempt + 1);
    if (!expectsGlb || (leftLoaded && rightLoaded) || failed || attempt >= 150) {
      rigState.initialGlbReady = leftLoaded && rightLoaded;
      rigState.initialGlbWaitTimedOut = expectsGlb && !rigState.initialGlbReady && !failed && attempt >= 150;
      return;
    }
    global.setTimeout?.(() => waitForInitialGlbs(rig, rigState, attempt + 1), 100);
  }

  const originalAttach = hands.attach;
  const wrappedAttach = function handOutlineParityAttach(...args) {
    const rig = originalAttach.apply(this, args);
    if (!rig) return rig;

    const rigState = {
      rig, // Owner of the hand sockets, used to preserve its baked body transform when rebuilding visual matrices.
      visualMatrixResyncs: 0, // Visible draws where a stale hand origin was repaired.
      largestVisualMatrixDrift: 0, // Worst repaired origin discrepancy on this rig.
      hookedMeshes: 0, // Number of current-or-former hand meshes that received matrix-lock hooks.
      heldXrayMeshes: 0, // Hand meshes registered with selective ground/grass x-ray.
      baseMatrixCaptures: 0, // Visible hand draws captured for this hand rig.
      lockedOccluderDepthDraws: 0, // Pre-shell depth replays that reused the exact visible hand matrix.
      lockedShellDraws: 0, // Shell draws that reused the exact visible hand matrix.
      lockedMaterialIdDraws: 0, // Material-ID draws that reused the exact visible hand matrix.
      missedOutlineSnapshots: 0, // Outline draws without a recent visible matrix to reuse.
      initialGlbWaitAttempts: 0, // Poll count used to verify the initial async fallback -> GLB replacement was actually observed.
      initialGlbReady: false, // True once both permanent GLB visuals, rather than same-named fallbacks, have been scanned.
      initialGlbWaitTimedOut: false, // Mobile-readable warning state when a configured GLB never replaces its fallback within the bounded poll.
    };
    activeRigs.add(rig);
    scanRig(rig, rigState);
    waitForInitialGlbs(rig, rigState);

    const originalRefresh = typeof rig.refreshModelProfile === 'function'
      ? rig.refreshModelProfile.bind(rig)
      : null;
    if (originalRefresh) {
      rig.refreshModelProfile = function handOutlineParityRefresh(...refreshArgs) {
        const result = originalRefresh(...refreshArgs);
        Promise.resolve(result).finally(() => scanRig(rig, rigState));
        return result;
      };
    }

    const originalDebug = typeof rig.getDebug === 'function' ? rig.getDebug.bind(rig) : null;
    if (originalDebug) {
      rig.getDebug = function handOutlineParityDebug() {
        return {
          ...originalDebug(),
          outlineMatrixParity: true,
          outlineMatrixSource: 'visible-hand-pre-render',
          visualMatrixResyncs: rigState.visualMatrixResyncs,
          largestVisualMatrixDrift: rigState.largestVisualMatrixDrift,
          outlineHookedMeshes: rigState.hookedMeshes,
          heldXrayMeshes: rigState.heldXrayMeshes,
          outlineBaseMatrixCaptures: rigState.baseMatrixCaptures,
          outlineLockedOccluderDepthDraws: rigState.lockedOccluderDepthDraws,
          outlineLockedShellDraws: rigState.lockedShellDraws,
          outlineLockedMaterialIdDraws: rigState.lockedMaterialIdDraws,
          outlineMissedSnapshots: rigState.missedOutlineSnapshots,
          outlineInitialGlbWaitAttempts: rigState.initialGlbWaitAttempts,
          outlineInitialGlbReady: rigState.initialGlbReady,
          outlineInitialGlbWaitTimedOut: rigState.initialGlbWaitTimedOut,
          outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
          outlineDistanceScaling: 'inverse-view-depth-capped-at-foot-thickness',
          outlineReferenceDepth: OUTLINE_REFERENCE_DEPTH,
        };
      };
    }

    const originalDispose = typeof rig.dispose === 'function' ? rig.dispose.bind(rig) : null;
    if (originalDispose) {
      rig.dispose = function handOutlineParityDispose(...disposeArgs) {
        activeRigs.delete(rig);
        return originalDispose(...disposeArgs);
      };
    }
    return rig;
  };

  wrappedAttach.__hobunjiHandOutlineParityWrapped = true;
  wrappedAttach.__hobunjiHandOutlineParityOriginal = originalAttach;
  hands.attach = wrappedAttach;

  global.HobunjiHandOutlineParity = Object.freeze({
    refreshHeldMatrices(meshes) {
      // Called after the ordinary frame's hand-driver sentinel has positioned
      // sockets, but BEFORE HeldObjectRenderOrder measures overlay scissor
      // bounds/culls meshes. A late visible-draw repair alone would be clipped.
      let refreshed = 0;
      for (const mesh of meshes || []) {
        const rigState = meshRigStates.get(mesh);
        if (!rigState || !activeRigs.has(rigState.rig)) continue;
        syncHandMatrix(mesh, rigState);
        refreshed++;
      }
      return refreshed;
    },
    getDebug() {
      return {
        activeRigs: activeRigs.size,
        baseMatrixCaptures,
        lockedOccluderDepthDraws,
        lockedShellDraws,
        lockedMaterialIdDraws,
        missedOutlineSnapshots,
        heldXrayTaggedMeshes,
        visualMatrixResyncs,
        largestVisualMatrixDrift,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
        outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
        outlineDistanceScaling: 'inverse-view-depth-capped-at-foot-thickness',
        latestChange: 'Held hand matrices refresh before overlay scissor calculation and again at visible draw without recomputing render-time body-composer transforms; outlines reuse that capture.',
        outlineReferenceDepth: OUTLINE_REFERENCE_DEPTH,
        heldXray: global.HeldObjectRenderOrder?.snapshot?.() || null,
      };
    },
  });
})(window);
