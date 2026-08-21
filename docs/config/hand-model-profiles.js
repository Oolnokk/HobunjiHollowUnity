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
  const SHARED_ALIGNMENT_PRESET = 'all-species-direction-90--90-0-v1';
  const MODEL_SCALE_PRESET = 'hands-92_5-feet-120-v2';
  const IDENTITY_TRANSFORM = Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotationDeg: Object.freeze({ pitch: 0, yaw: 0, roll: 0 }),
  });
  // Canonical alignment is intentionally reused for every species/model.
  // Kenkari/Rakako'an use the opposite source-X mirror on their parrot hand model below.
  const MAO_AO_HAND_TRANSFORM = Object.freeze({
    position: Object.freeze({ x: -0.07, y: -0.13, z: 0.21 }),
    rotationDeg: Object.freeze({ pitch: 90, yaw: -90, roll: 0 }),
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

  function defaultScaleForModel(modelKey) {
    return modelKey === 'parrot' ? PARROT_MODEL_SCALE : DEFAULT_MODEL_SCALE;
  }

  const DEFAULT_DATA = {
    schema: 'hobunji_hand_model_profiles.v1',
    alignmentPreset: SHARED_ALIGNMENT_PRESET,
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
        handFromTool: maoAoHandTransform(),
        // Legacy no-op retained so older code/config readers do not break.
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'bone' },
      },
      sloth: {
        glb: 'assets/models/hands/hand_sloth.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: maoAoHandTransform(),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'bone' },
      },
      feline: {
        glb: 'assets/models/hands/hand_feline.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: maoAoHandTransform(),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body' },
      },
      parrot: {
        glb: 'assets/models/hands/hand_parrot.glb',
        scale: PARROT_MODEL_SCALE,
        // Kenkari/Rakako'an use the shared setup with the source handedness flipped.
        mirrorX: false,
        handFromTool: maoAoHandTransform(),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'keratin' },
      },
    },
    speciesModels: {
      mashtzarr: 'pachyderm',
      tletingan: 'sloth',
      'mao-ao': 'feline',
      'engh-sho': 'feline',
      kenkari: 'parrot',
      rakakoan: 'parrot',
    },
    // Missing overrides deliberately inherit proceduralFeet.footScale.
    speciesScaleOverrides: {},
  };

  const LOCAL_KEY = 'hobunji.handModelProfiles.v1';
  const clone = value => JSON.parse(JSON.stringify(value));

  function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeTransform(raw) {
    return {
      position: {
        x: numberOrZero(raw?.position?.x),
        y: numberOrZero(raw?.position?.y),
        z: numberOrZero(raw?.position?.z),
      },
      rotationDeg: {
        pitch: numberOrZero(raw?.rotationDeg?.pitch),
        yaw: numberOrZero(raw?.rotationDeg?.yaw),
        roll: numberOrZero(raw?.rotationDeg?.roll),
      },
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

  function invertTransform(raw) {
    const transform = normalizeTransform(raw);
    const q = quatFromYXZ(transform.rotationDeg); // Represents the legacy hand→tool rotation being inverted below.
    const inverseQ = { x: -q.x, y: -q.y, z: -q.z, w: q.w }; // Unit-quaternion conjugate gives the exact reverse rotation.
    const inversePosition = rotateVectorByQuat({
      x: -transform.position.x,
      y: -transform.position.y,
      z: -transform.position.z,
    }, inverseQ); // A rigid inverse must rotate -translation by R^-1; plain sign negation is only correct when R is identity.
    return {
      position: inversePosition,
      rotationDeg: eulerYXZFromQuat(inverseQ),
    };
  }

  function normalizeData(raw) {
    const next = clone(raw || DEFAULT_DATA);
    const previousScalePreset = next.modelScalePreset; // Distinguishes the oldest 2x parrot default from the later 3x preset during migration.
    const migrateToSharedAlignment = next.alignmentPreset !== SHARED_ALIGNMENT_PRESET;
    const migrateSizeBalance = next.modelScalePreset !== MODEL_SCALE_PRESET; // Applies the new global reduction once to saved/custom profiles.
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
        model.handFromTool = maoAoHandTransform();
        model.mirrorX = modelKey === 'parrot' ? false : true;
      } else {
        // New/missing values inherit the corrected left-source convention. Explicit
        // false remains a valid per-model override for a GLB authored as a right hand.
        model.mirrorX = model.mirrorX !== false;
      }
      // Older hand-profile drafts may still contain model.shoulderAim. It is now
      // deliberately discarded because shoulder-axis choices belong to poses.
      delete model.shoulderAim;
      // Older drafts authored a tool socket on the hand. Migrate that into the
      // direct hand-from-tool convention only when no explicit direct transform exists.
      if (!model.handFromTool) {
        model.handFromTool = invertTransform(model.toolGrip);
      } else {
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
  function notify() { for (const fn of listeners) { try { fn(data); } catch (_) {} } }
  function replace(next) {
    if (!next || next.schema !== DEFAULT_DATA.schema) throw new Error(`Expected ${DEFAULT_DATA.schema}`);
    data = normalizeData(next);
    global.HOBUNJI_HAND_MODEL_PROFILES = data;
    notify();
    return data;
  }
  function mutate(mutator) {
    mutator(data);
    data = normalizeData(data);
    global.HOBUNJI_HAND_MODEL_PROFILES = data;
    notify();
    return data;
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
  };
})(window);
