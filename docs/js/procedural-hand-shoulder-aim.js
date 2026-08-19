// Forearm-only shoulder tracking.
//
// Shoulder targets come from manually authored 200x200 portrait points when present;
// a side at 0,0 falls back to portrait-hand-shoulder-scan.js. This module NEVER
// rotates the hand socket. Grip direction belongs entirely to the hand/tool frame;
// only the child forearm bone receives shoulder-target rotation. Which raw GLB axis
// points toward the wrist is resolved by the semantic hand basis in two-bone skin.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const scanner = global.PortraitHandShoulderScan;
  const points = global.HobunjiHandShoulderPoints;
  const settings = global.HobunjiHandExperimentalRigSettings;
  if (!hands?.attach || hands.attach.__hobunjiShoulderAimWrapped) return;

  const originalAttach = hands.attach.bind(hands);

  function installShoulderAim(THREE, rig, options = {}) {
    const avatarRoot = options.avatarRoot || rig?.avatarRoot || null;
    if (!avatarRoot || !rig?.aimForearmAtWorld) return rig;

    const modelWidth = Number(avatarRoot.userData?.portraitModelWidth) || Number(options.modelHeight) || 0.9;
    const modelHeight = Number(avatarRoot.userData?.portraitModelHeight) || Number(options.modelHeight) || 0.9;
    const placementRatio = Number(avatarRoot.userData?.portraitVerticalPlacementRatio);
    const assemblyY = ((Number.isFinite(placementRatio) ? placementRatio : 0.5) - 0.5) * modelHeight;
    const sourceCanvas = options.sourceCanvas || avatarRoot.userData?.sourceCanvas || null;

    const shoulderAvatar = {};
    const shoulderSource = { left: 'pending', right: 'pending' };
    const shoulderWorld = new THREE.Vector3();
    const rawFacingShoulderLocal = new THREE.Vector3(); // Reused when removing the portrait-only dead-zone yaw from shoulder coordinates.
    const rawFacingYawQuaternion = new THREE.Quaternion(); // Reused Y-only anatomical counter-rotation copied from the hand root.
    const debugBySide = { left: null, right: null };
    let scanState = scanner?.scanProfile || scanner?.scanSpecies ? 'pending' : 'unavailable';
    let scanError = null;
    let disposed = false;

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

    function shoulderInWorld(side) {
      const source = shoulderAvatar[side];
      if (!source) return null;
      shoulderWorld.copy(source);
      avatarRoot.updateWorldMatrix?.(true, false);
      avatarRoot.localToWorld(shoulderWorld);

      // avatarRoot is the 2D billboard and therefore includes perpClamp's camera-
      // relative snap. The hand/leg anatomy deliberately does not. If the hand
      // root is a sibling under the same body parent, rotate the shoulder point by
      // that root's already-resolved Y counter-rotation before aiming the forearm.
      // This uses the same authority as the hands themselves instead of duplicating
      // dead-zone math or deriving a second camera-dependent solution here.
      const bodyParent = avatarRoot.parent;
      const handRoot = rig.group;
      const counterYaw = Number(handRoot?.rotation?.y) || 0;
      if (bodyParent?.isObject3D && handRoot?.parent === bodyParent && Math.abs(counterYaw) > 1e-9) {
        bodyParent.updateWorldMatrix?.(true, false);
        rawFacingShoulderLocal.copy(shoulderWorld);
        bodyParent.worldToLocal(rawFacingShoulderLocal);
        rawFacingYawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), counterYaw);
        rawFacingShoulderLocal.applyQuaternion(rawFacingYawQuaternion);
        shoulderWorld.copy(rawFacingShoulderLocal);
        bodyParent.localToWorld(shoulderWorld);
      }
      return shoulderWorld;
    }

    function aimSide(side) {
      if (disposed) return false;
      const target = shoulderInWorld(side);
      if (!target) {
        debugBySide[side] = { applied: false, reason: shoulderSource[side] || scanState };
        return false;
      }
      const applied = !!rig.aimForearmAtWorld(side, target, { targetKind: 'shoulder' });
      const skin = rig.getDebug?.()?.twoBoneSkin?.sides?.[side] || null;
      debugBySide[side] = {
        applied,
        source: shoulderSource[side],
        targetKind: 'shoulder',
        shoulderWorld: { x: target.x, y: target.y, z: target.z },
        wristAxis: skin?.wristAxis || null,
        wristAxisLabel: skin?.wristAxisLabel || null,
        residualDeg: skin?.residualDeg ?? null,
        axisWeights: skin?.axisWeights || null,
        fullAimDeg: skin?.fullAimDeg || null,
        appliedAimDeg: skin?.appliedAimDeg || null,
        jointYPercent: skin?.jointYPercent ?? null,
        blendWidthPercent: skin?.blendWidthPercent ?? null,
        crossBoneWeight: skin?.crossBoneWeight ?? null,
        reason: applied ? null : (skin?.rigged === false ? 'forearm-rig-pending' : null),
      };
      return applied;
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
    });

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function forearmAimPlaceHandWorld(side, worldPosition, worldQuaternion) {
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion);
        if (result) aimSide(side);
        return result;
      };
    }

    const originalSetSideIdle = rig.setSideIdle?.bind(rig);
    if (originalSetSideIdle) {
      rig.setSideIdle = function forearmAimSetSideIdle(side) {
        const result = originalSetSideIdle(side);
        aimSide(side);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function forearmAimUseIdlePose() {
        const result = originalUseIdlePose();
        aimAll();
        return result;
      };
    }

    const originalDispose = rig.dispose?.bind(rig);
    rig.dispose = function forearmAimDispose() {
      disposed = true;
      unsubscribePoints?.();
      return originalDispose?.();
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function forearmAimDebug() {
      const twoBone = originalDebug?.()?.twoBoneSkin || null;
      return {
        ...(originalDebug?.() || {}),
        shoulderCompass: {
          mode: 'forearm-bone-shoulder-per-axis',
          handSocketRotationUntouched: true,
          shoulderFacingBasis: 'procedural-hand-raw-facing',
          forearmAxisTrackingExperimental: settings?.forearmAxisTracking !== false,
          localBasis: twoBone?.localBasis || { wrist: '+Y', source: 'legacy' },
          scanState,
          scanError,
          shoulderSource: { ...shoulderSource },
          sides: debugBySide,
        },
      };
    };

    requestAnimationFrame(aimAll);
    return rig;
  }

  const wrappedAttach = function shoulderAimAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? installShoulderAim(THREE, rig, options) : rig;
  };
  wrappedAttach.__hobunjiShoulderAimWrapped = true;
  hands.attach = wrappedAttach;

  global.ProceduralHandShoulderAim = Object.freeze({
    mode: 'forearm-bone-shoulder-per-axis',
    handSocketRotationUntouched: true,
    shoulderFacingBasis: 'procedural-hand-raw-facing',
    localBasis: Object.freeze({ source: 'semantic-hand-basis', legacyWrist: '+Y' }),
  });
})(window);