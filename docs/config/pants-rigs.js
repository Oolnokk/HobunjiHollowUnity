// Authored pants-rig data. The Pants Rig Author exports this schema.
(function (global) {
  'use strict';

  const existing = global.HOBUNJI_PANTS_RIGS; // Preserves a page-local override when a tool intentionally loaded one first.
  global.HOBUNJI_PANTS_RIGS = existing && typeof existing === 'object'
    ? existing
    : {
        schema: 'hobunji.pants-rigs.v1',
        garments: {
          pants_basic: {
            image: 'assets/cosmetics/clothes/legs/pants_basic.png',
            sourceSize: { width: 0, height: 0 },
          },
        },
        characters: {},
      };
})(typeof window !== 'undefined' ? window : globalThis);
