// Reusable hand-model profiles shared by gameplay and the Attack Animation Editor.
// Model scale corrects the imported GLB itself. Species/gender scale is applied on top.
// Source-hand convention: authored GLBs are LEFT hands by default — palm away from
// camera, fingers down, thumb left. The runtime right hand is the local-X mirror.
// Per-model mirrorX remains configurable so an asset authored in the opposite basis
// can opt out without changing every other hand model. Tool grip origin is 0,0,0.
// handFromTool is the model-specific fine alignment relative to the selected grip mode.
(function (global) {
  'use strict';

  const DEFAULT_MODEL_SCALE = 2;
  const IDENTITY_TRANSFORM = Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotationDeg: Object.freeze({ pitch: 0, yaw: 0, roll: 0 }),
  });

  function identityTransform() {
    return {
      position: { ...IDENTITY_TRANSFORM.position },
      rotationDeg: { ...IDENTITY_TRANSFORM.rotationDeg },
    };
  }

  const DEFAULT_DATA = {
    schema: 'hobunji_hand_model_profiles.v1',
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
        handFromTool: identityTransform(),
        // Legacy no-op retained so older code/config readers do not break.
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'bone' },
      },
      sloth: {
        glb: 'assets/models/hands/hand_sloth.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: identityTransform(),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'bone' },
      },
      feline: {
        glb: 'assets/models/hands/hand_feline.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: identityTransform(),
        toolGrip: identityTransform(),
        materialRoles: { MAT_None_7a4e2e: 'body' },
      },
      parrot: {
        glb: 'assets/models/hands/hand_parrot.glb',
        scale: DEFAULT_MODEL_SCALE,
        mirrorX: true,
        handFromTool: identityTransform(),
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

  function normalizeData(raw) {
    const next = clone(raw || DEFAULT_DATA);
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
    for (const model of Object.values(next.models)) {
      if (!model || typeof model !== 'object') continue;
      const modelScale = Number(model.scale);
      if (!Number.isFinite(modelScale) || modelScale <= 0) model.scale = DEFAULT_MODEL_SCALE;
      // New/missing values inherit the corrected left-source convention. Explicit
      // false remains a valid per-model override for a GLB authored as a right hand.
      model.mirrorX = model.mirrorX !== false;
      // Older drafts authored a tool socket on the hand. Migrate that into the
      // direct hand-from-tool convention. Position/rotation negation is exact for
      // identity/single-axis drafts and a safe visual approximation for old drafts.
      if (!model.handFromTool) {
        const legacy = normalizeTransform(model.toolGrip);
        model.handFromTool = {
          position: {
            x: -legacy.position.x,
            y: -legacy.position.y,
            z: -legacy.position.z,
          },
          rotationDeg: {
            pitch: -legacy.rotationDeg.pitch,
            yaw: -legacy.rotationDeg.yaw,
            roll: -legacy.rotationDeg.roll,
          },
        };
      } else {
        model.handFromTool = normalizeTransform(model.handFromTool);
      }
      // ProceduralArmAnimation's legacy model-socket path still reads toolGrip.
      // Keep it identity so the arm endpoint is the actual hand root; the shared
      // frame driver/grip-mode layer applies handFromTool before solving IK.
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
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MODEL_SCALE;
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
