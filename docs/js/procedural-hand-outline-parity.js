// Keeps every procedural-hand outline pass on the exact transform used by the visible hand.
//
// Hand placement has a deliberate late pre-render sync: an invisible sentinel updates
// the hand sockets after toolHolder's render-time stance hook has produced its final
// matrix. Outline rendering then uses separate shell and material-ID passes, often with
// scene.autoUpdate=false. Capture each hand mesh's matrixWorld at its visible draw and
// temporarily reuse that exact matrix for every outline override draw. The same meshes
// are also registered with HeldObjectRenderOrder so hands x-ray grass/ground exactly
// like held tool sprites while ordinary scene occluders still block them.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const hands = global.ProceduralHandAttachments;
  if (!THREE || !hands?.attach || hands.attach.__hobunjiHandOutlineParityWrapped) return;

  const activeRigs = new Set(); // Rigs whose newly loaded/replaced hand meshes may need hooks.
  const MAX_SNAPSHOT_AGE_MS = 160;
  const OUTLINE_THICKNESS_MULTIPLIER = 2; // Hands/feet only; shared shell uniform is restored after each limb mesh draw. // Allows the adjacent base->held-overlay->outline sequence without accepting old frames.
  let baseMatrixCaptures = 0; // Diagnostic count of visible hand matrices captured by this adapter.
  let lockedShellDraws = 0; // Diagnostic count of shell draws forced to the captured visible matrix.
  let lockedMaterialIdDraws = 0; // Diagnostic count of material-ID draws forced to the captured visible matrix.
  let missedOutlineSnapshots = 0; // Outline draws where no recent visible matrix was available.
  let heldXrayTaggedMeshes = 0; // Current-or-former procedural hand meshes registered with the selective ground x-ray system.

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

  function isVisibleHandDraw(scene, material) {
    // Any ordinary draw with the mesh's own material is a valid source matrix.
    // This includes the held-object selective overlay, which is the actual visible
    // hand draw once ground x-ray registration is active.
    return !scene?.overrideMaterial && !isShellMaterial(material) && !isMaterialIdMaterial(material);
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

  function installMeshHook(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    markHeldXray(mesh, rigState, side);
    if (mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Last matrix used by an ordinary visible hand draw.
      visibleCapturedAt: -Infinity, // Timestamp paired with visibleMatrixWorld for adjacency validation.
      restoreStack: [], // Supports grouped/multiple draw callbacks without leaking a temporary outline matrix.
      thicknessRestoreStack: [], // Per-draw shell-uniform restore entries; keeps non-limb outlines at the global thickness.
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
      // material-ID rendering to the exact transform that produced the visible hand.
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

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
      const thicknessRestore = state.thicknessRestoreStack.pop();
      if (thicknessRestore) thicknessRestore.uniform.value = thicknessRestore.value;
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-hand-draw';
    rigState.hookedMeshes++;
    return true;
  }

  function scanVisual(root, rigState, side) {
    root?.traverse?.(child => installMeshHook(child, rigState, side));
  }

  function scanRig(rig, rigState) {
    const left = rig?.group?.getObjectByName?.('left_hand_visual') || null;
    const right = rig?.group?.getObjectByName?.('right_hand_visual') || null;
    if (left) scanVisual(left, rigState, 'left');
    if (right) scanVisual(right, rigState, 'right');
    if (!left && !right) rig?.group?.traverse?.(child => installMeshHook(child, rigState, null));
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
      heldXrayMeshes: 0, // Hand meshes registered with selective ground/grass x-ray.
      baseMatrixCaptures: 0, // Visible hand draws captured for this hand rig.
      lockedShellDraws: 0, // Shell draws that reused the exact visible hand matrix.
      lockedMaterialIdDraws: 0, // Material-ID draws that reused the exact visible hand matrix.
      missedOutlineSnapshots: 0, // Outline draws without a recent visible matrix to reuse.
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
          heldXrayMeshes: rigState.heldXrayMeshes,
          outlineBaseMatrixCaptures: rigState.baseMatrixCaptures,
          outlineLockedShellDraws: rigState.lockedShellDraws,
          outlineLockedMaterialIdDraws: rigState.lockedMaterialIdDraws,
          outlineMissedSnapshots: rigState.missedOutlineSnapshots,
          outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
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
        lockedMaterialIdDraws,
        missedOutlineSnapshots,
        heldXrayTaggedMeshes,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
        outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
        heldXray: global.HeldObjectRenderOrder?.snapshot?.() || null,
      };
    },
  });
})(window);
