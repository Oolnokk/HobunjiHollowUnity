// Resolves portrait shoulder targets and routes them to the separated arm bones.
// Hand socket rotation is never modified here. Normally the forearm points at the
// shoulder. With experimental bicep/elbow tracking enabled, the forearm instead
// points at a pose-authored 3D elbow coordinate and the PNG-plane bicep bone points
// at that same coordinate from its fixed shoulder root.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const scanner = global.PortraitHandShoulderScan;
  const points = global.HobunjiHandShoulderPoints;
  const settings = global.HobunjiHandExperimentalRigSettings;
  const elbowRuntime = global.HobunjiHandElbowPoseRuntime;
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
    const elbowAvatar = new THREE.Vector3();
    const elbowWorld = new THREE.Vector3();
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
      return shoulderWorld;
    }

    function elbowInWorld(side) {
      const normalized = elbowRuntime?.currentNormalized?.(side) || null;
      if (!normalized) return null;
      elbowAvatar.set(
        (Number(normalized.x) || 0) * modelHeight,
        (Number(normalized.y) || 0) * modelHeight,
        (Number(normalized.z) || 0) * modelHeight,
      );
      elbowWorld.copy(elbowAvatar);
      avatarRoot.updateWorldMatrix?.(true, false);
      avatarRoot.localToWorld(elbowWorld);
      return { world: elbowWorld, normalized };
    }

    function aimSide(side) {
      if (disposed) return false;
      const shoulder = shoulderInWorld(side);
      if (!shoulder) {
        debugBySide[side] = { applied: false, reason: shoulderSource[side] || scanState };
        return false;
      }

      const bicepRig = avatarRoot.userData?.bicepRig;
      bicepRig?.setShoulderWorld?.(side, shoulder);
      const useElbow = settings?.bicepElbowTracking === true;
      const elbow = useElbow ? elbowInWorld(side) : null;
      const target = elbow?.world || shoulder;
      const targetKind = elbow ? 'elbow' : 'shoulder';
      const applied = !!rig.aimForearmAtWorld(side, target, { targetKind });

      if (useElbow && elbow && bicepRig?.available) bicepRig.aimAtWorld?.(side, elbow.world);
      else bicepRig?.reset?.(side);

      const handDebug = rig.getDebug?.() || {};
      const skin = handDebug?.twoBoneSkin?.sides?.[side] || null;
      const bicep = bicepRig?.getDebug?.()?.sides?.[side] || null;
      debugBySide[side] = {
        applied,
        source: shoulderSource[side],
        targetKind,
        shoulderWorld: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
        elbowNormalized: elbow?.normalized ? { ...elbow.normalized } : null,
        elbowWorld: elbow ? { x: elbow.world.x, y: elbow.world.y, z: elbow.world.z } : null,
        residualDeg: skin?.residualDeg ?? null,
        axisWeights: skin?.axisWeights || null,
        fullAimDeg: skin?.fullAimDeg || null,
        appliedAimDeg: skin?.appliedAimDeg || null,
        jointYPercent: skin?.jointYPercent ?? null,
        blendWidthPercent: skin?.blendWidthPercent ?? null,
        crossBoneWeight: skin?.crossBoneWeight ?? null,
        bicepResidualDeg: bicep?.residualDeg ?? null,
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
    const unsubscribeSettings = settings?.subscribe?.(() => aimAll());

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
      unsubscribeSettings?.();
      return originalDispose?.();
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function forearmAimDebug() {
      return {
        ...(originalDebug?.() || {}),
        shoulderCompass: {
          mode: settings?.bicepElbowTracking ? 'forearm-and-bicep-to-elbow' : 'forearm-to-shoulder',
          handSocketRotationUntouched: true,
          forearmAxisTrackingExperimental: settings?.forearmAxisTracking === true,
          localBasis: { positiveY: 'wrist', positiveZ: 'palm', positiveX: 'thumb' },
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
    mode: 'separated-forearm-bicep-targeting',
    handSocketRotationUntouched: true,
    localBasis: Object.freeze({ positiveY: 'wrist', positiveZ: 'palm', positiveX: 'thumb' }),
  });
})(window);
