// Held-item-local grip and base-scale authoring shared by gameplay and the Attack Animation Editor.
// A primary grip is a target frame ON THE ITEM. The animation owns the item's transform;
// grip authoring moves the RIGHT HAND to that frame and never inverse-moves the weapon.
// Optional off-hand authoring is a Z span on the item; attack poses choose 0..100%
// along that span and smoothly blend the left hand on/off it. Base toolScale belongs
// to the item shape and also scales grip-point positions away from the item origin.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji_hand_tool_grips.v1';
  const LOCAL_KEY = 'hobunji.handToolGrips.v1';
  const SECONDARY_GRIP_PRESET = 'animation-span-v1'; // Migrates old always-on secondary points into animation-gated Z spans.
  const PRIMARY_ROTATION_PRESET = 'hatchet-primary-xy-rotation-20260921-v3'; // Hatchet is the canonical right-hand grip example: propagate its X, Y, and rotation to every other tool, never its item-specific Z.
  const PRE_AUTHORED_RANGED_GRIP_PRESET = 'melee-ranged-split-20260920-v4-editor-authored'; // Previous committed split cloned melee into ranged; used only to migrate untouched old dagger defaults.
  const PRE_END_FLIP_DAGGER_RANGED_PRESET = 'melee-ranged-split-20260920-v5-authored-values'; // Previous authored dagger used ranged Z -0.30 before Tool End Flip's visible-axis correction changed the needed hand target.
  const RANGED_GRIP_PRESET = 'melee-ranged-split-20260920-v6-end-flip-adjusted'; // Current committed ranged grips after the corrected visible Tool End Flip basis.
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

  const DEFAULT_DATA = {
    schema: SCHEMA,
    secondaryGripPreset: SECONDARY_GRIP_PRESET,
    primaryRotationPreset: PRIMARY_ROTATION_PRESET,
    rangedGripPreset: RANGED_GRIP_PRESET,
    tools: {
      hatchet: {
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0106 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        toolScale: 1,
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0106 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      hoe: {
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        toolScale: 1,
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedGripMode: null,
      },
      bshuakauitl: {
        toolScale: 1.3,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0.14 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: true, startZ: -0.23, endZ: -0.16 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0.14 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: true, startZ: -0.23, endZ: -0.16 },
        rangedGripMode: null,
      },
      pickshovel: {
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        toolScale: 1,
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
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
        secondaryGripSpan: { enabled: true, startZ: -0.54, endZ: -0.39 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: -0.2672 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: true, startZ: -0.54, endZ: -0.39 },
        rangedGripMode: null,
      },
      dagger: {
        toolScale: 0.55,
        primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.09 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },
        rangedPrimaryGrip: { position: { x: 0, y: -0.05, z: 0.28 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
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
        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        gripMode: null,
        secondaryGripSpan: { enabled: true, startZ: -0.5, endZ: -0.16 },
        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } },
        rangedSecondaryGripSpan: { enabled: true, startZ: -0.5, endZ: -0.16 },
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
    return key;
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
    next.schema = SCHEMA;
    next.secondaryGripPreset = SECONDARY_GRIP_PRESET;
    next.primaryRotationPreset = PRIMARY_ROTATION_PRESET;
    next.rangedGripPreset = RANGED_GRIP_PRESET;
    const rawTools = next.tools && typeof next.tools === 'object' ? next.tools : {}; // Saved drafts override defaults, while newly added weapon defaults still appear after upgrades.
    next.tools = { ...clone(DEFAULT_DATA.tools), ...rawTools };
    for (const [toolKey, entry] of Object.entries(next.tools)) {
      if (!entry || typeof entry !== 'object') continue;
      const fallbackEntry = DEFAULT_DATA.tools[toolKey] || {}; // Lets pre-scale local drafts inherit the new committed scale for that same shape.
      entry.toolScale = normalizeToolScale(entry.toolScale, fallbackEntry.toolScale ?? 1);
      entry.primaryGrip = normalizeTransform(entry.primaryGrip);
      if (previousPrimaryRotationPreset !== PRIMARY_ROTATION_PRESET) {
        entry.primaryGrip.position.x = HATCHET_PRIMARY_GRIP_EXAMPLE.x; // Hatchet's authored X belongs to the shared hand-on-item frame.
        entry.primaryGrip.position.y = HATCHET_PRIMARY_GRIP_EXAMPLE.y; // Hatchet's authored Y belongs to the shared hand-on-item frame.
        entry.primaryGrip.rotationDeg = { ...HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg }; // Hatchet rotation is the shared example for every weapon.
      }
      entry.secondaryGripSpan = inferredSpan(entry);
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
        const untouchedPreAuthoredClone = previousRangedGripPreset === PRE_AUTHORED_RANGED_GRIP_PRESET
          && Math.abs(entry.toolScale - 1) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.x) - HATCHET_PRIMARY_GRIP_EXAMPLE.x) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.y) - HATCHET_PRIMARY_GRIP_EXAMPLE.y) < 1e-9
          && Math.abs(numberOrZero(ranged?.position?.z) - numberOrZero(entry.primaryGrip?.position?.z)) < 1e-9
          && numberOrZero(rr.pitch) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.pitch
          && numberOrZero(rr.yaw) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.yaw
          && numberOrZero(rr.roll) === HATCHET_PRIMARY_GRIP_EXAMPLE.rotationDeg.roll;
        if (untouchedAutoGuess || untouchedPreviousAuthoredGrip || untouchedPreAuthoredClone) {
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
    entry.primaryGrip = normalizeTransform(entry.primaryGrip);
    entry.secondaryGripSpan = inferredSpan(entry);
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

  function authoredPrimaryGripForTool(value, context = currentGripContext()) {
    const entry = ensureTool(value);
    return normalizeTransform(entry?.[primaryGripFieldForContext(context)]);
  }

  function primaryGripForTool(value, context = currentGripContext()) {
    const authored = authoredPrimaryGripForTool(value, context); // Selected melee/ranged item-local frame the right hand must reach.
    const scale = toolScaleForTool(value); // Grip coordinates are authored against the unscaled sprite and expand with its intrinsic size.
    return {
      position: {
        x: numberOrZero(authored.position.x) * scale,
        y: numberOrZero(authored.position.y) * scale,
        z: numberOrZero(authored.position.z) * scale,
      },
      rotationDeg: { ...authored.rotationDeg },
    };
  }

  function secondaryGripSpanForTool(value, context = currentGripContext()) {
    const entry = ensureTool(value);
    const span = entry?.[secondaryGripSpanFieldForContext(context)];
    return span?.enabled ? { enabled: true, startZ: numberOrZero(span.startZ), endZ: numberOrZero(span.endZ) } : null;
  }

  const editorSecondaryPoses = {
    neutral: { enabled: false, percent: 50 },
    windup: { enabled: false, percent: 50 },
    strike: { enabled: false, percent: 50 },
  };
  let capturedMelee = null;

  function normalizeAnimationGrip(raw) {
    return { influence: raw?.enabled === true ? 1 : 0, percent: clamp(raw?.percent ?? 50, 0, 100) };
  }

  function lerpAnimationGrip(a, b, t) {
    const k = clamp01(t);
    return { influence: a.influence + (b.influence - a.influence) * k, percent: a.percent + (b.percent - a.percent) * k };
  }

  function hasAnimationGripMetadata(poseSet) {
    return ['neutral', 'windup', 'strike'].some(phase => poseSet?.[phase]?.secondaryGrip && typeof poseSet[phase].secondaryGrip === 'object');
  }

  function animationGripAt(progress, timing = {}, poseSet = {}, sequence = 'attack') {
    if (!hasAnimationGripMetadata(poseSet)) return { influence: 0, percent: 50, source: 'none' };
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const neutral = normalizeAnimationGrip(poseSet.neutral?.secondaryGrip);
    const windup = normalizeAnimationGrip(poseSet.windup?.secondaryGrip);
    const strike = normalizeAnimationGrip(poseSet.strike?.secondaryGrip);
    const poseScale = clamp01(timing.poseScale ?? 1); // Used after a partial held release to keep the off-hand endpoint at the same amplitude as the weapon.
    const scaledWindup = lerpAnimationGrip(neutral, windup, poseScale); // Used as the effective partial Windup grip state.
    const scaledStrike = lerpAnimationGrip(neutral, strike, poseScale); // Used as the effective partial Strike grip state.
    let result;
    if (sequence === 'load') {
      result = t <= wf ? lerpAnimationGrip(neutral, scaledWindup, t / Math.max(1e-6, wf)) : lerpAnimationGrip(scaledWindup, neutral, (t - wf) / Math.max(1e-6, 1 - wf));
    } else if (sequence === 'fire') {
      if (t <= sf) result = lerpAnimationGrip(neutral, scaledStrike, t / Math.max(1e-6, sf));
      else if (t <= hf) result = { ...scaledStrike };
      else result = lerpAnimationGrip(scaledStrike, neutral, (t - hf) / Math.max(1e-6, 1 - hf));
    } else if (t <= wf) {
      const rawWindupT = t / Math.max(1e-6, wf);
      const poseT = global.Combat?.windupPoseProgress?.(rawWindupT, timing.windupSlowdown) ?? rawWindupT;
      result = lerpAnimationGrip(neutral, scaledWindup, poseT);
    }
    else if (t <= sf) result = lerpAnimationGrip(scaledWindup, scaledStrike, (t - wf) / Math.max(1e-6, sf - wf));
    else if (t <= hf) result = { ...scaledStrike };
    else result = lerpAnimationGrip(scaledStrike, neutral, (t - hf) / Math.max(1e-6, 1 - hf));
    return { ...result, source: 'animation-pose' };
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
      neutral: { secondaryGrip: editorSecondaryPoses.neutral },
      windup: { secondaryGrip: editorSecondaryPoses.windup },
      strike: { secondaryGrip: editorSecondaryPoses.strike },
    };
    return animationGripAt(progress, timing, poseSet, document.getElementById('playbackSequence')?.value || 'attack');
  }

  function runtimeAnimationGripState() {
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    const active = snapshot?.combatNeutralInjected === true && Number.isFinite(Number(snapshot?.combatProgress));
    if (!active) {
      capturedMelee = null;
      return { influence: 0, percent: 50, source: 'idle' };
    }
    const opts = capturedMelee?.opts || {};
    return animationGripAt(snapshot.combatProgress, {
      windupFrac: opts.windupFrac ?? 0.16,
      strikeFrac: opts.strikeFrac ?? 0.55,
      holdFrac: opts.holdFrac ?? 0.68,
      windupSlowdown: opts.windupSlowdown ?? 0,
      poseScale: snapshot.combatPoseScale ?? 1,
    }, opts.pose || {}, opts.sequence || 'attack');
  }

  function currentSecondaryGripAnimationState() { return inAttackEditor() ? editorAnimationGripState() : runtimeAnimationGripState(); }

  function secondaryGripForTool(value, context = currentGripContext()) {
    const span = secondaryGripSpanForTool(value, context);
    if (!span) return null;
    const state = currentSecondaryGripAnimationState();
    if (!(state.influence > 0.0001)) return null;
    const percent01 = clamp01(state.percent / 100);
    const itemZ = span.startZ + (span.endZ - span.startZ) * percent01;
    const itemScale = toolScaleForTool(value); // The left-hand target lives directly in the same item-local frame as the primary target.
    return {
      enabled: true,
      influence: clamp01(state.influence),
      percent: state.percent,
      itemZ,
      position: { x: 0, y: 0, z: itemZ * itemScale },
      rotationDeg: { pitch: 0, yaw: 0, roll: 0 },
    };
  }

  function installCombatCapture() {
    const deps = global.Combat?.deps;
    if (!deps?.__weaponToolStanceVisualHooks || deps.__hobunjiSecondarySpanCapture) return false;
    for (const name of ['triggerWeaponSwingVisual', 'triggerWeaponHoldVisual']) {
      const original = deps[name];
      if (typeof original !== 'function') continue;
      deps[name] = function secondarySpanAwareCombatStart(durationS, opts = {}) {
        capturedMelee = { durationS: Math.max(0.001, Number(durationS) || 0.5), opts: opts && typeof opts === 'object' ? opts : {}, kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing', startedAt: performance.now() };
        return original.call(this, durationS, opts);
      };
    }
    const cancel = deps.cancelWeaponSwingHold;
    if (typeof cancel === 'function') {
      deps.cancelWeaponSwingHold = function secondarySpanAwareCancel(...args) { capturedMelee = null; return cancel.apply(this, args); };
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
        rig.placeHandWorld = function secondarySpanBlendWorld(side, worldPosition, worldQuaternion, modelCalibration = null) {
          const result = originalPlaceHandWorld(side, worldPosition, worldQuaternion, modelCalibration); // Preserve per-GLB calibration through the off-hand span wrapper.
          if (side !== 'left' || !leftSocket || !idlePosition || !idleQuaternion) return result;
          const influence = clamp01(currentSecondaryGripAnimationState().influence);
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

  function applyHeldItemScale(node, toolScale = 1) {
    const base = visualBaseFor(node); // Captures only the visual's authored base scale; position/orientation remain animation-owned.
    if (!base) return;
    applyScaleFromBase(node, base, toolScale);
    node.updateMatrix?.();
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

  function applyEditorGripPresentation() {
    const context = global.HobunjiAttackEditorToolContext;
    const visual = context?.toolPlaneMesh || null;
    if (!visual) return;
    const key = toolKeyFor(context.toolKey || document.getElementById('toolSpriteSelect')?.value || '');
    applyHeldItemScale(visual, toolScaleForTool(key));
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
    applyHeldItemScale(visual, toolScaleForTool(itemKey));
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
  function editorCurrentToolKey() { return toolKeyFor(document.getElementById('toolSpriteSelect')?.value || ''); }
  function editorGripContext() { return normalizeGripContext(document.getElementById('handGripContextSelect')?.value || 'melee'); }

  function editorAnimationJsonObject() {
    const view = document.getElementById('jsonView');
    if (!view) return null;
    let parsed;
    try { parsed = JSON.parse(view.value || '{}'); } catch (_) { return null; }
    if (!parsed.poses || typeof parsed.poses !== 'object') parsed.poses = {};
    for (const phase of ['neutral', 'windup', 'strike']) {
      if (!parsed.poses[phase] || typeof parsed.poses[phase] !== 'object') parsed.poses[phase] = {};
      parsed.poses[phase].secondaryGrip = { enabled: editorSecondaryPoses[phase].enabled === true, percent: clamp(editorSecondaryPoses[phase].percent, 0, 100) };
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
    for (const phase of ['neutral', 'windup', 'strike']) {
      const raw = dataObj?.poses?.[phase]?.secondaryGrip;
      editorSecondaryPoses[phase].enabled = raw?.enabled === true;
      editorSecondaryPoses[phase].percent = clamp(raw?.percent ?? 50, 0, 100);
    }
    syncEditorSpanUi(); patchEditorJsonView();
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
    const spanField = secondaryGripSpanFieldForContext(gripContext);
    const span = entry?.[spanField] || { enabled: false, startZ: 0, endZ: 0 };
    editorUi.scalePair.set(normalizeToolScale(entry?.toolScale));
    editorUi.spanEnabled.checked = span.enabled === true;
    editorUi.startPair.set(numberOrZero(span.startZ)); editorUi.endPair.set(numberOrZero(span.endZ));
    for (const phase of ['neutral', 'windup', 'strike']) {
      const controls = editorUi.pose[phase];
      controls.enabled.checked = editorSecondaryPoses[phase].enabled === true;
      controls.percent.set(clamp(editorSecondaryPoses[phase].percent, 0, 100));
      const canGrip = span.enabled === true;
      controls.enabled.disabled = !canGrip; controls.percent.range.disabled = !canGrip; controls.percent.number.disabled = !canGrip;
    }
    const state = editorAnimationGripState();
    const scaleLabel = `base scale ×${normalizeToolScale(entry?.toolScale).toFixed(2)}`;
    editorUi.status.textContent = span.enabled
      ? `${editorCurrentToolKey() || 'held item'} · ${gripContext.toUpperCase()} grip · ${scaleLabel} · off-hand span Z ${numberOrZero(span.startZ).toFixed(2)} → ${numberOrZero(span.endZ).toFixed(2)} · animation influence ${Math.round(state.influence * 100)}% · span position ${Math.round(state.percent)}%`
      : `${editorCurrentToolKey() || 'held item'} · ${gripContext.toUpperCase()} grip · ${scaleLabel} · no off-hand span; animation secondary-hand settings are ignored.`;
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
      <div class="poseGroupHead"><span class="dot" style="background:#60a5fa"></span>Held-item base scale</div>
      <div class="help" style="margin-bottom:6px">This scale belongs to the weapon/tool shape and is exported with its grip metadata. The Neutral pose's Tool scale remains a separate animation multiplier and should normally stay at 1.00 for melee weapons.</div>
      <div id="handToolScaleFields"></div>`;
    host.insertBefore(scalePanel, status);
    const scalePair = editorFieldPair(scalePanel.querySelector('#handToolScaleFields'), 'handToolScale', 'Base tool scale', 1, 0.1, 3, 0.01, value => mutate(() => { ensureTool(editorCurrentToolKey()).toolScale = normalizeToolScale(value); }));

    const panel = document.createElement('div');
    panel.id = 'handSecondaryGripSpanPanel';
    panel.innerHTML = `
      <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Optional off-hand Z span</div>
      <div class="help" style="margin-bottom:6px">This defines where the <b>left hand may move on the weapon's local Z axis</b>. The weapon does not move. Attack poses below decide whether the left hand reaches this span and where along it lands.</div>
      <div class="field"><label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handSecondarySpanEnabled" style="width:auto;margin-right:6px">Weapon has an off-hand span</label></div>
      <div id="handSecondarySpanFields"></div>
      <div class="hr"></div>
      <div class="poseGroupHead"><span class="dot" style="background:#f59e0b"></span>Animation off-hand</div>
      <div class="help" style="margin-bottom:6px">Each pose can opt into the span. Enabled influence lerps with the same Neutral → Windup → Strike → Return timing as the weapon pose, so the hand reaches on and releases smoothly.</div>
      <div id="handSecondaryAnimationFields"></div>
      <div class="help" id="handSecondarySpanStatus" style="padding:7px;border:1px solid rgba(245,158,11,.24);border-radius:8px;margin:6px 0"></div>`;
    host.insertBefore(panel, status);
    const spanFields = panel.querySelector('#handSecondarySpanFields'), animationFields = panel.querySelector('#handSecondaryAnimationFields'), spanEnabled = panel.querySelector('#handSecondarySpanEnabled');
    const currentSpan = () => {
      const entry = ensureTool(editorCurrentToolKey());
      return entry[secondaryGripSpanFieldForContext(editorGripContext())];
    };
    const startPair = editorFieldPair(spanFields, 'handSecondarySpanStartZ', 'Left-hand span start · tool Z position', 0, -1.5, 1.5, 0.01, value => mutate(() => { currentSpan().startZ = value; }));
    const endPair = editorFieldPair(spanFields, 'handSecondarySpanEndZ', 'Left-hand span end · tool Z position', 0, -1.5, 1.5, 0.01, value => mutate(() => { currentSpan().endZ = value; }));
    const pose = {};
    for (const phase of ['neutral', 'windup', 'strike']) {
      const box = document.createElement('div');
      box.className = 'field';
      box.innerHTML = `<label class="fieldRow" style="cursor:pointer"><input type="checkbox" id="handSecondaryAnim_${phase}_enabled" style="width:auto;margin-right:6px">${phase[0].toUpperCase() + phase.slice(1)} uses off hand</label><div id="handSecondaryAnim_${phase}_percent"></div>`;
      animationFields.appendChild(box);
      const enabled = box.querySelector(`#handSecondaryAnim_${phase}_enabled`);
      const percent = editorFieldPair(box.querySelector(`#handSecondaryAnim_${phase}_percent`), `handSecondaryAnim_${phase}_pct`, `${phase[0].toUpperCase() + phase.slice(1)} span %`, 50, 0, 100, 1, value => { editorSecondaryPoses[phase].percent = clamp(value, 0, 100); patchEditorJsonView(); syncEditorSpanUi(); });
      enabled.addEventListener('change', () => { editorSecondaryPoses[phase].enabled = enabled.checked; patchEditorJsonView(); syncEditorSpanUi(); });
      pose[phase] = { enabled, percent };
    }
    spanEnabled.addEventListener('change', () => mutate(() => { currentSpan().enabled = spanEnabled.checked; }));
    editorUi = { scalePanel, scalePair, panel, spanEnabled, startPair, endPair, pose, status: panel.querySelector('#handSecondarySpanStatus') };

    document.getElementById('toolSpriteSelect')?.addEventListener('change', () => setTimeout(syncEditorSpanUi, 0));
    document.getElementById('handGripContextSelect')?.addEventListener('change', () => {
      syncEditorSpanUi();
      global.ProceduralHandFrameDriver?.syncNow?.();
    });
    for (const id of ['scrub', 'windupFrac', 'strikeFrac', 'holdFrac', 'playbackSequence']) {
      document.getElementById(id)?.addEventListener('input', syncEditorSpanUi); document.getElementById(id)?.addEventListener('change', syncEditorSpanUi);
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
    document.getElementById('loadPresetBtn')?.addEventListener('click', () => setTimeout(() => loadEditorAnimationGrip({}), 0));

    const topHelp = host.closest('.card')?.querySelector('.sectionTitle')?.nextElementSibling;
    if (topHelp?.classList.contains('help')) topHelp.innerHTML = 'The <b>right hand stays authored</b> while the item moves around its primary grip point. Base scale is stored with that same held-item metadata. Weapons may also define an optional off-hand Z span; only animations whose poses enable the off hand use that span.';
    syncEditorSpanUi(); patchEditorJsonView(); return true;
  }

  function debugForTool(value) {
    const toolKey = toolKeyFor(value); // Compact console-free snapshot shared by the editor and live game diagnostics.
    return {
      toolKey,
      toolScale: toolScaleForTool(toolKey),
      gripContext: currentGripContext(),
      primaryGrip: authoredPrimaryGripForTool(toolKey, currentGripContext()),
      secondaryGripSpan: secondaryGripSpanForTool(toolKey, currentGripContext()),
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
      editorSecondaryPoses[phase].enabled = raw.enabled === true;
      editorSecondaryPoses[phase].percent = clamp(raw.percent ?? 50, 0, 100);
    }
    syncEditorSpanUi();
    patchEditorJsonView();
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  global.HobunjiHandToolGrips = {
    schema: SCHEMA,
    get data() { return data; },
    get defaultData() { return normalizeData(DEFAULT_DATA); },
    clone: cleanClone,
    toolKeyFor, ensureTool, toolScaleForTool, normalizeGripContext, currentGripContext,
    authoredPrimaryGripForTool, primaryGripForTool, secondaryGripSpanForTool, secondaryGripForTool,
    currentSecondaryGripAnimationState, animationGripAt, gripModeForTool, setGripMode, replace, mutate, saveLocal, loadLocal, clearLocal, applyPrimaryGripVisuals, debugForTool,
    editorSecondaryGripStateSnapshot, restoreEditorSecondaryGripState,
    getDebug() {
      const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
      const value = inAttackEditor() ? editorCurrentToolKey() : (snapshot?.itemKey || snapshot?.shape || '');
      return debugForTool(value);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

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
