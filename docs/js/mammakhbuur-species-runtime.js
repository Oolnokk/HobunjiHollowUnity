// Mammakhbuur reuse the authored Mashtzarr anatomy; size and vertical placement are the only current differences.
(() => {
  'use strict';
  const ID = 'mammakhbuur'; // Shared species identity for player/NPC appearance, scale and attachment registries.
  const DONOR = 'mashtzarr'; // Authored cosmetic, palette, hand/foot and anatomy authority.
  const clone = value => JSON.parse(JSON.stringify(value)); // Copies donor data so edits never mutate Mashtzarr definitions.
  const config = window.SCRATCHBONES_CONFIG?.game; // All installed aliases use the existing runtime registries.
  const appearance = config?.appearanceEditor; // Adds the species to the ordinary editor and creator palette registries.
  if (appearance?.species?.[DONOR]) appearance.species[ID] = { ...clone(appearance.species[DONOR]), label: 'Mammakhbuur', parentSpecies: DONOR, genders: ['male', 'female'] };
  if (appearance?.bodyPalettes?.[DONOR]) appearance.bodyPalettes[ID] = clone(appearance.bodyPalettes[DONOR]);
  const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Same profile library consumed by hands, feet, posterior and rig tools.
  for (const gender of ['male', 'female']) {
    const source = characters?.[`${DONOR}::${gender}`]; // Reads the fully corrected donor profile after the authored snapshot loads.
    if (!source) continue;
    const profile = clone(source); // Keeps local anatomy independent of the donor.
    profile.species = ID;
    profile.gender = gender;
    if (profile.shoulderPerchRule) profile.shoulderPerchRule.appearanceSpeciesId = ID;
    if (profile.posteriorRule) profile.posteriorRule.appearanceSpeciesId = ID;
    profile.anatomy ||= {};
    for (const key of ['rigScale', 'rigScaleX', 'rigScaleY', 'headScale']) delete profile.anatomy[key];
    const priorRatio = Number(profile.anatomy.portraitVerticalPlacementRatio) || 1; // Used to raise portrait placement by 25% while preserving the donor's shoulder spacing.
    profile.anatomy.portraitVerticalPlacementRatio = priorRatio * 1.25;
    if (profile.shoulderPerchRule) profile.shoulderPerchRule.portraitVerticalPlacementRatio = priorRatio * 1.25;
    const height = Number(profile.shoulderPerchRule?.portraitModelHeight) || 1; // Converts the placement-ratio increase into local anchor displacement.
    for (const [key, anchor] of Object.entries(profile.anchors || {})) {
      if (key !== 'posterior' && Number.isFinite(anchor.position?.y)) anchor.position.y += height * priorRatio * .25;
    }
    characters[`${ID}::${gender}`] = profile;
  }
  const feet = config?.assets?.pngPlaneAvatar?.proceduralFeet; // Donates foot models and their authored per-gender calibration, without adding a second parent scale.
  for (const table of Object.values(feet || {})) if (table && typeof table === 'object' && table[DONOR]) table[ID] = clone(table[DONOR]);
  window.HobunjiHandModelProfiles?.mutate?.(data => {
    data.speciesModels ||= {};
    if (data.speciesModels[DONOR]) data.speciesModels[ID] = data.speciesModels[DONOR];
  });
  window.applyHobunjiAttachmentRigProfileCorrections?.();
  window.HobunjiMammakhbuurSpecies = Object.freeze({
    speciesId: ID, parentSpecies: DONOR,
    debugSnapshot: () => ({ speciesId: ID, parentSpecies: DONOR, rigScaleMultiplier: 1.25, verticalPlacementMultiplier: 1.25, latestChange: 'Playable/NPC Mammakhbuur inherit Mashtzarr with 25% larger rigs and 25% higher portrait placement; authored heads fall back to Mashtzarr.' }),
  });
})();
