// Keeps procedural arm shoulder joints attached to the live deformed portrait mesh.
//
// The raw arm-opacity scan remains authoritative for the rest X/Y shoulder point.
// Head turns and any future skinned portrait animation can move nearby portrait
// vertices out of the original Z=0 plane, so this adapter samples the closest
// skinned surface vertices every frame and transfers only their deformation delta
// onto the exact scanned shoulder. Arm reach is then solved from that moved point.
(function (global) {
  'use strict';

  const hands = global.ProceduralArmAnimation;
  if (!hands?.attach || hands.attach.__hobunjiPortraitShouldersWrapped) return;

  const originalAttach = hands.attach.bind(hands); // Preserves the shared IK/model constructor and only layers live shoulder tracking around it.
  const tracked = new Set(); // Active rigs whose portrait mesh can deform in 3D.

  function nearestUniqueVertices(THREE, skinnedPlane, parent, baseShoulder, count = 4) {
    const positions = skinnedPlane?.geometry?.getAttribute?.('position');
    if (!positions || !parent || !baseShoulder) return [];
    parent.updateWorldMatrix?.(true, false);
    skinnedPlane.updateWorldMatrix?.(true, false);

    const target = new THREE.Vector3(baseShoulder.x, baseShoulder.y, baseShoulder.z || 0);
    parent.localToWorld(target);
    skinnedPlane.worldToLocal(target);

    const unique = new Map(); // Non-indexed plane geometry repeats triangle vertices; collapse duplicates before choosing neighbors.
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
      const key = `${x.toFixed(6)}|${y.toFixed(6)}|${z.toFixed(6)}`;
      if (unique.has(key)) continue;
      const dx = x - target.x, dy = y - target.y, dz = z - target.z;
      unique.set(key, { index, dist2: dx * dx + dy * dy + dz * dz * 0.25 });
    }
    return [...unique.values()].sort((a, b) => a.dist2 - b.dist2).slice(0, count);
  }

  function buildSideBinding(THREE, rig, options, side) {
    const parent = rig?.parent;
    const avatarRoot = options?.avatarRoot;
    const skinnedPlane = avatarRoot?.userData?.neckRig?.skinnedPlane;
    const source = options?.armAttachments?.[side]?.shoulder;
    const shoulderNode = rig?.group?.getObjectByName?.(`${side}_shoulder`);
    if (!parent || !skinnedPlane?.isSkinnedMesh || !source || !shoulderNode) return null;

    const baseShoulder = new THREE.Vector3(Number(source.x) || 0, Number(source.y) || 0, Number(source.z) || 0);
    const neighbors = nearestUniqueVertices(THREE, skinnedPlane, parent, baseShoulder, 4);
    if (!neighbors.length) return null;

    let weightSum = 0;
    for (const entry of neighbors) {
      entry.weight = 1 / Math.max(1e-7, entry.dist2);
      weightSum += entry.weight;
    }
    for (const entry of neighbors) entry.weight /= Math.max(1e-7, weightSum);

    const positions = skinnedPlane.geometry.getAttribute('position');
    const restMesh = new THREE.Vector3();
    for (const entry of neighbors) {
      restMesh.x += positions.getX(entry.index) * entry.weight;
      restMesh.y += positions.getY(entry.index) * entry.weight;
      restMesh.z += positions.getZ(entry.index) * entry.weight;
    }
    const restParent = restMesh.clone();
    skinnedPlane.localToWorld(restParent);
    parent.worldToLocal(restParent);

    return {
      side,
      parent,
      skinnedPlane,
      shoulderNode,
      baseShoulder,
      neighbors,
      restParent,
      deltaLocal: new THREE.Vector3(),
      currentShoulder: baseShoulder.clone(),
    };
  }

  function updateBinding(THREE, binding) {
    if (!binding) return;
    const { parent, skinnedPlane, shoulderNode, neighbors, baseShoulder, restParent } = binding;
    if (!skinnedPlane?.parent || !shoulderNode?.parent) return;

    skinnedPlane.updateWorldMatrix?.(true, false);
    skinnedPlane.skeleton?.update?.();
    parent.updateWorldMatrix?.(true, false);
    const transformVertex = typeof skinnedPlane.boneTransform === 'function'
      ? skinnedPlane.boneTransform.bind(skinnedPlane)
      : typeof skinnedPlane.applyBoneTransform === 'function'
        ? skinnedPlane.applyBoneTransform.bind(skinnedPlane)
        : null;
    if (!transformVertex) return;

    const deformedMesh = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    for (const entry of neighbors) {
      transformVertex(entry.index, scratch);
      deformedMesh.addScaledVector(scratch, entry.weight);
    }
    const deformedParent = deformedMesh.clone();
    skinnedPlane.localToWorld(deformedParent);
    parent.worldToLocal(deformedParent);

    binding.deltaLocal.copy(deformedParent).sub(restParent);
    binding.currentShoulder.copy(baseShoulder).add(binding.deltaLocal);
    shoulderNode.position.copy(binding.currentShoulder); // Carries the invisible upper-arm hierarchy onto the deformed portrait surface, including Z.
  }

  function localDeltaToWorld(THREE, parent, deltaLocal) {
    if (!parent || !deltaLocal) return new THREE.Vector3();
    const origin = new THREE.Vector3();
    const end = deltaLocal.clone();
    parent.localToWorld(origin);
    parent.localToWorld(end);
    return end.sub(origin);
  }

  function installTracker(THREE, rig, options) {
    const left = buildSideBinding(THREE, rig, options, 'left');
    const right = buildSideBinding(THREE, rig, options, 'right');
    if (!left && !right) return rig;

    const record = { THREE, rig, left, right, disposed: false };
    tracked.add(record);
    const update = () => {
      updateBinding(THREE, left);
      updateBinding(THREE, right);
    };
    update();

    const originalFollowWorldTarget = rig.followWorldTarget?.bind(rig);
    if (originalFollowWorldTarget && right) {
      rig.followWorldTarget = function portraitShoulderAwareWorldTarget(worldTarget, worldQuaternion) {
        update();
        const deltaWorld = localDeltaToWorld(THREE, rig.parent, right.deltaLocal);
        const shiftedTarget = worldTarget.clone().sub(deltaWorld); // Static IK shoulder sees the same vector that the live moved shoulder sees to the real hand target.
        const result = originalFollowWorldTarget(shiftedTarget, worldQuaternion);
        if (result?.target?.add) result.target.add(deltaWorld); // Return the reachable point in the actual moved-shoulder world frame for tool-pose clamping.
        return result;
      };
    }

    const originalFollowLocalTarget = rig.followLocalTarget?.bind(rig);
    if (originalFollowLocalTarget && right) {
      rig.followLocalTarget = function portraitShoulderAwareLocalTarget(localTarget, localQuaternion) {
        update();
        const shiftedTarget = localTarget.clone().sub(right.deltaLocal);
        const result = originalFollowLocalTarget(shiftedTarget, localQuaternion);
        if (result?.target?.add) result.target.add(right.deltaLocal);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function portraitShoulderAwareIdlePose() {
        update();
        return originalUseIdlePose();
      };
    }

    const originalGetDebug = rig.getDebug?.bind(rig);
    if (originalGetDebug) {
      rig.getDebug = function portraitShoulderDebug() {
        const debug = originalGetDebug() || {};
        return {
          ...debug,
          dynamicShoulders: {
            left: left ? { position: left.currentShoulder.toArray(), deformationDelta: left.deltaLocal.toArray() } : null,
            right: right ? { position: right.currentShoulder.toArray(), deformationDelta: right.deltaLocal.toArray() } : null,
          },
        };
      };
    }

    const originalDispose = rig.dispose?.bind(rig);
    if (originalDispose) {
      rig.dispose = function portraitShoulderAwareDispose() {
        if (!record.disposed) {
          record.disposed = true;
          tracked.delete(record);
        }
        return originalDispose();
      };
    }
    return rig;
  }

  const wrappedAttach = function portraitShoulderAwareAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? installTracker(THREE, rig, options) : rig;
  };
  wrappedAttach.__hobunjiPortraitShouldersWrapped = true;
  hands.attach = wrappedAttach;

  function frame() {
    for (const record of [...tracked]) {
      if (record.disposed || !record.rig?.group?.parent) {
        tracked.delete(record);
        continue;
      }
      updateBinding(record.THREE, record.left);
      updateBinding(record.THREE, record.right);
    }
    global.requestAnimationFrame(frame);
  }
  global.requestAnimationFrame(frame);
})(window);
