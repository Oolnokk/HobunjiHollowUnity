// Keeps the player's post-rig hat x-ray overlay coplanar with the real skinned
// portrait surface without changing visibility according to camera/head angle.
//
// The old implementation combined two unrelated jobs: fixing the +/-0.0015 Z
// separation that caused silhouette leaks, and hiding the front x-ray from some
// camera angles. Keep only the geometry fix. Normal portrait front/back rendering
// is now the sole visibility owner.
(function (global) {
  'use strict';

  const avatarApi = global.PNGPlaneAvatar;
  if (!avatarApi?.buildSinglePlaneAvatarModel) return;

  const FRONT_XRAY_RENDER_ORDER = 2.5; // body=2, shoulder pet=3
  let patchedAssemblies = 0;
  let alignedXrayMeshes = 0;

  function isHatXrayMesh(object) {
    return /player_avatar_(front|back)_hat_xray_plane$/i.test(String(object?.name || ''));
  }

  function isFrontHatXrayMesh(object) {
    return /player_avatar_front_hat_xray_plane$/i.test(String(object?.name || ''));
  }

  function sourceSkinnedPortrait(assembly, overlay) {
    return assembly?.children?.find(child => child !== overlay && child?.isSkinnedMesh && !isHatXrayMesh(child)) || null;
  }

  function alignSkinnedXrayToPortrait(assembly, mesh) {
    if (!mesh?.isSkinnedMesh || !isHatXrayMesh(mesh)) return false;
    const source = sourceSkinnedPortrait(assembly, mesh);
    if (!source) return false;
    mesh.position.z = source.position.z;
    if (isFrontHatXrayMesh(mesh)) mesh.renderOrder = FRONT_XRAY_RENDER_ORDER;
    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiHatXrayCoplanar = true;
    mesh.userData.hobunjiHatXraySourceZ = source.position.z;
    mesh.userData.hobunjiHatXrayFacingGate = false;
    alignedXrayMeshes += 1;
    return true;
  }

  function patchAssembly(root) {
    const assembly = root?.children?.[0];
    if (!assembly?.isObject3D || assembly.userData?.hobunjiHatXrayAddWrapped) return false;
    const prepare = object => object?.traverse?.(child => { if (isHatXrayMesh(child)) alignSkinnedXrayToPortrait(assembly, child); });
    for (const child of assembly.children || []) prepare(child);
    const originalAdd = assembly.add;
    assembly.add = function addWithHatXrayAlignment(...objects) {
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
  avatarApi.buildSinglePlaneAvatarModel = function buildSinglePlaneAvatarModelWithHatXrayAlignment(...args) {
    const root = currentBuild.apply(this, args);
    patchAssembly(root);
    return root;
  };
  avatarApi.buildSinglePlaneAvatarModel.__hobunjiHatXrayAlignmentWrapped = true;

  global.HobunjiHatXrayHeadFacing = Object.freeze({
    getDebug() {
      return {
        patchedAssemblies,
        alignedXrayMeshes,
        facingGate: false,
        cameraFacingVisibility: false,
        frontRenderOrder: FRONT_XRAY_RENDER_ORDER,
        geometryMode: 'coplanar-with-skinned-portrait',
        visibilityOwner: 'normal portrait front/back renderer',
      };
    },
  });
})(window);
