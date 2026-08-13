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
  // tint: 'source' preserves the generator's existing material color; use a
  // '#rrggbb' value to override it. Set enabled:false for a surface to fall
  // back to its original renderer/material without changing the generator.
  window.NaturalSurfaceMaterialConfig = {
    schema: 'hobunji_natural_surface_materials.v1',
    texture: 'assets/textures/carved_smooth.png',
    surfaces: {
      trunks: {
        enabled: true,
        tint: 'source',
        mapping: 'cylindrical-stretch'
      },
      vines: {
        enabled: true,
        tint: 'source',
        mapping: 'cylindrical-stretch'
      },
      rocks: {
        enabled: true,
        tint: '#5f5a56',
        mapping: 'planar-stretch'
      },
      cliffs: {
        enabled: true,
        tint: '#6a6460',
        mapping: 'world-stretch'
      }
    }
  };
})();
