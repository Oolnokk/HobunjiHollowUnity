// Reusable hand-model profiles shared by gameplay and the Attack Animation Editor.
// Model scale corrects the imported GLB itself. Species/gender scale is applied on top.
// Source-hand convention: authored GLBs are LEFT hands by default — palm away from
// camera, fingers down, thumb left. The runtime right hand is the local-X mirror.
// Per-model mirrorX remains configurable so an asset authored in the opposite basis
// can opt out without changing every other hand model. Tool grip origin is 0,0,0.
// handFromTool is the model-specific fine alignment relative to the selected grip mode.
// Shoulder-compass axes are intentionally NOT stored here: they belong to animation
// poses and are authored/exported by the Attack Animation Editor.
(function (global) {
  'use strict';

  const HAND_SIZE_BALANCE_MULTIPLIER = 0.925; // Places every hand halfway between its original size and the over-small 85% balance pass.
  const PREVIOUS_HAND_SIZE_BALANCE_MULTIPLIER = 0.85; // Migrates profiles saved by the immediately preceding balance preset.
  const DEFAULT_MODEL_SCALE = 2 * HAND_SIZE_BALANCE_MULTIPLIER;
  const PARROT_MODEL_SCALE = 3 * HAND_SIZE_BALANCE_MULTIPLIER;
  const PREVIOUS_SHARED_ALIGNMENT_PRESET = 'all-species-direction-90--90-0-v3'; // The v3 calibration was the pre-flip 90/-90/0 baseline; migrate it out without resetting unrelated per-model handedness.
  const SHARED_ALIGNMENT_PRESET = 'all-species-maoao-local-0-180-0-v4';
  const ROTATION_CALIBRATION_PRESET = 'orthogonal-quaternion-correction-coordinates-v3'; // Visible X/Y/Z sliders use a gimbal-free stereographic quaternion chart anchored to the preserved model calibration base.
  const MODEL_SCALE_PRESET = 'hands-92_5-feet-120-v2';
  const IDENTITY_TRANSFORM = Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotationDeg: Object.freeze({ pitch: 0, yaw: 0, roll: 0 }),
  });
  // Canonical alignment is intentionally reused for every species/model.
  // Kenkari/Rakako'an use the opposite source-X mirror on their parrot hand model below.
  // Re-calibrated directly against the (now correctly wrist-bottom/fingers-top) paper
  // hand in the GLB Calibration tab, using Mao'ao/feline as the reference model, then
  // propagated to every other GLB as the same shared delta (position {+0.06,+0.06,-0.11},
  // rotation 90/-90/0 -> 0/180/0) since they all started from the identical v3 baseline.
  const MAO_AO_HAND_TRANSFORM = Object.freeze({
    position: Object.freeze({ x: -0.01, y: -0.07, z: 0.1 }),
    rotationDeg: Object.freeze({ pitch: 0, yaw: 180, roll: 0 }),
  });

  function identityTransform() {
    return {
      position: { ...IDENTITY_TRANSFORM.position },
      rotationDeg: { ...IDENTITY_TRANSFORM.rotationDeg },
    };
  }

  function maoAoHandTransform() {
    return {
      position: { ...MAO_AO_HAND_TRANSFORM.position },
      rotationDeg: { ...MAO_AO_HAND_TRANSFORM.rotationDeg },
    };
  }

  function handTransformAt(x, y, z) {
    return {
      position: { x, y, z },
      rotationDeg: { ...MAO_AO_HAND_TRANSFORM.rotationDeg },
    };
  }

  function defaultScaleForModel(modelKey) {
    return modelKey === 'parrot' ? PARROT_MODEL_SCALE : DEFAULT_MODEL_SCALE;
  }

  const DEFAULT_DATA = {
    schema: 'hobunji_hand_model_profiles.v1',
    alignmentPreset: SHARED_ALIGNMENT_PRESET,
    rotationCalibrationPreset: ROTATION_CALIBRATION_PRESET,
    modelScalePreset: MODEL_SCALE_PRESET,
    handHeightFraction: 0.12,
    sourceBasis: {
      handedness: 'left',
      rightHandTransform: 'mirror-x',
      mirrorAxis: 'x',
      palmFaces: 'away-from-camera',
      fingersPoint: 'down',
      thumbPoints: 'left',
      toolGripOrigin: { x: 0, y: 0, z: 0 },
    },
    colors: { bone: '#D8C7A3', keratin: '#44484D' },
    models: {
      pachyderm: {
        glb: 'assets/models/hands/hand_pachyderm.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: handTransformAt(-0.01, -0.07, 0.1),
        // Legacy no-op retained so older code/config readers do not break.
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'bone', MAT_EyeSurface_0c0c0c: 'body', 'Mat 1': 'bone', 'Mat 2': 'body' },
      },
      sloth: {
        glb: 'assets/models/hands/hand_sloth.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: handTransformAt(-0.01, -0.32, 0.25),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'bone', MAT_EyeSurface_0c0c0c: 'body', 'Mat 1': 'bone', 'Mat 2': 'body' },
      },
      feline: {
        glb: 'assets/models/hands/hand_feline.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: handTransformAt(-0.01, -0.07, 0.1),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body', 'Mat 1': 'body' },
      },
      parrot: {
        glb: 'assets/models/hands/hand_parrot.glb',
        scale: PARROT_MODEL_SCALE,
        // Kenkari/Rakako'an use the shared setup with the source handedness flipped.
        mirrorX: false,
        handFromTool: handTransformAt(-0.01, -0.02, 0.1),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'keratin', MAT_EyeSurface_0c0c0c: 'body', 'Mat 1': 'keratin', 'Mat 2': 'body' },
      },
    },
    speciesModels: {
      mashtzarr: 'pachyderm',
      tletingan: 'sloth',
      'mao-ao': 'feline',
      'engh-sho': 'feline',
      kenkari: 'parrot',
      rakakoan: 'parrot',
      harlyao: 'feline',
      porakaneki: 'pachyderm',
    },
    speciesScaleOverrides: {
      tletingan: { male: 0.95, female: 0.925 },
      'engh-sho': { male: 1.45, female: 1.3 },
      'mao-ao': { male: 1.2, female: 1.15 },
      kenkari: { male: 1, female: 0.93 },
      mashtzarr: { male: 1, female: 0.95 },
      harlyao: { male: 1.45, female: 1.3 },
      porakaneki: { male: 1 },
    },
  };

  const LOCAL_KEY = 'hobunji.handModelProfiles.v1';
  const clone = value => JSON.parse(JSON.stringify(value));

  function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function validQuaternion(raw) {
    return !!raw && [raw.x, raw.y, raw.z, raw.w].every(value => Number.isFinite(Number(value)));
  }

  function legacyRotationVectorQuaternion(rotationVectorDeg = {}) {
    const vx = numberOrZero(rotationVectorDeg.x);
    const vy = numberOrZero(rotationVectorDeg.y);
    const vz = numberOrZero(rotationVectorDeg.z);
    const magnitudeDeg = Math.hypot(vx, vy, vz);
    if (magnitudeDeg < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
    const halfAngle = magnitudeDeg * Math.PI / 360;
    const scale = Math.sin(halfAngle) / magnitudeDeg;
    return normalizeQuat({
      x: vx * scale,
      y: vy * scale,
      z: vz * scale,
      w: Math.cos(halfAngle),
    });
  }

  function axisAngleQuaternion(axis = {}, angleDeg = 0) {
    const length = Math.hypot(numberOrZero(axis.x), numberOrZero(axis.y), numberOrZero(axis.z)); // Normalizes legacy-v2 axes during one-shot migration.
    const angle = numberOrZero(angleDeg) * Math.PI / 180; // Converts the legacy authored angle for migration-only quaternion reconstruction.
    if (length < 1e-9 || Math.abs(angle) < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
    const half = angle / 2; // Used below to build the migration-only axis-angle quaternion.
    const scale = Math.sin(half) / length; // Applies the normalized legacy axis to the quaternion vector part.
    return normalizeQuat({
      x: numberOrZero(axis.x) * scale,
      y: numberOrZero(axis.y) * scale,
      z: numberOrZero(axis.z) * scale,
      w: Math.cos(half),
    });
  }

  function legacyFixedBasisCorrectionQuaternion(rotationBaseQuaternion, correctionDeg = {}) {
    const base = normalizeQuat(rotationBaseQuaternion); // Reconstructs the exact v2 Z·Y·X result so saved previews do not jump during v3 migration.
    const axisX = rotateVectorByQuat({ x: 1, y: 0, z: 0 }, base); // Legacy v2 parent-space X axis used only by migration.
    const axisY = rotateVectorByQuat({ x: 0, y: 1, z: 0 }, base); // Legacy v2 parent-space Y axis used only by migration.
    const axisZ = rotateVectorByQuat({ x: 0, y: 0, z: 1 }, base); // Legacy v2 parent-space Z axis used only by migration.
    const qx = axisAngleQuaternion(axisX, correctionDeg.x); // Legacy v2 X contribution used only to preserve current orientation.
    const qy = axisAngleQuaternion(axisY, correctionDeg.y); // Legacy v2 Y contribution used only to preserve current orientation.
    const qz = axisAngleQuaternion(axisZ, correctionDeg.z); // Legacy v2 Z contribution used only to preserve current orientation.
    return normalizeQuat(multiplyQuat(multiplyQuat(qz, qy), qx));
  }

  function orthogonalCorrectionQuaternion(correctionDeg = {}) {
    // Modified Rodrigues / stereographic quaternion coordinates are conformal:
    // the three parameter directions stay orthogonal throughout the editor's
    // finite ±180° range, unlike any sequential X/Y/Z Euler-style product.
    // With only one non-zero control, that control is still the exact requested
    // rotation angle around its model-basis X, Y, or Z axis.
    const px = Math.tan(numberOrZero(correctionDeg.x) * Math.PI / 720); // X chart coordinate; quarter-angle mapping makes a solo X value an exact X rotation.
    const py = Math.tan(numberOrZero(correctionDeg.y) * Math.PI / 720); // Y chart coordinate; used simultaneously with X/Z instead of after them.
    const pz = Math.tan(numberOrZero(correctionDeg.z) * Math.PI / 720); // Z chart coordinate; never becomes X when Y reaches ±90°.
    const p2 = px * px + py * py + pz * pz; // Shared stereographic radius used to map the three controls onto one unit quaternion.
    const denominator = 1 + p2; // Positive over the whole finite editor range, so this chart has no 90° singularity.
    return normalizeQuat({
      x: 2 * px / denominator,
      y: 2 * py / denominator,
      z: 2 * pz / denominator,
      w: (1 - p2) / denominator,
    });
  }

  function normalizeTransform(raw) {
    const legacyRotationDeg = {
      pitch: numberOrZero(raw?.rotationDeg?.pitch),
      yaw: numberOrZero(raw?.rotationDeg?.yaw),
      roll: numberOrZero(raw?.rotationDeg?.roll),
    }; // Backward-readable representation of the fixed base only; sliders never edit these Euler values.
    const rotationBaseQuaternion = validQuaternion(raw?.rotationBaseQuaternion)
      ? normalizeQuat(raw.rotationBaseQuaternion)
      : quatFromYXZ(legacyRotationDeg);
    const rotationCorrectionDeg = {
      x: numberOrZero(raw?.rotationCorrectionDeg?.x),
      y: numberOrZero(raw?.rotationCorrectionDeg?.y),
      z: numberOrZero(raw?.rotationCorrectionDeg?.z),
    };
    const correctionQuaternion = orthogonalCorrectionQuaternion(rotationCorrectionDeg); // Solves all three correction controls simultaneously in a gimbal-free quaternion chart.
    const rotationQuaternion = normalizeQuat(multiplyQuat(rotationBaseQuaternion, correctionQuaternion)); // Post-multiplication keeps the correction chart anchored to the preserved hand-model basis.

    return {
      position: {
        x: numberOrZero(raw?.position?.x),
        y: numberOrZero(raw?.position?.y),
        z: numberOrZero(raw?.position?.z),
      },
      rotationDeg: legacyRotationDeg,
      rotationBaseQuaternion,
      rotationCorrectionDeg,
      rotationQuaternion,
    };
  }

  function multiplyQuat(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function normalizeQuat(raw) {
    const x = numberOrZero(raw?.x);
    const y = numberOrZero(raw?.y);
    const z = numberOrZero(raw?.z);
    const w = Number.isFinite(Number(raw?.w)) ? Number(raw.w) : 1;
    const length = Math.hypot(x, y, z, w) || 1;
    return { x: x / length, y: y / length, z: z / length, w: w / length };
  }

  // Matches THREE.Euler(..., 'YXZ'): qYaw * qPitch * qRoll. Keep profile
  // migration independent of a global THREE because this config loads before the
  // editor's ESM/import-map Three instance exists.
  function quatFromYXZ(rotation = {}) {
    const pitch = numberOrZero(rotation.pitch) * Math.PI / 180;
    const yaw = numberOrZero(rotation.yaw) * Math.PI / 180;
    const roll = numberOrZero(rotation.roll) * Math.PI / 180;
    const qYaw = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const qPitch = { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
    const qRoll = { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) };
    return normalizeQuat(multiplyQuat(multiplyQuat(qYaw, qPitch), qRoll));
  }

  function rotateVectorByQuat(vector = {}, rawQuat = {}) {
    const q = normalizeQuat(rawQuat);
    const vx = numberOrZero(vector.x);
    const vy = numberOrZero(vector.y);
    const vz = numberOrZero(vector.z);
    const tx = 2 * (q.y * vz - q.z * vy);
    const ty = 2 * (q.z * vx - q.x * vz);
    const tz = 2 * (q.x * vy - q.y * vx);
    return {
      x: vx + q.w * tx + (q.y * tz - q.z * ty),
      y: vy + q.w * ty + (q.z * tx - q.x * tz),
      z: vz + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  function eulerYXZFromQuat(rawQuat) {
    const q = normalizeQuat(rawQuat);
    const { x, y, z, w } = q;
    const m11 = 1 - 2 * (y * y + z * z);
    const m13 = 2 * (x * z + y * w);
    const m21 = 2 * (x * y + z * w);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - x * w);
    const m31 = 2 * (x * z - y * w);
    const m33 = 1 - 2 * (x * x + y * y);
    const clamp = value => Math.max(-1, Math.min(1, value));
    const pitch = Math.asin(-clamp(m23));
    let yaw;
    let roll;
    if (Math.abs(m23) < 0.9999999) {
      yaw = Math.atan2(m13, m33);
      roll = Math.atan2(m21, m22);
    } else {
      yaw = Math.atan2(-m31, m11);
      roll = 0;
    }
    const toDeg = radians => radians * 180 / Math.PI;
    return { pitch: toDeg(pitch), yaw: toDeg(yaw), roll: toDeg(roll) };
  }

  function snapQuaternionToRightAngles(rawQuat) {
    const visible = eulerYXZFromQuat(rawQuat); // Converts the actual final calibration orientation, not the editor's quaternion-coordinate slider values.
    const snap = value => {
      const snapped = Math.round(numberOrZero(value) / 90) * 90;
      return Object.is(snapped, -0) ? 0 : Math.max(-180, Math.min(180, snapped));
    };
    const rotationDeg = {
      pitch: snap(visible.pitch),
      yaw: snap(visible.yaw),
      roll: snap(visible.roll),
    };
    return {
      rotationDeg,
      quaternion: quatFromYXZ(rotationDeg), // Rebuilds an exact right-angle quaternion so display rounding cannot drift the stored orientation.
    };
  }

  function invertTransform(raw) {
    const transform = normalizeTransform(raw);
    const q = transform.rotationQuaternion; // Older toolGrip migration may already contain quaternion-native corrections.
    const inverseQ = { x: -q.x, y: -q.y, z: -q.z, w: q.w }; // Unit-quaternion conjugate gives the exact reverse rotation.
    const inversePosition = rotateVectorByQuat({
      x: -transform.position.x,
      y: -transform.position.y,
      z: -transform.position.z,
    }, inverseQ);
    return normalizeTransform({
      position: inversePosition,
      rotationDeg: eulerYXZFromQuat(inverseQ), // Legacy-readable base values only; runtime consumes rotationQuaternion.
      rotationBaseQuaternion: inverseQ,
      rotationCorrectionDeg: { x: 0, y: 0, z: 0 },
    });
  }

  function normalizeData(raw) {
    const next = clone(raw || DEFAULT_DATA);
    const previousScalePreset = next.modelScalePreset; // Distinguishes the oldest 2x parrot default from the later 3x preset during migration.
    const previousRotationCalibrationPreset = next.rotationCalibrationPreset; // Selects the exact legacy correction reconstruction used to preserve the visible v1/v2 hand orientation.
    const previousAlignmentPreset = next.alignmentPreset; // Lets the v1→v2 calibration-only migration preserve per-model mirror choices.
    const migrateToSharedAlignment = previousAlignmentPreset !== SHARED_ALIGNMENT_PRESET;
    const migrateSizeBalance = next.modelScalePreset !== MODEL_SCALE_PRESET;
    const migrateRotationCalibration = previousRotationCalibrationPreset !== ROTATION_CALIBRATION_PRESET;
    next.rotationCalibrationPreset = ROTATION_CALIBRATION_PRESET; // Orthogonal quaternion coordinates replace both rotation-vector and sequential fixed-axis calibration.
    next.alignmentPreset = SHARED_ALIGNMENT_PRESET;
    next.modelScalePreset = MODEL_SCALE_PRESET;
    next.sourceBasis = {
      ...clone(DEFAULT_DATA.sourceBasis),
      ...(next.sourceBasis || {}),
      handedness: 'left',
      rightHandTransform: 'mirror-x',
      mirrorAxis: 'x',
      palmFaces: 'away-from-camera',
      fingersPoint: 'down',
      thumbPoints: 'left',
      toolGripOrigin: { x: 0, y: 0, z: 0 },
    };
    next.speciesModels = { ...clone(DEFAULT_DATA.speciesModels), ...(next.speciesModels || {}) };
    const savedScaleOverrides = next.speciesScaleOverrides && typeof next.speciesScaleOverrides === 'object' ? next.speciesScaleOverrides : {};
    next.speciesScaleOverrides = {};
    for (const [speciesKey, defaultByGender] of Object.entries(DEFAULT_DATA.speciesScaleOverrides)) {
      next.speciesScaleOverrides[speciesKey] = { ...defaultByGender, ...(savedScaleOverrides[speciesKey] || {}) };
    }
    for (const [speciesKey, savedByGender] of Object.entries(savedScaleOverrides)) {
      if (!next.speciesScaleOverrides[speciesKey]) next.speciesScaleOverrides[speciesKey] = { ...savedByGender };
    }
    next.models = next.models || {};
    for (const [modelKey, model] of Object.entries(next.models)) {
      if (!model || typeof model !== 'object') continue;
      const modelScale = Number(model.scale);
      const hasSavedScale = Number.isFinite(modelScale) && modelScale > 0;
      if (!hasSavedScale) {
        model.scale = defaultScaleForModel(modelKey);
      } else if (migrateSizeBalance) {
        if (modelKey === 'parrot' && previousScalePreset !== 'parrot-3x-v1' && Number(model.scale) === 2) model.scale = 3;
        const migrationMultiplier = previousScalePreset === 'hands-85-feet-120-v1'
          ? HAND_SIZE_BALANCE_MULTIPLIER / PREVIOUS_HAND_SIZE_BALANCE_MULTIPLIER
          : HAND_SIZE_BALANCE_MULTIPLIER; // Raises the prior 85% profiles to 92.5%; older full-size profiles receive the new balance once.
        model.scale *= migrationMultiplier;
      }
      // Existing local/exported drafts from before this shared direction migrate once.
      // After the marker is present, editor changes remain freely editable.
      if (migrateToSharedAlignment) {
        model.handFromTool = maoAoHandTransform(); // Apply the Mao'ao calibration delta uniformly to pachyderm, sloth, feline and parrot GLBs.
        if (previousAlignmentPreset !== PREVIOUS_SHARED_ALIGNMENT_PRESET) {
          model.mirrorX = modelKey === 'parrot' ? false : true; // Only truly old/pre-v1 drafts need the historical handedness normalization.
        }
      } else {
        // New/missing values inherit the corrected left-source convention. Explicit
        // false remains a valid per-model override for a GLB authored as a right hand.
        model.mirrorX = model.mirrorX !== false;
      }
      // The supplied profile moved only sloth/parrot away from the old shared
      // Mao'ao position. Upgrade exact untouched old defaults; preserve authored edits.
      const oldSharedPosition = model.handFromTool?.position;
      const oldSharedRotation = model.handFromTool?.rotationDeg;
      const untouchedSharedCalibration = oldSharedPosition
        && Math.abs(numberOrZero(oldSharedPosition.x) - (-0.01)) < 1e-9
        && Math.abs(numberOrZero(oldSharedPosition.y) - (-0.07)) < 1e-9
        && Math.abs(numberOrZero(oldSharedPosition.z) - 0.1) < 1e-9
        && numberOrZero(oldSharedRotation?.pitch) === 0
        && numberOrZero(oldSharedRotation?.yaw) === 180
        && numberOrZero(oldSharedRotation?.roll) === 0;
      if (modelKey === 'sloth' && untouchedSharedCalibration) model.handFromTool.position = { x: -0.01, y: -0.32, z: 0.25 };
      if (modelKey === 'parrot' && untouchedSharedCalibration) model.handFromTool.position = { x: -0.01, y: -0.02, z: 0.1 };

      const roles = model.materialRoles || {};
      const roleKeys = Object.keys(roles).sort().join('|');
      if ((modelKey === 'pachyderm' || modelKey === 'sloth')
          && roleKeys === 'MAT_EyeSurface_0c0c0c|MAT_None_7a4e2e'
          && roles.MAT_None_7a4e2e === 'body' && roles.MAT_EyeSurface_0c0c0c === 'bone') {
        model.materialRoles = clone(DEFAULT_DATA.models[modelKey].materialRoles);
      } else if (modelKey === 'feline'
          && roleKeys === 'MAT_None_7a4e2e'
          && roles.MAT_None_7a4e2e === 'body') {
        model.materialRoles = clone(DEFAULT_DATA.models.feline.materialRoles);
      } else if (modelKey === 'parrot'
          && roleKeys === 'MAT_EyeSurface_0c0c0c|MAT_None_7a4e2e'
          && roles.MAT_None_7a4e2e === 'body' && roles.MAT_EyeSurface_0c0c0c === 'keratin') {
        model.materialRoles = clone(DEFAULT_DATA.models.parrot.materialRoles);
      }

      // Older hand-profile drafts may still contain model.shoulderAim. It is now
      // deliberately discarded because shoulder-axis choices belong to poses.
      delete model.shoulderAim;
      // Older drafts authored a tool socket on the hand. Migrate that into the
      // direct hand-from-tool convention only when no explicit direct transform exists.
      if (!model.handFromTool) {
        model.handFromTool = invertTransform(model.toolGrip);
      } else {
        if (migrateRotationCalibration) {
          const legacyRaw = model.handFromTool; // Reads the pre-v3 transform once so migration can preserve the exact currently-visible orientation.
          const legacyBase = validQuaternion(legacyRaw?.rotationBaseQuaternion)
            ? normalizeQuat(legacyRaw.rotationBaseQuaternion)
            : quatFromYXZ(legacyRaw?.rotationDeg || {}); // Falls back to the oldest Euler-authored base when no quaternion base was saved.
          const preservedFinal = validQuaternion(legacyRaw?.rotationQuaternion)
            ? normalizeQuat(legacyRaw.rotationQuaternion)
            : previousRotationCalibrationPreset === 'fixed-model-basis-axis-corrections-v2'
              ? normalizeQuat(multiplyQuat(
                  legacyFixedBasisCorrectionQuaternion(legacyBase, legacyRaw?.rotationCorrectionDeg || {}),
                  legacyBase,
                ))
              : normalizeQuat(multiplyQuat(
                  legacyBase,
                  legacyRotationVectorQuaternion(legacyRaw?.rotationCorrectionVectorDeg || {}),
                )); // Exact v1/v2 fallback paths are migration-only; all live v3 editing uses orthogonalCorrectionQuaternion().
          model.handFromTool = {
            ...legacyRaw,
            rotationDeg: eulerYXZFromQuat(preservedFinal),
            rotationBaseQuaternion: preservedFinal,
            rotationCorrectionDeg: { x: 0, y: 0, z: 0 },
          };
          delete model.handFromTool.rotationCorrectionVectorDeg;
        }
        model.handFromTool = normalizeTransform(model.handFromTool);
      }
      // Legacy socket readers may still inspect toolGrip. Keep it identity so the
      // direct hand endpoint is the actual hand root; handFromTool owns alignment.
      model.toolGrip = identityTransform();
    }
    return next;
  }

  let data = normalizeData(DEFAULT_DATA); // Mutable editor/runtime copy; exported rather than mutating DEFAULT_DATA.
  const listeners = new Set(); // Used by live hand rigs/editor controls to refresh after profile edits.

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function normalizeGender(value) { return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male'; }
  function parentSpecies(species) {
    return normalizeKey(global.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.[species]?.parentSpecies);
  }
  function modelKeyForSpecies(speciesId) {
    const seen = new Set();
    let current = normalizeKey(speciesId);
    while (current && !seen.has(current)) {
      if (data.speciesModels?.[current]) return data.speciesModels[current];
      seen.add(current);
      current = parentSpecies(current);
    }
    return null;
  }
  function modelForSpecies(speciesId) {
    const key = modelKeyForSpecies(speciesId);
    return key ? data.models?.[key] || null : null;
  }
  function handTransformForSpecies(speciesId) {
    return normalizeTransform(modelForSpecies(speciesId)?.handFromTool);
  }
  function footScaleFor(speciesId, gender) {
    const table = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale || {};
    const g = normalizeGender(gender);
    const seen = new Set();
    let current = normalizeKey(speciesId);
    while (current && !seen.has(current)) {
      const value = Number(table[current]?.[g]);
      if (Number.isFinite(value) && value > 0) return value;
      seen.add(current);
      current = parentSpecies(current);
    }
    const fallback = Number(table.default);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  }
  function speciesScaleFor(speciesId, gender) {
    const g = normalizeGender(gender);
    const seen = new Set();
    let current = normalizeKey(speciesId);
    while (current && !seen.has(current)) {
      const value = Number(data.speciesScaleOverrides?.[current]?.[g]);
      if (Number.isFinite(value) && value > 0) return value;
      seen.add(current);
      current = parentSpecies(current);
    }
    return footScaleFor(speciesId, g);
  }
  function modelScaleFor(speciesId) {
    const value = Number(modelForSpecies(speciesId)?.scale);
    return Number.isFinite(value) && value > 0 ? value : defaultScaleForModel(modelKeyForSpecies(speciesId));
  }
  function effectiveScaleFor(speciesId, gender) {
    return modelScaleFor(speciesId) * speciesScaleFor(speciesId, gender);
  }
  function notify(change = { kind: 'data' }) {
    for (const fn of listeners) { try { fn(data, change); } catch (_) {} }
  }
  function replace(next, change = { kind: 'replace' }) {
    if (!next || next.schema !== DEFAULT_DATA.schema) throw new Error(`Expected ${DEFAULT_DATA.schema}`);
    data = normalizeData(next);
    global.HOBUNJI_HAND_MODEL_PROFILES = data;
    notify(change);
    return data;
  }
  function mutate(mutator, change = { kind: 'data' }) {
    mutator(data);
    data = normalizeData(data);
    global.HOBUNJI_HAND_MODEL_PROFILES = data;
    notify(change);
    return data;
  }
  function updateModelHandTransform(modelKey, mutator) {
    const model = data.models?.[modelKey];
    if (!model) return null;
    const nextTransform = normalizeTransform(model.handFromTool);
    mutator(nextTransform);
    model.handFromTool = normalizeTransform(nextTransform);
    global.HOBUNJI_HAND_MODEL_PROFILES = data;
    notify({ kind: 'hand-transform', modelKey });
    return model.handFromTool;
  }
  function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }
  function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return false;
    replace(JSON.parse(raw));
    return true;
  }
  function clearLocal() { localStorage.removeItem(LOCAL_KEY); replace(DEFAULT_DATA); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  global.HOBUNJI_HAND_MODEL_PROFILES = data;
  global.HobunjiHandModelProfiles = {
    schema: DEFAULT_DATA.schema,
    get data() { return data; },
    get defaultData() { return normalizeData(DEFAULT_DATA); },
    clone: () => clone(data),
    replace,
    mutate,
    saveLocal,
    loadLocal,
    clearLocal,
    subscribe,
    modelKeyForSpecies,
    modelForSpecies,
    handTransformForSpecies,
    speciesScaleFor,
    footScaleFor,
    modelScaleFor,
    effectiveScaleFor,
    normalizeHandTransform: normalizeTransform,
    updateModelHandTransform,
    orthogonalCorrectionQuaternion,
    snapQuaternionToRightAngles,
  };
})(window);
