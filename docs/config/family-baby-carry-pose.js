// Shared baby carry. Mount positions are offsets from the baby's actual POSTERIOR pivot
// (pivot:'posterior'; portrait-normalized offset) or, for profiles saved before that existed,
// raw portrait-normalized points (pivot:'portrait'). Hand offsets are local distances from
// the baby's POSTERIOR (left) and NECK (right).
// The live carrier still consumes world-local handTargets through the existing hand solver.
(() => {
  'use strict';
  if (window.FamilyBabyCarryPose) return;
  // Device-local "Apply" override. Poses saved before anatomical pivots (key v1: fixed portrait
  // heights that misplace other species) are cleared automatically on load, never migrated.
  const STORAGE_KEY = 'hobunji.familyBabyCarryPose.v3';
  const RETIRED_STORAGE_KEYS = ['hobunji.familyBabyCarryPose.v1'];
  // Authored defaults (screenshot-verified in game against a newborn Mao'ao bust, Nov 22):
  // HELD = cradle. The infant lies ~65 degrees across the carrier's lower chest, head in the
  // carrier's RIGHT arm, face tipped diagonally upward by local yaw; the right hand cups the head/neck from below,
  // the left hand supports the bottom. The cradle pivots at the infant's REAL posterior (see
  // anchorsForAvatar), so its posteriorOffset reads as "where the baby's bottom sits" for every species.
  // BACK = upright high and centered between the shoulder blades, facing BEHIND the
  // carrier so the over-the-shoulder gameplay camera
  // sees the face; head leans in against the carrier's neck and peeks over the shoulder line.
  // Euler values are the gameplay ANCHOR (Shattercasks applies their inverse to the infant).
  const DEFAULT_PROFILE = {
    held: { pivot: 'posterior', position: { x: 0, y: 0, z: 0 }, rotation: { x: 4.95, y: -50.46, z: -64.53 }, size: 1,
      posteriorOffset: { x: .11, y: .075, z: .13 } },
    // Back pivots at the NECK: whatever the newborn's size, its head peeks over the shoulder line
    // (same pose as a posterior pivot at {.065,.19,-.07} for the verified Mao'ao newborn).
    back: { pivot: 'neck', position: { x: 0, y: 0, z: 0 }, rotation: { x: -174.07, y: -.94, z: 171.05 }, size: 1,
      posteriorOffset: { x: -.025, y: .282, z: -.0603 }, portraitAnchor: { x: 0, y: 0, z: 0 } },
    grips: {
      left: { anchor: 'posterior', offset: { x: -.046, y: -.043, z: -.02 }, rotation: { x: 180, y: 0, z: -90 } }, // Under the bottom.
      right: { anchor: 'neck', offset: { x: -.12, y: .044, z: -.02 }, rotation: { x: 0, y: 0, z: 90 } }, // Under the head, toward the crown.
    },
    elbows: { left: null, right: null }, // Attack Animation Editor convention: shoulder-relative XYZ; unset retains legacy arm aiming.
  };
  const PIVOTS = new Set(['posterior', 'neck']); // Anatomical mount pivots; anything else is legacy portrait space.
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
      // A pose saved before pivots existed has a portrait-normalized position: keep that meaning.
      pivot: input && typeof input === 'object' ? (PIVOTS.has(input.pivot) ? input.pivot : 'portrait') : defaults.pivot,
      position: vector(input?.position, defaults.position),
      rotation: vector(input?.rotation, defaults.rotation, 720),
      size: Math.max(.1, Math.min(10, finite(input?.size, defaults.size))),
      posteriorOffset: vector(input?.posteriorOffset, defaults.posteriorOffset),
      ...(back ? { portraitAnchor: vector(input?.portraitAnchor, defaults.portraitAnchor) } : {}),
    });
    return {
      held: pose(source.held, DEFAULT_PROFILE.held),
      back: pose(source.back, DEFAULT_PROFILE.back, true),
      elbows: Object.fromEntries(['left','right'].map(side => {
        const point=source.elbows?.[side];
        return [side,point && ['x','y','z'].every(axis=>Number.isFinite(Number(point[axis])))
          ?vector(point,{x:0,y:0,z:0},2):null]; // Identical to Attack Editor nullable per-side elbow targets.
      })),
      grips: Object.fromEntries(['left', 'right'].map(side => {
        const input = source.grips?.[side] || {}, defaults = DEFAULT_PROFILE.grips[side];
        const legacy = input.position && !input.offset; // V1 portrait fractions from earlier editor exports/localStorage.
        return [side, {
          anchor: defaults.anchor, // Fixed per-side anatomy policy; ignore contradictory imported anchor names.
          ...(legacy ? { position: vector(input.position, { x: side === 'left' ? .4 : -.4, y: .5, z: .05 }) }
            : { offset: vector(input.offset, defaults.offset) }),
          rotation: vector(input.rotation, defaults.rotation, 720),
        }];
      })),
    };
  }
  let profile = normalize(DEFAULT_PROFILE); // Live device override used by new babies and refreshed carry rigs.
  const storage = { clearedRetired: 0, rejectedStored: false, migratedStored: false }; // Mobile diagnostics for the automatic clean-up.
  const anatomical = raw => ['held', 'back'].every(key => PIVOTS.has(raw?.[key]?.pivot)); // Every stored pose must name its pivot.
  try {
    for (const key of RETIRED_STORAGE_KEYS) {
      if (window.localStorage?.getItem(key) == null) continue;
      window.localStorage.removeItem(key);
      storage.clearedRetired++;
    }
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    let parsed = null;
    try { parsed = stored ? JSON.parse(stored) : null; } catch (_) { parsed = null; } // Corrupt JSON is cleared like a legacy pose.
    if (parsed && anatomical(parsed)) {
      // Only update values still at the PREVIOUS defaults. Preserve intentionally authored
      // local yaw, back placement, hand grips and all other personalized carry settings.
      let migrated = false; // Whether these two old default fields need rewriting in v3 storage.
      if (parsed.held.rotation && typeof parsed.held.rotation === 'object' && [-10.92, -90].includes(parsed.held.rotation.y)) {
        parsed.held.rotation.y = DEFAULT_PROFILE.held.rotation.y;
        migrated = true;
      }
      if (parsed.back.posteriorOffset && typeof parsed.back.posteriorOffset === 'object'
          && parsed.back.posteriorOffset.x === .0581) {
        parsed.back.posteriorOffset.x = DEFAULT_PROFILE.back.posteriorOffset.x;
        migrated = true;
      }
      profile = normalize(parsed);
      if (migrated) {
        storage.migratedStored = true;
        window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(profile)); // One-time migration; no recurring frame work.
      }
    } else if (stored) { window.localStorage.removeItem(STORAGE_KEY); storage.rejectedStored = true; }
  } catch (_) { /* Private/file preview or corrupt JSON: authored defaults remain usable. */ }
  const scaled = (value, width, height) => ({ x: value.x * width, y: value.y * height, z: value.z * height });
  const unscaled = (value, width, height) => ({ x: finite(value?.x, 0) / width,
    y: finite(value?.y, 0) / height, z: finite(value?.z, 0) / height });
  function anchorsForAvatar(data, width, height) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3));
    const rig = data?.neckRig || {}; // Live newborn head and spine pivots, reused by the editor preview.
    const plane = rig.skinnedPlane?.position || {};
    const centerY = h / 2 + finite(data?.visualCentroidLocalY,
      (finite(data?.portraitVerticalPlacementRatio, .5, 2) - .5) * h);
    const centerX = finite(plane.x, 0), centerZ = finite(plane.z, finite(data?.visualCentroidLocalZ, 0));
    const posteriorY = Number(rig.spinePosteriorY);
    const spineRoot=rig.splineNodes?.[0]?.position||{}; // Actual pinned spine root (node 0), preferred to a calculated/fallback posterior height.
    const rootY=Number(spineRoot.y);
    const neck = rig.neckLocal || {}; // Raw plane-local neck pivot, BEFORE applying head scale.
    const spineY = centerY + (Number.isFinite(rootY) ? rootY : Number.isFinite(posteriorY) ? posteriorY : -h * .23);
    // A carried baby is only its painted bust: no pants. Some species pin the spine root far
    // below the art (a Mashtzarr newborn's sits 35% of its height under the bust, where a
    // standing NPC's pants would cover it). Keep the hip within 7% of the bust's lower edge so
    // grips, mounts and limbs land on visible baby. Mao'ao (6% below) is unaffected.
    const bustBottom = centerY - h / 2;
    return {
      posterior: { x: centerX + finite(spineRoot.x, 0), // CharacterSpine.layoutFor pins node 0 at x=0. spineBase.x belongs to the NECK.
        y: Math.max(spineY, bustBottom - h * .07),
        z: centerZ + finite(spineRoot.z, 0) },
      neck: { x: centerX + finite(neck.x, 0),
        y: centerY + finite(neck.y, h * .22),
        z: centerZ + finite(neck.z, 0) },
    };
  }
  function resolvedAnchors(anchors, w, h) {
    const fallback = anchorsForAvatar({}, w, h); // Safe before an asynchronous baby portrait has loaded.
    return {
      posterior: vector(anchors?.posterior, fallback.posterior),
      neck: vector(anchors?.neck, fallback.neck),
    };
  }
  function gripAnchor(side, anchors, w, h) {
    return resolvedAnchors(anchors, w, h)[side === 'left' ? 'posterior' : 'neck'];
  }
  function gripOffset(side, position, anchors, w, h) {
    const base = gripAnchor(side, anchors, w, h);
    return Object.fromEntries(axes.map(axis => [axis, finite(position?.[axis], 0) - base[axis]]));
  }
  function gripPosition(side, offset, anchors, w, h) {
    const base = gripAnchor(side, anchors, w, h);
    return Object.fromEntries(axes.map(axis => [axis, base[axis] + finite(offset?.[axis], 0)]));
  }
  function pivotBase(pivot, anchors, w, h) {
    return PIVOTS.has(pivot) ? resolvedAnchors(anchors, w, h)[pivot] : { x: 0, y: 0, z: 0 };
  }
  function mountPosition(pose, anchors, w, h) { // Carryable mount point = baby pivot + portrait-normalized offset.
    const base = pivotBase(pose.pivot, anchors, w, h), offset = scaled(pose.position, w, h);
    return Object.fromEntries(axes.map(axis => [axis, base[axis] + offset[axis]]));
  }
  function forSizeFrom(raw, width, height, anchors = null) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3)); // Live baby portrait dimensions.
    const source = normalize(raw); // Allows the editor to resize an UNSAVED draft when Random Baby changes species.
    const held = source.held, back = source.back;
    return {
      enabled: true,
      billboardAnchor: { coordinateSpace: 'posterior-relative', pivot: held.pivot, position: mountPosition(held, anchors, w, h),
        rotation: { ...held.rotation }, size: held.size, posteriorOffset: { ...held.posteriorOffset } },
      backCarry: { pivot: back.pivot, position: mountPosition(back, anchors, w, h), rotation: { ...back.rotation }, size: back.size,
        posteriorOffset: { ...back.posteriorOffset }, portraitAnchor: { ...back.portraitAnchor } },
      elbows: Object.fromEntries(['left','right'].map(side => [side,source.elbows[side]?{...source.elbows[side]}:null])),
      handTargets: Object.fromEntries(['left', 'right'].map(side => {
        const grip = source.grips[side];
        const point = grip.position ? scaled(grip.position, w, h) // V1 portrait-fraction compatibility.
          : gripPosition(side, grip.offset, anchors, w, h); // V2 world-local offsets from actual anatomical pivots.
        return [side, { ...point, rotation: { ...grip.rotation } }];
      })),
    };
  }
  function forSize(width, height, anchors = null) { return forSizeFrom(profile, width, height, anchors); }
  // Portrait UV: U is fraction from the left, V is fraction down from the top.
  // Grips remain fractions of full portrait dimensions, never posed head-alpha bounds.
  function pointToPortrait(local, width, height) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3));
    return { u: .5 + finite(local?.x, 0) / w,
      v: 1 - finite(local?.y, 0) / h, depth: finite(local?.z, 0) / h };
  }
  function pointFromPortrait(uv, width, height) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3));
    return { x: (finite(uv?.u, .5) - .5) * w,
      y: (1 - finite(uv?.v, 1)) * h, z: finite(uv?.depth, 0) * h };
  }
  function toProfile(carryable, width, height, anchors = null) {
    const w = Math.max(.05, finite(width, .3)), h = Math.max(.05, finite(height, .3)); // Editor preview's reference baby size.
    const held = carryable?.billboardAnchor || {}, back = carryable?.backCarry || {};
    const pose = (source, fallback, isBack) => {
      // The carryable holds this baby's absolute mount, so a legacy portrait-space pose (e.g. an old
      // imported JSON) is re-expressed exactly on the default anatomical pivot: saves are never legacy.
      const pivot = PIVOTS.has(source.pivot) ? source.pivot : fallback.pivot, base = pivotBase(pivot, anchors, w, h);
      return {
      pivot,
      position: unscaled(Object.fromEntries(axes.map(axis => [axis, finite(source.position?.[axis], 0) - base[axis]])), w, h),
      rotation: vector(source.rotation, fallback.rotation, 720),
      size: finite(source.size, fallback.size),
      posteriorOffset: vector(source.posteriorOffset, fallback.posteriorOffset),
      ...(isBack ? { portraitAnchor: vector(source.portraitAnchor, DEFAULT_PROFILE.back.portraitAnchor) } : {}),
      };
    };
    return normalize({
      held: pose(held, DEFAULT_PROFILE.held, false),
      back: pose(back, DEFAULT_PROFILE.back, true),
      elbows: Object.fromEntries(['left','right'].map(side => {
        const point=carryable?.elbows?.[side];
        return [side,point && ['x','y','z'].every(axis=>Number.isFinite(Number(point[axis])))
          ?vector(point,{x:0,y:0,z:0},2):null];
      })),
      grips: Object.fromEntries(['left', 'right'].map(side => [side, {
        anchor: side === 'left' ? 'posterior' : 'neck',
        offset: gripOffset(side, carryable?.handTargets?.[side], anchors, w, h),
        rotation: vector(carryable?.handTargets?.[side]?.rotation, DEFAULT_PROFILE.grips[side].rotation, 720),
      }])),
    });
  }
  function applyFrom(carryable, sourceProfile, width, height, anchors = null) {
    if (!carryable) return null;
    const pose = forSizeFrom(sourceProfile, width, height, anchors); // Editor reanchors unsaved drafts; runtime passes actual spine/neck pivots.
    // Hand attachments can retain references to these socket objects. Update in place.
    let backPoseChanged = false; // Invalidates only the newborn's cached rear body mount, never ordinary furniture.
    for (const key of ['billboardAnchor', 'backCarry']) {
      const target = carryable[key] || (carryable[key] = {}), source = pose[key];
      for (const field of ['position', 'rotation', 'posteriorOffset', 'portraitAnchor']) {
        if (!source[field]) continue;
        if (key === 'backCarry') for (const axis of axes)
          if (target[field]?.[axis] !== source[field][axis]) backPoseChanged = true;
        Object.assign(target[field] || (target[field] = {}), source[field]);
      }
      if (key === 'backCarry' && (target.size !== source.size || target.pivot !== source.pivot))
        backPoseChanged = true;
      target.size = source.size;
      target.pivot = source.pivot; // Lets toProfile undo the same pivot when the editor saves.
      if (key === 'billboardAnchor') target.coordinateSpace = 'posterior-relative';
    }
    if (backPoseChanged) carryable._backCarryRevision = (Number(carryable._backCarryRevision) || 0) + 1; // Checked by both parent mounts; identical syncs do not restage the infant.
    const elbows=carryable.elbows||(carryable.elbows={}); // Same parent-local, shoulder-relative targets used by ProceduralHandShoulderAim.
    for(const side of ['left','right']){
      const target=pose.elbows[side];
      elbows[side]=target ?Object.assign(elbows[side]||{},target):null;
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
  function applyTo(carryable, width, height, anchors = null) { return applyFrom(carryable, profile, width, height, anchors); }
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
  window.FamilyBabyCarryPose = Object.freeze({ version: 3, defaultProfile: normalize(DEFAULT_PROFILE),
    storageStatus: () => ({ key: STORAGE_KEY, ...storage }),
    anchorsForAvatar, gripAnchor, gripOffset, gripPosition,
    forSize, forSizeFrom, toProfile, pointToPortrait, pointFromPortrait, applyTo, applyFrom, save, reset, snapshot });
})();
