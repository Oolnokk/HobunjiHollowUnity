# Performance investigation log

## 13 Nov 2026: browser HUD DOM/style invalidation audit (in progress)

The Chrome capture supplied by the player included approximately **1,414 ms of Recalculate Style** across the selected interval. This is cumulative browser time, not an isolated self-time measurement for one HUD module. Two confirmed code-level causes of avoidable invalidation in the UI layer were:

- The timed-effect strip scanned all countdown/fraction elements again for every active effect on every refresh (quadratic DOM selector work), while assigning unchanged `display` and `width` inline styles. It now caches child references per structural rebuild, compares before writing, and quantizes width to 0.1 percentage points for countdown stability. The mobile Pixel Probe reports real and skipped writes.
- The contextual action prompt rebuilt identical button HTML, classes, styles, and pointer handler closures on repeated show/update calls (notably the fishing interaction). Its DOM is now updated only when contents change; stable handlers dispatch the latest callbacks. The desktop status pill also avoids redundant `display` assignments.

No Three.js render function was changed. **Not yet measured:** device/browser `Recalculate Style` time after this patch; the Pixel Probe write counters establish mutation frequency, not a replacement for an A/B Chrome Performance capture.

## 13 Nov 2026: den entrance collision now reuses translated authored colliders

A Chrome Performance capture at approximately 8 FPS on the wilderness slope showed
`denEntranceCollisionState` near the top of Bottom-up (about 909 ms self time during
the selected recording). `TilePathfinding.findPath` called collision predicates
often enough to expose the per-query locale scan and world-rectangle allocation.
This is CPU work, not an indication that den meshes are expensive to draw.

- `ZoneDenTotemFeatures.denEntranceCollisionState` now caches each den's translated
  colliders in a `WeakMap`, with a conservative union bound that includes authored
  objects **outside** the den footprint. Position, dimensions, entrance template,
  mouth anchor, or locale source changes force recomputation; dead den objects
  are not retained. `GridTileAccessors` skips tile tests outside the union.
- `LocalDBOverrides.getRuntimeOverride` retains a read-only parsed locale source
  for gameplay, invalidated on same-tab edits and cross-tab `storage` events.
  The editor's `getOverride` intentionally retains its fresh-read behavior.
  Repository templates are loaded separately so switching back from local mode
  cannot leave editor-authored collisions as the repo fallback.
- Mobile Pixel Probe reports cache hits, builds and invalidations; the authored
  den collision regression tests exercise 600 repeated checks, relocation,
  resizing, template changes, local edits, and external furniture colliders.
  A direct runtime test with both checked-in templates also passed 2,000
  repeated cached reads plus source/geometry invalidation scenarios.

**Not measured:** new physical-device FPS, frame time, or Chrome profiler self
time after the change. Reprofile the same wilderness view to measure the effect,
then investigate style recalculation and held-overlay render work separately.


Read this before you start chasing a "the game gets slow, especially in the wilderness after fights" report.
It records what was measured, what turned out to be the cause, and — just as important — what looked like a
cause and was **not**, so nobody spends another session re-ruling those out.

Everything below was measured in the headless harness (see
[`.claude/skills/headless-game-test/SKILL.md`](../../.claude/skills/headless-game-test/SKILL.md)) unless it says
"real hardware". The sandbox has no GPU: WebGL is software-rendered at roughly one frame per second. **Draw
call, triangle, scene-object and heap counts are exact. Millisecond figures are only good for comparing two
conditions on the same machine; they are not what a player sees.** Counts come from `renderer.info`; JS time
comes from CDP CPU profiles. One headless world per run, and bandit/tribe camps are random, so repeat anything
close before trusting it.

## 14 Nov 2026: barbarian camps: phantom ecology fights, per-frame path searches, off-camera AI cadence

Report: "performance tanks around lots of barbarians, and in open country they are visible well past their simulation
distance, spinning in place until you come close." Both halves were one defect plus two amplifiers.

**The defect (`porakaneki-camps-runtime.js` ecology pass).** Every tribe hunter, bandit and predator inside the 24-tile
ecology bubble around the player was handed the *nearest opponent anywhere in that bubble* as a fight target: no limit
on the distance between the two (up to 48 tiles), no reachability, and no check that the opponent was on screen. Camp
residents keep their rig out to 24 tiles, but wildlife is hidden beyond 14-18 tiles and inside dens, so in practice all
of a camp's live hunters were committed to prey nobody could see, permanently (a target was only released on death or
on leaving the bubble). Pursuit is a straight line with no pathfinding, and a hunter carrying a throwing weapon either
holds its post when the target is beyond throw range or side-steps for a line of sight it will never get. Measured on
the Western Slope with 15 materialised Porakaneki hunters and 3 puktuk in a den: 15 of 15 hunters in `chase`, 8 stacked
on one tile at the den mouth 21 tiles from the player, one frozen 3.6 tiles from the player facing prey 18 tiles away,
and one that walked 11.9 tiles of path in 5 s for 0.37 tiles of net movement with 231 direction reversals. Walking
closer woke the prey, which is why it "fixed itself" up close.

Now: only actors with a shown rig take part (`ecologyPresented`: not LOD-hidden, not data-only, not den-hidden); a
fight starts within `ecologyEngageRadiusTiles` (10) and is dropped past `ecologyDisengageRadiusTiles` (15), both in
`config/porakaneki-camp.json`; and a pursuit that gains no ground and deals no damage for 6 s is abandoned and that
opponent ignored for 30 s (`ecologyPursuitAlive`). `scripts/test-porakaneki-camp.js` covers all three.

**Amplifier 1: a failed path search repeated every frame.** A blocked creature falls through `moveCreatureToward` into
`CreatureCliffClimb.navigate` -> `walkToEntry`, which ran a `TilePathfinding.findPath` of up to 6,500 nodes; when that
found nothing it kept no memory of the failure, so every stuck hunter searched again on every frame. Same shape in
`npc-pathfinding.js`'s cliff-approach search (7,500 nodes), found on Old Man Nohuknuk on the same map. Both now wait
(1.2 s / 750 ms) before repeating a search that failed from the same tile to the same entry.

