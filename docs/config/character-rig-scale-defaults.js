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

  const VERSION = 26; // Optional per-species legLength; Longoran/Tletingan/Nuhongan proportion pass. Keep head/x >= ~0.94 (2px neck-band collar step). v24: thin Longoran hands/feet, smaller Nuhongan hands. v25: Longorans a tad less thick (width -6%) with slightly smaller heads. v26: Tletingan eyes just above male Kenkari eyes; Nuhongans below female Kenkari height.
  const NUHONGAN_PART_SCALE_AXES = Object.freeze({ x: 31 / 24, y: 31 / 24, z: 31 / 24 }); // Mean of prior inverse 0.8/0.75 adjustments: keep donor-sized extremities without stretching one axis.
  const NUHONGAN_HAND_SCALE_AXES = Object.freeze({ x: 31 / 24 * 0.88, y: 31 / 24 * 0.88, z: 31 / 24 * 0.88 }); // Nov 22: Nuhongan hands a little smaller (88%) than the shared extremity size; feet keep NUHONGAN_PART_SCALE_AXES.
  // Longoran extremities are thinner, never shorter (lanky look). Axes are in the
  // character floor frame: hands hang along y (length), feet point along z (length).
  const LONGORAN_HAND_SCALE_AXES = Object.freeze({ x: 0.72, y: 1, z: 0.8 });
  const LONGORAN_FOOT_SCALE_AXES = Object.freeze({ x: 0.7, y: 0.85, z: 1 });
  const VALUES = Object.freeze({
    'tletingan::male': Object.freeze({ x: 0.675, y: 0.9, legLength: 0.75, head: 0.638, offsetY: 0 }), // Really short, stocky folk; eye line sits just above the male Kenkari's (Nov 22 visual pass, measured in world space).
    'tletingan::female': Object.freeze({ x: 0.771, y: 0.986, legLength: 0.814, head: 0.728, offsetY: 0 }),
    'nuhongan::male': Object.freeze({ x: 0.654, y: 0.587, legLength: 0.461, head: 0.671, offsetY: 0 }), // Ewok-like: big head, round body, stubby legs; shorter than the female Kenkari.
    'nuhongan::female': Object.freeze({ x: 0.71, y: 0.622, legLength: 0.488, head: 0.755, offsetY: 0 }),
    'longoran::male': Object.freeze({ x: 1.08, y: 1.4, legLength: 2.3, head: 1.05, offsetY: -0.055 }), // Tall, lanky but thick-framed (bugbear): Mammakhbuur height with long pants-covered legs.
    'longoran::female': Object.freeze({ x: 1.04, y: 2.25, legLength: 2.15, head: 1, offsetY: -0.055 }), // Same silhouette as the male at the Mammakhbuur female's height.
    'engh-sho::male': Object.freeze({ x: 0.8, y: 0.845, head: 0.7894736842105263, offsetY: 0 }),
    'engh-sho::female': Object.freeze({ x: 0.795, y: 0.81, head: 0.7894736842105263, offsetY: 0 }),
    'harlyao::male': Object.freeze({ x: 0.96, y: 1.014, head: 0.9473684210526315, offsetY: 0 }),
    'harlyao::female': Object.freeze({ x: 0.954, y: 0.972, head: 0.9473684210526315, offsetY: 0 }),
    'mao-ao::male': Object.freeze({ x: 0.81675, y: 1.089, head: 0.726, offsetY: 0 }),
    'mao-ao::female': Object.freeze({ x: 0.895, y: 0.94, head: 0.7813, offsetY: 0 }),
    'kenkari::male': Object.freeze({ x: 1.225, y: 1.225, head: 1, offsetY: 0 }),
    'kenkari::female': Object.freeze({ x: 1.1, y: 1.1, head: 1, offsetY: 0 }),
    'mashtzarr::male': Object.freeze({ x: 0.955, y: 1.255, head: 0.9856, offsetY: -0.095 }),
    'mashtzarr::female': Object.freeze({ x: 1.01, y: 0.99, head: 0.8475, offsetY: -0.02 }),
    'mammakhbuur::male': Object.freeze({ x: 0.96, y: 1.69, head: 0.9771, offsetY: -0.095 }),
    'mammakhbuur::female': Object.freeze({ x: 1.0153, y: 1.3331, head: 0.8402, offsetY: -0.02 }),
  });
  const ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao', 'harlyao-skeleton': 'harlyao', 'mao-ao-skeleton': 'mao-ao' }); // Transform-equivalent NPC-only species inherit shared full-rig defaults; Harlyao Skeleton deliberately shares Harlyao's 1.2x Engh-sho scale.
  const MAOAO_FOOT_SCALE = Object.freeze({ male: 1.3125, female: 1.28125 }); // +25% over the canonical authored Mao-ao foot scales (1.05 male / 1.025 female).

  const normalizeSpecies = value => {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return ALIASES[raw] || raw;
  };
  const normalizeGender = value => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  };
  const scaleFor = (species, gender) => VALUES[`${normalizeSpecies(species)}::${normalizeGender(gender)}`] || { x: 1, y: 1, head: 1, offsetY: 0 };
  const uniformScaleFor = (species, gender) => scaleFor(species, gender).x; // Back-compat for readers that only need one scalar.

  function applyMaoaoFootScaleTuning() {
    const footScale = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale; // Shared runtime/tool foot-scale table consumed when procedural feet attach.
    if (!footScale) return false;
    footScale['mao-ao'] ||= {};
    footScale['mao-ao'].male = MAOAO_FOOT_SCALE.male;
    footScale['mao-ao'].female = MAOAO_FOOT_SCALE.female;
    return true;
  }

  applyMaoaoFootScaleTuning();
  window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS = VALUES;
  window.HobunjiCharacterRigScaleDefaults = Object.freeze({
    version: VERSION,
    coordinateSpace: 'character-floor-parent',
    values: VALUES,
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
