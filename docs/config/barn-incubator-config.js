(() => {
  'use strict';

  const config = { // Used by the barn-incubator runtime, editor, tests, and authored assets without duplicating tuning values.
    schema: 'hobunji_barn_incubator.v1',
    addition: {
      id: 'incubator',
      label: 'Incubator Wing',
      pieceFile: 'config/pieces/barn-incubator.json',
      canonicalFootprint: { w: 3, h: 1 },
      maxPerBarn: 1,
      roofSpineHeightMultiplier: 0.75,
    },
    tiers: { // Capacity and plan identities shared by the barn editor, carpenter and starter package.
      small: { slots: 1, footprint: { w: 1, h: 1 }, planItem: 'barnIncubatorSmallPlan', label: 'Small Incubator', price: 220 },
      medium: { slots: 3, footprint: { w: 3, h: 1 }, planItem: 'barnIncubatorPlan', label: 'Medium Incubator', price: 600 },
      large: { slots: 6, footprint: { w: 4, h: 2 }, planItem: 'barnIncubatorLargePlan', label: 'Large Incubator', price: 1400 },
    },
    gameplay: {
      slots: 3,
      maturationDays: 2,
      requireReservedTrough: true,
    },
    interior: {
      cellsPerFarmTile: 2,
      furnitureKey: 'incubatorFurniture',
      furnitureAuthoredKey: 'incubator',
      furnitureFile: 'config/furniture-authored/incubator.json',
    },
    visuals: {
      babyScale: 0.3125,
      sleepScaleY: Number(window.AnimalSleepPresentation?.SLEEP_SCALE_Y) || 0.75, // Compatibility mirror for nest/incubator placement math; shared sleep presentation owns the target.
      syncMs: 750,
    },
    persistence: {
      key: 'hobunji_barn_incubators_v1',
      version: 1,
    },
  };

  window.BARN_INCUBATOR_CONFIG = config;
})();
