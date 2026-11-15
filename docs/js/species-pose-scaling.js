// Shared species/gender weapon-pose orbit scaling.
//
// Attack poses remain authored in Mao'ao space. When the attachment rig has
// both shoulder targets, the weapon orbit is centred on their 3D midpoint.
// Its final diameter is twice the rendered arm reach plus the 3D shoulder
// separation. Older species-orbit multipliers remain only as fallback for
// characters whose shoulder geometry is unavailable.
//
// An entry is either one number (the same X/Y/Z multiplier: spherical scaling)
// or { x, y, z } for deliberately non-spherical, independently authored axes:
//   x  lateral (side-to-side) distance of the weapon from the body centre
//   z  forward/back distance
//   y  multiplier around the body centroid after rigger-derived body-height
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
      nuhongan: Object.freeze({ male: 0.5, female: 0.47 }), // Same startup orbit as the authored JSON, even before its asynchronous load.
      longoran: Object.freeze({ male: 0.5, female: 0.47 }), // Avoid transient fallback to anatomy during avatar construction.
    }),
  });
  const ALIASES = Object.freeze({ ghoul: 'mao-ao' });
  const ORBIT_PARENTS = Object.freeze({'mao-ao-skeleton':'mao-ao','maskbound-guardian':'mao-ao','harlyao':'engh-sho','harlyao-skeleton':'harlyao','omgurku':'engh-sho'});
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
    if (uniform != null) return { x: uniform, y: uniform, z: uniform };
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
    return axesFromValue(poseOrbitScale) ?? { x: arm, y: arm, z: arm };
  }
  // Scalar compatibility view: a number now affects all three axes; an explicit object exposes X here.
  function scaleForPose(poseOrbitScale, armLength) {
    return axesForPose(poseOrbitScale, armLength).x;
  }
  function resolveAxes(speciesId, gender, armLength = null) {
    const key = normalizeSpeciesId(speciesId);
    const authored = axesFromValue(resolveAuthored(key, gender));
    return authored ?? axesForPose(null, armLength);
  }
  function resolveScale(speciesId, gender, armLength = null) {
    return resolveAxes(speciesId, gender, armLength).x;
  }
  // The stored entry exactly as authored (number or object), or null: lets inheritance copy it without flattening.
  function resolveAuthored(speciesId, gender) {
    let key = normalizeSpeciesId(speciesId);
    const g = normalizeGender(gender);
    while (key) {
      const entry = config.species?.[key]?.[g];
      if (entry != null) return clone(entry);
      key = ORBIT_PARENTS[key];
    }
    return null;
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

  // A numeric species orbit scale then scales the resulting X/Y/Z vector
  // about the visual centroid isotropically, AFTER the rigger maps portrait
  // height onto the character. Explicit axis scales can instead form an ellipsoid.
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

  // Compatibility surface retained for older callers. The uniform orbit
  // multiplier uses this same X/Y/Z centroid; transformPosePoint additionally
  // adjusts the vertical frame for actual portrait and body proportions.
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

  // World displacement of the orbit centre by a hunched spine (options.orbitOffset, from HobunjiCharacterSpine.orbitOffsetWorld), in the pose
  // frame: x sideways, y vertical (negative = lower), z forward. Null/absent for an upright character.
  const NO_ORBIT_OFFSET = Object.freeze({ x: 0, y: 0, z: 0 });
  function orbitOffsetOf(options) {
    const offset = options?.orbitOffset;
    return offset && [offset.x, offset.y, offset.z].every(Number.isFinite) ? offset : NO_ORBIT_OFFSET;
  }
  // The same offset with its horizontal part turned into world X/Z by the pose frame's facing (right = (cos, -sin), forward = (sin, cos));
  // yawRad 0/omitted means the coordinates already ARE the pose frame.
  function orbitShift(options, out) {
    const offset = orbitOffsetOf(options), yaw = Number(options?.yawRad) || 0;
    const c = Math.cos(yaw), n = Math.sin(yaw);
    out.x = offset.x * c + offset.z * n;
    out.y = offset.y;
    out.z = -offset.x * n + offset.z * c;
    return out;
  }
  const orbitShiftScratch = { x: 0, y: 0, z: 0 };

  // Resolve the exact shoulder targets used by ProceduralHandShoulderAim (the
  // attachment-rig profile is its first-choice source). Read live: rig-author
  // edits must affect the orbit without an avatar rebuild.
  function shoulderTargetsFor(speciesId, gender) {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters;
    const alias = window.hobunjiTransformSpeciesId?.(speciesId) || normalizeSpeciesId(speciesId);
    let key = alias;
    while (key) {
      const profile = characters?.[`${key}::${normalizeGender(gender)}`];
      const left = profile?.anchors?.leftHandShoulder?.position;
      const right = profile?.anchors?.rightHandShoulder?.position;
      if (left && right && [left.x, left.y, left.z, right.x, right.y, right.z]
        .every(value => Number.isFinite(value))) return { profile, left, right };
      key = ORBIT_PARENTS[key];
    }
    return null;
  }

  // Return the *rendered* sphere, not the old authored species scale. All
  // positions use the same floor-relative, pose-facing frame as the shoulder
  // targets; the optional spine shift is applied once, after this mapping.
  // armLength is the completed rigger reach (PNGPlaneAvatar.userData.armLength),
  // before the whole-character Y scale. The shoulder gap is a true 3D distance.
  function shoulderOrbitGeometry(options = {}) {
    const speciesId = options.speciesId, gender = options.gender;
    const shoulders = shoulderTargetsFor(speciesId, gender);
    const reach = validScale(options.armLength);
    if (!shoulders || reach == null) return null;
    const rigY = resolveRigScaleY(speciesId, gender, options.rigScaleY);
    const authoredRig = window.HobunjiCharacterRigScale?.scaleFor?.(speciesId, gender);
    const defaultRigY = resolveRigScaleY(speciesId, gender);
    const explicitRigX = validScale(options.rigScaleX);
    const rigX = explicitRigX ?? (
      Math.abs(rigY - defaultRigY) < 1e-8 ? validScale(authoredRig?.x) ?? 1 : rigY
    ); // If a caller supplies a different Y frame (e.g. world-space NPC), keep the two axes in that same frame.
    const { left, right } = shoulders;
    const midX = (left.x + right.x) / 2, midY = (left.y + right.y) / 2, midZ = (left.z + right.z) / 2;
    const shoulderGap = Math.hypot((left.x - right.x) * rigX, (left.y - right.y) * rigY, (left.z - right.z) * rigX);
    const finalArmLength = reach * rigY; // The completed vertical shoulder-to-wrist reach in displayed units.
    const diameter = 2 * finalArmLength + shoulderGap;
    const reference = shoulderTargetsFor('mao-ao', 'male');
    const referenceHeight = portraitModelHeightFor('mao-ao', 'male');
    const referenceReach = validScale(window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterArmLength?.(
      reference?.profile, referenceHeight, referenceHeight / 2, null,
      reference?.profile?.anatomy?.portraitScale, reference?.profile?.anatomy?.portraitVerticalPlacementRatio
    ));
    if (!reference || referenceReach == null) return null;
    const refRigY = resolveRigScaleY('mao-ao', 'male');
    const refRigX = validScale(window.HobunjiCharacterRigScale?.scaleFor?.('mao-ao', 'male')?.x) ?? 1;
    const refGap = Math.hypot(
      (reference.left.x - reference.right.x) * refRigX,
      (reference.left.y - reference.right.y) * refRigY,
      (reference.left.z - reference.right.z) * refRigX
    );
    const referenceRadius = referenceReach * refRigY + refGap / 2;
    if (!(referenceRadius > 0) || !(diameter > 0)) return null;
    const yaw = Number(options.yawRad) || 0, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const cx = Number(options.cx) || 0, cz = Number(options.cz) || 0, floorY = Number(options.floorY) || 0;
    const center = {
      x: cx + (midX * cos + midZ * sin) * rigX,
      y: floorY + midY * rigY,
      z: cz + (-midX * sin + midZ * cos) * rigX,
    }; // Current sphere centre, halfway between the two rendered shoulder targets.
    const rawCenter = {
      x: center.x,
      y: floorY + midY,
      z: center.z,
    }; // X/Z hand bases are already rig-scaled in gameplay and editor; only the pose's vertical base is unscaled.
    return {
      center, rawCenter, diameter, radius: diameter / 2,
      shoulderGap, finalArmLength, referenceRadius,
      scale: diameter / (2 * referenceRadius),
    };
  }

  // Applies the complete weapon-position mapping. baseY is the UNSCALED
  // floor-relative hand/tool anchor produced by PNGPlaneAvatar. That anchor
  // already includes portrait scale, vertical placement, and real opaque-art
  // grounding. The rigger's whole-body Y scale is applied around floorY, then
  // authored pose displacement from that hand anchor is mapped by the ratio
  // of the character's real height to the canonical Mao'ao-male height. The
  // orbit uses the midpoint of the two shoulder targets and a sphere radius
  // of final arm reach plus half the shoulder gap. The old centroid/axes are
  // retained for assets missing an attachment-rig shoulder pair.
  function transformPosePoint(point, options = {}) {
    if (!point) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    const cx = Number(options.cx) || 0, cz = Number(options.cz) || 0;
    const floorY = Number(options.floorY) || 0, baseY = Number(options.baseY);
    if (![x, y, z, cx, cz, floorY, baseY].every(Number.isFinite)) return point;
    const orbit = shoulderOrbitGeometry(options); // Geometry-led sphere replaces authored scale when both shoulders exist.
    const shift = orbitShift(options, orbitShiftScratch);
    if (orbit) {
      const factor = orbit.scale, center = orbit.center, source = orbit.rawCenter;
      const nx = center.x + (x - source.x) * factor + shift.x;
      const ny = center.y + (y - source.y) * factor + shift.y;
      const nz = center.z + (z - source.z) * factor + shift.z;
      if (typeof point.set === 'function') point.set(nx, ny, nz);
      else { point.x = nx; point.y = ny; point.z = nz; }
      return point;
    }
    // Missing/incomplete shoulders: preserve the older config and height mapper.
    const cy = Number.isFinite(options.cy) ? options.cy : baseY;
    const axes = axesForPose(options.poseOrbitScale, options.armLength);
    const metrics = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY);
    const scaledBaseY = floorY + (baseY - floorY) * metrics.rigScaleY;
    const [dx, dz] = scaleHorizontal(x - cx, z - cz, axes.x, axes.z, options.yawRad);
    const scaledCentroidY = scaledBaseY + (cy - baseY) * metrics.heightRatio;
    const nextY = scaledCentroidY + shift.y + (y - cy) * metrics.heightRatio * axes.y;
    if (typeof point.set === 'function') point.set(cx + dx + shift.x, nextY, cz + dz + shift.z);
    else { point.x = cx + dx + shift.x; point.y = nextY; point.z = cz + dz + shift.z; }
    return point;
  }

  function untransformPosePoint(point, options = {}) {
    if (!point) return point;
    const x = Number(point.x), y = Number(point.y), z = Number(point.z);
    const cx = Number(options.cx) || 0, cz = Number(options.cz) || 0;
    const floorY = Number(options.floorY) || 0, baseY = Number(options.baseY);
    if (![x, y, z, cx, cz, floorY, baseY].every(Number.isFinite)) return point;
    const orbit = shoulderOrbitGeometry(options); // Inverts the same measured sphere used by gameplay/editor.
    const shift = orbitShift(options, orbitShiftScratch);
    if (orbit) {
      const factor = orbit.scale, center = orbit.center, source = orbit.rawCenter;
      const nx = source.x + (x - center.x - shift.x) / factor;
      const ny = source.y + (y - center.y - shift.y) / factor;
      const nz = source.z + (z - center.z - shift.z) / factor;
      if (typeof point.set === 'function') point.set(nx, ny, nz);
      else { point.x = nx; point.y = ny; point.z = nz; }
      return point;
    }
    const cy = Number.isFinite(options.cy) ? options.cy : baseY;
    const axes = axesForPose(options.poseOrbitScale, options.armLength);
    const metrics = heightMetrics(options.speciesId, options.gender, options.modelHeight, options.rigScaleY);
    if (!(axes.x > 0) || !(axes.y > 0) || !(axes.z > 0) || !(metrics.heightRatio > 0)) return point;
    const scaledBaseY = floorY + (baseY - floorY) * metrics.rigScaleY;
    const [dx, dz] = scaleHorizontal(x - cx - shift.x, z - cz - shift.z, 1 / axes.x, 1 / axes.z, options.yawRad);
    const scaledCentroidY = scaledBaseY + (cy - baseY) * metrics.heightRatio;
    const nextY = cy + (y - scaledCentroidY - shift.y) / (metrics.heightRatio * axes.y);
    if (typeof point.set === 'function') point.set(cx + dx, nextY, cz + dz);
    else { point.x = cx + dx; point.y = nextY; point.z = cz + dz; }
    return point;
  }

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
    shoulderOrbitGeometry, // Shared rig-derived sphere geometry for gameplay and editor diagnostics.
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
