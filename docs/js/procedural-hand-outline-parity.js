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
      visibleMatrixWorld: new THREE.Matrix4(), // Reconstructed from the exact modelViewMatrix used by the visible GPU draw.
      visibleCapturedAt: -Infinity,
      visibleCaptureSerial: 0, // Increments only for genuine color-writing hand draws.
      lastShellCaptureSerial: 0, // Prevents a second shell render from reusing an older visible-frame transform.
      drawStack: [], // One entry per renderer callback; supports visible/shell/material-ID replay without leaking state.
    };

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();
      const visibleDraw = isVisibleHandDraw(scene, material);
      const passKind = visibleDraw ? 'visible' : outlinePassKind(scene, material);
      const draw = { kind: passKind || 'other', restoreMatrix: null, thicknessRestore: null, captureSerial: 0 };

      // Do NOT call updateWorldMatrix/updateMatrixWorld here. WeaponToolStances and
      // the direct-hand sentinel deliberately bake a final render-only transform and
      // then restore local values; recomputing the hierarchy during the outline pass
      // discards that baked stance and is exactly what separated shell from hand.
      if (passKind === 'shell' || passKind === 'material-id') {
        const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;
        const previousThickness = Number(thicknessUniform?.value);
        if (thicknessUniform && Number.isFinite(previousThickness)) {
          draw.thicknessRestore = { uniform: thicknessUniform, value: previousThickness };
          thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER;
          material.uniformsNeedUpdate = true;
        }

        const ageMs = now - state.visibleCapturedAt;
        const captureIsFresh = passKind !== 'shell'
          || state.visibleCaptureSerial !== state.lastShellCaptureSerial;
        if (ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS && captureIsFresh) {
          draw.restoreMatrix = this.matrixWorld.clone();
          draw.captureSerial = state.visibleCaptureSerial;
          this.matrixWorld.copy(state.visibleMatrixWorld);
          if (passKind === 'shell') {
            rigState.lockedShellDraws++;
            lockedShellDraws++;
          } else {
            rigState.lockedMaterialIdDraws++;
            lockedMaterialIdDraws++;
          }
        } else {
          rigState.missedOutlineSnapshots++;
          missedOutlineSnapshots++;
        }
      }

      state.drawStack.push(draw);
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      const draw = state.drawStack.pop() || { kind: 'other', restoreMatrix: null, thicknessRestore: null };

      // Capture AFTER the visible draw. At this point Three.js has already derived
      // modelViewMatrix from the exact matrixWorld that reached the GPU. Rebuild the
      // corresponding world matrix from camera.matrixWorld * modelViewMatrix so late
      // render-time stance/mirror transforms cannot be lost to local-state restoration.
      if (draw.kind === 'visible') {
        const camera = args[2];
        if (camera?.matrixWorld && this.modelViewMatrix) {
          state.visibleMatrixWorld.multiplyMatrices(camera.matrixWorld, this.modelViewMatrix);
        } else {
          state.visibleMatrixWorld.copy(this.matrixWorld);
        }
        state.visibleCapturedAt = performance.now();
        state.visibleCaptureSerial++;
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
      }

      // Capture/restore our parity state before delegating to an older after-render
      // callback: an older callback is allowed to restore its own temporary state,
      // but the exact visible GPU matrix above must survive as our snapshot.
      previousAfter?.apply(this, args);

      if (draw.kind === 'shell' && draw.captureSerial) {
        state.lastShellCaptureSerial = draw.captureSerial;
      }
      if (draw.restoreMatrix) this.matrixWorld.copy(draw.restoreMatrix);
      if (draw.thicknessRestore) {
        draw.thicknessRestore.uniform.value = draw.thicknessRestore.value;
        const material = args[4];
        if (material?.isShaderMaterial) material.uniformsNeedUpdate = true;
      }
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-gpu-modelview';
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
          outlineMatrixSource: 'visible-gpu-modelview',
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
