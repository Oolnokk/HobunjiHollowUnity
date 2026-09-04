// Canonical default whole-character scales authored in Animation Author's
// Full Character Scale comparison. These are visual-rig multipliers around the
// floor-relative character parent; they do not rewrite portrait/body/hand/foot
// local coordinates.
(() => {
  'use strict';

  const VERSION = 1; // Used by diagnostics/tests to identify this authored default set.
  const VALUES = Object.freeze({ // Used by game/runtime and Animation Author whenever a profile has no explicit rigScale override.
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
  const ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' }); // Used so transform-equivalent NPC-only species inherit the same full-rig defaults.

  const normalizeSpecies = value => {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return ALIASES[raw] || raw;
  };
  const normalizeGender = value => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  };
  const scaleFor = (species, gender) => VALUES[`${normalizeSpecies(species)}::${normalizeGender(gender)}`] ?? 1;

  window.HOBUNJI_CHARACTER_RIG_SCALE_DEFAULTS = VALUES;
  window.HobunjiCharacterRigScaleDefaults = Object.freeze({
    version: VERSION,
    coordinateSpace: 'character-floor-parent',
    values: VALUES,
    aliases: ALIASES,
    scaleFor,
  });
})();
