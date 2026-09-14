// Keeps the player's post-rig hat x-ray overlay exactly coplanar with the real
// skinned portrait surface. Hat visibility is intentionally NOT angle-driven.
//
// game.js creates player_avatar_*_hat_xray_plane after PNGPlaneAvatar has already
// built the player rig. Historically the x-ray mesh was moved +/-0.0015 along
// local Z to beat z-fighting. Once the neck/body turns, that physical separation
// becomes a sideways screen-space separation and lets hat/headband pixels poke
// beyond the head silhouette. This adapter removes only that physical offset and
// uses render order instead. It never changes material opacity or visibility.
(function (global) {
  'use strict';

  const avatarApi = global.PNGPlaneAvatar;
  if (!avatarApi?.buildSinglePlaneAvatarModel) return;

  const FRONT_XRAY_RENDER_ORDER = 2.5; // Used to place the front hat x-ray above body=2 but below shoulder pets.

  let patchedAssemblies = 0;
  let alignedXrayMeshes = 0;

  function isHatXrayMesh(object) {
    const name = String(object?.name || '');
    return /player_avatar_(front|back)_hat_xray_plane$/i.test(name);
  }

  function isFrontHatXrayMesh(object) {
    return /player_avatar_front_hat_xray_plane$/i.test(String(object?.name || ''));
  }

  function sourceSkinnedPortrait(assembly, overlay) {
    return assembly?.children?.find(child =>
      child !== overlay && child?.isSkinnedMesh && !isHatXrayMesh(child)
    ) || null;
  }

  function alignSkinnedXrayToPortrait(assembly, mesh) {
    if (!mesh?.isSkinnedMesh || !isHatXrayMesh(mesh)) return false;
    const source = sourceSkinnedPortrait(assembly, mesh);
    if (!source) return false;

    // The overlay already clones the source mesh position before game.js adds a
    // +/-0.0015 Z nudge. Remove only that physical separation. Equal-depth
    // fragments are legal here (LessEqualDepth); renderOrder chooses which copy
    // is presented without changing the actual skinned surface in space.
    mesh.position.z = source.position.z;
    if (isFrontHatXrayMesh(mesh)) mesh.renderOrder = FRONT_XRAY_RENDER_ORDER;

    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiHatXrayCoplanar = true;
    mesh.userData.hobunjiHatXraySourceZ = source.position.z;
    mesh.userData.hobunjiHatXrayAngleVisibility = 'disabled';
    alignedXrayMeshes += 1;
    return true;
  }

  function patchAssembly(root) {
    const assembly = root?.children?.[0];
    if (!assembly?.isObject3D || assembly.userData?.hobunjiHatXrayAddWrapped) return false;

    const prepare = object => {
      if (!object) return;
      object.traverse?.(child => {
        if (isHatXrayMesh(child)) alignSkinnedXrayToPortrait(assembly, child);
      });
    };

    // Defensive scan in case a caller ever creates an x-ray child synchronously
    // before buildSinglePlaneAvatarModel returns.
    for (const child of assembly.children || []) prepare(child);

    const originalAdd = assembly.add;
    assembly.add = function addWithHatXrayParity(...objects) {
      const result = originalAdd.apply(this, objects);
      for (const object of objects) prepare(object);
      return result;
    };

    assembly.userData = assembly.userData || {};
    assembly.userData.hobunjiHatXrayAddWrapped = true;
    patchedAssemblies += 1;
    return true;
  }

  const currentBuild = avatarApi.buildSinglePlaneAvatarModel;
  avatarApi.buildSinglePlaneAvatarModel = function buildSinglePlaneAvatarModelWithHatXrayParity(...args) {
    const root = currentBuild.apply(this, args);
    patchAssembly(root);
    return root;
  };
  avatarApi.buildSinglePlaneAvatarModel.__hobunjiHatXrayParityWrapped = true;

  // Keep the legacy global name because the combat bootstrap uses it as its
  // loaded-module sentinel. The behavior it reports is alignment-only.
  global.HobunjiHatXrayHeadFacing = Object.freeze({
    getDebug() {
      return {
        patchedAssemblies,
        alignedXrayMeshes,
        frontRenderOrder: FRONT_XRAY_RENDER_ORDER,
        angleVisibility: 'disabled',
        geometryMode: 'coplanar-with-skinned-portrait',
      };
    },
  });
})(window);
