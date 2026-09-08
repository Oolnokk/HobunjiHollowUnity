// Species + gender anatomy used by the Procedural Animation editor's ground/rest
// poses and awkward-upright carry style. Limb lengths remain owned by the
// canonical attachment rig/procedural leg system; this file only supplies the
// missing elbow split and body/limb thickness used for IK clearance/guides.
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({ // Fallback proportions used by any canonical species/gender that has not been tuned yet.
    upperArmFraction: 0.52,
    upperArmRadiusHeightFraction: 0.045,
    forearmRadiusHeightFraction: 0.038,
    thighRadiusHeightFraction: 0.065,
    calfRadiusHeightFraction: 0.052,
    torsoRadiusHeightFraction: 0.155,
  });

  const CHARACTER_OVERRIDES = Object.freeze({ // Canonical rigs only; transform aliases resolve live instead of copying numbers that can later drift.
    'kenkari::male': { upperArmRadiusHeightFraction: 0.034, forearmRadiusHeightFraction: 0.029, thighRadiusHeightFraction: 0.050, calfRadiusHeightFraction: 0.041, torsoRadiusHeightFraction: 0.125 },
    'kenkari::female': { upperArmRadiusHeightFraction: 0.032, forearmRadiusHeightFraction: 0.027, thighRadiusHeightFraction: 0.047, calfRadiusHeightFraction: 0.039, torsoRadiusHeightFraction: 0.118 },
    'mao-ao::male': { upperArmRadiusHeightFraction: 0.044, forearmRadiusHeightFraction: 0.037, thighRadiusHeightFraction: 0.064, calfRadiusHeightFraction: 0.052, torsoRadiusHeightFraction: 0.158 },
    'mao-ao::female': { upperArmRadiusHeightFraction: 0.041, forearmRadiusHeightFraction: 0.034, thighRadiusHeightFraction: 0.060, calfRadiusHeightFraction: 0.049, torsoRadiusHeightFraction: 0.148 },
    'engh-sho::male': { upperArmRadiusHeightFraction: 0.052, forearmRadiusHeightFraction: 0.045, thighRadiusHeightFraction: 0.077, calfRadiusHeightFraction: 0.062, torsoRadiusHeightFraction: 0.190 },
    'engh-sho::female': { upperArmRadiusHeightFraction: 0.049, forearmRadiusHeightFraction: 0.042, thighRadiusHeightFraction: 0.073, calfRadiusHeightFraction: 0.059, torsoRadiusHeightFraction: 0.180 },
    'tletingan::male': { upperArmRadiusHeightFraction: 0.041, forearmRadiusHeightFraction: 0.035, thighRadiusHeightFraction: 0.061, calfRadiusHeightFraction: 0.050, torsoRadiusHeightFraction: 0.150 },
    'tletingan::female': { upperArmRadiusHeightFraction: 0.039, forearmRadiusHeightFraction: 0.033, thighRadiusHeightFraction: 0.058, calfRadiusHeightFraction: 0.047, torsoRadiusHeightFraction: 0.142 },
    'mashtzarr::male': { upperArmRadiusHeightFraction: 0.050, forearmRadiusHeightFraction: 0.042, thighRadiusHeightFraction: 0.072, calfRadiusHeightFraction: 0.058, torsoRadiusHeightFraction: 0.180 },
    'mashtzarr::female': { upperArmRadiusHeightFraction: 0.047, forearmRadiusHeightFraction: 0.040, thighRadiusHeightFraction: 0.069, calfRadiusHeightFraction: 0.055, torsoRadiusHeightFraction: 0.170 },
  });

  const FALLBACK_ALIASES = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' }); // Keeps known subspecies linked even if attachment-rig-profiles.js has not loaded yet.

  function normalizeSpecies(value) { // Matches attachment-rig keys when resolving the current preview avatar.
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) { // Collapses editor/runtime gender aliases to the two authored rig keys.
    return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  }

  function canonicalSpecies(value) { // Reuses the repository's live transform alias table so subspecies never fork anatomy tuning accidentally.
    const species = normalizeSpecies(value); // Normalized key queried against the canonical transform aliases below.
    const aliases = window.HOBUNJI_TRANSFORM_SPECIES_ALIASES || FALLBACK_ALIASES; // Live attachment-rig aliases win when available.
    return normalizeSpecies(aliases[species] || FALLBACK_ALIASES[species] || species);
  }

  function resolve(speciesId, gender) { // Produces a complete editable profile for the pose author.
    const species = canonicalSpecies(speciesId); // Canonical species keeps Ghoul/Mao-ao and Rakakoan/Kenkari values linked.
    const sex = normalizeGender(gender); // Used with species to select the matching thickness overrides.
    const key = `${species}::${sex}`; // Stable canonical lookup key shared with attachment-rig profiles.
    return { ...DEFAULTS, ...(CHARACTER_OVERRIDES[key] || {}) };
  }

  window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES = Object.freeze({
    version: 2,
    defaults: DEFAULTS,
    characters: CHARACTER_OVERRIDES,
    canonicalSpecies,
    resolve,
  });
})();