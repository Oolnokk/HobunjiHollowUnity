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
      sleepScaleY: 0.5,
      syncMs: 750,
    },
    persistence: {
      key: 'hobunji_barn_incubators_v1',
      version: 1,
    },
  };

  window.BARN_INCUBATOR_CONFIG = config;
})();
