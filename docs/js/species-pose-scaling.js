// Shared species/gender weapon-pose orbit scaling.
//
// Attack poses remain authored in Mao'ao space. The finished weapon point is
// orbited around the avatar's visual/body centroid. Orbit size is an explicit
// species+gender authoring value; anatomical armLength remains a separate
// measurement and is used only as a backwards-compatible fallback for
// old/missing config.
//
// An entry is either one number (X and Z scaled alike, Y untouched: the original
// contract) or { x, y, z } so a species can set each axis independently:
//   x  lateral (side-to-side) distance of the weapon from the body centre
//   z  forward/back distance
//   y  EXTRA vertical multiplier layered on the rigger-derived body-height
//      mapping (1 = exactly the rigger's height mapping)
// A missing axis in an object is 1. X/Z are the pose's own axes, i.e. they turn
// with the character's facing (pass `yawRad` when the point is in world space).
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
  // Accepts a number or { x, y, z }; returns the axes, or null when the value is not usable.
  function axesFromValue(value) {
    const uniform = validScale(value);
    if (uniform != null) return { x: uniform, y: 1, z: uniform };
    if (!value || typeof value !== 'object') return null;
    const x = validScale(value.x), y = validScale(value.y), z = validScale(value.z);
    if (x == null && y == null && z == null) return null;
    return { x: x ?? 1, y: y ?? 1, z: z ?? 1 };
  }
  // What is stored/exported: a plain number stays a number, an object keeps only its valid axes.
  function sanitizeEntry(value) {
    const uniform = validScale(value);
    if (uniform != null) return uniform;
    if (!value || typeof value !== 'object') return null;
    const out = {};
    for (const axis of ['x', 'y', 'z']) {
      const n = validScale(value[axis]);
      if (n != null) out[axis] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  function normalizeConfig(raw) {
    const next = clone(DEFAULT_CONFIG);
    if (raw?.schema) next.schema = String(raw.schema);
    for (const [speciesId, genders] of Object.entries(raw?.species || {})) {
      const key = normalizeSpeciesId(speciesId);
      if (!key || !genders || typeof genders !== 'object') continue;
      next.species[key] = { ...(next.species[key] || {}) };
      for (const [gender, value] of Object.entries(genders)) {
        const entry = sanitizeEntry(value);
        if (entry != null) next.species[key][normalizeGender(gender)] = entry;
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
  // Per-axis orbit for a poseOrbitScale value (number or { x, y, z }); null falls back to arm length.
  function axesForPose(poseOrbitScale, armLength) {
    const arm = scaleForArmLength(armLength);
    return axesFromValue(poseOrbitScale) ?? { x: arm, y: 1, z: arm };
  }
  // Horizontal (X) orbit as one number: the original single-scale contract. Use axesForPose for Y/Z.
  function scaleForPose(poseOrbitScale, armLength) {
    return axesForPose(poseOrbitScale, armLength).x;
  }
  function resolveAxes(speciesId, gender, armLength = null) {
    const key = normalizeSpeciesId(speciesId);
    const authored = axesFromValue(config.species?.[key]?.[normalizeGender(gender)]);
    return authored ?? axesForPose(null, armLength);
  }
  function resolveScale(speciesId, gender, armLength = null) {
    return resolveAxes(speciesId, gender, armLength).x;
  }
  // The stored entry exactly as authored (number or object), or null: lets inheritance copy it without flattening.
  function resolveAuthored(speciesId, gender) {
    const entry = config.species?.[normalizeSpeciesId(speciesId)]?.[normalizeGender(gender)];
    return entry == null ? null : clone(entry);
  }
  function setScale(speciesId, gender, value) {
    const key = normalizeSpeciesId(speciesId);
    const g = normalizeGender(gender);
    const entry = sanitizeEntry(value);
    if (!key || entry == null) return false;
    if (!config.species[key]) config.species[key] = {};
    config.species[key][g] = entry;
    const scale = axesFromValue(entry);
    for (const listener of listeners) {
      try { listener({ speciesId: key, gender: g, scale: scale.x, axes: scale, config: clone(config) }); } catch {}
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

  // Scales the horizontal offset (dx, dz) by sx along the pose's lateral axis and sz along its forward axis.
  // yawRad is the facing of the pose frame when the point is in world space (right = (cos, -sin), forward =
  // (sin, cos), as game.js builds its vRX/vFX); 0/omitted means the coordinates already ARE the pose frame
  // (editor rig space, avatar-local previews). Equal scales are rotation-invariant, so they skip the frame.
  function scaleHorizontal(dx, dz, sx, sz, yawRad) {
    const yaw = Number(yawRad);
    if (sx === sz || !Number.isFinite(yaw) || yaw === 0) return [dx * sx, dz * sz];
    const c = Math.cos(yaw), n = Math.sin(yaw);
    const a = (dx * c - dz * n) * sx; // lateral
    const b = (dx * n + dz * c) * sz; // forward
    return [a * c + b * n, -a * n + b * c];
  }

  // Compatibility surface retained for older callers. Y must never be derived from a plain-number poseOrbitScale:
  // the orbit's own Y multiplier is 1 unless a species authors it, and Y is otherwise owned by the rigger-height mapping below.
  // An authored Y multiplier pivots on the centroid here but on the hand anchor (baseY) in transformPosePoint, which is the
  // authority: every shipped consumer calls it first and only falls back to this when it is missing.
  function scalePointAroundCentroid(point, cx, cy, cz, armLength, poseOrbitScale, yawRad = 0) {
    if (!point) return point;
    const axes = axesForPose(poseOrbitScale, armLength);
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cz].every(Number.isFinite)) return point;
    const [dx, dz] = scaleHorizontal(x - cx, z - cz, axes.x, axes.z, yawRad);
    const nextY = axes.y === 1 || !Number.isFinite(cy) ? y : cy + (y - cy) * axes.y;
    if (typeof point.set === 'function') point.set(cx + dx, nextY, cz + dz);
    else { point.x = cx + dx; point.y = nextY; point.z = cz + dz; }
    return point;
  }

  function unscalePointAroundCentroid(point, cx, cy, cz, armLength, poseOrbitScale, yawRad = 0) {
    if (!point) return point;
    const axes = axesForPose(poseOrbitScale, armLength);
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    if (![x, y, z, cx, cz].every(Number.isFinite) || !(axes.x > 0) || !(axes.y > 0) || !(axes.z > 0)) return point;
    const [dx, dz] = scaleHorizontal(x - cx, z - cz, 1 / axes.x, 1 / axes.z, yawRad);
    const nextY = axes.y === 1 || !Number.isFinite(cy) ? y : cy + (y - cy) / axes.y;
    if (typeof point.set === 'function') point.set(cx + dx, nextY, cz + dz);
    else { point.x = cx + dx; point.y = nextY; point.z = cz + dz; }
    return point;
  }

  // Applies the complete weapon-position mapping. baseY is the UNSCALED
  // floor-relative hand/tool anchor produced by PNGPlaneAvatar. That anchor
  // already includes portrait scale, vertical placement, and real opaque-art
  // grounding. The rigger's whole-body Y scale is applied around floorY, then
  // authored pose displacement from that hand anchor is scaled by the ratio of
  // actual full character height to the canonical Mao'ao-male authoring height
  // (times the orbit's own Y multiplier, 1 unless authored). options.yawRad: see
  // scaleHorizontal.
  function transformPosePoint(point, options = {}) {
    if (!point) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    const cx = Number(options.cx) || 0;
    const cz = Number(options.cz) || 0;
    const floorY = Number(options.floorY) || 0;
    const baseY = Number(options.baseY);
    if (![x, y, z, cx, cz, floorY, baseY].every(Number.isFinite)) return point;
    const axes = axesForPose(options.poseOrbitScale, options.armLength);
    const metrics = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY);
    const scaledBaseY = floorY + (baseY - floorY) * metrics.rigScaleY;
    const [dx, dz] = scaleHorizontal(x - cx, z - cz, axes.x, axes.z, options.yawRad);
    const nextY = scaledBaseY + (y - baseY) * metrics.heightRatio * axes.y;
    if (typeof point.set === 'function') point.set(cx + dx, nextY, cz + dz);
    else { point.x = cx + dx; point.y = nextY; point.z = cz + dz; }
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
    const axes = axesForPose(options.poseOrbitScale, options.armLength);
    const metrics = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY);
    if (!(axes.x > 0) || !(axes.y > 0) || !(axes.z > 0) || !(metrics.heightRatio > 0)) return point;
    const scaledBaseY = floorY + (baseY - floorY) * metrics.rigScaleY;
    const [dx, dz] = scaleHorizontal(x - cx, z - cz, 1 / axes.x, 1 / axes.z, options.yawRad);
    const nextY = baseY + (y - scaledBaseY) / (metrics.heightRatio * axes.y);
    if (typeof point.set === 'function') point.set(cx + dx, nextY, cz + dz);
    else { point.x = cx + dx; point.y = nextY; point.z = cz + dz; }
    return point;
  }

  // Head-relative poses are authored on the Mao'ao-male baseline from the visible head, so they follow the character's
  // BODY SIZE (the same actual-height / Mao'ao-male-height ratio the weapon sprite and the pose Y mapping use), uniformly
  // on every axis. The species orbit axes are an arm-reach limit for hand-relative poses and must not cap a head offset:
  // they would cut a forward offset to e.g. half on Tletingan. The offset is in the pose's own frame (before any
  // facing/aim rotation), so no yaw is needed. `inverse` maps a concrete offset back to authored baseline units.
  function scaleHeadOffset(offset, options = {}, inverse = false) {
    if (!offset) return offset;
    const x = Number(offset.x), y = Number(offset.y), z = Number(offset.z);
    if (![x, y, z].every(Number.isFinite)) return offset;
    const ratio = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY).heightRatio;
    if (!(ratio > 0)) return offset;
    const k = inverse ? 1 / ratio : ratio;
    if (typeof offset.set === 'function') offset.set(x * k, y * k, z * k);
    else { offset.x = x * k; offset.y = y * k; offset.z = z * k; }
    return offset;
  }
  function unscaleHeadOffset(offset, options = {}) { return scaleHeadOffset(offset, options, true); }

  function repoConfigUrl() {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return CONFIG_PATH;
    const scriptUrl = document.currentScript?.src || '';
    try { return new URL('../' + CONFIG_PATH, scriptUrl).href; } catch { return CONFIG_PATH; }
  }
  let loadGeneration = 0; // Used to prevent an older repo fetch from overwriting a newer LocalDB-selected source.
  let readyPromise = Promise.resolve(getConfig()); // Always points at the newest selected-source load for callers that await .ready.

  async function loadConfig() {
    const generation = ++loadGeneration; // Identifies this request so only the newest source selection may publish its result.
    try {
      const loaded = window.LocalDBOverrides?.loadDatabase
        ? await window.LocalDBOverrides.loadDatabase(CONFIG_ID)
        : (typeof window.fetch === 'function'
          ? await window.fetch(repoConfigUrl()).then(resp => {
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return resp.json();
            })
          : null);
      if (loaded && generation === loadGeneration) replaceConfig(loaded);
    } catch (error) {
      if (generation === loadGeneration) {
        console.warn?.('[species-pose-scale] Could not load authored orbit scales; using legacy-compatible defaults.', error);
      }
    }
    return getConfig();
  }
  function reloadFromDatabaseSource() {
    readyPromise = loadConfig();
    return readyPromise;
  }
  readyPromise = loadConfig();

  window.HobunjiSpeciesPoseScale = Object.freeze({
    CONFIG_ID,
    CONFIG_PATH,
    MAO_AO_ARM_LENGTH,
    get ready() { return readyPromise; },
    reloadFromDatabaseSource,
    scaleForArmLength, // Compatibility/debug only; new pose consumers should use explicit poseOrbitScale.
    scaleForPose,
    axesForPose,
    axesFromValue,
    resolveScale,
    resolveAxes,
    resolveAuthored,
    resolveRigScaleY,
    portraitModelHeightFor,
    heightMetrics,
    scaleHeadOffset,
    unscaleHeadOffset,
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
