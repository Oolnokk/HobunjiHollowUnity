// Canonical default whole-character scales authored in Animation Author's
// Full Character Scale comparison. These are visual-rig multipliers around the
// floor-relative character parent; they do not rewrite portrait/body/hand/foot
// local coordinates.
//
// Body width (x) and height (y) can be tuned independently of one another —
// e.g. a wider silhouette without also growing taller. Head is a separate
// uniform factor: the neck rig bone compensates it against whatever the body
// axes are doing (see applyHeadCompensation in character-rig-scale.js), so
// stretching the body's aspect ratio never distorts the meticulously authored
// head/head-cosmetic/expression proportions.
//
// headOffsetY is a separate, additive vertical nudge for the head — a
// fraction of the avatar's own model height (0 = authored position, negative
// = lower/more hunched, positive = higher) — authored per species+gender and
// composed at runtime with a separate per-NPC "age" value that can lower it
// further for a hunched-over look (see ageHunchFraction in
// character-rig-scale.js).
(() => {
  'use strict';

  const VERSION = 4; // Used by diagnostics/tests to identify this authored default set — bumped for the latest Full Character Scale export.
  // Hand-authored via Full Character Scale (exportJson's own {species: {gender: {x,y,head,offsetY}}} shape) and imported directly.
  const VALUES = Object.freeze({
    'tletingan::male': Object.freeze({ x: 0.85, y: 0.85, head: 0.85, offsetY: 0 }),
    'tletingan::female': Object.freeze({ x: 0.915, y: 0.89, head: 0.92, offsetY: 0 }),
    'engh-sho::male': Object.freeze({ x: 0.8, y: 0.845, head: 0.94, offsetY: 0 }),
    'engh-sho::female': Object.freeze({ x: 0.795, y: 0.765, head: 0.86, offsetY: 0 }),
    'mao-ao::male': Object.freeze({ x: 1.125, y: 1.125, head: 1.02, offsetY: 0 }),
    'mao-ao::female': Object.freeze({ x: 1.045, y: 1.045, head: 1.045, offsetY: 0 }),
    'kenkari::male': Object.freeze({ x: 1.225, y: 1.225, head: 1.085, offsetY: 0 }),
    'kenkari::female': Object.freeze({ x: 1.1, y: 1.1, head: 1.1, offsetY: 0 }),
    'mashtzarr::male': Object.freeze({ x: 0.95, y: 1.255, head: 1.01, offsetY: -0.1 }),
    'mashtzarr::female': Object.freeze({ x: 1.01, y: 1.095, head: 0.91, offsetY: -0.1 }),
  });
  const ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' }); // Used so transform-equivalent NPC-only species inherit the same full-rig defaults.

  const normalizeSpecies = value => {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return ALIASES[raw] || raw;
  };
  const normalizeGender = value => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  };
  const scaleFor = (species, gender) => VALUES[`${normalizeSpecies(species)}::${normalizeGender(gender)}`] || { x: 1, y: 1, head: 1, offsetY: 0 };
  const uniformScaleFor = (species, gender) => scaleFor(species, gender).x; // Back-compat for any reader that only ever wanted one number (the pre-split behavior).

  window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS = VALUES;
  window.HobunjiCharacterRigScaleDefaults = Object.freeze({
    version: VERSION,
    coordinateSpace: 'character-floor-parent',
    values: VALUES,
    aliases: ALIASES,
    scaleFor,
    uniformScaleFor,
  });
})();
