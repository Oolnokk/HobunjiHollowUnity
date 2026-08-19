// Gives two-bone procedural hands an outline that follows the SAME skinning
// deformation as the visible hand.
//
// The game's global inverted-shell pass uses one non-skinned override shader.
// That is correct for ordinary rigid meshes, but once a hand is converted to a
// SkinnedMesh its visible vertices move through the hand/forearm bones while the
// override shell remains in bind pose. Disable those global hand-only outline
// layers and install a small BackSide SkinnedMesh shell that shares the exact
// skeleton, geometry and local transform of each visible hand mesh.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const hands = global.ProceduralHandAttachments;
  if (!THREE || !hands?.attach || hands.attach.__hobunjiSkinnedHandOutlineWrapped) return;

  const tracked = new Set(); // Rigs whose async GLB/two-bone replacements may need a dedicated shell.
  let installedShells = 0; // Number of live-or-former hand mesh shells installed for diagnostics.
  let disabledGlobalShellMeshes = 0; // Skinned hand meshes removed from the rigid global shell/material-ID passes.
  let heldShellsRegistered = 0; // Dedicated shells explicitly adopted by the held-object ground-xray registry.

  function geometryThickness(mesh) {
    const geometry = mesh?.geometry;
    if (!geometry) return 0.01;
    geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return 0.01;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(0.000001, size.x, size.y, size.z);
    return span * 0.015;
  }

  function makeShellMaterial(thickness) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x050505,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
      fog: true,
    });
    // Older Three builds inspect this flag; newer builds infer skinning from
    // SkinnedMesh. Keeping it set is harmless and preserves compatibility.
    material.skinning = true;
    material.name = 'procedural_hand_skinned_shell';
    material.onBeforeCompile = shader => {
      shader.uniforms.hobunjiHandShellThickness = { value: thickness };
      shader.vertexShader = `uniform float hobunjiHandShellThickness;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * hobunjiHandShellThickness;'
      );
    };
    material.customProgramCacheKey = () => `hobunji-hand-skinned-shell-${thickness.toFixed(8)}`;
    return material;
  }

  function registerHeldShell(shell) {
    if (!shell?.isMesh) return false;
    shell.userData = shell.userData || {};
    shell.userData.hobunjiHeldObjectPlane = true;
    const renderer = global.HeldObjectRenderOrder;
    if (renderer?.markHeldPlane) {
      renderer.markHeldPlane(shell);
      heldShellsRegistered += 1;
      return true;
    }
    return false;
  }

  function installForMesh(mesh) {
    if (!mesh?.isSkinnedMesh || !mesh.geometry || !mesh.skeleton || mesh.userData?.__hobunjiSkinnedOutlineInstalled) return false;
    const parent = mesh.parent;
    if (!parent) return false;

    // Layer 1 = global rigid inverted shell; layer 3 = rigid material-ID seam
    // pass. Neither applies bone deformation, so leaving them enabled is what
    // creates the apparent rotation/bind-pose mismatch around a moving forearm.
    mesh.layers.disable(1);
    mesh.layers.disable(3);
    disabledGlobalShellMeshes += 1;

    const shell = new THREE.SkinnedMesh(mesh.geometry, makeShellMaterial(geometryThickness(mesh)));
    shell.name = `${mesh.name || 'hand'}_skinned_outline_shell`;
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale);
    shell.frustumCulled = mesh.frustumCulled;
    shell.renderOrder = (Number(mesh.renderOrder) || 0) - 1;
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.layers.mask = mesh.layers.mask;
    shell.layers.disable(1);
    shell.layers.disable(3);
    shell.userData.hobunjiProceduralHandSkinnedShell = true;
    shell.userData.hobunjiOutlineSource = 'shared-skeleton-shell';

    // Share the exact bones and bind frame. The shell has no independent pose;
    // every vertex therefore receives the same two-bone deformation as the hand.
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    shell.bindMode = mesh.bindMode;
    shell.bindMatrix.copy(mesh.bindMatrix);
    shell.bindMatrixInverse.copy(mesh.bindMatrixInverse);

    const index = parent.children.indexOf(mesh);
    parent.add(shell);
    if (index >= 0) {
      const appended = parent.children.indexOf(shell);
      if (appended >= 0) parent.children.splice(appended, 1);
      parent.children.splice(index, 0, shell);
    }

    // The visible hand is intentionally rendered by the held-object selective
    // overlay so grass/terrain cannot cover it. Register its dedicated shell in
    // that SAME overlay; otherwise the hand could x-ray the ground while its
    // outline remained behind it, which would look like another transform error.
    registerHeldShell(shell);

    mesh.userData.__hobunjiSkinnedOutlineInstalled = true;
    mesh.userData.hobunjiOutlineSource = 'dedicated-skinned-shell';
    mesh.userData.hobunjiSkinnedOutlineShell = shell;
    installedShells += 1;
    return true;
  }

  function scanRig(rig) {
    let installed = 0;
    for (const side of ['left', 'right']) {
      const visual = rig?.group?.getObjectByName?.(`${side}_hand_visual`);
      visual?.traverse?.(node => {
        if (node?.userData?.hobunjiProceduralHandSkinnedShell) return;
        if (installForMesh(node)) installed += 1;
      });
    }
    return installed;
  }

  function settleScan(rig, attempt = 0) {
    if (!tracked.has(rig)) return;
    scanRig(rig);
    const debug = rig.getDebug?.() || {};
    const left = rig.group?.getObjectByName?.('left_hand_visual');
    const right = rig.group?.getObjectByName?.('right_hand_visual');
    let skinned = 0;
    left?.traverse?.(node => { if (node?.isSkinnedMesh && !node.userData?.hobunjiProceduralHandSkinnedShell) skinned += 1; });
    right?.traverse?.(node => { if (node?.isSkinnedMesh && !node.userData?.hobunjiProceduralHandSkinnedShell) skinned += 1; });
    if (skinned > 0 || debug.loadError || attempt >= 120) return;
    global.setTimeout?.(() => settleScan(rig, attempt + 1), 50);
  }

  const originalAttach = hands.attach;
  const wrappedAttach = function skinnedOutlineHandAttach(...args) {
    const rig = originalAttach.apply(this, args);
    if (!rig) return rig;
    tracked.add(rig);
    settleScan(rig);

    const originalRefresh = typeof rig.refreshModelProfile === 'function' ? rig.refreshModelProfile.bind(rig) : null;
    if (originalRefresh) {
      rig.refreshModelProfile = function skinnedOutlineRefresh(...refreshArgs) {
        const result = originalRefresh(...refreshArgs);
        Promise.resolve(result).then(
          value => { scanRig(rig); return value; },
          error => { scanRig(rig); throw error; }
        );
        return result;
      };
    }

    const originalDispose = typeof rig.dispose === 'function' ? rig.dispose.bind(rig) : null;
    if (originalDispose) {
      rig.dispose = function skinnedOutlineDispose(...disposeArgs) {
        tracked.delete(rig);
        return originalDispose(...disposeArgs);
      };
    }
    return rig;
  };
  wrappedAttach.__hobunjiSkinnedHandOutlineWrapped = true;
  wrappedAttach.__hobunjiSkinnedHandOutlineOriginal = originalAttach;
  hands.attach = wrappedAttach;

  global.ProceduralHandSkinnedOutline = Object.freeze({
    refreshAll() { for (const rig of tracked) scanRig(rig); },
    getDebug() {
      return {
        activeRigs: tracked.size,
        installedShells,
        disabledGlobalShellMeshes,
        heldShellsRegistered,
        mode: 'shared-skeleton-backside-shell',
      };
    },
  });
})(window);