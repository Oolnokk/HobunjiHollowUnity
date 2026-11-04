# Vertical grid (cubic cells) and climbable surfaces

Status: **steps 1–4 landed**. Dev Mode → Random Test Ruin → **Shaft Hub** opens a playable standalone shaft with rendered masonry and climb holds.

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

## ClimbSurfaces (step 2)

`js/climb-surfaces.js` (`window.ClimbSurfaces`): a scoped registry of wall rectangles (`register`, `registerGrid(grid, {scope})`, `clearScope`), a style registry (`registerStyle(id, {speedU, speedV, color, build})` — add a look or feel without touching movement), pure math (`findGrabTarget`, `attach`, `step`, `topExitPoint`) and the player glue.

- **Attach:** a forward dodge facing a wall within 0.9 tiles (±60°), through `ClimbSystem.registerWorldClimbProvider`, the same hook the ruin ledge climb uses. No new input binding.
- **Move:** `player.onClimbSurface` early-returns in the movement loop beside `onBranch`. Input uses the shared `climbMovementInput` (same shoulder-camera transform as ground movement, so *forward* climbs when the camera faces the wall). Along-wall input slides; into-wall climbs; away descends. `player.wallClimbY` is the stand height consumed by the body/shadow render path and by the ruin's `reconcilePlayer`.
- **Exit:** dodge lets go; pulling away at the bottom lets go; pushing up at the top mantles onto the top only if `canStandAt` finds a registered walkable surface there (otherwise you stay at the top).
- **Console recipe** (any area, for trying it): `ClimbSurfaces.register({id:'t', scope:'t', axis:'x', normal:{x:0,z:1}, plane:<z>, u0:<x0>, u1:<x1>, y0:0, y1:6, style:'ivy'})`, face the wall, forward-dodge.

Verified: `scripts/test-climb-surfaces.js` (pure math, every facing, glue); a headless run of the real game (see `headless-game-test`) that grabbed a wall, climbed with `w`, slid with `a`/`d`, descended with `s`, held the stand-off distance, released, and resumed walking, with no page errors; overlay placement for 3 styles × 4 facings against real three.js.

Not done / known gaps: no fall animation or damage on release mid-wall (the ruin just re-seats the player on the floor); no climbing pose; mobile has only the forward-dodge attach.

## Furniture metadata and wall tiles (step 3)

Two optional blocks on authored furniture JSON, edited in the Furniture Author's **Cells & Climbable Wall** section (`tools/furniture-avatar-author/climb-wall-properties.js`):

