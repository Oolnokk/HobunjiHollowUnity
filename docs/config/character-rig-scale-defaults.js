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

  const VERSION = 35; // 2026-11-25: user-uploaded 26-profile Full Character Scale export is the approved adult baseline.
  const NUHONGAN_PART_SCALE_AXES = Object.freeze({ x: 31 / 24, y: 31 / 24, z: 31 / 24 }); // Mean of prior inverse 0.8/0.75 adjustments: keep donor-sized extremities without stretching one axis.
  const NUHONGAN_HAND_SCALE_AXES = Object.freeze({ x: 31 / 24 * 0.88, y: 31 / 24 * 0.88, z: 31 / 24 * 0.88 }); // Nov 22: Nuhongan hands a little smaller (88%) than the shared extremity size; feet keep NUHONGAN_PART_SCALE_AXES.
  // Longoran extremities are thinner, never shorter (lanky look). Axes are in the
  // character floor frame: hands hang along y (length), feet point along z (length).
  const LONGORAN_HAND_SCALE_AXES = Object.freeze({ x: 0.72, y: 1, z: 0.8 });
  const LONGORAN_FOOT_SCALE_AXES = Object.freeze({ x: 0.7, y: 0.85, z: 1 });
  // Original main parity was a historical checkpoint; the newer uploaded JSON is now authoritative.
  const VALUES = Object.freeze({ // Exact 18 canonical species/gender adults from the uploaded Full Character Scale export (3).
    'kenkari::male': Object.freeze({"x":1.225,"y":1.225,"legLength":1.225,"head":1,"offsetY":0}),
    'kenkari::female': Object.freeze({"x":1.1,"y":1.1,"legLength":1.1,"head":1,"offsetY":0}),
    'tletingan::male': Object.freeze({"x":0.85,"y":0.85,"legLength":0.85,"head":0.8,"offsetY":0}),
    'tletingan::female': Object.freeze({"x":0.915,"y":0.89,"legLength":0.89,"head":0.8824,"offsetY":0}),
    'nuhongan::male': Object.freeze({"x":0.68,"y":0.6375,"legLength":0.6375,"head":0.8,"offsetY":0}),
    'nuhongan::female': Object.freeze({"x":0.732,"y":0.6675,"legLength":0.6675,"head":0.8824,"offsetY":0}),
    'longoran::male': Object.freeze({"x":1.015,"y":2.45,"legLength":2.45,"head":1,"offsetY":-0.055}),
    'longoran::female': Object.freeze({"x":1.1303,"y":2.78,"legLength":2.78,"head":1.064,"offsetY":-0.055}),
    'engh-sho::male': Object.freeze({"x":0.7,"y":0.725,"legLength":0.725,"head":0.7895,"offsetY":0}),
    'engh-sho::female': Object.freeze({"x":0.745,"y":0.765,"legLength":0.765,"head":0.7895,"offsetY":0}),
    'mao-ao::male': Object.freeze({"x":0.8168,"y":1.089,"legLength":1.089,"head":0.726,"offsetY":0}),
    'mao-ao::female': Object.freeze({"x":0.895,"y":0.94,"legLength":0.94,"head":0.7813,"offsetY":0}),
    'mashtzarr::male': Object.freeze({"x":0.955,"y":1.255,"legLength":1.255,"head":0.9856,"offsetY":-0.095}),
    'mashtzarr::female': Object.freeze({"x":1.01,"y":0.99,"legLength":0.99,"head":0.8475,"offsetY":-0.02}),
    'mammakhbuur::male': Object.freeze({"x":0.96,"y":1.69,"legLength":1.69,"head":0.9771,"offsetY":-0.095}),
    'mammakhbuur::female': Object.freeze({"x":1.0153,"y":1.3331,"legLength":1.3331,"head":0.8402,"offsetY":-0.02}),
    'harlyao::male': Object.freeze({"x":0.96,"y":1.014,"legLength":1.014,"head":0.9474,"offsetY":0}),
    'harlyao::female': Object.freeze({"x":0.954,"y":0.972,"legLength":0.972,"head":0.9474,"offsetY":0}),
  });
  const UPLOADED_AUXILIARY_SILHOUETTES = Object.freeze({ // The other eight authored actors share the same restored import source.
    'boney-shinjimi-skeleton::male': Object.freeze({"x":1,"y":1,"legLength":1,"head":1,"offsetY":0}),
    'harlyao-skeleton::male': Object.freeze({"x":0.96,"y":1.014,"legLength":1.014,"head":0.9474,"offsetY":0}),
    'harlyao-skeleton::female': Object.freeze({"x":0.954,"y":0.972,"legLength":0.972,"head":0.9474,"offsetY":0}),
    'mao-ao-skeleton::male': Object.freeze({"x":0.8168,"y":1.089,"legLength":1.089,"head":0.726,"offsetY":0}),
    'maskbound-guardian::male': Object.freeze({"x":1,"y":1,"legLength":1,"head":1,"offsetY":0}),
    'nohuknuk::male': Object.freeze({"x":1,"y":1,"legLength":1,"head":1,"offsetY":0}),
    'omgurku::male': Object.freeze({"x":1,"y":1,"legLength":1,"head":1,"offsetY":0}),
    'porakaneki::male': Object.freeze({"x":1,"y":1,"legLength":1,"head":1,"offsetY":0}),
  });
  const UPLOADED_LIMB_REFERENCE = Object.freeze({ // Imported hand/foot percentages, not species-inferred averages.
    'kenkari::male': Object.freeze([1, 1]),
    'kenkari::female': Object.freeze([0.93, 1]),
    'tletingan::male': Object.freeze([0.95, 0.95]),
    'tletingan::female': Object.freeze([0.925, 1.025]),
    'nuhongan::male': Object.freeze([0.95, 0.95]),
    'nuhongan::female': Object.freeze([0.925, 1.025]),
    'longoran::male': Object.freeze([0.95, 0.95]),
    'longoran::female': Object.freeze([0.925, 1.025]),
    'engh-sho::male': Object.freeze([1.45, 1.25]),
    'engh-sho::female': Object.freeze([1.3, 1.17]),
    'mao-ao::male': Object.freeze([1.1, 1.3125]),
    'mao-ao::female': Object.freeze([1, 1.2813]),
    'mashtzarr::male': Object.freeze([1, 1.175]),
    'mashtzarr::female': Object.freeze([0.95, 1]),
    'mammakhbuur::male': Object.freeze([1, 1.175]),
    'mammakhbuur::female': Object.freeze([0.95, 1]),
    'boney-shinjimi-skeleton::male': Object.freeze([1.2, 1.05]),
    'harlyao::male': Object.freeze([1.45, 1.25]),
    'harlyao::female': Object.freeze([1.3, 1.17]),
    'harlyao-skeleton::male': Object.freeze([1.45, 1.25]),
    'harlyao-skeleton::female': Object.freeze([1.3, 1.17]),
    'mao-ao-skeleton::male': Object.freeze([1.1, 1.3125]),
    'maskbound-guardian::male': Object.freeze([1.2, 1.05]),
    'nohuknuk::male': Object.freeze([1, 1]),
    'omgurku::male': Object.freeze([1.45, 1.25]),
    'porakaneki::male': Object.freeze([1, 1]),
  });
  const UPLOADED_SCALE_RESTORE = Object.freeze(Object.fromEntries(
    Object.entries({ ...VALUES, ...UPLOADED_AUXILIARY_SILHOUETTES }).map(([key, body]) => [
      key, Object.freeze({ ...body, handScale: UPLOADED_LIMB_REFERENCE[key][0], footScale: UPLOADED_LIMB_REFERENCE[key][1] }),
    ]),
  )); // Used when migrating existing local overrides; leaves unrelated age-stage and per-NPC posture settings alone.

  const ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao', 'harlyao-skeleton': 'harlyao', 'mao-ao-skeleton': 'mao-ao' }); // Transform-equivalent NPC-only species inherit shared full-rig defaults; Harlyao Skeleton deliberately shares Harlyao's 1.2x Engh-sho scale.
  const MAOAO_FOOT_SCALE = Object.freeze({ male: 1.3125, female: 1.2813 }); // Exact uploaded Mao'ao foot scales for gameplay as well as authoring.

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
    uploadedScaleRestoreValues: UPLOADED_SCALE_RESTORE, // All 26 user-approved adult scale+limb values for importing and stale-save migration.
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
