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
      'mao-ao': Object.freeze({ male: 1, female: 0.9 }),
      'engh-sho': Object.freeze({ male: 0.7, female: 0.65 }),
      kenkari: Object.freeze({ male: 0.5, female: 0.4 }),
      rakakoan: Object.freeze({ male: 0.5, female: 0.4 }),
      mashtzarr: Object.freeze({ male: 0.8, female: 0.65 }),
      tletingan: Object.freeze({ male: 0.5, female: 0.47 }),
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

  // Horizontal weapon distance and vertical body proportion are deliberately
  // different ownership domains:
  //   X/Z: the explicitly authored species+gender poseOrbitScale.
  //   Y:   the character rigger's actual body-height stack.
  //
  // PNGPlaneAvatar has already baked portraitScale + portraitVerticalPlacement
  // into modelHeight / handAttachY. HobunjiCharacterRigScale then scales the
  // assembled character around floor Y=0. Head scale/Y offset, age hunch, hand
  // scale, and foot scale are separate presentation layers and do not belong here.
  function resolveRigScaleY(speciesId, gender, explicit = null) {
    const direct = validScale(explicit);
    if (direct != null) return direct;
    const key = normalizeSpeciesId(speciesId);
    const g = normalizeGender(gender);
    const live = validScale(window.HobunjiCharacterRigScale?.scaleFor?.(key, g)?.y);
    if (live != null) return live;
    const profile = validScale(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${key}::${g}`]?.anatomy?.rigScaleY);
    if (profile != null) return profile;
    return validScale(window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(key, g)?.y) ?? 1;
  }

  function portraitModelHeightFor(speciesId, gender, fallback = null) {
    const explicit = validScale(fallback);
    if (explicit != null) return explicit;
    const png = window.PNGPlaneAvatar;
    const cfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const baseHeight = validScale(cfg.worldModelWidth) ?? validScale(cfg.modelWidth) ?? 0.9;
    const portraitScale = validScale(png?.avatarScaleMultiplierFor?.({ speciesId, gender }))
      ?? (() => {
        const key = normalizeSpeciesId(speciesId);
        const g = normalizeGender(gender);
        const raw = cfg.portraitScaleBySpecies?.[key];
        return validScale(raw && typeof raw === 'object' ? (raw[g] ?? raw.default) : raw) ?? 1;
      })();
    return baseHeight * portraitScale;
  }

  function heightMetrics(speciesId, gender, modelHeight = null, rigScaleY = null) {
    const targetModelHeight = portraitModelHeightFor(speciesId, gender, modelHeight);
    const targetRigScaleY = resolveRigScaleY(speciesId, gender, rigScaleY);
    const referenceModelHeight = portraitModelHeightFor('mao-ao', 'male');
    const referenceRigScaleY = resolveRigScaleY('mao-ao', 'male');
    const effectiveHeight = targetModelHeight * targetRigScaleY;
    const referenceHeight = referenceModelHeight * referenceRigScaleY;
    return {
      modelHeight: targetModelHeight,
      rigScaleY: targetRigScaleY,
      effectiveHeight,
      referenceModelHeight,
      referenceRigScaleY,
      referenceHeight,
      heightRatio: referenceHeight > 0 ? effectiveHeight / referenceHeight : 1,
    };
  }

  // Compatibility surface retained for older callers: orbit scaling is now
  // HORIZONTAL ONLY. Y must never be derived from poseOrbitScale again.
  function scalePointAroundCentroid(point, cx, cy, cz, armLength, poseOrbitScale) {
    if (!point) return point;
    const scale = scaleForPose(poseOrbitScale, armLength);
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cz].every(Number.isFinite)) return point;
    const nextX = scale === 1 ? x : cx + (x - cx) * scale;
    const nextZ = scale === 1 ? z : cz + (z - cz) * scale;
    if (typeof point.set === 'function') point.set(nextX, y, nextZ);
    else { point.x = nextX; point.y = y; point.z = nextZ; }
    return point;
  }

  function unscalePointAroundCentroid(point, cx, cy, cz, armLength, poseOrbitScale) {
    if (!point) return point;
    const scale = scaleForPose(poseOrbitScale, armLength);
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cz].every(Number.isFinite) || !(scale > 0)) return point;
    const nextX = scale === 1 ? x : cx + (x - cx) / scale;
    const nextZ = scale === 1 ? z : cz + (z - cz) / scale;
    if (typeof point.set === 'function') point.set(nextX, y, nextZ);
    else { point.x = nextX; point.y = y; point.z = nextZ; }
    return point;
  }

  // Applies the complete weapon-position mapping. baseY is the UNSCALED
  // floor-relative hand/tool anchor produced by PNGPlaneAvatar. That anchor
  // already includes portrait scale, vertical placement, and real opaque-art
  // grounding. The rigger's whole-body Y scale is applied around floorY, then
  // authored pose displacement from that hand anchor is scaled by the ratio of
  // actual full character height to the canonical Mao'ao-male authoring height.
  function transformPosePoint(point, options = {}) {
    if (!point) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    const cx = Number(options.cx) || 0;
    const cz = Number(options.cz) || 0;
    const floorY = Number(options.floorY) || 0;
    const baseY = Number(options.baseY);
    if (![x, y, z, cx, cz, floorY, baseY].every(Number.isFinite)) return point;
    const orbitScale = scaleForPose(options.poseOrbitScale, options.armLength);
    const metrics = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY);
    const scaledBaseY = floorY + (baseY - floorY) * metrics.rigScaleY;
    const nextX = orbitScale === 1 ? x : cx + (x - cx) * orbitScale;
    const nextY = scaledBaseY + (y - baseY) * metrics.heightRatio;
    const nextZ = orbitScale === 1 ? z : cz + (z - cz) * orbitScale;
    if (typeof point.set === 'function') point.set(nextX, nextY, nextZ);
    else { point.x = nextX; point.y = nextY; point.z = nextZ; }
    return point;
  }

  function untransformPosePoint(point, options = {}) {
    if (!point) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    const cx = Number(options.cx) || 0;
    const cz = Number(options.cz) || 0;
    const floorY = Number(options.floorY) || 0;
    const baseY = Number(options.baseY);
    if (![x, y, z, cx, cz, floorY, baseY].every(Number.isFinite)) return point;
    const orbitScale = scaleForPose(options.poseOrbitScale, options.armLength);
    const metrics = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY);
    if (!(orbitScale > 0) || !(metrics.heightRatio > 0)) return point;
    const scaledBaseY = floorY + (baseY - floorY) * metrics.rigScaleY;
    const nextX = orbitScale === 1 ? x : cx + (x - cx) / orbitScale;
    const nextY = baseY + (y - scaledBaseY) / metrics.heightRatio;
    const nextZ = orbitScale === 1 ? z : cz + (z - cz) / orbitScale;
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
    resolveRigScaleY,
    portraitModelHeightFor,
    heightMetrics,
    setScale,
    replaceConfig,
    getConfig,
    subscribe,
    scalePointAroundCentroid,
    unscalePointAroundCentroid,
    transformPosePoint,
    untransformPosePoint,
  });
})();
