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
    const deltaEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const weightedDeltaEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const debugEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const debugBySide = { left: null, right: null };
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

    function aimSide(side) {
      if (disposed) return false;
      const socket = socketFor(side);
      const shoulder = shoulderInParent(side);
      const weights = weightsFor(side);
      if (!socket || !shoulder) {
        debugBySide[side] = { weights, applied: false, reason: shoulderSource[side] || scanState };
        return false;
      }
      if (weights.pitch <= 0 && weights.yaw <= 0 && weights.roll <= 0) {
        debugBySide[side] = { weights, applied: false, reason: 'all-axis-weights-zero' };
        return false;
      }

      targetDirection.copy(shoulder).sub(socket.position);
      if (targetDirection.lengthSq() < 1e-10) {
        debugBySide[side] = { weights, applied: false, reason: 'hand-at-shoulder' };
        return false;
      }
      targetDirection.normalize();

      // Shoulder aim is a CORRECTION from the authored hand frame, not a new
      // absolute Euler orientation. Decomposing the authored 90-degree-pitch hand
      // into absolute YXZ Euler values hits a gimbal singularity and makes a
      // roll-only or pitch-only correction rewrite unrelated axes. Instead derive
      // the shortest parent-space correction, weight only that small delta, then
      // pre-multiply it onto the untouched authored quaternion.
      authoredQuaternion.copy(socket.quaternion).normalize();
      currentTop.copy(localTop).applyQuaternion(authoredQuaternion).normalize();
      deltaQuaternion.setFromUnitVectors(currentTop, targetDirection).normalize();
      deltaEuler.setFromQuaternion(deltaQuaternion, 'YXZ');
      weightedDeltaEuler.set(
        deltaEuler.x * weights.pitch,
        deltaEuler.y * weights.yaw,
        deltaEuler.z * weights.roll,
        'YXZ',
      );
      weightedDeltaQuaternion.setFromEuler(weightedDeltaEuler).normalize();
      outputQuaternion.copy(weightedDeltaQuaternion).multiply(authoredQuaternion).normalize();
      socket.quaternion.copy(outputQuaternion);
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);

      debugBySide[side] = {
        weights: { ...weights },
        applied: true,
        source: shoulderSource[side],
        shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
        authoredQuaternion: quaternionDebug(authoredQuaternion),
        authoredDeg: eulerDebug(authoredQuaternion),
        correctionDeg: {
          pitch: THREE.MathUtils.radToDeg(deltaEuler.x),
          yaw: THREE.MathUtils.radToDeg(deltaEuler.y),
          roll: THREE.MathUtils.radToDeg(deltaEuler.z),
        },
        appliedCorrectionDeg: {
          pitch: THREE.MathUtils.radToDeg(weightedDeltaEuler.x),
          yaw: THREE.MathUtils.radToDeg(weightedDeltaEuler.y),
          roll: THREE.MathUtils.radToDeg(weightedDeltaEuler.z),
        },
        outputQuaternion: quaternionDebug(outputQuaternion),
        outputDeg: eulerDebug(outputQuaternion),
      };
      return true;
    }

    function aimAll() {
      aimSide('left');
      aimSide('right');
    }

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
          mode: 'weighted-relative-quaternion-delta',
          localTopAxis: '+Y',
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
    mode: 'weighted-relative-quaternion-delta',
    localTopAxis: '+Y',
    idleWeights: Object.freeze({ pitch: 1, yaw: 0, roll: 1 }),
    activeWeights: Object.freeze({ pitch: 0, yaw: 0, roll: 1 }),
  });
})(window);