**Amplifier 2: `denEntranceCollisionState` per tile test** (2.98 ms of self time in the profile below).
`isAnimalDenCollisionTile` called it once per den for every tile a path search probes, and each call re-read the Local
DB source mode and rebuilt the rectangle list. Main fixed this independently while this work was in progress (the
per-den cache in `zone-den-totem-features.js`, #1672), so nothing was changed for it here.

**Off-camera AI cadence (new).** `OffscreenRigLod.shouldCoarseTickAi`: a `BanditCombat` humanoid in `idle`/`return`
with nothing in progress, more than 4 tiles from the player and outside the camera frustum, advances at the far-wildlife
5 Hz accumulated-time cadence instead of every frame. In view, or doing anything else, it is full rate on the same
frame. `OffscreenRigLod.setCoarseAiEnabled(false)` is the A/B switch; `getStats()` has `aiChecked` / `aiCoarse`.

Headless, rendering stubbed out so frames run at 60 Hz, 10 s CDP CPU profiles, JS ms per frame. **The before and after
rows are different generated worlds** (camps are random), so compare the named functions, not the totals:

| Western Slope, standing by a Porakaneki camp | `updateHostiles` | of which bandit combat AI | `findPath` | `gameLoop` |
| --- | --- | --- | --- | --- |
| Before: 15 hunters, all on phantom targets | 7.08 | 5.88 | 4.47 (`denEntranceCollisionState` 2.98 self) | 13.40 |
| After: 10 hunters, calm, NPC fix not yet in | 0.75 | not in the top 45 | not in the top 45 | 11.98 (6.1 of it Nohuknuk's NPC search) |
| After, all fixes: 6 hunters, calm, all off camera | 0.19 | - | - | 5.97 (Nohuknuk 1.6, down from 5-6) |

Same spot, same 10 idle hunters, coarse cadence off -> on: `updateHostiles` 0.88 -> 0.63 ms (6 of 10 off camera).

A staged visible hunt still works: a puktuk moved 3 tiles from an Omgurku hunter was targeted on the next ecology tick
and thrown at repeatedly while it ran.

**Not measured:** real-device FPS, and the render side. A camp is still 15 full rigs in every pass when they are on
screen (lead 1 below, the shell outline pass, is unchanged). **Not fixed:** a thrower whose target is in engage range
but beyond its throw range still stands facing it for the 6 s give-up window; and hunters build their rig at 18 tiles
while wildlife wakes at 14, so a den-hunting party can arrive at a den whose animals are not shown yet.

## 12 Nov 2026: large wilderness meshes split into cells (mesa tiers, cliff decals, bedrock)

What the near-only replays (next entry) still resubmitted in the wilderness was a handful of zone-spanning meshes whose
bounds always reach in front of the actor. They also sat whole in the real draw whenever any corner was on screen.

- `zone-plateau-mesa.js`'s render batching left any source above 6,000 triangles as its own draw. Those sources (the
  largest `plateau_mesa_tier` meshes, up to ~37 k triangles and two materials, and the transparent
  `cliff-handhold-decals` mesh, ~25 k) are now cut into the same 24x24 cells as the merged batches
  (`splitMesaGeometry`): indexed per-cell geometries, material slots and triangle order preserved, source hidden behind
  them exactly like a batched source, so cliff/height sampling and occlusion raycasts still use the untouched source.
  Parts stay at the source's origin, so the decals' transparent sort position is unchanged.
  `ZonePlateauMesa.setLargeMesaSplitEnabled(false)` is the A/B switch (next build/rebuild);
  `mesaBatchSnapshot()` has `splitMeshes` / `splitParts`.
- `wilderness-bedrock.js` opts its one zone-wide slab into `TerrainRenderChunks` (`terrainRenderChunkEligible`); the
  chunker no longer requires `receiveShadow` for an explicit opt-in.
- `scripts/test-zone-plateau-mesa-large-split.js` (real three r128, like the batching test).

Same frozen frame, one base + shell frame, each step applied in turn (headless, exact counts):

| View | Triangles: before -> mesa/decal split -> + bedrock | Draw calls | Pixels |
| --- | --- | --- | --- |
| Western slope, two actor groups | 1,132,011 -> 672,499 -> 599,310 | 740 -> 749 -> 778 | colour and depth identical |
| Cloud forest | 1,576,860 -> 1,252,604 -> (no bedrock mesh of 12 k+) | 1,088 -> 1,096 | colour and depth identical |

Western slope: 9 sources became 150 parts and the bedrock 81 chunks. The live game frame there is now about 598 k
triangles; the first wilderness census (before any of today's work) was 1.51 M at the same spot.

**Not measured:** real-device FPS. Bedrock's 81 chunks cost 29 draw calls for about 73 k triangles saved per frame;
if draw calls turn out to matter more on a device, that opt-in is the first thing to revisit.

## 12 Nov 2026: held/shell replays rebuild only near depth and restore by depth copy

The fix for "replays are the multiplier" (see the entries below). Wilderness numbers first, because nothing earlier
helped there: the western slope's real world draw was already only about 270 k triangles, and 75% of its 1.5 M frame was
five replays resubmitting mesa tiers, snow patches and cliff decor that sit *behind* the actors.

An x-ray group clears depth in its scissor and redraws the scene so its held parts can be tested against "everything
except the floor they stand on". Only occluders nearer than those parts can change that test. Now:

- `js/scissor-depth-snapshot.js` (`ScissorDepthSnapshot.save/restore`) copies the replay rectangle's depth out of the
  current render target and back with WebGL2 `blitFramebuffer`, into one depth(-stencil) renderbuffer per renderer.
  Supported only for an offscreen single-sample target with a depth texture (the main scene target while outlines are
  on). One `getError` check per allocation; any failure disables it for that renderer.
- `held-object-render-order.js`: with a snapshot taken, each group's depth rebuild hides bounded objects whose whole
  bounding box is farther than the group's farthest held part plus 1.5 units (`hideBeyondViewDepth`,
  `replayFarViewDepth`). The base replay's ground-restore draw and the shell replay's full "final depth restore" draw
  are replaced by the depth copy plus a depth-only redraw of the held parts. Unbounded held parts (skinned, instanced)
  skip the far cull but still get the copy.
- No snapshot support (WebGL1, outlines off so the scene draws straight to the canvas, a failed restore) runs the
  original path unchanged. `HeldObjectRenderOrder.setNearReplayEnabled(false)` is the A/B switch; `snapshot()` has
  `nearReplaySnapshots`, `nearReplayFarCulled`, `nearReplayFallbacks`, `lastNearReplayFarDepth`.
- `scripts/test-held-near-replay-depth-snapshot.js` runs the snapshot module against a recording GL fake and the
  compositor with and without snapshot support.

Same frozen frame, new path on vs off (headless, exact counts, one base + shell frame):

| View | Triangles off -> on | Draw calls off -> on | Colour |
| --- | --- | --- | --- |
| Western slope, player only | 1,013,776 -> 637,371 | 664 -> 460 | identical |
| Western slope, two actor groups | 1,725,600 -> 1,338,799 | 954 -> 771 | 110 px differ (see below) |
| Cloud forest (sphere test, before the box refinement) | 2,819,372 -> 1,817,442 | 1,376 -> 969 | identical, depth identical |
| Town, quiet | 2,942,401 -> 1,804,340 | 1,725 -> 1,104 | identical |
| Town, crowded (4 groups, 54% scissor) | 5,329,973 -> 3,396,496 | 2,948 -> 1,770 | identical |

**The differing pixels are the old path's bug.** On the slope the old path drew faint horizontal streaks across a
cliff base inside the replay rectangle. Against a reference frame with every held-overlay mesh hidden (so no replay
runs at all), the new path matched the reference in all 110 differing pixels and the old path in none; the two
references were identical to each other. A crowded town frame that differed (142 pixels along the bottom edge) scored
the same way: 142 of 142 matched the reference with the new path, none with the old. The base pass alone was identical on and off, and the far cull made no pixel
difference, so the streaks came from the old path's depth after a replay (a hole where filtered floor was not put
back), which the outline pass then drew through. The depth copy restores exactly what was there.

Depth after the frame does differ inside the rectangle (a few hundred pixels around the held parts): the old path left
forced cutout/cover depth behind there (PNG avatar silhouettes, water, snow, grass), the new one leaves the scene's
real depth, the same as everywhere outside the rectangle. In the game `PngPlaneOutlineOccluder.renderDepth` writes the
PNG silhouettes for the whole screen right afterwards.

**What still sits in a wilderness rebuild:** a handful of zone-spanning meshes whose box always reaches in front of the
actor: the largest `plateau_mesa_tier` meshes (up to 37 k triangles, multi-material, so the terrain chunker skips
them), `cliff-handhold-dec` (one 23-27 k mesh), `wilderness_bedrock` (one 14-15 k mesh) and the three cloud depth
masks. Splitting those spatially is the next step for both the real draw and the rebuilds.

**Not measured:** real-device FPS, and whether every mobile driver accepts a depth-stencil blit (it falls back if the
first one reports an error).

## 12 Nov 2026: town ground meshes now go through the terrain chunker; roots and bricks measured

**Terrain.** `terrain-render-chunks.js` only split meshes of 60,000+ triangles (sized for 200x200 wilderness zones). The
town's ground meshes are 47.9 k, 31.6 k, 21.9 k (path surface) and 17.4 k triangles, each spanning the whole map, so they
were single draws in every pass that neither the camera nor a scissored replay could drop: about 743 k triangles per
frame in a crowded town view. `MIN_SOURCE_TRIANGLES` is now 12,000 (about one 24x24 cell of subdivided floor; a mesh
must still span two cells). Town: 4 meshes became 35 chunks. Measured on one frozen frame, before and after the split:
3,048,582 -> 2,782,482 triangles, 1,599 -> 1,630 draw calls, **0 of 90,000 pixels differ**. The same meshes already
went through this chunker in large wilderness zones (the held replays, path binding and `onTerrainGeometryReady` all
handle it), which is why only the threshold changed. Not checked in-game: the farm and interiors, where any
material-ID-layer floor of 12 k+ triangles spanning two cells now splits too.

