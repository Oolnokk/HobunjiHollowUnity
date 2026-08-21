// Hand-only shoulder compass. Painted arm sprites remain untouched.
//
// Shoulder targets come from manually authored 200x200 portrait points when present;
// a side at 0,0 falls back to portrait-hand-shoulder-scan.js. The hand's local +Y
// is treated as the wrist/top direction. Pitch/yaw/roll use independent 0..1 weights
// supplied by hand-shoulder-pose-runtime.js, so checkbox changes between animation
// poses blend smoothly instead of snapping.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const scanner = global.PortraitHandShoulderScan;
  const points = global.HobunjiHandShoulderPoints;
  const poseRuntime = global.HobunjiHandShoulderPoseRuntime;
  if (!hands?.attach || hands.attach.__hobunjiShoulderAimWrapped) return;

  const originalAttach = hands.attach.bind(hands);

  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
  function clampUnit(value) { return Math.max(-1, Math.min(1, Number(value) || 0)); }

  function installShoulderAim(THREE, rig, options = {}) {
    const avatarRoot = options.avatarRoot || rig?.avatarRoot || null;
    const parent = rig?.parent || avatarRoot?.parent || null;
    if (!avatarRoot || !parent) return rig;

    const modelWidth = Number(avatarRoot.userData?.portraitModelWidth) || Number(options.modelHeight) || 0.9;
    const modelHeight = Number(avatarRoot.userData?.portraitModelHeight) || Number(options.modelHeight) || 0.9;
    const placementRatio = Number(avatarRoot.userData?.portraitVerticalPlacementRatio);
    const assemblyY = ((Number.isFinite(placementRatio) ? placementRatio : 0.5) - 0.5) * modelHeight;
    const sourceCanvas = options.sourceCanvas || avatarRoot.userData?.sourceCanvas || null;

    const shoulderAvatar = {};
    const shoulderSource = { left: 'pending', right: 'pending' };
    const localTop = new THREE.Vector3(0, 1, 0);
    const shoulderWorld = new THREE.Vector3();
    const shoulderParent = new THREE.Vector3();
    const targetDirection = new THREE.Vector3();
    const currentTop = new THREE.Vector3();
    const deltaQuaternion = new THREE.Quaternion();
    const weightedDeltaQuaternion = new THREE.Quaternion();
    const authoredQuaternion = new THREE.Quaternion();
    const outputQuaternion = new THREE.Quaternion();
    const rotationVector = new THREE.Vector3();
    const weightedRotationVector = new THREE.Vector3();
    const rotationAxis = new THREE.Vector3();
    const debugEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const debugBySide = { left: null, right: null };
    const authoredBaseBySide = {
      left: new THREE.Quaternion(),
      right: new THREE.Quaternion(),
    }; // Stores the un-aimed frame so async scans/control changes can never re-aim an already corrected hand.
    const authoredBaseValid = { left: false, right: false }; // Tracks whether each side has received a raw tool/idle frame yet.
    let scanState = scanner?.scanProfile || scanner?.scanSpecies ? 'pending' : 'unavailable';
    let scanError = null;
    let disposed = false;

    function socketFor(side) {
      return rig.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    }

    function weightsFor(side) {
      const weights = poseRuntime?.currentWeights?.(side) || { pitch: 1, yaw: 0, roll: 1 };
      return { pitch: clamp01(weights.pitch), yaw: clamp01(weights.yaw), roll: clamp01(weights.roll) };
    }

    function portraitPixelToAvatar(x, y, sourceWidth = 200, sourceHeight = 200) {
      return new THREE.Vector3(
        -modelWidth / 2 + (Number(x) || 0) / Math.max(1, sourceWidth) * modelWidth,
        assemblyY + modelHeight / 2 - (Number(y) || 0) / Math.max(1, sourceHeight) * modelHeight,
        0,
      );
    }

    function installManualPoints() {
      let needsFallback = false;
      for (const side of ['left', 'right']) {
        const point = points?.pointFor?.(rig.speciesId, rig.gender, side) || { x: 0, y: 0 };
        if (points?.isAuthored?.(point)) {
          shoulderAvatar[side] = portraitPixelToAvatar(point.x, point.y, 200, 200);
          shoulderSource[side] = 'manual-portrait-200px';
        } else {
          delete shoulderAvatar[side];
          shoulderSource[side] = 'fallback-pending';
          needsFallback = true;
        }
      }
      return needsFallback;
    }

    function installFallbackScan(scan) {
      const canvasWidth = Math.max(1, Number(scan?.width) || Number(sourceCanvas?.width) || 256);
      const canvasHeight = Math.max(1, Number(scan?.height) || Number(sourceCanvas?.height) || 256);
      for (const side of ['left', 'right']) {
        if (shoulderSource[side] === 'manual-portrait-200px') continue;
        const point = scan?.sides?.[side];
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
          shoulderSource[side] = 'fallback-missing';
          continue;
        }
        shoulderAvatar[side] = portraitPixelToAvatar(point.x, point.y, canvasWidth, canvasHeight);
        shoulderSource[side] = point.detection || 'fallback-main-mass-top-third';
      }
      scanState = Object.keys(shoulderAvatar).length ? 'ready' : 'no-shoulders';
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

    function quaternionDebug(q) {
      return {
        x: Number(q.x.toFixed(5)),
        y: Number(q.y.toFixed(5)),
        z: Number(q.z.toFixed(5)),
        w: Number(q.w.toFixed(5)),
      };
    }

    function eulerDebug(q) {
      debugEuler.setFromQuaternion(q, 'YXZ');
      return {
        pitch: THREE.MathUtils.radToDeg(debugEuler.x),
        yaw: THREE.MathUtils.radToDeg(debugEuler.y),
        roll: THREE.MathUtils.radToDeg(debugEuler.z),
      };
    }

    function captureAuthoredBase(side) {
      const socket = socketFor(side);
      if (!socket) return false;
      authoredBaseBySide[side].copy(socket.quaternion).normalize();
      authoredBaseValid[side] = true;
      return true;
    }

    function copyAuthoredBase(side, target) {
      if (!authoredBaseValid[side] && !captureAuthoredBase(side)) return false;
      target.copy(authoredBaseBySide[side]).normalize();
      return true;
    }

    // Convert a shortest parent-space quaternion correction into its rotation-vector
    // (quaternion logarithm) form. Unlike Euler decomposition, this has no gimbal
    // singularity and its X/Y/Z components are stable parent-space correction axes.
    function quaternionToRotationVector(q, target) {
      let x = Number(q.x) || 0;
      let y = Number(q.y) || 0;
      let z = Number(q.z) || 0;
      let w = Number.isFinite(Number(q.w)) ? Number(q.w) : 1;
      const length = Math.hypot(x, y, z, w) || 1;
      x /= length; y /= length; z /= length; w /= length;
      // q and -q are the same orientation. Keep the representation on the shortest
      // hemisphere so interpolation cannot jump by almost a full turn.
      if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
      const angle = 2 * Math.acos(clampUnit(w));
      const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
      if (sinHalf < 1e-7 || angle < 1e-7) {
        target.set(x * 2, y * 2, z * 2);
      } else {
        target.set(x / sinHalf, y / sinHalf, z / sinHalf).multiplyScalar(angle);
      }
      return target;
    }

    function quaternionFromRotationVector(vector, target) {
      const angle = vector.length();
      if (angle < 1e-8) return target.identity();
      rotationAxis.copy(vector).multiplyScalar(1 / angle);
      return target.setFromAxisAngle(rotationAxis, angle).normalize();
    }

    function aimSide(side) {
      if (disposed) return false;
      const socket = socketFor(side);
      const shoulder = shoulderInParent(side);
      const weights = weightsFor(side);
      if (!socket || !shoulder) {
        debugBySide[side] = { weights, applied: false, reason: shoulderSource[side] || scanState };
        return false;
      }
      if (!copyAuthoredBase(side, authoredQuaternion)) {
        debugBySide[side] = { weights, applied: false, reason: 'authored-base-missing' };
        return false;
      }
      if (weights.pitch <= 0 && weights.yaw <= 0 && weights.roll <= 0) {
        socket.quaternion.copy(authoredQuaternion);
        socket.updateMatrix?.();
        socket.updateMatrixWorld?.(true);
        debugBySide[side] = { weights, applied: false, reason: 'all-axis-weights-zero' };
        return false;
      }

      targetDirection.copy(shoulder).sub(socket.position);
      if (targetDirection.lengthSq() < 1e-10) {
        socket.quaternion.copy(authoredQuaternion);
        socket.updateMatrix?.();
        socket.updateMatrixWorld?.(true);
        debugBySide[side] = { weights, applied: false, reason: 'hand-at-shoulder' };
        return false;
      }
      targetDirection.normalize();

      // Always solve from the raw authored frame. This makes the compass idempotent:
      // a fallback scan resolving, a checkbox changing, or a profile notification can
      // call aimAll repeatedly without applying the previous shoulder correction again.
      currentTop.copy(localTop).applyQuaternion(authoredQuaternion).normalize();
      deltaQuaternion.setFromUnitVectors(currentTop, targetDirection).normalize();

      // A single target vector defines swing but not twist. The old implementation
      // decomposed this delta into YXZ Euler angles, which made the selected axis
      // components change at/near 90-degree base rotations. Weight the quaternion's
      // rotation-vector components instead: X=Pitch, Y=Yaw, Z=Roll in parent space.
      // With all weights at 1 this reconstructs the exact shortest correction; with
      // partial/per-pose weights it remains continuous and free of Euler singularities.
      quaternionToRotationVector(deltaQuaternion, rotationVector);
      weightedRotationVector.set(
        rotationVector.x * weights.pitch,
        rotationVector.y * weights.yaw,
        rotationVector.z * weights.roll,
      );
      quaternionFromRotationVector(weightedRotationVector, weightedDeltaQuaternion);
      outputQuaternion.copy(weightedDeltaQuaternion).multiply(authoredQuaternion).normalize();
      socket.quaternion.copy(outputQuaternion);
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);

      const aimedTop = localTop.clone().applyQuaternion(outputQuaternion).normalize();
      const residualRad = Math.acos(clampUnit(aimedTop.dot(targetDirection)));
      const toDeg = THREE.MathUtils.radToDeg;
      debugBySide[side] = {
        weights: { ...weights },
        applied: true,
        source: shoulderSource[side],
        shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
        authoredQuaternion: quaternionDebug(authoredQuaternion),
        authoredDeg: eulerDebug(authoredQuaternion),
        correctionRotationVectorDeg: {
          pitch: toDeg(rotationVector.x),
          yaw: toDeg(rotationVector.y),
          roll: toDeg(rotationVector.z),
        },
        appliedRotationVectorDeg: {
          pitch: toDeg(weightedRotationVector.x),
          yaw: toDeg(weightedRotationVector.y),
          roll: toDeg(weightedRotationVector.z),
        },
        residualDeg: toDeg(residualRad),
        outputQuaternion: quaternionDebug(outputQuaternion),
        outputDeg: eulerDebug(outputQuaternion),
      };
      return true;
    }

    function aimAll() {
      aimSide('left');
      aimSide('right');
    }

    // The attachment module creates both sockets in their raw idle frames before
    // this wrapper is installed. Capture those once so an early async scan also has
    // a clean base instead of treating a previously aimed quaternion as authored.
    captureAuthoredBase('left');
    captureAuthoredBase('right');

    const needsFallback = installManualPoints();
    if (!needsFallback) {
      scanState = 'manual';
    } else if (scanner?.scanProfile || scanner?.scanSpecies) {
      const scanWidth = Number(sourceCanvas?.width) || 256;
      const scanHeight = Number(sourceCanvas?.height) || 256;
      const scanPromise = options.profile && scanner.scanProfile
        ? scanner.scanProfile(options.profile, scanWidth, scanHeight)
        : scanner.scanSpecies?.(rig.speciesId, rig.gender, scanWidth, scanHeight);
      Promise.resolve(scanPromise)
        .then(scan => {
          if (disposed) return;
          installFallbackScan(scan);
          aimAll();
          global.ProceduralHandFrameDriver?.syncNow?.();
        })
        .catch(error => {
          if (disposed) return;
          scanState = 'error';
          scanError = error?.message || String(error);
          console.warn('[hand-shoulder-aim] shoulder fallback scan skipped:', error);
        });
    }

    const unsubscribePoints = points?.subscribe?.(() => {
      if (disposed) return;
      const fallback = installManualPoints();
      scanState = fallback ? 'pending' : 'manual';
      if (!fallback) aimAll();
      // A newly reset 0,0 point is resolved on the next avatar rebuild; this avoids
      // repeating expensive alpha-component scans while dragging numeric fields.
    });

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function shoulderAimPlaceHandWorld(side, worldPosition, worldQuaternion) {
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion);
        if (result) {
          captureAuthoredBase(side);
          aimSide(side);
        }
        return result;
      };
    }

    const originalSetSideIdle = rig.setSideIdle?.bind(rig);
    if (originalSetSideIdle) {
      rig.setSideIdle = function shoulderAimSetSideIdle(side, fallbackPose = null) {
        const result = originalSetSideIdle(side, fallbackPose);
        captureAuthoredBase(side);
        aimSide(side);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function shoulderAimUseIdlePose(fallbackPoses = null) {
        const result = originalUseIdlePose(fallbackPoses);
        captureAuthoredBase('left');
        captureAuthoredBase('right');
        aimAll();
        return result;
      };
    }

    const originalDispose = rig.dispose?.bind(rig);
    rig.dispose = function shoulderAimDispose() {
      disposed = true;
      unsubscribePoints?.();
      return originalDispose?.();
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function shoulderAimDebug() {
      return {
        ...(originalDebug?.() || {}),
        shoulderCompass: {
          mode: 'idempotent-rotation-vector-components',
          localTopAxis: '+Y',
          componentSpace: 'parent',
          scanState,
          scanError,
          shoulderSource: { ...shoulderSource },
          sides: debugBySide,
        },
      };
    };

    return rig;
  }

  const wrappedAttach = function shoulderAimAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? installShoulderAim(THREE, rig, options) : rig;
  };
  wrappedAttach.__hobunjiShoulderAimWrapped = true;
  hands.attach = wrappedAttach;

  global.ProceduralHandShoulderAim = Object.freeze({
    mode: 'idempotent-rotation-vector-components',
    componentSpace: 'parent',
    localTopAxis: '+Y',
    idleWeights: Object.freeze({ pitch: 1, yaw: 0, roll: 1 }),
    activeWeights: Object.freeze({ pitch: 0, yaw: 0, roll: 1 }),
  });
})(window);
