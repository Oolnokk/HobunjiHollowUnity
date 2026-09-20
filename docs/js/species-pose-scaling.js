// Shared species/gender weapon-pose orbit scaling.
//
// Attack poses remain authored in Mao'ao space. The finished weapon point is
// uniformly orbited around the avatar's visual/body centroid. Orbit size is an
// explicit species+gender authoring value now; anatomical armLength remains a
// separate measurement and is used only as a backwards-compatible fallback for
// old/missing config.
(() => {
  'use strict';

  const CONFIG_ID = 'speciesPoseOrbitScales';
  const CONFIG_PATH = 'config/combat/species-pose-orbit-scales.json';
  const MAO_AO_ARM_LENGTH = 0.558; // Legacy fallback baseline only.
  const DEFAULT_CONFIG = Object.freeze({
    schema: 'hobunji_species_pose_orbit_scales.v1',
    species: Object.freeze({
      'mao-ao': Object.freeze({ male: 1, female: 1 }),
      'engh-sho': Object.freeze({ male: 1, female: 1 }),
      kenkari: Object.freeze({ male: 1, female: 1 }),
      rakakoan: Object.freeze({ male: 1, female: 1 }),
      mashtzarr: Object.freeze({ male: 1, female: 1 }),
      tletingan: Object.freeze({ male: 0.612 / 0.558, female: 0.603 / 0.558 }),
    }),
  });
  const ALIASES = Object.freeze({ ghoul: 'mao-ao' });
  const listeners = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));

  function normalizeSpeciesId(value) {
    const key = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    return ALIASES[key] || key;
  }
  function normalizeGender(value) {
    return String(value || 'male').trim().toLowerCase() || 'male';
  }
  function validScale(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function normalizeConfig(raw) {
    const next = clone(DEFAULT_CONFIG);
    if (raw?.schema) next.schema = String(raw.schema);
    for (const [speciesId, genders] of Object.entries(raw?.species || {})) {
      const key = normalizeSpeciesId(speciesId);
      if (!key || !genders || typeof genders !== 'object') continue;
      next.species[key] = { ...(next.species[key] || {}) };
      for (const [gender, value] of Object.entries(genders)) {
        const scale = validScale(value);
        if (scale != null) next.species[key][normalizeGender(gender)] = scale;
      }
    }
    next.schema = 'hobunji_species_pose_orbit_scales.v1';
    return next;
  }

  let config = normalizeConfig(DEFAULT_CONFIG);

  function scaleForArmLength(armLength) {
    const reach = Number(armLength);
    return Number.isFinite(reach) && reach > 0 ? reach / MAO_AO_ARM_LENGTH : 1;
  }
  function scaleForPose(poseOrbitScale, armLength) {
    return validScale(poseOrbitScale) ?? scaleForArmLength(armLength);
  }
  function resolveScale(speciesId, gender, armLength = null) {
    const key = normalizeSpeciesId(speciesId);
    const authored = validScale(config.species?.[key]?.[normalizeGender(gender)]);
    return authored ?? scaleForArmLength(armLength);
  }
  function setScale(speciesId, gender, value) {
    const key = normalizeSpeciesId(speciesId);
    const g = normalizeGender(gender);
    const scale = validScale(value);
    if (!key || scale == null) return false;
    if (!config.species[key]) config.species[key] = {};
    config.species[key][g] = scale;
    for (const listener of listeners) {
      try { listener({ speciesId: key, gender: g, scale, config: clone(config) }); } catch {}
    }
    return true;
  }
  function replaceConfig(raw) {
    config = normalizeConfig(raw);
    for (const listener of listeners) {
      try { listener({ kind: 'replace', config: clone(config) }); } catch {}
    }
    return clone(config);
  }
  function getConfig() { return clone(config); }
  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function scalePointAroundCentroid(point, cx, cy, cz, armLength, poseOrbitScale) {
    if (!point) return point;
    const scale = scaleForPose(poseOrbitScale, armLength);
    if (scale === 1) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cy, cz].every(Number.isFinite)) return point;
    const nextX = cx + (x - cx) * scale;
    const nextY = cy + (y - cy) * scale;
    const nextZ = cz + (z - cz) * scale;
    if (typeof point.set === 'function') point.set(nextX, nextY, nextZ);
    else { point.x = nextX; point.y = nextY; point.z = nextZ; }
    return point;
  }

  function unscalePointAroundCentroid(point, cx, cy, cz, armLength, poseOrbitScale) {
    if (!point) return point;
    const scale = scaleForPose(poseOrbitScale, armLength);
    if (scale === 1) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cy, cz].every(Number.isFinite)) return point;
    const nextX = cx + (x - cx) / scale;
    const nextY = cy + (y - cy) / scale;
    const nextZ = cz + (z - cz) / scale;
    if (typeof point.set === 'function') point.set(nextX, nextY, nextZ);
    else { point.x = nextX; point.y = nextY; point.z = nextZ; }
    return point;
  }

  function repoConfigUrl() {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return CONFIG_PATH;
    const scriptUrl = document.currentScript?.src || '';
    try { return new URL('../' + CONFIG_PATH, scriptUrl).href; } catch { return CONFIG_PATH; }
  }
  async function loadConfig() {
    try {
      const loaded = window.LocalDBOverrides?.loadDatabase
        ? await window.LocalDBOverrides.loadDatabase(CONFIG_ID)
        : (typeof window.fetch === 'function'
          ? await window.fetch(repoConfigUrl()).then(resp => {
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return resp.json();
            })
          : null);
      if (loaded) replaceConfig(loaded);
    } catch (error) {
      console.warn?.('[species-pose-scale] Could not load authored orbit scales; using legacy-compatible defaults.', error);
    }
    return getConfig();
  }
  const ready = loadConfig();

  window.HobunjiSpeciesPoseScale = Object.freeze({
    CONFIG_ID,
    CONFIG_PATH,
    MAO_AO_ARM_LENGTH,
    ready,
    reloadFromDatabaseSource: loadConfig,
    scaleForArmLength, // Compatibility/debug only; new pose consumers should use explicit poseOrbitScale.
    scaleForPose,
    resolveScale,
    setScale,
    replaceConfig,
    getConfig,
    subscribe,
    scalePointAroundCentroid,
    unscalePointAroundCentroid,
  });
})();