**Surface roots (measured, not changed).** The temple's `cornerFill` root layer (`config/pieces/temple.json`: 48
strands per surface on 9 surfaces, radius 0.2, length 12) is 432 strands and about 198 k triangles, roughly 460 per
strand (5 sides, a ring every 0.14 units). Standing beside the temple it is all in view and inside the replay scissor,
so it was drawn in the world pass, the shell outline pass and six replays: about 1.0-1.2 M triangles per frame, the
largest single item in that view. It is not a culling problem (each mesh is a 2-4 unit sphere and cullable). The
strands follow sinusoidal curl with about ten rings per wavelength; halving the ring count would save about 2x with a
visible change to thick, authored art, so this is left as an art decision: lower `count` in the recipe, or accept a
coarser ring spacing in `appendCornerGrowth`.

**Bricks (measured, not changed).** Still the largest steady cost: `Roughbrick1.glb` is 70 triangles and has no
pre-baked reduced variant (only `cave_small_optimized60.glb` exists in `assets/models`). After culling, a crowded town
view still draws about 1.5 M brick triangles per frame. A Geometry Workshop bake of the brick is the remaining lever.

**Replays are the multiplier for everything near the player.** That view ran six scissored replays per frame (two
base and two shell elevation groups), each resubmitting whatever sits inside a 10-25% scissor. A depth save/restore
for the scissor rectangle (WebGL2 `blitFramebuffer`) with a near-only occluder set would remove most of that, but it
rewrites the core of `held-object-render-order.js`; not attempted.

## 12 Nov 2026: farm/town grass drawn as camera-cullable chunks

Second fix from the census below. Farm grass, farm weeds, town grass and the town border grass are each one
InstancedMesh spanning the whole map with `frustumCulled = false`, so a bounding sphere around one covers everything.
Several systems write to those meshes (hoe/seed/shovel refills, `BuildingGrassSuppression` footprint compaction, town
height followers, the Settings > Grass toggle), so they were **not** split at build time.

- `js/grass-billboard-render-chunks.js`: a registered source mesh stays the single authority. For the synchronous
  world render only it is hidden and a holder of per-cell InstancedMeshes (8x8 tiles, sharing its geometry and
  material) is shown instead; the source is restored in `renderWorldPasses`' `finally`. Chunks are re-partitioned only
  when the source's instance buffer, count or geometry change (4 rebuilds over a whole town load here; steady state is
  zero). They carry no `isBillboard` tag, so footprint/height writers never touch them, and they do not answer
  raycasts. Every other renderer still sees the plain source. `GrassBillboardRenderChunks.setEnabled(false)` is the A/B
  switch; `snapshot()` reports sources, chunks and rebuilds.
- The chunks are tagged through `InstancedMeshBounds`, so `InstancedMeshViewCull` drops off-camera ones and the
  held/shell replay cull drops ones outside the scissor. Town: 84,066 blade planes in 122 chunks.
- Wilderness grass and rich-foliage chunks were already split with authored geometry bounds; they are now flagged
  `hobunjiAuthoredInstanceBounds`, which lets the replay cull trust those bounds (before, every InstancedMesh stayed in
  every replay).

Measured headless in a crowded town (NPCs out, large held-item scissor; a heavier scene than the census below, so
compare within this table only). Same session, same view, each switch flipped alone; triangles and draw calls for one
base + shell frame:

| Configuration | Triangles | Draw calls |
| --- | --- | --- |
| Everything on | 5,062,562 | 2,509 |
| Grass chunks off | 6,181,632 | 2,340 |
| Camera cull off | 5,426,490 | 2,598 |
| Replay cull off (the pre-existing one too) | 7,299,234 | 5,108 |
| All three off | 9,929,352 | 4,928 |

The frame was **pixel-identical** with all three on and all three off (0 of 90,000 pixels differ); this run does apply
the camera cull and the grass swap. In the quieter first measurement of the same session, grass went from 168 k to
80 k triangles in the real draw and from 168 k to 50-60 k in each replay. Software-raster frame time with grass chunks
on vs off was about 2.4-3.0 s vs 8.6 s, which repeats the grass sensitivity noted below and is likely exaggerated by
SwiftShader.

**Not measured:** real-device FPS, and the farm itself (the harness starts in town; the farm meshes go through the
same registration and the unit test covers refills). Chunking costs draw calls: 122 chunk meshes replace 2 grass
meshes, of which roughly 30-50 are submitted per pass in this view.

**Harness traps found here:** NPC portrait renders also match "no override, all layers, render target", so pick the
scene to time by `GridTileAccessors.getActiveScene()`, not by the last such render; and a synchronous harness frame
bypasses `renderWorldPasses`, so call the same `suspendForRender` pairs around it or the culls are not exercised.

## 12 Nov 2026: instanced bricks now leave the camera pass and the depth replays

First fix from the census below. Same town view, player only, headless, exact counts:

| | Before | After |
| --- | --- | --- |
| Triangles per frame | 3,899,054 | 1,985,674 |
| Draw calls per frame | 839 | 624 |
| Real world draw | 941,644 | 626,364 |
| Each full depth replay | ~900,000 | ~390,000 |

A synchronous base + shell frame read back from the main target was **pixel-identical** with the replay cull on and
off (0 of 90,000 pixels differ). That first check did not run the camera cull (the harness frame bypassed
`renderWorldPasses`); the grass entry above repeats it with every cull applied.

- The sphere around all of a mesh's instances that `WallBuilder` kept for its raycast early-out now lives in
  `js/instanced-mesh-bounds.js` (`InstancedMeshBounds.localSphere/worldSphere/tag/forEachTracked`). Built wall meshes are
  tagged `userData.hobunjiInstanceBounds` and tracked through weak references.
- `js/instanced-mesh-view-cull.js` hides tagged meshes whose sphere is outside the camera for the synchronous world
  render only, restored in `renderWorldPasses`' `finally` (same contract as `NpcViewFrustumCull`). In the measured view
  51 of 73 brick meshes (5,375 of 8,653 bricks) were hidden. `InstancedMeshViewCull.setEnabled(false)` is the A/B
  switch; `snapshot()` reports counts.
- `held-object-render-order.js`'s replay cull now accepts those tagged instanced meshes (16 culled, 4 kept per replay
  here) and drops sky shells tagged `hobunjiDepthReplayInert` whose material cannot write depth (sky dome and the three
  visible cloud shells; the cloud depth masks stay in). `snapshot()` has `lastReplayInstancedCulled/Kept` and
  `lastReplayInert`.
- `scripts/test-instanced-mesh-render-cull.js` runs every piece.

**Not measured:** real-device FPS. **What was left in each replay** (about 390 k): grass billboards 168 k (two
whole-town instanced meshes; addressed by the grass entry above), whole-map
terrain meshes 97 k, and the 3 or 4 large wall meshes whose sphere crosses the scissor (66 k). Wall meshes are one per
build call, so a big building is all-or-nothing for both culls; splitting them spatially is the next step for bricks.

## 12 Nov 2026: where a quiet frame's triangles go (town, player only)

Question: what has always kept the game slow even with nothing happening? Measured in the headless harness at 400x225,
pixel ratio 1, in town right after load (player and one hound, before the NPCs arrive). Counts are exact; see the
caveats on timings at the end.

**One frame is 3.90 M triangles in 839 draw calls, and only 0.94 M of them are the picture.**

| Inner render (segmented with `scene.onBeforeRender`) | Triangles | Calls |
| --- | --- | --- |
| Real world draw | 941,644 | 397 |
| Real shell outline pass (layer 1) | 55,862 | 65 |
| PNG occluder depth | 5,592 | 4 |
| Three scissored replays of nearly the whole world (held/foot depth, shell x-ray depth, depth restore) | 3 x ~900,000 | 110-125 each |
| Ground replay (layer 28) | 167,954 | 15 |
| Hands + feet themselves (overlay, shell) | 2 x 7,280 | 4 each |

