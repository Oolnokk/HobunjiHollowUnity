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

  const VERSION = 34; // 2026-11-24: revert every adult default to the verified main-silhouette baseline from commit 4cfb39c, without changing newer editor controls.
  const NUHONGAN_PART_SCALE_AXES = Object.freeze({ x: 31 / 24, y: 31 / 24, z: 31 / 24 }); // Mean of prior inverse 0.8/0.75 adjustments: keep donor-sized extremities without stretching one axis.
  const NUHONGAN_HAND_SCALE_AXES = Object.freeze({ x: 31 / 24 * 0.88, y: 31 / 24 * 0.88, z: 31 / 24 * 0.88 }); // Nov 22: Nuhongan hands a little smaller (88%) than the shared extremity size; feet keep NUHONGAN_PART_SCALE_AXES.
  // Longoran extremities are thinner, never shorter (lanky look). Axes are in the
  // character floor frame: hands hang along y (length), feet point along z (length).
  const LONGORAN_HAND_SCALE_AXES = Object.freeze({ x: 0.72, y: 1, z: 0.8 });
  const LONGORAN_FOOT_SCALE_AXES = Object.freeze({ x: 0.7, y: 0.85, z: 1 });
  // Main's one Height scalar scaled BOTH painted torso and foot reach. To reproduce that adult baseline
  // under the new independent UI, copy main's X/Y/head/offset and set legLength = main Y for every species/gender.
  // The original main values are pinned to 493ccfb05b5f9ff0486bbf43450523fc6c4dda17; future deliberate retuning is separate.
  const VALUES = Object.freeze({
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
  });
  // Values beyond the 18 canonical main silhouettes are opt-in restoration references,
  // not automatic rig overrides; full old-main character defaults remain unchanged.
  const MAIN_AUXILIARY_SILHOUETTES = Object.freeze({ // Used by the adult-only restore control, never by gameplay bootstrap.
    'boney-shinjimi-skeleton::male': { x: 1, y: 1, legLength: 1, head: 1, offsetY: 0 },
    'harlyao-skeleton::male': { ...VALUES['harlyao::male'] },
    'harlyao-skeleton::female': { ...VALUES['harlyao::female'] },
    'mao-ao-skeleton::male': { ...VALUES['mao-ao::male'] },
    'maskbound-guardian::male': { x: 1, y: 1, legLength: 1, head: 1, offsetY: 0 },
    'nohuknuk::male': { x: 1, y: 1, legLength: 1, head: 1, offsetY: 0 },
    'omgurku::male': { x: 1, y: 1, legLength: 1, head: 1, offsetY: 0 },
    'porakaneki::male': { x: 1, y: 1, legLength: 1, head: 1, offsetY: 0 },
  });
  const MAIN_LIMB_REFERENCE = Object.freeze({ // Explicit adult-only restore: original hand/foot sizes before uploaded Mao'ao-relative edits.
    'kenkari::male': [1, 1], 'kenkari::female': [.93, 1],
    'tletingan::male': [.95, .95], 'tletingan::female': [.925, 1.025],
    'nuhongan::male': [.95, .95], 'nuhongan::female': [.925, 1.025],
    'longoran::male': [.95, .95], 'longoran::female': [.925, 1.025],
    'engh-sho::male': [1.45, 1.25], 'engh-sho::female': [1.3, 1.17],
    'harlyao::male': [1.45, 1.25], 'harlyao::female': [1.3, 1.17],
    'mao-ao::male': [1.1, 1.3125], 'mao-ao::female': [1, 1.28125],
    'mashtzarr::male': [1, 1.175], 'mashtzarr::female': [.95, 1],
    'mammakhbuur::male': [1, 1.175], 'mammakhbuur::female': [.95, 1],
    'boney-shinjimi-skeleton::male': [1.2, 1.05],
    'harlyao-skeleton::male': [1.45, 1.25], 'harlyao-skeleton::female': [1.3, 1.17],
    'mao-ao-skeleton::male': [1.1, 1.3125],
    'maskbound-guardian::male': [1.2, 1.05],
    'nohuknuk::male': [1, 1], 'omgurku::male': [1.45, 1.25], 'porakaneki::male': [1, 1],
  });
  const MAIN_SILHOUETTE_RESTORE = Object.freeze(Object.fromEntries(
    Object.entries({ ...VALUES, ...MAIN_AUXILIARY_SILHOUETTES }).map(([key, base]) => [
      key, Object.freeze({
        ...base, legLength: base.legLength ?? base.y,
        handScale: MAIN_LIMB_REFERENCE[key]?.[0] ?? 1, // Only the explicit restore action writes hands.
        footScale: MAIN_LIMB_REFERENCE[key]?.[1] ?? 1, // Only the explicit restore action writes feet.
      }),
    ]),
  ));

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
    mainSilhouetteRestoreValues: MAIN_SILHOUETTE_RESTORE, // Opt-in, non-destructive-to-age reference for already persisted local adult authoring.
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
