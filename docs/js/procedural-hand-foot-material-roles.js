// Reuses the proven procedural-foot GLB material-slot mapping for hand GLBs
// exported from the same source projects. The live foot config is authoritative;
// the fallback table below mirrors it exactly for nested tools that happen to load
// the hand bootstrap before SCRATCHBONES_CONFIG is available.
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

  profiles.mutate(data => {
    for (const [modelKey, speciesId] of Object.entries(correspondingFootSpecies)) {
      const model = data.models?.[modelKey];
      if (!model) continue;
      const footRoles = feet?.[speciesId]?.materialRoles || fallbackRoles[modelKey];
      model.materialRoles = {
        ...(model.materialRoles || {}),
        ...(footRoles || {}),
      };
    }

    // Kenkari-family feet are procedural rather than GLB-backed, so there is no
    // foot material table to inherit. Keep the hand export's known aliases while
    // also accepting the same generic Mat 1 / Mat 2 naming used by the other
    // source projects.
    const parrot = data.models?.parrot;
    if (parrot) {
      parrot.materialRoles = {
        ...(parrot.materialRoles || {}),
        'Mat 1': 'body',
        'Mat 2': 'keratin',
      };
    }
  });

  global.ProceduralHandFootMaterialRoles = Object.freeze({
    correspondingFootSpecies: { ...correspondingFootSpecies },
    fallbackRoles: JSON.parse(JSON.stringify(fallbackRoles)),
  });
})(window);
