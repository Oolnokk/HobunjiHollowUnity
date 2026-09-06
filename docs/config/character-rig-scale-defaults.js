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

  const VERSION = 6; // Latest user-authored Full Character Scale defaults, 2026-09-05; non-Mashtzarr raw-PNG Head is 75%.
  const VALUES = Object.freeze({
    'tletingan::male': Object.freeze({ x: 0.85, y: 0.85, head: 0.8823529411764706, offsetY: 0 }),
    'tletingan::female': Object.freeze({ x: 0.915, y: 0.89, head: 0.8823529411764706, offsetY: 0 }),
    'engh-sho::male': Object.freeze({ x: 0.8, y: 0.845, head: 0.7894736842105263, offsetY: 0 }),
    'engh-sho::female': Object.freeze({ x: 0.795, y: 0.81, head: 0.7894736842105263, offsetY: 0 }),
    'mao-ao::male': Object.freeze({ x: 1.125, y: 1.125, head: 0.75, offsetY: 0 }),
    'mao-ao::female': Object.freeze({ x: 1.045, y: 1.045, head: 0.9375, offsetY: 0 }),
    'kenkari::male': Object.freeze({ x: 1.225, y: 1.225, head: 1, offsetY: 0 }),
    'kenkari::female': Object.freeze({ x: 1.1, y: 1.1, head: 1, offsetY: 0 }),
    'mashtzarr::male': Object.freeze({ x: 0.955, y: 1.255, head: 0.9856, offsetY: -0.095 }),
    'mashtzarr::female': Object.freeze({ x: 1.01, y: 0.99, head: 0.8475, offsetY: -0.02 }),
  });
  const ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' }); // Transform-equivalent NPC-only species inherit the same full-rig defaults.

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