So **74% of the triangles in a frame are depth replays whose only purpose is to sort the player's two hands and two
feet (7,280 triangles) against the ground**, into a scissor rectangle covering 3-3.5% of the screen. Hiding those four
meshes drops the frame from 3.89 M to 1.00 M triangles (462 calls). The replay cull does hide 1,358 objects outside the
scissor, but `isReplayCullable` refuses anything that is an `InstancedMesh`, has `frustumCulled === false` or has
children, and those are exactly the heavy ones: every brick, every grass blade, the whole-map terrain meshes and the sky
domes are resubmitted in all three replays. The scissor saves pixels, not vertices.

Wilderness (`map_western_slope`, one burrow NPC nearby) shows the same shape: 1.98 M triangles per frame, about 0.3 M in
the real draw and about 1.6 M in five replays (80%).

**What the real 0.94 M world draw is made of:**

- **Bricks, 567,350 (60%).** `Roughbrick1.glb` is 70 triangles and every wall and path brick is its own instance: 8,653
  instances (5,797 wall, 1,793 + 1,063 path). `MeshStandardMaterial`, `frustumCulled = false`, no per-chunk bounds, so
  all of them are drawn whatever the camera sees; 27% had their origin inside the view frustum.
- **Grass billboards, 168,132 (18%).** 84,066 instanced quads in two meshes (14 crossed pairs per tile),
  `frustumCulled = false`; 20% inside the view frustum.
- Terrain 97 k, sky 31 k (seven 64x36 spheres), surface roots 29 k, shingles 17 k. Player rig about 20 k.
- Trees did not make the list: they are separate culled meshes (about 920 hidden by frustum culling in this view), so
  leaves are not the base cost here. Not measured in a dense forest view.

**Depth complexity** (every mesh drawn additively with no depth test): mean 22 layers per pixel, p95 43, max 109. Sky
is 7 full-screen layers on every pixel (sky dome, three cloud depth masks, three cloud shells), bricks 2.5, grass 1.85,
shingles/log walls 1.4 (10 where they cover), terrain 0.7, house pieces and the rest about 8. This is an upper bound on
overdraw, not shaded fragments: depth testing rejects much of it.

**Ruled out:** shadows (the map is enabled but no shadow pass ran: zero shadow draws in any scene measured), and
render-side JavaScript (a CPU profile of the frame is over 98% inside the GL process; scene traversal and the replay
classification are a few ms).

**Software-raster timings (relative only).** Synchronous base + shell frame, `gl.finish()` plus a one-pixel read:
full 4.6-4.8 s; hands/feet hidden (no replays) 1.35-1.44 s; no outline pass 2.78 s; grass hidden 0.61-0.66 s; grass
hidden and no replays 0.22 s; bricks hidden, no measurable change. Forcing `uDensity = 0` (every grass fragment
discarded at once) changed nothing, so the grass cost here is per-instance/primitive work in the software rasteriser,
not shading. That 7x grass figure is very likely exaggerated by SwiftShader and must be checked on a real device with
the existing grass toggle before acting on it; the triangle and pass counts above do not depend on it.

**Crowd scaling, for scale:** the same view about ten minutes later, with town NPCs present, was 6.98 M triangles and
2,384 calls.

**Candidate work, in the order the numbers suggest** (the brick and sky half of (1) is done, see the entry above):
(1) give instanced bricks and grass real per-chunk
bounds so both the camera and the replay cull can drop them, and keep sky domes out of depth replays; (2) a cheaper
brick (a box is 12 triangles) or a distance LOD, and a cheaper material than `MeshStandardMaterial`; (3) chunk the
grass so off-screen tiles are not submitted; (4) see whether hands/feet can be depth-sorted without redrawing the
world (the 3% scissor suggests a small local proxy would do).

### Measurement traps (12 Nov 2026)

- **Wrapping `renderer.render` on the instance attributes the replays to the outer pass.** `held-object-render-order.js`
  wraps below that and calls the raw render several times inside one "shell outline" call, which made the shell pass look
  like 1.88 M triangles when the real one is 56 k. Segment with `scene.onBeforeRender` and attribute triangles by wrapping
  `renderer.renderBufferDirect`.
- **`requestAnimationFrame` in this sandbox ticked at a flat 5.0 s per frame** whatever was hidden, so frame intervals
  say nothing. Time a synchronous render instead.
- GL state read in `scene.onBeforeRender` (colour mask) is the previous pass's state; do not label passes with it.

## 12 Nov 2026: swing geometry, melee misses, and strike-triggered saves

A swing can clear vegetation and immediately serialize both the farm layout and world-member state.
Combat kills also awarded Motes, skill XP and weapon mastery or armor XP through separate synchronous
writes of character metadata. The strike paths now update tiles, inventory and progression in memory
and queue the appropriate saves for browser idle. An explicit character save absorbs queued progression
for that character. Backgrounding or leaving flushes pending work.

With the game's Three.js r128, a twelve-frame moving swipe fixture went from four allocated lanes to one,
12 position-buffer writes to one, and 12 color-buffer writes to nine. All 408 world-space vertices agreed
within Float32 precision. Highlight colors still follow the sweep, while the hold updates opacity and
the player position translates the mesh. Enemy ribbons refresh their bounds when reused so the renderer
can cull off-camera swipes.

A horizontal distance check uses the nearest edge of the target box before running the detailed melee
grid. In a fixture of 300 out-of-reach lunge probes this removed all 300 ray and closest-point queries.
A seeded comparison produced identical decisions for 20,000 checks, including 10,000 diagnostic snapshots.
Pixel Probe reports skipped grids and ribbon buffer writes alongside the existing strike CPU timers.
The Chromium launch failed before game boot because its process socket was denied. Device frame times
remain unmeasured.

## 11 Nov 2026: per-NPC rig triangle cost (why a visible crowd is still slow)

Measured in the headless harness with the real game (exact geometry counts, not FPS). One town NPC rig was
**13,396 triangles**, drawn again in every scene pass (base world, held/foot overlay, PNG depth, shell/outline
x-ray replays). Draw calls per rig are small (~6 per pass); the cost is vertex/triangle volume times pass count.
`frustumCulled=false` on every rig mesh means no pass skips a rig on its own; only `NpcViewFrustumCull` hides
fully off-camera ones, so a crowd that is genuinely on screen pays full price in each pass.

- Skinned portrait plane: 28x36 cells, built front *and* back = ~4,000 tris (12,096 verts, non-indexed).
- Pants garment: 64x64 grid = ~8,200 tris (about two thirds of the rig).
- Hands/feet: 13 tiny meshes, negligible.

Change: one shared **mesh budget** (`PNGPlaneAvatar.meshBudget`, table in `png-plane-avatar.js`). Option
`meshBudget: 'npc'` on `buildSinglePlaneAvatarModel` and `PantsGarmentRenderer.attach/attachToLegs` selects it
(`'full'` is the original detail). `npc` budget: portrait plane 20x26 cells, pants 32x32 grid (`handle.segments`),
enemy head-mask grid 34x44, animal/livestock/pet planes clamped to 30 segments. Town NPCs, every `BanditCombat`
humanoid (bandits, ghouls, skeletons), the ancestor statues and all animal planes use it. The player defaults to
`full`; Settings > "Player uses the NPC mesh cap" (stored per device, `hobunji_player_mesh_budget_v1`) switches
the player rig and rebuilds it. Measured in the real game: NPC rig **5,300 tris (-60%)**, enemy portrait plane
12,096 -> 6,240 verts, animal planes (dabinggi-hound) 1,078 -> 434 verts each, player pants 4,225 <-> 1,089 verts
when toggled.

**Not measured:** a real-device FPS gain. The headless whole-frame totals did not change between old and new
(they did not include the NPC passes), so only the per-rig counts above are claimed. Visual check of neck/hip
bend at close range with the coarser grids is still owed. Next levers if still slow: distance-based LOD, dropping
distant NPCs from x-ray/shell/depth replays, and a plain quad for frozen ancestor statues.

### Patterns (11 Nov 2026)

- **Fur-lined hood "missing base pattern" is layer coverage, not a failed pattern.** The base pattern renders
  (identical for every species, 24-49% of pixels on an ordinary hood), but the opaque fur trim sprite covers 84%
  of the base sprite, so only ~16% of the base is visible (5-10% patterned). Fix would be art/layer order, not code.
