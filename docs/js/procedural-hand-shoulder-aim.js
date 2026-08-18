// Hand-only shoulder compass. The painted arms remain untouched.
//
// The raw arm PNG scan supplies a shoulder target for each side. After the normal
// authored/tool hand transform is applied, this layer computes the minimal rotation
// that would point the GLB's local +Y/top (assumed wrist end) from the hand back to
// the shoulder. Pitch, yaw and roll can then independently adopt their component
// from that fully aimed orientation. Disabled axes keep the authored value.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const profiles = global.HobunjiHandModelProfiles;
  if (!hands?.attach || !profiles || hands.attach.__hobunjiShoulderAimWrapped) return;

  const originalAttach = hands.attach.bind(hands);

  function installShoulderAim(THREE, rig, options = {}) {
    const avatarRoot = options.avatarRoot || rig?.avatarRoot || null;
    const sourceCanvas = avatarRoot?.userData?.sourceCanvas || null;
    const scan = sourceCanvas?.hobunjiHandShoulders || null;
    if (!avatarRoot || !scan?.sides) return rig;

    const parent = rig.parent || avatarRoot.parent;
    if (!parent) return rig;

    const modelWidth = Number(avatarRoot.userData?.portraitModelWidth) || Number(options.modelHeight) || 0.9;
    const modelHeight = Number(avatarRoot.userData?.portraitModelHeight) || Number(options.modelHeight) || 0.9;
    const placementRatio = Number(avatarRoot.userData?.portraitVerticalPlacementRatio);
    const assemblyY = ((Number.isFinite(placementRatio) ? placementRatio : 0.5) - 0.5) * modelHeight;
    const canvasWidth = Number(scan.width) || sourceCanvas.width || 1;
    const canvasHeight = Number(scan.height) || sourceCanvas.height || 1;

    const shoulderAvatar = {};
    for (const side of ['left', 'right']) {
      const point = scan.sides?.[side];
      if (!point) continue;
      shoulderAvatar[side] = new THREE.Vector3(
        -modelWidth / 2 + (Number(point.x) || 0) / canvasWidth * modelWidth,
        assemblyY + modelHeight / 2 - (Number(point.y) || 0) / canvasHeight * modelHeight,
        0,
      );
    }
    if (!Object.keys(shoulderAvatar).length) return rig;

    const localTop = new THREE.Vector3(0, 1, 0);
    const shoulderWorld = new THREE.Vector3();
    const shoulderParent = new THREE.Vector3();
    const targetDirection = new THREE.Vector3();
    const currentTop = new THREE.Vector3();
    const deltaQuaternion = new THREE.Quaternion();
    const aimedQuaternion = new THREE.Quaternion();
    const currentEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const aimedEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const outputEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const debugBySide = { left: null, right: null };

    function socketFor(side) {
      return rig.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    }

    function settings() {
      return profiles.shoulderAimForSpecies?.(rig.speciesId)
        || profiles.modelForSpecies?.(rig.speciesId)?.shoulderAim
        || { pitch: false, yaw: false, roll: true };
    }

    function shoulderInParent(side) {
      const source = shoulderAvatar[side];
      if (!source) return null;
      shoulderWorld.copy(source);
      avatarRoot.updateWorldMatrix?.(true, false);
      avatarRoot.localToWorld(shoulderWorld);
      shoulderParent.copy(shoulderWorld);
      parent.updateWorldMatrix?.(true, false);
      parent.worldToLocal(shoulderParent);
      return shoulderParent;
    }

    function aimSide(side) {
      const socket = socketFor(side);
      const shoulder = shoulderInParent(side);
      if (!socket || !shoulder) return false;
      const enabled = settings();
      if (!enabled.pitch && !enabled.yaw && !enabled.roll) {
        debugBySide[side] = { enabled: { ...enabled }, applied: false };
        return false;
      }

      targetDirection.copy(shoulder).sub(socket.position);
      if (targetDirection.lengthSq() < 1e-10) return false;
      targetDirection.normalize();

      // Build the smallest quaternion correction that maps the hand GLB's current
      // local +Y/top direction onto the shoulder direction. This gives one coherent
      // fully-aimed target orientation; selective axis toggles then take only the
      // requested Euler channels from it rather than accumulating corrections.
      currentTop.copy(localTop).applyQuaternion(socket.quaternion).normalize();
      deltaQuaternion.setFromUnitVectors(currentTop, targetDirection);
      aimedQuaternion.copy(deltaQuaternion).multiply(socket.quaternion);

      currentEuler.setFromQuaternion(socket.quaternion, 'YXZ');
      aimedEuler.setFromQuaternion(aimedQuaternion, 'YXZ');
      outputEuler.set(
        enabled.pitch ? aimedEuler.x : currentEuler.x,
        enabled.yaw ? aimedEuler.y : currentEuler.y,
        enabled.roll ? aimedEuler.z : currentEuler.z,
        'YXZ',
      );
      socket.quaternion.setFromEuler(outputEuler);
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);

      debugBySide[side] = {
        enabled: { pitch: !!enabled.pitch, yaw: !!enabled.yaw, roll: !!enabled.roll },
        applied: true,
        shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
        authoredDeg: {
          pitch: THREE.MathUtils.radToDeg(currentEuler.x),
          yaw: THREE.MathUtils.radToDeg(currentEuler.y),
          roll: THREE.MathUtils.radToDeg(currentEuler.z),
        },
        aimedDeg: {
          pitch: THREE.MathUtils.radToDeg(aimedEuler.x),
          yaw: THREE.MathUtils.radToDeg(aimedEuler.y),
          roll: THREE.MathUtils.radToDeg(aimedEuler.z),
        },
        outputDeg: {
          pitch: THREE.MathUtils.radToDeg(outputEuler.x),
          yaw: THREE.MathUtils.radToDeg(outputEuler.y),
          roll: THREE.MathUtils.radToDeg(outputEuler.z),
        },
      };
      return true;
    }

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function shoulderAimPlaceHandWorld(side, worldPosition, worldQuaternion) {
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion);
        if (result) aimSide(side);
        return result;
      };
    }

    const originalSetSideIdle = rig.setSideIdle?.bind(rig);
    if (originalSetSideIdle) {
      rig.setSideIdle = function shoulderAimSetSideIdle(side) {
        const result = originalSetSideIdle(side);
        aimSide(side);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function shoulderAimUseIdlePose() {
        const result = originalUseIdlePose();
        aimSide('left');
        aimSide('right');
        return result;
      };
    }

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function shoulderAimDebug() {
      return {
        ...(originalDebug?.() || {}),
        shoulderCompass: {
          mode: 'hand-only-axis-selective',
          localTopAxis: '+Y',
          sides: debugBySide,
        },
      };
    };

    aimSide('left');
    aimSide('right');
    return rig;
  }

  const wrappedAttach = function shoulderAimAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? installShoulderAim(THREE, rig, options) : rig;
  };
  wrappedAttach.__hobunjiShoulderAimWrapped = true;
  hands.attach = wrappedAttach;

  global.ProceduralHandShoulderAim = Object.freeze({
    mode: 'hand-only-axis-selective',
    localTopAxis: '+Y',
    defaultAxes: Object.freeze({ pitch: false, yaw: false, roll: true }),
  });
})(window);
