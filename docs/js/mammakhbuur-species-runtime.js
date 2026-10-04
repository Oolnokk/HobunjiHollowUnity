// Mammakhbuur reuse the authored Mashtzarr anatomy; only the canonical whole-rig height differs by 5%.
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
    debugSnapshot: () => ({ speciesId: ID, parentSpecies: DONOR, rigHeightMultiplier: 1.05, rigWidthMultiplier: 1, headScaleMultiplier: 1, verticalPlacementMultiplier: 1, latestChange: 'Mammakhbuur use Mashtzarr appearance and anatomy with only 5% extra whole-rig height.' }),
  });
})();
