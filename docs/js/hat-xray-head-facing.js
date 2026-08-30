// Keeps the player's post-rig hat x-ray overlay coincident with, and facing like,
// the real skinned portrait surface.
//
// game.js creates player_avatar_*_hat_xray_plane after PNGPlaneAvatar has already
// built the player rig. That means the normal front-headwear hooks never see this
// second copy. Historically the x-ray mesh was also moved +/-0.0015 along local Z
// to beat z-fighting. Once the neck/body turns, that physical separation becomes
// a sideways screen-space separation and lets hat/headband pixels poke beyond the
// head silhouette.
//
// For skinned overlays we instead keep the x-ray geometry exactly coplanar with
// the source portrait and order it fractionally above the front body plane. The
// front x-ray also receives the same binary 90-degree yaw / 35-degree tilt gate
// as ordinary front headwear. No fade is introduced.
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const avatarApi = global.PNGPlaneAvatar;
  if (!THREE || !avatarApi?.buildSinglePlaneAvatarModel) return;

  const TILT_CUTOFF_DEG = 35;
  const TILT_CUTOFF_DOT = Math.cos(TILT_CUTOFF_DEG * Math.PI / 180);
  const FRONT_XRAY_RENDER_ORDER = 2.5; // body=2, shoulder pet=3

  let patchedAssemblies = 0;
  let alignedXrayMeshes = 0;
  let gatedFrontXrayMeshes = 0;
  let lastYawDot = null;
  let lastUprightDot = null;
  let lastVisible = null;

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
    alignedXrayMeshes += 1;
    return true;
  }

  function attachFrontFacingGate(mesh, neckJoint) {
    if (!mesh?.isSkinnedMesh || !isFrontHatXrayMesh(mesh) || !neckJoint?.isBone) return false;
    if (mesh.userData?.hobunjiHatXrayFacingGate) return false;

    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return false;

    const baseOpacity = Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : 1;
    const previousOnBeforeRender = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const localFront = new THREE.Vector3(0, 0, 1);
    const localUp = new THREE.Vector3(0, 1, 0);
    const worldFront = new THREE.Vector3();
    const worldUp = new THREE.Vector3();
    const headWorld = new THREE.Vector3();
    const cameraWorld = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const horizontalFront = new THREE.Vector3();
    const horizontalToCamera = new THREE.Vector3();
    const worldVertical = new THREE.Vector3(0, 1, 0);

    material.userData = material.userData || {};
    material.userData.hobunjiHatXrayFacingGate = {
      enabled: true,
      yawCutoffDot: 0,
      yawCutoffDegrees: 90,
      tiltCutoffDot: TILT_CUTOFF_DOT,
      tiltCutoffDegrees: TILT_CUTOFF_DEG,
      transition: 'hard-step',
      facingSource: 'neck-bone',
    };

    mesh.onBeforeRender = function hatXrayFacingBeforeRender(renderer, scene, camera, geometry, currentMaterial, group) {
      previousOnBeforeRender?.call(this, renderer, scene, camera, geometry, currentMaterial, group);
      if (!camera) return;

      neckJoint.updateWorldMatrix?.(true, false);
      worldFront.copy(localFront).transformDirection(neckJoint.matrixWorld).normalize();
      worldUp.copy(localUp).transformDirection(neckJoint.matrixWorld).normalize();
      neckJoint.getWorldPosition(headWorld);
      camera.getWorldPosition(cameraWorld);
      toCamera.copy(cameraWorld).sub(headWorld).normalize();

      horizontalFront.set(worldFront.x, 0, worldFront.z);
      horizontalToCamera.set(toCamera.x, 0, toCamera.z);
      const frontLenSq = horizontalFront.lengthSq();
      const cameraLenSq = horizontalToCamera.lengthSq();
      let yawDot = worldFront.dot(toCamera);
      if (frontLenSq > 1e-8 && cameraLenSq > 1e-8) {
        horizontalFront.multiplyScalar(1 / Math.sqrt(frontLenSq));
        horizontalToCamera.multiplyScalar(1 / Math.sqrt(cameraLenSq));
        yawDot = horizontalFront.dot(horizontalToCamera);
      }

      const uprightDot = worldUp.dot(worldVertical);
      const visible = yawDot > 0 && uprightDot >= TILT_CUTOFF_DOT;

      // MeshBasicMaterial's opacity is multiplied into fragment alpha before
      // alphaTest. The x-ray material already has alphaTest=0.01, so opacity=0
      // discards every fragment and writes neither color nor depth this draw.
      currentMaterial.opacity = visible ? baseOpacity : 0;
      currentMaterial.userData = currentMaterial.userData || {};
      currentMaterial.userData.hobunjiHatXrayLastYawDot = yawDot;
      currentMaterial.userData.hobunjiHatXrayLastUprightDot = uprightDot;
      currentMaterial.userData.hobunjiHatXrayLastVisible = visible;

      lastYawDot = yawDot;
      lastUprightDot = uprightDot;
      lastVisible = visible;
    };

    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiHatXrayFacingGate = true;
    gatedFrontXrayMeshes += 1;
    return true;
  }

  function patchAssembly(root) {
    const assembly = root?.children?.[0];
    const neckJoint = root?.userData?.neckRig?.neckJoint;
    if (!assembly?.isObject3D || !neckJoint?.isBone || assembly.userData?.hobunjiHatXrayAddWrapped) return false;

    const prepare = object => {
      if (!object) return;
      object.traverse?.(child => {
        if (!isHatXrayMesh(child)) return;
        alignSkinnedXrayToPortrait(assembly, child);
        attachFrontFacingGate(child, neckJoint);
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

  global.HobunjiHatXrayHeadFacing = Object.freeze({
    getDebug() {
      return {
        patchedAssemblies,
        alignedXrayMeshes,
        gatedFrontXrayMeshes,
        lastYawDot,
        lastUprightDot,
        lastVisible,
        frontRenderOrder: FRONT_XRAY_RENDER_ORDER,
        yawCutoffDegrees: 90,
        tiltCutoffDegrees: TILT_CUTOFF_DEG,
        transition: 'hard-step',
        geometryMode: 'coplanar-with-skinned-portrait',
      };
    },
  });
})(window);
