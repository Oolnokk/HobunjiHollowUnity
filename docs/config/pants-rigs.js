// Authored pants-rig data. The Pants Rig Author exports this schema.
// Garments stay empty until a pants PNG has been authored; character entries are
// created by the authoring tool as each species/gender beltline is drawn.
(function (global) {
  'use strict';

  const existing = global.HOBUNJI_PANTS_RIGS; // Preserves a page-local override when a tool intentionally loaded one first.
  global.HOBUNJI_PANTS_RIGS = existing && typeof existing === 'object'
    ? existing
    : {
        schema: 'hobunji.pants-rigs.v1',
        garments: {},
        characters: {},
      };
})(typeof window !== 'undefined' ? window : globalThis);
