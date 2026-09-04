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
// head/head-cosmetic/expression proportions. A fresh install has x/y/head all
// equal to the old single rigScale value per species+gender, so nothing looks
// different until someone actually pulls an axis apart.
//
// headOffsetY is a separate, additive vertical nudge for the head — a
// fraction of the avatar's own model height (0 = authored position, negative
// = lower/more hunched, positive = higher) — authored per species+gender and
// composed at runtime with a separate per-NPC "age" value that can lower it
// further for a hunched-over look (see ageHunchFraction in
// character-rig-scale.js). Defaults to 0 for every species+gender: no visual
// change until it's actually authored.
(() => {
  'use strict';

  const VERSION = 2; // Used by diagnostics/tests to identify this authored default set.
  const LEGACY_UNIFORM_VALUES = Object.freeze({ // The pre-split authored rigScale, kept as the shared starting point for x/y/head below.
    'tletingan::male': 0.85,
    'tletingan::female': 0.8,
    'engh-sho::male': 0.84,
    'engh-sho::female': 0.8,
    'mao-ao::male': 1.125,
    'mao-ao::female': 1.045,
    'kenkari::male': 1.225,
    'kenkari::female': 1.1,
    'mashtzarr::male': 1.27,
    'mashtzarr::female': 1.095,
  });
  const VALUES = Object.freeze(Object.fromEntries( // Used by game/runtime and Animation Author whenever a profile has no explicit override for a given axis.
    Object.entries(LEGACY_UNIFORM_VALUES).map(([key, uniform]) => [key, Object.freeze({ x: uniform, y: uniform, head: uniform, offsetY: 0 })])
  ));
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
