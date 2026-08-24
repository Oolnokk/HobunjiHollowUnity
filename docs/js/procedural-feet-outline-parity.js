// Keeps every procedural-feet outline pass on the exact transform used by the visible feet.
//
// The whole leg/foot rig hangs under playerMesh, so it inherits whatever world-space
// delta PlayerBodyTransformComposer applies for the current render (weapon-idle-stance
// body yaw, drunk sway, ragdoll, ...). Outline rendering runs separate shell and
// material-ID passes, often with scene.autoUpdate=false as a performance optimization
// (see outline-render-performance.js) — composer's own re-application of its delta on
// those later passes recomputes playerMesh's own (and its ancestors') matrixWorld from
// the not-yet-re-composed resting local transform, but leaves already-baked descendant
// matrices (the feet) untouched, so the base draw and the outline draws can end up using
// two different matrices for the same frame. Capture each foot mesh's matrixWorld at its
// visible draw and temporarily reuse that exact matrix for every outline override draw,
// exactly mirroring procedural-hand-outline-parity.js's fix for the same class of bug.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const legs = global.ProceduralLegAnimation;
  if (!THREE || !legs?.attach || legs.attach.__hobunjiFeetOutlineParityWrapped) return;

  const activeRigs = new Set(); // Rigs whose newly loaded/replaced foot meshes may need hooks.
  const MAX_SNAPSHOT_AGE_MS = 160;
  const OUTLINE_THICKNESS_MULTIPLIER = 2; // Hands/feet only; shared shell uniform is restored after each limb mesh draw. // Allows the adjacent base->held-overlay->outline sequence without accepting old frames.
  const RESCAN_INTERVAL_MS = 150; // Catches the async fallback->GLB foot swap without needing a dedicated signal.
  const RESCAN_ATTEMPTS = 20; // ~3s — generous relative to typical GLB load time.
  let baseMatrixCaptures = 0; // Diagnostic count of visible foot matrices captured by this adapter.
  let lockedShellDraws = 0; // Diagnostic count of shell draws forced to the captured visible matrix.
  let lockedMaterialIdDraws = 0; // Diagnostic count of material-ID draws forced to the captured visible matrix.
  let missedOutlineSnapshots = 0; // Outline draws where no recent visible matrix was available.

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

  function outlinePassKind(scene, material) {
    if (!scene?.overrideMaterial) return null;
    if (isShellMaterial(material)) return 'shell';
    if (isMaterialIdMaterial(material)) return 'material-id';
    return null;
  }

  function isVisibleFootDraw(scene, material) {
    return !scene?.overrideMaterial && !isShellMaterial(material) && !isMaterialIdMaterial(material);
  }

  function installMeshHook(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    if (mesh.userData?.__hobunjiFeetOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Last matrix used by an ordinary visible foot draw.
      visibleCapturedAt: -Infinity, // Timestamp paired with visibleMatrixWorld for adjacency validation.
      restoreStack: [], // Supports grouped/multiple draw callbacks without leaking a temporary outline matrix.
      thicknessRestoreStack: [], // Per-draw shell-uniform restore entries; keeps non-limb outlines at the global thickness.
    };

    mesh.onBeforeRender = function feetOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();

      if (isVisibleFootDraw(scene, material)) {
        state.visibleMatrixWorld.copy(this.matrixWorld);
        state.visibleCapturedAt = now;
        state.restoreStack.push(null);
        state.thicknessRestoreStack.push(null);
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
        return;
      }

      const passKind = outlinePassKind(scene, material);
      if (!passKind) {
        state.restoreStack.push(null);
        state.thicknessRestoreStack.push(null);
        return;
      }

      const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;
      const previousThickness = Number(thicknessUniform?.value);
      if (thicknessUniform && Number.isFinite(previousThickness)) {
        state.thicknessRestoreStack.push({ uniform: thicknessUniform, value: previousThickness });
        thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER;
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

      // Object3D.onBeforeRender runs before WebGLRenderer derives modelViewMatrix
      // and normalMatrix. Replacing matrixWorld here therefore freezes shell and
      // material-ID rendering to the exact transform that produced the visible foot.
      state.restoreStack.push(this.matrixWorld.clone());
      this.matrixWorld.copy(state.visibleMatrixWorld);
      if (passKind === 'shell') {
        rigState.lockedShellDraws++;
        lockedShellDraws++;
      } else {
        rigState.lockedMaterialIdDraws++;
        lockedMaterialIdDraws++;
      }
    };

    mesh.onAfterRender = function feetOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
      const thicknessRestore = state.thicknessRestoreStack.pop();
      if (thicknessRestore) thicknessRestore.uniform.value = thicknessRestore.value;
    };

    mesh.userData.__hobunjiFeetOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-foot-draw';
    rigState.hookedMeshes++;
    return true;
  }

  function scanRig(handle, rigState) {
    const left = handle?.group?.getObjectByName?.('left_foot') || null;
    const right = handle?.group?.getObjectByName?.('right_foot') || null;
    if (left) left.traverse(child => installMeshHook(child, rigState, 'left'));
    if (right) right.traverse(child => installMeshHook(child, rigState, 'right'));
  }

  function rescanUntilStable(handle, rigState, attempt = 0) {
    if (!activeRigs.has(handle)) return;
    scanRig(handle, rigState);
    if (attempt >= RESCAN_ATTEMPTS) return;
    global.setTimeout?.(() => rescanUntilStable(handle, rigState, attempt + 1), RESCAN_INTERVAL_MS);
  }

  const originalAttach = legs.attach;
  const wrappedAttach = function feetOutlineParityAttach(...args) {
    const handle = originalAttach.apply(this, args);
    if (!handle?.group) return handle;

    const rigState = {
      hookedMeshes: 0, // Number of current-or-former foot meshes that received matrix-lock hooks.
      baseMatrixCaptures: 0, // Visible foot draws captured for this leg rig.
      lockedShellDraws: 0, // Shell draws that reused the exact visible foot matrix.
      lockedMaterialIdDraws: 0, // Material-ID draws that reused the exact visible foot matrix.
      missedOutlineSnapshots: 0, // Outline draws without a recent visible matrix to reuse.
    };
    activeRigs.add(handle);
    // The fallback foot is installed synchronously (hooked by the first scan below);
    // a configured species' GLB foot replaces it asynchronously a little later, so
    // rescanUntilStable keeps re-hooking whatever mesh is actually attached.
    rescanUntilStable(handle, rigState);

    const originalDispose = typeof handle.dispose === 'function' ? handle.dispose.bind(handle) : null;
    if (originalDispose) {
      handle.dispose = function feetOutlineParityDispose(...disposeArgs) {
        activeRigs.delete(handle);
        return originalDispose(...disposeArgs);
      };
    }
    handle.getOutlineParityDebug = () => ({ ...rigState });
    return handle;
  };

  wrappedAttach.__hobunjiFeetOutlineParityWrapped = true;
  wrappedAttach.__hobunjiFeetOutlineParityOriginal = originalAttach;
  legs.attach = wrappedAttach;

  global.HobunjiFeetOutlineParity = Object.freeze({
    getDebug() {
      return {
        activeRigs: activeRigs.size,
        baseMatrixCaptures,
        lockedShellDraws,
        lockedMaterialIdDraws,
        missedOutlineSnapshots,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
        outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
      };
    },
  });
})(window);
