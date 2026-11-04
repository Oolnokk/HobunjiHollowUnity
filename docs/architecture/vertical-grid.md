# Vertical grid (cubic cells) and climbable surfaces

Status: **wide octagonal shaft, physical ground entrance and 3–5 instantiated stacked-story wing networks**. Each story now has genuine stone rooms, 2D hallways, climb-connected doorway tunnels, height-aware collision, starter pressure-plate gates and igniteable endpoint braziers. Full V50 puzzle variety, full quest/boss progression and browser sign-off remain unfinished. The existing Harlyao Great Door is now additionally gated by completing every shaft-wing brazier.

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

## Shaft hubs, wide-grid anchors and 2D floor layering (November 4, 2026)

### Intended dungeon structure

The overall dungeon is **not** one enormous three-dimensional tile grid. Each story is an ordinary **two-dimensional** room-and-hallway graph, with its own generator output, puzzles, layout and encounters. A separate invisible grid, **64 world cells apart by default**, reserves positions for special multi-level rooms. Those anchors occupy precisely the same X/Z coordinates on every story they span; ordinary rooms remain unsnapped and can vary in size and offset between anchors. Corridors span the leftover distance (including doglegs when rooms are laterally offset).

The shaft is a **shared room at the center of the eventual dungeon**, **not the player spawn** or a teleport destination. Its interior is a broad, eight-sided 33-cell chamber, comparable to V50's very-large room class (22–26 × 26–36), with an eight-cell-thick shell in the integrated ruin (49 cells across externally). It spans **3–5 stories** of 4 world units each, with continuous perimeter galleries at upper levels, real climbable buttresses and side-door thresholds. Its stone walls and galleries reuse the ordinary ruin's unlit `carved_smooth.png` material. The ceiling is visible from below but one-sided so the overhead third-person camera can see into the room.

There are **1–4 wings per floor**. Every wing's planned sequence contains **2–4 challenge chambers and a final brazier chamber**. Braziers should only count once the associated wing's challenges have been completed. All floors must connect physically through the central shaft, so visiting the shared room is mandatory to complete a full dungeon. The shaft is the hub; each floor's arrangement of wings is a separate wheel. All planned wings and brazier endpoints now have corresponding actual scene/collision geometry. **Current challenges are simple stand-to-activate stone plates**; the authored advanced puzzle families still need to replace them. The existing Harlyao Great Door now also requires all shaft braziers in addition to its original blue seals, before it can open. Hachutu's separate boss logic is unchanged.

### What is currently live

- `js/shaft-hub.js`: shared cubic cell-grid room; accepts `floors:3..5`, octagonal size and material, connected upper galleries, mantle/reachability proof and grouped DynamicSurfaces registrations. The true eight-sided shell now opens one individual full-height portal for **each floor's actual wing**, offset from the climbing buttresses so the ascent is never blocked.
- `js/ruin-shaft-corridor.js`: 2D pathfinder that finds an exterior walkable route from the V50 entrance to the shaft, without cutting through V50's room footprint or the occupied hub shell. It can dogleg around the existing layout and groups stone support rectangles for performance.
- `js/ruin-shaft-connector.js`: physically links the existing V50 room to the shaft, avoiding ground-floor wing reservations as well as V50 floors. It then mounts every story's new independent room chain and rebuilds the occupancy grid once for the combined footprint, preserving moving-dais furniture collision.
- `js/ruin-layer-plan.js`: independent deterministic 2D room placement per story around one snapped 64-cell shaft anchor, with 1–4 wings/floor, 2–4 challenge rooms before each wing's brazier, variable-length connecting passages and exact door footprints. Normal rooms do **not** snap to the special-room grid; even-sized room thresholds now meet corridors without gaps.
- `js/ruin-layer-playable.js`: turns each planned chain into a real textured floor, walls, dynamic support rectangles and a small elevation-aware `CellGrid3D` collision slice. The player can walk between the shaft's floors and these physical wings without warping. Every challenge plate holds for 0.8 seconds to unlock its outbound 3-cell stone gate; every wing has one interactive brazier, tracked by `shaftLayerRuntime.getState()`. Higher-story room meshes are hidden while the player is below them so an overhead camera does not see a false roof of stone above its subject; collisions and floor supports stay active until disposal. All material, voxel registrations and supports are released on reroll, with a hard cap on 2D map allocation.
- `js/dev-random-ruin-interior-map.js`: the player still spawns in the existing V50 entry floor, then walks the ground corridor to the shaft. The shaft's added wings occupy real higher/lower floor elevations; old **Enter Shaft Hub / Return to Ruin** teleports stay removed. The fixed Harlyao vault and Hachutu route reuse this integration. The mobile debug badge now reports *instantiated wings, solved gates and lit braziers* rather than planned-only totals.

### Remaining integration work, explicitly not complete

1. Make the **core** dungeon generator reserve multi-level anchor slots *before* assembling each V50 floor graph. The present adapter extends a generated entry-floor V50 ruin, so its 2D challenge rooms are custom generated rather than full V50 room/puzzle instantiations. The positive-coordinate anchor reservation and footprint-size guard handle the present map but should become a proper chunked/translated layer system as more multi-floor room types are introduced.
2. Replace the current stone-plate gate challenges with the requested **authored puzzle families** (rope traversal, projectile glyphs, rail movers, bomb/statue defence, dungeon fire, instrument songs) and validate each room's puzzle solvability.
3. Complete the **quest/boss integration** beyond the Harlyao Great Door's new shaft-wide requirement. The existing Harlyao door will not open until both its old blue seals and all new shaft wing braziers are lit; story-specific alternatives such as Hachutu still require their own deliberate progression wiring.
4. Run **browser gameplay** tests of climbing across hub↔upper-wing thresholds, targeting/projectiles, camera/headroom and collision with 3D height-specific voxels. The in-process suite mounts wing networks and solves a plate but is not a substitute for browser tests.

### Verification and performance

`scripts/test-shaft-hub.js` runs 1,000 deterministic sparse floor plans, 3/4/5-story octagon reachability, four entrance directions, mocked real room/voxel mounting, gate opening and geometry cleanup. An additional 1,200-seed exhaustive 2D-footprint flood check found zero disconnected rooms, cross-wing footprint collisions or negative map extents at the reserved anchor. Browser CI still needs to prove the same behavior with the actual player/camera. The shaft's DynamicSurfaces support rectangles were reduced from thousands of 1×1 entries to roughly 61–123 grouped spans, depending on story count, and the corridor's supports are grouped too. 
