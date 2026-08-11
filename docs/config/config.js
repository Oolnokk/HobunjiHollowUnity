// Shared gameplay, HUD, and editor tuning. Loaded before dependent scripts.
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
    }),
    resourceRings: Object.freeze({
      arcs: Object.freeze({
        health: Object.freeze({ start: 292, end: 186 }),
        stamina: Object.freeze({ start: 174, end: 68 }),
        footing: Object.freeze({ start: 56, end: -56 })
      }),
      colors: Object.freeze({
        health: '#55d76f',
        stamina: '#67b7ff',
        footing: '#d9a441',
        exhausted: '#050608',
        outline: '#000000',
        target: '#ff2020'
      }),
      afflictionColors: Object.freeze({
        woundedStamina: '#ff9b2f',
        bleedingHealth: '#cf1e2e',
        congealedHealth: '#c98d41',
        infectedStamina: '#284f2a',
        windedStamina: '#90949c',
        bruisedHealth: '#4c42a9',
        shatteredStamina: '#8c4ad9',
        poisonedHealth: '#37651c',
        drunkenFooting: '#000000',
        drunkenHealth: '#ff4f9a'
      }),
      neon: Object.freeze({
        minSourceSaturation: 0.12,
        minSourceLightness: 0.08,
        saturation: 1,
        minLightness: 0.42,
        maxLightness: 0.6,
        glowHaloPadFraction: 0.34,
        glowHaloOpacityMultiplier: 0.75
      }),
      afflictionPulse: Object.freeze({ durationSeconds: 1, scale: 0.22, shakeUnits: 0.035 })
    })
  });
})(typeof self !== 'undefined' ? self : globalThis);
