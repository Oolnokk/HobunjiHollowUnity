// Character spine: a static, data-driven hunchback for portrait avatars (old
// NPCs, skeletons, Maskbound). One 0-1 `hunch` value is the whole input; this
// module turns it into the numbers each rig layer needs, so every layer bends
// the same amount without any of them knowing about the others:
//
//   neckDrop       head/neck bone lowered (fraction of model height) — this is
//                  HobunjiCharacterRigScale's age hunch, so an NPC's existing
//                  appearance.aging.hunch keeps its exact head position.
//   shoulderDrop   shoulder anchors lowered (procedural-hand-shoulder-aim.js),
//                  so arms hang and aim from the stooped shoulders.
//   orbitDrop      centre of the weapon/attack orbit lowered
//                  (HobunjiSpeciesPoseScale.transformPosePoint `orbitDropY`),
//                  so swings pivot about the stooped upper body.
//   stanceScale    multiplier on idle foot X (ProceduralLegAnimation), a wider
//                  base to carry the forward-heavy torso.
//   strideScale    multiplier on stride length (ProceduralLegAnimation).
//
// Nothing here animates: the hunch is fixed per character. Sources, in order:
//   * an explicit `spine` (number or { hunch }) on options/profile/appearance/
//     npcRecord — enemy-loadouts.json rules carry `spine: { hunch }`;
//   * otherwise the NPC database's appearance.aging.hunch (via
//     HobunjiCharacterRigScale.ageFor).
// All distances are fractions of the avatar's own unscaled model height, the
// same unit as headOffsetY, so they ride the whole-rig scale like it does.
(() => {
  'use strict';

  const FALLBACK_NECK_DROP = 0.15; // HobunjiCharacterRigScale.maxAgeHunchFraction when that module is absent (tools/tests).
  const SHOULDER_DROP_RATIO = 0.6; // Shoulders sink less than the head: the collar stays, the skull falls forward.
  const ORBIT_DROP_RATIO = 0.6; // The attack orbit is centred on the shoulders, so it tracks them.
  const STANCE_WIDEN = 0.5; // Fully hunched: feet 50% farther from the centreline.
  const STRIDE_WIDEN = 0.3; // Fully hunched: strides 30% longer, a lurching reach rather than a shuffle.

  const clamp01 = value => Math.max(0, Math.min(1, value));
  const asNumber = value => (value == null || value === '' ? NaN : Number(value));

  function explicitSpine(source) {
    if (typeof source === 'number') return source;
    if (!source || typeof source !== 'object') return NaN;
    const candidates = [
      source.spine,
      source.profile?.spine,
      source.appearance?.spine,
      source.profile?.appearance?.spine,
      source.npcRecord?.spine,
      source.npcRecord?.appearance?.spine,
      source.avatarRoot?.userData?.hobunjiSpine,
    ];
    for (const candidate of candidates) {
      const n = asNumber(candidate && typeof candidate === 'object' ? candidate.hunch : candidate);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  }

  // 0-1 hunch for whatever the caller has (options bag, profile, roster, number).
  function hunchFor(source) {
    const explicit = explicitSpine(source);
    if (Number.isFinite(explicit)) return clamp01(explicit);
    const rigScale = window.HobunjiCharacterRigScale;
    if (source && typeof source === 'object' && typeof rigScale?.ageFor === 'function') return clamp01(rigScale.ageFor(source));
    return 0;
  }

  function neckDropMax() {
    const max = Number(window.HobunjiCharacterRigScale?.maxAgeHunchFraction);
    return Number.isFinite(max) && max > 0 ? max : FALLBACK_NECK_DROP;
  }

  // Every derived number for a hunch. Drops are positive fractions of model height.
  function profileFor(hunch) {
    const h = clamp01(Number(hunch) || 0);
    const neckDrop = h * neckDropMax();
    return {
      hunch: h,
      neckDrop,
      shoulderDrop: neckDrop * SHOULDER_DROP_RATIO,
      orbitDrop: neckDrop * ORBIT_DROP_RATIO,
      stanceScale: 1 + h * STANCE_WIDEN,
      strideScale: 1 + h * STRIDE_WIDEN,
    };
  }

  const resolve = source => profileFor(hunchFor(source));

  // Stores the profile on an avatar root for the layers that read it live (shoulder aim); null when upright.
  function bind(root, source) {
    const profile = resolve(source);
    if (!root?.userData) return profile;
    if (profile.hunch > 0) root.userData.hobunjiSpine = profile;
    else delete root.userData.hobunjiSpine;
    return profile;
  }

  function fromRoot(node) {
    for (let current = node; current; current = current.parent) {
      const spine = current.userData?.hobunjiSpine;
      if (spine) return spine;
    }
    return null;
  }

  // World-space Y the orbit centre sits below its unhunched height, for a body of the given unscaled model height and rig Y scale.
  const orbitDropWorld = (spine, modelHeight, rigScaleY = 1) =>
    spine?.orbitDrop > 0 ? spine.orbitDrop * (Number(modelHeight) || 0) * (Number(rigScaleY) > 0 ? Number(rigScaleY) : 1) : 0;

  window.HobunjiCharacterSpine = Object.freeze({
    shoulderDropRatio: SHOULDER_DROP_RATIO,
    orbitDropRatio: ORBIT_DROP_RATIO,
    stanceWiden: STANCE_WIDEN,
    strideWiden: STRIDE_WIDEN,
    hunchFor,
    profileFor,
    resolve,
    bind,
    fromRoot,
    orbitDropWorld,
  });
})();
