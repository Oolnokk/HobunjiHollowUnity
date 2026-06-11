window.HOBUNJI_MAP_BUILDER_CONFIG = {
  preview3d: {
    architecture: {
      highland: {
        bodyTopScale: 0.85,
        baseHeight: 2,
        minRidge: 0.08,
        defaultRoofHeight: 1.18,
        shingle: {
          candidateUrls: [
            '../../assets/models/HighlandLongshingle_boned.glb',
            '../../assets/models/highlandlongshingle_boned.glb',
            '../../assets/HighlandLongshingle_boned.glb'
          ],
          fallbackSize: [0.62, 0.05, 0.28],
          scale: 0.42,
          columnsPerUnit: 1.25,
          rowsPerUnit: 1.8,
          minColumns: 4,
          minRows: 3,
          surfaceOffset: 0.025,
          staggeredSurfaceOffset: 0.006,
          pitchRadians: -0.08,
          randomRollRadians: 0.035
        },
        roughbrick: {
          fallbackModelUrl: '../../assets/models/Roughbrick1.glb',
          fallbackModelName: 'Roughbrick1.glb',
          fallbackSize: [0.24, 0.14, 0.08],
          columnsPerUnit: 3.125,
          rowsPerUnit: 4.1667,
          minColumns: 3,
          minRows: 3,
          surfaceOffset: 0.035,
          widthFill: 0.78,
          heightFill: 0.58,
          depth: 0.08
        }
      }
    },
    materials: {
      ground: 0x28402d,
      floor: 0x6d5137,
      plaster: 0xbda579,
      roof: 0x5a3725,
      ridgeCap: 0x3c2418,
      gable: 0x846344,
      door: 0x4a2d1d,
      glass: 0x8fbcd4,
      path: 0x38bdf8,
      shingleFallback: 0x4b2d1e,
      brickFallback: 0x9b6b48
    }
  }
};
