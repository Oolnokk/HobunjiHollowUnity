// Adds portrait-skin bicep bones that follow the procedural upper-arm pivots.
// Arm-region vertices are strongly weighted to these bicep bones and never to
// forearm bones. The small shoulder neighborhood stays torso-weighted so the
// live shoulder-surface tracker cannot feed its own bicep deformation back into
// the shoulder anchor.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  if (!hands?.attach || hands.attach.__hobunjiPortraitBicepsWrapped) return;

  const BICEP_WEIGHT = 0.94;
  const ARM_RADIUS_UV = 0.052;
  const SHOULDER_GUARD_UV = 0.060;
  const tracked = new Set();

  function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const denom = dx * dx + dy * dy;
    const t = denom > 1e-10 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom)) : 0;
    const x = ax + dx * t, y = ay + dy * t;
    return Math.hypot(px - x, py - y);
  }

  function armLine(scanSide) {
    const shoulder = scanSide?.shoulder;
    const hand = scanSide?.hand;
    if (!shoulder || !hand) return null;
    // shoulder was intentionally moved 10% down from the raw first opaque row;
    // recover that original top so the whole painted arm corridor is considered.
    return {
      ax: Number(shoulder.xRatio),
      ay: Number(shoulder.yRatio) - 0.10,
      bx: Number(hand.xRatio),
      by: Number(hand.yRatio),
      sx: Number(shoulder.xRatio),
      sy: Number(shoulder.yRatio),
    };
  }

  function addBicepBone(THREE, skinnedPlane, torsoBone, rig, side) {
    const shoulderNode = rig.group.getObjectByName(`${side}_shoulder`);
    if (!shoulderNode) return null;
    const bone = new THREE.Bone();
    bone.name = `${side}_portrait_bicep_bone`;
    torsoBone.add(bone);
    return { side, bone, shoulderNode, upperNode: rig.group.getObjectByName(`${side}_upper_arm`) };
  }

  function updateBoneTransform(THREE, rec, rig, skinnedPlane, torsoBone) {
    if (!rec?.bone || !rec.shoulderNode || !rec.upperNode || !rig?.parent) return;
    rig.parent.updateWorldMatrix?.(true, false);
    skinnedPlane.updateWorldMatrix?.(true, false);
    torsoBone.updateWorldMatrix?.(true, false);
    rec.shoulderNode.updateWorldMatrix?.(true, false);
    rec.upperNode.updateWorldMatrix?.(true, false);

    const shoulderWorld = new THREE.Vector3();
    rec.shoulderNode.getWorldPosition(shoulderWorld);
    torsoBone.worldToLocal(shoulderWorld);
    rec.bone.position.copy(shoulderWorld);

    const upperWorldQ = new THREE.Quaternion();
    const torsoWorldQ = new THREE.Quaternion();
    rec.upperNode.getWorldQuaternion(upperWorldQ);
    torsoBone.getWorldQuaternion(torsoWorldQ);
    rec.bone.quaternion.copy(torsoWorldQ.invert().multiply(upperWorldQ));
    rec.bone.updateMatrix?.();
    rec.bone.updateMatrixWorld?.(true);
  }

  function reweightGeometry(THREE, geometry, scan, leftIndex, rightIndex) {
    const uv = geometry?.getAttribute?.('uv');
    const oldIndices = geometry?.getAttribute?.('skinIndex');
    const oldWeights = geometry?.getAttribute?.('skinWeight');
    if (!uv || !oldIndices || !oldWeights) return 0;

    const indices = new Uint16Array(oldIndices.array);
    const weights = new Float32Array(oldWeights.array);
    const lines = { left: armLine(scan?.left), right: armLine(scan?.right) };
    let changed = 0;

    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const yRatio = 1 - uv.getY(i);
      let selected = null;
      let selectedIndex = -1;
      let best = Infinity;
      for (const side of ['left', 'right']) {
        const line = lines[side];
        if (!line) continue;
        const shoulderDistance = Math.hypot(u - line.sx, yRatio - line.sy);
        if (shoulderDistance < SHOULDER_GUARD_UV) continue;
        const d = pointSegmentDistance(u, yRatio, line.ax, line.ay, line.bx, line.by);
        if (d < ARM_RADIUS_UV && d < best) {
          best = d;
          selected = side;
          selectedIndex = side === 'left' ? leftIndex : rightIndex;
        }
      }
      if (!selected || selectedIndex < 0) continue;
      const o = i * 4;
      indices[o] = 0; // torso residual
      indices[o + 1] = selectedIndex;
      indices[o + 2] = 0;
      indices[o + 3] = 0;
      weights[o] = 1 - BICEP_WEIGHT;
      weights[o + 1] = BICEP_WEIGHT;
      weights[o + 2] = 0;
      weights[o + 3] = 0;
      changed++;
    }

    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    return changed;
  }

  function install(THREE, rig, options) {
    const avatarRoot = options?.avatarRoot;
    const skinnedPlane = avatarRoot?.userData?.neckRig?.skinnedPlane;
    const oldSkeleton = skinnedPlane?.skeleton;
    const torsoBone = oldSkeleton?.bones?.[0];
    const scan = options?.armAttachments?.source || avatarRoot?.userData?.armAttachments?.source;
    if (!skinnedPlane?.isSkinnedMesh || !oldSkeleton || !torsoBone || !scan) return rig;
    if (avatarRoot.userData?.portraitBicepSkinning) return rig;

    const left = addBicepBone(THREE, skinnedPlane, torsoBone, rig, 'left');
    const right = addBicepBone(THREE, skinnedPlane, torsoBone, rig, 'right');
    if (!left || !right) return rig;

    // Create a fresh skeleton so Three r128 resizes boneMatrices correctly;
    // pushing into oldSkeleton.bones would leave its typed bone-matrix buffer short.
    const skeleton = new THREE.Skeleton([...oldSkeleton.bones, left.bone, right.bone]);
    skinnedPlane.bind(skeleton, skinnedPlane.bindMatrix.clone());
    const leftIndex = skeleton.bones.indexOf(left.bone);
    const rightIndex = skeleton.bones.indexOf(right.bone);
    const weightedVertices = reweightGeometry(THREE, skinnedPlane.geometry, scan, leftIndex, rightIndex);

    const record = { THREE, rig, avatarRoot, skinnedPlane, torsoBone, left, right, weightedVertices, disposed: false };
    avatarRoot.userData.portraitBicepSkinning = record;
    tracked.add(record);

    const update = () => {
      updateBoneTransform(THREE, left, rig, skinnedPlane, torsoBone);
      updateBoneTransform(THREE, right, rig, skinnedPlane, torsoBone);
      skinnedPlane.skeleton?.update?.();
    };
    update();

    const oldDebug = rig.getDebug?.bind(rig);
    if (oldDebug) {
      rig.getDebug = () => ({
        ...(oldDebug() || {}),
        portraitBicepSkinning: {
          weightedVertices,
          bicepWeight: BICEP_WEIGHT,
          forearmWeight: 0,
        },
      });
    }

    const oldDispose = rig.dispose?.bind(rig);
    if (oldDispose) {
      rig.dispose = function portraitBicepDispose(...args) {
        record.disposed = true;
        tracked.delete(record);
        if (avatarRoot?.userData?.portraitBicepSkinning === record) avatarRoot.userData.portraitBicepSkinning = null;
        return oldDispose(...args);
      };
    }
    return rig;
  }

  const originalAttach = hands.attach.bind(hands);
  hands.attach = function portraitBicepAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? install(THREE, rig, options) : rig;
  };
  hands.attach.__hobunjiPortraitBicepsWrapped = true;

  function frame() {
    for (const rec of [...tracked]) {
      if (rec.disposed || !rec.rig?.group?.parent || !rec.skinnedPlane?.parent) {
        tracked.delete(rec);
        continue;
      }
      updateBoneTransform(rec.THREE, rec.left, rec.rig, rec.skinnedPlane, rec.torsoBone);
      updateBoneTransform(rec.THREE, rec.right, rec.rig, rec.skinnedPlane, rec.torsoBone);
      rec.skinnedPlane.skeleton?.update?.();
    }
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);
})(window);
