// Canonical default whole-character scales authored in Animation Author's
// Full Character Scale comparison. These are visual-rig multipliers around the
// floor-relative character parent; they do not rewrite portrait/body/hand/foot
// local coordinates.
//
// Body width (x) and height (y) can be tuned independently. Head remains the
// runtime head factor consumed by HobunjiCharacterRigScale; the Animation
// Author may present it as a percentage of the raw portrait PNG by composing it
// with anatomy.portraitScale, but exports/defaults deliberately keep this
// runtime coordinate so gameplay and editor persistence share one schema.
//
// headOffsetY is a separate, additive vertical nudge for the head — a fraction
// of the avatar's own model height — composed at runtime with per-NPC age hunch.
(() => {
  'use strict';

  const VERSION = 30; // 2026-11-24: every character inherits the same-gender Mao'ao relative changes from main; all raw PNG heads target 65%.
  const NUHONGAN_PART_SCALE_AXES = Object.freeze({ x: 31 / 24, y: 31 / 24, z: 31 / 24 }); // Mean of prior inverse 0.8/0.75 adjustments: keep donor-sized extremities without stretching one axis.
  const NUHONGAN_HAND_SCALE_AXES = Object.freeze({ x: 31 / 24 * 0.88, y: 31 / 24 * 0.88, z: 31 / 24 * 0.88 }); // Nov 22: Nuhongan hands a little smaller (88%) than the shared extremity size; feet keep NUHONGAN_PART_SCALE_AXES.
  // Longoran extremities are thinner, never shorter (lanky look). Axes are in the
  // character floor frame: hands hang along y (length), feet point along z (length).
  const LONGORAN_HAND_SCALE_AXES = Object.freeze({ x: 0.72, y: 1, z: 0.8 });
  const LONGORAN_FOOT_SCALE_AXES = Object.freeze({ x: 0.7, y: 0.85, z: 1 });
  // Main's one Height scalar scaled BOTH painted torso and foot reach. To reproduce that adult baseline
  // under the new independent UI, copy main's X/Y/head/offset and set legLength = main Y for every species/gender.
  // The original main values are pinned to 493ccfb05b5f9ff0486bbf43450523fc6c4dda17; future deliberate retuning is separate.
  const MAIN_VALUES = Object.freeze({
    'tletingan::male': Object.freeze({ x: 0.85, y: 0.85, legLength: 0.85, head: 0.8, offsetY: 0 }),
    'tletingan::female': Object.freeze({ x: 0.915, y: 0.89, legLength: 0.89, head: 0.8823529411764706, offsetY: 0 }),
    'nuhongan::male': Object.freeze({ x: 0.68, y: 0.6375, legLength: 0.6375, head: 0.8, offsetY: 0 }),
    'nuhongan::female': Object.freeze({ x: 0.732, y: 0.6675, legLength: 0.6675, head: 0.8823529411764706, offsetY: 0 }),
    'longoran::male': Object.freeze({ x: 1.05, y: 2, legLength: 2, head: 0.9647, offsetY: -0.055 }), // Direct Full Character Scale export: male's approved body/head values.
    'longoran::female': Object.freeze({ x: 1.130294117647059, y: 2.0941176470588236, legLength: 2.0941176470588236, head: 1.0640073529411764, offsetY: -0.055 }), // Old female defaults × (new male ÷ old male) per scale axis; head offset gets the same -0.055 additive change.
    'engh-sho::male': Object.freeze({ x: 0.8, y: 0.845, legLength: 0.845, head: 0.7894736842105263, offsetY: 0 }),
    'engh-sho::female': Object.freeze({ x: 0.795, y: 0.81, legLength: 0.81, head: 0.7894736842105263, offsetY: 0 }),
    'harlyao::male': Object.freeze({ x: 0.96, y: 1.014, legLength: 1.014, head: 0.9473684210526315, offsetY: 0 }),
    'harlyao::female': Object.freeze({ x: 0.954, y: 0.972, legLength: 0.972, head: 0.9473684210526315, offsetY: 0 }),
    'mao-ao::male': Object.freeze({ x: 0.81675, y: 1.089, legLength: 1.089, head: 0.726, offsetY: 0 }),
    'mao-ao::female': Object.freeze({ x: 0.895, y: 0.94, legLength: 0.94, head: 0.7813, offsetY: 0 }),
    'kenkari::male': Object.freeze({ x: 1.225, y: 1.225, legLength: 1.225, head: 1, offsetY: 0 }),
    'kenkari::female': Object.freeze({ x: 1.1, y: 1.1, legLength: 1.1, head: 1, offsetY: 0 }),
    'mashtzarr::male': Object.freeze({ x: 0.955, y: 1.255, legLength: 1.255, head: 0.9856, offsetY: -0.095 }),
    'mashtzarr::female': Object.freeze({ x: 1.01, y: 0.99, legLength: 0.99, head: 0.8475, offsetY: -0.02 }),
    'mammakhbuur::male': Object.freeze({ x: 0.96, y: 1.69, legLength: 1.69, head: 0.9771, offsetY: -0.095 }),
    'mammakhbuur::female': Object.freeze({ x: 1.0153, y: 1.3331, legLength: 1.3331, head: 0.8402, offsetY: -0.02 }),
  }); // The unmodified main baselines are retained so every shift remains auditable.
  const RAW_HEAD_SCALE = 0.65; // Full Character Scale shows 65% of each original undecorated head PNG, not an internal neck factor.
  const MAOAO_SOURCE_MAIN = Object.freeze({ // Exact current main effective reference; body scalars from canonical rig defaults, limb scalars from live hand/foot config.
    male: Object.freeze({ x: .81675, y: 1.089, handScale: 1.1, footScale: 1.3125 }),
    female: Object.freeze({ x: .895, y: .94, handScale: 1, footScale: 1.28125 }),
  });
  const MAOAO_SOURCE_APPROVED = Object.freeze({ // Uploaded hobunji_full_character_scales (2).json; leave these Mao'ao proportions unchanged.
    male: Object.freeze({ x: .85, y: 1.29, handScale: 1.2, footScale: 1.05 }),
    female: Object.freeze({ x: .895, y: .94, handScale: 1.15, footScale: 1.025 }),
  });
  const MAOAO_RELATIVE_SHIFT = Object.freeze(Object.fromEntries(['male', 'female'].map(gender => [
    gender, Object.freeze(Object.fromEntries(['x', 'y', 'handScale', 'footScale'].map(field => [
      field, MAOAO_SOURCE_APPROVED[gender][field] / MAOAO_SOURCE_MAIN[gender][field],
    ]))),
  ]))); // Same-sex proportional deltas applied once to every non-Mao'ao profile; an absolute head-size target supersedes head deltas.

  const ADDITIONAL_MAIN_VALUES = Object.freeze({ // Source export includes these non-canonical skeleton/bipedal profiles in addition to the 18 core pairs.
    'boney-shinjimi-skeleton::male': Object.freeze({x:1, y:1, legLength:1, offsetY:0}),
    'harlyao-skeleton::male': Object.freeze({x:.96, y:1.014, legLength:1.014, offsetY:0}),
    'harlyao-skeleton::female': Object.freeze({x:.954, y:.972, legLength:.972, offsetY:0}),
    'mao-ao-skeleton::male': Object.freeze({x:.8168, y:1.089, legLength:1.089, offsetY:0}),
    'maskbound-guardian::male': Object.freeze({x:1, y:1, legLength:1, offsetY:0}),
    'nohuknuk::male': Object.freeze({x:1, y:1, legLength:1, offsetY:0}),
    'omgurku::male': Object.freeze({x:1, y:1, legLength:1, offsetY:0}),
    'porakaneki::male': Object.freeze({x:1, y:1, legLength:1, offsetY:0}),
  });
  const SOURCE_PART_SCALES = Object.freeze({ // Complete upload's existing limb sizes: preserve its other authored deviations rather than resetting them to main.
    'kenkari::male': [1,1], 'kenkari::female': [.93,1],
    'tletingan::male': [.95,.95], 'tletingan::female': [.925,1.025],
    'nuhongan::male': [.95,.95], 'nuhongan::female': [.925,1.025],
    'longoran::male': [.95,.95], 'longoran::female': [.925,1.025],
    'engh-sho::male': [1.45,1.25], 'engh-sho::female': [1.3,1.17],
    'mao-ao::male': [1.2,1.05], 'mao-ao::female': [1.15,1.025],
    'mashtzarr::male': [1,1.175], 'mashtzarr::female': [.95,1],
    'mammakhbuur::male': [1,1.175], 'mammakhbuur::female': [.95,1],
    'boney-shinjimi-skeleton::male': [1.2,1.05],
    'harlyao::male': [1.45,1.25], 'harlyao::female': [1.3,1.17],
    'harlyao-skeleton::male': [1.45,1.25], 'harlyao-skeleton::female': [1.3,1.17],
    'mao-ao-skeleton::male': [1.2,1.05], 'maskbound-guardian::male': [1.2,1.05],
    'nohuknuk::male': [1,1], 'omgurku::male': [1.45,1.25], 'porakaneki::male': [1,1],
  });
  const PORTRAIT_SCALE_BY_SPECIES = Object.freeze({ // Corresponds to canonical rig anatomy and NPC parentSpecies' inherited PNG scale.
    kenkari: .75, tletingan: .85, nuhongan: .85, longoran: .85,
    'engh-sho': .95, harlyao: .95, 'harlyao-skeleton': .95,
    'mao-ao': 1, 'mao-ao-skeleton': 1, mashtzarr: 1.18, mammakhbuur: 1.18,
    omgurku: .95, porakaneki: .75, // Their humanoid upper sprites inherit Engh-sho and Kenkari source-plane scales respectively.
  });
  const portraitScaleFor = (species, gender) => species === 'mao-ao' && gender === 'female' ? .8
    : PORTRAIT_SCALE_BY_SPECIES[species] || 1; // The editor still measures the actual rendered plane when displaying/saving Head edits.
  const VALUES = Object.freeze(Object.fromEntries(Object.entries({...MAIN_VALUES, ...ADDITIONAL_MAIN_VALUES}).map(([key, base]) => {
    const [species, gender] = key.split('::');
    const delta = MAOAO_RELATIVE_SHIFT[gender]; // Male and female Mao'ao changes are independent; do not transfer male height to females.
    const part = SOURCE_PART_SCALES[key] || [1,1]; // Defaults are the uploaded hand/foot values for every included identity.
    const isMaoao = species === 'mao-ao';
    const reference = MAOAO_SOURCE_APPROVED[gender];
    return [key, Object.freeze({
      x: isMaoao ? reference.x : base.x * delta.x,
      y: isMaoao ? reference.y : base.y * delta.y,
      legLength: isMaoao ? reference.y : (base.legLength ?? base.y) * delta.y, // Identical body/leg changes preserve beltline geometry.
      head: RAW_HEAD_SCALE / portraitScaleFor(species, gender), // Internal factor cancels actual source portrait multiplier: displayed raw Head=65%.
      offsetY: base.offsetY, // No independently changed Mao'ao head offset; keep Longoran/Mashtzarr authored positions.
      handScale: isMaoao ? reference.handScale : part[0] * delta.handScale,
      footScale: isMaoao ? reference.footScale : part[1] * delta.footScale,
    })];
  })));

  // Reference: chairSimple.json's authored back top is 0.431 + 0.458/2 = 0.660 world units.
  // As in the six-foot overlay, that complete chair corresponds to approximately 3 feet.
  const CHAIR_BACK_WORLD_HEIGHT = 0.431 + 0.458 / 2; // Single physical yardstick shared with Full Character Scale's six-foot ruler.
  const MAOAO_BASE_MODEL_HEIGHT = 0.9; // Gameplay pngPlaneAvatar.worldModelWidth; Mao'ao adult portraitScaleBySpecies is 1.
  const MAOAO_ADULT_DEFAULT_HEIGHT = VALUES['mao-ao::male'].y; // Main-authored Mao'ao body height, before new world calibration.
  const WORLD_HEIGHT_CALIBRATION = Object.freeze({
    chairReference: 'chairSimple', chairBackWorldHeight: CHAIR_BACK_WORLD_HEIGHT, chairHeightFeet: 3,
    referenceSpecies: 'mao-ao', referenceGender: 'male', targetFeet: 6.25,
    referenceUnscaledWorldHeight: MAOAO_BASE_MODEL_HEIGHT * MAOAO_ADULT_DEFAULT_HEIGHT,
    targetWorldHeight: CHAIR_BACK_WORLD_HEIGHT * (6.25 / 3),
    uniformScale: (CHAIR_BACK_WORLD_HEIGHT * (6.25 / 3)) / (MAOAO_BASE_MODEL_HEIGHT * MAOAO_ADULT_DEFAULT_HEIGHT),
  }); // Applied once at the assembled floor-parent transform to all humanlike avatars (including saved overrides); species relative proportions stay unchanged.
  const ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' }); // Skeleton identities now own their imported transforms; unrelated aliases still share canonical species. // Transform-equivalent NPC-only species inherit shared full-rig defaults; Harlyao Skeleton deliberately shares Harlyao's 1.2x Engh-sho scale.
  const MAOAO_FOOT_SCALE = Object.freeze({ male: 1.05, female: 1.025 }); // Exact new Mao'ao reference foot scales; +25% old main tuning has been removed.

  const normalizeSpecies = value => {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return ALIASES[raw] || raw;
  };
  const normalizeGender = value => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  };
  const scaleFor = (species, gender) => VALUES[`${normalizeSpecies(species)}::${normalizeGender(gender)}`] || { x: 1, y: 1, head: RAW_HEAD_SCALE, offsetY: 0 }; // Fallback characters also have a 65% raw head at unscaled portrait size.
  const uniformScaleFor = (species, gender) => scaleFor(species, gender).x; // Back-compat for readers that only need one scalar.

  function applyMaoaoFootScaleTuning() {
    const footScale = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale; // Gameplay procedural feet use the same 26 defaults as the Animation Author.
    if (!footScale) return false;
    for (const [key, target] of Object.entries(VALUES)) {
      const [species, gender] = key.split('::');
      footScale[species] ||= {};
      footScale[species][gender] = target.footScale; // Reapply once on bootstrap; subsequent per-NPC authored/custom overrides remain independent.
    }
    return true;
  }

  function applyApprovedScaleDefaultsToProfiles() {
    const chars = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters;
    if (!chars) return 0;
    let applied = 0;
    for (const [key, profile] of Object.entries(chars)) {
      const target = scaleFor(...key.split('::'));
      if (!profile?.anatomy || !target || !(Number(target.handScale) > 0)) continue;
      const anatomy = profile.anatomy; // Only update scalar defaults; rigs, perches, attachments, character anchors, and source portraits are unchanged.
      anatomy.rigScaleX = target.x;
      anatomy.rigScaleY = target.y;
      anatomy.legLengthScale = target.legLength;
      anatomy.headScale = target.head;
      anatomy.headOffsetY = target.offsetY;
      anatomy.handScale = target.handScale;
      anatomy.footScale = target.footScale;
      applied++;
    }
    return applied;
  }

  applyMaoaoFootScaleTuning();
  window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS = VALUES;
  window.HobunjiCharacterRigScaleDefaults = Object.freeze({
    version: VERSION,
    coordinateSpace: 'character-floor-parent',
    values: VALUES,
    rawHeadScale: RAW_HEAD_SCALE, // Raw PNG target shared by UI, game defaults and the uploaded 26-profile export.
    maoaoRelativeShift: MAOAO_RELATIVE_SHIFT, // Public diagnostics explain exactly what was inherited by male/female species.
    applyApprovedScaleDefaultsToProfiles, // Called after all species modules have completed their own rig profile registration.
    worldHeightCalibration: WORLD_HEIGHT_CALIBRATION, // Consumed by the gameplay/editor shared parent scaler; numeric authored values remain unchanged for save compatibility.
    nuhonganPartScaleAxes: NUHONGAN_PART_SCALE_AXES,
    nuhonganHandScaleAxes: NUHONGAN_HAND_SCALE_AXES,
    longoranHandScaleAxes: LONGORAN_HAND_SCALE_AXES,
    longoranFootScaleAxes: LONGORAN_FOOT_SCALE_AXES,
    aliases: ALIASES,
    maoaoFootScale: MAOAO_FOOT_SCALE,
    applyMaoaoFootScaleTuning,
    scaleFor,
    uniformScaleFor,
  });
})();
