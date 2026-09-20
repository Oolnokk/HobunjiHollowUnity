// Hand-only shoulder targeting. Painted arm sprites remain untouched.
//
// Shoulder targets come from attachment-rig profiles when present. Legacy manually
// authored 200x200 points and portrait-hand-shoulder-scan.js remain fallbacks.
// The hand socket/origin IS the wrist. Palm/fingers extend local +Y, so the shoulder
// lies toward local -Y. The correction may rotate only around two HAND-LOCAL hinges:
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
    const localWristShoulderAxis = new THREE.Vector3(0, -1, 0); // Wrist-to-shoulder direction before either local hinge rotates.
    const localGripAxis = new THREE.Vector3(1, 0, 0); // Across the grasp; first allowed shoulder-follow hinge.
    const localPalmNormalAxis = new THREE.Vector3(0, 0, 1); // Perpendicular to the palm plane; second allowed shoulder-follow hinge.
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

    function armGuideLength() {
      const rendered = Number(avatarRoot.userData?.scaledArmLength); // Preferred rendered-space arm reach for the paper guide.
      if (Number.isFinite(rendered) && rendered > 0) return rendered;
      const authored = Number(avatarRoot.userData?.armLength); // Fallback retained for older avatars without scaledArmLength.
      return Number.isFinite(authored) && authored > 0 ? authored * (modelHeight / 0.9) : modelHeight * 0.62;
    }

    function makePaperArmGuide(side) {
      if (paperArmBySide[side]) return paperArmBySide[side];
      const root = new THREE.Group(); // Parent-local x-ray scaffold; it never drives hand or shoulder transforms.
      root.name = `${side}_paper_arm_guide`;
      root.userData = { authoritative: false, bendAtHalfArmLength: true, jointLimitsApplied: false };
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

    function updatePaperArmGuide(side, shoulder, baseQuaternion) {
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
      const guide = makePaperArmGuide(side);
      const totalAuthoredLength = armGuideLength(); // Full shoulder-to-wrist reach; elbow splits it into equal halves.
      guideSpan.copy(socket.position).sub(shoulder);
      const distance = guideSpan.length();
      if (!(distance > 1e-8)) { guide.root.visible = false; return; }
      const guideLength = Math.max(totalAuthoredLength, distance); // Overreach stays connected visually while diagnostics report the stretch.
      const half = guideLength * 0.5;
      const halfChord = distance * 0.5;
      const bendMagnitude = Math.sqrt(Math.max(0, half * half - halfChord * halfChord));
      guideSpan.multiplyScalar(1 / distance);
      guideMidpoint.copy(shoulder).add(socket.position).multiplyScalar(0.5);
      guideBend.copy(localPalmNormalAxis).applyQuaternion(baseQuaternion);
      guideBend.addScaledVector(guideSpan, -guideBend.dot(guideSpan));
      if (guideBend.lengthSq() < 1e-8) {
        guideBend.copy(localGripAxis).applyQuaternion(baseQuaternion);
        guideBend.addScaledVector(guideSpan, -guideBend.dot(guideSpan));
      }
      if (guideBend.lengthSq() < 1e-8) guideBend.set(0, 0, 1);
      guideBend.normalize();
      guideElbow.copy(guideMidpoint).addScaledVector(guideBend, bendMagnitude);
      placePaperStrip(guide.upper, shoulder, guideElbow);
      placePaperStrip(guide.lower, guideElbow, socket.position);
      guide.elbow.position.copy(guideElbow);
      guide.root.userData.armLength = totalAuthoredLength;
      guide.root.userData.displayLength = guideLength;
      guide.root.userData.overreach = distance > totalAuthoredLength + 1e-6;
      guide.root.userData.shoulderWristDistance = distance;
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
      targetDirection.copy(shoulder).sub(socket.position);
      if (targetDirection.lengthSq() < 1e-10) {
        socket.quaternion.copy(authoredQuaternion);
        socket.updateMatrix?.();
        socket.updateMatrixWorld?.(true);
        updatePaperArmGuide(side, shoulder, authoredQuaternion);
        debugBySide[side] = { weights, applied: false, reason: 'hand-at-shoulder' };
        return false;
      }
      targetDirection.normalize();

      // Shoulder-follow owns the GENERIC hand socket only. Per-GLB calibration
      // remains a child layer. Convert the shoulder direction into this authored
      // socket's LOCAL hand basis, then solve only the X and Z hinges.
      inverseAuthoredQuaternion.copy(authoredQuaternion).invert();
      localTargetDirection.copy(targetDirection).applyQuaternion(inverseAuthoredQuaternion).normalize();
      const gripAngle = Math.atan2(
        -localTargetDirection.z,
        Math.hypot(localTargetDirection.x, localTargetDirection.y),
      ); // Local-X hinge moves the wrist axis out of the palm plane.
      const palmNormalAngle = Math.atan2(
        localTargetDirection.x,
        -localTargetDirection.y,
      ); // Local-Z hinge turns the wrist axis within the palm plane.
      const appliedGripAngle = gripAngle * weights.grip;
      const appliedPalmNormalAngle = palmNormalAngle * weights.palmNormal;

      gripCorrectionQuaternion.setFromAxisAngle(localGripAxis, appliedGripAngle);
      palmNormalCorrectionQuaternion.setFromAxisAngle(localPalmNormalAxis, appliedPalmNormalAngle);
      localCorrectionQuaternion.copy(palmNormalCorrectionQuaternion).multiply(gripCorrectionQuaternion).normalize();
      outputQuaternion.copy(authoredQuaternion).multiply(localCorrectionQuaternion).normalize(); // Right multiply keeps both hinge axes hand-local.
      socket.quaternion.copy(outputQuaternion);
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      updatePaperArmGuide(side, shoulder, authoredQuaternion);

      aimedWristAxis.copy(localWristShoulderAxis).applyQuaternion(outputQuaternion).normalize();
      const residualRad = Math.acos(clampUnit(aimedWristAxis.dot(targetDirection)));
      const toDeg = THREE.MathUtils.radToDeg;
      debugBySide[side] = {
        weights: { ...weights },
        applied: weights.grip > 0 || weights.palmNormal > 0,
        source: shoulderSource[side],
        shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
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
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion, modelCalibration); // Forward the calibration child payload unchanged; shoulder-follow owns only the socket quaternion.
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
      refresh() { for (const side of ['left', 'right']) updatePaperArmGuide(side, shoulderInParent(side), authoredBaseBySide[side]); },
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
          targetFeature: 'wrist',
          wristShoulderAxis: '-Y',
          componentSpace: 'hand-local',
          allowedHinges: { grip: '+X', palmNormal: '+Z' },
          paperArmGuide: { visible: paperArmGuideVisible, authoritative: false, bendAtHalfArmLength: true, jointLimitsApplied: false },
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
    targetFeature: 'wrist',
    wristShoulderAxis: '-Y',
    allowedHinges: Object.freeze({ grip: '+X', palmNormal: '+Z' }),
    idleWeights: Object.freeze({ grip: 1, palmNormal: 1 }),
    activeWeights: Object.freeze({ grip: 0, palmNormal: 1 }),
    setPaperArmGuideVisible(value) {
      paperArmGuideVisible = value === true;
      for (const controller of activeGuideControllers) controller.refresh();
      return paperArmGuideVisible;
    },
    get paperArmGuideVisible() { return paperArmGuideVisible; },
  });
})(window);
