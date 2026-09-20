// Hand-only proximal arm targeting. Painted arm sprites remain untouched.
//
// Shoulder targets come from attachment-rig profiles when present. Legacy manually
// authored 200x200 points and portrait-hand-shoulder-scan.js remain fallbacks.
// The hand socket/origin IS the wrist. The authored hand GLBs point fingers local -Y,
// so the wrist/proximal side is local +Y. That axis targets the pose-authored elbow.
// The correction
// may rotate only around two HAND-LOCAL hinges:
// local X (grip axis) and local Z (palm-normal axis). There is deliberately no local-Y
// shoulder hinge. Per-pose weights come from hand-shoulder-pose-runtime.js.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  const scanner = global.PortraitHandShoulderScan;
  const points = global.HobunjiHandShoulderPoints;
  const poseRuntime = global.HobunjiHandShoulderPoseRuntime;
  if (!hands?.attach || hands.attach.__hobunjiShoulderAimWrapped) return;

  const originalAttach = hands.attach.bind(hands);
  const activeGuideControllers = new Set(); // Lets the Attack Editor toggle paper-arm guides on already-created hand rigs.
  let paperArmGuideVisible = false; // Editor-only x-ray guide state; gameplay leaves this false.

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
    const localWristProximalAxis = new THREE.Vector3(0, 1, 0); // Real GLB convention: fingers are local -Y, so +Y points from wrist back up the forearm.
    const localGripAxis = new THREE.Vector3(1, 0, 0); // Across the grasp; first allowed proximal-target hinge.
    const localPalmNormalAxis = new THREE.Vector3(0, 0, -1); // Authored source palms face away from camera, so the directed palm normal is local -Z.
    const shoulderWorld = new THREE.Vector3();
    const shoulderParent = new THREE.Vector3();
    const targetDirection = new THREE.Vector3();
    const localTargetDirection = new THREE.Vector3();
    const aimedWristAxis = new THREE.Vector3();
    const inverseAuthoredQuaternion = new THREE.Quaternion();
    const gripCorrectionQuaternion = new THREE.Quaternion();
    const palmNormalCorrectionQuaternion = new THREE.Quaternion();
    const localCorrectionQuaternion = new THREE.Quaternion();
    const authoredQuaternion = new THREE.Quaternion();
    const outputQuaternion = new THREE.Quaternion();
    const guideSpan = new THREE.Vector3(); // Reused by the optional paper-arm preview.
    const guideBend = new THREE.Vector3(); // Reused elbow bend direction for the optional paper-arm preview.
    const guideMidpoint = new THREE.Vector3(); // Reused midpoint between shoulder and wrist for the paper-arm preview.
    const guideElbow = new THREE.Vector3(); // Reused computed elbow position for the paper-arm preview.
    const guideDirection = new THREE.Vector3(); // Reused segment direction when orienting paper strips.
    const guideLocalY = new THREE.Vector3(0, 1, 0); // Plane-strip length axis used by the paper-arm preview.
    const debugEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const debugBySide = { left: null, right: null };
    const authoredBaseBySide = {
      left: new THREE.Quaternion(),
      right: new THREE.Quaternion(),
    }; // Stores the un-aimed frame so async scans/control changes can never re-aim an already corrected hand.
    const authoredBaseValid = { left: false, right: false }; // Tracks whether each side has received a raw tool/idle frame yet.
    const freeSide = { left: true, right: true }; // Prevents shoulder-coordinate edits from translating a hand currently owned by a tool animation.
    const paperArmBySide = { left: null, right: null }; // Lazily-created non-authoritative two-strip arm guides for editor inspection.
    let scanState = scanner?.scanProfile || scanner?.scanSpecies ? 'pending' : 'unavailable';
    let scanError = null;
    let disposed = false;

    function socketFor(side) {
      return rig.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    }

    function weightsFor(side) {
      const weights = poseRuntime?.currentWeights?.(side) || { grip: 1, palmNormal: 1 };
      return { grip: clamp01(weights.grip), palmNormal: clamp01(weights.palmNormal) };
    }

    function portraitPixelToAvatar(x, y, sourceWidth = 200, sourceHeight = 200) {
      return new THREE.Vector3(
        -modelWidth / 2 + (Number(x) || 0) / Math.max(1, sourceWidth) * modelWidth,
        assemblyY + modelHeight / 2 - (Number(y) || 0) / Math.max(1, sourceHeight) * modelHeight,
        0,
      );
    }

    function attachmentRigProfile() {
      const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Supplies the same species/gender shoulder anchors edited by Animation Author's rig gizmo.
      return characters[`${rig.speciesId}::${rig.gender}`] || null;
    }

    function profileShoulderInParent(side) {
      const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder';
      const position = attachmentRigProfile()?.anchors?.[anchorName]?.position; // Reads live so dragging the author gizmo updates the rendered idle hand immediately.
      if (![position?.x, position?.y, position?.z].every(value => Number.isFinite(Number(value)))) return null;
      shoulderSource[side] = 'attachment-rig-profile';
      return new THREE.Vector3(Number(position.x), Number(position.y), Number(position.z));
    }

    function installManualPoints() {
      let needsFallback = false;
      for (const side of ['left', 'right']) {
        if (profileShoulderInParent(side)) continue;
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
      const profileShoulder = profileShoulderInParent(side); // Attachment-rig coordinates already share the floor-relative hand-parent space.
      if (profileShoulder) return shoulderParent.copy(profileShoulder);
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

    function posteriorYInParent() {
      const resolvedY = Number(attachmentRigProfile()?.resolvedPosteriorPosition?.y); // Animation Author publishes the exact live posterior gizmo coordinate here.
      if (Number.isFinite(resolvedY)) return resolvedY;
      const posteriorRule = attachmentRigProfile()?.posteriorRule;
      const handAttachY = Number(avatarRoot.userData?.handAttachY ?? options.handAttachY);
      const sharedY = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY(posteriorRule, modelHeight, handAttachY);
      if (Number.isFinite(sharedY)) return sharedY;
      const profileOffset = Number(posteriorRule?.heightPercentOffset);
      return (Number.isFinite(handAttachY) ? handAttachY : modelHeight / 2)
        + modelHeight * (Number.isFinite(profileOffset) ? profileOffset : -18) / 100;
    }

    function armLengthOffsetY() {
      const authored = Number(attachmentRigProfile()?.anatomy?.armLengthHeightPercentOffset); // Positive profile values lengthen a free arm by pushing its hand below the posterior.
      return Number.isFinite(authored) ? -modelHeight * authored / 100 : 0;
    }

    function alignFreeHandToFallbackAnchor(side, fallbackPose = null) {
      const socket = socketFor(side); // Free-hand socket whose idle position follows shoulder X and posterior Y.
      const shoulder = shoulderInParent(side); // Resolved rig/manual/scanned shoulder point in the socket parent's local space.
      if (!socket || !shoulder) return false;
      socket.position.x = shoulder.x;
      socket.position.y = posteriorYInParent() + armLengthOffsetY() + (Number(fallbackPose?.position?.y) || 0);
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      return true;
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

    function armGuideLength(side) {
      const sideReach = Number(avatarRoot.userData?.armLengthBySide?.[side]); // Preferred rigger-derived shoulder-to-resting-wrist reach for this arm.
      if (Number.isFinite(sideReach) && sideReach > 0) return sideReach;
      const rendered = Number(avatarRoot.userData?.scaledArmLength); // Already concrete avatar-local reach; do not model-height-scale it again.
      if (Number.isFinite(rendered) && rendered > 0) return rendered;
      const authored = Number(avatarRoot.userData?.armLength);
      return Number.isFinite(authored) && authored > 0 ? authored : modelHeight * 0.42;
    }

    function resolveElbowInParent(side, shoulder, target = guideElbow) {
      const socket = socketFor(side);
      if (!socket || !shoulder) return null;
      const authoredOffset = poseRuntime?.currentElbow?.(side) || null; // Direct pose data: shoulder-relative elbow offset in the same local space as shoulder/wrist.
      if (authoredOffset) {
        target.set(
          shoulder.x + Number(authoredOffset.x || 0),
          shoulder.y + Number(authoredOffset.y || 0),
          shoulder.z + Number(authoredOffset.z || 0),
        );
      } else {
        // Legacy animations predate elbow keyframes. Preserve their old hand-to-
        // shoulder targeting; midpoint creation belongs exclusively to the editor.
        target.copy(shoulder);
      }
      const upperArmLength = target.distanceTo(shoulder);
      const forearmLength = target.distanceTo(socket.position);
      const shoulderWristDistance = shoulder.distanceTo(socket.position);
      const diagnosticArmLength = armGuideLength(side);
      return {
        elbow: target,
        source: authoredOffset ? 'pose-authored' : 'legacy-shoulder-target',
        authoredOffset: authoredOffset ? { x: authoredOffset.x, y: authoredOffset.y, z: authoredOffset.z } : null,
        diagnosticArmLength,
        upperArmLength,
        forearmLength,
        shoulderWristDistance,
        authoredPolylineLength: upperArmLength + forearmLength,
      };
    }

    function makePaperArmGuide(side) {
      if (paperArmBySide[side]) return paperArmBySide[side];
      const root = new THREE.Group(); // Parent-local x-ray scaffold; it never drives hand or shoulder transforms.
      root.name = `${side}_paper_arm_guide`;
      root.userData = { visualOnly: true, elbowPoseAuthoritative: true, jointLimitsApplied: false };
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff, wireframe: true, transparent: true, opacity: 0.82,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      material.name = 'paper_arm_xray_wire';
      const width = Math.max(0.012, modelHeight * 0.035); // Visible strip width used by both upper/lower guide segments.
      const makeStrip = name => {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, 1), material);
        strip.name = name;
        strip.renderOrder = 9999;
        strip.frustumCulled = false;
        root.add(strip);
        return strip;
      };
      const upper = makeStrip(`${side}_paper_upper_arm`);
      const lower = makeStrip(`${side}_paper_forearm`);
      const elbow = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.012, modelHeight * 0.026), 10, 8),
        material,
      );
      elbow.name = `${side}_paper_elbow`;
      elbow.renderOrder = 10000;
      elbow.frustumCulled = false;
      root.add(elbow);
      root.visible = false;
      parent.add(root);
      paperArmBySide[side] = { root, upper, lower, elbow, material };
      return paperArmBySide[side];
    }

    function placePaperStrip(strip, from, to) {
      guideDirection.copy(to).sub(from);
      const length = guideDirection.length();
      if (!(length > 1e-8)) { strip.visible = false; return; }
      strip.visible = true;
      strip.position.copy(from).add(to).multiplyScalar(0.5);
      strip.quaternion.setFromUnitVectors(guideLocalY, guideDirection.multiplyScalar(1 / length));
      strip.scale.set(1, length, 1);
      strip.updateMatrix?.();
    }

    function updatePaperArmGuide(side, shoulder, solved = null) {
      const existing = paperArmBySide[side];
      if (!paperArmGuideVisible) {
        if (existing) existing.root.visible = false;
        return;
      }
      const socket = socketFor(side);
      if (!socket || !shoulder) {
        if (existing) existing.root.visible = false;
        return;
      }
      const elbowSolve = solved || resolveElbowInParent(side, shoulder, guideElbow);
      if (!elbowSolve) {
        if (existing) existing.root.visible = false;
        return;
      }
      const guide = makePaperArmGuide(side);
      const elbow = elbowSolve.elbow;
      placePaperStrip(guide.upper, shoulder, elbow);
      placePaperStrip(guide.lower, elbow, socket.position);
      guide.elbow.position.copy(elbow);
      guide.root.userData.armLength = elbowSolve.diagnosticArmLength;
      guide.root.userData.armLengthSource = avatarRoot.userData?.armLengthSource || 'fallback';
      guide.root.userData.upperArmLength = elbowSolve.upperArmLength;
      guide.root.userData.forearmLength = elbowSolve.forearmLength;
      guide.root.userData.authoredPolylineLength = elbowSolve.authoredPolylineLength;
      guide.root.userData.shoulderWristDistance = elbowSolve.shoulderWristDistance;
      guide.root.userData.elbowSource = elbowSolve.source;
      guide.root.userData.authoredElbowOffset = elbowSolve.authoredOffset ? { ...elbowSolve.authoredOffset } : null;
      guide.root.userData.resolvedElbow = { x: elbow.x, y: elbow.y, z: elbow.z };
      guide.root.visible = true;
      guide.root.updateMatrixWorld?.(true);
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
      const elbowSolve = resolveElbowInParent(side, shoulder, guideElbow);
      const elbow = elbowSolve?.elbow || shoulder;
      targetDirection.copy(elbow).sub(socket.position); // Forearm direction: the wrist-facing hand axis points back toward the elbow.
      if (targetDirection.lengthSq() < 1e-10) {
        socket.quaternion.copy(authoredQuaternion);
        socket.updateMatrix?.();
        socket.updateMatrixWorld?.(true);
        updatePaperArmGuide(side, shoulder, elbowSolve);
        debugBySide[side] = { weights, applied: false, reason: 'hand-at-elbow' };
        return false;
      }
      targetDirection.normalize();

      // Elbow targeting owns the GENERIC hand socket only. Per-GLB calibration
      // remains a child layer. Convert the elbow direction into this authored
      // socket's LOCAL hand basis, then solve only the X and Z hinges.
      inverseAuthoredQuaternion.copy(authoredQuaternion).invert();
      localTargetDirection.copy(targetDirection).applyQuaternion(inverseAuthoredQuaternion).normalize();
      const gripAngle = Math.atan2(
        localTargetDirection.z,
        Math.hypot(localTargetDirection.x, localTargetDirection.y),
      ); // Local-X hinge moves the +Y proximal axis out of the palm plane.
      const palmNormalAngle = Math.atan2(
        -localTargetDirection.x,
        localTargetDirection.y,
      ); // Local-Z hinge turns the +Y proximal axis within the palm plane.
      const appliedGripAngle = gripAngle * weights.grip;
      const appliedPalmNormalAngle = palmNormalAngle * weights.palmNormal;

      gripCorrectionQuaternion.setFromAxisAngle(localGripAxis, appliedGripAngle);
      palmNormalCorrectionQuaternion.setFromAxisAngle(localPalmNormalAxis, appliedPalmNormalAngle);
      localCorrectionQuaternion.copy(palmNormalCorrectionQuaternion).multiply(gripCorrectionQuaternion).normalize();
      outputQuaternion.copy(authoredQuaternion).multiply(localCorrectionQuaternion).normalize(); // Right multiply keeps both hinge axes hand-local.
      socket.quaternion.copy(outputQuaternion);
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      updatePaperArmGuide(side, shoulder, elbowSolve);

      aimedWristAxis.copy(localWristProximalAxis).applyQuaternion(outputQuaternion).normalize();
      const residualRad = Math.acos(clampUnit(aimedWristAxis.dot(targetDirection)));
      const toDeg = THREE.MathUtils.radToDeg;
      debugBySide[side] = {
        weights: { ...weights },
        applied: weights.grip > 0 || weights.palmNormal > 0,
        source: shoulderSource[side],
        shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
        wrist: { x: socket.position.x, y: socket.position.y, z: socket.position.z },
        elbow: { x: elbow.x, y: elbow.y, z: elbow.z },
        diagnosticArmLength: elbowSolve?.diagnosticArmLength ?? armGuideLength(side),
        upperArmLength: elbowSolve?.upperArmLength ?? null,
        forearmLength: elbowSolve?.forearmLength ?? null,
        authoredPolylineLength: elbowSolve?.authoredPolylineLength ?? null,
        shoulderWristDistance: elbowSolve?.shoulderWristDistance ?? null,
        elbowSource: elbowSolve?.source || 'unknown',
        authoredElbowOffset: elbowSolve?.authoredOffset || null,
        calibrationOwnership: 'ignored-child-layer',
        authoredQuaternion: quaternionDebug(authoredQuaternion),
        authoredDeg: eulerDebug(authoredQuaternion),
        targetDirectionLocal: { x: localTargetDirection.x, y: localTargetDirection.y, z: localTargetDirection.z },
        solvedLocalAnglesDeg: { grip: toDeg(gripAngle), palmNormal: toDeg(palmNormalAngle) },
        appliedLocalAnglesDeg: { grip: toDeg(appliedGripAngle), palmNormal: toDeg(appliedPalmNormalAngle) },
        residualDeg: toDeg(residualRad),
        outputQuaternion: quaternionDebug(outputQuaternion),
        outputDeg: eulerDebug(outputQuaternion),
      };
      return weights.grip > 0 || weights.palmNormal > 0;
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
      if (!fallback) {
        for (const side of ['left', 'right']) if (freeSide[side]) alignFreeHandToFallbackAnchor(side);
        aimAll();
        global.ProceduralHandFrameDriver?.syncNow?.();
      }
      // A newly reset 0,0 point is resolved on the next avatar rebuild; this avoids
      // repeating expensive alpha-component scans while dragging numeric fields.
    });

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function shoulderAimPlaceHandWorld(side, worldPosition, worldQuaternion, modelCalibration = null) {
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion, modelCalibration); // Forward the calibration child payload unchanged; proximal targeting owns only the socket quaternion.
        if (result) {
          freeSide[side] = false;
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
        freeSide[side] = true;
        alignFreeHandToFallbackAnchor(side, fallbackPose);
        captureAuthoredBase(side);
        aimSide(side);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function shoulderAimUseIdlePose(fallbackPoses = null) {
        const result = originalUseIdlePose(fallbackPoses);
        freeSide.left = true;
        freeSide.right = true;
        alignFreeHandToFallbackAnchor('left', fallbackPoses?.left || null);
        alignFreeHandToFallbackAnchor('right', fallbackPoses?.right || null);
        captureAuthoredBase('left');
        captureAuthoredBase('right');
        aimAll();
        return result;
      };
    }

    const guideController = {
      refresh() { for (const side of ['left', 'right']) updatePaperArmGuide(side, shoulderInParent(side)); },
      dispose() {
        for (const guide of Object.values(paperArmBySide)) {
          if (!guide) continue;
          guide.root.parent?.remove?.(guide.root);
          guide.upper.geometry?.dispose?.();
          guide.lower.geometry?.dispose?.();
          guide.elbow.geometry?.dispose?.();
          guide.material?.dispose?.();
        }
      },
    }; // Registered below so the editor can toggle guides without rebuilding avatars.
    activeGuideControllers.add(guideController);

    const originalDispose = rig.dispose?.bind(rig);
    rig.dispose = function shoulderAimDispose() {
      disposed = true;
      unsubscribePoints?.();
      activeGuideControllers.delete(guideController);
      guideController.dispose();
      return originalDispose?.();
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function shoulderAimDebug() {
      return {
        ...(originalDebug?.() || {}),
        shoulderCompass: {
          mode: 'hand-local-two-hinge',
          targetFeature: 'elbow',
          wristProximalAxis: '+Y',
          componentSpace: 'hand-local',
          allowedHinges: { grip: '+X', palmNormal: '-Z' },
          paperArmGuide: {
            visible: paperArmGuideVisible,
            authoritative: false,
            elbowPoseAuthoritative: true,
            jointLimitsApplied: false,
            sides: Object.fromEntries(['left', 'right'].map(side => [
              side,
              paperArmBySide[side]?.root?.userData ? { ...paperArmBySide[side].root.userData } : null,
            ])),
          },
          scanState,
          scanError,
          shoulderSource: { ...shoulderSource },
          idlePositionRule: 'shoulder-x + posterior-y + fallback-y-offset',
          resolvedPosteriorY: posteriorYInParent(),
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
    mode: 'hand-local-two-hinge',
    componentSpace: 'hand-local',
    targetFeature: 'elbow',
    wristProximalAxis: '+Y',
    allowedHinges: Object.freeze({ grip: '+X', palmNormal: '-Z' }),
    idleWeights: Object.freeze({ grip: 1, palmNormal: 1 }),
    activeWeights: Object.freeze({ grip: 0, palmNormal: 1 }),
    setPaperArmGuideVisible(value) {
      paperArmGuideVisible = value === true;
      for (const controller of activeGuideControllers) controller.refresh();
      return paperArmGuideVisible;
    },
    get paperArmGuideVisible() { return paperArmGuideVisible; },
    refreshPaperArmGuides() {
      for (const controller of activeGuideControllers) controller.refresh();
    },
  });
})(window);
