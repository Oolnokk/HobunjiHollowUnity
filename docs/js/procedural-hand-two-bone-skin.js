// Runtime two-bone skinning for static hand GLBs.
//
// Local source-GLB basis is authoritative:
//   +Y = toward wrist / forearm / shoulder
//   +Z = toward palm
//   +X = toward thumb
// The hand bone inherits the authored tool/grip socket. The forearm bone alone aims
// +Y at its target. Experimental per-axis tracking can take Pitch/Yaw/Roll from that
// solve independently; unchecked components remain identity on the child bone and
// therefore inherit the hand/grip direction on those axes.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const profiles = global.HobunjiHandModelProfiles;
  const settings = global.HobunjiHandExperimentalRigSettings;
  const poseRuntime = global.HobunjiHandShoulderPoseRuntime;
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
  function configsEqual(a, b) {
    return !!a && !!b
      && Math.abs(a.jointYPercent - b.jointYPercent) < 1e-8
      && Math.abs(a.blendWidthPercent - b.blendWidthPercent) < 1e-8
      && Math.abs(a.crossBoneWeight - b.crossBoneWeight) < 1e-8;
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
    let minY = Infinity, maxY = -Infinity;
    for (const mesh of meshes) {
      const position = mesh.geometry?.getAttribute?.('position');
      if (!position) continue;
      mesh.updateWorldMatrix?.(true, false);
      toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
      for (let i = 0; i < position.count; i++) {
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
    let indices = geometry.getAttribute('skinIndex')?.array;
    let weights = geometry.getAttribute('skinWeight')?.array;
    if (!indices || indices.length !== position.count * 4) indices = new Uint16Array(position.count * 4);
    if (!weights || weights.length !== position.count * 4) weights = new Float32Array(position.count * 4);
    const point = new THREE.Vector3();
    const halfBlend = config.blendWidthPercent * 0.5;
    const blendStart = config.jointYPercent - halfBlend;
    const blendEnd = config.jointYPercent + halfBlend;
    const cross = config.crossBoneWeight;
    const span = 1 - cross * 2;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      const yPercent = clamp((point.y - bounds.minY) / bounds.height, 0, 1);
      const forearmMix = smoothstep(blendStart, blendEnd, yPercent);
      const forearmWeight = cross + span * forearmMix;
      const offset = i * 4;
      indices[offset] = 0;
      indices[offset + 1] = 1;
      indices[offset + 2] = 0;
      indices[offset + 3] = 0;
      weights[offset] = 1 - forearmWeight;
      weights[offset + 1] = forearmWeight;
      weights[offset + 2] = 0;
      weights[offset + 3] = 0;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.getAttribute('skinIndex').needsUpdate = true;
    geometry.getAttribute('skinWeight').needsUpdate = true;
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

  function recalcSkeletonBind(skinRig) {
    const saved = skinRig.forearmBone.quaternion.clone();
    skinRig.forearmBone.quaternion.identity();
    skinRig.modelRoot.updateMatrixWorld(true);
    skinRig.skeleton.calculateInverses();
    skinRig.forearmBone.quaternion.copy(saved);
    skinRig.modelRoot.updateMatrixWorld(true);
  }

  function applyConfigLive(THREE, skinRig, model) {
    if (!skinRig) return false;
    const next = rigConfig(model);
    if (configsEqual(next, skinRig.config)) return false;
    const jointChanged = !skinRig.config || Math.abs(next.jointYPercent - skinRig.config.jointYPercent) > 1e-8;
    skinRig.config = next;
    skinRig.jointY = skinRig.bounds.minY + skinRig.bounds.height * next.jointYPercent;
    skinRig.forearmBone.position.y = skinRig.jointY;
    for (const binding of skinRig.weightBindings) {
      skinGeometryForBones(THREE, binding.mesh.geometry, binding.toRoot, skinRig.bounds, next);
      binding.mesh.normalizeSkinWeights?.();
    }
    if (jointChanged) recalcSkeletonBind(skinRig);
    skinRig.visual.userData.forearmJointYPercent = next.jointYPercent;
    skinRig.visual.userData.forearmBlendWidthPercent = next.blendWidthPercent;
    skinRig.visual.userData.crossBoneWeight = next.crossBoneWeight;
    return true;
  }

  function rigStaticVisual(THREE, visual, model) {
    if (!visual) return null;
    const existing = visual.userData?.twoBoneSkinRig || null;
    if (existing) {
      applyConfigLive(THREE, existing, model);
      return existing;
    }
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
    const toRootBySource = new Map();
    for (const mesh of sourceMeshes) {
      mesh.updateWorldMatrix?.(true, false);
      toRootBySource.set(mesh, new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld));
    }

    const handBone = new THREE.Bone();
    handBone.name = 'hand_bone';
    const forearmBone = new THREE.Bone();
    forearmBone.name = 'forearm_bone';
    forearmBone.position.set(0, jointY, 0);
    handBone.add(forearmBone);
    modelRoot.add(handBone);

    const skinnedMeshes = [];
    const weightBindings = [];
    for (const source of sourceMeshes) {
      const toRoot = toRootBySource.get(source);
      if (!skinGeometryForBones(THREE, source.geometry, toRoot, bounds, config)) continue;
      const skinned = replaceWithSkinnedMesh(THREE, source);
      if (!skinned) continue;
      skinnedMeshes.push(skinned);
      weightBindings.push({ mesh: skinned, toRoot });
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

    const skinRig = {
      visual,
      modelRoot,
      handBone,
      forearmBone,
      skeleton,
      skinnedMeshes,
      weightBindings,
      jointY,
      bounds,
      config,
      targetWorld: null,
      targetKind: 'shoulder',
      residualDeg: null,
      aimApplied: false,
      axisWeights: { pitch: 1, yaw: 1, roll: 1 },
      fullAimDeg: { pitch: 0, yaw: 0, roll: 0 },
      appliedAimDeg: { pitch: 0, yaw: 0, roll: 0 },
    };
    visual.userData.twoBoneSkinRig = skinRig;
    visual.userData.forearmJointYPercent = config.jointYPercent;
    visual.userData.forearmBlendWidthPercent = config.blendWidthPercent;
    visual.userData.crossBoneWeight = config.crossBoneWeight;
    return skinRig;
  }

  function installTwoBoneController(THREE, rig) {
    const sideState = {
      left: { targetWorld: null, targetKind: 'shoulder', lastRig: null },
      right: { targetWorld: null, targetKind: 'shoulder', lastRig: null },
    };
    const localUp = new THREE.Vector3(LOCAL_FOREARM_AXIS.x, LOCAL_FOREARM_AXIS.y, LOCAL_FOREARM_AXIS.z);
    const targetLocal = new THREE.Vector3();
    const aimedUp = new THREE.Vector3();
    const fullAim = new THREE.Quaternion();
    const aimEuler = new THREE.Euler(0, 0, 0, 'YXZ');

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

    function axisWeights(side) {
      if (settings?.forearmAxisTracking !== true) return { pitch: 1, yaw: 1, roll: 1 };
      const raw = poseRuntime?.currentWeights?.(side) || { pitch: 1, yaw: 1, roll: 1 };
      return {
        pitch: clamp(raw.pitch, 0, 1),
        yaw: clamp(raw.yaw, 0, 1),
        roll: clamp(raw.roll, 0, 1),
      };
    }

    function aimSide(side) {
      const state = sideState[side];
      const skinRig = ensureSideRig(side);
      if (!skinRig || !state.targetWorld) return false;
      const modelKey = skinRig.visual.userData?.handModelKey;
      applyConfigLive(THREE, skinRig, profiles.data?.models?.[modelKey]);

      skinRig.modelRoot.updateWorldMatrix?.(true, true);
      targetLocal.copy(state.targetWorld);
      skinRig.modelRoot.worldToLocal(targetLocal);
      targetLocal.sub(skinRig.forearmBone.position);
      if (targetLocal.lengthSq() < 1e-10) {
        skinRig.forearmBone.quaternion.identity();
        skinRig.aimApplied = false;
        skinRig.residualDeg = 0;
        return false;
      }
      targetLocal.normalize();
      fullAim.setFromUnitVectors(localUp, targetLocal).normalize();
      aimEuler.setFromQuaternion(fullAim, 'YXZ');
      const weights = axisWeights(side);
      const fullDeg = {
        pitch: THREE.MathUtils.radToDeg(aimEuler.x),
        yaw: THREE.MathUtils.radToDeg(aimEuler.y),
        roll: THREE.MathUtils.radToDeg(aimEuler.z),
      };

      if (settings?.forearmAxisTracking === true) {
        skinRig.forearmBone.rotation.set(
          aimEuler.x * weights.pitch,
          aimEuler.y * weights.yaw,
          aimEuler.z * weights.roll,
          'YXZ',
        );
      } else {
        skinRig.forearmBone.quaternion.copy(fullAim);
      }
      skinRig.forearmBone.updateMatrix?.();
      skinRig.forearmBone.updateMatrixWorld?.(true);
      aimedUp.copy(localUp).applyQuaternion(skinRig.forearmBone.quaternion).normalize();
      const dot = clamp(aimedUp.dot(targetLocal), -1, 1);
      skinRig.residualDeg = THREE.MathUtils.radToDeg(Math.acos(dot));
      skinRig.aimApplied = true;
      skinRig.targetWorld = state.targetWorld.clone();
      skinRig.targetKind = state.targetKind;
      skinRig.axisWeights = { ...weights };
      skinRig.fullAimDeg = fullDeg;
      skinRig.appliedAimDeg = {
        pitch: fullDeg.pitch * weights.pitch,
        yaw: fullDeg.yaw * weights.yaw,
        roll: fullDeg.roll * weights.roll,
      };
      return true;
    }

    function ensureAll() {
      ensureSideRig('left');
      ensureSideRig('right');
      aimSide('left');
      aimSide('right');
    }

    rig.aimForearmAtWorld = function aimForearmAtWorld(side, targetWorld, options = {}) {
      if (!sideState[side] || !targetWorld) return false;
      if (!sideState[side].targetWorld) sideState[side].targetWorld = new THREE.Vector3();
      sideState[side].targetWorld.copy(targetWorld);
      sideState[side].targetKind = String(options.targetKind || 'shoulder');
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
      for (const side of ['left', 'right']) {
        const skinRig = ensureSideRig(side);
        if (skinRig) {
          const modelKey = skinRig.visual.userData?.handModelKey;
          applyConfigLive(THREE, skinRig, profiles.data?.models?.[modelKey]);
        }
      }
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
        sideState.left.lastRig = null;
        sideState.right.lastRig = null;
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
          targetKind: skinRig.targetKind,
          residualDeg: skinRig.residualDeg,
          axisWeights: { ...skinRig.axisWeights },
          fullAimDeg: { ...skinRig.fullAimDeg },
          appliedAimDeg: { ...skinRig.appliedAimDeg },
          vertexMeshes: skinRig.skinnedMeshes.length,
          targetWorld: skinRig.targetWorld ? { x: skinRig.targetWorld.x, y: skinRig.targetWorld.y, z: skinRig.targetWorld.z } : null,
        } : { rigged: false };
      }
      return {
        ...(originalDebug?.() || {}),
        twoBoneSkin: {
          mode: 'hand-grip-plus-forearm-target',
          handBoneAuthority: 'tool/grip socket',
          forearmBoneAuthority: settings?.bicepElbowTracking ? 'elbow target' : 'shoulder target',
          forearmAxisTrackingExperimental: settings?.forearmAxisTracking === true,
          localBasis: { positiveY: 'wrist', positiveZ: 'palm', positiveX: 'thumb' },
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
      refresh: rig.refreshForearmSkin,
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

  settings?.subscribe?.(() => {
    for (const controller of controllers) controller.refresh?.();
  });

  global.ProceduralHandTwoBoneSkin = Object.freeze({
    mode: 'runtime-two-bone-skin',
    localBasis: Object.freeze({ positiveY: 'wrist', positiveZ: 'palm', positiveX: 'thumb' }),
    defaults: Object.freeze({
      jointYPercent: DEFAULT_JOINT_Y_PERCENT,
      blendWidthPercent: DEFAULT_BLEND_WIDTH_PERCENT,
      crossBoneWeight: DEFAULT_CROSS_BONE_WEIGHT,
    }),
    refreshAll() { for (const controller of controllers) controller.refresh?.(); },
  });
})(window);