- **Flaky first-load patterns:** `RepoPatternLibrary.load()` cached a failed/empty load for the whole session and
  fetched with `no-store`, so one failed request left pets/garments unpatterned until reload. It now retries (4 s
  back-off), warns, and revalidates with `no-cache`. `scripts/test-repo-pattern-library-retry.js`.
- Still silent by design: `renderClothingLayers` falls back to plain unpatterned art if the weaver throws, and
  `renderProfileWithWovenPatterns` keeps the first render if every pending pattern composite rejects.

## 10–11 Nov 2026: camera-aimed NPC visual cost and depth replay

An Opera recording of Tzizkhanash reported **2–4 FPS** while looking
across the crowded town, versus **13 FPS** looking at the sky from the
same session. The user independently identified NPCs as the trigger.
These are real on-device FPS observations, but **not** controlled GPU
time measurements; changes of scene coverage and render passes can
contribute. Avoid comparing different camera angles as matched
benchmarks.

The NPC walker visuals include skinned PNG portrait planes, GLB hands,
feet, and pants. Several intentionally set `frustumCulled=false` to
protect moving/deformed vertices. That is safe for correctness, but
Three.js continues submitting them in the world draw and repeated
x-ray/depth renders even when the entire NPC is outside the camera
or an already-scissored depth-repair region.

- `NpcViewFrustumCull` uses a **generous actor-root sphere**, not
  untrustworthy skinned-mesh bind-pose bounds. It suspends complete
  off-camera NPC visual roots *only within the synchronous world-render
  call*, restoring them in `finally` before NPC schedules, collision,
  dialogue and animation update. Near and very large actors retain
  generous bounds. NPC simulation remains fully active.
- Both held-object and shell-outline **local colorless-depth replays**
  now skip unrelated NPC visual roots whose entire conservative sphere
  is outside the group scissor. Meshes belonging to the group being
  reconstructed are explicitly protected; global depth restoration
  and tile/elevation x-ray shader policy remain unchanged. Every
  temporarily hidden rig is restored immediately after its depth draw.
- The PNG occluder registry now checks ancestor visibility, so
  render-suspended NPCs don't force an unnecessary alpha-cutout
  occlusion draw. It retains entries for attached but hidden NPCs and
  prunes only actually detached/despawned portraits.
- Settings > **Performance & diagnostics** includes two mobile-accessible
  A/B controls: default-on *Cull completely off-camera NPC visuals*
  and opt-in *Hide ALL NPC visuals (diagnostic ONLY)*. The latter
  deliberately makes scheduled NPCs visually absent but leaves
  simulation running; turn it off after comparing the **same view**.
  The profiler reports main-view hidden NPCs plus local depth-replay
  skips so a zero-effect case can be distinguished from an actual
  optimization.
- Regressions: `scripts/test-npc-view-frustum-cull.js` and
  `scripts/test-npc-png-depth-ancestor-cull.js` exercise shipping
  helpers, scene ownership, near/oversized actors, camera changes,
  protected x-ray owners, errors, and reversible PNG registry state.

**Tradeoff:** the new culling removes out-of-view visual work, not the
draw cost of NPCs genuinely visible in the current camera view.
The user should compare identical angles with view culling on/off
and with NPC visuals temporarily hidden to quantify the residual
visible-rig cost. Actual per-scene FPS gains are **unmeasured**.

## 10 Nov 2026: held replay, hostile perception and reticle hitbox work

Targeted follow-up to the historical 19–29 ms held replay, 10–12 ms `updateHostiles`
and 2–7.5 ms shoulder reticle baselines below. These changes remove identified
redundant work; those old timings are **not** post-change measurements.

- Held parts proven unable to intersect their holder's same-floor neighborhood now
  retain base world depth. A colorless supplement repairs PNG cutout and protected
  cover depth while skipping ordinary opaque leaves. With only ordinary participants,
  replay uses two passes instead of three, without redrawing opaque terrain in the
  supplement. Real x-ray groups still rebuild depth and restore ground before tint.
  The exception remains the holder's tile plus eight neighbors at its standing floor;
  distant walls and cover continue to occlude. Unknown bounds/ownership and renderers
  without color-mask locking keep the existing conservative path.
- `EnemySearchAI` leases geometry perception for at most 100 ms, staggered across a
  crowd. Range and facing eligibility, movement, cooldowns and attacks remain live.
  Target/area changes query immediately; cached visibility never fabricates updated
  last-seen coordinates. A 60 Hz deterministic moving-crowd fixture performs 318
  geometry queries instead of 1,800 for 30 actors over one second (321 including
  explicit invalidation checks). Tradeoff: a new geometry occluder can take up to
  100 ms to affect perception.
- `RangedWeapons.actorHitbox` now uses the existing game-frame serial shared by AI,
  reticle and projectile consumers. Slow frames no longer expire the old 16 ms cache
  in the middle of a batch. Position changes invalidate within a frame, and standalone
  tools retain their short wall-clock fallback. Hitbox math is unchanged.

Review follow-up: hitbox reuse also validates each portrait ancestor's position,
quaternion, scale and identity, using reusable metadata. Nested rigs invalidate on
parent movement or reparenting within a slow frame; manually managed matrix nodes
use fresh geometry. A composed perception/LOS regression also found that the first
60 ms staggered decision could reuse the inner 80 ms LOS cache and defer a new wall
until the next decision. Due perception decisions now explicitly refresh geometry,
so the two leases cannot stack. Both regressions failed before these fixes.

`test-held-ordinary-depth-budget.js` executes the compositor with ordinary, mixed,
fallback and throwing-renderer fixtures; `test-combat-hotpath-budgets.js` executes
perception and hitbox ownership. Pixel Probe exposes saved depth clears/skipped
leaves, sight queries/reuses and hitbox builds/reuses. Draw savings are CPU
submission counts in controlled fixtures, **not** real-device FPS or GPU timings.
A live headless launch was attempted, but this environment denied Chromium's
process-singleton socket (`Operation not permitted`), before any game page ran.

## 10 Nov 2026: attack-frame hitch investigation — pooled melee swipe ribbons

The shared `Combat.spawnMeleeTrail` path, used by player and humanoid/bandit strike effects, allocated
a new BufferGeometry, index array, position buffer, material and Mesh for **every** displayed
attack ribbon, then disposed them after roughly 0.34 seconds. Multi-affliction bandits can
spawn up to four differently colored ribbons per strike. This is a credible source of
one-frame CPU allocations, GPU buffer uploads and shader state churn **on impact**, but has
not yet been isolated in a real-device trace as the cause of the reported pauses.

The shared combat owner now reuses fully retired ribbon meshes and position buffers across
attacks, resets geometry/colors/opacity for every new hit and keeps at most 64 idle ribbons;
overflow is disposed. A regression fires 70 simultaneous trails and checks distinct live meshes,
the bounded cache, cross-scene reuse and scene cleanup. The existing Performance Profiler now
measures separately the **player** and **enemy** strike callbacks; Pixel Probe shows their last
and peak measured CPU milliseconds alongside GPU ribbon allocation/reuse totals. Timings
appear only with the profiler enabled; they do not include GPU render time.

**Follow-up observation:** the freeze also occurs on swings that miss. Bandits create their
swoosh ribbons before hit testing, so those attacks still exercise the pooled path.
The new regression explicitly fires a missed hostile attack without damage and confirms
the ribbon is recycled. Additionally, the bandit weapon-pose update measures its own CPU
time while the swing or recovery is active (with Performance Profiler enabled); Pixel Probe
reports the peak/last per-bandit pose cost. No production FPS improvement is claimed.

**Important distinction:** `GameFeel.hitStop` deliberately slows simulation by up to 0.14 s
on certain hits while rendering should continue. A perceived animation pause at the
impact frame is not proof of a GPU or JS stall; **a completely missed attack does not
explain itself through hit-stop**. Compare hardware frame time, the new swing-pose profile,
strike callback max and hit-stop events before declaring a full freeze fixed.

