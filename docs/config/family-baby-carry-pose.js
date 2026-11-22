// Shared, dimension-normalized hand/back grip profile for held family babies.
// X is a fraction of portrait width; Y and Z are fractions of portrait height.
// Furniture Author > Carryable > Family baby edits and exports this same schema.
(() => {
  'use strict';
  if (window.FamilyBabyCarryPose) return;
  const STORAGE_KEY = 'hobunji.familyBabyCarryPose.v1'; // Optional device-local authoring override, never part of a character save.
  const DEFAULT_PROFILE = {
    held: { position: { x: 0, y: .06, z: -.48 }, rotation: { x: 0, y: 0, z: 0 }, size: 1, posteriorOffset: { x: 0, y: 0, z: 0 } },
    back: { position: { x: 0, y: .16, z: -.48 }, rotation: { x: 0, y: 180, z: 0 }, size: 1,
      posteriorOffset: { x: 0, y: 0, z: 0 }, portraitAnchor: { x: 0, y: 0, z: 0 } },
    grips: {
      left: { position: { x: .40, y: .5, z: .05 }, rotation: { x: 180, y: 0, z: -90 } },
      right: { position: { x: -.40, y: .5, z: .05 }, rotation: { x: 0, y: 0, z: 90 } },
    },
  };
  const axes = ['x', 'y', 'z']; // Shared coordinate axes in the authoring schema and live carryable definition.
  const finite = (value, fallback, limit = 10) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(-limit, Math.min(limit, number)) : fallback;
  };
  function vector(source, defaults, limit = 10) {
    return Object.fromEntries(axes.map(axis => [axis, finite(source?.[axis], defaults[axis], limit)]));
  }
  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const pose = (input, defaults, back = false) => ({
      position: vector(input?.position, defaults.position),
      rotation: vector(input?.rotation, defaults.rotation, 720),
      size: Math.max(.1, Math.min(10, finite(input?.size, defaults.size))),
      posteriorOffset: vector(input?.posteriorOffset, defaults.posteriorOffset),
      ...(back ? { portraitAnchor: vector(input?.portraitAnchor, defaults.portraitAnchor) } : {}),
    });
    return {
      held: pose(source.held, DEFAULT_PROFILE.held),
      back: pose(source.back, DEFAULT_PROFILE.back, true),
      grips: Object.fromEntries(['left', 'right'].map(side => [side, {
        position: vector(source.grips?.[side]?.position, DEFAULT_PROFILE.grips[side].position),
        rotation: vector(source.grips?.[side]?.rotation, DEFAULT_PROFILE.grips[side].rotation, 720),
      }])),
    };
  }
  let profile = normalize(DEFAULT_PROFILE); // Live device override used by new babies and refreshed carry rigs.
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored) profile = normalize(JSON.parse(stored));
  } catch (_) { /* Private/file preview: authored defaults remain usable. */ }
  const scaled = (value, width, height) => ({ x: value.x * width, y: value.y * height, z: value.z * height });
  const unscaled = (value, width, height) => ({ x: finite(value?.x, 0) / width,
    y: finite(value?.y, 0) / height, z: finite(value?.z, 0) / height });
  function forSize(width, height) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3)); // Live baby portrait dimensions.
    const held = profile.held, back = profile.back;
    return {
      enabled: true,
      billboardAnchor: { coordinateSpace: 'posterior-relative', position: scaled(held.position, w, h),
        rotation: { ...held.rotation }, size: held.size, posteriorOffset: { ...held.posteriorOffset } },
      backCarry: { position: scaled(back.position, w, h), rotation: { ...back.rotation }, size: back.size,
        posteriorOffset: { ...back.posteriorOffset }, portraitAnchor: { ...back.portraitAnchor } },
      handTargets: Object.fromEntries(['left', 'right'].map(side => [side, {
        ...scaled(profile.grips[side].position, w, h), rotation: { ...profile.grips[side].rotation },
      }])),
    };
  }
  function toProfile(carryable, width, height) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3)); // Editor preview's reference baby size.
    const held = carryable?.billboardAnchor || {}, back = carryable?.backCarry || {};
    const pose = (source, fallback, isBack) => ({
      position: unscaled(source.position, w, h),
      rotation: vector(source.rotation, fallback.rotation, 720),
      size: finite(source.size, fallback.size),
      posteriorOffset: vector(source.posteriorOffset, fallback.posteriorOffset),
      ...(isBack ? { portraitAnchor: vector(source.portraitAnchor, DEFAULT_PROFILE.back.portraitAnchor) } : {}),
    });
    return normalize({
      held: pose(held, DEFAULT_PROFILE.held, false),
      back: pose(back, DEFAULT_PROFILE.back, true),
      grips: Object.fromEntries(['left', 'right'].map(side => [side, {
        position: unscaled(carryable?.handTargets?.[side], w, h),
        rotation: vector(carryable?.handTargets?.[side]?.rotation, DEFAULT_PROFILE.grips[side].rotation, 720),
      }])),
    });
  }
  function applyTo(carryable, width, height) {
    if (!carryable) return null;
    const pose = forSize(width, height);
    // Hand attachments can retain references to these socket objects. Update in place.
    for (const key of ['billboardAnchor', 'backCarry']) {
      const target = carryable[key] || (carryable[key] = {}), source = pose[key];
      for (const field of ['position', 'rotation', 'posteriorOffset', 'portraitAnchor']) {
        if (!source[field]) continue;
        Object.assign(target[field] || (target[field] = {}), source[field]);
      }
      target.size = source.size;
      if (key === 'billboardAnchor') target.coordinateSpace = 'posterior-relative';
    }
    const hands = carryable.handTargets || (carryable.handTargets = {});
    for (const side of ['left', 'right']) {
      const target = hands[side] || (hands[side] = {}), source = pose.handTargets[side];
      for (const axis of axes) target[axis] = source[axis];
      Object.assign(target.rotation || (target.rotation = {}), source.rotation);
    }
    carryable.enabled = true;
    return carryable;
  }
  function save(next) {
    profile = normalize(next);
    try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(profile)); }
    catch (_) { /* In-memory profile is still immediately usable. */ }
    return snapshot();
  }
  function reset() {
    profile = normalize(DEFAULT_PROFILE);
    try { window.localStorage?.removeItem(STORAGE_KEY); } catch (_) {}
    return snapshot();
  }
  function snapshot() { return JSON.parse(JSON.stringify(profile)); }
  window.FamilyBabyCarryPose = Object.freeze({ version: 1, defaultProfile: normalize(DEFAULT_PROFILE),
    forSize, toProfile, applyTo, save, reset, snapshot });
})();
