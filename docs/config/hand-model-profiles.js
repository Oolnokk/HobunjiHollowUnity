// Reusable hand-model socket profiles shared by gameplay and the Attack Animation Editor.
// Model scale corrects the imported GLB itself. Species/gender scale is applied on top.
(function (global) {
  'use strict';

  const DEFAULT_DATA = {
    schema: 'hobunji_hand_model_profiles.v1',
    handHeightFraction: 0.12,
    colors: { bone: '#D8C7A3', keratin: '#44484D' },
    models: {
      pachyderm: {
        glb: 'assets/models/hands/hand_pachyderm.glb',
        scale: 1,
        toolGrip: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } },
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'bone' },
      },
      sloth: {
        glb: 'assets/models/hands/hand_sloth.glb',
        scale: 1,
        toolGrip: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } },
        materialRoles: { MAT_None_7a4e2e: 'body', MAT_EyeSurface_0c0c0c: 'bone' },
      },
      feline: {
        glb: 'assets/models/hands/hand_feline.glb',
        scale: 1,
        toolGrip: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } },
        materialRoles: { MAT_None_7a4e2e: 'body' },
      },
      parrot: {
        glb: 'assets/models/hands/hand_parrot.glb',
        scale: 1,
        toolGrip: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { pitch: 0, yaw: 0, roll: 0 } },
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
  let data = clone(DEFAULT_DATA); // Mutable editor/runtime copy; exported rather than mutating DEFAULT_DATA.
  const listeners = new Set(); // Used by live hand rigs/editor controls to refresh after a profile edit.

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function normalizeGender(value) { return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male'; }
  function parentSpecies(species) {
    return normalizeKey(global.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.[species]?.parentSpecies);
  }
  function modelKeyForSpecies(speciesId) {
    const seen = new Set(); // Prevents malformed parent-species cycles while resolving model inheritance.
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
  function footScaleFor(speciesId, gender) {
    const table = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale || {};
    const g = normalizeGender(gender);
    const seen = new Set(); // Prevents malformed parent-species cycles during foot-scale fallback.
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
    const seen = new Set(); // Prevents malformed parent-species cycles during authored hand-scale lookup.
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
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  function effectiveScaleFor(speciesId, gender) {
    return modelScaleFor(speciesId) * speciesScaleFor(speciesId, gender);
  }
  function notify() { for (const fn of listeners) { try { fn(data); } catch (_) {} } }
  function replace(next) {
    if (!next || next.schema !== DEFAULT_DATA.schema) throw new Error(`Expected ${DEFAULT_DATA.schema}`);
    data = clone(next);
    global.HOBUNJI_HAND_MODEL_PROFILES = data; // Keeps the legacy/global data alias synchronized after imports or resets.
    notify();
    return data;
  }
  function mutate(mutator) {
    mutator(data);
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
    get defaultData() { return clone(DEFAULT_DATA); },
    clone: () => clone(data),
    replace,
    mutate,
    saveLocal,
    loadLocal,
    clearLocal,
    subscribe,
    modelKeyForSpecies,
    modelForSpecies,
    speciesScaleFor,
    footScaleFor,
    modelScaleFor,
    effectiveScaleFor,
  };
})(window);
