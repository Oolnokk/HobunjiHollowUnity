// Keeps every procedural-hand outline pass on the exact transform used by the visible hand.
//
// Hand placement has a deliberate late pre-render sync: an invisible sentinel updates
// the hand sockets after toolHolder's render-time stance hook has produced its final
// matrix. Outline rendering then uses separate shell and material-ID passes, often with
// scene.autoUpdate=false. Snapshot each hand mesh's already-final matrixWorld directly
// in the visible draw's onBeforeRender (the same ordering used by feet), then temporarily
// reuse that exact matrix for every outline override draw. The same meshes
// are also registered with HeldObjectRenderOrder so hands x-ray grass/ground exactly
// like held tool sprites while ordinary scene occluders still block them.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const hands = global.ProceduralHandAttachments;
  if (!THREE || !hands?.attach || hands.attach.__hobunjiHandOutlineParityWrapped) return;

  const activeRigs = new Set(); // Rigs whose current hand visuals are checked by the live-hook diagnostics below.
  const MAX_SNAPSHOT_AGE_MS = 160;
  const OUTLINE_THICKNESS_MULTIPLIER = 2; // Hands/feet only; shared shell uniform is restored after each limb mesh draw.
  let baseMatrixCaptures = 0; // Diagnostic count of visible hand matrices captured by this adapter.
  let lockedShellDraws = 0; // Diagnostic count of shell draws forced to the captured visible matrix.
  let lockedMaterialIdDraws = 0; // Diagnostic count of material-ID draws forced to the captured visible matrix.
  let missedOutlineSnapshots = 0; // Outline draws where no recent visible matrix was available.
  let heldXrayTaggedMeshes = 0; // Current-or-former procedural hand meshes registered with the selective ground x-ray system.
  let reflectedShellDraws = 0; // Shell draws whose extrusion sign was reversed for a mirrored hand transform.

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

  function installMeshHook(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    if (mesh.userData?.noOutline !== true) mesh.layers.enable(1); // Visual replacement/x-ray routing must never drop either hand from the shell layer.
    markHeldXray(mesh, rigState, side);
    if (mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Exact matrixWorld about to be used by the latest genuine color-writing hand draw.
      visibleCapturedAt: -Infinity,
      restoreStack: [], // Per-render temporary matrix restores for shell/material-ID passes.
      thicknessRestoreStack: [], // Per-render shell-thickness restores so the shared uniform cannot leak.
    };

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      // Let any pre-existing hand/tool stance hook finish first. The snapshot below
      // must observe the same final matrixWorld that Three.js is about to use for
      // this color-writing draw — not a transform reconstructed after the fact.
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

      const ageMs = now - state.visibleCapturedAt;
      if (!(ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS)) {
        state.restoreStack.push(null);
        state.thicknessRestoreStack.push(null);
        rigState.missedOutlineSnapshots++;
        missedOutlineSnapshots++;
        return;
      }

      // Mirroring one hand with a negative X scale reverses transformed winding.
      // The inverted-shell extrusion therefore needs the opposite thickness sign
      // on that draw; this was the original hand-outline fix and must coexist with
      // the later matrix lock rather than being replaced by it.
      const reflected = passKind === 'shell' && state.visibleMatrixWorld.determinant() < 0;
      const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;
      const previousThickness = Number(thicknessUniform?.value);
      if (thicknessUniform && Number.isFinite(previousThickness)) {
        state.thicknessRestoreStack.push({ uniform: thicknessUniform, value: previousThickness });
        thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER * (reflected ? -1 : 1);
        material.uniformsNeedUpdate = true;
        if (reflected) {
          rigState.reflectedShellDraws++;
          reflectedShellDraws++;
        }
      } else {
        state.thicknessRestoreStack.push(null);
      }

      // Three r128 calls Object3D.onBeforeRender BEFORE deriving modelViewMatrix
      // and normalMatrix. Copying the visible draw's direct matrixWorld here makes
      // the shell use precisely that pose. Do not call updateMatrixWorld and do not
      // reconstruct from modelViewMatrix after a draw; both alter the intended
      // base->secondary render ordering used by outline-render-performance.js.
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
      // Delegate first, matching the feet parity adapter: any older callback gets
      // to clean up its own temporary render state before we restore ours.
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
      const thicknessRestore = state.thicknessRestoreStack.pop();
      if (thicknessRestore) {
        thicknessRestore.uniform.value = thicknessRestore.value;
        const material = args[4];
        if (material?.isShaderMaterial) material.uniformsNeedUpdate = true;
      }
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-hand-pre-render';
    mesh.userData.hobunjiOutlineReflectionParity = true;
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

  function currentVisualStatus(rig) {
    const result = { left: null, right: null, allCurrentOutlineMeshesHooked: true, glbVisualsReady: true }; // Report consumed by rig.getDebug() and the mobile Pixel Probe.
    for (const side of ['left', 'right']) {
      const socket = rig?.group?.getObjectByName?.(`${side}_hand_socket`) || null;
      const visuals = (socket?.children || []).filter(child => child?.name !== `${side}_hand_grip_axes`); // Current replacement visuals only; disposed fallbacks are no longer children.
      let outlineMeshes = 0; // Number of current meshes that should participate in the shell outline pass.
      let hookedMeshes = 0; // Number of those current meshes carrying this parity adapter's live hook.
      let glbVisual = false; // buildGlbHand stamps handModelKey on the visual root; fallback hands intentionally do not.
      for (const visual of visuals) {
        if (visual?.userData?.handModelKey) glbVisual = true;
        visual?.traverse?.(child => {
          if (!child?.isMesh || child.userData?.noOutline === true) return;
          outlineMeshes++;
          if (child.userData?.__hobunjiHandOutlineParity === true) hookedMeshes++;
        });
      }
      const allHooked = outlineMeshes > 0 && hookedMeshes === outlineMeshes; // False is intentionally loud when a visual exists but was never adopted.
      result[side] = { visualCount: visuals.length, glbVisual, outlineMeshes, hookedMeshes, allHooked };
      result.allCurrentOutlineMeshesHooked = result.allCurrentOutlineMeshesHooked && allHooked;
      result.glbVisualsReady = result.glbVisualsReady && glbVisual;
    }
    return result;
  }

  function waitForInitialGlbs(rig, rigState, attempt = 0) {
    if (!activeRigs.has(rig)) return;
    scanRig(rig, rigState);
    const debug = rig.getDebug?.() || {}; // `glb` tells us whether this species is expected to replace its fallback visuals asynchronously.
    const live = currentVisualStatus(rig); // Unlike the old name check, this inspects the actual current visual identity.
    const expectsGlb = !!debug.glb;
    if (!expectsGlb || live.glbVisualsReady) return;
    if (attempt >= 150) {
      console.warn('[HobunjiHandOutlineParity] timed out waiting for current GLB hand visuals; live status:', live);
      return;
    }
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
      reflectedShellDraws: 0, // Mirrored shell draws whose extrusion sign was corrected.
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
        const live = currentVisualStatus(rig); // Computed on demand so diagnostics can never report disposed fallback meshes as current.
        return {
          ...originalDebug(),
          outlineMatrixParity: true,
          outlineMatrixSource: 'visible-hand-pre-render',
          outlineHookedMeshes: rigState.hookedMeshes,
          heldXrayMeshes: rigState.heldXrayMeshes,
          outlineBaseMatrixCaptures: rigState.baseMatrixCaptures,
          outlineLockedShellDraws: rigState.lockedShellDraws,
          outlineLockedMaterialIdDraws: rigState.lockedMaterialIdDraws,
          outlineMissedSnapshots: rigState.missedOutlineSnapshots,
          outlineReflectedShellDraws: rigState.reflectedShellDraws,
          outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
          currentOutlineVisuals: live,
          currentOutlineMeshesHooked: live.allCurrentOutlineMeshesHooked,
          currentGlbVisualsReady: live.glbVisualsReady,
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
      let currentRigsHooked = 0; // Aggregate live status lets global diagnostics distinguish current GLBs from historical hook counters.
      for (const rig of activeRigs) if (currentVisualStatus(rig).allCurrentOutlineMeshesHooked) currentRigsHooked++;
      return {
        activeRigs: activeRigs.size,
        currentRigsHooked,
        baseMatrixCaptures,
        lockedShellDraws,
        lockedMaterialIdDraws,
        missedOutlineSnapshots,
        reflectedShellDraws,
        heldXrayTaggedMeshes,
        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,
        outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,
        heldXray: global.HeldObjectRenderOrder?.snapshot?.() || null,
      };
    },
  });
})(window);