## 10 Nov 2026: creature combat burst particle batching

Grehlr stink spray emitted one Three.js tetrahedron Mesh per droplet; Voorg-Ass Rear Kick emitted
18 separate tetrahedron Meshes (nine of each earth shade). Each was separately visited by scene
render passes even though the geometry and materials were already shared.

`Combat.animalAttacks.createParticleBatch` now provides a single instanced draw per material,
with per-attack lifetime, transform, death and cancellation ownership unchanged. Both attacks
use it where supported and fall back to their existing individual-mesh path otherwise.
In a synthetic renderer contract test, one active Grehlr spray uses one submitted mesh,
and the 18-particle Voorg kick uses two instead of 18. Instance buffers are released on
attack completion/cancellation. This is a **draw-call-count improvement**, not a real-device
FPS measurement. It is independent of the larger shell-outline and enemy AI costs above.

## What the symptom turned out to be

"Slow in the wilderness, gets worse after fights, never recovers" had **two** causes, both fixed:

| Cause | Why it was invisible | Fixed by |
| --- | --- | --- |
| A settled, un-looted bandit corpse keeps its whole humanoid rig forever (~90 scene objects, ~50 draw calls each, in every render pass). | Wildlife corpses stream to data (`isStreamableCorpse`), but it excludes `isBandit`, so fights piled up bodies that never went away. | `Oolnokk/HobunjiHollowUnity#1465` — `docs/js/bandit-corpse-retirement.js` |
| The inactive-zone cache could not evict any zone that had a bandit in it, so zones stayed built (~175 MB each). | `zoneEvictionBlocker` treats every bandit, alive or dead, as a resident rig; one or two idle bandits per zone pinned all four zones. | `Oolnokk/HobunjiHollowUnity#1469` — `docs/js/zone-bandit-release.js` |

Numbers (headless, per frame):

- 30 bandits killed through the real death path: draw calls 252 (empty arena) → ~1,700–1,900 alive → **1,864 five
  minutes after every one was dead** (no decay at all; the alive and after figures come from separate runs, which
  differed by about 10%). After #1465 and walking away: 734 draw calls and 778 scene objects instead of 1,864 and
  2,962.
- Four wilderness zones visited with a return to town between each: before #1469 all four stayed built and the JS
  heap (after a forced GC) went 319 → 1,026 MB; after, one zone stayed built and the heap ended at 796 MB.

### Barbarians (Porakaneki / Omgurku hunters) are covered by both fixes

They *look* like a separate system, and parts of their lifecycle are, but their corpses and zone residency go
through the bandit path:

- They are built by `BanditCombat.makeEntity`, which sets `isBandit: true` unconditionally; the tribe flags
  (`isTribeHunter`, `tribeId`, older `isPorakanekiHunter`) are merged in afterwards and do not clear it. Verified
  in-game on 11 materialized hunters: `isBandit: true`, `isTribeHunter: true`, no `keepCorpseAfterLoot`, no
  `lootHoldSeconds`.
- A hunter that dies while materialized (player in its chunk) becomes an ordinary corpse and the tribe update
  loop then skips it for good (`if (hunter.entity?.health <= 0 …) return`), so nothing ever tears it down. Only an
  off-screen death (`slayHunter`) leaves no body, and only those are ever replaced (`replaceSlainResidents`).
- **What *is* different:** a *living* hunter the player moves away from is hidden under
  `__porakaneki_dormant__:<zone>` and torn down 3 s later (`retireDormantEntity`). While dormant its `areaId` does
  not match the zone, so it is never a zone resident and never pins eviction.
- Camps are large: a small camp has 13–15 residents (15–17 hunter records) and a chief camp 6, against 2–4 bandits in
  a bandit camp, and all four wilderness zones had at least one Porakaneki camp. That, not a different mechanism, is why barbarian fights dwarf bandit
  ones.
- Measured: 11 tribe hunters killed, player walked away: the default corpse cap swapped 5 of 11 (the other 6 keep
  rigs by design); with the cap lifted 11 of 11. Leaving the zone then released all 11 and evicted it (642
  materials, 257 textures freed). No page errors, and re-entering was fine.
- Loose end, harmless so far: after the release the tribe's own camp record still says `materialized: 11`, i.e.
  `hunter.entity` still points at the despawned dead entities. The 11 stay dead (as before) and nothing throws, but
  the entity objects themselves are retained by the camp record.

## Looked like the cause, was not

| Suspect | Verdict | Evidence |
| --- | --- | --- |
| **The player's character data** (a save with ~400 KB of woven clothing, 15 embedded PNGs, 8 stable creatures, a companion and a mount). | Not the cause. | The same world with that character and with a default one: draw calls 1,338 vs 1,870, triangles 4.0 M vs 4.4 M, heap 298 vs 441 MB. The custom character was not heavier. |
| **The wilderness terrain / zone scene itself.** | Not the cause. | Standing idle in a built zone: 571 draw calls and 0.87 M triangles per frame, lighter than the town (1.3–1.9 k, ~4 M). The cost is entities (bandits, tribes, corpses), not ground, foliage or cliffs. |
| **"The town gets 2.7× heavier after visiting the wilderness."** | Artifact. | In the headless run the opening-story sequence finishes late and spawns a companion and an armed Spearhead in town at about the same moment. Visiting a zone does not do it. |
| **The dev arena's "Kill All" button as a way to kill bandits.** | Does not kill. | It makes one `damageCreature(c, c.health)` call per bandit, which dodge frames, damage blocking and multipliers reject: 29 of 30 were still alive and fully active 5 minutes later. "Cost after Kill All" measurements are measurements of living bandits. Use `damageCreature(c, big, x, y, 0, { environmentalImpact: true })` to kill through the real death path. |
| **Outline passes as the cause of the *persistent* slowdown.** | Not that cause, but see "Real but not fixed". | Toggling outlines showed no clear effect in a town test (the scene was still loading between the two phases, so the comparison was noisy); the cost shows when many outlined characters are present. |
| **Wildlife not being evicted.** | Works. | Wildlife drops to data at trim time (`releaseResidentRigs`); in the zones that stayed built the only pins were bandits. |

### Measurement traps (these produced wrong conclusions at least once)

- **`renderer.info` is reset on every `render()` call**, so reading it after a frame shows only the last pass
  (typically `calls: 1, triangles: 2`, the fullscreen composite). Set `renderer.info.autoReset = false` and reset it
  yourself once per frame. Note `info.reset()` also increments `info.render.frame`, so that counter is *not* a render
  count.
- **The `[outline-perf]` log lines are totals over a logging window, not per frame.** `base 6x` is six passes in
  the window.
- **`PerfProfiler` subsystem averages are not windowed per phase**; two phases printed identical numbers. Use a CDP
  CPU profile per phase instead.
- **Do not wrap `THREE.WebGLRenderer` from an init script** (it breaks `dynamic-surfaces.js`, already in AGENTS.md).
  Hook `window.__hobunjiGameRenderer.render` after it exists.
- **Wait out the opening story.** With `?skipIntro=1&skipRescue=1&skipMeeting=1` it still completes in the background
  (log line `opening sequence complete`), and then teleports the player to town about a minute later, which looks
  exactly like "the player got bounced out of the zone". Wait for that line plus ~100 s before entering anything.
- **The wilderness is locked until the farm tour is done.** `enterZone` returns silently (with a toast) otherwise.
  In a throwaway test profile, `OpeningStoryCutscene.updateStory(profile, { farmTourComplete: true })` unlocks it;
  setting the legacy localStorage key does not, because the world's saved story record wins.
- **A zone's entry tile is its exit tile** (e.g. `map_western_slope` is 48,20), so `enterZoneDebug(zone)` with no
  coordinates drops the player on the exit gate. Pass an interior tile.
- **Screenshots time out in the wilderness** (a software-GL frame can take more than 30 s). Make them optional.
- **Bandit counts in a zone drain on their own** (several down to 0 within about a minute with the player idle,
  without leaving corpses). That is existing behaviour and its cause was not investigated; it is why the number of
  bandits pinning a zone varied between runs. Camps themselves (the `BanditCamps` records) stay.
