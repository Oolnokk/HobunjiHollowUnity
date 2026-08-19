// Experimental side-specific bicep bones for the skinned PNG avatar plane.
// Arm weights come from actual armL/armR portrait layers. The upper third has a
// broad gentle shoulder spill; the lower two thirds use a very hard silhouette
// falloff. Bones stay rooted at the shoulder and only rotate toward the elbow.
(function (global) {
  'use strict';

  const avatarApi = global.PNGPlaneAvatar;
  const settings = global.HobunjiHandExperimentalRigSettings;
  if (!avatarApi?.buildSinglePlaneAvatarModel || avatarApi.buildSinglePlaneAvatarModel.__hobunjiBicepRigWrapped) return;

  const originalBuild = avatarApi.buildSinglePlaneAvatarModel;
  const active = new Set();
  const MAX_BICEP_WEIGHT = 0.94;
  let showGuides = false;

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  function smoothstep(a, b, value) {
    if (b <= a) return value >= b ? 1 : 0;
    const t = clamp01((value - a) / (b - a));
    return t * t * (3 - 2 * t);
  }
  function alphaData(canvas) {
    try { return canvas?.getContext?.('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height).data || null; }
    catch (_) { return null; }
  }
  function distanceField(canvas, threshold = 8) {
    const data = alphaData(canvas);
    if (!data || !canvas?.width || !canvas?.height) return null;
    const width = canvas.width, height = canvas.height, inf = width + height + 100;
    const distance = new Float32Array(width * height);
    for (let i = 0; i < distance.length; i++) distance[i] = data[i * 4 + 3] > threshold ? 0 : inf;
    const diag = Math.SQRT2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = distance[i];
      if (x > 0) d = Math.min(d, distance[i - 1] + 1);
      if (y > 0) d = Math.min(d, distance[i - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, distance[i - width - 1] + diag);
      if (x + 1 < width && y > 0) d = Math.min(d, distance[i - width + 1] + diag);
      distance[i] = d;
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = distance[i];
      if (x + 1 < width) d = Math.min(d, distance[i + 1] + 1);
      if (y + 1 < height) d = Math.min(d, distance[i + width] + 1);
      if (x + 1 < width && y + 1 < height) d = Math.min(d, distance[i + width + 1] + diag);
      if (x > 0 && y + 1 < height) d = Math.min(d, distance[i + width - 1] + diag);
      distance[i] = d;
    }
    return { width, height, data, distance };
  }
  function distalCentroid(field, bounds) {
    if (!field || !bounds) return null;
    const startY = Math.round(bounds.top + (bounds.bottom - bounds.top) * 0.58);
    let sx = 0, sy = 0, sw = 0;
    for (let y = startY; y <= bounds.bottom; y++) for (let x = bounds.left; x <= bounds.right; x++) {
      const alpha = field.data[(y * field.width + x) * 4 + 3];
      if (alpha <= 8) continue;
      sx += x * alpha; sy += y * alpha; sw += alpha;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : null;
  }
  function influenceAt(field, bounds, u, v) {
    if (!field || !bounds) return 0;
    const x = Math.max(0, Math.min(field.width - 1, Math.round(clamp01(u) * (field.width - 1))));
    const y = Math.max(0, Math.min(field.height - 1, Math.round((1 - clamp01(v)) * (field.height - 1))));
    const i = y * field.width + x;
    const alpha = field.data[i * 4 + 3] / 255;
    const armFrac = clamp01((y - bounds.top) / Math.max(1, bounds.bottom - bounds.top));
    const upperThird = 1 - smoothstep(0.26, 0.40, armFrac);
    const radius = Math.max(1, field.height * (0.012 + 0.063 * upperThird));
    const exponent = 6 - 4.5 * upperThird;
    const spill = Math.pow(Math.max(0, 1 - field.distance[i] / radius), exponent);
    return MAX_BICEP_WEIGHT * Math.max(alpha, spill);
  }

  function installBicepRig(THREE, avatarRoot, sourceCanvas) {
    const neckRig = avatarRoot?.userData?.neckRig;
    const skinnedPlane = neckRig?.skinnedPlane;
    const torsoBone = neckRig?.torsoBone;
    const neckJoint = neckRig?.neckJoint;
    const coverage = avatarRoot?.userData?.armCoverageBySide || sourceCanvas?.hobunjiArmCoverageBySide;
    const geometry = skinnedPlane?.geometry;
    const uv = geometry?.getAttribute?.('uv');
    if (!skinnedPlane?.isSkinnedMesh || !torsoBone || !neckJoint || !coverage?.left || !coverage?.right || !uv) {
      avatarRoot.userData.bicepRig = { available: false, reason: 'neck-rig-or-arm-mask-missing' };
      return null;
    }
    const fields = { left: distanceField(coverage.left), right: distanceField(coverage.right) };
    if (!fields.left || !fields.right) {
      avatarRoot.userData.bicepRig = { available: false, reason: 'arm-mask-unreadable' };
      return null;
    }

    const leftBone = new THREE.Bone(); leftBone.name = `${avatarRoot.name || 'avatar'}_left_bicep_bone`;
    const rightBone = new THREE.Bone(); rightBone.name = `${avatarRoot.name || 'avatar'}_right_bicep_bone`;
    torsoBone.add(leftBone); torsoBone.add(rightBone);
    const guides = {};
    for (const [side, bone] of [['left', leftBone], ['right', rightBone]]) {
      const guide = new THREE.AxesHelper((Number(avatarRoot.userData?.portraitModelHeight) || 1) * 0.12);
      guide.name = `${side}_bicep_bone_guide`;
      guide.visible = showGuides;
      guide.traverse?.(node => { if (node.material) { node.material.depthTest = false; node.material.depthWrite = false; } });
      bone.add(guide);
      guides[side] = guide;
    }

    const leftInfluence = new Float32Array(uv.count);
    const rightInfluence = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) {
      let lw = influenceAt(fields.left, coverage.bounds?.left, uv.getX(i), uv.getY(i));
      let rw = influenceAt(fields.right, coverage.bounds?.right, uv.getX(i), uv.getY(i));
      const total = lw + rw;
      if (total > MAX_BICEP_WEIGHT) { const s = MAX_BICEP_WEIGHT / total; lw *= s; rw *= s; }
      leftInfluence[i] = lw;
      rightInfluence[i] = rw;
    }

    const skeleton = new THREE.Skeleton([torsoBone, neckJoint, leftBone, rightBone]);
    skinnedPlane.bind(skeleton, skinnedPlane.bindMatrix);

    function reapplyWeights() {
      const current = geometry.getAttribute('skinWeight');
      if (!current || current.count !== uv.count) return false;
      const indices = new Uint16Array(uv.count * 4);
      const weights = new Float32Array(uv.count * 4);
      for (let i = 0; i < uv.count; i++) {
        const offset = i * 4;
        const torso = Number(current.getX(i)) || 0;
        const head = Number(current.getY(i)) || 0;
        const torsoHeadTotal = Math.max(1e-6, torso + head);
        const lw = leftInfluence[i], rw = rightInfluence[i];
        const remaining = Math.max(0, 1 - lw - rw);
        indices[offset] = 0; indices[offset + 1] = 1; indices[offset + 2] = 2; indices[offset + 3] = 3;
        weights[offset] = remaining * torso / torsoHeadTotal;
        weights[offset + 1] = remaining * head / torsoHeadTotal;
        weights[offset + 2] = lw;
        weights[offset + 3] = rw;
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      geometry.getAttribute('skinIndex').needsUpdate = true;
      geometry.getAttribute('skinWeight').needsUpdate = true;
      skinnedPlane.normalizeSkinWeights?.();
      return true;
    }
    reapplyWeights();

    const modelWidth = Number(avatarRoot.userData?.portraitModelWidth) || 1;
    const modelHeight = Number(avatarRoot.userData?.portraitModelHeight) || 1;
    const distal = {};
    for (const side of ['left', 'right']) {
      const px = distalCentroid(fields[side], coverage.bounds?.[side]);
      distal[side] = px ? new THREE.Vector3(
        -modelWidth / 2 + px.x / fields[side].width * modelWidth,
        modelHeight / 2 - px.y / fields[side].height * modelHeight,
        0,
      ) : new THREE.Vector3(side === 'right' ? -modelWidth * 0.28 : modelWidth * 0.28, 0, 0);
    }

    const sideState = {
      left: { bone: leftBone, shoulderWorld: null, elbowWorld: null, bindAxis: new THREE.Vector3(0, -1, 0), residualDeg: null },
      right: { bone: rightBone, shoulderWorld: null, elbowWorld: null, bindAxis: new THREE.Vector3(0, -1, 0), residualDeg: null },
    };
    const tempLocal = new THREE.Vector3(), targetLocal = new THREE.Vector3();
    const targetDirection = new THREE.Vector3(), aimedDirection = new THREE.Vector3();
    const neckSaved = new THREE.Quaternion();

    function recalcBindPose() {
      neckSaved.copy(neckJoint.quaternion);
      neckJoint.quaternion.identity();
      for (const state of Object.values(sideState)) state.bone.quaternion.identity();
      skinnedPlane.updateMatrixWorld(true);
      skeleton.calculateInverses();
      neckJoint.quaternion.copy(neckSaved);
      skinnedPlane.updateMatrixWorld(true);
    }
    function setShoulderWorld(side, worldPoint) {
      const state = sideState[side];
      if (!state || !worldPoint) return false;
      tempLocal.copy(worldPoint); skinnedPlane.worldToLocal(tempLocal);
      const changed = state.bone.position.distanceToSquared(tempLocal) > 1e-10;
      state.bone.position.copy(tempLocal);
      if (!state.shoulderWorld) state.shoulderWorld = new THREE.Vector3();
      state.shoulderWorld.copy(worldPoint);
      state.bindAxis.copy(distal[side]).sub(tempLocal);
      if (state.bindAxis.lengthSq() < 1e-8) state.bindAxis.set(0, -1, 0); else state.bindAxis.normalize();
      if (changed) recalcBindPose();
      return true;
    }
    function aimAtWorld(side, worldPoint) {
      const state = sideState[side];
      if (!state || !worldPoint || !state.shoulderWorld) return false;
      targetLocal.copy(worldPoint); skinnedPlane.worldToLocal(targetLocal);
      targetDirection.copy(targetLocal).sub(state.bone.position);
      if (targetDirection.lengthSq() < 1e-10) return false;
      targetDirection.normalize();
      state.bone.quaternion.setFromUnitVectors(state.bindAxis, targetDirection).normalize();
      state.bone.updateMatrix?.(); state.bone.updateMatrixWorld?.(true);
      aimedDirection.copy(state.bindAxis).applyQuaternion(state.bone.quaternion).normalize();
      state.residualDeg = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, aimedDirection.dot(targetDirection)))));
      if (!state.elbowWorld) state.elbowWorld = new THREE.Vector3();
      state.elbowWorld.copy(worldPoint);
      return true;
    }
    function reset(side) {
      const state = sideState[side];
      if (!state) return false;
      state.bone.quaternion.identity(); state.residualDeg = null; state.elbowWorld = null;
      return true;
    }

    const api = {
      available: true,
      skeleton,
      bones: { left: leftBone, right: rightBone },
      reapplyWeights,
      setShoulderWorld,
      aimAtWorld,
      reset,
      resetAll() { reset('left'); reset('right'); },
      setGuides(value) { guides.left.visible = guides.right.visible = !!value; },
      getDebug() {
        const sides = {};
        for (const side of ['left', 'right']) {
          const state = sideState[side];
          sides[side] = {
            shoulderWorld: state.shoulderWorld ? { x: state.shoulderWorld.x, y: state.shoulderWorld.y, z: state.shoulderWorld.z } : null,
            elbowWorld: state.elbowWorld ? { x: state.elbowWorld.x, y: state.elbowWorld.y, z: state.elbowWorld.z } : null,
            bindAxis: { x: state.bindAxis.x, y: state.bindAxis.y, z: state.bindAxis.z },
            residualDeg: state.residualDeg,
          };
        }
        return { enabled: settings?.bicepElbowTracking === true, maskSource: 'armL/armR portrait layers', sides };
      },
    };
    avatarRoot.userData.bicepRig = api;
    active.add(api);
    // The Attack Editor rewrites torso/head weights immediately after avatar build.
    // Re-apply on the next frame so the arm channels compose with that final neck
    // weighting instead of being overwritten by it.
    global.requestAnimationFrame?.(() => api.reapplyWeights());
    return api;
  }

  const wrappedBuild = function bicepRigAvatarBuild(THREE, sourceCanvas, options = {}) {
    // Game avatars normally use a cheaper rigid plane. The bicep experiment needs
    // the existing neck-rigged SkinnedMesh, so request it only while this experiment
    // is enabled. The Attack Editor already requests neckRig=true explicitly.
    const buildOptions = settings?.bicepElbowTracking === true && options.neckRig !== true
      ? { ...options, neckRig: true }
      : options;
    const avatarRoot = originalBuild.call(this, THREE, sourceCanvas, buildOptions);
    if (avatarRoot) installBicepRig(THREE, avatarRoot, sourceCanvas);
    return avatarRoot;
  };
  wrappedBuild.__hobunjiBicepRigWrapped = true;
  avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

  const originalDispose = avatarApi.disposeAvatarModel?.bind(avatarApi);
  if (originalDispose) {
    avatarApi.disposeAvatarModel = function bicepRigDispose(root) {
      const api = root?.userData?.bicepRig;
      if (api?.available) active.delete(api);
      if (root?.userData) root.userData.bicepRig = null;
      return originalDispose(root);
    };
  }

  settings?.subscribe?.(next => {
    if (!next.bicepElbowTracking) for (const rig of active) rig.resetAll?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  });

  global.ProceduralAvatarBicepRig = Object.freeze({
    mode: 'png-arm-mask-bicep-bones',
    get activeCount() { return active.size; },
    setShowGuides(value) { showGuides = !!value; for (const rig of active) rig.setGuides?.(showGuides); },
    refreshAllWeights() { for (const rig of active) rig.reapplyWeights?.(); },
  });
})(window);
