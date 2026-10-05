// Held-item-local grip and scale authoring shared by gameplay and the Attack Animation Editor.
// A primary grip is a target frame ON THE ITEM. The animation owns the item's transform;
// grip authoring moves the RIGHT HAND to that frame and never inverse-moves the weapon.
// Two-hand attack poses sample independent main/offhand Z ranges at 0..100%.
// Both blend out of the fixed 1H grip/idle hand; idle and ranged never use the ranges. Each shape has an authored
// base toolScale plus a heightMultiplier that follows HobunjiCharacterDimensions relative
// to Mao'ao male height; the same effective scale also expands grip-point positions.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji_hand_tool_grips.v1';
  const LOCAL_KEY = 'hobunji.handToolGrips.v1';
  const HEIGHT_REFERENCE_SPECIES = 'mao-ao'; // Baseline body used when turning calculated character height into a relative weapon scale.
  const HEIGHT_REFERENCE_GENDER = 'male';
  const DEFAULT_HEIGHT_MULTIPLIER = 0.5; // Half of the calculated-height difference reaches weapon size unless a shape authors otherwise.
  const HEIGHT_MULTIPLIER_PRESET = 'height-multiplier-0.5-v1'; // One-time migration of drafts saved when every shape defaulted to 1.
  const SECONDARY_GRIP_PRESET = 'animation-span-v1'; // Migrates old always-on secondary points into animation-gated Z spans.
  const MANUAL_MELEE_SPAN_PRESET = 'manual-handle-spans-20261004-v1'; // Updates the six inspected handle ranges in older saved drafts once.
  const MANUAL_MELEE_SPAN_TOOLS = new Set(['plainssword', 'bshuakauitl', 'fishingspear', 'pickshovel', 'hoe', 'hatchet']); // Limits that migration to the manually inspected weapons.
  const TWO_HAND_SPAN_PRESET = 'paired-hand-spans-20261004-v1'; // Migrates the six weapons to separate main/offhand ranges once.
  const LONG_HAFT_GRIP_PRESET = 'long-haft-center-20261004-v1'; // Migrates the three measured long-haft weapons to their wood/tan-section centers once.
  const LONG_HAFT_GRIP_TOOLS = new Set(['bshuakauitl', 'fishingspear', 'pickshovel']); // Keeps the measured-center migration from touching other authored weapons.
  const PRIMARY_ROTATION_PRESET = 'hatchet-primary-xy-rotation-20260921-v3'; // Hatchet is the canonical right-hand grip example: propagate its X, Y, and rotation to every other tool, never its item-specific Z.
  const PRE_AUTHORED_RANGED_GRIP_PRESET = 'melee-ranged-split-20260920-v4-editor-authored'; // Previous committed split cloned melee into ranged; used only to migrate untouched old dagger defaults.
  const PRE_END_FLIP_DAGGER_RANGED_PRESET = 'melee-ranged-split-20260920-v5-authored-values'; // Previous authored dagger used ranged Z -0.30 before Tool End Flip's visible-axis correction changed the needed hand target.
  const PRE_MIRRORED_DAGGER_RANGED_PRESET = 'melee-ranged-split-20260920-v6-end-flip-adjusted'; // First post-flip trial used +0.28 before confirming the visible 180° flip mirrors tool-local Z.
  const PRE_SPEAR_END_FLIP_RANGED_PRESET = 'melee-ranged-split-20260920-v7-end-flip-mirrored'; // Previous preset corrected the dagger's flipped Z grip but left the fishing spear's nonzero X on the unflipped side.
  const RANGED_GRIP_PRESET = 'melee-ranged-split-20260921-v8-spear-end-flip-mirrored'; // End-flipped ranged grips now mirror every nonzero in-plane coordinate needed by their authored hand target.
  const AUTO_DAGGER_RANGED_PRESETS = new Set(['melee-ranged-split-20260920-v1', 'melee-ranged-split-20260920-v3-dagger']); // Short-lived branch guesses used scale .55 with ranged Z .28; untouched copies migrate to the authored dagger values.
  const HATCHET_PRIMARY_GRIP_EXAMPLE = Object.freeze({
    x: -0.04,
    y: -0.04,
    rotationDeg: Object.freeze({ pitch: 90, yaw: -90, roll: 0 }),
  });
  const CRAFTED_METAL_SUFFIX = /-(?:nativecopper|lowtinbronze|tinbronze|hightinbronze|arsenicalbronze|leadedbronze)$/;
  const visualBases = new WeakMap(); // Original held-item visual position/rotation/scale; authored corrections are reapplied from these every frame.
  const listeners = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));

  function identityTransform() {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
    };
  }

  function disabledLegacySecondary() {
    return { enabled: false, ...identityTransform() }; // Internal compatibility only; the old point editor is hidden.
  }

  // Authored by hand: light pairs share the fixed grip as their combined center;
  // heavy main-hand ranges center on that grip, farther from the positive-Z working end.
  const DEFAULT_DATA = {
    schema: SCHEMA,
    secondaryGripPreset: SECONDARY_GRIP_PRESET,
    manualMeleeSpanPreset: MANUAL_MELEE_SPAN_PRESET,
    twoHandSpanPreset: TWO_HAND_SPAN_PRESET,
    longHaftGripPreset: LONG_HAFT_GRIP_PRESET,
    primaryRotationPreset: PRIMARY_ROTATION_PRESET,
    rangedGripPreset: RANGED_GRIP_PRESET,
    heightMultiplierPreset: HEIGHT_MULTIPLIER_PRESET,
    tools: {
      hatchet: {
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0106 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        primaryGripSpan: { enabled: true, startZ: -0.0606, endZ: 0.0394 }, // Main-hand range used only by 2H attack poses.
        secondaryGripSpan: { enabled: true, startZ: 0.1, endZ: 0.2 }, // Offhand range paired with the main-hand range.
        toolScale: 1,
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0106 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      hoe: {
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        primaryGripSpan: { enabled: true, startZ: -0.06, endZ: 0.06 }, // Main-hand range used only by 2H attack poses.
        secondaryGripSpan: { enabled: true, startZ: 0.2, endZ: 0.4 }, // Offhand range paired with the main-hand range.
        toolScale: 1,
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      bshuakauitl: {
        toolScale: 1.3,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0006 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        primaryGripSpan: { enabled: true, startZ: 0.0394, endZ: 0.1594 }, // Main-hand range translated around the measured tan-section center.
        secondaryGripSpan: { enabled: true, startZ: -0.1606, endZ: -0.0406 }, // Offhand range stays opposite the main range around the fixed 1H grip.
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0006 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      pickshovel: {
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0178 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        primaryGripSpan: { enabled: true, startZ: -0.2378, endZ: -0.1178 }, // Main-hand range translated around the measured brown-haft center.
        secondaryGripSpan: { enabled: true, startZ: 0.0822, endZ: 0.2022 }, // Offhand range stays opposite the main range around the fixed 1H grip.
        toolScale: 1,
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0178 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      daggersword: {
        toolScale: 1.3,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0.1687 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0.1687 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      plainssword: {
        toolScale: 1.3,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.2672 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        primaryGripSpan: { enabled: true, startZ: -0.2822, endZ: -0.2522 }, // Main-hand range used only by 2H attack poses.
        secondaryGripSpan: { enabled: true, startZ: -0.245, endZ: -0.225 }, // Offhand range paired with the main-hand range.
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: -0.2672 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      dagger: {
        toolScale: 0.55,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.09 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedPrimaryGrip: { position: { x: 0, y: -0.05, z: -0.28 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      kylie: {
        toolScale: 1.05,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0.0038 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0.0038 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      warcleaver: {
        toolScale: 1.05,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0.01 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0.01 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      fishingspear: {
        toolScale: 1.15,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.1522 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        primaryGripSpan: { enabled: true, startZ: -0.3522, endZ: -0.2322 }, // Main-hand range translated around the measured long wood-section center.
        secondaryGripSpan: { enabled: true, startZ: -0.0722, endZ: 0.0478 }, // Offhand range stays opposite the main range around the fixed 1H grip.
        rangedPrimaryGrip: { position: { x: 0.04, y: -0.04, z: 0.1522 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } }, // Tool End Flip mirrors both in-plane X and Z for the same physical grip.
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      fishingmace: {
        toolScale: 1.15,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
    },
  };

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function toolKeyFor(value) {
    const key = normalizeKey(value).replace(CRAFTED_METAL_SUFFIX, '');
    if (key.includes('hatchet')) return 'hatchet';
    if (key.includes('hoe')) return 'hoe';
    if (key.includes('pickshovel') || key.includes('pick-shovel')) return 'pickshovel';
    if (key.includes('fishingspear') || key.includes('fishing-spear')) return 'fishingspear';
    if (key.includes('fishingmace') || key.includes('fishing-mace')) return 'fishingmace';
    if (key === 'dagger-sword') return 'daggersword';
    return key;
  }

  const DUAL_WIELD_WEAPONS = new Set(['dagger', 'daggersword', 'kylie']);
  function isDualWieldWeapon(value) { return DUAL_WIELD_WEAPONS.has(toolKeyFor(value)); }
  function weaponHandModeForTool(value) {
    const key = toolKeyFor(value); // Resolves the applicable pose flag in editor previews and gameplay.
    return key === 'fishingmace' ? 'single' : (isDualWieldWeapon(key) ? 'dual' : 'two-hand');
  }

  function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function clamp01(value) { return clamp(value, 0, 1); }

  function normalizeToolScale(value, fallback = 1) {
    const n = Number(value); // Stored with each held shape and applied by both editor and runtime visual paths.
    const fb = Number(fallback);
    const resolved = Number.isFinite(n) && n > 0 ? n : (Number.isFinite(fb) && fb > 0 ? fb : 1);
    return Math.max(0.1, Math.min(3, resolved));
  }

  function normalizeHeightMultiplier(value, fallback = DEFAULT_HEIGHT_MULTIPLIER) {
    const n = Number(value); // 0 ignores character height; 1 follows the full calculated-height ratio; values >1 exaggerate it.
    const fb = Number(fallback);
    const resolved = Number.isFinite(n) && n >= 0 ? n : (Number.isFinite(fb) && fb >= 0 ? fb : DEFAULT_HEIGHT_MULTIPLIER);
    return Math.max(0, Math.min(3, resolved));
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

  function normalizeGripMode(raw) {
    const key = String(raw || '').trim();
    return key || null;
  }

  function normalizeGripContext(raw) {
    return String(raw || '').toLowerCase() === 'ranged' ? 'ranged' : 'melee';
  }

  function primaryGripFieldForContext(context) {
    return normalizeGripContext(context) === 'ranged' ? 'rangedPrimaryGrip' : 'primaryGrip';
  }

  function secondaryGripSpanFieldForContext(context) {
    return normalizeGripContext(context) === 'ranged' ? 'rangedSecondaryGripSpan' : 'secondaryGripSpan';
  }

  function gripModeFieldForContext(context) {
    return normalizeGripContext(context) === 'ranged' ? 'rangedGripMode' : 'gripMode';
  }

  function currentGripContext() {
    if (inAttackEditor()) return normalizeGripContext(document.getElementById('handGripContextSelect')?.value || 'melee');
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    const activeSlot = snapshot?.activeSlot || global.ProceduralHandAttachments?.gameDeps?.getActiveTool?.() || null;
    return activeSlot === 'ranged' ? 'ranged' : 'melee';
  }

  function inferredSpan(entry) {
    const explicit = entry?.secondaryGripSpan;
    if (explicit && typeof explicit === 'object') {
      return {
        enabled: explicit.enabled === true,
        startZ: numberOrZero(explicit.startZ ?? explicit.minZ),
        endZ: numberOrZero(explicit.endZ ?? explicit.maxZ),
      };
    }
    const legacy = entry?.secondaryGrip;
    if (!legacy?.enabled) return { enabled: false, startZ: 0, endZ: 0 };
    const primaryZ = numberOrZero(entry?.primaryGrip?.position?.z);
    const secondaryZ = numberOrZero(legacy?.position?.z);
    return {
      enabled: true,
      startZ: Math.min(primaryZ, secondaryZ),
      endZ: Math.max(primaryZ, secondaryZ),
    };
  }

  function normalizeData(raw) {
    const next = clone(raw || DEFAULT_DATA);
    const previousPrimaryRotationPreset = next.primaryRotationPreset; // Missing/older marker means saved grip rotations need the new authoritative weapon table once.
    const previousRangedGripPreset = next.rangedGripPreset; // Missing marker identifies drafts created before melee/ranged grip separation.
    const resetTwoHandSpans = next.twoHandSpanPreset !== TWO_HAND_SPAN_PRESET; // Old drafts adopt both stance-authored ranges, leaving 1H grips unchanged.
    const resetManualMeleeSpans = next.manualMeleeSpanPreset !== MANUAL_MELEE_SPAN_PRESET; // Old local drafts receive the manual ranges without changing primary grips or scales.
    const resetLongHaftGrips = next.longHaftGripPreset !== LONG_HAFT_GRIP_PRESET; // Older drafts adopt the measured long-haft 1H centers and paired ranges once.
    const resetHeightMultipliers = next.heightMultiplierPreset !== HEIGHT_MULTIPLIER_PRESET; // Drafts from the all-1.0 default era adopt the 0.5 default once.
    next.schema = SCHEMA;
    next.secondaryGripPreset = SECONDARY_GRIP_PRESET;
    next.twoHandSpanPreset = TWO_HAND_SPAN_PRESET;
    next.manualMeleeSpanPreset = MANUAL_MELEE_SPAN_PRESET;
    next.longHaftGripPreset = LONG_HAFT_GRIP_PRESET;
    next.primaryRotationPreset = PRIMARY_ROTATION_PRESET;
    next.rangedGripPreset = RANGED_GRIP_PRESET;
    next.heightMultiplierPreset = HEIGHT_MULTIPLIER_PRESET;
    const rawTools = next.tools && typeof next.tools === 'object' ? next.tools : {}; // Saved drafts override defaults, while newly added weapon defaults still appear after upgrades.
    next.tools = { ...clone(DEFAULT_DATA.tools), ...rawTools };
    for (const [toolKey, entry] of Object.entries(next.tools)) {
      if (!entry || typeof entry !== 'object') continue;
      const fallbackEntry = DEFAULT_DATA.tools[toolKey] || {}; // Lets pre-scale local drafts inherit the new committed scale for that same shape.
      entry.toolScale = normalizeToolScale(entry.toolScale, fallbackEntry.toolScale ?? 1);
      entry.heightMultiplier = resetHeightMultipliers
        ? (fallbackEntry.heightMultiplier ?? DEFAULT_HEIGHT_MULTIPLIER)
        : normalizeHeightMultiplier(entry.heightMultiplier, fallbackEntry.heightMultiplier ?? DEFAULT_HEIGHT_MULTIPLIER);
      entry.primaryGrip = normalizeTransform(entry.primaryGrip);
      if (previousPrimaryRotationPreset !== PRIMARY_ROTATION_PRESET) {
        entry.primaryGrip.position.x = HATCHET_PRIMARY_GRIP_EXAMPLE.x; // Hatchet's authored X belongs to the shared hand-on-item frame.
        entry.primaryGrip.position.y = HATCHET_PRIMARY_GRIP_EXAMPLE.y; // Hatchet's authored Y belongs to the shared hand-on-item frame.
        entry.primaryGrip.rotationDeg = { ...HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg }; // Hatchet rotation is the shared example for every weapon.
      }
      entry.secondaryGripSpan = inferredSpan(entry);
      entry.primaryGripSpan = inferredSpan({ secondaryGripSpan: entry.primaryGripSpan });
      entry.secondaryGrip = disabledLegacySecondary();
      entry.gripMode = normalizeGripMode(entry.gripMode);
      // Ranged grip metadata starts as an exact copy of the melee grip for
      // legacy/default data, then becomes independently authorable. Existing
      // weapons therefore keep their current hand placement until an artist
      // explicitly edits the Ranged set in the Attack Animation Editor.
      entry.rangedPrimaryGrip = normalizeTransform(entry.rangedPrimaryGrip ?? entry.primaryGrip);
      entry.rangedSecondaryGripSpan = inferredSpan({
        secondaryGripSpan: entry.rangedSecondaryGripSpan ?? entry.secondaryGripSpan,
        primaryGrip: entry.rangedPrimaryGrip,
      });
      entry.rangedGripMode = normalizeGripMode(entry.rangedGripMode ?? entry.gripMode);
      if (resetManualMeleeSpans && MANUAL_MELEE_SPAN_TOOLS.has(toolKey)) {
        entry.secondaryGripSpan = clone(fallbackEntry.secondaryGripSpan);
        entry.rangedSecondaryGripSpan = clone(fallbackEntry.rangedSecondaryGripSpan);
      }
      if (resetTwoHandSpans && MANUAL_MELEE_SPAN_TOOLS.has(toolKey)) {
        entry.primaryGripSpan = clone(fallbackEntry.primaryGripSpan);
        entry.secondaryGripSpan = clone(fallbackEntry.secondaryGripSpan);
        entry.rangedSecondaryGripSpan = clone(fallbackEntry.rangedSecondaryGripSpan);
      }
      if (toolKey === 'dagger') {
        const ranged = entry.rangedPrimaryGrip;
        const rr = ranged?.rotationDeg || {};
        const untouchedAutoGuess = AUTO_DAGGER_RANGED_PRESETS.has(previousRangedGripPreset)
          && Math.abs(entry.toolScale - 0.55) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.x) - HATCHET_PRIMARY_GRIP_EXAMPLE.x) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.y) - HATCHET_PRIMARY_GRIP_EXAMPLE.y) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.z) - 0.28) < 1e-9
          && numberOrZero(rr.pitch) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.pitch
          && numberOrZero(rr.yaw) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.yaw
          && numberOrZero(rr.roll) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.roll;
        const untouchedPreviousAuthoredGrip = previousRangedGripPreset === PRE_END_FLIP_DAGGER_RANGED_PRESET
          && Math.abs(entry.toolScale - 0.55) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.x) - 0) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.y) - (-0.05)) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.z) - (-0.3)) < 1e-9
          && numberOrZero(rr.pitch) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.pitch
          && numberOrZero(rr.yaw) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.yaw
          && numberOrZero(rr.roll) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.roll;
        const untouchedPreviousMirroredTrial = previousRangedGripPreset === PRE_MIRRORED_DAGGER_RANGED_PRESET
          && Math.abs(entry.toolScale - 0.55) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.x) - 0) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.y) - (-0.05)) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.z) - 0.28) < 1e-9
          && numberOrZero(rr.pitch) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.pitch
          && numberOrZero(rr.yaw) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.yaw
          && numberOrZero(rr.roll) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.roll;
        const untouchedPreAuthoredClone = previousRangedGripPreset === PRE_AUTHORED_RANGED_GRIP_PRESET
          && Math.abs(entry.toolScale - 1) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.x) - HATCHET_PRIMARY_GRIP_EXAMPLE.x) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.y) - HATCHET_PRIMARY_GRIP_EXAMPLE.y) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.z) - numberOrZero(entry.primaryGrip?.position?.z)) < 1e-9
          && numberOrZero(rr.pitch) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.pitch
          && numberOrZero(rr.yaw) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.yaw
          && numberOrZero(rr.roll) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.roll;
        if (untouchedAutoGuess || untouchedPreviousAuthoredGrip || untouchedPreviousMirroredTrial || untouchedPreAuthoredClone) {
          const authoredDagger = DEFAULT_DATA.tools.dagger; // Canonical authored dagger values replace only known untouched generated defaults.
          entry.toolScale = normalizeToolScale(authoredDagger.toolScale, 1);
          entry.rangedPrimaryGrip = normalizeTransform(authoredDagger.rangedPrimaryGrip);
          entry.rangedSecondaryGripSpan = inferredSpan({
            secondaryGripSpan: authoredDagger.rangedSecondaryGripSpan,
            primaryGrip: entry.rangedPrimaryGrip,
          });
          entry.rangedGripMode = normalizeGripMode(authoredDagger.rangedGripMode);
        }
      }
      if (toolKey === 'fishingspear') {
        const ranged = entry.rangedPrimaryGrip;
        const rr = ranged?.rotationDeg || {};
        const untouchedPreSpearMirrorGrip = previousRangedGripPreset === PRE_SPEAR_END_FLIP_RANGED_PRESET
          && Math.abs(entry.toolScale - 1.15) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.x) - (-0.04)) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.y) - (-0.04)) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.z) - 0) < 1e-9
          && numberOrZero(rr.pitch) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.pitch
          && numberOrZero(rr.yaw) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.yaw
          && numberOrZero(rr.roll) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.roll;
        if (untouchedPreSpearMirrorGrip) {
          // The corrected Tool End Flip rotates the sprite 180° in its own plane.
          // The old spear center used Z=0, so only X visibly needed correction at that time.
          // Migrate only the exact old default; artist-authored ranged X stays untouched.
          entry.rangedPrimaryGrip.position.x = DEFAULT_DATA.tools.fishingspear.rangedPrimaryGrip.position.x;
        }
      }
      if (resetLongHaftGrips && LONG_HAFT_GRIP_TOOLS.has(toolKey)) {
        entry.primaryGrip.position.z = numberOrZero(fallbackEntry.primaryGrip?.position?.z); // Applies the measured wood/tan midpoint without disturbing authored X/Y/rotation.
        entry.rangedPrimaryGrip.position.z = numberOrZero(fallbackEntry.rangedPrimaryGrip?.position?.z); // Spear ranged Z mirrors through Tool End Flip; the others keep the same center.
        entry.primaryGripSpan = clone(fallbackEntry.primaryGripSpan); // Keeps the 2H main-hand range translated around the new fixed 1H center.
        entry.secondaryGripSpan = clone(fallbackEntry.secondaryGripSpan); // Keeps the 2H offhand range on the opposite side of the new center.
        entry.rangedSecondaryGripSpan = clone(fallbackEntry.rangedSecondaryGripSpan); // Ranged remains explicitly one-handed.
      }
    }
    return next;
  }

  let data = normalizeData(DEFAULT_DATA);

  function cleanClone() {
    const output = clone(data);
    for (const entry of Object.values(output.tools || {})) delete entry.secondaryGrip;
    return output;
  }

  function ensureTool(value) {
    const key = toolKeyFor(value);
    if (!key) return null;
    if (!data.tools[key]) data.tools[key] = {};
    const entry = data.tools[key];
    const fallbackEntry = DEFAULT_DATA.tools[key] || {}; // Used when older data does not yet carry the shape's base scale.
    entry.toolScale = normalizeToolScale(entry.toolScale, fallbackEntry.toolScale ?? 1);
    entry.heightMultiplier = normalizeHeightMultiplier(entry.heightMultiplier, fallbackEntry.heightMultiplier ?? DEFAULT_HEIGHT_MULTIPLIER);
    entry.primaryGrip = normalizeTransform(entry.primaryGrip);
    entry.secondaryGripSpan = inferredSpan(entry);
    entry.primaryGripSpan = inferredSpan({ secondaryGripSpan: entry.primaryGripSpan });
    entry.secondaryGrip = disabledLegacySecondary();
    entry.gripMode = normalizeGripMode(entry.gripMode);
    entry.rangedPrimaryGrip = normalizeTransform(entry.rangedPrimaryGrip ?? entry.primaryGrip);
    entry.rangedSecondaryGripSpan = inferredSpan({
      secondaryGripSpan: entry.rangedSecondaryGripSpan ?? entry.secondaryGripSpan,
      primaryGrip: entry.rangedPrimaryGrip,
    });
    entry.rangedGripMode = normalizeGripMode(entry.rangedGripMode ?? entry.gripMode);
    return entry;
  }

  function toolScaleForTool(value) {
    const key = toolKeyFor(value);
    const entry = key ? ensureTool(key) : null;
    return normalizeToolScale(entry?.toolScale, DEFAULT_DATA.tools[key]?.toolScale ?? 1);
  }

  function heightMultiplierForTool(value) {
    const key = toolKeyFor(value);
    const entry = key ? ensureTool(key) : null;
    return normalizeHeightMultiplier(entry?.heightMultiplier, DEFAULT_DATA.tools[key]?.heightMultiplier ?? DEFAULT_HEIGHT_MULTIPLIER);
  }

  function characterHeightRatio(speciesId, gender) {
    const dimensions = global.HobunjiCharacterDimensions;
    if (!dimensions?.dimensionsFor || !speciesId) return 1;
    const current = dimensions.dimensionsFor(speciesId, gender || 'male');
    const reference = dimensions.dimensionsFor(HEIGHT_REFERENCE_SPECIES, HEIGHT_REFERENCE_GENDER);
    const currentHeight = Number(current?.height);
    const referenceHeight = Number(reference?.height);
    if (!(currentHeight > 0) || !(referenceHeight > 0)) return 1;
    return currentHeight / referenceHeight;
  }

  function heightFactorForTool(value, speciesId, gender) {
    const heightMultiplier = heightMultiplierForTool(value);
    const heightRatio = characterHeightRatio(speciesId, gender);
    return Math.max(0.05, 1 + (heightRatio - 1) * heightMultiplier);
  }

  function effectiveToolScaleForTool(value, speciesId, gender) {
    const baseScale = toolScaleForTool(value);
    return normalizeToolScale(baseScale * heightFactorForTool(value, speciesId, gender), baseScale);
  }

  // The base toolScale scales the item about its own origin (unchanged legacy
  // behaviour). The calculated-height factor then scales it about the PRIMARY
  // GRIP, so the hand never moves when a character is taller or shorter --
  // only the weapon grows/shrinks around the hand. An item-local point p lands
  // in the visual's parent (tool-holder) space at base * ((1 - hf) * g + hf * p).
  function heldItemPlacementForTool(value, context = currentGripContext(), identity = null) {
    const baseScale = toolScaleForTool(value);
    const heightFactor = heightFactorForTool(value, identity?.speciesId, identity?.gender);
    const grip = authoredPrimaryGripForTool(value, context).position;
    const k = baseScale * (1 - heightFactor);
    return {
      baseScale,
      heightFactor,
      scale: normalizeToolScale(baseScale * heightFactor, baseScale),
      offset: { x: numberOrZero(grip.x) * k, y: numberOrZero(grip.y) * k, z: numberOrZero(grip.z) * k },
    };
  }

  function itemPointToHolder(value, point, context = currentGripContext(), identity = null) {
    const placement = heldItemPlacementForTool(value, context, identity);
    return {
      x: placement.offset.x + numberOrZero(point?.x) * placement.scale,
      y: placement.offset.y + numberOrZero(point?.y) * placement.scale,
      z: placement.offset.z + numberOrZero(point?.z) * placement.scale,
    };
  }

  function holderPointToItem(value, point, context = currentGripContext(), identity = null) {
    const placement = heldItemPlacementForTool(value, context, identity);
    const inv = 1 / Math.max(0.0001, placement.scale);
    return {
      x: (numberOrZero(point?.x) - placement.offset.x) * inv,
      y: (numberOrZero(point?.y) - placement.offset.y) * inv,
      z: (numberOrZero(point?.z) - placement.offset.z) * inv,
    };
  }

  function authoredPrimaryGripForTool(value, context = currentGripContext()) {
    const entry = ensureTool(value);
    return normalizeTransform(entry?.[primaryGripFieldForContext(context)]);
  }

  function primaryGripForTool(value, context = currentGripContext(), identity = null) {
    const authored = authoredPrimaryGripForTool(value, context); // Selected melee/ranged item-local frame the right hand must reach.
    const state = twoHandGripStateForTool(value, context, identity); // Both hand ranges share the pose's 2H blend.
    const span = primaryGripSpanForTool(value, context); // Authored main-hand travel, independent from the offhand range.
    if (state && span) {
      const sampledZ = span.startZ + (span.endZ - span.startZ) * clamp01(state.primaryPercent / 100); // Main-hand position within its own range.
      authored.position.z += (sampledZ - authored.position.z) * clamp01(state.influence);
    }
    const target = itemPointToHolder(value, authored.position, context, identity); // Height scaling pivots on this grip, so this equals base * grip for every body.
    return {
      position: target,
      rotationDeg: { ...authored.rotationDeg },
    };
  }

  // Held throw spin is a child-plane visual rotation, while the hand remains on
  // the authored grip frame. Translate the spinning PNG by P - R(P) so the
  // authored grip point P stays fixed in tool-holder space as the sprite rotates
  // around local +Y (the plane's local Z after its fixed -90° X basis).
  // Use the unscaled authored grip here: the visual parent applies toolScale to
  // both the sprite and this offset, keeping the pivot correct at every size.
  function spinPivotOffsetForTool(value, angleRad, context = 'ranged') {
    const grip = authoredPrimaryGripForTool(value, context);
    const x = numberOrZero(grip?.position?.x);
    const z = numberOrZero(grip?.position?.z);
    const angle = Number(angleRad) || 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotatedX = x * cos + z * sin;
    const rotatedZ = -x * sin + z * cos;
    return { x: x - rotatedX, y: 0, z: z - rotatedZ };
  }

  function secondaryGripSpanForTool(value, context = currentGripContext()) {
    const entry = ensureTool(value);
    const span = entry?.[secondaryGripSpanFieldForContext(context)];
    return span?.enabled ? { enabled: true, startZ: numberOrZero(span.startZ), endZ: numberOrZero(span.endZ) } : null;
  }

  function primaryGripSpanForTool(value, context = currentGripContext()) {
    if (normalizeGripContext(context) === 'ranged') return null;
    const span = ensureTool(value)?.primaryGripSpan; // Only melee 2H poses may sample this range.
    return span?.enabled ? { enabled: true, startZ: numberOrZero(span.startZ), endZ: numberOrZero(span.endZ) } : null;
  }

  function twoHandGripStateForTool(value, context = currentGripContext(), identity = null) {
    if (normalizeGripContext(context) === 'ranged' || weaponHandModeForTool(value) !== 'two-hand' || !primaryGripSpanForTool(value, context) || !secondaryGripSpanForTool(value, context)) return null;
    const state = identity?.animationGripState !== undefined ? identity.animationGripState : currentSecondaryGripAnimationState(); // Actor-owned poses never inherit the player’s current attack.
    if (!state) return null;
    return state.influence > 0.0001 ? state : null;
  }

  function dualWieldStateForTool(value, context = currentGripContext(), identity = null) {
    if (normalizeGripContext(context) === 'ranged' || weaponHandModeForTool(value) !== 'dual') return null; // Dual wield is a melee attack hand mode, never a ranged/load/fire pose.
    const state = identity?.animationGripState !== undefined ? identity.animationGripState : currentSecondaryGripAnimationState();
    const influence = clamp01(state?.dualWieldInfluence);
    return influence > 0.0001 ? { ...state, influence } : null;
  }

  const editorSecondaryPoses = {
    neutral: { enabled: false, dualWield: true, percent: 50, primaryPercent: 50 },
    windup: { enabled: true, dualWield: true, percent: 50, primaryPercent: 50 },
    strike: { enabled: true, dualWield: true, percent: 50, primaryPercent: 50 },
  };
  let editorHandPreview = null; // Shared by hands and weapons: pair preview or isolated stance authoring, only at Neutral.
  let capturedMelee = null;
  let runtimeIdleDualWield = null; // Persists the most recently requested melee Neutral dual-wield stance after the attack visual ends.
  let runtimeIdleDualToolKey = null; // Prevents that idle stance from leaking across weapon swaps or dequip/re-equip.

  function dualWieldEnabled(raw, fallback = false) {
    return raw == null ? fallback : (raw === true || raw?.enabled === true);
  }

  function normalizeAnimationGrip(raw, { defaultEnabled = false, dualWield = false, dualWieldIdle = false, handMode = 'two-hand' } = {}) {
    const explicit = raw && typeof raw === 'object';
    const twoHandEnabled = handMode === 'two-hand' && (explicit ? raw.enabled === true : defaultEnabled);
    return {
      influence: twoHandEnabled ? 1 : 0,
      dualWieldInfluence: handMode === 'dual' && dualWield ? 1 : 0,
      dualWieldIdleBlend: handMode === 'dual' && dualWield && dualWieldIdle ? 1 : 0,
      percent: clamp(raw?.percent ?? 50, 0, 100),
      primaryPercent: clamp(raw?.primaryPercent ?? 50, 0, 100),
    };
  }

  function lerpAnimationGrip(a, b, t) {
    const k = clamp01(t);
    return {
      influence: a.influence + (b.influence - a.influence) * k,
      dualWieldInfluence: a.dualWieldInfluence + (b.dualWieldInfluence - a.dualWieldInfluence) * k,
      dualWieldIdleBlend: (a.dualWieldIdleBlend || 0) + ((b.dualWieldIdleBlend || 0) - (a.dualWieldIdleBlend || 0)) * k,
      percent: a.percent + (b.percent - a.percent) * k,
      primaryPercent: a.primaryPercent + (b.primaryPercent - a.primaryPercent) * k,
    };
  }

  function hasAnimationGripMetadata(poseSet) {
    return ['neutral', 'windup', 'strike'].some(phase => {
      const pose = poseSet?.[phase];
      return (pose?.secondaryGrip && typeof pose.secondaryGrip === 'object') || pose?.dualWield != null;
    });
  }

  function animationGripAt(progress, timing = {}, poseSet = {}, sequence = 'attack', toolKey = '') {
    if (sequence === 'load' || sequence === 'fire') {
      return { influence: 0, dualWieldInfluence: 0, percent: 50, primaryPercent: 50, source: 'ranged' };
    }
    const defaultTwoHand = sequence === 'attack'; // Ordinary melee attacks use 2H automatically when the equipped weapon exposes both grip ranges.
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const handMode = weaponHandModeForTool(toolKey); // The weapon chooses one of the independently authored flags.
    const neutralDualWield = dualWieldEnabled(poseSet.neutral?.dualWield, defaultTwoHand);
    const neutral = normalizeAnimationGrip(
      { ...poseSet.neutral?.secondaryGrip, enabled: false },
      { defaultEnabled: false, dualWield: neutralDualWield, dualWieldIdle: neutralDualWield, handMode },
    ); // Neutral can explicitly own Dual Wield; 2H itself remains attack-only.
    const windup = normalizeAnimationGrip(poseSet.windup?.secondaryGrip, {
      defaultEnabled: defaultTwoHand,
      dualWield: dualWieldEnabled(poseSet.windup?.dualWield, defaultTwoHand), handMode,
    });
    const strike = normalizeAnimationGrip(poseSet.strike?.secondaryGrip, {
      defaultEnabled: defaultTwoHand,
      dualWield: dualWieldEnabled(poseSet.strike?.dualWield, defaultTwoHand), handMode,
    });
    const poseScale = clamp01(timing.poseScale ?? 1);
    const scaledWindup = lerpAnimationGrip(neutral, windup, poseScale);
    const scaledStrike = lerpAnimationGrip(neutral, strike, poseScale);
    let result;
    if (t <= wf) {
      const rawWindupT = t / Math.max(1e-6, wf);
      const poseT = global.Combat?.windupPoseProgress?.(rawWindupT, timing.windupSlowdown) ?? rawWindupT;
      result = lerpAnimationGrip(neutral, scaledWindup, poseT);
    } else if (t <= sf) {
      result = lerpAnimationGrip(scaledWindup, scaledStrike, (t - wf) / Math.max(1e-6, sf - wf));
    } else if (t <= hf) {
      result = { ...scaledStrike };
    } else {
      result = lerpAnimationGrip(scaledStrike, neutral, (t - hf) / Math.max(1e-6, 1 - hf));
    }
    const dualWieldInfluence = clamp01(result.dualWieldInfluence);
    return {
      ...result,
      influence: clamp01(result.influence), // Authored flags stay independent; the weapon selects their effective influence.
      dualWieldInfluence,
      dualWieldIdleBlend: clamp01(result.dualWieldIdleBlend),
      source: hasAnimationGripMetadata(poseSet) ? 'animation-pose' : (handMode === 'dual' ? 'default-dual-wield' : handMode === 'single' ? 'default-single-hand' : 'default-two-hand'),
    };
  }

  function inAttackEditor() { return /\/tools\/attack-animation-editor\//.test(global.location?.pathname || (typeof location !== 'undefined' ? location.pathname : '')); }

  function editorAnimationGripState() {
    const progress = clamp01(document.getElementById('scrub')?.value ?? 0);
    const timing = {
      windupFrac: document.getElementById('windupFrac')?.value ?? 0.16,
      strikeFrac: document.getElementById('strikeFrac')?.value ?? 0.55,
      holdFrac: document.getElementById('holdFrac')?.value ?? 0.68,
    };
    const poseSet = {
      neutral: { secondaryGrip: editorSecondaryPoses.neutral, dualWield: { enabled: editorSecondaryPoses.neutral.dualWield === true } },
      windup: { secondaryGrip: editorSecondaryPoses.windup, dualWield: { enabled: editorSecondaryPoses.windup.dualWield === true } },
      strike: { secondaryGrip: editorSecondaryPoses.strike, dualWield: { enabled: editorSecondaryPoses.strike.dualWield === true } },
    };
    const sequence = editorGripContext() === 'ranged' || document.getElementById('animStyle')?.value === 'ranged' ? 'fire' : (document.getElementById('playbackSequence')?.value || 'attack');
    if (editorHandPreview && progress === 0 && sequence === 'attack' && editorGripContext() === 'melee') {
      const dual = editorHandPreview === 'pair' && isDualWieldWeapon(editorCurrentToolKey()) ? 1 : 0;
      return { influence: 0, dualWieldInfluence: dual, dualWieldIdleBlend: dual, percent: 50, primaryPercent: 50, source: dual ? 'editor-dual-wield-idle' : 'editor-stance-authoring' };
    }
    return animationGripAt(progress, timing, poseSet, sequence, editorCurrentToolKey());
  }

  function runtimeAnimationGripState() {
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    const active = snapshot?.activeSlot !== 'ranged' && snapshot?.combatNeutralInjected === true && Number.isFinite(Number(snapshot?.combatProgress));
    if (!active) {
      const currentTool = toolKeyFor(snapshot?.itemKey || snapshot?.shape || '');
      if (snapshot?.activeSlot !== 'weapon' || (runtimeIdleDualToolKey && currentTool !== runtimeIdleDualToolKey)) {
        runtimeIdleDualWield = null;
        runtimeIdleDualToolKey = null;
      }
      capturedMelee = null;
      const dualIdle = snapshot?.activeSlot === 'weapon' && isDualWieldWeapon(currentTool) && runtimeIdleDualWield !== false;
      return {
        influence: 0,
        dualWieldInfluence: dualIdle ? 1 : 0,
        dualWieldIdleBlend: dualIdle ? 1 : 0,
        percent: 50,
        primaryPercent: 50,
        source: dualIdle ? 'dual-wield-idle' : 'idle',
      };
    }
    const opts = capturedMelee?.opts || {};
    return animationGripAt(snapshot.combatProgress, {
      windupFrac: opts.windupFrac ?? 0.16,
      strikeFrac: opts.strikeFrac ?? 0.55,
      holdFrac: opts.holdFrac ?? 0.68,
      windupSlowdown: opts.windupSlowdown ?? 0,
      poseScale: snapshot.combatPoseScale ?? 1,
    }, opts.pose || {}, opts.sequence || 'attack', snapshot?.itemKey || snapshot?.shape || '');
  }

  function currentSecondaryGripAnimationState() { return inAttackEditor() ? editorAnimationGripState() : runtimeAnimationGripState(); }
  function currentDualWieldAnimationState() {
    const state = currentSecondaryGripAnimationState();
    return {
      influence: clamp01(state?.dualWieldInfluence),
      idleBlend: clamp01(state?.dualWieldIdleBlend),
      source: state?.source || 'none',
    };
  }

  function secondaryGripForTool(value, context = currentGripContext(), identity = null) {
    const span = secondaryGripSpanForTool(value, context);
    if (!span) return null;
    const state = twoHandGripStateForTool(value, context, identity);
    if (!state) return null;
    const percent01 = clamp01(state.percent / 100);
    const itemZ = span.startZ + (span.endZ - span.startZ) * percent01;
    return {
      enabled: true,
      influence: clamp01(state.influence),
      percent: state.percent,
      itemZ,
      position: itemPointToHolder(value, { x: 0, y: 0, z: itemZ }, context, identity), // Same grip-anchored mapping as the visible item.
      rotationDeg: { ...authoredPrimaryGripForTool(value, context).rotationDeg }, // Left-hand GLB geometry is already mirrored, so sharing the primary tool-space frame produces the natural mirrored grip direction.
    };
  }

  function installCombatCapture() {
    const deps = global.Combat?.deps;
    if (!deps?.__weaponToolStanceVisualHooks || deps.__hobunjiSecondarySpanCapture) return false;
    for (const name of ['triggerWeaponSwingVisual', 'triggerWeaponHoldVisual']) {
      const original = deps[name];
      if (typeof original !== 'function') continue;
      deps[name] = function secondarySpanAwareCombatStart(durationS, opts = {}) {
        const stanceSnapshot = global.WeaponToolStances?.getRuntimeState?.() || null;
        runtimeIdleDualWield = isDualWieldWeapon(stanceSnapshot?.itemKey || stanceSnapshot?.shape) && dualWieldEnabled(opts?.pose?.neutral?.dualWield, true);
        runtimeIdleDualToolKey = toolKeyFor(stanceSnapshot?.itemKey || stanceSnapshot?.shape || '') || null;
        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };
        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
        return original.call(this, durationS, opts);
      };
    }
    const cancel = deps.cancelWeaponSwingHold;
    if (typeof cancel === 'function') {
      deps.cancelWeaponSwingHold = function secondarySpanAwareCancel(...args) { capturedMelee = null; global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); return cancel.apply(this, args); };
    }
    Object.defineProperty(deps, '__hobunjiSecondarySpanCapture', { value: true, configurable: true });
    return true;
  }

  function installRigBlendWrapper() {
    const hands = global.ProceduralHandAttachments;
    if (!hands?.attach || hands.attach.__hobunjiSecondarySpanBlend) return false;
    const originalAttach = hands.attach.bind(hands);
    const wrappedAttach = function secondarySpanBlendAttach(...args) {
      const rig = originalAttach(...args);
      if (!rig || rig.__hobunjiSecondarySpanBlend) return rig;
      const leftSocket = rig.group?.getObjectByName?.('left_hand_socket') || null;
      let idlePosition = leftSocket?.position?.clone?.() || null;
      let idleQuaternion = leftSocket?.quaternion?.clone?.() || null;
      const captureIdle = () => { if (leftSocket) { idlePosition = leftSocket.position.clone(); idleQuaternion = leftSocket.quaternion.clone(); } };
      const originalSetSideIdle = rig.setSideIdle?.bind(rig);
      if (originalSetSideIdle) rig.setSideIdle = function secondarySpanIdleCapture(side, pose) { const result = originalSetSideIdle(side, pose); if (side === 'left') captureIdle(); return result; };
      const originalUseIdlePose = rig.useIdlePose?.bind(rig);
      if (originalUseIdlePose) rig.useIdlePose = function secondarySpanUseIdleCapture(poses) { const result = originalUseIdlePose(poses); captureIdle(); return result; };
      const originalPlaceHandWorld = rig.placeHandWorld?.bind(rig);
      if (originalPlaceHandWorld) {
        rig.placeHandWorld = function secondarySpanBlendWorld(side, worldPosition, worldQuaternion, modelCalibration = null, gripInfluence = null) {
          const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion, modelCalibration); // Preserve per-GLB calibration through the off-hand span wrapper.
          if (side !== 'left' || !leftSocket || !idlePosition || !idleQuaternion) return result;
          const influence = clamp01(gripInfluence ?? currentSecondaryGripAnimationState().influence);
          if (influence >= 0.9999) return result;
          const targetPosition = leftSocket.position.clone();
          const targetQuaternion = leftSocket.quaternion.clone();
          leftSocket.position.copy(idlePosition).lerp(targetPosition, influence);
          leftSocket.quaternion.copy(idleQuaternion).slerp(targetQuaternion, influence);
          leftSocket.updateMatrix?.();
          leftSocket.updateMatrixWorld?.(true);
          return result;
        };
      }
      Object.defineProperty(rig, '__hobunjiSecondarySpanBlend', { value: true, configurable: true });
      return rig;
    };
    wrappedAttach.__hobunjiSecondarySpanBlend = true;
    // Preserve the forearm-wrapper marker when this wrapper encloses it; otherwise
    // the forearm maintenance retry sees a foreign outer wrapper and wraps again.
    if (hands.attach.__hobunjiForearmAlignmentWrapped) {
      wrappedAttach.__hobunjiForearmAlignmentWrapped = true;
      wrappedAttach.__hobunjiForearmAlignmentOriginal = hands.attach.__hobunjiForearmAlignmentOriginal || originalAttach;
    }
    hands.attach = wrappedAttach;
    return true;
  }

  function visualBaseFor(node) {
    if (!node?.position || !node?.quaternion || !node?.scale) return null;
    let base = visualBases.get(node);
    if (!base) {
      base = { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
      visualBases.set(node, base);
    }
    return base;
  }

  function applyScaleFromBase(node, base, toolScale) {
    if (!node?.scale || !base?.scale) return;
    const factor = normalizeToolScale(toolScale);
    const sign = (current, fallback) => current < 0 ? -1 : (current > 0 ? 1 : (fallback < 0 ? -1 : 1)); // Preserves editor midline mirroring while resetting scale magnitude each frame.
    node.scale.set(
      Math.abs(base.scale.x) * factor * sign(node.scale.x, base.scale.x),
      Math.abs(base.scale.y) * factor * sign(node.scale.y, base.scale.y),
      Math.abs(base.scale.z) * factor * sign(node.scale.z, base.scale.z),
    );
  }

  function restoreVisualBase(node, toolScale = 1) {
    const base = visualBaseFor(node);
    if (!base) return;
    node.position.copy(base.position);
    node.quaternion.copy(base.quaternion);
    applyScaleFromBase(node, base, toolScale);
    node.updateMatrix?.();
  }

  function applyHeldItemScale(node, toolScale = 1, offset = null) {
    const base = visualBaseFor(node); // Captures only the visual's authored base scale; position/orientation remain animation-owned.
    if (!base) return;
    applyScaleFromBase(node, base, toolScale);
    node.position.set( // Grip-anchored height scaling shifts the item so the grip stays fixed in holder space.
      base.position.x + numberOrZero(offset?.x),
      base.position.y + numberOrZero(offset?.y),
      base.position.z + numberOrZero(offset?.z),
    );
    node.updateMatrix?.();
  }

  function applyHeldItemPlacement(node, value, context = currentGripContext(), identity = null) {
    const placement = heldItemPlacementForTool(value, context, identity);
    applyHeldItemScale(node, placement.scale, placement.offset);
    return placement;
  }

  function visibleToolVisualUnder(holder) {
    let fallback = null, visible = null;
    holder?.traverse?.(node => {
      if (!node?.userData?.toolPlane?.isObject3D) return;
      fallback ||= node;
      if (!visible && node.visible !== false && node.userData.toolPlane.visible !== false) visible = node;
    });
    return visible || fallback;
  }

  function editorScaleIdentity() {
    return {
      speciesId: String(document.getElementById('avatarSpecies')?.value || '').trim(),
      gender: String(document.getElementById('avatarGender')?.value || 'male').trim() || 'male',
    };
  }

  const NO_SCALE_IDENTITY = Object.freeze({ speciesId: '', gender: 'male' });
  let runtimeIdentityCache = { playerMesh: null, node: null, rig: null }; // Avoids a per-frame playerMesh traverse while the same hand rig stays attached.

  function nodeIsUnder(node, root) {
    for (let current = node; current; current = current.parent) if (current === root) return true;
    return false;
  }

  function runtimePlayerScaleIdentity() {
    const playerMesh = global.ProceduralHandAttachments?.gameDeps?.playerMesh || null;
    if (!playerMesh) return NO_SCALE_IDENTITY;
    const cached = runtimeIdentityCache;
    const cacheValid = cached.playerMesh === playerMesh && cached.rig
      && cached.node?.userData?.proceduralHandRig === cached.rig && nodeIsUnder(cached.node, playerMesh);
    if (!cacheValid) {
      let found = null; // Filled from the live player's portrait hand rig; avoids guessing from global save/profile names.
      playerMesh.traverse?.(node => {
        if (found) return;
        const rig = node?.userData?.proceduralHandRig;
        if (rig?.speciesId) found = { node, rig };
      });
      runtimeIdentityCache = { playerMesh, node: found?.node || null, rig: found?.rig || null };
    }
    const rig = runtimeIdentityCache.rig;
    return rig?.speciesId ? { speciesId: rig.speciesId, gender: rig.gender || 'male' } : NO_SCALE_IDENTITY;
  }

  function applyEditorGripPresentation() {
    const context = global.HobunjiAttackEditorToolContext;
    const visual = context?.toolPlaneMesh || null;
    if (!visual) return;
    const key = toolKeyFor(context.toolKey || document.getElementById('toolSpriteSelect')?.value || '');
    applyHeldItemPlacement(visual, key, currentGripContext(), editorScaleIdentity());
  }

  function applyRuntimeGripPresentation() {
    const deps = global.ProceduralHandAttachments?.gameDeps || null;
    const holder = deps?.toolHolder || null;
    if (!holder) return;
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    const activeSlot = snapshot?.activeSlot || deps?.getActiveTool?.() || null;
    const visual = (activeSlot && (deps?.toolMeshMap?.get?.(activeSlot) || deps?.toolMeshMap?.[activeSlot])) || visibleToolVisualUnder(holder);
    const itemKey = snapshot?.itemKey || snapshot?.shape || deps?.equipmentSlots?.[activeSlot] || '';
    if (!visual || !itemKey) return;
    applyHeldItemPlacement(visual, itemKey, currentGripContext(), runtimePlayerScaleIdentity());
  }

  function applyPrimaryGripVisuals() {
    // Historical name retained for callers. Primary grip no longer transforms the
    // item visual; it is consumed by ProceduralHandFrameDriver as a HAND target.
    if (inAttackEditor()) applyEditorGripPresentation();
    else applyRuntimeGripPresentation();
  }

  function notify() {
    applyPrimaryGripVisuals();
    for (const listener of listeners) { try { listener(data); } catch (_) {} }
    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function replace(next) {
    if (!next || next.schema !== SCHEMA) throw new Error(`Expected ${SCHEMA}`);
    data = normalizeData(next); notify(); return data;
  }

  function mutate(mutator) { mutator(data); data = normalizeData(data); notify(); return data; }

  function gripModeForTool(value, context = currentGripContext()) {
    const entry = ensureTool(value);
    return entry?.[gripModeFieldForContext(context)] || null;
  }
  function setGripMode(value, modeKey, context = currentGripContext()) {
    const entry = ensureTool(value);
    if (!entry) return null;
    const field = gripModeFieldForContext(context);
    entry[field] = normalizeGripMode(modeKey);
    notify();
    return entry[field];
  }
  function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(cleanClone())); }
  function loadLocal() { const raw = localStorage.getItem(LOCAL_KEY); if (!raw) return false; replace(JSON.parse(raw)); return true; }
  function clearLocal() { localStorage.removeItem(LOCAL_KEY); data = normalizeData(DEFAULT_DATA); notify(); }
  function editorCurrentToolKey() { return toolKeyFor(global.HobunjiAttackEditorToolContext?.toolKey || document.getElementById('toolSpriteSelect')?.value || ''); }
  function setEditorIdlePreview(active) {
    editorHandPreview = active ? 'pair' : null;
    global.HobunjiDualWieldWeaponVisuals?.resetPoseHistory?.();
    return editorHandPreview === 'pair';
  }
  function setEditorSingleHandPreview(active) {
    editorHandPreview = active ? 'single' : null;
    global.HobunjiDualWieldWeaponVisuals?.resetPoseHistory?.();
  }
  function editorToolChanged() {
    editorHandPreview = null;
    syncEditorSpanUi();
    patchEditorJsonView();
    if (isDualWieldWeapon(editorCurrentToolKey()) && editorSecondaryPoses.neutral.dualWield && editorGripContext() === 'melee') global.AttackIdleStanceEditor?.previewDualWieldMain?.();
  }
  function editorGripContext() { return normalizeGripContext(document.getElementById('handGripContextSelect')?.value || 'melee'); }

  function editorAnimationJsonObject() {
    const view = document.getElementById('jsonView');
    if (!view) return null;
    let parsed;
    try { parsed = JSON.parse(view.value || '{}'); } catch (_) { return null; }
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of ['neutral', 'windup', 'strike']) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      const dualWield = editorSecondaryPoses[phase].dualWield === true; // Preserve authored flags independently of the preview weapon.
      parsed.poses[phase].secondaryGrip = {
        enabled: phase !== 'neutral' && editorSecondaryPoses[phase].enabled === true,
        percent: clamp(editorSecondaryPoses[phase].percent, 0, 100),
        primaryPercent: clamp(editorSecondaryPoses[phase].primaryPercent, 0, 100),
      };
      parsed.poses[phase].dualWield = { enabled: dualWield };
    }
    return parsed;
  }

  function patchEditorJsonView() {
    if (!inAttackEditor()) return;
    const parsed = editorAnimationJsonObject();
    const view = document.getElementById('jsonView');
    if (parsed && view) view.value = JSON.stringify(parsed, null, 2);
  }

  function loadEditorAnimationGrip(dataObj) {
    setEditorIdlePreview(false);
    const sequence = dataObj?.sequence || document.getElementById('playbackSequence')?.value || 'attack';
    const defaultTwoHand = sequence === 'attack' && dataObj?.style !== 'ranged' && dataObj?.style !== 'drink' && dataObj?.still !== true;
    for (const phase of ['neutral', 'windup', 'strike']) {
      const pose = dataObj?.poses?.[phase] || null;
      const raw = pose?.secondaryGrip;
      const dualWield = dualWieldEnabled(pose?.dualWield, defaultTwoHand);
      const explicitTwoHand = raw && typeof raw === 'object';
      editorSecondaryPoses[phase].dualWield = dualWield;
      editorSecondaryPoses[phase].enabled = phase !== 'neutral' && (explicitTwoHand ? raw.enabled === true : defaultTwoHand);
      editorSecondaryPoses[phase].percent = clamp(raw?.percent ?? 50, 0, 100);
      editorSecondaryPoses[phase].primaryPercent = clamp(raw?.primaryPercent ?? 50, 0, 100);
      if (pose && typeof pose === 'object') {
        pose.secondaryGrip = {
          enabled: editorSecondaryPoses[phase].enabled,
          percent: editorSecondaryPoses[phase].percent,
          primaryPercent: editorSecondaryPoses[phase].primaryPercent,
        };
        pose.dualWield = { enabled: dualWield };
      }
    }
    syncEditorSpanUi(); patchEditorJsonView();
    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
  }

  function editorFieldPair(parent, id, label, value, min, max, step, onValue) {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `<label>${label}</label><div class="fieldRow"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"><input id="${id}_n" type="number" min="${min}" max="${max}" step="${step}" style="width:78px;flex:0 0 78px"></div>`;
    parent.appendChild(row);
    const range = row.querySelector(`#${id}`), number = row.querySelector(`#${id}_n`);
    const set = next => { range.value = next; number.value = next; };
    const apply = source => { const next = Number(source.value); if (!Number.isFinite(next)) return; set(next); onValue(next); };
    range.addEventListener('input', () => apply(range)); number.addEventListener('input', () => apply(number)); set(value);
    return { range, number, set };
  }

  let editorUi = null;

  function syncEditorSpanUi() {
    if (!editorUi) return;
    const entry = ensureTool(editorCurrentToolKey());
    const gripContext = editorGripContext();
    const span = entry?.secondaryGripSpan || { enabled: false, startZ: 0, endZ: 0 };
    const mainSpan = entry?.primaryGripSpan || { enabled: false, startZ: 0, endZ: 0 }; // Shared melee-only main-hand authoring controls.
    const melee = gripContext === 'melee'; // Ranged poses cannot use either 2H range.
    editorUi.mainEnabled.checked = mainSpan.enabled === true;
    editorUi.mainEnabled.disabled = !melee;
    editorUi.spanEnabled.disabled = !melee;
    editorUi.mainStartPair.set(numberOrZero(mainSpan.startZ)); editorUi.mainEndPair.set(numberOrZero(mainSpan.endZ));
    for (const pair of [editorUi.mainStartPair, editorUi.mainEndPair, editorUi.startPair, editorUi.endPair]) {
      pair.range.disabled = !melee; pair.number.disabled = !melee;
    }
    editorUi.scalePair.set(normalizeToolScale(entry?.toolScale));
    editorUi.heightPair.set(normalizeHeightMultiplier(entry?.heightMultiplier));
    editorUi.spanEnabled.checked = span.enabled === true;
    editorUi.startPair.set(numberOrZero(span.startZ)); editorUi.endPair.set(numberOrZero(span.endZ));
    for (const phase of ['neutral', 'windup', 'strike']) {
      const controls = editorUi.pose[phase];
      const inherentDual = melee && isDualWieldWeapon(editorCurrentToolKey());
      controls.enabled.checked = editorSecondaryPoses[phase].enabled === true;
      controls.dual.checked = editorSecondaryPoses[phase].dualWield === true;
      controls.percent.set(clamp(editorSecondaryPoses[phase].percent, 0, 100));
      controls.primaryPercent.set(clamp(editorSecondaryPoses[phase].primaryPercent, 0, 100));
      const canGrip = melee && mainSpan.enabled === true && span.enabled === true && phase !== 'neutral'; // Neutral remains 1H even if an older export enabled it.
      const canDual = melee;
      const editingTwoHand = canGrip && !inherentDual && editorSecondaryPoses[phase].enabled === true;
      controls.primaryPercent.range.disabled = !editingTwoHand; controls.primaryPercent.number.disabled = !editingTwoHand;
      controls.enabled.disabled = !melee || phase === 'neutral'; controls.dual.disabled = !canDual;
      controls.percent.range.disabled = !editingTwoHand; controls.percent.number.disabled = !editingTwoHand;
    }
    const state = editorAnimationGripState();
    const identity = editorScaleIdentity();
    const baseScale = normalizeToolScale(entry?.toolScale);
    const heightMultiplier = normalizeHeightMultiplier(entry?.heightMultiplier);
    const heightRatio = characterHeightRatio(identity.speciesId, identity.gender);
    const effectiveScale = effectiveToolScaleForTool(editorCurrentToolKey(), identity.speciesId, identity.gender);
    const scaleLabel = `base ×${baseScale.toFixed(2)} · height multiplier ×${heightMultiplier.toFixed(2)} · body ratio ×${heightRatio.toFixed(3)} = effective ×${effectiveScale.toFixed(3)}`;
    const modeLabel = weaponHandModeForTool(editorCurrentToolKey()); // Mobile-visible diagnostics show which independent flag this weapon reads.
    const statusText = melee && mainSpan.enabled && span.enabled
      ? `${editorCurrentToolKey() || 'held item'} · ${gripContext.toUpperCase()} grip · ${scaleLabel} · main-hand Z ${numberOrZero(mainSpan.startZ).toFixed(4)} → ${numberOrZero(mainSpan.endZ).toFixed(4)} · off-hand Z ${numberOrZero(span.startZ).toFixed(2)} → ${numberOrZero(span.endZ).toFixed(2)} · main ${Math.round(state.primaryPercent ?? 50)}% · weapon mode ${modeLabel} · Dual Wield ${Math.round(state.dualWieldInfluence * 100)}% · 2H influence ${Math.round(state.influence * 100)}% · span position ${Math.round(state.percent)}%`
      : `${editorCurrentToolKey() || 'held item'} · ${gripContext.toUpperCase()} grip · ${scaleLabel} · weapon mode ${modeLabel} · Dual Wield ${Math.round(state.dualWieldInfluence * 100)}% · 2H ${Math.round(state.influence * 100)}%; 2H requires both melee ranges.`;
    if (editorUi.status.textContent !== statusText) editorUi.status.textContent = statusText;
  }

  function installEditorUi() {
    if (!inAttackEditor() || editorUi) return !!editorUi;
    const host = document.getElementById('handPrimaryGripGroup');
    const status = document.getElementById('handGripStatus');
    if (!host || !status) return false;

    const oldCheckboxField = document.getElementById('handSecondaryGripEnabled')?.closest?.('.field') || null;
    if (oldCheckboxField) {
      oldCheckboxField.style.display = 'none';
      const oldHelp = oldCheckboxField.previousElementSibling;
      if (oldHelp?.classList?.contains('help')) {
        oldHelp.style.display = 'none';
        const oldHead = oldHelp.previousElementSibling;
        if (oldHead?.classList?.contains('poseGroupHead')) oldHead.style.display = 'none';
      }
    }
    const oldPos = document.getElementById('handSecondaryGripPositionFields'), oldRot = document.getElementById('handSecondaryGripRotationFields');
    if (oldPos) oldPos.style.display = 'none'; if (oldRot) oldRot.style.display = 'none';

    const scalePanel = document.createElement('div'); // Keeps permanent sprite sizing next to the primary grip instead of burying it in an attack pose.
    scalePanel.id = 'handToolScalePanel';
    scalePanel.innerHTML = `
      <div class="hr"></div>
      <div class="poseGroupHead"><span class="dot" style="background:#60a5fa"></span>Held-item scale</div>
      <div class="help" style="margin-bottom:6px"><b>Base tool scale</b> is this weapon's authored size at the Mao'ao male reference height. <b>Height multiplier</b> controls how strongly calculated character height changes that size: 0 ignores height, 1 is fully proportional, and values above 1 exaggerate the difference (default 0.5). Height scaling pivots on the primary grip, so the hand stays put and the weapon grows or shrinks around it. The Neutral pose's Tool scale remains a separate animation multiplier and should normally stay at 1.00 for melee weapons.</div>
      <div id="handToolScaleFields"></div>`;
    host.insertBefore(scalePanel, status);
    const scaleFields = scalePanel.querySelector('#handToolScaleFields');
    const scalePair = editorFieldPair(scaleFields, 'handToolScale', 'Base tool scale', 1, 0.1, 3, 0.01, value => mutate(() => { ensureTool(editorCurrentToolKey()).toolScale = normalizeToolScale(value); }));
    const heightPair = editorFieldPair(scaleFields, 'handToolHeightMultiplier', 'Height multiplier', DEFAULT_HEIGHT_MULTIPLIER, 0, 3, 0.01, value => mutate(() => { ensureTool(editorCurrentToolKey()).heightMultiplier = normalizeHeightMultiplier(value); }));

    const panel = document.createElement('div');
    panel.id = 'handSecondaryGripSpanPanel';
    panel.innerHTML = `
      <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Two-hand grip ranges</div>
      <div class="help" style="margin-bottom:6px">Define separate <b>main-hand (right)</b> and <b>offhand (left)</b> ranges on the weapon's local Z axis. The fixed primary grip is still used for 1H, idle, and ranged poses. Enabling 2H on Windup or Strike samples both ranges without moving the weapon.</div>
      <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handPrimarySpanEnabled" style="width:auto;margin-right:6px">Weapon has a main-hand 2H range</label></div>
      <div id="handPrimarySpanFields"></div>
      <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handSecondarySpanEnabled" style="width:auto;margin-right:6px">Weapon has an offhand 2H range</label></div>
      <div id="handSecondarySpanFields"></div>
      <div class="hr"></div>
      <div class="poseGroupHead"><span class="dot" style="background:#f59e0b"></span>Animation hand mode</div>
      <div class="help" style="margin-bottom:6px">Melee attacks default to <b>2H when the equipped weapon has both ranges</b>. <b>2H</b> and <b>Dual wield</b> are independent pose flags. Kylies, daggers, and dagger-swords read Dual Wield; other melee weapons read 2H. Fishing mace uses neither. Neutral Dual Wield uses the authored Dual Wield idle pair, while Windup/Strike use the attack duplicate path. Ranged/load/fire poses use neither mode.</div>
      <div id="handSecondaryAnimationFields"></div>
      <div class="help" id="handSecondarySpanStatus" style="padding:7px;border:1px solid rgba(245,158,11,.24);border-radius:8px;margin:6px 0"></div>`;
    host.insertBefore(panel, status);
    const spanFields = panel.querySelector('#handSecondarySpanFields'), animationFields = panel.querySelector('#handSecondaryAnimationFields'), spanEnabled = panel.querySelector('#handSecondarySpanEnabled');
    const mainEnabled = panel.querySelector('#handPrimarySpanEnabled'); // Toggles main-hand range availability for 2H poses.
    const mainFields = panel.querySelector('#handPrimarySpanFields'); // Hosts the independent main-hand start/end controls.
    const mainStartPair = editorFieldPair(mainFields, 'handPrimarySpanStartZ', 'Main-hand range start · tool Z', 0, -1.5, 1.5, 0.0001, value => mutate(() => { ensureTool(editorCurrentToolKey()).primaryGripSpan.startZ = value; }));
    const mainEndPair = editorFieldPair(mainFields, 'handPrimarySpanEndZ', 'Main-hand range end · tool Z', 0, -1.5, 1.5, 0.0001, value => mutate(() => { ensureTool(editorCurrentToolKey()).primaryGripSpan.endZ = value; }));
    mainEnabled.addEventListener('change', () => mutate(() => { ensureTool(editorCurrentToolKey()).primaryGripSpan.enabled = mainEnabled.checked; }));
    const currentSpan = () => {
      const entry = ensureTool(editorCurrentToolKey());
      return entry.secondaryGripSpan; // This panel authors melee 2H ranges only.
    };
    const startPair = editorFieldPair(spanFields, 'handSecondarySpanStartZ', 'Offhand range start · tool Z', 0, -1.5, 1.5, 0.0001, value => mutate(() => { currentSpan().startZ = value; }));
    const endPair = editorFieldPair(spanFields, 'handSecondarySpanEndZ', 'Offhand range end · tool Z', 0, -1.5, 1.5, 0.0001, value => mutate(() => { currentSpan().endZ = value; }));
    const pose = {};
    for (const phase of ['neutral', 'windup', 'strike']) {
      const box = document.createElement('div');
      box.className = 'field';
      box.innerHTML = `<div class="fieldRow" style="gap:12px;flex-wrap:wrap"><label class="fieldRow" style="cursor:pointer;margin:0"><input type="checkbox" id="handSecondaryAnim_${phase}_enabled" style="width:auto;margin-right:6px">${phase[0].toUpperCase() + phase.slice(1)} 2H</label><label class="fieldRow" style="cursor:pointer;margin:0"><input type="checkbox" id="handDualWieldAnim_${phase}_enabled" style="width:auto;margin-right:6px">Dual wield</label></div><div id="handSecondaryAnim_${phase}_percent"></div>`;
      animationFields.appendChild(box);
      const enabled = box.querySelector(`#handSecondaryAnim_${phase}_enabled`);
      const dual = box.querySelector(`#handDualWieldAnim_${phase}_enabled`);
      const percent = editorFieldPair(box.querySelector(`#handSecondaryAnim_${phase}_percent`), `handSecondaryAnim_${phase}_pct`, `${phase[0].toUpperCase() + phase.slice(1)} offhand range %`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].percent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); });
      enabled.addEventListener('change', () => { setEditorIdlePreview(false); editorSecondaryPoses[phase].enabled = enabled.checked; patchEditorJsonView(); syncEditorSpanUi(); global.HobunjiDualWieldWeaponVisuals?.syncNow?.(); });
      dual.addEventListener('change', () => {
        setEditorIdlePreview(false);
        editorSecondaryPoses[phase].dualWield = dual.checked;
        if (dual.checked) {
          if (phase === 'neutral' && isDualWieldWeapon(editorCurrentToolKey())) global.AttackIdleStanceEditor?.previewDualWieldMain?.();
        }
        patchEditorJsonView();
        syncEditorSpanUi();
        global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
      });
      const primaryPercent = editorFieldPair(box, `handPrimaryAnim_${phase}_pct`, `${phase[0].toUpperCase() + phase.slice(1)} main-hand range %`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].primaryPercent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); }); // Authored independently from the offhand percentage.
      pose[phase] = { enabled, dual, percent, primaryPercent };
    }
    spanEnabled.addEventListener('change', () => mutate(() => { currentSpan().enabled = spanEnabled.checked; }));
    editorUi = { scalePanel, scalePair, heightPair, panel, mainEnabled, mainStartPair, mainEndPair, spanEnabled, startPair, endPair, pose, status: panel.querySelector('#handSecondarySpanStatus') };

    document.getElementById('toolSpriteSelect')?.addEventListener('change', () => setTimeout(syncEditorSpanUi, 0));
    document.getElementById('handGripContextSelect')?.addEventListener('change', () => {
      syncEditorSpanUi();
      global.ProceduralHandFrameDriver?.syncNow?.();
    });
    for (const id of ['scrub', 'windupFrac', 'strikeFrac', 'holdFrac', 'playbackSequence']) {
      document.getElementById(id)?.addEventListener('input', () => { setEditorIdlePreview(false); syncEditorSpanUi(); }); document.getElementById(id)?.addEventListener('change', () => { setEditorIdlePreview(false); syncEditorSpanUi(); });
    }
    document.addEventListener('input', event => { if (!event.target?.closest?.('#handSecondaryGripSpanPanel') && !event.target?.closest?.('#handToolScalePanel')) setTimeout(patchEditorJsonView, 0); }, true);

    document.getElementById('exportBtn')?.addEventListener('click', event => {
      const obj = editorAnimationJsonObject(); if (!obj) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${(obj.name || 'attack').replace(/[^a-zA-Z0-9_-]+/g, '_')}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, true);
    document.getElementById('copyJsonBtn')?.addEventListener('click', async event => {
      const obj = editorAnimationJsonObject(); if (!obj) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { await navigator.clipboard.writeText(JSON.stringify(obj, null, 2)); } catch (_) {}
    }, true);
    document.getElementById('loadFile')?.addEventListener('change', async event => {
      const file = event.currentTarget?.files?.[0]; if (!file) return;
      try { loadEditorAnimationGrip(JSON.parse(await file.text())); } catch (_) {}
    });
    document.getElementById('actionSelect')?.addEventListener('change', () => setEditorIdlePreview(false));
    document.getElementById('playPauseBtn')?.addEventListener('click', () => setEditorIdlePreview(false));
    document.getElementById('loadPresetBtn')?.addEventListener('click', () => setTimeout(() => loadEditorAnimationGrip({}), 0));

    const topHelp = host.closest('.card')?.querySelector('.sectionTitle')?.nextElementSibling;
    if (topHelp?.classList.contains('help')) topHelp.innerHTML = 'The fixed <b>primary grip</b> is used for 1H, idle, ranged, and each duplicated Dual Wield weapon. Kylies, daggers, and dagger-swords use <b>Dual Wield</b>. Other melee weapons read the independent <b>2H</b> flag when both ranges exist. Fishing mace uses neither flag. Base scale and calculated-height influence remain shared held-item metadata.';
    syncEditorSpanUi(); patchEditorJsonView(); return true;
  }

  function debugForTool(value) {
    const toolKey = toolKeyFor(value); // Compact console-free snapshot shared by the editor and live game diagnostics.
    const identity = inAttackEditor() ? editorScaleIdentity() : runtimePlayerScaleIdentity();
    return {
      toolKey,
      toolScale: toolScaleForTool(toolKey),
      heightMultiplier: heightMultiplierForTool(toolKey),
      heightRatio: characterHeightRatio(identity.speciesId, identity.gender),
      effectiveToolScale: effectiveToolScaleForTool(toolKey, identity.speciesId, identity.gender),
      gripContext: currentGripContext(),
      primaryGrip: authoredPrimaryGripForTool(toolKey, currentGripContext()),
      primaryGripSpan: primaryGripSpanForTool(toolKey, currentGripContext()),
      primaryTarget: primaryGripForTool(toolKey, currentGripContext(), identity),
      latestChange: 'Long-haft 1H grips are centered on measured wood/tan sprite sections; melee 2H ranges stay paired around that fixed grip.',
      secondaryGripSpan: secondaryGripSpanForTool(toolKey, currentGripContext()),
      weaponHandMode: weaponHandModeForTool(toolKey),
      authoredPoseFlags: inAttackEditor() ? editorSecondaryGripStateSnapshot() : null,
      secondaryAnimation: currentSecondaryGripAnimationState(),
      secondaryTarget: secondaryGripForTool(toolKey),
    };
  }

  function editorSecondaryGripStateSnapshot() {
    return clone(editorSecondaryPoses); // Undo/Redo needs hidden per-pose left-hand values even when another pose is selected.
  }

  function restoreEditorSecondaryGripState(snapshot) {
    for (const phase of ['neutral', 'windup', 'strike']) {
      const raw = snapshot?.[phase] || {};
      const dualWield = raw.dualWield === true;
      editorSecondaryPoses[phase].dualWield = dualWield;
      editorSecondaryPoses[phase].enabled = phase !== 'neutral' && (raw.enabled === undefined ? true : raw.enabled === true);
      editorSecondaryPoses[phase].percent = clamp(raw.percent ?? 50, 0, 100);
      editorSecondaryPoses[phase].primaryPercent = clamp(raw.primaryPercent ?? 50, 0, 100);
    }
    syncEditorSpanUi();
    patchEditorJsonView();
    global.HobunjiDualWieldWeaponVisuals?.syncNow?.();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  global.HobunjiHandToolGrips = {
    schema: SCHEMA,
    get data() { return data; },
    get defaultData() { return normalizeData(DEFAULT_DATA); },
    clone: cleanClone,
    toolKeyFor, isDualWieldWeapon, weaponHandModeForTool, setEditorIdlePreview, setEditorSingleHandPreview, getEditorIdlePreview: () => editorHandPreview === 'pair', editorToolChanged, ensureTool, toolScaleForTool, heightMultiplierForTool, characterHeightRatio, heightFactorForTool, effectiveToolScaleForTool,
    heldItemPlacementForTool, itemPointToHolder, holderPointToItem, applyHeldItemPlacement, DEFAULT_HEIGHT_MULTIPLIER, normalizeGripContext, currentGripContext,
    authoredPrimaryGripForTool, primaryGripForTool, spinPivotOffsetForTool, primaryGripSpanForTool, secondaryGripSpanForTool, secondaryGripForTool, dualWieldStateForTool,
    currentSecondaryGripAnimationState, currentDualWieldAnimationState, animationGripAt, gripModeForTool, setGripMode, replace, mutate, saveLocal, loadLocal, clearLocal, applyPrimaryGripVisuals, debugForTool,
    editorSecondaryGripStateSnapshot, restoreEditorSecondaryGripState, loadEditorAnimationGrip,
    getDebug() {
      const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
      const value = inAttackEditor() ? editorCurrentToolKey() : (snapshot?.itemKey || snapshot?.shape || '');
      return debugForTool(value);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

  global.HobunjiCharacterDimensions?.subscribe?.(() => notify()); // Re-applies visible weapon scale + hand targets when asynchronous calculated-height measurements become ready.

  // This file loads before procedural-hand-attachments; intercept its assignment so
  // the very first editor/game rig receives the off-hand blend wrapper.
  if (!global.ProceduralHandAttachments) {
    const descriptor = Object.getOwnPropertyDescriptor(global, 'ProceduralHandAttachments');
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(global, 'ProceduralHandAttachments', {
        configurable: true, enumerable: true, get() { return null; },
        set(value) {
          Object.defineProperty(global, 'ProceduralHandAttachments', { value, configurable: true, enumerable: true, writable: true });
          installRigBlendWrapper();
        },
      });
    }
  } else installRigBlendWrapper();

  function installMaintenance() {
    // installCombatCapture/installRigBlendWrapper stay idempotent per-frame retries
    // (not one-shot) because their prerequisites (Combat.deps.__weaponToolStanceVisualHooks,
    // a configurable ProceduralHandAttachments global) can become ready on a later
    // frame than this module's own load — see the reverted Stage 1 attempt at
    // event-driven install in docs/architecture/runtime-frame-scheduler.md. Both
    // functions already guard themselves with an installed-flag check, so repeating
    // them every frame is cheap once installed.
    installCombatCapture();
    installRigBlendWrapper();
    installEditorUi();
    if (editorUi) syncEditorSpanUi();
  }

  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('hand-tool-grips-install', installMaintenance, {
      owner: 'HobunjiHandToolGrips',
      description: 'Idempotently (re)installs the combat-capture and rig-blend wrappers, and refreshes the Attack Animation Editor grip UI when present.',
    });
    global.RuntimeFrameScheduler.register('hand-tool-grips-visuals', applyPrimaryGripVisuals, {
      phase: 'pre-render',
      owner: 'HobunjiHandToolGrips',
      description: 'Maintains intrinsic held-item scale before render; authored grip targets move hands while weapon position/orientation remain animation-owned.',
    });
  } else {
    // The standalone Attack Animation Editor and Animation Author tool pages
    // (docs/tools/*) also load this module but never load
    // RuntimeFrameScheduler — they own their own isolated animation context,
    // so this keeps the original combined per-frame loop for them unchanged.
    function frame() {
      installMaintenance();
      applyPrimaryGripVisuals();
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);
  }
})(window);
