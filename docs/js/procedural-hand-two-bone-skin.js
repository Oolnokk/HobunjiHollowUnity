// Runtime two-bone skinning for static hand GLBs.
//
// The authored grip frame stays on the hand socket. This adapter converts each
// loaded static hand visual into a two-bone skin once per model instance:
//   hand bone    = authored tool/grip orientation
//   forearm bone = continuously aimed toward the portrait shoulder target
// Vertex weights are a broad smoothstep over model-local Y with a non-zero floor
// on both bones so almost the entire mesh participates in both transforms.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const profiles = global.HobunjiHandModelProfiles;
  if (!hands?.attach || !profiles || hands.attach.__hobunjiTwoBoneSkinWrapped) return;

  const originalAttach = hands.attach.bind(hands);
  const controllers = new Set();
  let showBoneGuides = false;

  const DEFAULT_JOINT_Y_PERCENT = 0.62;
  const DEFAULT_BLEND_WIDTH_PERCENT = 0.62;
  const DEFAULT_CROSS_BONE_WEIGHT = 0.04;
  const LOCAL_FOREARM_AXIS = Object.freeze({ x: 0, y: 1, z: 0 });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function smoothstep(edge0, edge1, value) {
    if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function rigConfig(model) {
    const raw = model?.forearmRig || {};
    return {
      jointYPercent: clamp(Number.isFinite(Number(raw.jointYPercent)) ? Number(raw.jointYPercent) : DEFAULT_JOINT_Y_PERCENT, 0.05, 0.95),
      blendWidthPercent: clamp(Number.isFinite(Number(raw.blendWidthPercent)) ? Number(raw.blendWidthPercent) : DEFAULT_BLEND_WIDTH_PERCENT, 0.05, 1.5),
      crossBoneWeight: clamp(Number.isFinite(Number(raw.crossBoneWeight)) ? Number(raw.crossBoneWeight) : DEFAULT_CROSS_BONE_WEIGHT, 0.001, 0.24),
    };
  }

  function copyObjectProps(source, target) {
    target.name = source.name;
    target.position.copy(source.position);
    target.quaternion.copy(source.quaternion);
    target.scale.copy(source.scale);
    target.visible = source.visible;
    target.renderOrder = source.renderOrder;
    target.frustumCulled = source.frustumCulled;
    target.castShadow = source.castShadow;
    target.receiveShadow = source.receiveShadow;
    target.matrixAutoUpdate = source.matrixAutoUpdate;
    if (!source.matrixAutoUpdate) target.matrix.copy(source.matrix);
    target.userData = { ...(source.userData || {}) };
    target.layers.mask = source.layers.mask;
    target.onBeforeRender = source.onBeforeRender;
    target.onAfterRender = source.onAfterRender;
  }

  function rootLocalYBounds(THREE, modelRoot, meshes) {
    modelRoot.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
    const toRoot = new THREE.Matrix4();
    const point = new THREE.Vector3();
    let minY = Infinity;
    let maxY = -Infinity;

    for (const mesh of meshes) {
      const position = mesh.geometry?.getAttribute?.('position');
      if (!position) continue;
      mesh.updateWorldMatrix?.(true, false);
      toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || Math.abs(maxY - minY) < 1e-7) {
      return { minY: -0.5, maxY: 0.5, height: 1 };
    }
    return { minY, maxY, height: Math.max(1e-7, maxY - minY) };
  }

  function skinGeometryForBones(THREE, geometry, toRoot, bounds, config) {
    const position = geometry?.getAttribute?.('position');
    if (!position) return false;

    const indices = new Uint16Array(position.count * 4);
    const weights = new Float32Array(position.count * 4);
    const point = new THREE.Vector3();
    const halfBlend = config.blendWidthPercent * 0.5;
    const blendStart = config.jointYPercent - halfBlend;
    const blendEnd = config.jointYPercent + halfBlend;
    const cross = config.crossBoneWeight;
    const span = 1 - cross * 2;

    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      const yPercent = clamp((point.y - bounds.minY) / bounds.height, 0, 1);
      const forearmMix = smoothstep(blendStart, blendEnd, yPercent);
      const forearmWeight = cross + span * forearmMix;
      const handWeight = 1 - forearmWeight;
      const offset = i * 4;
      indices[offset] = 0;
      indices[offset + 1] = 1;
      weights[offset] = handWeight;
      weights[offset + 1] = forearmWeight;
    }

    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    return true;
  }

  function replaceWithSkinnedMesh(THREE, source) {
    const parent = source.parent;
    if (!parent || source.isSkinnedMesh || !source.geometry?.getAttribute?.('position')) return null;
    const index = parent.children.indexOf(source);
    const skinned = new THREE.SkinnedMesh(source.geometry, source.material);
    copyObjectProps(source, skinned);
    parent.add(skinned);
    parent.remove(source);
    if (index >= 0) {
      const appended = parent.children.indexOf(skinned);
      if (appended >= 0) parent.children.splice(appended, 1);
      parent.children.splice(Math.min(index, parent.children.length), 0, skinned);
    }
    const materials = Array.isArray(skinned.material) ? skinned.material : [skinned.material];
    for (const material of materials) {
      if (!material) continue;
      material.skinning = true;
      material.needsUpdate = true;
    }
    return skinned;
  }

  function rigStaticVisual(THREE, visual, model) {
    if (!visual || visual.userData?.twoBoneSkinRig) return visual?.userData?.twoBoneSkinRig || null;
    const modelRoot = visual.children?.find(child => child?.isObject3D && child.name !== 'hand_bone_guide') || visual.children?.[0] || null;
    if (!modelRoot) return null;

    const sourceMeshes = [];
    modelRoot.traverse?.(node => {
      if (node?.isMesh && !node?.isSkinnedMesh && node.geometry?.getAttribute?.('position')) sourceMeshes.push(node);
    });
    if (!sourceMeshes.length) return null;

    const config = rigConfig(model);
    modelRoot.updateMatrixWorld(true);
    const bounds = rootLocalYBounds(THREE, modelRoot, sourceMeshes);
    const jointY = bounds.minY + bounds.height * config.jointYPercent;
    const rootInverse = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
    const toRootByMesh = new Map();
    for (const mesh of sourceMeshes) {
      mesh.updateWorldMatrix?.(true, false);
      toRootByMesh.set(mesh, new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld));
    }

    const handBone = new THREE.Bone();
    handBone.name = 'hand_bone';
    const forearmBone = new THREE.Bone();
    forearmBone.name = 'forearm_bone';
    forearmBone.position.set(0, jointY, 0);
    handBone.add(forearmBone);
    modelRoot.add(handBone);

    const skinnedMeshes = [];
    for (const source of sourceMeshes) {
      const geometry = source.geometry;
      if (!skinGeometryForBones(THREE, geometry, toRootByMesh.get(source), bounds, config)) continue;
      const skinned = replaceWithSkinnedMesh(THREE, source);
      if (skinned) skinnedMeshes.push(skinned);
    }
    if (!skinnedMeshes.length) {
      modelRoot.remove(handBone);
      return null;
    }

    modelRoot.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([handBone, forearmBone]);
    for (const mesh of skinnedMeshes) {
      mesh.updateMatrixWorld(true);
      mesh.bind(skeleton, mesh.matrixWorld);
      mesh.normalizeSkinWeights?.();
    }

    const handGuide = new THREE.AxesHelper(bounds.height * 0.18);
    handGuide.name = 'hand_bone_guide';
    handGuide.visible = showBoneGuides;
    handGuide.renderOrder = 70;
    handBone.add(handGuide);
    const forearmGuide = new THREE.AxesHelper(bounds.height * 0.22);
    forearmGuide.name = 'forearm_bone_guide';
    forearmGuide.visible = showBoneGuides;
    forearmGuide.renderOrder = 70;
    forearmBone.add(forearmGuide);
    for (const guide of [handGuide, forearmGuide]) {
      guide.traverse?.(node => {
        if (node.material) {
          node.material.depthTest = false;
          node.material.depthWrite = false;
        }
      });
    }

    const rig = {
      modelRoot,
      handBone,
      forearmBone,
      skeleton,
      skinnedMeshes,
      jointY,
      bounds,
      config,
      targetWorld: null,
      residualDeg: null,
      aimApplied: false,
    };
    visual.userData.twoBoneSkinRig = rig;
    visual.userData.forearmJointYPercent = config.jointYPercent;
    visual.userData.forearmBlendWidthPercent = config.blendWidthPercent;
    visual.userData.crossBoneWeight = config.crossBoneWeight;
    return rig;
  }

  function installTwoBoneController(THREE, rig) {
    const sideState = {
      left: { targetWorld: null, lastRig: null },
      right: { targetWorld: null, lastRig: null },
    };
    const localUp = new THREE.Vector3(LOCAL_FOREARM_AXIS.x, LOCAL_FOREARM_AXIS.y, LOCAL_FOREARM_AXIS.z);
    const shoulderLocal = new THREE.Vector3();
    const targetLocal = new THREE.Vector3();
    const aimedUp = new THREE.Vector3();

    function socketFor(side) {
      return rig.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    }

    function visualFor(side) {
      const socket = socketFor(side);
      if (!socket) return null;
      return socket.children?.find(child => child?.userData?.handModelKey) || null;
    }

    function ensureSideRig(side) {
      const visual = visualFor(side);
      if (!visual) return null;
      const modelKey = visual.userData?.handModelKey;
      const model = profiles.data?.models?.[modelKey] || null;
      const skinRig = rigStaticVisual(THREE, visual, model);
      if (skinRig && sideState[side].lastRig !== skinRig) {
        sideState[side].lastRig = skinRig;
        skinRig.targetWorld = sideState[side].targetWorld?.clone?.() || null;
      }
      return skinRig;
    }

    function aimSide(side) {
      const state = sideState[side];
      const skinRig = ensureSideRig(side);
      if (!skinRig || !state.targetWorld) return false;

      skinRig.modelRoot.updateWorldMatrix?.(true, true);
      shoulderLocal.copy(state.targetWorld);
      skinRig.modelRoot.worldToLocal(shoulderLocal);
      targetLocal.copy(shoulderLocal).sub(skinRig.forearmBone.position);
      if (targetLocal.lengthSq() < 1e-10) {
        skinRig.forearmBone.quaternion.identity();
        skinRig.aimApplied = false;
        skinRig.residualDeg = 0;
        return false;
      }
      targetLocal.normalize();
      skinRig.forearmBone.quaternion.setFromUnitVectors(localUp, targetLocal).normalize();
      skinRig.forearmBone.updateMatrix?.();
      skinRig.forearmBone.updateMatrixWorld?.(true);
      aimedUp.copy(localUp).applyQuaternion(skinRig.forearmBone.quaternion).normalize();
      const dot = clamp(aimedUp.dot(targetLocal), -1, 1);
      skinRig.residualDeg = THREE.MathUtils.radToDeg(Math.acos(dot));
      skinRig.aimApplied = true;
      skinRig.targetWorld = state.targetWorld.clone();
      return true;
    }

    function ensureAll() {
      ensureSideRig('left');
      ensureSideRig('right');
      aimSide('left');
      aimSide('right');
    }

    rig.aimForearmAtWorld = function aimForearmAtWorld(side, shoulderWorld) {
      if (!sideState[side] || !shoulderWorld) return false;
      if (!sideState[side].targetWorld) sideState[side].targetWorld = new THREE.Vector3();
      sideState[side].targetWorld.copy(shoulderWorld);
      return aimSide(side);
    };

    rig.clearForearmTarget = function clearForearmTarget(side) {
      const state = sideState[side];
      if (!state) return false;
      state.targetWorld = null;
      const skinRig = ensureSideRig(side);
      if (skinRig) {
        skinRig.forearmBone.quaternion.identity();
        skinRig.aimApplied = false;
        skinRig.residualDeg = null;
      }
      return true;
    };

    rig.refreshForearmSkin = function refreshForearmSkin() {
      ensureAll();
      return true;
    };

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function twoBonePlaceHandWorld(side, worldPosition, worldQuaternion) {
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion);
        ensureSideRig(side);
        if (sideState[side]?.targetWorld) aimSide(side);
        return result;
      };
    }

    const originalSetSideIdle = rig.setSideIdle?.bind(rig);
    if (originalSetSideIdle) {
      rig.setSideIdle = function twoBoneSetSideIdle(side) {
        const result = originalSetSideIdle(side);
        ensureSideRig(side);
        if (sideState[side]?.targetWorld) aimSide(side);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function twoBoneUseIdlePose() {
        const result = originalUseIdlePose();
        ensureAll();
        return result;
      };
    }

    const originalRefresh = rig.refreshModelProfile?.bind(rig);
    if (originalRefresh) {
      rig.refreshModelProfile = async function twoBoneRefreshModelProfile() {
        const result = await originalRefresh();
        ensureAll();
        return result;
      };
    }

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function twoBoneDebug() {
      const sides = {};
      for (const side of ['left', 'right']) {
        const skinRig = ensureSideRig(side);
        sides[side] = skinRig ? {
          rigged: true,
          jointY: skinRig.jointY,
          jointYPercent: skinRig.config.jointYPercent,
          blendWidthPercent: skinRig.config.blendWidthPercent,
          crossBoneWeight: skinRig.config.crossBoneWeight,
          aimApplied: skinRig.aimApplied,
          residualDeg: skinRig.residualDeg,
          vertexMeshes: skinRig.skinnedMeshes.length,
          targetWorld: skinRig.targetWorld ? { x: skinRig.targetWorld.x, y: skinRig.targetWorld.y, z: skinRig.targetWorld.z } : null,
        } : { rigged: false };
      }
      return {
        ...(originalDebug?.() || {}),
        twoBoneSkin: {
          mode: 'hand-grip-plus-forearm-shoulder',
          handBoneAuthority: 'tool/grip socket',
          forearmBoneAuthority: 'shoulder target',
          localForearmAxis: '+Y',
          sides,
        },
      };
    };

    const controller = {
      rig,
      setGuides(visible) {
        showBoneGuides = !!visible;
        for (const side of ['left', 'right']) {
          const skinRig = ensureSideRig(side);
          for (const name of ['hand_bone_guide', 'forearm_bone_guide']) {
            const guide = skinRig?.modelRoot?.getObjectByName?.(name);
            if (guide) guide.visible = showBoneGuides;
          }
        }
      },
      refresh: ensureAll,
    };
    controllers.add(controller);

    const originalDispose = rig.dispose?.bind(rig);
    rig.dispose = function twoBoneDispose() {
      controllers.delete(controller);
      return originalDispose?.();
    };

    requestAnimationFrame(ensureAll);
    return rig;
  }

  const wrappedAttach = function twoBoneAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? installTwoBoneController(THREE, rig) : rig;
  };
  wrappedAttach.__hobunjiTwoBoneSkinWrapped = true;
  hands.attach = wrappedAttach;

  hands.setShowArmBoneGuides = function setShowArmBoneGuides(value) {
    showBoneGuides = !!value;
    for (const controller of controllers) controller.setGuides(showBoneGuides);
    return showBoneGuides;
  };

  global.ProceduralHandTwoBoneSkin = Object.freeze({
    mode: 'runtime-two-bone-skin',
    defaults: Object.freeze({
      jointYPercent: DEFAULT_JOINT_Y_PERCENT,
      blendWidthPercent: DEFAULT_BLEND_WIDTH_PERCENT,
      crossBoneWeight: DEFAULT_CROSS_BONE_WEIGHT,
    }),
    refreshAll() { for (const controller of controllers) controller.refresh(); },
  });
})(window);