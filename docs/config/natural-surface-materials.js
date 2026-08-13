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
  // tint: 'source' preserves the generator's existing color family. For
  // textured bark/vines, sourceTintMode:'hue-only' normalizes away the old
  // Lambert brightness so carved_smooth.png supplies the light/dark shading.
  // tintTreatment:'grass-luminance' applies the same luminance-preserving
  // recolor used by grass billboards: texture value/shading survives while
  // the configured/source tint supplies the color. Use '#rrggbb' to override
  // source hue. Set enabled:false to fall back to the original renderer/material.
  window.NaturalSurfaceMaterialConfig = {
    schema: 'hobunji_natural_surface_materials.v1',
    texture: 'assets/textures/carved_smooth.png',
    surfaces: {
      trunks: {
        enabled: true,
        tint: 'source',
        sourceTintMode: 'hue-only',
        tintTreatment: 'grass-luminance',
        mapping: 'cylindrical-stretch'
      },
      vines: {
        enabled: true,
        tint: 'source',
        sourceTintMode: 'hue-only',
        tintTreatment: 'grass-luminance',
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
