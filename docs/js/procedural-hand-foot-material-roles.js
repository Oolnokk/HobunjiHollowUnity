// Reuses the proven procedural-foot GLB material-slot mapping for hand GLBs
// exported from the same source projects. The live foot config is authoritative;
// the fallback table mirrors it for nested tools, while handExportAliases maps the
// actual hand-export material names onto those same source-project slots.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const feet = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.species || {};
  if (!profiles?.data?.models) return;

  const correspondingFootSpecies = {
    pachyderm: 'mashtzarr',
    sloth: 'tletingan',
    feline: 'mao-ao',
  };
  const fallbackRoles = {
    pachyderm: { 'Mat 1': 'bone', 'Mat 2': 'body' },
    sloth: { 'Mat 1': 'bone', 'Mat 2': 'body' },
    feline: { 'Mat 1': 'body' },
  };

  // These are the material names currently present in the hand GLB exports.
  // The hands were exported from the same source projects as the corresponding
  // feet, so preserve slot meaning rather than the old provisional role guesses:
  // slot 1 = bone and slot 2 = body for pachyderm/sloth, slot 1 = body for feline.
  const handExportAliases = {
    pachyderm: {
      MAT_None_7a4e2e: 'bone',
      MAT_EyeSurface_0c0c0c: 'body',
    },
    sloth: {
      MAT_None_7a4e2e: 'bone',
      MAT_EyeSurface_0c0c0c: 'body',
    },
    feline: {
      MAT_None_7a4e2e: 'body',
    },
    parrot: {
      MAT_None_7a4e2e: 'keratin',
      MAT_EyeSurface_0c0c0c: 'body',
    },
  };

  profiles.mutate(data => {
    for (const [modelKey, speciesId] of Object.entries(correspondingFootSpecies)) {
      const model = data.models?.[modelKey];
      if (!model) continue;
      const footRoles = feet?.[speciesId]?.materialRoles || fallbackRoles[modelKey];
      model.materialRoles = {
        ...(model.materialRoles || {}),
        ...(footRoles || {}),
        ...(handExportAliases[modelKey] || {}),
      };
    }

    // Kenkari-family feet are procedural rather than GLB-backed, so there is no
    // foot GLB table to inherit. Their two parrot-hand slots are intentionally
    // flipped here: slot 1/None uses keratin, while slot 2/EyeSurface is the
    // body-colored wing continuation that the portrait clothing layer occludes.
    const parrot = data.models?.parrot;
    if (parrot) {
      parrot.materialRoles = {
        ...(parrot.materialRoles || {}),
        'Mat 1': 'keratin',
        'Mat 2': 'body',
        ...handExportAliases.parrot,
      };
    }
  });

  global.ProceduralHandFootMaterialRoles = Object.freeze({
    correspondingFootSpecies: { ...correspondingFootSpecies },
    fallbackRoles: JSON.parse(JSON.stringify(fallbackRoles)),
    handExportAliases: JSON.parse(JSON.stringify(handExportAliases)),
  });
})(window);
