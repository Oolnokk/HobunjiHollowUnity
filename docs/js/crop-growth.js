// Daily crop growth: the per-tile water/ditch growth multiplier and the
// day-rollover tick that ages crops, marks them ready and labels their
// stress. Extracted out of game.js (tickCropDay/cropGrowthMultiplier/
// hasAdjacentDitch) following the window.<Namespace> + init(deps) pattern;
// game.js's advanceDay()/sleepInBed() call tickCropDay() through a one-line
// forwarder. grid is reassigned wholesale in game.js, so it's a getter.
(() => {
  'use strict';

  let deps = null; // { getGrid, getCalendar, cropData, TileType, MAX_WATER, RAIN_RATE, ROWS, COLS, cardinalNeighbors }
  function init(injectedDeps) { deps = injectedDeps; }

  function hasAdjacentDitch(col, row) {
    const grid = deps.getGrid();
    return deps.cardinalNeighbors(col, row).some(point => grid[point.row][point.col].type === deps.TileType.TRENCH);
  }

  // Returns 0..1 growth rate based on how close tile.water is to crop ideal band.
  function cropGrowthMultiplier(tile, col, row) {
    if (!tile.crop) return 0;
    const data = deps.cropData[tile.crop];
    const { idealMin, idealMax } = data;
    const w = tile.water / deps.MAX_WATER;
    let waterMul;
    if (w >= idealMin && w <= idealMax) waterMul = 1.0;
    else if (w < idealMin) waterMul = Math.max(0, (w - (idealMin - 0.4)) / 0.4);
    else waterMul = Math.max(0, ((idealMax + 0.4) - w) / 0.4);
    const ditchMul = data.needsAdjacentDitch && !hasAdjacentDitch(col, row) ? 0.65 : 1.0;
    return waterMul * ditchMul;
  }

  function tickCropDay() {
    const grid = deps.getGrid();
    window.FarmProduction?.irrigate(grid, deps.getCalendar(), deps.RAIN_RATE, true); // Analytic irrigation handles sleep/day skips before crops evaluate their water.
    for (let row = 0; row < deps.ROWS; row++) {
      for (let col = 0; col < deps.COLS; col++) {
        const tile = grid[row][col];
        if (!tile.crop) continue;
        const data = deps.cropData[tile.crop];
        const mul = cropGrowthMultiplier(tile, col, row);
        const ditchStress = data.needsAdjacentDitch && !hasAdjacentDitch(col, row) ? 'needs ditch' : '';
        const tooDry = tile.water / deps.MAX_WATER < data.idealMin; // Same 0..1 scale as idealMin (tile.water is 0..MAX_WATER).
        tile.stress = ditchStress || (mul < 0.15 ? (tooDry ? 'too dry' : 'waterlogged')
                    : mul < 0.6  ? (tooDry ? 'dry'     : 'too wet')
                    : '');
        tile.cropAge += mul * (tile.fertilized ? 1.25 : 1); // Compost improves one crop cycle without overriding water stress.
        tile.cropReady = tile.cropAge >= data.growDays;
      }
    }
  }

  window.CropGrowth = { init, tickCropDay, cropGrowthMultiplier, hasAdjacentDitch };
})();
