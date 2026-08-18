// Hand-only shoulder compass. The painted arms remain untouched.
//
// Shoulder targets are scanned asynchronously from the raw arm PNGs *after* normal
// avatar construction. A failed or delayed scan therefore cannot break portrait or
// avatar rebuilding. Local +Y/top is treated as the wrist end. Pitch, yaw and roll
// independently adopt components from the fully shoulder-pointing orientation.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const profiles = global.HobunjiHandModelProfiles;
  const shoulderScanner = global.PortraitHandShoulderScan;
  if (!hands?.attach || !profiles || hands.attach.__hobunjiShoulderAimWrapped) return;

  const originalAttach = hands.attach.bind(hands);

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
    let scanState = shoulderScanner?.scanProfile ? 'pending' : 'unavailable';
    let scanError = null;
    let disposed = false;

    function socketFor(side) {
      return rig.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    }

    function settings() {
      return profiles.shoulderAimForSpecies?.(rig.speciesId)
        || profiles.modelForSpecies?.(rig.speciesId)?.shoulderAim
        || { pitch: false, yaw: false, roll: true };
    }

    function installScan(scan) {
      for (const key of Object.keys(shoulderAvatar)) delete shoulderAvatar[key];
      if (!scan?.sides) {
        scanState = 'no-shoulders';
        return;
      }
      const canvasWidth = Math.max(1, Number(scan.width) || Number(sourceCanvas?.width) || 256);
      const canvasHeight = Math.max(1, Number(scan.height) || Number(sourceCanvas?.height) || 256);
      for (const side of ['left', 'right']) {
        const point = scan.sides?.[side];
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue;
        shoulderAvatar[side] = new THREE.Vector3(
          -modelWidth / 2 + Number(point.x) / canvasWidth * modelWidth,
          assemblyY + modelHeight / 2 - Number(point.y) / canvasHeight * modelHeight,
          0,
        );
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

    function aimSide(side) {
      if (disposed) return false;
      const socket = socketFor(side);
      const shoulder = shoulderInParent(side);
      if (!socket || !shoulder) {
        debugBySide[side] = { enabled: { ...settings() }, applied: false, reason: scanState };
        return false;
      }

      const enabled = settings();
      if (!enabled.pitch && !enabled.yaw && !enabled.roll) {
        debugBySide[side] = { enabled: { ...enabled }, applied: false, reason: 'all-axes-off' };
        return false;
      }

      targetDirection.copy(shoulder).sub(socket.position);
      if (targetDirection.lengthSq() < 1e-10) {
        debugBySide[side] = { enabled: { ...enabled }, applied: false, reason: 'hand-at-shoulder' };
        return false;
      }
      targetDirection.normalize();

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

    function aimAll() {
      aimSide('left');
      aimSide('right');
    }

    if (shoulderScanner?.scanProfile && options.profile) {
      const scanWidth = Number(sourceCanvas?.width) || 256;
      const scanHeight = Number(sourceCanvas?.height) || 256;
      Promise.resolve(shoulderScanner.scanProfile(options.profile, scanWidth, scanHeight))
        .then(scan => {
          if (disposed) return;
          installScan(scan);
          aimAll();
          global.ProceduralHandFrameDriver?.syncNow?.();
        })
        .catch(error => {
          if (disposed) return;
          scanState = 'error';
          scanError = error?.message || String(error);
          console.warn('[hand-shoulder-aim] shoulder scan skipped:', error);
        });
    } else if (!options.profile) {
      scanState = 'no-profile';
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
        aimAll();
        return result;
      };
    }

    const originalDispose = rig.dispose?.bind(rig);
    rig.dispose = function shoulderAimDispose() {
      disposed = true;
      return originalDispose?.();
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function shoulderAimDebug() {
      return {
        ...(originalDebug?.() || {}),
        shoulderCompass: {
          mode: 'hand-only-axis-selective',
          localTopAxis: '+Y',
          scanState,
          scanError,
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
    mode: 'hand-only-axis-selective',
    localTopAxis: '+Y',
    defaultAxes: Object.freeze({ pitch: false, yaw: false, roll: true }),
  });
})(window);