- Piping a log watcher through `cut` buffers it and delivers nothing for minutes; use `grep --line-buffered` only.

## Heap growth across zone visits (retainers found and mostly fixed)

After #1469 only one zone stays built, but the JS heap still climbed with every visit. This was run to ground with heap
snapshots. Read the method first; two earlier readings of this problem were wrong.

**Method that worked.** Eight visits (each of the four zones twice: 25 s in the zone, back to town, 16 s for the trim)
after the opening story. Three full heap snapshots (`HeapProfiler.takeHeapSnapshot`, after two forced GCs): baseline,
after visit 4, after visit 8. V8 object ids are stable inside one process and a new object always gets an id above the
previous snapshot's maximum, so "created during visits 1-4 and still alive after visit 8" is `id in (max0, max1]` in the
last snapshot. Group those by their shortest retaining path from the GC roots (BFS over strong edges; skip weak and
shortcut edges) and look at which named properties and closure variables sit on the path. Snapshots are 450-950 MB
files, so parse them with a streaming reader, not `JSON.parse`. Allocation-site profiles (`HeapProfiler.startSampling`)
say *who allocated* the surviving bytes, not *who holds them*; they sent this investigation to the wrong modules for a
while (water outline, terrain geometry) because those allocate a lot of data that is then correctly freed.

**Numbers.** Surviving objects created in visits 1-4 and alive after visit 8: 130 MB before the fixes below, 67 MB after
(about 60% of what is left is `ArrayBuffer` data of geometries and textures). Forced-GC `performance.memory` after
eight visits: +334 MB before, +199 MB after. Second-pass growth after the fixes is about 4 MB per visit (see below).

