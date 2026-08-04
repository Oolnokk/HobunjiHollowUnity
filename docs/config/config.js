// Shared terrain/editor tuning. Loaded before terrain-preview.js and game.js.
(function (root) {
  'use strict';
  const plateauVerticalUnit = 2.5;
  root.HOBUNJI_CONFIG = Object.freeze({
    terrain: Object.freeze({
      plateauVerticalUnit,
      // visualHeights stores normalized values. Keep its full displacement
      // strictly below one gameplay cliff tier.
      subtleHeightMaxDisplacement: plateauVerticalUnit * 0.24,
      subtleHeightMin: -1,
      subtleHeightMax: 1,
      subtleHeightDefault: 0,
      subtleHeightMaxNeighborDelta: 1.99
    }),
    editor: Object.freeze({
      visualHeightBrushStrength: 0.1,
      visualHeightBrushRadius: 1,
      visualHeightBrushMode: 'literal',
      visualHeightColorStops: Object.freeze([
        Object.freeze({ value: -1, color: '#2563eb' }),
        Object.freeze({ value: 0, color: '#f8fafc' }),
        Object.freeze({ value: 1, color: '#ef4444' })
      ])
    })
  });
})(typeof self !== 'undefined' ? self : globalThis);
