(() => {
  'use strict';

  // Central visual/performance config for opaque natural scenery that should
  // use authored, unlit PNG shading instead of realtime Lambert lighting.
  //
  // mapping values:
  //   cylindrical-stretch — one 0..1 wrap over the whole trunk/vine mesh
  //   planar-stretch      — one 0..1 projection over the whole rock mesh
  //   world-stretch       — preserve terrain world UVs but fit the PNG once
  //                         across each generated cliff/mesa mesh
  //
  // tint: 'source' preserves the generator's authored color family; '#rrggbb'
  // supplies a fixed family. body-sprite-tint sends the authored PNG through
  // the same per-pixel body fill path used by character art and the rock/cliff
  // surfaces, then renders it unlit/white so there is no second multiplication.
  window.NaturalSurfaceMaterialConfig = {
    schema: 'hobunji_natural_surface_materials.v1',
    texture: 'assets/textures/carved_smooth.png',
    surfaces: {
      trunks: {
        enabled: true,
        texture: 'assets/textures/wibbly_surface.png',
        tint: 'source',
        // Match rocks' body-sprite PNG tint + unlit render path; trunks keep
        // cylindrical UVs because their geometry wraps around an axis.
        tintTreatment: 'body-sprite-tint',
        mapping: 'cylindrical-stretch'
      },
      vines: {
        enabled: true,
        texture: 'assets/textures/carved_smooth.png',
        tint: 'source',
        tintTreatment: 'body-sprite-tint',
        mapping: 'cylindrical-stretch'
      },
      rocks: {
        enabled: true,
        tint: '#808080',
        tintTreatment: 'body-sprite-tint',
        mapping: 'planar-stretch'
      },
      cliffs: {
        enabled: true,
        tint: '#808080',
        tintTreatment: 'body-sprite-tint',
        mapping: 'world-stretch'
      }
    }
  };
})();