- **`elevation`** — attached to *every* export, re-measured from the preview's bounding box so it never drifts: `{ version, mode: 'auto'|'manual', measured: { sizeX/Y/Z, minY, maxY, cellsW, cellsD, cellsH }, manual: { cellsW?, cellsD?, cellsH? } }`. Cells are whole 1×1×1 cubes (`CellGrid3D.UNITS`) with a 1e-3 tolerance so a piece authored at exactly 1.0 never measures as 2. `FurnitureElevation.effective(block)` is what generators read: measured values, with manual fields overriding one by one only in manual mode. Pieces without the block simply have no measurement yet.
- **`climbWall`** — marks a piece as a climbable wall tile (`js/climb-wall-tiles.js`):
  `{ version, enabled, style, face: { side: '+z', offset }, role: 'mid'|'endLeft'|'endRight'|'single', variants: { endLeft, endRight, single } }`. A tile is one cell wide and one cell tall, authored so neighbouring copies look continuous (the shipped set keeps handhold spacing at 0.5 across tile boundaries, and the slab fills the cell so tiles also stack). `face.offset` is the climb plane's signed distance from the tile centre along the face normal; holds and posts may protrude in front of it. The **mid** piece lists its sibling keys, so one key identifies the whole set and the end pieces are ordinary furniture.
  "Left"/"right" are as seen facing the wall from its open side. `resolveRuns` groups tiles by wall plane, facing, level and style, splits at gaps, and returns `endLeft` / `mid` / `endRight` / `single` per tile; `placementFor` gives position and yaw; `toSurfaces`/`register` merge a run into one `ClimbSurfaces` wall whose plane equals the placed art. `validateSet` checks roles, style and face plane agree across the set (the Author's *Check this set* button runs it against the repo files).
- Shipped set: `ruinClimbHoldsMid / EndLeft / EndRight / Single` (style `holds`) in `config/furniture-authored/`.
- `CellGrid3D.mergeClimbFaces(faces, geom)` is now shared by grid walls and furniture tiles; faces take an `inset` for panels that sit inside their cell.

Not done: inner/outer **corner** variants (a run currently ends at a corner with end caps on both walls); the Author has no 3D preview of a run; authored wall-tile runs have no automatic V50 placement; tiles are visual + climb surface only, with no collision of their own.

## Decision: shaft hubs are a post-generation composer (step 4)

The shaft hub will be a composer that operates on a `CellGrid3D` after generation, not a new V50 room type. It works on any hub room (V50 interiors, other generators, outdoor locales), composes with the existing ruin modules (which are all post-generation, e.g. `balconyRopeElevator`), leaves the V50 source untouched, and can be extended with new variants (balcony rings, bridges, door placements) without touching the generator.

## Steps

1. `CellGrid3D`: cubic units, standing/walking/slice, DynamicSurfaces bridge, climb-face merge. *(done)*
2. `ClimbSurfaces` runtime: attach/move/detach, style registry, player-loop and ruin-reconcile wiring. *(done; visuals mount in shaft hubs)*
3. Furniture Author: auto-measured `elevation` block on every export, and climbable `climbWall` tiles with end variants. *(done)*
4. Shaft-hub composer (`js/shaft-hub.js`) and level-relative support sampling. *(done; see below)*

## Shaft hubs (step 4)

`ShaftHub.compose({ seed, shaft, wall, balconies, spacing, depth, length, climbStyle, originX, originZ, baseY })` builds a `CellGrid3D`: a solid shell, a hollow shaft under a ceiling, up to three **balconies** (one per side, `spacing` levels apart, the fourth side is the ground entrance), a **door tunnel** from each balcony through the wall to the edge of the hub, and a ground entrance. Corridors attach at the tunnel ends.

A balcony is the flat top of a solid **buttress** whose shaft-facing side is a climbable surface. This is forced by `ClimbSurfaces`' mantle, which lands on top of the wall you climbed; it is also the Zelda shape (a ledge you haul yourself onto). You attach, move along it in normal space, and push up at the top to step onto the balcony.

`compose` *proves* the hub before returning it (`result.checks`, `result.ok`): every balcony cell has a floor and headroom; each balcony has a wall rectangle from the ground to its floor; each balcony and each door's outer end is reachable from the entrance in a graph of walking (CellGrid3D's rules, one-cell drops allowed) and climbing (one edge per column of every merged wall rectangle); tunnels are clear; doors end at the hub's edge. The tests break a hub three ways (no climb faces, a blocked tunnel, a blocked entrance) and confirm the checks catch each. Narrow shafts overlapped neighbouring buttresses until the proof caught it, so `depth` is clamped to keep neighbours apart.

`ShaftHub.mount(result, { ClimbSurfaces, DynamicSurfaces, DevRandomRuin, scope, parent, THREE })` registers standable cells and climb faces, mounts shell and climb geometry, and hands the grid to ruin movement. The player checks body clearance at their current level. A drop of more than one cell animates down to the landing and spends footing. The hub's scope owns its registrations and scene objects, which are removed together on unmount, reroll or exit.

The standalone shaft uses `landings: true`, which extends each balcony tunnel into an enclosed landing. The walk/climb proof also checks reachability to each landing and verifies the wall behind it. `levelRoom(result, level)` exposes the walkable footprint to `RuinComposer`.

Verified: `scripts/test-shaft-hub.js` (including the real `DynamicSurfaces` showing the fixed band cannot see the top balcony and the level-relative one can). In a real generated ruin: the hub was composed and mounted, the player grabbed the lowest balcony's wall, held *down* (into the wall for the default camera) and climbed from y = 0.06 to 4.06, mantled onto the balcony, and stood there at support y = 4.06 with no fall or rejection, full health and no page errors.

**Universal ruin integration (Nov 3, 2026):** Every procedurally generated ruin now calls `attachShaftHub` after its main layout has passed solvability, regardless of tradition, theme, seed, developer settings, or entry method. This includes the separately composed Hachutu temple. The fixed Harlyao story vault also mounts a shaft hub after creating its authored corridor; the vault encounter and footprints are not modified. The hub is a connected two-way passage on the same interior map, not a replacement for room topology or the boss sanctum. Each hub contains climbable balconies and seeded side rooms; the 3D grid owns floor support, wall collisions and projectile obstruction. The prior **V50 + Shaft Wing** opt-in button is no longer necessary. **Shaft Hub** remains as a standalone developer test.
