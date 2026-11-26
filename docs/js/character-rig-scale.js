// Character-rig scale: independent body width/height, a head scale that
// stays visually undistorted no matter what the body axes are doing, and a
// head Y offset (composable with a per-NPC age value) for a hunched-over look.
//
// Body scale is intentionally a PARENT scale, not another portrait/body scale.
// It uniformly-per-axis scales the already-assembled visual rig around its
// floor-relative origin so portrait, hands, feet, shoulders, posterior,
// perches, offsets and their authored spacing all stay aligned relative to
// each other. Local authored coordinates are never rewritten by this module.
//
// Head scale and head Y offset are different: both are applied at the neck
// rig bone (the same skinned-plane neck joint built for head-turn/breathing —
// see neckRig in png-plane-avatar.js). Head scale is compensated against
// whatever non-uniform x/y the body ends up with, so the head/head-cosmetics/
// expressions painted in that bone's weighted region keep the aspect ratio
// they were authored at. Head Y offset is an authored per-species/gender
// nudge (fraction of the avatar's own model height) that composes additively
// with a separate per-NPC "age" factor, which can lower it further — see
// ageHunchFraction. Avatars with no neck rig (most world creatures/NPCs)
// simply have no head to protect or reposition and are unaffected.
(() => {
  'use strict';

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 4;
  const MAX_OFFSET_FRACTION = 0.5; // Clamp for headOffsetY and the composed age-hunch amount, as a fraction of model height.
  const MAX_AGE_HUNCH_FRACTION = 0.25; // A fully "aged" (age = 1) character's head lowers by up to 25% of their own model height, on top of any authored headOffsetY: js/character-spine.js stoops the whole upper body by most of that (the spine bone) and the head bone carries the rest.
  const EPSILON = 1e-9;

  const finite = (value, fallback = 1) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const clampScale = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, finite(value, 1)));
  const clampOffset = value => Math.max(-MAX_OFFSET_FRACTION, Math.min(MAX_OFFSET_FRACTION, finite(value, 0)));
  const normalizeKey = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizeGender = value => {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  };
  const transformSpecies = value => {
    if (typeof window.hobunjiTransformSpeciesId === 'function') return window.hobunjiTransformSpeciesId(value);
    const species = normalizeKey(value);
    if (species === 'rakakoan') return 'kenkari';
    if (species === 'ghoul') return 'mao-ao';
    return species;
  };
  // Age is a per-NPC 0-1 factor (0 = no extra hunch, 1 = fully hunched), kept
  // separate from any species/gender-authored data — callers supply it (e.g.
  // Full Character Scale's own per-NPC age override), it is never read from
  // the shared species/gender profile.
  const ageHunchFraction = age => {
    const a = Number(age);
    if (!Number.isFinite(a) || a <= 0) return 0; // Avoids producing -0 for age 0/absent, which would compare unequal to a plain 0.
    return -Math.min(1, a) * MAX_AGE_HUNCH_FRACTION;
  };

  // Single resolver for a character's age-hunch fraction. Explicit numeric
  // `age` wins; otherwise the authored NPC aging block (appearance.aging.hunch,
  // copied onto the portrait profile by NpcAvatarPreview.buildProfileFromNpcExport)
  // is read from whichever of options/profile/npcRecord/appearance is present,
  // and finally whatever the avatar root already resolved at build time. Every
  // caller that reapplies head compensation must use this so a later pass never
  // resets an aged NPC's hunch back to 0.
  function ageFor(options = {}) {
    const candidates = [
      options.age,
      options.profile?.age,
      options.npcRecord?.age,
      options.aging?.hunch,
      options.profile?.aging?.hunch,
      options.appearance?.aging?.hunch,
      options.npcRecord?.appearance?.aging?.hunch,
      options.profile?.appearance?.aging?.hunch,
      options.avatarRoot?.userData?.hobunjiCharacterRigHeadRuntime?.age,
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (value != null && Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    }
    return 0;
  }

  function defaultScaleFor(species, gender) {
    const transformed = transformSpecies(species); // Used so Rakakoan/Ghoul inherit their transform-equivalent Kenkari/Mao-ao authored defaults.
    const normalizedGender = normalizeGender(gender);
    const configured = window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(transformed, normalizedGender); // Preferred canonical default source loaded by attachment-rig bootstrap.
    if (configured && Number.isFinite(Number(configured.x)) && Number(configured.x) > 0) {
      const legLength = Number(configured.legLength); // Optional: lanky species author hip-to-foot reach separately from portrait height.
      return { x: clampScale(configured.x), y: clampScale(configured.y), head: clampScale(configured.head), offsetY: clampOffset(configured.offsetY),
        ...(Number.isFinite(legLength) && legLength > 0 ? { legLength: clampScale(legLength) } : {}) };
    }
    const legacy = Number(window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS?.[`${transformed}::${normalizedGender}`]?.x
      ?? window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS?.[`${transformed}::${normalizedGender}`]);
    const uniform = clampScale(Number.isFinite(legacy) && legacy > 0 ? legacy : 1);
    return { x: uniform, y: uniform, head: uniform, offsetY: 0 };
  }

  function profileFor(species, gender) {
    const transformed = transformSpecies(species);
    const normalizedGender = normalizeGender(gender);
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return characters[`${transformed}::${normalizedGender}`]
      || characters[`${normalizeKey(species)}::${normalizedGender}`]
      || null;
  }

  // Reads x/y/head/offsetY from the profile's authored fields, falling back to a
  // still-present legacy single `rigScale` number for x/y/head (pre-split saves/
  // exports — treated as uniform on every axis, matching old behavior exactly;
  // headOffsetY has no such legacy field, it's new), then to the authored
  // per-species/gender defaults.
  function scaleFor(species, gender, profile = null) {
    const rec = profile || profileFor(species, gender);
    const anatomy = rec?.anatomy || {};
    const defaults = defaultScaleFor(species, gender);
    const legacy = Number(anatomy.rigScale);
    const hasLegacy = Number.isFinite(legacy) && legacy > 0;
    const x = Number(anatomy.rigScaleX);
    const y = Number(anatomy.rigScaleY);
    const head = Number(anatomy.headScale);
    const offsetY = Number(anatomy.headOffsetY);
    const legacyHeight = clampScale(Number.isFinite(y) && y > 0 ? y : (hasLegacy ? legacy : defaults.y)); // Old Height saves apply to portrait AND legs until an independent leg length is authored.
    const leg = Number(anatomy.legLengthScale); // Independent hip-to-foot reach, authored per species/gender in Full Character Scale.
    return {
      x: clampScale(Number.isFinite(x) && x > 0 ? x : (hasLegacy ? legacy : defaults.x)),
      y: legacyHeight, // Compatibility alias: older callers use y for portrait height.
      portraitHeight: legacyHeight, // Explicit editor label and scale export.
      legLength: clampScale(Number.isFinite(leg) && leg > 0 ? leg
        : (Number.isFinite(y) && y > 0) || hasLegacy || !(Number(defaults.legLength) > 0) ? legacyHeight
          : Number(defaults.legLength)), // Saved Height keeps driving legs; otherwise the species' authored leg default (lanky Longorans) applies.
      head: clampScale(Number.isFinite(head) && head > 0 ? head : (hasLegacy ? legacy : defaults.head)),
      offsetY: clampOffset(Number.isFinite(offsetY) ? offsetY : defaults.offsetY),
    };
  }

  // Author-facing Head is a multiplier of the undecorated source PNG pixels:
  // Head=1 leaves the source head's size unchanged relative to every other source head.
  // The skinned plane itself was already scaled by portraitScaleBySpecies, so store
  // runtimeHead = rawHead / actualPortraitScale. This preserves legacy save fields.
  function rawPngHeadScaleFor(runtimeHead, renderedPortraitScale = 1) {
    const portrait = Number(renderedPortraitScale); // Real PNGPlaneAvatar model multiplier, not the character's overall Height setting.
    const actualPortrait = Number.isFinite(portrait) && portrait > 0 ? portrait : 1;
    return clampScale(runtimeHead) * actualPortrait;
  }
  function runtimeHeadScaleForRaw(rawHead, renderedPortraitScale = 1) {
    const portrait = Number(renderedPortraitScale); // Inverts the exact original model transform before the rig neck bone compensates body X/Y.
    const actualPortrait = Number.isFinite(portrait) && portrait > 0 ? portrait : 1;
    return clampScale(Number(rawHead) / actualPortrait);
  }

  // The adult editor's Height and Beltline % are two coordinates for the SAME legacy
  // portrait-height/leg-length geometry. The saved fields stay unchanged for gameplay.
  const beltlineGeometry = value => { // Shared by editor conversion and game scale: the leg's true sole-contact point matters.
    const hipRaw = typeof value === 'object' ? value?.hip : value;
    const n = Number(hipRaw); // Unscaled floor-to-hip / floor-to-avatar-top before authored scale.
    const hip = Number.isFinite(n) && n > 0 && n < 1 ? Math.max(.05, Math.min(.95, n)) : .5;
    const rawContact = Number(typeof value === 'object' ? value?.contact : 0);
    const contact = Number.isFinite(rawContact) && rawContact > 0 && rawContact < hip ? rawContact : 0; // Foot center/sole-contact height in the same baseline units.
    return { hip, contact, reach: hip - contact, torso: 1 - hip + contact }; // Both weights sum to one for unchanged main adult Height.
  };
  function heightBeltlineFor(scale, original = .5) {
    const g = beltlineGeometry(original);
    const portrait = clampScale(scale?.portraitHeight ?? scale?.y ?? 1);
    const leg = clampScale(scale?.legLength ?? scale?.y ?? 1);
    // ProceduralLegAnimation uses hipY = contact + (restHip - contact) * (leg/portrait).
    // Its portrait offset shifts the upper torso by the SAME hip delta, so the top is:
    const height = g.torso * portrait + g.reach * leg;
    const hipHeight = g.contact * portrait + g.reach * leg;
    return { height, beltline: hipHeight / height }; // Actual hip/floor-to-top %, including nonzero foot contact.
  }
  function scaleForHeightBeltline(scale, height, beltline, original = .5) {
    const g = beltlineGeometry(original);
    const total = clampScale(height);
    let requested = Number(beltline);
    if (!Number.isFinite(requested)) requested = heightBeltlineFor(scale, original).beltline;
    // Holding total height fixes the weighted average of the two old scalars; solve the requested beltline as one variable.
    const desiredPortrait = total * (1 - requested) / (1 - g.hip);
    const desiredLeg = (total - g.torso * desiredPortrait) / g.reach;
    const minLeg = Math.max(MIN_SCALE, (total - g.torso * MAX_SCALE) / g.reach);
    const maxLeg = Math.min(MAX_SCALE, (total - g.torso * MIN_SCALE) / g.reach);
    const legLength = Math.max(minLeg, Math.min(maxLeg, desiredLeg)); // Physically unreachable hip percentages clamp without changing total height.
    const portrait = (total - g.reach * legLength) / g.torso;
    return { ...scale, y: clampScale(portrait), portraitHeight: clampScale(portrait), legLength: clampScale(legLength) }; // Preserve legacy runtime save fields and all unrelated authoring.
  }

  function installProfileDefaults() {
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Live shared rig library consumed by game hands/feet and the Animation Author comparison.
    if (!characters) return false;
    let installed = 0; // Reported in mobile diagnostics so a stale/cached build cannot silently fall back to 1.0.
    for (const [key, profile] of Object.entries(characters)) {
      if (!profile) continue;
      const [keySpecies, keyGender] = key.split('::');
      profile.anatomy ||= {};
      const resolved = scaleFor(profile.species || keySpecies, profile.gender || keyGender, profile);
      profile.anatomy.rigScaleX ??= resolved.x;
      profile.anatomy.rigScaleY ??= resolved.y;
      if (Number(defaultScaleFor(profile.species || keySpecies, profile.gender || keyGender).legLength) > 0)
        profile.anatomy.legLengthScale ??= resolved.legLength; // Seeded with rigScaleY, or the seeded height would read as a legacy save and override the species' leg default.
      profile.anatomy.headScale ??= resolved.head;
      profile.anatomy.headOffsetY ??= resolved.offsetY;
      if (Number.isFinite(Number(profile.anatomy.rigScaleX))) installed += 1;
    }
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterRigScaleDefaults = installed;
    return true;
  }

  function vectorNear(a, b) {
    return !!a && !!b
      && Math.abs(Number(a.x) - Number(b.x)) <= EPSILON
      && Math.abs(Number(a.y) - Number(b.y)) <= EPSILON
      && Math.abs(Number(a.z) - Number(b.z)) <= EPSILON;
  }

  // Accepts either a plain number (legacy callers — uniform on x/y, head/offsetY
  // resolve normally) or a { x, y, head, offsetY } object where any field may be
  // omitted to fall back to the resolved default/profile value.
  function normalizeExplicitScale(explicitScale, fallback) {
    if (explicitScale == null) return fallback;
    if (typeof explicitScale === 'number') {
      const uniform = clampScale(explicitScale);
      return { x: uniform, y: uniform, portraitHeight: uniform, legLength: uniform, head: fallback.head, offsetY: fallback.offsetY }; // Legacy number remains uniform across portrait and legs.
    }
    const x = Number(explicitScale.x), y = Number(explicitScale.portraitHeight ?? explicitScale.y), head = Number(explicitScale.head);
    const legLength = Number(explicitScale.legLength); // New independent leg factor; an old explicit y continues to scale both regions.
    const offsetY = Number(explicitScale.offsetY);
    const ageComposed = explicitScale.ageComposed === true; // Internal preview composition only; adult authoring still uses the existing limits.
    const limit = ageComposed ? v => v : clampScale;
    const normalizedY = Number.isFinite(y) && y > 0 ? limit(y) : fallback.y;
    const normalizedLeg = Number.isFinite(legLength) && legLength > 0 ? limit(legLength)
      : Number.isFinite(y) && y > 0 ? normalizedY : (fallback.legLength || normalizedY);
    return {
      ...(ageComposed ? { ageComposed: true } : {}),
      x: Number.isFinite(x) && x > 0 ? limit(x) : fallback.x,
      y: normalizedY, portraitHeight: normalizedY, legLength: normalizedLeg,
      head: Number.isFinite(head) && head > 0 ? limit(head) : fallback.head,
      offsetY: Number.isFinite(offsetY) ? clampOffset(offsetY) : fallback.offsetY,
    };
  }

  // Finds the neck-rig-bearing node (see png-plane-avatar.js's
  // buildSkinnedSinglePlaneAssembly) within or at `root` itself, and the
  // model-height metadata authored alongside it on that same node (see
  // buildSinglePlaneAvatarModel's portraitModelHeight). The avatarRoot
  // carrying userData.neckRig is commonly root itself, a direct child (the
  // real game hooks in one level above it — see installHandParentRuntime
  // below), or nested deeper (editor previews) — checked in that
  // cheap-to-expensive order. Accepts either rig shape: the shared
  // png-plane-avatar.js rig ({ available, neckJoint, ... }) or Animation
  // Author's own separate two-sided-plane rig builder (its scale editor
  // selects/previews actor.visualOffset, whose neckRig never sets `available`
  // at all) — usability is decided by an actual bone with a scale/position to
  // drive, not that one flag.
  function usableNeckRig(rig) {
    return !!(rig && rig.neckJoint && rig.neckJoint.scale && rig.neckJoint.position);
  }
  function findNeckRig(root) {
    if (!root) return null;
    const found = node => usableNeckRig(node?.userData?.neckRig)
      ? { rig: node.userData.neckRig, modelHeight: Number(node.userData.portraitModelHeight) || null, node }
      : null;
    const direct = found(root);
    if (direct) return direct;
    for (const child of root.children || []) {
      const hit = found(child);
      if (hit) return hit;
    }
    let deep = null;
    root.traverse?.(node => { if (!deep) deep = found(node); });
    return deep;
  }

  // Nudges the neck bone's Y position by `offsetFraction` of the avatar's own
  // model height, relative to its ORIGINAL authored position (remembered once
  // on first call) — so reapplying with a different fraction never
  // accumulates drift, matching applyToParent's own base/output bookkeeping.
  function applyHeadYOffset(neckJoint, offsetFraction, modelHeight) {
    if (!neckJoint?.position) return;
    neckJoint.userData ||= {};
    if (!Number.isFinite(neckJoint.userData.hobunjiHeadOffsetBaseY)) {
      neckJoint.userData.hobunjiHeadOffsetBaseY = neckJoint.position.y;
    }
    const height = Number.isFinite(modelHeight) && modelHeight > 0 ? modelHeight : 1;
    neckJoint.position.y = neckJoint.userData.hobunjiHeadOffsetBaseY + clampOffset(offsetFraction) * height;
    neckJoint.updateMatrix?.();
  }

  // Sets the head-scale bone's own local scale so the vertices actually
  // classified as head (see the headCanvas alpha sampling in
  // buildSkinnedPlaneGeometry) end up at `overrides.head` (or the resolved
  // default) in world space regardless of the non-uniform x/y body scale it
  // inherits from its parent chain, and repositions it by `overrides.offsetY`
  // (or the resolved default) composed with `ageFraction`'s hunch amount.
  // Prefers rig.headScaleJoint (a child of neckJoint that ONLY head-alpha
  // vertices are weighted to) over rig.neckJoint itself, which head-TURN
  // rotation also drives and whose much broader Y-band blend deliberately
  // includes nearby shoulders/collar/overwear — scaling or offsetting THAT
  // bone would drag those along with the head. Animation Author's own
  // separate two-sided-plane rig builder has no headScaleJoint yet, so it
  // still falls back to neckJoint there.
  // Child avatars (PNGPlaneAvatar.childScaleFor) are shrunk as a whole by
  // their body multiplier when the portrait is built; their head should shrink
  // less, so the head bone is re-enlarged by childHead / childBody. Recorded
  // on the avatar root at build time so later reapplications (hand attach)
  // keep it without needing the NPC record again.
  function childHeadFactorFor(overrides, node) {
    const explicit = Number(overrides?.childHeadFactor);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const stored = Number(node?.userData?.hobunjiCharacterRigHeadRuntime?.childHeadFactor);
    return Number.isFinite(stored) && stored > 0 ? stored : 1;
  }

  function childHeadFactorXFor(overrides, node, yFactor) {
    const explicit = Number(overrides?.childHeadFactorX); // Horizontal child head compensation survives an editor or hand-driver reapplication.
    const stored = Number(node?.userData?.hobunjiCharacterRigHeadRuntime?.childHeadFactorX);
    const value = Number.isFinite(explicit) && explicit > 0 ? explicit : stored;
    return Number.isFinite(value) && value > 0 ? value : yFactor; // Existing uniform children continue using their historical scalar.
  }

  function scaledNeckAdjustment(rig, relativeHeadScaleY) {
    const headCenterY = Number(rig?.headCentroidLocal?.y); // Actual alpha-weighted base-head center in the same local plane space as the unscaled neck.
    const neckY = Number(rig?.neckLocal?.y); // Rest contact point at the last painted head pixel, before head size is authored.
    if (!rig?.headScaleJoint || !rig?.headOffsetJoint || !rig?.headCentroidLocal || !Number.isFinite(headCenterY) || !Number.isFinite(neckY)) return 0;
    const scaleY = Number(relativeHeadScaleY); // Scaling the head about its centroid moves the chin and therefore the neck pivot.
    if (!Number.isFinite(scaleY) || scaleY <= 0) return 0;
    return (1 - scaleY) * (headCenterY - neckY); // Center-preserving offset of the scaled head's lowest pixel; zero at the default head size.
  }

  function applyHeadCompensation(root, species, gender, overrides = {}, ageFraction = 0) {
    const found = findNeckRig(root);
    if (!found) return false;
    const { rig, modelHeight } = found;
    const target = rig.headScaleJoint || rig.neckJoint; // Scaling remains on the head-only rig bone.
    const offsetTarget = rig.headOffsetJoint || target; // Separate unrotated offset bone prevents authored head-height shifts folding the short neck bend.
    const resolved = scaleFor(species, gender);
    const limit = overrides.ageComposed === true ? v => v : clampScale; // Final preview scale is a product of two already validated controls.
    const bx = limit(Number.isFinite(Number(overrides.x)) && Number(overrides.x) > 0 ? overrides.x : resolved.x);
    const by = limit(Number.isFinite(Number(overrides.y)) && Number(overrides.y) > 0 ? overrides.y : resolved.y);
    const headNumber = Number(overrides.head);
    const verticalChildHead = childHeadFactorFor(overrides, found.node);
    const head = limit(Number.isFinite(headNumber) && headNumber > 0 ? headNumber : resolved.head) * verticalChildHead; // Clamp only the authored adult factor; child compensation is a derived ratio, not an authoring input.
    const relativeHeadY = by > 0 ? head / by : head; // Local head-size factor after removing body height scaling.
    const horizontalChildHead = childHeadFactorXFor(overrides, found.node, verticalChildHead); // Compensate the independently authored portrait width, while leaving final head width equal to final head height.
    target.scale.set(bx > 0 ? head / bx * horizontalChildHead / verticalChildHead : head, relativeHeadY, 1);
    target.updateMatrix?.();
    const scaledNeckDeltaY = scaledNeckAdjustment(rig, relativeHeadY); // Recalculate the head-bottom contact after size changes, before the spine/hunch solver runs.
    const offsetNumber = Number(overrides.offsetY);
    const baseOffset = Number.isFinite(offsetNumber) ? offsetNumber : resolved.offsetY;
    // The Longoran's permanent spine drop must survive later hand/rig rescaling even when the caller supplies NPC age 0.
    const boundLongoranHunch = normalizeKey(species) === 'longoran'
      ? Number(found.node?.userData?.hobunjiSpine?.hunch) : NaN; // Explicit character spine overrides still win over the subspecies default.
    const composedHunch = Number.isFinite(boundLongoranHunch) ? boundLongoranHunch : ageFraction;
    const spineApi = window.HobunjiCharacterSpine; // Shared seven-bone spline owns the upper torso, not a large head-offset weighting zone.
    const distributeToSpine = !!rig.headOffsetJoint && !!rig.headScaleJoint
      && Array.isArray(rig.splineNodes) && rig.splineNodes.length === spineApi?.splineNodes
      && typeof spineApi?.applyNeckReach === 'function'; // Only complete seven-node, separately placed game rigs can spread head offsets through the spine; mock/legacy partial rigs keep their prior behavior.
    if (distributeToSpine) {
      // The 10-bone head-scale joint hangs off the neck joint at the chin pivot,
      // so head size never moves the chin: only the authored head height
      // stretches/compresses the spine. Adding the centroid-based chin delta
      // here lifted the whole head (e.g. +8% height on 200% Longorans) and left
      // a stretched torso with nothing to fill it (verified in Full Character Scale).
      const reachY = clampOffset(baseOffset) * modelHeight;
      applyHeadYOffset(offsetTarget, 0, modelHeight); // Restore the short 2.5px head/neck connection; never drag the pseudo-neck through the torso.
      spineApi.applyNeckReach(rig, reachY, modelHeight, composedHunch); // Rebuild rest→scaled spine→hunch in that order, idempotent on touch-slider edits.
      if (found.node?.userData && rig.appliedSpineProfile) {
        if (Math.abs(Number(rig.neckReachAppliedY) || 0) > 1e-9 || composedHunch > 0) found.node.userData.hobunjiSpine = rig.appliedSpineProfile; // Shoulder/weapon orbit reads the actual stretched spine, even without hunch.
        else delete found.node.userData.hobunjiSpine; // Neutral slider reset also returns held-item shoulder projections to rest.
      }
      rig.scaledNeckLocal = { ...(rig.neckLocal || {}), y: (Number(rig.neckLocal?.y) || 0) + (Number(rig.neckReachAppliedY) || 0),
        deltaY: rig.neckReachAppliedY, relativeHeadScaleY: relativeHeadY }; // Debug reflects the physically achieved position when extreme offsets are clamped.
    } else {
      const spineShare = rig.splineNodes ? spineApi?.profileFor?.(composedHunch)?.shoulderDrop || 0 : 0; // Retained for older spline implementations.
      applyHeadYOffset(offsetTarget, clampOffset(baseOffset) + ageHunchFraction(composedHunch) + spineShare
        + scaledNeckDeltaY / Math.max(1e-6, modelHeight), modelHeight); // Non-spline three-bone previews still use the original broad offset blend.
      if (rig.headOffsetJoint && rig.headScaleJoint && rig.headCentroidLocal) {
        rig.scaledNeckLocal = { ...(rig.neckLocal || {}), y: (Number(rig.neckLocal?.y) || 0) + scaledNeckDeltaY,
          deltaY: scaledNeckDeltaY, relativeHeadScaleY: relativeHeadY }; // Legacy diagnostics preserve their existing neck position.
      }
    }
    return true;
  }

  function worldVisualScale() {
    const authored = Number(window.HobunjiCharacterRigScaleDefaults?.worldHeightCalibration?.uniformScale); // Absent in restored main silhouette defaults: 1.0 instead of the later 6'3\" global enlargement.
    return Number.isFinite(authored) && authored > 0 ? authored : 1; // Safe during early bootstrap before the defaults script finishes loading.
  }

  const _pixelHeightFactors = new Map(); // One solved correction per source-art measurement and species/gender, not per NPC or render frame.
  const _scaledParents = new Set(); // Only weak references to live character parents; one batched reapplication when bare-PNG measurement finishes.
  const _knownParents = typeof WeakMap === 'function' ? new WeakMap() : null; // Deduplicates repeated actor updates without retaining their meshes.
  function trackScaledParent(parent) {
    if (!_knownParents || typeof WeakRef !== 'function' || _knownParents.has(parent)
      || !window.HobunjiCharacterRigScaleDefaults?.maleHeightFeet
      || window.HobunjiCharacterDimensions?.status === 'ready') return; // No height goals in the restored main baseline, so skip the obsolete measured-crown rescale registry altogether.
    const reference = new WeakRef(parent); // Does not prevent off-screen/NPC/despawned actors from being garbage collected.
    _knownParents.set(parent, reference);
    _scaledParents.add(reference);
  }
  function refreshMeasuredHeights() {
    // CharacterDimensions finishes its once-per-session bare-PNG pass after some actors already exist.
    // Reapply *only* those active targets; complete the batch in short chunks to avoid a CPU spike in town.
    if (!_scaledParents.size || !window.HobunjiCharacterDimensions) return 0;
    const eligible = [];
    for (const weak of _scaledParents) {
      const parent = weak.deref();
      if (!parent) { _scaledParents.delete(weak); continue; }
      const state = parent.userData?.hobunjiCharacterRigScaleState;
      const sourceSpecies = state?.sourceSpecies;
      if (sourceSpecies && window.HobunjiCharacterRigScaleDefaults?.maleHeightFeet?.[sourceSpecies]
        && window.HobunjiCharacterDimensions.measurementFor?.(sourceSpecies, state.gender))
        eligible.push({ parent, species: sourceSpecies, gender: state.gender,
          authored: state.authoredScale, age: state.ageFraction });
    }
    const count = eligible.length;
    _scaledParents.clear(); // The scan has completed; release registry wrappers after capturing only affected live actors.
    let cursor = 0; // Each tracked actor is revisited once after the existing PNG scan, not shifted through an O(n²) queue.
    const applyChunk = () => {
      for (let n = 0; n < 24 && cursor < eligible.length; n++) {
        const item = eligible[cursor++];
        if (item.parent.userData?.hobunjiCharacterRigScaleState)
          applyToParent(item.parent, item.species, item.gender, item.authored, item.age);
      }
      if (cursor < eligible.length) setTimeout(applyChunk, 0); // One-time 24-actor batches, not a per-frame watcher.
    };
    applyChunk();
    return count;
  }

  function pixelHeightCorrectionFor(species, gender) {
    const defaults = window.HobunjiCharacterRigScaleDefaults; // Eight requested physical-height goals; other species retain their authored relative shifts.
    const normalizedSpecies = normalizeKey(species); // Keep explicit Mammakhbuur/other subspecies goals; transformation aliases may borrow a donor portrait but NOT the donor's height target.
    const g = normalizeGender(gender);
    const maleFeet = Number(defaults?.maleHeightFeet?.[normalizedSpecies]);
    if (!(maleFeet > 0)) return 1;
    const dim = window.HobunjiCharacterDimensions; // Existing one-per-session bare PNG pixel scanner, not a new texture readback.
    const measurement = dim?.measurementFor?.(normalizedSpecies, g);
    if (!measurement || typeof dim?.dimensionsFor !== 'function') return 1; // Early startup uses nominal defaults until exact PNGs are measured.
    const portraitOptions = { speciesId: normalizedSpecies, gender: g };
    const portraitMultiplier = Number(window.PNGPlaneAvatar?.avatarScaleMultiplierFor?.(portraitOptions)) || 1;
    const placement = Number(window.PNGPlaneAvatar?.avatarPlacementRatioFor?.(portraitOptions)) || .5;
    const base = defaults.scaleFor(normalizedSpecies, g); // The shipped authored values; independent of a user's local live edits.
    const world = worldVisualScale();
    const ratio = g === 'female' ? Number(defaults.femaleVisibleHeightRatio) || 1 : 1;
    const target = (Number(defaults.worldHeightCalibration?.chairBackWorldHeight) || .66)
      * maleFeet * ratio / (Number(defaults.worldHeightCalibration?.chairHeightFeet) || 3) / world;
    const key = `${normalizedSpecies}::${g}`;
    const cached = _pixelHeightFactors.get(key);
    if (cached && cached.measurement === measurement && cached.base === base
      && cached.portraitMultiplier === portraitMultiplier && cached.placement === placement && cached.target === target)
      return cached.correction;
    const heightAt = candidateY => { // Actual alpha-measured bare crown, including the head bone's 65% scale and portrait Y offset.
      const dimensions = dim.dimensionsFor(normalizedSpecies, g, {
        portraitScale: portraitMultiplier, placementRatio: placement, age: 0,
        rigScale: { ...base, y: candidateY, legLength: candidateY },
      });
      return Number(dimensions?.height);
    };
    const lower = .1, upper = 4; // Current authored body-height envelope, never NaN or unbounded scaling.
    let lo = lower, hi = upper;
    const lowHeight = heightAt(lo), highHeight = heightAt(hi);
    if (!Number.isFinite(lowHeight) || !Number.isFinite(highHeight) || !(highHeight > lowHeight)
      || !(Number(base?.y) > 0)) return 1;
    if (target <= lowHeight) hi = lo;
    else if (target >= highHeight) lo = hi;
    else for (let n = 0; n < 28; n++) { // Fixed-cost solve ONCE per identity; no per-frame scans.
      const mid = (lo + hi) / 2;
      if (heightAt(mid) < target) lo = mid; else hi = mid;
    }
    const effectiveY = (lo + hi) / 2;
    const correction = effectiveY / Number(base.y); // Apply vertically to the assembled parent, not to unrelated width/hand/foot transforms.
    _pixelHeightFactors.set(key, { measurement, base, portraitMultiplier, placement, target, correction,
      solvedWorldHeight: heightAt(effectiveY) * world, targetWorldHeight: target * world });
    return Number.isFinite(correction) && correction > 0 ? correction : 1;
  }
  function pixelHeightCalibrationSnapshot() {
    return Object.fromEntries([..._pixelHeightFactors].map(([key, value]) => [key, {
      correction: value.correction, measuredWorldHeight: value.solvedWorldHeight,
      targetWorldHeight: value.targetWorldHeight,
    }])); // Mobile diagnostics: measured actual crown instead of the older nominal plane-height estimate.
  }

  function applyToParent(parent, species, gender, explicitScale = null, ageFraction = 0) {
    if (!parent?.isObject3D || !parent.scale) return false;
    const resolved = normalizeExplicitScale(explicitScale, scaleFor(species, gender));
    const artHeightCorrection = pixelHeightCorrectionFor(species, gender); // Source-PNG measured crown calibration; defaults to 1 before artwork has loaded.
    const corrected = artHeightCorrection === 1 ? resolved : {
      ...resolved, y: resolved.y * artHeightCorrection,
      legLength: (Number(resolved.legLength) > 0 ? Number(resolved.legLength) : Number(resolved.y) || 1) * artHeightCorrection,
    }; // Both portrait and legs follow calibrated height; preserve beltline ratio and authored body/limb settings.
    const limit = corrected.ageComposed === true ? v => v : clampScale;
    const next = { x: limit(corrected.x), y: limit(corrected.y) }; // Body Y is refined from painted PNG bounds rather than nominal canvas height.
    const worldMultiplier = worldVisualScale(); // Common outer transform scales portrait, hands, feet, head, and offsets together without resetting species ratios.
    parent.userData ||= {};
    const previous = parent.userData.hobunjiCharacterRigScaleState || null;
    const current = { x: Number(parent.scale.x), y: Number(parent.scale.y), z: Number(parent.scale.z) };
    let base = current;
    if (previous && vectorNear(current, previous.output)) {
      const priorWorld = Number(previous.worldVisualScale) > 0 ? Number(previous.worldVisualScale) : 1; // Older scale state had no shared height calibration.
      const divisorX = (Number(previous.factor?.x ?? previous.factor) || 1) * priorWorld;
      const divisorY = (Number(previous.factor?.y ?? previous.factor) || 1) * priorWorld;
      base = { x: current.x / divisorX, y: current.y / divisorY, z: current.z / divisorX };
    }
    const output = { x: base.x * next.x * worldMultiplier, y: base.y * next.y * worldMultiplier,
      z: base.z * next.x * worldMultiplier }; // One uniform outer size factor; depth and head must grow with the body, not remain fixed.
    const legLength = limit(corrected.legLength || next.y); // Measured height scales legs and portrait together, leaving the relative IK ratio intact.
    const previousLegRatio = previous
      ? (Number(previous.legLength) || (Number(previous.factor?.y ?? previous.factor) || 1)) / (Number(previous.factor?.y ?? previous.factor) || 1)
      : null; // Used to avoid notifying every NPC's procedural leg handle when only Head, Width or age changed.
    const nextLegRatio = legLength / next.y; // A 1:1 ratio leaves the old whole-body Y behavior unchanged.
    parent.scale.set(output.x, output.y, output.z);
    parent.userData.hobunjiCharacterRigScaleState = {
      sourceSpecies: normalizeKey(species), // Preserve separate source-species targets even when an avatar borrows a donor portrait.
      authoredScale: resolved, // Reapply exactly the same saved edit after late pixel measurement without writing to localStorage.
      ageFraction, // Retain the same staged hunch and head transition on one-time recalibration.
      factor: next,
      worldVisualScale: worldMultiplier, // Kept separate so repeated updates and clearFromParent can restore the exact pre-calibration scale.
      legLength, // Procedural legs use this independently authored reach.
      base,
      output,
      species: transformSpecies(species),
      gender: normalizeGender(gender),
      groundRelative: true,
      coordinateSpace: 'character-floor-parent',
    };
    parent.updateMatrix?.();
    parent.updateMatrixWorld?.(true);
    applyHeadCompensation(parent, species, gender, { ...corrected, y: next.y }, ageFraction); // Compensate the ACTUAL clamped parent Y at all UI extremes.
    if (previousLegRatio == null || Math.abs(previousLegRatio - nextLegRatio) > EPSILON)
      window.ProceduralLegAnimation?.syncScaleForParent?.(parent, nextLegRatio); // Leg IK changes only when its actual leg/portrait ratio changes, never on unrelated head/age redraws.
    trackScaledParent(parent); // WeakRef only; repeated character edits add no new registry entries.
    return true;
  }

  function clearFromParent(parent) {
    const state = parent?.userData?.hobunjiCharacterRigScaleState;
    if (!parent?.scale || !state) return false;
    parent.scale.set(state.base.x, state.base.y, state.base.z);
    delete parent.userData.hobunjiCharacterRigScaleState;
    parent.updateMatrix?.();
    parent.updateMatrixWorld?.(true);
    window.ProceduralLegAnimation?.syncScaleForParent?.(parent, 1); // Clearing the parent scale also clears its old leg/portrait ratio and restored hip-to-torso offset.
    const found = findNeckRig(parent);
    const target = found?.rig?.headScaleJoint || found?.rig?.neckJoint; // Scaling stays on the head-scale bone.
    const offsetTarget = found?.rig?.headOffsetJoint || target; // Restore the separately offset parent as well when resetting a portrait.
    if (target) {
      target.scale.set(1, 1, 1);
      target.updateMatrix?.();
    }
    if (found?.rig?.scaledNeckLocal) delete found.rig.scaledNeckLocal; // Resetting an authored scale also clears derived scaled-head contact diagnostics.
    if (found?.rig?.neckReachAppliedY != null && typeof window.HobunjiCharacterSpine?.applyNeckReach === 'function') {
      window.HobunjiCharacterSpine.applyNeckReach(found.rig, 0, Number(found.modelHeight) || 1, 0); // Clear all scale-induced spine stretch and hunch when resetting a scale preview.
    }
    if (offsetTarget) {
      if (Number.isFinite(offsetTarget.userData?.hobunjiHeadOffsetBaseY)) {
        offsetTarget.position.y = offsetTarget.userData.hobunjiHeadOffsetBaseY;
      }
      offsetTarget.updateMatrix?.();
    }
    return true;
  }

  // The one floor-relative node that owns a character's whole visual rig
  // (portrait + feet + hands). The player's hand parent IS that node
  // (playerMesh). NPC walkers keep their hands under a lean pivot below it, so
  // they flag the real owner with userData.hobunjiCharacterRigScaleRoot and
  // hand attachment scales that — otherwise only the hands (not the body and
  // feet they belong to) received the species scale.
  function rigScaleRootFor(node) {
    for (let current = node; current; current = current.parent) {
      if (current.userData?.hobunjiCharacterRigScaleRoot === true) return current;
    }
    return node || null;
  }

  // True when an ancestor already carries this character's species body scale
  // (hostiles scale their whole center-anchored group), so the hand parent
  // must inherit it instead of being scaled a second time.
  function rigScaleInheritedFor(node) {
    for (let current = node; current; current = current.parent) {
      if (current.userData?.hobunjiCharacterRigScaleInherited === true) return true;
    }
    return false;
  }

  // Find the scale owner so limb geometry can cancel inherited body proportions.
  function characterScaleOwnerFor(node) {
    for (let current = node; current; current = current.parent) {
      if (current.userData?.hobunjiCharacterRigScaleState?.factor || current.userData?.hobunjiCharacterPartScaleFactors) return current;
    }
    return null;
  }

  function bodyScaleFactorsFor(node) {
    const owner = characterScaleOwnerFor(node);
    return owner?.userData?.hobunjiCharacterRigScaleState?.factor || owner?.userData?.hobunjiCharacterPartScaleFactors || null;
  }

  function partScaleAxesFor(species, gender, part, profile = profileFor(species, gender)) {
    const authored = profile?.anatomy?.[part === 'hand' ? 'handScaleAxes' : 'footScaleAxes']; // Live axis editing replaces the fixed adult default.
    return authored || window.HobunjiCharacterRigScaleDefaults?.partAxesFor?.(species, gender, part) || NEUTRAL_PART_AXES;
  }

  const NEUTRAL_PART_AXES = Object.freeze({ x: 1, y: 1, z: 1 }); // Standalone tools may omit the defaults script.

  // Authored part axes act in the floor-parent frame before joint rotations.
  // Conjugating through the joint chain keeps the part origin/arm reach fixed
  // and gives the same size during idle, grip rotation, and leg animation.
  function installPartScaleAxes(THREE, node, reference, axes, independentCharacterScale = false) {
    if ((!axes && !independentCharacterScale) || !node?.updateMatrix || !reference) return false;
    const initial = (typeof axes === 'function' ? axes() : axes) || { x: 1, y: 1, z: 1 }; // Missing authored axes still require uniform body compensation.
    const values = ['x', 'y', 'z'].map(axis => Number(initial[axis])); // Additional explicit part-axis tweaks stay separate from body X/Y.
    if (!values.every(value => Number.isFinite(value) && value > 0)) return false;
    const authored = new THREE.Matrix4().makeScale(...values); // Legacy per-part authoring.
    const bodyInverse = new THREE.Matrix4(); // Counteracts inherited body sizing around the fixed part origin.
    const ancestry = new THREE.Matrix4(); // Reused joint chain, without positional offsets.
    const inverse = new THREE.Matrix4(); // Reused reverse joint chain for size-only changes.
    const correction = new THREE.Matrix4(); // Reused part-local transform.
    const update = node.updateMatrix; // Base Three.js matrix composition remains the authority.
    let scaleOwner = null; // Hostile rigs receive their final body-scale metadata after initial foot construction.
    function applyInFrame(part, frame, target) {
      if (!frame) return false;
      ancestry.identity();
      let ancestor = part.parent;
      while (ancestor && ancestor !== frame) {
        if (ancestor.matrixAutoUpdate) ancestor.updateMatrix();
        ancestry.premultiply(ancestor.matrix);
        ancestor = ancestor.parent;
      }
      if (ancestor !== frame) return false;
      ancestry.setPosition(0, 0, 0);
      inverse.copy(ancestry).invert();
      correction.copy(inverse).multiply(target).multiply(ancestry);
      part.matrix.premultiply(correction);
      return true;
    }
    node.updateMatrix = function updateAuthoredPartMatrix() {
      update.call(this);
      if (window.HobunjiAttackEditorHandCalibrationMode?.active) return; // Calibration mode keeps the existing neutral comparison.
      const current = (typeof axes === 'function' ? axes() : axes) || NEUTRAL_PART_AXES;
      if (current && (Number(current.x) !== values[0] || Number(current.y) !== values[1] || Number(current.z) !== values[2])) {
        const next = ['x', 'y', 'z'].map(axis => Number(current[axis]));
        if (!next.every(value => Number.isFinite(value) && value > 0)) return;
        values[0] = next[0]; values[1] = next[1]; values[2] = next[2];
        authored.makeScale(...values);
      }
      let changed = false;
      if (values[0] !== 1 || values[1] !== 1 || values[2] !== 1) changed = applyInFrame(this, reference, authored);
      if (independentCharacterScale) {
        if (!scaleOwner) scaleOwner = characterScaleOwnerFor(reference);
        const factors = scaleOwner?.userData?.hobunjiCharacterRigScaleState?.factor || scaleOwner?.userData?.hobunjiCharacterPartScaleFactors;
        const x = Number(factors?.x), y = Number(factors?.y);
        if (x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y) && (x !== 1 || y !== 1)) {
          bodyInverse.makeScale(1 / x, 1 / y, 1 / x);
          changed = applyInFrame(this, scaleOwner, bodyInverse) || changed;
        }
      }
      if (changed) this.matrix.setPosition(this.position); // Preserve hand grips, ankle locations and attachment origins.
    };
    return true;
  }

  const api = Object.freeze({
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    maxOffsetFraction: MAX_OFFSET_FRACTION,
    maxAgeHunchFraction: MAX_AGE_HUNCH_FRACTION,
    ageHunchFraction,
    ageFor,
    childHeadFactorFor,
    defaultScaleFor,
    profileFor,
    scaleFor,
    rawPngHeadScaleFor, // Head=100% means source-PNG pixel proportions across all species/genders.
    runtimeHeadScaleForRaw, // Existing rig saves keep runtime head factors; Full Character Scale inverts the portrait multiplier.
    worldVisualScale, // Shared chair-world factor; new pixel correction refines only body Y.
    pixelHeightCorrectionFor,
    pixelHeightCalibrationSnapshot, // Exposes actual measured crown-to-height accuracy on mobile.
    refreshMeasuredHeights, // Called once when CharacterDimensions completes its existing bare-PNG scan.
    heightBeltlineFor,
    scaleForHeightBeltline,
    legLengthRatioFor: (species, gender, profile = null) => { const resolved = scaleFor(species, gender, profile); return resolved.legLength / resolved.y; }, // Real game and lineup feet read the same post-migration ratio.
    applyToParent,
    applyHeadCompensation,
    scaledNeckAdjustment, // Shared pure geometric calculation for the author and native regression tests.
    clearFromParent,
    rigScaleRootFor,
    rigScaleInheritedFor,
    bodyScaleFactorsFor,
    partScaleAxesFor,
    installProfileDefaults,
    installPartScaleAxes,
  });
  window.HobunjiCharacterRigScale = api;

  // Main-silhouette parity: the post-main height targets and 65%-head profile injection
  // are intentionally absent. No profile mutations happen at bootstrap; authored and
  // persisted rig values are restored through the explicit adult-only editor action.
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.mainSilhouetteParity = {
    reference: '4cfb39c', canonicalAdults: Object.keys(window.HobunjiCharacterRigScaleDefaults?.values || {}).length,
    globalVisualScale: worldVisualScale(), mainReferenceAvailable: !!window.HobunjiCharacterRigScaleDefaults?.mainSilhouetteRestoreValues,
  }; // Mobile diagnostics, no mesh iteration.

  function installHandParentRuntime() {
    const hands = window.ProceduralHandAttachments;
    if (!hands?.attach) return false;
    if (hands.attach.__hobunjiCharacterRigScaleWrapped) return true;
    const base = hands.attach.bind(hands);
    const wrapped = function characterRigScaleHandAttach(THREE, parent, options = {}) {
      // The direct-hand runtime deliberately attaches to the same floor-relative
      // character parent that owns the body assembly. Scaling that one parent
      // therefore scales portrait + hands + already-attached feet exactly once.
      // The avatarRoot (carrying userData.neckRig) is already a descendant of
      // parent by this point, so the head-compensation lookup inside
      // applyToParent finds it. Age comes from the NPC's authored aging block
      // (see ageFor) so this reapplication keeps the build-time hunch.
      if (!rigScaleInheritedFor(parent)) applyToParent(rigScaleRootFor(parent), options.speciesId || options.profile?.speciesId || options.profile?.species, options.gender || options.profile?.gender, null, ageFor(options));
      return base(THREE, parent, options);
    };
    Object.assign(wrapped, base);
    wrapped.__hobunjiCharacterRigScaleWrapped = true;
    hands.attach = wrapped;
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterRigScaleRuntimeHook = 'ProceduralHandAttachments.floor-parent';
    return true;
  }

  function installAnimationAuthor() {
    if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return true;
    const required = ['configuredCharacterAnatomyV1530', 'renderCharacterAnatomySectionV1530', 'bindCharacterAnatomyControlsV1530', 'attachmentRigProfileForActor'];
    if (!required.every(name => typeof window[name] === 'function')) return false;
    if (window.__hobunjiCharacterRigScaleAuthorInstalled) return true;

    const baseConfiguredAnatomy = window.configuredCharacterAnatomyV1530;
    window.configuredCharacterAnatomyV1530 = function characterRigScaleConfiguredAnatomy(species, gender, source = {}) {
      const result = baseConfiguredAnatomy.apply(this, arguments);
      const resolved = scaleFor(species, gender, source);
      result.rigScaleX = resolved.x;
      result.rigScaleY = resolved.y;
      result.headScale = resolved.head;
      result.headOffsetY = resolved.offsetY;
      return result;
    };

    const baseRememberScale = window.rememberRigActorBodyScaleV1531;
    if (typeof baseRememberScale === 'function') {
      window.rememberRigActorBodyScaleV1531 = function rememberBodyScaleWithoutWholeRigFactor(actor) {
        const result = baseRememberScale.apply(this, arguments);
        const state = actor?.visualOffset?.userData?.hobunjiCharacterRigScaleState;
        const saved = actor?.rigBodyVisualOffsetBaseScaleV1535;
        if (state && saved) {
          const fx = (Number(state.factor?.x ?? state.factor) || 1);
          const fy = (Number(state.factor?.y ?? state.factor) || 1);
          saved.x /= fx; saved.y /= fy; saved.z /= fx;
        }
        return result;
      };
    }

    const baseBodyPreview = window.previewRigActorBodyScaleV1531;
    if (typeof baseBodyPreview === 'function') {
      window.previewRigActorBodyScaleV1531 = function bodyPreviewWithWholeRigScale(actor) {
        const result = baseBodyPreview.apply(this, arguments);
        const profile = actor ? window.attachmentRigProfileForActor(actor) : null;
        if (actor?.visualOffset && profile) applyToParent(actor.visualOffset, profile.species, profile.gender, scaleFor(profile.species, profile.gender, profile));
        return result;
      };
    }

    const baseRender = window.renderCharacterAnatomySectionV1530;
    window.renderCharacterAnatomySectionV1530 = function renderCharacterAnatomyWithWholeRigScale(actor) {
      let html = baseRender.apply(this, arguments);
      const profile = actor ? window.attachmentRigProfileForActor(actor) : null;
      const resolved = scaleFor(profile?.species || actor?.source?.species, profile?.gender || actor?.source?.gender, profile);
      const field = `<div class="maaField"><label for="maaRigScaleX">Body width (%)</label><input id="maaRigScaleX" type="number" min="10" max="400" step="2.5" value="${(resolved.x * 100).toFixed(1)}"></div>`
        + `<div class="maaField"><label for="maaRigScaleY">Body height (%)</label><input id="maaRigScaleY" type="number" min="10" max="400" step="2.5" value="${(resolved.y * 100).toFixed(1)}"></div>`
        + `<div class="maaField"><label for="maaHeadScale">Head scale (%)</label><input id="maaHeadScale" type="number" min="10" max="400" step="2.5" value="${(resolved.head * 100).toFixed(1)}"></div>`
        + `<div class="maaField"><label for="maaHeadOffsetY">Head Y offset (%)</label><input id="maaHeadOffsetY" type="number" min="-${(MAX_OFFSET_FRACTION * 100).toFixed(0)}" max="${(MAX_OFFSET_FRACTION * 100).toFixed(0)}" step="0.5" value="${(resolved.offsetY * 100).toFixed(1)}"></div>`;
      const marker = '<div class="maaField"><label for="maaArmLengthOffset">';
      html = html.includes(marker) ? html.replace(marker, `${field}${marker}`) : html;
      html = html.replace(
        'Body scale previews immediately and rebuilds the full anatomy when released.',
        'Body scale changes portrait anatomy. Body width/height uniformly scale the assembled character around ground Y=0 without rewriting any internal coordinates, independently of one another. Head scale is compensated at the neck rig so it never inherits the body’s aspect ratio, and can be tuned on its own. Head Y offset nudges the head up/down (as a % of model height) and composes with any per-NPC age hunch set elsewhere. Body scale previews immediately and rebuilds the full anatomy when released.',
      );
      return html;
    };

    const baseBind = window.bindCharacterAnatomyControlsV1530;
    window.bindCharacterAnatomyControlsV1530 = function bindCharacterAnatomyWithWholeRigScale(actor) {
      const result = baseBind.apply(this, arguments);
      const inputs = {
        x: document.getElementById('maaRigScaleX'),
        y: document.getElementById('maaRigScaleY'),
        head: document.getElementById('maaHeadScale'),
        offsetY: document.getElementById('maaHeadOffsetY'),
      };
      if (!inputs.x || !inputs.y || !inputs.head || !inputs.offsetY || inputs.x.dataset.hobunjiRigScaleBound === '1') return result;
      inputs.x.dataset.hobunjiRigScaleBound = '1';
      const applyInputs = () => {
        const profile = window.attachmentRigProfileForActor(actor);
        if (!profile) return;
        profile.anatomy ||= {};
        profile.anatomy.rigScaleX = clampScale(Number(inputs.x.value) / 100);
        profile.anatomy.rigScaleY = clampScale(Number(inputs.y.value) / 100);
        profile.anatomy.headScale = clampScale(Number(inputs.head.value) / 100);
        profile.anatomy.headOffsetY = clampOffset(Number(inputs.offsetY.value) / 100);
        applyToParent(actor.visualOffset, profile.species || actor.source?.species, profile.gender || actor.source?.gender, {
          x: profile.anatomy.rigScaleX, y: profile.anatomy.rigScaleY, head: profile.anatomy.headScale, offsetY: profile.anatomy.headOffsetY,
        });
        try { window.publishCharacterHandShouldersV1525?.(actor, profile); } catch (_) {}
        window.ProceduralHandFrameDriver?.syncNow?.();
      };
      for (const input of Object.values(inputs)) {
        input.addEventListener('input', applyInputs);
        input.addEventListener('change', applyInputs);
      }
      return result;
    };

    const baseSerialize = window.serializeAttachmentRigLibrary;
    if (typeof baseSerialize === 'function' && !baseSerialize.__hobunjiWholeRigScaleExportWrapped) {
      const wrappedSerialize = function serializeWholeRigScale() {
        const data = baseSerialize.apply(this, arguments);
        data.rigScaleSemantics = {
          profileFields: {
            x: 'characters.<species>::<gender>.anatomy.rigScaleX',
            y: 'characters.<species>::<gender>.anatomy.rigScaleY',
            head: 'characters.<species>::<gender>.anatomy.headScale',
            offsetY: 'characters.<species>::<gender>.anatomy.headOffsetY',
          },
          legacyProfileField: 'characters.<species>::<gender>.anatomy.rigScale (pre-split uniform value, still honored as a fallback for x/y/head when they are absent)',
          default: 1,
          defaultOffsetY: 0,
          pivot: 'character floor origin (Y=0)',
          behavior: 'x/y independently scale the whole assembled body (portrait/hands/feet/attachments) around the floor origin; head is separately scaled and compensated at the neck rig bone so it never inherits the body’s aspect ratio. headOffsetY (fraction of model height) additionally repositions just the head, composed with a separate per-NPC age-hunch factor supplied at runtime (not stored on this profile). Local anchor/hand/foot coordinates remain unchanged.',
          runtime: true,
        };
        return data;
      };
      wrappedSerialize.__hobunjiWholeRigScaleExportWrapped = true;
      window.serializeAttachmentRigLibrary = wrappedSerialize;
    }

    const selected = window.selectedAnimationActor?.();
    if (selected?.source?.type === 'npc') {
      const profile = window.attachmentRigProfileForActor(selected);
      if (profile) applyToParent(selected.visualOffset, profile.species, profile.gender, scaleFor(profile.species, profile.gender, profile));
    }

    window.__hobunjiCharacterRigScaleAuthorInstalled = true;
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.wholeRigScale = 'ground-relative runtime/editor parent scale installed (independent x/y, compensated head, head Y offset)';
    if (selected?.source?.type === 'npc') window.renderAttachmentRigInspector?.();
    return true;
  }

  let attempts = 0;
  let timer = null; // Plain `let`, not `const`: a synchronous setInterval mock (as used by scripts/test-character-rig-scale.js) invokes the callback before a `const` binding would finish initializing, throwing on the very first tick if everything is already ready.
  timer = setInterval(() => {
    const defaultsReady = installProfileDefaults();
    const handReady = installHandParentRuntime();
    const authorReady = installAnimationAuthor();
    if ((defaultsReady && handReady && authorReady) || ++attempts >= 600) clearInterval(timer);
  }, 50);
  installProfileDefaults();
  installHandParentRuntime();
  installAnimationAuthor();
})();