**Holders found (all kept an evicted zone's data reachable):**

| Holder | What it held | Fix |
| --- | --- | --- |
| `foliage-furniture-renderer.js` bridge + `foliage-furniture-runtime.js` `spawnForMap` | A failed V27 generator load abandoned its hidden iframe (a whole page, plus its three.js) and the next furniture record started another; the spawn loop waiting on the generator kept the zone scene reachable. About 87% of the survivors in the first snapshot set. | Remove the iframe on failure and back off 60 s; `disposeMap` cancels the loop and it re-checks the live scene after every await. `scripts/test-foliage-bridge-and-spawn-lifecycle.js` (uses a real GC). |
| Bandits put to sleep by `wilderness-simulation-lod.js` | They get `areaId = "__wilderness_lod_sleep__:<zone>"`, so `zoneResidents(mapId)` never matched them: they did not pin the zone and `ZoneBanditRelease` did not despawn them. Each kept `.scene` and was still in `hostileObjects`, which kept the evicted scene (and, through three.js's per-scene render lists, its geometry) alive. | `zoneResidents` matches `_wildernessLodAreaId` for sleepers. |
| `seasonal-vegetation-tint.js` `trackedMaterials` (and the seven per-kind sets) | Every material ever built, until `dispose()`. Eviction only disposes materials it can prove no live scene uses. | Weak sets (`WeakRef`). `scripts/test-seasonal-tint-weak-materials.js`. |
| `zone-plateau-mesa.js` `_mesaBatchesByMap` | Render batches and hidden source meshes of evicted zones; only released on a rebuild. | `ZonePlateauMesa.releaseZone(mapId)` from `_disposeZoneScene`. |

**The `Documents` / iframe growth was mostly a sandbox artifact.** `docs/references/(HA)FoliageGeneratorV27.html` imports
three.js from `unpkg.com`. The headless sandbox blocks that host, so every furniture record failed after a 15-25 s wait
and leaked an iframe (`Documents` 2 -> 25). With `unpkg.com` allowed the bridge starts once and `Documents`, iframes and
DOM nodes stay flat across eight visits (3 / 2 / ~24.7 k). The structural defects are still real for a player who is
offline, behind a blocking proxy or on a slow network, which is why they were fixed anyway. If you measure DOM growth
here again, allow `unpkg.com` first.

**Re-checked after main's Tzatzul nest/cliff-spire work (#1453) was merged in.** `TzatzulCliffSites` (bird-only spires in
`map_northern_cliffs` and `map_western_slope`) keeps the zone's scene in its `areas` map and only released it on the next
area change, so `evictZoneScene` now calls `TzatzulCliffSites.releaseArea(mapId)` itself. Its perches (`PerchSupport`),
`TzatzulLiveVisuals` and the flight runtime already drop their zone state on area change. Nest caves are building scenes,
not zone scenes: `TzatzulNestEncounter` keeps small per-cave records and carried victims for the session on purpose, bounded
by the four nests. The same eight-visit snapshot run on the merged build showed no Tzatzul objects among the survivors
(49 MB survived, forced-GC heap +161 MB over eight visits), but a bird may not have spawned during those visits, so this
is a code review plus a clean run, not proof that a spawned bird leaks nothing.

**What is left is small and bounded (second pass over the same zones).** The "survivors" lists above are dominated by
things that are created on a zone's *first* visit and then stay, so they overstate creep: per-zone caches such as
`_banditZoneViews`, `PorakanekiCampPlacementPolicy` grid refs, the water `domainCache`, tree variant templates and
the zone currently kept built. The test for real creep is the second pass. Snapshots after visit 4 and after visit 8 are
both in the same zone (eastern mire), so everything that differs is growth: self size 499.1 -> 515.7 MB (+16.6 MB over
four visits, about 4 MB per visit, +3%), 7.26 M -> 7.37 M heap nodes, and 11,182 -> 11,357 live `BufferGeometry` objects.
Before the fixes the first four visits alone left about 350 MB behind (self size 686 MB vs 499 MB after).

An orphan-geometry census confirms it. Scratch instrumentation wrapped `BufferGeometry.prototype.setAttribute` and
`dispose` to record each geometry's creation stack in a `WeakRef` list, then after two forced GCs listed geometries that
are alive, never disposed and not reachable from any live scene (`traverse` over town, building and zone scenes). Between
visit 4 and visit 8 the list is identical except for counts of a few tree-variant templates: the only large entries are
the current zone's two path-network geometries (held on the zone record, not in the scene) and the camera-occlusion
chunk geometries, which share the source mesh's position buffer, live on the source geometry (`geometry[INFO]`) and are
dropped with it. So the ~10 MB of `WebGLBindingStates` entries (`__hobunjiGameRenderer > clearDepth > ... setup > o`)
seen in the snapshots belong to geometries of the live zone, not to a growing pile of abandoned ones.

**Not fixed, not growing (a few MB each):** `HobunjiDualWieldWeaponVisuals` `carriedPoses` (7 -> 1 MB after the other
fixes), `_nestContentStates` (den nests hold `scene` and `grid`; gone from the survivors after the sleeping-bandit
fix, but it keys state by scene, so check it if zones start surviving again), `bandit-camps.js` `_banditZoneViews`
(one tile grid per zone ever visited, removed only by `forgetZoneBanditState`, so it is bounded by the number of
zones), `MergedWaterRenderer` `domainCache`, `enemySightOccluderMeshes`. If the heap climbs again, re-run the
second-pass comparison first: if self size between two snapshots of the same zone grows by more than a few percent,
something new is leaking; take the `survive` listing and look at the holder paths that do not belong to a per-zone cache.

Scratch-only debug hooks were used for the measurement and are not in the repo; the analyser logic is described above
(BFS retainer paths over snapshots, id-range to date objects). Hooks that are in the game and useful here:
`__zoneCacheDebug` (`built()`, `blocker(mapId)`, `history()`), `HobunjiCacheAudit`, `renderer.info.memory`.

## Cliffside fight trace (9 Nov 2026)

The Opera trace during a fight with Omgurku showed about 4.36 s inclusive in `findNpcPath`, 2.16 s self time in
`isNpcPositionWalkable`, and 2.40 s of style recalculation across the capture. NPC A* now discards edges that
cannot improve the route before sweeping, reuses checked center footprints, and skips repeated structural
point checks inside a clear body footprint. Ruin entrance boxes are indexed when the zone meshes build, and
table point probes go directly to one bucket. The action arch also keeps its decorated buttons intact when
reticle movement leaves their action and markup unchanged.

In a deterministic 24×24 cliff fixture, an unreachable search expanded the same 287 nodes with 402 sweeps
instead of 1,038. Exact structural provider calls dropped from 86,640 to 3,210 per search, including point
calls through the old furniture query. All 240 seeded route comparisons matched, including maps with ramps
and elevation changes. Pixel Probe reports skipped A* edges and action-button markup writes. The trace
does not attribute style recalculation to a specific caller or isolate a Three.js render pass. These
measurements are from the collision fixture, and the change has no live fight FPS measurement yet.

## Real but not fixed (start here if you are asked to go further)

Ranked roughly by how much the numbers say they matter. None of these were the "never recovers" cause.

**9 Nov 2026: screenshot-guided shell replay improvement.** A live Opera Performance capture with an in-game readout around 1.2 FPS showed repeated recursive Three.js stack entries and an NPC instrument-schedule entry with negligible self-time. This is evidence of rendering/scene-work cost, not of NPC scheduling as the culprit; the capture did not isolate individual passes or prove a particular Three.js method. In `held-object-render-order.js`, the shell x-ray replay now enumerates visible depth and shell candidates **once after scissor culling**, then reuses those candidates for each elevation group's material preparation and shell masking, and the final depth restore. For N groups, this removes 2N redundant full-scene traversals while preserving per-group material restoration, GPU passes and the flood-depth ordering contract. `HeldObjectRenderOrder.snapshot().shellSceneTraversalsAvoided` counts the estimated avoided traversals. The unit test verifies the same candidate membership and fallback live-scan behavior; **real-hardware FPS and GPU costs have not yet been measured after this change**. Re-capture base/shell/held replays on the same camera before asserting a speedup.

1. **Shell outline pass cost in fights.** With 30 bandits the shell outline pass drew more calls (984) than the main
   scene (758). Turning outlines off cut draw calls and triangles by 59% and render CPU by ~40%; a trace from a
   player's real machine during a ~28-bandit fight showed world render passes 104 → 60 ms with outlines off. It scales with the number of
   outlined characters. Untested idea: outline only the nearest few.
2. **`updateHostiles`** (perception work reduced by the 10 Nov follow-up above; re-profile remaining cost): ~10–12 ms per frame with 30 bandits (JS, not GL), independent of outlines. Matches the
   real-hardware trace (10–12 ms).
3. **`updateShoulderSurfReticleAim`** (shared frame hitboxes added above; re-profile remaining cost): 0.2 ms empty → 2–7.5 ms with 30 bandits (it varied between runs).
4. **Held-object overlay replay** (`held-object-render-order.js`; ordinary-depth replay reduced above; re-profile actual x-ray/shell groups): 19–29 ms in the real-hardware trace and it stays
   with outlines off. The pass-start stack traces point at `replaySelectiveHeldOverlay` and `replayShellOutlineXray`.
5. **Scheduler `checkpoint` ~5.5 ms**: this is only the dispatcher for every `pre-render` subscriber, so it is the sum
   of many modules. The scheduler's `getDebug()` has per-subscriber timings; the real-hardware trace named
   "procedural hand pose sync" (~8.5 ms) as the biggest scheduler entry.
   - A subsequent targeted pass (PR #1559, 8 Nov 2026) removes per-sync non-sweep visual-plane traversals,
     reuses the visual grip basis across two-handed sockets, reuses quaternion ancestor buffers, and
     updates free-hand fallback poses in place rather than allocating six nested pose objects per
     two-hand update. It preserves animation cadence and the sweep/grip math. The attached deterministic
     tests check output parity and lookup counts; **real-hardware CPU/FPS improvement has not yet been
     measured**, so keep the ~8.5 ms trace as a historical baseline rather than a verified new figure.
6. **The heap grows slowly across zone visits** (about 4 MB per visit on the second pass after the fixes; was ~25-40).
   The remaining holders are small and bounded; see "Heap growth across zone visits" before touching it.
7. **The corpse swap keeps the newest 6 per area and any within 5 tiles of the player** (`keepFull`, `nearTiles`,
   `minSettledS` in `SCRATCHBONES_CONFIG.game.banditCorpseRetire`). Defaults were picked from arena tests; a tribe camp
   of 15 leaves up to 6 full rigs behind. Tune with measurements. A distance rule (`farTiles`, default 24 game tiles = the Porakaneki release radius) now also swaps settled bodies far from the player regardless of that cap: a wilderness AI snapshot showed barbarian corpses at 27–31 tiles still fully rigged and visible while their living camp-mates were already data. Tradeoff: walking away from a fresh pile turns it into flat markers; coming back does not restore the bodies (still lootable). Not yet measured in-game.
8. **UI-side suspects from a user-run browser trace**, not reproduced or measured here: the potion-select icon being
   toggled by two scripts, and `inventory-gear-compact-effects.js` `refreshPresentation` (1.56 s of style recalculation
   in one trace; it reads `getBoundingClientRect` from a `requestAnimationFrame` callback, which I did confirm).
   Their per-call cost (5–12 ms, intermittent) was small next to the render passes.

## Gameplay tradeoffs the fixes introduced

- Returning to a zone left two zones ago shows **fresh bandit camps** if bandits were present when it was evicted
  (the camp state is forgotten so it re-seeds). Un-looted bandit/tribe corpses in an evicted zone are gone, and their
  loot with them. `SCRATCHBONES_CONFIG.game.zoneCache.releaseBandits = false` restores the old behaviour.
- A swapped corpse is a flat dark marker, not a body. It is still lootable (looting reads the entity, never the rig),
  and revivable bodies (`keepCorpseAfterLoot`, e.g. a lich's skeletons) and timed-search bodies keep their rigs.
- Bandits asleep under the wilderness LOD now count as residents of their zone, so a zone whose only bandits are asleep is released (and its camps re-seed) like any other bandit zone.


## 13 Nov 2026: chained explosions — effect pooling and save coalescing

- `shattercasks.js`: retired pottery and Soursap sprays return to bounded per-kind pools (maximum six each). Reusing the Three.js instanced meshes also reuses their GPU instance buffers instead of allocating a new mesh and per-flash material on every detonation. Simultaneous sprays remain independent.
- Synchronous Shattercask chain reactions now hold a batching depth: each cleared-area rubble mesh is rebuilt once, and persisted consumptions/terrain/piles are serialized once after the outermost charge returns. The visible rubble and persisted state are still settled before the synchronous detonation call completes.
- `hronal-witch-bombs.js`: Hronal, Tothal and Kanthic bursts each have their own bounded pool (six per variant) and independently animated effects. Legacy `userData.hronalBombBreakable` discovery is cached only inside nested bomb-chain calls; independent same-tick explosions rescan so a first blast can introduce new props safely. Registered breakables still use their Map.
- `dev-random-ruin-lich-themes.js`: Hronal exploding pillar and Tothal icicle sprays reuse per-scene instanced shard meshes keyed by material color and count (up to four retired per style), with explicit active/pooled disposal on arena and ruin teardown. `snapshot()` reports shard reuse and active/pooled sprays.
- Mobile diagnostics: `Shattercasks.debugSnapshot().performance` exposes burst pool hits/misses and blast saves/rubble rebuilds; `HronalWitchBombs.debugSnapshot()` exposes effect pool activity and reused scene scans. The tests exercise actual expiration and reuse of the visual instances.
- Visual first-frame audit: pooled pottery, Soursap, Hronal pillar and Tothal icicle instance matrices are rewritten at emission rather than briefly replaying the previous spray's position. Regression tests verify immediate matrix writes on reuse.
- Review hardening: legacy breakable scans are invalidated when break callbacks might author new props, including inside recursive chains; nested and independent same-tick blast tests cover this. Shattercask persistence now flushes in a nested `finally` even if the post-chain rubble GPU rebuild throws, with an injected-error regression.
- **Not yet measured:** device-specific FPS, GPU upload time, or real-world long chain size. The pool limits trade a bounded amount of retired GPU memory for avoiding repeated allocation; capture a before/after explosion frame trace on mobile before claiming a measured speedup.
