# Vertical grid (cubic cells) and climbable surfaces

Status: **step 1 of 4 landed** (`js/cell-grid-3d.js`, `scripts/test-cell-grid-3d.js`). It is loaded by `index.html` but no gameplay code calls it yet; steps 2–4 wire it in.

## The idea

The existing `(col, row)` tile grid gains a third axis, `level`. A cell is a true cube, 1 × 1 × 1 world units (`CellGrid3D.UNITS`). The legacy 2D grid is one *slice* of the 3D grid: `sliceToTileGrid(level, clearance, solidTile, openTile)` returns the `grid[row][col]` shape that movement, AI and projectile code already read, as seen by an entity standing at `level`. Nothing that reads the 2D grid has to learn about height; whatever owns an entity asks for the slice at that entity's level.

- Level `l` spans world y `[baseY + l, baseY + l + 1)`. A solid cell's top face is `levelToY(l + 1)`.
- An entity stands at level `L` when its feet are in the air cell at `L` and the cell below is solid. Default body clearance is 2 cells.
- Out of bounds is solid sideways and below level 0 (implicit bedrock); above the top it is air.
- 1.0 cubes are deliberately taller than the 0.42 step limit (`MAX_STEP_HEIGHT`). Walking never climbs a cube and may drop one (`walkDestinationLevel`). Getting up means stairs, a ledge climb, or a climbable surface.

## Climbable surfaces

A climbable face is a flag on a solid cell's N/E/S/W side whose neighbour is open air, with a style id (`ivy`, `rungs`, `holds`, … — visual only, extendable). `collectClimbSurfaces()` greedy-merges coplanar same-style faces into rectangles `{ facing, normal, plane, axis, u0, u1, y0, y1, style }`.

Unlike the scripted ladder/ledge/cliff climbs (hop to the top), a climbable surface is an *attached state*. The input attaches the player; movement input is projected onto the wall plane and moves them along it in normal space (sideways along `u`, up/down along `y`), clamped to the rectangle. The nearest existing precedent is `ClimbSystem.updateBranchMovement` (`player.onBranch`), which projects input onto a branch axis; the wall version is the same shape with a 2D plane instead of a 1D axis.

## Wiring requirements found while exploring (for steps 2–4)

1. **Support sampling must be level-relative.** `dev-random-ruin-interior-map.js` `positionInfo` calls `DS.sampleSupport(x, z, { minY: -4, maxY: 5 })`, and `sampleSupport` returns the *highest* surface in the band. With stacked floors that would treat an overhead balcony as the floor and block walking beneath it. Pass `maxY = supportY + MAX_STEP_HEIGHT`. `CellGrid3D.registerWith` documents the same constraint.
2. **Legacy floors lift with loss.** V50 floors are `levelByCell × 0.42`. `fromHeightfield` quantises down to whole cubes and reports `maxQuantizationError`; the 3D layer is for new vertical structure (shafts, balconies), not a re-skin of 0.42 plateaus.
3. **Presentation height** comes from `DevRandomRuin.getPlayerSupportY()`; an attached player needs the same treatment `player.climbing` gets in `game.js` (`climbSurfaceY`) and in `reconcilePlayer`.

## Steps

1. `CellGrid3D`: cubic units, standing/walking/slice, DynamicSurfaces bridge, climb-face merge. *(done)*
2. `ClimbSurfaces` runtime: attach/move/detach state, style registry, player-loop and ruin-reconcile wiring, dev test wall.
3. Furniture Author: measure pieces into whole cells (`measureBox`, `heightToCells`) and store an `elevation` block plus a `climbSurfaces` block on the furniture JSON, alongside existing capability blocks such as `walkableElevation`.
4. Shaft-hub composer for ruins: carve a hollow shaft, ring balconies, doors on balconies, climbable walls, using measured piece heights.
