// Nuhongan are Tletingan-derived Slagothim: identical authored anatomy/assets,
// with their distinct proportions supplied only by character-rig-scale-defaults.js.
(() => {
  'use strict';

  const ID = 'nuhongan'; // Used as the distinct runtime/editor species id so Nuhongan keep their own whole-rig scale.
  const DONOR = 'tletingan'; // Used wherever Nuhongan inherit Tletingan appearance, attachment, hand and foot data.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value)); // Used to copy donor records without mutating Tletingan data.
  const config = window.SCRATCHBONES_CONFIG?.game; // Used below to extend shared appearance and avatar-asset registries.
  const appearance = config?.appearanceEditor; // Used to expose Nuhongan anywhere the normal appearance-editor species table is consumed.

  if (appearance?.species?.[DONOR]) {
    const donorSpecies = clone(appearance.species[DONOR]); // Used as the exact appearance/cosmetic basis for Nuhongan.
    appearance.species[ID] = {
      ...donorSpecies,
      label: 'Nuhongan',
      parentSpecies: DONOR,
      genders: clone(donorSpecies.genders || ['male', 'female']),
    };
  }
  if (appearance?.bodyPalettes?.[DONOR]) appearance.bodyPalettes[ID] = clone(appearance.bodyPalettes[DONOR]);

  const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters; // Used to give Nuhongan exact Tletingan attachment coordinates under their own species key.
  for (const gender of ['male', 'female']) {
    const source = characters?.[`${DONOR}::${gender}`]; // Used as the same-gender Tletingan rig donor.
    if (!source) continue;
    const profile = clone(source); // Used as an independent Nuhongan profile so later authoring cannot mutate Tletingan.
    profile.species = ID;
    profile.gender = gender;
    if (profile.shoulderPerchRule) profile.shoulderPerchRule.appearanceSpeciesId = ID;
    if (profile.posteriorRule) profile.posteriorRule.appearanceSpeciesId = ID;
    profile.anatomy ||= {};
    for (const key of ['rigScale', 'rigScaleX', 'rigScaleY', 'headScale', 'headOffsetY']) delete profile.anatomy[key];
    characters[`${ID}::${gender}`] = profile;
  }

  const feet = config?.assets?.pngPlaneAvatar?.proceduralFeet; // Used to inherit every Tletingan foot asset/calibration table without a second body scale.
  for (const table of Object.values(feet || {})) {
    if (table && typeof table === 'object' && table[DONOR] != null) table[ID] = clone(table[DONOR]);
  }

  window.HobunjiHandModelProfiles?.mutate?.(data => {
    data.speciesModels ||= {};
    if (data.speciesModels[DONOR]) data.speciesModels[ID] = data.speciesModels[DONOR];
  });

  window.applyHobunjiAttachmentRigProfileCorrections?.();

  window.HobunjiNuhonganSpecies = Object.freeze({
    speciesId: ID,
    parentSpecies: DONOR,
    debugSnapshot: () => ({
      speciesId: ID,
      parentSpecies: DONOR,
      rigHeightMultiplier: 0.75,
      rigWidthMultiplier: 0.8,
      headScaleMultiplier: 1,
      inheritedAppearance: !!appearance?.species?.[ID],
      inheritedMaleRig: !!characters?.[`${ID}::male`],
      inheritedFemaleRig: !!characters?.[`${ID}::female`],
      latestChange: 'Nuhongan inherit Tletingan anatomy/assets while rendering at 75% Tletingan height and 80% Tletingan width.',
    }),
  });
})();
