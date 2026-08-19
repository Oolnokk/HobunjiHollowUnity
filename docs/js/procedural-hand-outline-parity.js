// Keeps inverted-shell hand outlines aligned with mirrored hand meshes.
//
// Hand GLBs intentionally use negative X scale for the mirrored side, and the
// avatar hierarchy may also be reflected. A reflected world matrix reverses the
// geometric meaning of transformed normals, so the shared shell shader's normal
// extrusion must reverse too or the outline contracts/offsets instead of expanding
// around the visible hand. This adapter changes only the shell-pass thickness sign;
// visible hand transforms, authored origins, grip math, and materials are untouched.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const hands = global.ProceduralHandAttachments;
  if (!THREE || !hands?.attach || hands.attach.__hobunjiHandOutlineParityWrapped) return;

  const activeRigs = new Set(); // Rigs whose newly loaded/replaced hand meshes may need hooks.
  let correctedShellDraws = 0; // Diagnostic count of reflected shell draws corrected by this adapter.

  function isShellMaterial(material) {
    return !!(
      material?.isShaderMaterial
      && material.side === THREE.BackSide
      && material.uniforms?.uThickness
    );
  }

  function installMeshHook(mesh, rigState) {
    if (!mesh?.isMesh || mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const thicknessRestoreStack = []; // Paired shell thickness values for nested/grouped draw callbacks.

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const material = args[4];
      const thicknessUniform = material?.uniforms?.uThickness;
      const thickness = Number(thicknessUniform?.value);
      const reflected = this.matrixWorld?.determinant?.() < 0;
      if (!isShellMaterial(material) || !Number.isFinite(thickness) || !reflected) {
        thicknessRestoreStack.push(null);
        return;
      }

      thicknessRestoreStack.push(thickness);
      thicknessUniform.value = -thickness;
      rigState.correctedShellDraws++;
      correctedShellDraws++;
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const material = args[4];
      const restoreThickness = thicknessRestoreStack.pop();
      if (restoreThickness != null && material?.uniforms?.uThickness) {
        material.uniforms.uThickness.value = restoreThickness;
      }
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
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
      hookedMeshes: 0, // Number of current-or-former hand meshes that received shell parity hooks.
      correctedShellDraws: 0, // Reflected shell draws corrected for this hand rig.
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
          outlineReflectionParity: true,
          outlineHookedMeshes: rigState.hookedMeshes,
          correctedOutlineShellDraws: rigState.correctedShellDraws,
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
        correctedShellDraws,
      };
    },
  });
})(window);
