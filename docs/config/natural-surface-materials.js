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
  // supplies a fixed family. ground-shade-fill is the same PNG recolor path as
  // textured terrain grass: getShadeFillCanvas() bakes the target color into a
  // CanvasTexture while preserving the PNG's grain/shading, then the unlit
  // material renders white so there is no second color multiplication.
  window.NaturalSurfaceMaterialConfig = {
    schema: 'hobunji_natural_surface_materials.v1',
    texture: 'assets/textures/carved_smooth.png',
    surfaces: {
      trunks: {
        enabled: true,
        tint: 'source',
        tintTreatment: 'ground-shade-fill',
        mapping: 'cylindrical-stretch'
      },
      vines: {
        enabled: true,
        tint: 'source',
        tintTreatment: 'ground-shade-fill',
        mapping: 'cylindrical-stretch'
      },
      rocks: {
        enabled: true,
        tint: '#5f5a56',
        tintTreatment: 'grass-luminance',
        mapping: 'planar-stretch'
      },
      cliffs: {
        enabled: true,
        tint: '#6a6460',
        tintTreatment: 'grass-luminance',
        mapping: 'world-stretch'
      }
    }
  };
})();
