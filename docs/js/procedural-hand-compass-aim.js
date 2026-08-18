// Presentation-only bridge between direct 3D hands and separated 2D arm sprites.
// No bones, IK, reach limits, elbows, or tool correction. Each arm is a rigid plane
// rotating around its scanned shoulder toward the corresponding hand. After the
// authored hand/tool quaternion is applied, local roll is corrected so the GLB's
// +Y/top (assumed wrist end) points back toward that same shoulder in portrait XY.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  if (!hands?.attach || hands.attach.__hobunjiCompassAimWrapped) return;

  const originalAttach = hands.attach.bind(hands);
  const DEPTH_BEHIND_BODY = -0.006;
  const TWO_PI = Math.PI * 2;

  function normalizeAngle(angle) {
    let value = Number(angle) || 0;
    while (value > Math.PI) value -= TWO_PI;
    while (value < -Math.PI) value += TWO_PI;
    return value;
  }

  function disposeArmVisual(record) {
    if (!record) return;
    record.pivot?.parent?.remove?.(record.pivot);
    record.mesh?.geometry?.dispose?.();
    const materials = Array.isArray(record.mesh?.material) ? record.mesh.material : [record.mesh?.material];
    for (const material of materials) {
      material?.map?.dispose?.();
      material?.dispose?.();
    }
  }

  function installCompassAim(THREE, rig, options) {
    const avatarRoot = options?.avatarRoot || rig?.avatarRoot || null;
    const sourceCanvas = avatarRoot?.userData?.sourceCanvas || null;
    const data = sourceCanvas?.hobunjiArmCompass || null;
    if (!avatarRoot || !data?.sides) return rig;

    const modelWidth = Number(avatarRoot.userData?.portraitModelWidth) || Number(options?.modelHeight) || 0.9;
    const modelHeight = Number(avatarRoot.userData?.portraitModelHeight) || Number(options?.modelHeight) || 0.9;
    const placementRatio = Number(avatarRoot.userData?.portraitVerticalPlacementRatio);
    const assemblyY = ((Number.isFinite(placementRatio) ? placementRatio : 0.5) - 0.5) * modelHeight;
    const canvasWidth = Number(data.width) || sourceCanvas.width || 1;
    const canvasHeight = Number(data.height) || sourceCanvas.height || 1;
    const records = {};

    function pixelToAvatarLocal(point) {
      return new THREE.Vector3(
        -modelWidth / 2 + (Number(point?.x) || 0) / canvasWidth * modelWidth,
        assemblyY + modelHeight / 2 - (Number(point?.y) || 0) / canvasHeight * modelHeight,
        0,
      );
    }

    for (const side of ['left', 'right']) {
      const arm = data.sides?.[side];
      if (!arm?.canvas || !arm.shoulder || !arm.wrist) continue;
      const shoulder = pixelToAvatarLocal(arm.shoulder);
      const wrist = pixelToAvatarLocal(arm.wrist);
      const baseVector = wrist.clone().sub(shoulder);
      baseVector.z = 0;
      if (baseVector.lengthSq() < 1e-8) continue;

      const texture = new THREE.CanvasTexture(arm.canvas);
      texture.name = `${side}_arm_compass_texture`;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;

      const material = new THREE.MeshBasicMaterial({
        name: `${side}_arm_compass_material`,
        map: texture,
        transparent: true,
        alphaTest: 0.001,
        side: THREE.FrontSide,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(modelWidth, modelHeight), material);
      mesh.name = `${side}_arm_compass_sprite`;
      mesh.position.set(-shoulder.x, assemblyY - shoulder.y, 0);
      mesh.layers.enable(1);

      const pivot = new THREE.Group();
      pivot.name = `${side}_arm_compass_pivot`;
      pivot.position.set(shoulder.x, shoulder.y, DEPTH_BEHIND_BODY);
      pivot.add(mesh);
      avatarRoot.add(pivot);
      global.HobunjiOutlines?.markMaterialSeamId?.(pivot);

      records[side] = {
        pivot,
        mesh,
        shoulder,
        wrist,
        baseVector,
        armAngleRad: 0,
        wristRollCorrectionRad: 0,
      };
    }

    if (!Object.keys(records).length) return rig;

    const worldHand = new THREE.Vector3();
    const worldShoulder = new THREE.Vector3();
    const worldTopPoint = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const localHand = new THREE.Vector3();
    const localTopPoint = new THREE.Vector3();
    const target = new THREE.Vector2();
    const projectedTop = new THREE.Vector2();
    const zAxis = new THREE.Vector3(0, 0, 1);

    function socketFor(side) {
      return rig.group?.getObjectByName?.(`${side}_hand_socket`) || null;
    }

    function updateArmTowardsHand(side) {
      const record = records[side];
      const socket = socketFor(side);
      if (!record || !socket) return false;
      avatarRoot.updateWorldMatrix?.(true, false);
      socket.updateWorldMatrix?.(true, false);
      socket.getWorldPosition(worldHand);
      localHand.copy(worldHand);
      avatarRoot.worldToLocal(localHand);
      target.set(localHand.x - record.shoulder.x, localHand.y - record.shoulder.y);
      if (target.lengthSq() < 1e-10) return false;
      const baseAngle = Math.atan2(record.baseVector.y, record.baseVector.x);
      const targetAngle = Math.atan2(target.y, target.x);
      record.armAngleRad = normalizeAngle(targetAngle - baseAngle);
      record.pivot.rotation.z = record.armAngleRad;
      record.pivot.updateMatrix?.();
      return true;
    }

    // Correct only local roll. Pitch/yaw and the authored hand/tool orientation stay
    // authoritative. Two small correction passes compensate for perspective from a
    // pitched/yawed hand: each pass measures the projected +Y/top after the previous
    // roll and rotates that projection closer to the shoulder direction.
    function rollWristTowardsShoulder(side) {
      const record = records[side];
      const socket = socketFor(side);
      if (!record || !socket) return false;
      record.wristRollCorrectionRad = 0;
      for (let pass = 0; pass < 2; pass++) {
        avatarRoot.updateWorldMatrix?.(true, false);
        socket.updateWorldMatrix?.(true, false);
        socket.getWorldPosition(worldHand);
        socket.getWorldQuaternion(worldQuaternion);

        worldShoulder.copy(record.shoulder);
        avatarRoot.localToWorld(worldShoulder);
        localHand.copy(worldHand);
        avatarRoot.worldToLocal(localHand);

        worldTopPoint.set(0, 1, 0).applyQuaternion(worldQuaternion).add(worldHand);
        localTopPoint.copy(worldTopPoint);
        avatarRoot.worldToLocal(localTopPoint);

        projectedTop.set(localTopPoint.x - localHand.x, localTopPoint.y - localHand.y);
        target.set(record.shoulder.x - localHand.x, record.shoulder.y - localHand.y);
        if (projectedTop.lengthSq() < 1e-10 || target.lengthSq() < 1e-10) break;
        const correction = normalizeAngle(
          Math.atan2(target.y, target.x) - Math.atan2(projectedTop.y, projectedTop.x)
        );
        if (!Number.isFinite(correction) || Math.abs(correction) < 1e-5) break;
        socket.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, correction));
        socket.updateMatrix?.();
        record.wristRollCorrectionRad += correction;
      }
      socket.updateMatrixWorld?.(true);
      return true;
    }

    function refreshSide(side) {
      rollWristTowardsShoulder(side);
      updateArmTowardsHand(side);
    }

    const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
    if (originalPlaceHandWorld) {
      rig.placeHandWorld = function compassAimPlaceHandWorld(side, worldPosition, worldQuaternionInput) {
        const result = originalPlaceHandWorld(side, worldPosition, worldQuaternionInput);
        if (result) refreshSide(side);
        return result;
      };
    }

    const originalSetSideIdle = rig.setSideIdle?.bind(rig);
    if (originalSetSideIdle) {
      rig.setSideIdle = function compassAimSetSideIdle(side) {
        const result = originalSetSideIdle(side);
        refreshSide(side);
        return result;
      };
    }

    const originalUseIdlePose = rig.useIdlePose?.bind(rig);
    if (originalUseIdlePose) {
      rig.useIdlePose = function compassAimUseIdlePose() {
        const result = originalUseIdlePose();
        refreshSide('left');
        refreshSide('right');
        return result;
      };
    }

    const originalDispose = rig.dispose?.bind(rig);
    rig.dispose = function compassAimDispose() {
      for (const record of Object.values(records)) disposeArmVisual(record);
      return originalDispose?.();
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function compassAimDebug() {
      const base = originalDebug?.() || {};
      const armCompass = {};
      for (const [side, record] of Object.entries(records)) {
        armCompass[side] = {
          shoulder: { x: record.shoulder.x, y: record.shoulder.y },
          armAngleDeg: THREE.MathUtils.radToDeg(record.armAngleRad),
          wristRollCorrectionDeg: THREE.MathUtils.radToDeg(record.wristRollCorrectionRad),
        };
      }
      return { ...base, armPresentation: '2d-compass-to-hand', wristTopAim: '+Y-to-shoulder-via-roll', armCompass };
    };

    refreshSide('left');
    refreshSide('right');
    return rig;
  }

  const wrappedAttach = function compassAimAttach(THREE, parent, options = {}) {
    const rig = originalAttach(THREE, parent, options);
    return rig ? installCompassAim(THREE, rig, options) : rig;
  };
  wrappedAttach.__hobunjiCompassAimWrapped = true;
  hands.attach = wrappedAttach;

  global.ProceduralHandCompassAim = Object.freeze({
    mode: '2d-compass-to-hand',
    wristTopAssumption: 'local +Y is wrist/top',
    handOrientationCorrection: 'local roll only',
  });
})(window);
