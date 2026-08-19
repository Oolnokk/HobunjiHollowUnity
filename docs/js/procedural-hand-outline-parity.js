// Keeps inverted-shell hand outlines on the exact transform used by the visible hand.
//
// Hand placement has a deliberate late pre-render sync: an invisible sentinel updates
// the hand sockets after toolHolder's render-time stance hook has produced its final
// matrix. The outline renderer may then run a second pass with scene.autoUpdate=false,
// so recomputing or reusing transforms independently can put the shell on a different
// matrix than the hand that was actually drawn. Capture each hand mesh's matrixWorld
// at its visible draw, then temporarily reuse that exact matrix for the immediately
// following shell draw. Authored hand/tool transforms are never modified.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const hands = global.ProceduralHandAttachments;
  if (!THREE || !hands?.attach || hands.attach.__hobunjiHandOutlineParityWrapped) return;

  const activeRigs = new Set(); // Rigs whose newly loaded/replaced hand meshes may need hooks.
  const MAX_SNAPSHOT_AGE_MS = 120; // Prevents an old visible frame from being reused after a render interruption.
  let baseMatrixCaptures = 0; // Diagnostic count of visible hand matrices captured by this adapter.
  let lockedShellDraws = 0; // Diagnostic count of shell draws forced to the captured visible matrix.
  let missedShellSnapshots = 0; // Shell draws where no recent visible matrix was available.

  function isShellMaterial(material) {
    return !!(
      material?.isShaderMaterial
      && material.side === THREE.BackSide
      && material.uniforms?.uThickness
    );
  }

  function isVisibleHandDraw(scene, material) {
    // scene.overrideMaterial is how the shell/material-ID passes replace the hand's
    // normal material. A normal draw therefore gives us the matrix that produced the
    // hand pixels the player actually sees, regardless of render-target plumbing.
    return !scene?.overrideMaterial && !isShellMaterial(material);
  }

  function installMeshHook(mesh, rigState) {
    if (!mesh?.isMesh || mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Last matrix used by an ordinary visible hand draw.
      visibleCapturedAt: -Infinity, // Timestamp paired with visibleMatrixWorld for adjacency validation.
      restoreStack: [], // Supports nested/grouped draw callbacks without leaking a temporary shell matrix.
    };

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();

      if (isVisibleHandDraw(scene, material)) {
        state.visibleMatrixWorld.copy(this.matrixWorld);
        state.visibleCapturedAt = now;
        state.restoreStack.push(null);
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
        return;
      }

      if (!isShellMaterial(material)) {
        state.restoreStack.push(null);
        return;
      }

      const ageMs = now - state.visibleCapturedAt;
      if (!(ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS)) {
        state.restoreStack.push(null);
        rigState.missedShellSnapshots++;
        missedShellSnapshots++;
        return;
      }

      // onBeforeRender runs before WebGLRenderer derives modelViewMatrix and
      // normalMatrix, so replacing matrixWorld here makes the shell use the exact
      // transform of the visible hand while still letting Three.js calculate all
      // camera/normal state normally for this pass.
      state.restoreStack.push(this.matrixWorld.clone());
      this.matrixWorld.copy(state.visibleMatrixWorld);
      rigState.lockedShellDraws++;
      lockedShellDraws++;
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-hand-draw';
    rigState.hookedMeshes++;
    return true;
  }

  function scanRig(rig, rigState) {
    rig?.group?.traverse?.(child => installMeshHook(child, rigState));
  }

  function waitForInitialGlbs(rig, rigState, attempt = 0) {
    if (!activeRigs.has(rig)) return;
    scanRig(rig, rigState);
    const leftLoaded = !!rig.group?.getObjectByName?.('left_hand_visual');
    const rightLoaded = !!rig.group?.getObjectByName?.('right_hand_visual');
    const failed = !!rig.getDebug?.()?.loadError;
    if ((leftLoaded && rightLoaded) || failed || attempt >= 150) return;
    global.setTimeout?.(() => waitForInitialGlbs(rig, rigState, attempt + 1), 100);
  }

  const originalAttach = hands.attach;
  const wrappedAttach = function handOutlineParityAttach(...args) {
    const rig = originalAttach.apply(this, args);
    if (!rig) return rig;

    const rigState = {
      hookedMeshes: 0, // Number of current-or-former hand meshes that received matrix-lock hooks.
      baseMatrixCaptures: 0, // Visible hand draws captured for this hand rig.
      lockedShellDraws: 0, // Shell draws that reused the exact visible hand matrix.
      missedShellSnapshots: 0, // Shell draws without a recent visible matrix to reuse.
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
          outlineMatrixSource: 'visible-hand-draw',
          outlineHookedMeshes: rigState.hookedMeshes,
          outlineBaseMatrixCaptures: rigState.baseMatrixCaptures,
          outlineLockedShellDraws: rigState.lockedShellDraws,
          outlineMissedShellSnapshots: rigState.missedShellSnapshots,
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
    getDebug() {
      return {
        activeRigs: activeRigs.size,
        baseMatrixCaptures,
        lockedShellDraws,
        missedShellSnapshots,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
      };
    },
  });
})(window);
