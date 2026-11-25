# Performance investigation log

## 23 Nov 2026: prioritized animal colors and patterns for owned pets

**Observed bottleneck in code:** \`CreatureGeneticsRender.composeFrame\` processed every native-resolution
genotype appearance in strict first-in-first-out order, including wilderness spawns, farm
livestock, mounts, ordinary companions and shoulder pets. A burst of wild requests could
delay the player's own animal, making its fully authored base colors, inherited patterns,
Color Pools surface motifs and eye overlays appear late. The existing wild and farm
texture caches already deduplicate requests; they were not the cause of the ordering.

The same canonical compositor now schedules by role: **player-owned active pets / mounts /
shoulder pets**, then **farm livestock**, then **wilderness and regular previews**.
Only one native-resolution composition runs at once, retaining the existing memory cap;
all patterns and eyes remain atomic (a missing required layer rejects and retries).
Priority is FIFO within each class, with one lower-priority frame allowed after four
consecutive pet frames so wilderness is not starved. The game texture owner can promote
an existing in-flight wildlife request to pet priority instead of composing twice.
Small shoulder heads and split shoulder frames explicitly request pet priority.
For owned pets, the compositor also starts only the *selected* idle/run frame's
required base/pattern/eye artwork and masks while queued CPU work is still finishing.
Ordinary global three-frame prewarming remains opt-in for developer tools.

In-game mobile texture diagnostics through \`CreatureGeneticsRender.memorySnapshot()\`
expose \`queuedPets\`, \`queuedFarm\`, \`composePending\`, \`composeActive\`,
\`composePetStarts\`, \`composePromotions\` and \`petSpritePrefetches\`.
\`scripts/test-animal-appearance-priority.js\` executes the production queue to
assert pet/farm/wild ordering, fairness, promotion, per-pet prefetch and failure recovery.

**Limits:** This removes avoidable *waiting behind other animals* and overlaps pet
network loads with other composition work; a single expensive recolor/pattern pass
still costs its original CPU time. Actual mobile seconds saved and FPS impact have
not yet been benchmarked in an on-device run.


## 23 Nov 2026: Skeeri source-art prewarm and appearance review

Entering a generated ruin now starts `SkeeriRuins.prewarm()` on the normal transition
without awaiting it. The first call downloads the three shared source sprites and rig
JSON, extracts the base coat, darker mint pattern, off-hue details, and independently
colored purple eye once. Later birds reuse the preparation while their individual
body, marking and glowing-eye material colors remain separate. Repeated entry calls
share the same promise and do not allocate another set of source masks.

The eye selector now matches the **scaled #7F00FF marker family**, not arbitrary
purple pixels. It preserves the value of shaded purple pixels; mint body pixels and
dark-green markings remain distinct. The real-art PNG regression checks that every
original opaque pixel belongs to exactly one source partition (the runtime glow is
allowed to blur beyond that partition). Large source passes yield through the
existing `PixelWorkYield` authority between flying/perched/wing masks rather than
running every pose back-to-back during ruin entry. No new recurring frame work.

Mobile Wildlife diagnostics display prewarm-ready state, request/failure counts,
marked eye pixels and fur-marking pixels. Reviewed the priority compositor as well:
optional pet-prefetch errors now fail open to full composition, without permanently
stranding a pet on plain artwork. Standalone tests verify role ordering, fairness,
in-flight promotion, failed downloads, failed composite rejection and queue cleanup.
Legacy cutscene and shoulder animation fixtures were updated to inject the new
priority bookkeeping and owner dependency; the latter now checks that another
player's animal is *not* prioritized.

**Measured here:** functional regressions and synthetic scheduler/appearance
fixtures. **Not measured on device:** wall-clock speedup, GPU material upload
latency per individual Skeeri, or whether the first entry still causes visible
hitches on low-end phones. The prewarm caches *source masks*, not GPU textures for
every possible individual palette. Keep those distinctions when profiling.

## 23 Nov 2026: fog and sky lighting work

Fog reads the skydome's lunar sampler directly, avoiding a full diagnostic
snapshot for each lighting sample. The skydome reuses its time-of-day lighting
table and skips overcast easing once the current value reaches its target.
Device frame times have yet to be measured.

## 23 Nov 2026: Cloud Forest dense wall merged across chunks; wilderness leads measured

A per-render-call draw census of a Southern Cloud Forest frame (headless, fresh world, 480×320,
nothing held) found the dense shadewood wall (`border-terrain.js`, `AuthoredCloudForestDenseChunk_*`)
was 72 of the main pass's 166 draws: ~6 drawn chunks × 12 InstancedMeshes. 36 of those belong to
chunks fading at the corridor edge (transparent per-chunk material clones); the other 36 share
their part materials across chunks.

New render scope `dense-forest-wall-batches` (`js/dense-forest-wall-batches.js`, order 270) draws
those opaque, on-camera chunk parts as one InstancedMesh per (geometry, material, layers, render
order, shadow flags). It is not the tree-instancing loss: the wall is `backgroundScenery`, so the
held/x-ray replays ignore it, and batches rebuild only when membership, a member's count or
matrices change (0 rebuilds over 40 idle frames). A first version merged every drawn chunk and
drew 8–32% more triangles whenever the wall was partly on screen (the camera cull could no
longer drop off-camera chunks); the scope now merges only parts that pass the same
instance-bounds frustum test `instanced-mesh-view-cull.js` applies, and triangles match exactly
in all nine headings tested. Draws: −24 main-pass draws when the wall faces the camera
(162 → 138), −5 to −23 in other headings. Raw renders with and without batches are
pixel-identical (every difference equals the frame-to-frame noise at the player). Not yet
measured on a device. A/B: Settings → Render optimizations → "Merge the Cloud Forest dense
tree wall", benchmark variant `denseWallBatchesOff`, `DenseForestWallBatches.setEnabled(false)`.

Measured and ruled out in the same session (Cloud Forest, same harness):
- **Freezing static matrices.** 5,397 of 5,625 scene nodes recompose their matrix every frame
  and 3,514 sit under hidden parents; only 22 moved in ~150 frames. But freezing the dense
  chunks, mesa source meshes and path-brick chunks (1,526 nodes) cut `scene.updateMatrixWorld()`
  only 1.06 → 1.00 ms: the walk, not the compose, is the cost. The CPU profile's `updateMatrix`
  share overstated it.
- **Authored furniture parts** (bonfire ring stones, crates, logs: ~50 draws in a camp view)
  are all `transparent` because `procedural-furniture.js` applies `part.textureTransparent`
  (true on these parts) even with opacity 1 and opaque textures, and every part builds its own
  material. That keeps them out of `zone-prop-render-batches`. Making them opaque alone saves no
  draws; sharing materials would break the per-part mutations in furniture-puzzle-runtime
  (emission), the liquid surfaces and the ruin embers. Lead, not done.
- **Replay cull walks** (`collectReplayCulled`, held + shell): 1.9 ms a frame here, mostly the
  scene walk itself; the two walks use different scissor frusta, so only the per-object
  classification (~0.5 ms) could be shared. Lead, not done.
- **Rain planes** (15–17 draws everywhere it rains) are overlapping transparent sheets with
  per-sheet UV transforms: not mergeable.
- Remaining wall cost: the fading chunks' 36 draws (per-chunk transparent clones).

## 22 Nov 2026: town houses and NPC farm plots drawn as merged batches

A main-pass draw census in town (headless, fresh world outside the temple) found the largest
draw source was nameless: `Group > Mesh`, 111–549 draws per main pass depending on the camera
heading. Those are authored house faces (`HousePieceGen.buildGroupFromPiece`): every wall,
roof, porch and tunnel quad is its own 6-vertex mesh with its own geometry, ~1,070 across
town's house groups, sharing only 3–5 materials per house. Looking at the NPC farm plots
(`npc-farm-plots.js`), their per-tile soil, trench and water meshes were 339 of 517 draws.

`FarmTileRenderBatches` (render scope `farm-tile-batches`) now also merges, outside wilderness
zones, the children tagged `hobunjiStaticBatchable` of scene-level groups tagged
`hobunjiStaticBatchGroup`, per 8×8 cell and render state. House faces and plot soil, trench
and water tiles carry the tags (water is transparent, so it also sets
`hobunjiStaticBatchFlat`: tiles that never overlap can share one draw). These batches are
render proxies only, with no terrain tags, so the held/x-ray classifiers see what they saw
for the sources. Each batch sits at its members' centroid for Three's sort. A group's member
list is cached while its children, their materials and geometries, and the group's own
transform are unchanged; a full rescan, including the geometry/matrix signature, runs at
least every second. Tagged batches set `geometryAutoLODExclude`: opt-in AutoLOD never touched
the 2-triangle sources (below its 96-triangle floor) and must not decimate their merge. Signatures now include attribute
identity, so a replaced attribute at version 0 counts as a change.

Measured headless (480×320, same save, batches on vs off in the same session): main-pass
draws −151 at the spawn view, −56 to −669 across four headings (1,182 → 513 facing the houses),
−289 facing the plots (531 → 242). 1,331 sources become 41 batches. Raw same-task renders,
tiles vs batches: 0–1 px differ in house views; 25–32 px of 129,600 (maxd ~30) seam speckles on
the plots, from vertex rounding where adjacent tiles meet. One view showed ~770 px, all in
the player's portrait: the first raw render after a game frame differs there from every
later one (tiles vs tiles too), and with the player hidden tiles vs batches is 0 px.
Measurement trap for raw-render parity checks: discard the first render after a frame. Whole
profile at the spawn view (30 s, A/B on the same save): 219 → 186 ms a frame in software GL,
world render JS 19.4 → 15.3 ms a frame, with the scope's own cost 0.2 → 0.7 ms (the 1 s full
rescans run every ~5th frame at this frame rate, so the rescan share is smaller on a device). Not yet measured on a device; the
draw counts are what should carry over to a draw-call-bound GPU like the GTX 1060. A/B:
Settings → Render optimizations → "Merge farm ground tiles" (also covers these groups),
`FarmTileRenderBatches.setEnabled(false)`. `snapshot()` reports `groupFullScans` /
`groupCachedScans`.

Not done: the remaining plot draws are crops (per-crop materials, and crops sway through
frame hooks, so they stay unbatched). The first house builder (`_buildFaceMeshes`) emits
faces without UVs and is not tagged.

## 22 Nov 2026: incremental NPC combat resource rings

When a fighter's rounded Stamina value changes, the previous ring updater
disposed and rebuilt **all** active Health/Stamina/Footing arc meshes and
both target-lock halo meshes, even though only Stamina changed. The existing
whole-point HUD key still limits update frequency; inside an actual update,
each resource now has its own status-aware signature and reuses its existing
mesh tree whenever unchanged. The Health signature additionally includes
Wounded/Infected Stamina because those create orange Health-risk dashes.
Target halo meshes survive every resource change, and rebuild only on
target selection or ring radius changes. A second-pass review added effective
maximum capacity to each arc's signature: changed trinket/gear stat modifiers
no longer leave an old cap marker when another resource triggers refresh.
Active Black Stamina is now rounded to the same whole-point step as other
HUD resources, avoiding a new arc every fractional-regeneration frame.
Full homeostasis and despawn still
dispose the geometry. No new rendering pass or idle per-frame scene walk.

`ResourceRings.debugSnapshot()` exposes `resourceArcRebuilds`,
`resourceArcReuses` and `targetHaloRebuilds` for profiling; the mobile Pixel Probe also shows these counts. The existing
source-executed `test-resource-rings.js` now checks reuse, disposal,
cross-resource affliction invalidation, target changes and radius changes.
Visible resource rings also sample equipment/perk-driven effective capacity at a
bounded 500-ms interval to catch a modifier changing without a Health/Stamina
event. The scan is skipped for hidden, fully homeostatic fighters and never
runs every frame. Newly created fighters are staggered over ten
capacity-check slots (all checked within 500 ms), preventing large
simultaneous spawns from aligning their future polls. Mobile Pixel Probe now includes `capacityChecks` and
`capacityInvalidations` to verify the budget on device. Device FPS and
actual allocation reductions remain to be measured.

## 22 Nov 2026: overlapping dens and a barbarian camp at night

Ground detours and cliff-entry searches reuse collision results within one A*
search. Diagonal probes used to repeat the full terrain, building, locale and
den checks for the same tile. The blocked 32×32 fixture makes 545 collision calls,
down from 3,861, and reachable fixtures produce identical waypoints.

In wilderness zones, an unchanged failed ground detour retries after 1.2
seconds, then 2.4 and 4.8 seconds. A new start tile, goal tile, area, or
successful direct step bypasses the old failure. A newly available side route
can wait for the next retry if the direct step stays blocked. A 24-actor blocked
fixture performs 72 searches over 4.8 seconds, down from 216. Indoor detours
keep their prior retry cadence because walkability can change at the same map
tile when an actor changes floors. The in-game Performance Profiler reports ground and
cliff search counts and peak times. These measurements cover routing work.
The reported nighttime scene still needs an on-device frame capture to compare
simulation and rendering costs.

## 21 Nov 2026: battle and sky traces, ground replay and AutoLOD bookkeeping

The same spot measured a 209 ms median frame interval facing the battle and
65 ms facing the sky in Chrome traces, after removing the profiler startup
stall. Sampled held-object/x-ray work dropped from roughly 26 to 8 ms per
game-frame callback. Geometry AutoLOD stayed near 2 ms. The battle capture
also included substantially more browser style recalculation, so the frame
intervals cannot isolate the camera change.

The held and shell passes now reuse their per-scene ground material aggregate
when the visible inputs match. They check material slots and normal
availability on each use and retain the live compile callback checks.
AutoLOD uses the shared render hook, validates each eligible shared geometry
once per draw, and skips excluded layers and auxiliary scenes in the world
frame. Version changes and attribute replacements still invalidate a variant
before the next eligible draw. The Performance Profiler shows ground cache
hits and builds alongside AutoLOD source checks and swaps. These counters
verify work reuse. Fresh device traces are needed to measure the FPS effect.

## 21 Nov 2026: static portrait poses for NPCs and animals

The game can draw an unskinned quad for a flat neutral portrait or cache the
existing deformed geometry for a fixed hunch or weapon stance. The bandit's
live Light, Heavy, and ranged pose data supply the matching face-forward
counter-turn. Real glances, nods, and active weapon animations use the live skin.
Native color and PNG depth draws share the same presentation. Stable caches
are bounded per portrait and first-use bakes are limited per world frame.
The Performance Profiler reports flat and baked counts and avoided triangles.
The Render optimizations toggle allows an in-place A/B comparison. A Chromium
software-WebGL fixture with seven scene draws per frame showed lower median
render time with frozen portraits in all four warm A/B blocks. This fixture
does not predict battle-save FPS. A separate WebGL check changed the head,
spine, UV and material between passes of one world frame and verified that
the current geometry and program followed those changes.

## 21 Nov 2026: pants added to existing feet x-ray replay (PR #2049)

Pants join the existing selectively ground-exempt feet replay, not a new pass.
Their GPU-leg animation disables Three.js's ordinary frustum culling, which initially
also made the actor-tile x-ray grouper treat them as unbounded: separated regions
could not take the screen-space batching path when pants were present.
The grouper now recognizes *only* tagged authored pants with finite positive
deformation padding, unmodified draw hooks, and non-ShaderMaterial geometry,
using the same padded projected bounds as the existing replay scissor.
Only its actively GPU-skinned mode may use that shortcut: ghost/lit/CPU
fallbacks move actual CPU vertices, so their bounding boxes become stale and
are invalidated on each changed pose for lazy exact scissor recomputation.
Other deformed/unsafe meshes remain conservative independent groups.
GPU rest vertices do not prove the live cuff's minimum Y, so pants also do
not trigger the floor-height-only early skip; the scissor/group checks still run.

This does not add per-frame skinning, new render passes, or road geometry. One
extra eligible pants mesh still participates in the feet replay and adds some
marginal draw work. Source-executed bounds tests prove the isolated 24-region
batching fixture (24 separate regions -> 3 non-overlapping groups), **not**
on-device frame times. Compare `WorldRenderPipeline.captureFrame()` and
`HeldObjectRenderOrder.snapshot()` on the same save before/after PR #2049,
especially `elevationReplayGroups`, `scissoredReplays`, `fullscreenReplays`,
`lastReplayScissorCoverage`, and `pantsXrayRegistrations`.


## 21 Nov 2026: x-ray depth snapshot kept alive on more GPUs

In the user's town trace, not one sample landed in any function that only runs while the x-ray
depth snapshot works (`ScissorDepthSnapshot` save/restore, `hideBeyondViewDepth`,
`replayFarViewDepth`, the floor punch), and the shell x-ray's final depth restore took its fallback
branch (clear depth, redraw the whole scene colourless: 188 ms, ~2.8 ms a frame). So on the user's
machine the snapshot was off, which sends every held and shell x-ray replay back to full-scene depth
redraws and drops their behind-the-gear culling. The snapshot disabled itself for good on the first
GL error after its first blit, and that check had two weaknesses: `getError()` also returns errors
queued by any earlier, unrelated WebGL call, and implementations that reject depth blits of a
sub-rectangle (believed to include ANGLE's Direct3D backends; the user's GTX 1060 runs on ANGLE
D3D11) failed the partial blit it always starts with. Now stale errors are cleared before each
checked blit, the first whole and the first partial blit are checked separately, and a rejected
partial blit switches that renderer to whole-buffer copies (equivalent: replays only write depth
inside their scissor) instead of disabling snapshots.

Headless, user's Cloud Forest save, with partial depth blits rejected by a wrapper: snapshots stay on
in whole-buffer mode, frames are pixel-identical to partial copies, 810 draws a frame against 1,368
with the snapshot disabled (the previous outcome). The Performance Profiler overlay now has an
"X-ray depth snapshot" line (near replay on/off, saves, restores, partial or whole-buffer copies,
redraw fallbacks, disabled reason) so this can be confirmed on a device. It cannot tell whether the
user had simply switched off Settings → Render optimizations → "Keep depth behind held items", which
has the same effect.

## 20 Nov 2026: user's town trace; lean dual-wield weapon sync

A Chrome DevTools trace from the user's desktop build (town, DevTools recording + the in-game
Performance Profiler on): ~12 fps, ~72 ms of script per frame (median), main thread saturated.
Before the recording, `CpuProfiler::StartProfiling` blocked the main thread for 1.9 s: that is
DevTools' "Profiling overhead" (it indexes every loaded script), a one-off of the recording, not
the game. Correcting a first reading of the profile: minified three.js `At` is `projectObject`
(render-list building), not a matrix update, and recursive functions must be counted once per
sample. The held/x-ray replays already reuse the base pass's matrices (`scene.autoUpdate` off: 1-3
matrix visits per replay render vs 8,092 for the base pass in the user's save).

Real per-frame costs in that trace (profiled, so inflated): render passes ~32 ms; the held replay
~12.6 ms and shell x-ray ~10.5 ms (draw submission, not visibility bookkeeping: the
`restoreVisibility` frames above the shell depth draws are inlining); the dual-wield weapon sync
~6.3 ms; the action bar's processing-wheel eligibility checks ~5.3 ms (`refreshActionBar` →
`butterChurnWheelEligible`, `inventoryHeldWheelEligibility`, `isWheelEligible`);
`checkTransitionSpots` ~5 ms; the replay cull scene walk ~4.3 ms; NPC walkers / pathfinding
collision checks a few ms more.

**Lean dual-wield sync (fixed).** Every `HobunjiDualWieldWeaponVisuals.syncNow` (per hand, per rig
sync, plus the scheduler sync and the render-time sentinel) recomputed the weapon copies' matrices
three times: the holder bake descended into both copy roots with their previous pose, the roots
were re-posed and updated again, and each hand's socket updated its copy once more. Armed NPCs hold
an invisible offhand copy at idle, so in town every armed NPC paid this. Now the holder bake skips
the copy roots, a hand reads its copy straight from the root update, and both hands of one rig solve
share one sync (`procedural-hand-frame-driver.js` passes the same solve object). Headless, user's
Cloud Forest save (6 dual-wield states, 32 rigs): dual-wield matrix work per rig sync 544 → 113
visits (whole rig sync 2,144 → 1,713); frames are pixel-identical with lean sync on and off.
A/B: Settings → Render optimizations → "Lean dual-wield weapon sync", benchmark variant
`dualWieldFullSync`, `HobunjiDualWieldWeaponVisuals.setLeanSyncEnabled(false)`.

**Item wheel list reused across frames (fixed).** `checkTransitionSpots` and the action bar were one
cost: `checkTransitionSpots` calls `refreshActionBar()` every frame, and two thirds of that was
rebuilding the item wheel's list (`getInventoryStackItems`), which runs `ItemProcessing.isWheelEligible`
(processing outputs for every method, the churn check, a catalog scan) over every owned item: 2.9 ms a
build for the user's 157 wheel items. Its cache was valid for one frame only, although every read
already checks every input that can change the list (owned keys, their definitions, the catalog, the
manually held item, the eligibility provider). The list and its cache moved to
`js/inventory-wheel-list.js` (extracted from game.js; `getInventoryStackItems()` delegates) and a valid
list is now reused across frames, rebuilt at least every 500 ms for what the checks cannot see
(late-loaded recipe/alchemy data, a definition edited in place). At the user's ~12 fps that is one
build every ~6 frames (~2.4 ms a frame saved); at 60 fps ~97% of builds. The rest of
`refreshActionBar` (~1.7 ms in the trace: action buttons, aimed object, editor button visibility,
prayer prompt) is unchanged. A/B: Settings → Render optimizations → "Reuse the item wheel list across
frames", benchmark variant `wheelListEveryFrame`.

**Den collision looked up once per task, i.e. per game-loop tick (fixed).** The trace was in a wilderness zone with animal dens.
Creature pathfinding asks `GridTileAccessors.isAnimalDenCollisionTile` for every tile it expands, and
each call walked every den through `ZoneDenTotemFeatures.denEntranceCollisionState`, which resolves the
den's entrance locale (local editor overrides included) before its own cache check: 137 ms in the trace,
~2 ms a frame. `grid-tile-accessors.js` now memoises each den's state for the current task: dropped when
the task ends (edits arrive in their own task), whenever the den module recomputes any state (new
`denCollisionGeneration()` counter), and per den when its position, size, template or mouth changes.
Headless, user's Cloud Forest save: 323 → 15 lookups a second (98% of 42k lookups served from the memo).
A/B: Settings → Render optimizations → "Reuse den collision within a game-loop tick", benchmark variant
`denCollisionEveryTile`.

## 20 Nov 2026: review of this branch's render changes

A full review of the combat-perf branch found, and this entry fixes:
- **Particles drawn once could be clipped.** Hidden from the unclipped base pass, a gear particle
  draws only inside its group's replay scissor, which grew only for enchantment aura padding. A
  torch or flail flame rising past its weapon's box would be cut off. Gear particles now join their
  group's scissor and near-replay far depth (`needsParticleBounds`); enchantment motes stay
  covered by their plane's aura padding, which is measured over exactly those motes.
- **The held dungeon-fire plume drew under its weapon.** Off the held-overlay layer it drew only in
  the base pass, and the weapon's overlay redraw covered its base. It is back on the overlay layer
  with its scissor padding, linked to the weapon plane (`linkGearParticle`) so it draws once, right
  after the weapon. A flying projectile's plume stays world-only.
- **NPC weapon particles showed through grass.** With other characters' weapons in the base pass,
  their particles still carried the overlay layer and redrew in every x-ray overlay. They now leave
  the overlays with their weapon.
- **Particles could stay hidden after an exception** between the base render and the replay; one
  `try`/`finally` now spans the whole section.
- Weapon-budget diagnostics were counted twice a frame (base and shell passes); the budget's
  containers are reused. The tree instancer's cache token is bumped (main had the first version
  under the same token). The held-item x-ray exception for other characters is recorded in the
  `CharacterVisuals` coverage table.

Headless, user's save: the enchanted weapon renders identical frames with drawn-once particles on
and off; no replay fell back to full screen; six bandits still 2,293 → 1,881 draws and 21 → 18
renders, and the Settings toggle restores the old frame exactly.

## 20 Nov 2026: NPC and enemy weapons in the base pass by default

The device benchmark measured `npcWeaponsBasePass` about 11 ms a frame faster on a GTX 1060 while
watching a camp from afar, so it is now the default: `HeldObjectRenderOrder` resolves scene-sibling
weapons to their bearer (owner link on) and gives other characters' weapons an x-ray budget of 0, so
they draw in the base pass with their bearer instead of in an extra held-replay group. The player's
and short species' gear keep x-ray. The look changes slightly: those weapons are fogged by the Cloud
Forest mist like their bearer and layer by plain depth against grass. Headless, user's Cloud Forest
save, 6 bandits: 2,016 → 1,836 draws and 21 → 18 scene renders a frame; 16k of 518k px differ, all on
the bandits' weapons. Settings → Render optimizations → "NPC and enemy weapons in the base pass" off
restores the old look exactly (owner link off, budget Infinity; switching back on reproduces the
default frame pixel for pixel). Benchmark variant `npcWeaponsXray` measures the old look.

## 20 Nov 2026: ore-rock stones merged per cell

The device's top draw source was removable ore rocks: one stone mesh per rock, drawn as two
draws (the ridge isolation's `[m, m]` top/side material pair) in the base pass and again in
replays (218 + 212 on the GTX 1060). Ore rock groups now carry the owner tag
`userData.facetedOreRock`, and `zone-prop-render-batches.js` merges still stones per 8×8 cell.
Three things had blocked it: the repeated-material array (now drawn as its one material when
the groups cover the whole geometry), the held x-ray elevation compile hook on the rock
material (it now declares itself world-bake safe when what it wraps is), and cell keys taken
from the mesh origin (rock vertices are world-space, so every rock sat at 0,0; cells now use
the world geometry centre). A merged batch was also being re-unwrapped by the natural-surface
add-time inspection (ridge split + stretch remap of the copy), so batches are now flagged
`hobunjiRenderProxy` before they are added and those inspectors skip them.

Headless, user's Cloud Forest save: stone draws 120 → 11 a frame (whole frame 1,513 → 1,368).
Next to a 16-rock cluster: 88 → 20, of which 8 are floor-punch refill draws (a cell batch's bounds
reach the punched patch where a single stone's did not); whole frame 1,258 → 1,186. Batching on
and off render pixel-identical frames, and mining a visible rock removes the same 1,423 px in
both modes. Grass rims (60-74 draws) are unchanged: each has its own jigsaw material clone and
the furniture-ID `onBeforeRender` hook. A/B: `ZonePropRenderBatches.setEnabled(false)`,
benchmark variant `propBatchesOff` (all props, not only rocks).

## 20 Nov 2026: device report while watching a camp from afar; gear particles drawn once

**Device** (GTX 1060, Cloud Forest, 3 enemies + 3 corpses in view, not fighting). The default
window times every pass with GPU queries, so it reads slower than any variant; neutral variants
(painterlyOff, cloudsOff, fadedTreesDrawn, halfResolution) put the real baseline at ~102-106 ms.
Against that: `skinnedScissorOff` +15 ms (the skinned scissor fix holds up), `npcWeaponsBasePass`
−11 ms (render CPU −9: unowned hostile weapons cost an extra replay group even at a distance),
`treeInstancingOff` −6 ms and −350k triangles (tree instancing is a net loss on the device: its
corridor-wide batches defeat frustum and replay culling, and the per-frame regroup costs CPU),
`fadedTreesDrawn` ±0, `mistOff` −6, `outlinesOff` −23. Top draws: ore rocks
(`faceted_ore_rock` 218 + grass rims 106 in main, 212 more in replays: each removable ore rock
has always been its own stone + grass mesh pair) and the player's enchanted flail motes (76 in
main, 152 in replays).

**Gear particles drawn once.** Motes and weapon-layer fire sit on the world layer and the
held-overlay layer so the overlay draws them after the gear it repaints. They therefore drew in
the base pass (where the gear is suppressed: the overlay then paints the gear over them) and in
every replay group's overlay. `HeldObjectRenderOrder` now hides them for the base pass and the
whole replay and shows each only in the overlay render of the group holding its gear (nearest
held ancestor; gear the replay culls keeps the old behaviour). Headless: one render draws all 77
motes once a frame (was base + every group: 154 here, 228 on the device); 363 px differ where
the base-pass copy used to double a translucent mote. (Corrected after review, see the entry
above: the held dungeon-fire plume briefly left the held-overlay layer, which let the redrawn
weapon cover its base; it is now drawn once after its weapon like the motes.) A/B:
`setGearParticlesOnceEnabled(false)`, benchmark variant `gearParticlesEveryPass`.

## 20 Nov 2026: why combat and crowds still cost frames (investigation)

Headless, user's Cloud Forest save, enemies spawned around the player and kept fighting
(`scratchpad combat-probe.js`: CPU profile + per-pass draws per scenario; render-list diffs before
and after spawning one enemy). SwiftShader inflates wall-clock time; draws, render calls, JS time
and shader program builds are what carry over to a device.

| Scenario | Draws | Scene renders | JS / frame |
|---|---|---|---|
| no enemies | 1,527 | 17 | 95 ms |
| 8 drenkirra fighting | 1,766 (+30 each) | 20 | 98 ms |
| 6 bandits fighting | 2,101 (+96 each) | 21 | 140 ms |

- **Armed humanoids, not crowds, are the multiplier.** One unarmed drenkirra: +25 draws, no extra
  renders. One bandit: +370 draws, 350 of them inside the held replay, and +3 scene renders. Its
  weapon is a scene-sibling `banditToolHolder`; `actorRootForXrayMesh` only walked parents, so the
  weapon had no owner, took the fail-safe path and opened an extra "ordinary" held-replay group:
  a depth supplement and colour overlay that redraw every grass cutout, depthless ground chunk and
  held VFX (the player's enchantment motes) inside the group's rectangle. With 6 bandits the held
  replay's JS went 12.5 → 25.5 ms a frame. The weapon names its bearer in
  `userData.hobunjiHeldPortraitOwner` (the portrait mask already follows it); resolving through it
  under the existing "weapons x-ray for everyone" rule is far worse (6 bandits: 2,216 → 5,875 draws,
  21 → 30 renders). With a non-player weapon budget of 0 they draw in the base pass instead: 1,959
  draws, 17 renders (−257, −4 vs today), but the weapons then look different (fogged by the Cloud
  Forest mist, layered differently against grass and their portrait; 3.4-6k px in a 960x540
  frame). Both switches ship off; benchmark variant `npcWeaponsBasePass` measures it on a device.
- **A shader program rebuilt on every hit.** Every popup (damage numbers, labels, prompts) created
  and disposed its own MeshBasicMaterial; disposing the last live one let three.js delete the
  shared program, so the next popup compiled and linked it again: 35 rebuilds of one program in a
  240-frame fight, 0 while idle (shader compiles are slow on ANGLE/D3D11, so this is hitching
  rather than average frame time). `world-popup-text.js` now pools those materials (only the map
  and opacity change): 35 → 12 rebuilds; the rest come from ranged projectiles
  (`ranged-weapons.js` `disposeProjectile`), lunge trail stamps (`game.js`
  `updateLungeTrailStamps`) and emoji icon effects, which create and dispose materials the same way.
- **CPU.** `updateHostiles` +7 ms for 6 bandits (line-of-sight raycasts through
  `computeBanditLos` ~0.3 ms per enemy), `updateCreatureMesh` +3 ms, `scanScene` +3 ms. A new animal
  pays a one-off pattern recolour (`creature-genetics-render.js`) when it spawns.
- **Resource rings** rebuild every ring mesh, geometry and material on each whole-point
  Health/Stamina change: thousands of disposals a minute in a fight (inflated here by the harness
  healing the player every frame), under ~1.3 ms a frame of CPU; GC and buffer churn more than time.
- **Structural.** The frame already makes 17 scene renders with no enemies, each walking the whole
  scene graph; anything that adds a render (a held-replay group, the world-text overlay pass while
  popups exist) adds a full traversal.

## 20 Nov 2026: invisible wilderness trees still drawn (the "WildernessChunk" draws)

The device report's biggest draw label, `WildernessChunk_map_southern_cloud_forest_#_#` (589 draws
in one main pass), is the Cloud Forest's procedural shadewood trees: one group per tree tile, 3-4
meshes each (trunk, vines, leaf cards, sometimes a climb branch). In the user's save 140 were in the
vegetation corridor, but only 37 were opaque: 103 were fading at the corridor's forward/side edge and
**73 of those had settled at opacity 0** — drawn every pass (and again in the held replay) while
contributing no colour. Their depth writes still left a faint ghost trunk in the mist with the
edge-ink composite outlining it, popping as the corridor hysteresis moved.

`ZoneVegetationCull` now leaves such a tree undrawn until its fade target rises (the fade then
restarts from 0, so it reappears smoothly); the corridor hysteresis still counts it as in view.
Headless, user's save, 1175x545: 1,833-1,845 → 1,614-1,625 draws a frame (−219/−220), chunk
draws in the main pass 449 → 335; frames otherwise identical, ~6k pixels (≈1%) differ — only the
ghost trunks in the far mist. A full camera turn in 45° steps hid 66-89 trees per heading and
left none hidden once it stopped being faded out. A/B: `ZoneVegetationCull.setHideFadedOut(false)`,
benchmark variant `fadedTreesDrawn`. Not yet measured on a device.

What remains per tree is real: ~60 visible trees x 3-4 meshes; the opaque ones are now instanced
(next entry).

## 20 Nov 2026: tree instancing measured on the device: a net loss, now off by default

GTX 1060, Cloud Forest: `treeInstancingOff` beat the neutral variants by ~6 ms a frame and drew
350k fewer triangles; `fadedTreesDrawn` was within noise. The instanced batches span the whole
vegetation corridor, so Three cannot frustum-cull the trees outside the view and the held/x-ray
replay cull cannot drop them outside a replay's scissor (32 tree-batch draws showed up in the
x-ray shell replays alone), and the per-frame regroup costs CPU. `WildernessTreeInstancer` is
now off by default under a new opt-in key (benchmark windows had persisted the old key as on);
chunk-local batches with tight bounds are the version to try next (`treeInstancingOn`).

**24 Nov follow-up — spatial instancing experiment:** the optional tree scope now groups
by 8×8 world cells as well as variant/render state. Existing instance bounds give each
cell a separate camera/replay cull decision. Weakly cached grouping keys eliminate repeated
string construction for unchanged parts; inactive buffers release source references,
expire after 30 render frames, and are capped at 64. Negative transforms and child-bearing
source meshes stay unbatched. Pixel Probe exposes cells, grouping-key hits, uploads and
retired buffers. Real Three.js fixtures exercise actual view culling and source restoration.
Still off by default until a device A/B proves it faster; no new FPS claim.
Audit: all five initial CI workflows passed. Refresh drawn tree world transforms before the first render after streaming; fail open for custom shader/uncullable/group-order members; guard duplicate discoveries and restore originals on partial setup failure. Rebased after the popup optimization merge, retaining both log entries.

## 20 Nov 2026: procedural wilderness trees drawn instanced

Tree tiles are clones of a few cached FoliageGenerator variants, so every trunk/vine/leaf/climb
branch mesh shares its variant's geometry, and while opaque its natural-surface material
(NaturalSurfaceMaterials caches them; only a fading tree has its own transparent clone). The new
render scope `wilderness-tree-instancing` (`js/wilderness-tree-instancer.js`, order 250) draws the
trees the corridor cull draws, and that are not fading, as one InstancedMesh per (geometry,
material, layers, renderOrder, shadow flags) for the frame only, restoring the originals after it.
The layers key keeps the corridor's per-tree outline budget; fading trees, transparent or
multi-material parts, draw hooks and lone meshes draw themselves. Batches carry InstancedMeshBounds
tags (instanced view cull, held replay cull) and use the trees' own materials and last rendered
matrices (uploaded only when membership or a matrix changes: 0 uploads over 60 still frames).
Originals hidden for a frame are flagged `hobunjiDrawProxyHidden` so Perception Mode still masks
them.

Headless, user's save, 1175x545, four camera headings: 82-102 tree meshes in 12-16 batches,
−60 to −157 draws a frame (main −37 to −108, shell −23 to −64) on top of the previous entry. Not
bit-identical: 0.1-0.5% of pixels differ, as speckles where vines lie almost flush on bark
(instanced and per-mesh transforms round differently, flipping a z-fight); no silhouette, outline
or shape changes. A/B: `WildernessTreeInstancer.setEnabled(false)`, benchmark variant
`treeInstancingOff`. Not yet measured on a device.

## 20 Nov 2026: held replays no longer go full screen for the player's neck-rigged portrait

The device reports showed `held=skinned-mesh` with one full-screen held replay a frame (~700
extra draws). In the user's Cloud Forest save it was the player's own skinned portrait
(`..._skinned_plane_assembly`), not a wet body: `replayScissorRect` refused every SkinnedMesh,
so the held replay re-rasterised the whole world. It now bounds them per bone: r128 skins a
vertex as a weighted average (weights summing to 1) of the vertex moved by each influencing
bone, so the box of the vertices each bone moves, transformed by that bone, covers the body.
Both the uploaded and the current bone matrices are used (a skeleton not refreshed this frame
is still covered); weights below 1 add the mesh origin; weights above 1, bad bone indices,
morph targets and unknown per-draw hooks keep the full-screen fallback. The portrait's
outline-parity hook (freezes depth-only redraws to the last visible matrix) now publishes the
same two-pose `__hobunjiXrayBoundParity` contract as the hand/foot adapters, so both poses are
bounded. Headless, user's save, standing in three water spots, 960x600: held fullscreen reason
`skinned-mesh` → `none`, fullscreen replays 1 → 0 a frame, draws 2,130–2,160 → 1,966–1,977
(−164 to −183); frames with the fix on, off, and with all replay scissoring off are
pixel-identical after a warm-up frame. `scripts/test-held-skinned-scissor-bounds.js` checks
every vertex skinned the shader's way against real three r128 (CI regression-suite step).
Benchmark variant `skinnedScissorOff` measures it on a device. Not yet measured on a device.

## 20 Nov 2026: statue footprints hold ruin debris

Generator `statue` landmarks (blocking 1x1/1x2 tiles; 56 tiles in the user's Cloud Forest) had no
renderer and fell into the merged, outlined rock mound. `js/statue-ruin-debris.js` now fills them
with Debris-ifier V50 debris generated in a hidden iframe (`?devRuntime=1`, local transport): 5
seeded variants per zone, each a tiny outdoor ruin pushed through the damage pass and merged into
one unlit stone mesh (~4.2k triangles, one draw, no shell). Headless generation took ~32 s for the
pool on SwiftShader (first furniture load included); footprints fill when it resolves. If the
generator cannot start, footprints get a farm-style stone instead.

After merging main's visual-authoring contract (hard-edged meshes carry one inked PNG per detected
surface and no generated outline), each variant is now surfaced once with
`FacetedRocks.surfaceStone` (~1,400 surface islands per variant; every placement shares the
result). Before, only faces that kept the generator's box UVs showed ink and the fallen shards were
smeared. Pool generation went 27.6 s → 37.4 s headless for 5 variants (once per zone, before the
footprints fill); draws unchanged (one per footprint).

## 20 Nov 2026: ore rocks drawn like the farm rocks (visual change, small draw saving)

Wilderness and town-mine ore rocks now reuse the farm rocks' look (`js/faceted-rocks.js`): the
same `buildRockTileGeo` mound sent through the farm's `naturalizeMesh(mesh, 'rocks')` call
(unlit body-sprite tint, cliff-stretch surface islands each carrying the inked PNG, no shell
outline), tinted with the ore's rock-metal colour (grey for plain stone). They dropped their
shell-outline draw (~80 rocks in the user's Cloud Forest view). The chunk's terrain jigsaw bake
now skips them (`userData.facetedRock`); it had been replacing their islands. A brief chiselled
low-poly variant was dropped in favour of this irregular farm look at the user's request.

## 20 Nov 2026: GTX 1060 report — draw-call bound; enchanted-weapon motes in colourless replays

**Device** (Opera / Windows, GTX 1060 3GB via ANGLE D3D11, Cloud Forest, 1850×858, GPU timer
queries available): default 13.2 fps, render CPU 56.9 ms, GPU 46.2 ms; `halfResolution` GPU
46.6 ms (no change, so not fill-bound); per pass, GPU time tracks CPU time (held replays 14.7 ms
CPU / 13.1 ms GPU), meaning the GPU waits on submission. ~2,470 draws a frame: main 772, held
replays 972, x-ray shell replays 509, shell 194; 15.9 ms of JS between draws. Painterly was
4.8 ms GPU. The `?renderContext=lean` run (13.2 → 16.8 fps default) is within that run's own
variant spread (12.1–16.8 fps), so it is not conclusive. The earlier "GPU-bound" read was
wrong: it is draw-call bound.

**Reproduced** with the player's own character + world files loaded into the headless harness
(same zone, 1175×545): ~2,400 draws, matching the device. The new per-pass "top draws" lines
showed the enchanted dual-wield flail's motes (`weapon_enchantment_*`, up to 24 sprites per
blade plane, each its own draw) in the base pass, every held replay and the x-ray shell
replays. Two of the held replay's submissions and both shell depth submissions run with the
colour mask locked, and the motes write neither depth nor stencil, so those draws changed no
pixel.

**Change.** `held-object-render-order.js` hides visible descendants of held gear whose
materials write neither depth nor stencil for exactly those colourless submissions
(`hideColorOnlyHeldVfx`; A/B: `HeldObjectRenderOrder.setColorOnlyDepthSkipEnabled(false)`).

**Measured** (player save, same frames): 2,291 → 2,050 draws a frame (−241, −10.5%); held
replays 859 → 777, shell replays 437 → 281; render CPU 40.5 → 36.7 ms headless. Pixels:
0 px difference skip on vs off in 4 views (back-to-back identical renders also 0 px).

**Leads, not done:** the held depth rebuild is still ~480 draws on this save. Its scissor
covered ~36% of the screen in one frame, apparently because the motes' VFX padding grows it.
The ordinary supplement keeps alpha-cutout foliage, covers, depth-less ground and every mesh
with a custom `onBeforeRender` (most WildernessChunk terrain). The held replay also falls back
to fullscreen (`skinned-mesh`) when a skinned portrait enters the water-tint scissor. Main
pass: ~146 WildernessChunk draws and ~150 mesa pieces. The benchmark now reports fullscreen
replays per frame and the top draws per pass, so the next device report shows which matters.

## 20 Nov 2026: first on-device report (Cloud Forest) — GPU-bound; where the GPU goes

**Device report** (Opera / Windows, Cloud Forest, buffer 1850×858 @ dpr 1.575, 17 native
renders/frame, player + companion + shoulder pet, 3 rounds × 90 frames):

| Variant | fps | avg / p90 frame | render "JS" |
| --- | --- | --- | --- |
| default | 14.8 | 67.7 / 100 ms | 56.1 ms |
| frameScopeOff | 12.7 | 78.9 / 100.1 ms | 53.9 ms |
| outlinesOff | 16.1 | 62.0 / 83.3 ms | 37.8 ms |

The same view headless spends ~6 ms of CPU in the world render (156 draws), so 56 ms there is
almost certainly the CPU blocked on a GPU that is behind: the device is GPU-bound. That also
explains why outlinesOff cut "render JS" by 18 ms but frame time by only 6 ms. outlinesOff is not a
pure outline A/B either: it also removes the painterly filter and moves the world onto the
4×-MSAA canvas.

**What the frame asks of the GPU** (headless capture + readPixels-synced per pass; SwiftShader,
so absolute ms mean nothing, proportions roughly do):
- Main pass ~1.0 M triangles; `AuthoredCloudForestDenseChunk_*` (border-terrain.js dense
  shadewood wall) is 81 draws / 930 k triangles of that, ~9 chunk groups inside the corridor.
- Painterly (`js/painterly-postprocess.js`, default `medium`, full resolution): three filter
  passes (49-tap oil kernel spread ±10 px, 7-tap wash, 8-tap tone) plus a 9-tap finish in the
  composite. Pure fill cost: 34.8 ms at 480×270 → 114 ms at 960×450 (×3.3 for ×3.3 pixels);
  painterlyOff was +38% fps headless in two separate runs (6.8 → 9.4, 7.1 → 9.8 fps).
- Shell-pass x-ray replays (held-object-render-order.js depth rebuilds): ~70 k triangles,
  ~42–56 ms synced headless, flat with resolution (geometry/setup bound in SwiftShader;
  unknown on a real GPU).

**Changes.**
- `js/render-ab-benchmark.js`: variants `painterlyOff`, `halfResolution`, `nearForest` (Cloud
  Forest cull radius halved), `mistOff` / `rainOff` / `cloudsOff`; GPU time via
  `EXT_disjoint_timer_query_webgl2` where exposed, otherwise one extra readPixels-synced window
  that times every pass CPU+GPU (not used for fps); per-pass draws/triangles; painterly filter
  passes labelled separately from the composite; device GPU, context attributes, painterly mode.
- `?renderContext=lean` (or `localStorage.hobunjiRenderContext = 'lean'`): opt-in context with no
  canvas MSAA and no preserveDrawingBuffer, to measure what those cost on the device. With
  outlines on, the canvas only receives the composite quad plus overlays, so its MSAA never
  antialiases the world. Pixel Probe captures may be blank in this mode.
- Dense shadewood chunks are tagged with `InstancedMeshBounds` so `instanced-view-cull` and the
  replay cull can skip ones wholly off-camera. Measured: 0 px change; at the default corridor only
  1 of 108 meshes is off-camera (the wall really is on screen), so this is a small saving, not a fix.
  Halving the cull radius (`nearForest`) cut triangles only 1,137 k → 1,095 k at the spawn view.

**Open:** which of painterly fill, the dense-wall triangles, the x-ray replays or MSAA /
preserveDrawingBuffer dominates on the real GPU. That needs the device report from the new
benchmark (normal link and `?renderContext=lean`); reducing any of them changes visuals
(painterly resolution, tree LOD), so it is a decision for after that report.

## 19 Nov 2026: render wrapper chain → RenderHooks; world pipeline extracted (headless, measured)

**What a wilderness frame was doing.** A quiet Western Slope frame makes **17 native
`renderer.render` calls** (main pass, 5 held-object replays, PNG depth, shell + 3 x-ray
replays, mist, 4 composite quads, world text) and ~158 draws; 80 draws are the main
pass. About 25 modules had monkey-patched `renderer.render` /
`WebGLRenderer.prototype.render`, and every one of them ran on all 17 calls. The
player-body composer recomposed the body, re-ran the camera deadzone and head aim and
re-skinned the pants twice **per pass** (~10 world-scene passes a frame). In a 20 s CPU
profile the chain between the outermost wrapper and three.js was ~24% of `gameLoop`'s JS.
`held-object-render-order.js`'s `unwrapRendererRender` stops at the onboarding wrapper (no
`__hobunji*Original` marker), so its "raw" replays also went through the whole lower chain.

**Changes.**
- `js/render-hooks.js` (`RenderHooks`) is the prototype base render; ten wrappers became
  registered hooks (composer, drunk/bandit sway, crop sprite art / billboard / ready
  presentation, heftroot, held-seed reticle, death marks, NPC social inhibition,
  performance lock). All use `scope: 'frame'`: applied once on the first world-scene pass,
  undone at `endWorldFrame`. Outside a world frame they fall back to per-render.
  `RenderHooks.setFrameScopeEnabled(false)` is the A/B switch; `getDebug()` lists
  calls/applies/skips/errors per hook.
- `js/world-render-pipeline.js` owns `renderWorldPasses` (now `renderFrame`), the outline
  materials/targets/composite and the six render scopes, with `captureFrame()` for a
  per-pass draw list. `js/render-layers.js` names every layer bit. `js/zone-vegetation-cull.js`
  took the corridor cull out of `game.js` (no per-tree closure allocation).
- `action-arch-icons.js` replaced a document-wide `querySelectorAll` (up to 10×/s) with ID
  lookups and a live `arc-slot` collection. `wild-berries.js` shares one material per berry
  colour so berry clusters can join prop batches (they were keyed by per-bush material id).

**Measured** (headless SwiftShader, 480×270, same save and spot, ~180 frames each; JS only,
GL time is not representative):

| Per frame | Before | After |
| --- | --- | --- |
| Main-thread JS (incl. GC) | 17.67 ms | 16.19 ms (−8%) |
| `renderWorldPasses` inclusive | 7.51 ms | 6.19 ms (−18%) |
| Wrapper chain above three.js `render` | 3.38 ms | 2.01 ms (−41%) |
| Arch-icon static refresh | 0.73 ms | 0.04 ms |
| Pants re-skin (`handle.update`) | 0.37 ms | 0.15 ms |
| Draws | 158 | 157 |

`RenderHooks.getDebug()` over 10 frames: every hook `applies = 10`, `skips = 160`
(previously each ran 170 times). **Pixels:** rendering the identical frozen frame with
frame scope on vs off differs in ~1,300–1,400 of 129,600 px, all at the player's
feet/leg edges where the old per-pass recomposition left the PNG-depth and x-ray replay
passes with a slightly different pose than the main pass; frame-scope vs frame-scope is
0 px. **Not measured:** real-device FPS. On a phone the JS saving should scale with CPU
speed; compare with `RenderHooks.setFrameScopeEnabled(false)` on the same view, or run Settings → Dev Tools →
"Render A/B benchmark" (`js/render-ab-benchmark.js`), which interleaves as-shipped / hooks-per-pass /
outlines-off for ~18 s on the device and copies fps, p90 frame time and render JS per variant.
Headless runs of that tool (Western Slope, 2 rounds × 40 frames) are noisy: frame scope off cost +0.1 ms
render JS in one run (6.01 → 6.12) and +1.4 ms in another (5.23 → 6.64); outlines off gave ~+27% fps
(10.5 → 13.4 fps, software GL). So the share of the saving due to frame scope alone versus the shorter
wrapper chain is unresolved headless; run the benchmark on the device. Frame scope's other value is that
every pass draws the same pose.

**Leads not taken:** `refreshActionBar` runs every frame by design and rebuilds inventory
stacks (~0.5 ms here); the held-object replays remain the largest extra draw source; 15
rain/blizzard planes are separate transparent draws (merging them would change their
depth sort against the player sprite).

## 19 Nov 2026: precipitation textures and stable row assignments

Three r128 uploads each precipitation texture clone separately even when
the clones point to the same canvas. Rain now shares one texture, and the
Western Slope blizzard shares one for each of its three depth families.
Each sheet saves its own rain and snow phases in a material UV uniform.
The meshes qualify for the usual held-object depth replay skips. Snow
artwork is generated on first use.

The renderer now keeps row assignments while the front and rear row
indices and spacing match. Camera placement, fades and UV animation
still update every frame. The existing rain debug snapshot exposes
`precipitationTextureCount` and `rowAssignmentPasses`.

The executable regression checks texture sharing and separate UV phases,
movement within and across row intervals, arena layout changes, and
scene and weather transitions. A Three r128 Chromium WebGL comparison
against the old renderer matched all pixels over 74 frames covering
movement, camera rotation, layout changes, clear weather, and blizzard
transitions. In that fixture, the rain uploaded 17 → 1 precipitation
textures. After rendering rain and the expanded blizzard bands, the
cumulative count was 41 → 4. Frame times on player hardware are still
unmeasured.

## 19 Nov 2026: actual Chrome CPU profile — repeated scene traversals

Inspected the attached `Trace-20261118T215416.json.gz` as a sampled Chrome
CPU profile, not just the DevTools URL-level cost chart. Of **20,479**
profile samples, **1,381 (6.7%)** had a Three.js `traverse` or
`traverseVisible` anywhere in their stack; **741 (3.6%)** had
`updateMatrixWorld`. These are *unique stack-presence counts* rather than
inclusive self times, and they do not capture minified Three.js render-list
recursion under names like `At`. No FPS estimate is possible from them.

Observed call-chain contributors included:
- `held-object-render-order.js` shell scissor
  `collectReplayCulled` (448 stack-presence samples) and held
  `collectBoundedReplayObjects` (211).
- `outline-render-performance.js` world-text overlay search (220).
- `held-object-render-order.js` periodic `scanScene -> classifyTree`
  (241 containing `classifyTree`, 245 containing `scanScene`), currently a 750 ms fallback for post-add tags; retained.
- `crop-sprite-art.js` placeholder discovery (156), currently a
  250 ms fallback for newly planted crops; retained.

**Changed here:** `outline-render-performance.js` now handles attachments
to an already-scanned scene by checking just the newly attached subtrees
and uses live ancestry on cached candidates after removals/moves. Its
full-scene safety rescan remains once per second for a material/renderOrder
changed long after add; structure-epoch tracking is unchanged for the
timed-score character cache. A new standalone regression covers new and
late-stamped text, hidden parents, moves between scenes, removal, and rescan.
`OutlineRenderPerformance.snapshot()` exposes `worldTextFullScans`,
`worldTextIncrementalRoots`, and `worldTextCacheHits` for on-device checks.

**Second change:** the shell replay's `collectReplayCulled` now optionally
fills the same depth and shell candidate arrays while traversing the visible
scene. When a scissor frustum is available, the replay avoids a later
independent `collectShellReplayCandidates` full-scene walk; otherwise
that original live walk is still used. Existing visibility/material
restoration and conservative culling rules are unchanged. The regression
compares the fused result against the original post-cull traversal, including
hidden and depth-inert objects.

**Not yet measured:** real-frame FPS improvements or remaining cost from
Three.js's per-render render-list traversal. The player's trace was captured
before these changes, so only a matched camera/zone A/B recording after merge
can establish an actual speedup.

## 18 Nov 2026: redundant scene matrix traversal in PNG outline depth pass (code inspection)

The default outlined frame renders the main world scene, then immediately replays its PNG
portrait/held-item layer into that same target's depth buffer. Three r128 normally calls
`scene.updateMatrixWorld()` at the start of **each** `renderer.render(scene, camera)`; with
thousands of active scene nodes, the extra PNG-only replay repeats the entire graph's
matrix walk even though the main colour pass just resolved those matrices.

`png-plane-outline-occluder.js` already registers visible PNG meshes rather than scanning
the world graph for depth participants. The replay now calls
`updateWorldMatrix(true, false)` only on its visible registered participants (to pick up
late animation-hook changes to their local/parent transforms), disables
`activeScene.autoUpdate` for that **single extra render**, and restores its original
value in `finally` along with the camera layers/materials. The main colour, shell,
furniture seam, and held-object render paths keep their existing matrix-update policy.
The replay still uses the complete scene for layer filtering, so this removes a redundant
full-tree *matrix update*, not Three's render-list traversal.

`scripts/test-npc-png-depth-ancestor-cull.js` now exercises visible/hidden actor
participants, the selective update arguments, render-scoped `autoUpdate`, the existing
material/camera restoration, an injected renderer exception and an originally disabled
scene. An isolated runtime smoke test passed those scenarios.

**Not yet measured on the player's hardware:** frame-time savings. The 18 Nov Chrome
capture groups ~37% of sampled CPU time under `three.min.js`, but URL grouping does not
identify whether this matrix traversal or another internal Three.js function dominates.
A follow-up A/B performance recording with Bottom-Up grouped by function/call stack and
the same zone, camera and outline settings is still required before claiming an FPS gain.

## 18 Nov 2026: dense Cloud Forest steady rendering

- The mist outline redraw uses its own scene with at most three visible meshes. It shares the base
  mist's geometry, materials, world transforms and fog, and blends against the current world target's
  depth. It no longer submits the whole forest scene for this pass.
- Trees whose fade has settled leave the animation set, including those that remain partially faded.
  At full opacity the tree draws with its original materials again. Fade copies are reused until
  their tree unloads. The mobile lighting snapshot includes `outlineMistRedrawLayers` and
  `treeFade.animating`.
- The Three.js regression verifies the mist pass's inputs, render state restoration and three-mesh
  scene. The fade test verifies zero opacity writes across 60 settled frames, material restoration
  and chunk teardown's cleanup method. No physical-device frame-time measurement yet.

## 18 Nov 2026: Southern Cloud Forest short camera corridor

The Cloud Forest's historical `vegCullRadiusTiles: 30` switched
`updateZoneVegetationCulling` from the ordinary 42-forward / 30-wide /
2-rear camera-aligned corridor to a player-centered 30-tile **circle**.
At similar vegetation density, that permits many off-axis and behind-camera
trees into the draw list. This was a confirmed code-path difference, not a
measurement of total frame-time contribution.

The Cloud Forest now defaults to a **shorter, narrower directional corridor**
(30-tile slider -> 21 tiles forward / 19.2 wide / 2 rear). The ordinary zone
numbers are unchanged. Cloud Forest bounds conservatively expand with the
XZ canopy/grass chunk radius rather than the much larger vertical bounding
sphere, so tall trees do not inflate their horizontal visibility area.
The existing hysteresis and tree fade/outline envelopes use the same
camera-aligned corridor. The Settings toggle now compares the new short
corridor against the ordinary corridor instead of restoring the old radial
mode. The slider also feeds the live baked-tree rendering dependency.

**Later overwrite repaired:** `cloud-forest-tree-batcher.js` deliberately
reasserted its own independent radial+frustum decision on every fog update,
undoing `updateZoneVegetationCulling`'s visibility toggle. It now uses the
same game-owned directional gate, plus its tighter existing actual frustum
test, and invalidates the cache when the developer toggles cull modes.
The procedural and baked sources retain their separate gameplay ownership.

**Validation:** executable compact-corridor test exercises normal-zone
parity, camera turns, 30->10 slider changes, canopy XZ bounds, edge
hysteresis and tree opacity/outline thresholds. The baked-tree regression
covers externally hidden chunks and a stationary cull-mode toggle.
No real-device FPS gain has been measured yet; compare matched camera
paths and `CloudForestTreeBatcher.getDebugState()` with the settings A/B
toggle before making any numeric performance claim.

## 18 Nov 2026: redundant primary-folder recovery scans

Routine folder-save status notifications used to trigger a second sweep of all six
recovery slots. Each populated slot was read and parsed from disk, then mirrored to
browser storage again. Successful saves already mirror the affected slots as part
of the checkpoint write. Unchanged autosaves and lock-only writes touch no recovery
slot. These operations now publish status without the extra sweep. First arm,
folder load, restore and failure paths can still reconcile history. Recovery UI
refreshes read the folder directly, including changes made by another device.

The checkpoint harness recorded zero slot reads across 60 routine notifications
and six reads for one explicit refresh, which picked up an external checkpoint.
Save Diagnostics exposes recovery scan counts under `folderRecoveryReads`.

## 18 Nov 2026: combat afterimages now opt-in, off by default

A follow-up to the colored motion-smear experiment prioritizes runtime smoothness over an
effect that was difficult to see. Reverted the experimental GPU smear and retained the
original pooled/decimated portrait ghosts behind **Settings > Visual Effects > Combat
Afterimages**, stored as `hobunjiCombatAfterimages` (`'1'` enabled, `'0'` or missing
disabled). The checkbox is unchecked by default, including for existing players who
never chose an effect setting.

In the default-off path, `Combat.update` does not sample player dodge/lunge movement,
build snapshots, skin ghost geometry, refresh canvases/textures, update fades, or prune
the ghost pool. Hostile combat expression/AI and regular dodges, Blink, heavy attacks
and quick attacks continue unchanged; only the optional ghost path is skipped.
The direct spawn entry points also check the preference, including Blink teleport
bursts and enemy ghosts. Disabling afterimages mid-fight disposes live and pooled
ghost resources immediately and resets motion-history state before any subsequent
opt-in. The existing `HobunjiDodgeFeedback` mobile diagnostics expose
`afterimages.enabled` and the existing counters, plus an opt-in/out method.

This should eliminate *afterimage-related* combat frame cost when disabled,
not all possible combat freezes. Prior headless measurements identified ghost
snapshotting as one source of work but did not prove it was the sole cause.
Relevant old afterimage geometry/pooling tests now explicitly opt in, and the
Visual Effects runtime test covers default-off, enable, persistent preference,
resource reuse and disable/cleanup. Full device FPS still needs measurement.

## 16 Nov 2026: wilderness props drawn as merged batches; pants skinned on the GPU (headless)

**What spawns in the wilderness and what it costs.** Draw census of one frame per zone (headless, outlines on, every
pass counted): Western Slope 456, Eastern Mire 333-587, Cloud Forest ~430, Northern Cliffs 1,700-2,400 (NPC count
varies run to run). Game JS in a zone is ~1 s per 25 s of CPU profile, the rest is software GL, so on a real device the
cost is draw submission, as in the 14 Nov device data. Ground, mesas, bedrock, path ground, grass/rich foliage and the
Cloud Forest dense forest were already chunked or instanced. The spawned props were not: a bandit/Porakaneki tent is 8
two-triangle panels (80 draws per pass for a camp), a root totem ~7 meshes and all 12 are drawn zone-wide, reagent herbs
2 quads each, berry bushes 3 meshes, camp furniture (campfires, crate stacks, pedestals) and cliff-door puzzle caves
dozens each. Farm shrub wind sway (the one JS-animated foliage) is 20 groups: not worth moving.

- **`js/zone-prop-render-batches.js`:** same contract as the farm tile batches. Prop meshes under an owner tag
  (`projectileCoverKind`, `berryKey`, `reagentKey`, `rootTotemWorldVisual`, `authoredFurnitureKey`, `tzatzulNest`,
  `puzzle-cave-cliff-door-puzzle*`) that have held still for 1 s are hidden for the world render and drawn as one
  world-space merged mesh per 8x8-tile cell and identical render state. Moving meshes (flames, camera-facing parts,
  harvest animations) drop out until they settle. Transparent materials stay per-object (portraits are depth-sorted
  per actor; a merged batch would sort as one object), as do render hooks, array materials and custom shaders unless
  marked `userData.hobunjiWorldBakeSafe` (reagent herbs are). Northern Cliffs: **2,435 -> 1,756 draws** in the same
  view; batched vs unbatched frames differ by 13,114 px against 36,285 px between two unbatched frames (animation
  noise). Remaining rejections per kind are in `ZonePropRenderBatches.snapshot().rejectReasons`; the largest is
  transparent furniture art (~110 meshes). `setEnabled(false)` is the A/B switch. Test:
  `scripts/test-zone-prop-render-batches.js` (needs three r128).
- **Pants garment** (`js/pants-garment-renderer.js`): the per-vertex linear-blend skin that ran in JS every frame the
  legs moved (65x65 grid for the player, 33x33 per NPC, plus a full buffer upload) now runs in the vertex shader; the
  CPU computes 4 bone transforms and 2 ankle-ring shifts. `PantsGarmentRenderer.setGpuSkinning(false)` is the A/B switch.

**Not measured:** real-device FPS for either change.

## 15 Nov 2026 (applied): avoid redundant Spear Bridge fish SVG style writes

`fish-catalog.js` runs a presentation callback on each animation frame after a cast.
It used to assign `transformBox`, `transformOrigin` and `transform` to
`#fishDeformedImage` on every tick, even though the first two are constants and
the scale only changes with the selected fish. On browsers, same-value inline
style assignments can still invalidate style and queue mutation records.
The existing href observer already avoided duplicate image attribute writes.

The callback now compares each serialized inline value before writing and keeps
the original immediate correction when another writer changes a value, the fish's
authored scales change, or Fishing replaces the image element. Collision-mask
rendering, the animated href update and frame cadence are untouched.
`FishCatalog.getPresentationStyleDebug()` returns cumulative `writes`/`skips`
and `running` for phone-side A/B inspection. The existing `?fishingDebug=1`
panel now displays those counters once per second, and skips same-value water status
writes. The executable fake-DOM/RAF test
covers 120 unchanged frames, real scale changes, external overrides, image
replacement and a stop/restart cast. **Unmeasured:** on-device style-recalc and
FPS changes; this removes redundant mutation work, not a measured FPS claim.


## 15 Nov 2026 (applied): skip unrelated Gear detail-panel fitting and debug-only layout reads

The 9 Nov user-run browser trace had shown intermittent `inventory-gear-compact-effects.js`
`refreshPresentation` layout/style cost (5–12 ms per call, with 1.56 s cumulative style
recalculation in one trace), but did not isolate the cause. Code inspection found an
unnecessary part: every left-summary Gear rebuild caused the unrelated right-hand
item-detail panel's font fitter to reset six CSS variables and potentially run the
9-step overflow/binary-search measurement sequence, followed by four synchronous
geometry reads only needed for the debug snapshot.

The Gear module now reuses the last fitted result when only the left summary/inventory
mutates; item-detail changes, pane replacement, open/reopen, ResizeObserver,
orientation and window resize still invalidate it. Geometry for the debug snapshot is
read on demand instead of in each scheduled frame callback. The public `refresh()`
still returns those measurements explicitly. `InventoryGearCompactEffects.debugSnapshot()`
reports `fitStats.detailFits` and `fitStats.reusedDetailFits` for mobile A/B checks.
The Gear idle-cadence regression covers left-panel reuse, real info mutations, menu
hide/show, resize invalidation and lazy debug-only reads. A review follow-up made
ResizeObserver track content-box dimensions: first notifications and unchanged sizes
do not double-fit, left summary/owned-gear resizes only schedule maintenance, and
right-detail/section resizes still invalidate the cached font. When EquipmentPanel
replaces either inner Gear region without replacing its parent, the new nodes are
reobserved. The executable fitting fixture checks that item-detail mutations and
right-panel resizes still shrink text, while left-only updates do not refit.
A direct module smoke test confirmed 6 CSS-var writes on open, 0 additional writes
for a summary rebuild, 6 for an item-detail change, and 6 for resize (simple fitting fixture).

**Not yet measured on real hardware:** frame-time change, or what fraction of the
original style-recalculation trace was actually from this specific redundant fitting.
This is removal of provably redundant synchronous-layout work, not an FPS claim.


## 15 Nov 2026 (applied): vitals-bar affliction animations off by default, affliction names printed on the segments

Acting on the entry below: `player-vitals.js` now has two preferences (Settings > Visual Effects, persisted in
`localStorage` as `hobunjiVitalsAnimations` / `hobunjiVitalsNames`, exposed as `PlayerVitals.animationsEnabled /
setAnimationsEnabled / namesEnabled / setNamesEnabled`). Both are classes on `#vitalsBar` (`vb-fx-animated`,
`vb-fx-names`) that `style.css` keys off, so toggling never rebuilds a segment:
- **Animations: OFF by default.** Without `vb-fx-animated`, every `.vb-affliction-segment` and its `::before/::after`
  gets `animation: none !important` (droplets, whose base opacity is 0, simply do not show; flame/ember/entranced/mirror
  keep their static look), and the SVG SMIL drip/balloon morphs are paused with `svg.pauseAnimations()` (SMIL ignores
  the CSS rule). New segments pick up the current play/pause state once, tracked per segment.
- **Names: ON by default.** Each new affliction segment gets a `.vb-name` span printing the affliction's name,
  centred, in `'KhymeryyanRomanLetters+Numbers'` (the project's HUD face from `style.css`), white with a black outline.
  The label has its own `overflow: hidden` box over the segment, so a long name is clipped by the segment and bar edges
  but droplets and SVG shapes are not. Added after any shape so the shape stays the segment's first child.

Follow-ups the same day: the label drops the resource word the bar already implies ("Bleeding Health" -> "Bleeding",
"Winded Stamina" -> "Winded"; the hover title keeps the full name); the glyphs get a thin black outline
(`-webkit-text-stroke: .16em #000` with `paint-order: stroke fill`, so only the outer half shows); and the black outline
of each SVG-shaped segment (brittle / drip / starved / balloon / crenellated) is repeated in a second stroke-only SVG
(`.vb-outline-svg`, z-index 42) layered over the label (41) so the outline occludes the text. The opaque black backing
rect around the shape deliberately stays under the label (a first version masked it too and hid the name on pinched
shapes). A *starved* (pinched) segment such as Winded Stamina originally closed to 1/3 of the bar, leaving a couple of pixels
between its two outline strokes, so its name was mostly hidden; the pinch is now `STARVED_PINCH = 3.33` of the 40
viewBox units per side (a throat of ~5/6, still visibly concave, label fully readable; 13.33 restores the old shape). Plain bordered segments needed nothing: their
label already sits inside the border's padding box.

**Three anchors, one per affliction (player vitals bar).** Each affliction hangs off exactly one anchor and is drawn only
there (`PlayerVitals.afflictionAnchor(id, def)`; bands carry `data-anchor`): `start` = the bar's zero (`extend: 'zero'`
non-reducers: Wounded/Infected/Frostbitten/Shattered Stamina), `current` = the end of the current resource
(`currentBack` and the Drunken Health buffer: Bleeding, Bruised, Poisoned, Burning, Kindling, Entranced, Scent-marked,
Corroded, and the enhanced Resolute/Mirrored/Furious/Moralized bands), `end` = the end of the bar (anything that locks
away maximum: Winded Stamina, Congealed/Rent/Wounded Health, Shambling/Drunken Footing). Before this, a capacity reducer
was drawn twice, as its `zero` band at the left AND as the lost-capacity cap at the right (visible as "Wounded ...
Wounded" on one bar); the code comment called that deliberate, the author's call was that it is a bug. End-anchored
afflictions now live only in the lost-capacity cap (`.vb-cap`, drawn by `refreshVitalsHud`, not by
`drawAfflictionSegments`), which is split into one piece per active reducer (`drawCapPieces`): each piece has its own
colour, pinched shape, outline-over-text overlay and short name, its width is that reducer's share of the cap by
amount (`getAffliction`), the strongest by priority sits at the far right and weaker ones stack leftwards from it.
Pieces persist by affliction id (an amount change only resizes them), a cleared reducer loses only its piece, and all
pieces are dropped once no reducer is left while the row is still shown. (An earlier version drew one cap in the
strongest reducer's colour with the names joined by " / "; splitting it fixes simultaneous reducers being
indistinguishable.) Checked in the real game with one affliction of each anchor on all three bars (Health cap: Congealed | Rent | Wounded
as three coloured pieces), and in
`scripts/test-player-vitals-hud.js` by applying each of the 20 base afflictions alone and asserting it is drawn in
exactly one place (a band for `start`/`current`, the cap only for `end`).

Verified in the headless game with the real Settings checkboxes: defaults `{animations: false, names: true}`, font loaded,
toggles flip the classes and persist; burning with the defaults **190-191 ms vs 284-298 ms with animations on** (control
174-205), wounded health 177-220 vs 234-262 (control level again). Screenshots show the names in the segments.
`scripts/test-player-vitals-hud.js` covers the defaults, the label text, both toggles, SMIL pause/resume and no label
duplication across refreshes (mutation-checked). `style.css` is not covered by `check-cache-busts.js`: its `?v=` token in
`index.html` was bumped by hand (`20261115vitalsNames1`); do the same for any later stylesheet change.

## 15 Nov 2026 (follow-up): afflictions, knockback, hit/knock-down/low-Footing animation, lunge ring trail (headless)

Headless arena, player as the subject, per-tick frame wall time via a `Combat.update` hook, control = 14-24 neutral
ticks in the same session (drifts +-10 ms): neutral 187-194 ms. Software WebGL and software-composited DOM, so
absolute numbers are inflated; the ranking and the attributions are what carry over.

**Cheap or free (inside noise, +-10%):**
- *Knockback.* `damagePlayer` with no / default (260) / heavy (900) knockback: 195 / 200 / 198 ms vs 187 control. The
  hit-reaction code is `ImpactRagdollPlayback.update` at ~0.1 ms per tick.
- *Getting knocked over.* A real knock-down through `damagePlayer(..., {footingDamageMultiplier: 30})` (the
  `applyHitStagger` -> `enterPronePose` path; `spendFooting` alone only drains Footing and never goes prone):
  prone for all 69 recorded ticks in 4 of 4 cycles, **193 ms prone vs 194 neutral**, ragdoll JS 0.08 ms per tick.
- *Walking with lowered Footing* (holding W; `drunk-locomotion.js` sway/gait): 160 ms full Footing, 164 at 25%,
  173 at 5% (+8% at the extreme, near noise); standing at 25%: 179 vs 187.
- *`ResourceSystem.tick` with many afflictions:* 11-18 us per entity whether it has 0 or all 18 afflictions
  (24 defined, 18 non-immutable/non-enhanced), `applyDamage` 12.5 -> 21 us with 18 active. 30 NPCs would be well
  under 1 ms. The `hobunji-resource-change` event itself costs 13 us per dispatch.
- *Lunge ground-ring trail* (`spawnLungeTrailStamp`, game.js): 6-8 stamps per lunge. One stamp is a `Group` + a new
  24-segment `RingGeometry` + a new additive `MeshBasicMaterial` + `bindGroundProjection` hooks: **32 us to build, 2 us
  to dispose** (12 us build if the geometry were shared). About 0.25 ms per lunge. Frames with the trail (afflictions
  picked) vs the same lunge with none (no trail by design): post/pre 1.08 vs 1.19, i.e. no measurable cost. Renderer
  geometry count stays flat (disposed after 0.55 s). Not worth sharing the geometry.

**The one real cost: afflictions that drain Health each tick, through the vitals HUD.** All 18 afflictions at once:
**294 ms vs 187 (+57%)**. One at a time vs a 186 ms control: burningHealth +135, woundedHealth +102, kindlingHealth +89,
entrancedHealth +81, poisonedHealth +61, bleedingHealth +57; every other affliction is under +25 (bruised, congealed,
drunken, corroded, rent, wounded Stamina ... are free). What it is not: JS (tracked functions < 0.6 ms per tick, CPU
profile of wounded vs control equal and ~90% native `(program)`), renderer work (draws 16-22 and triangles ~17k, render
time 8-12 ms in every case), world popups (`WorldPopupText.showChange` suppressed: no change), the
`hobunji-resource-change` listeners, SVG SMIL (pausing it: no change). What it is: the **vitals bar** (`#vitalsBar`,
only 390x12 px). Hiding it removes the cost (wounded 303 -> 208, burning 302 -> 233); **disabling only its CSS
animations** (`animation: none` on `#vitalsBar *`, `*::before`, `*::after`) takes wounded from +78 ms to +9 ms and
burning from +153 to +47 over control, while disabling its transitions changes nothing. The animated pieces are in
`style.css` (~lines 305-410): `.vb-effect-drip::before/::after` droplets (`vb-fluid-drop`, translating up to 10.5 dvh,
z-index 40), `.vb-effect-fire::after` (`vb-flame-flutter`, repeating gradient with `inset: -.38dvh`),
`.vb-effect-ember`, `.vb-effect-entranced` waves, `.vb-effect-mirror` sweep. 5-7 animations run at once while afflicted,
against 1 in control. `player-vitals.js` itself compares before writing; its per-tick style writes (health fill width,
segment left/width) are not the cost. Remaining burning cost with the bar hidden (+69 ms in that run) is something
else (world Burning VFX / ground fire), not chased.

**Caveat that matters:** this is software-composited Chromium; compositor-only animations (transform/opacity) are
cheap on a GPU browser, so this is a pointer, not a proof. Before changing CSS, read a real-device `PerfProfiler`
snapshot (and the browser's rendering/paint-flashing tools) with a burning/bleeding player. Cheap options if it holds:
pause the vitals-bar effect animations when the effect is not on screen/paused, animate one shared layer instead of
per-segment pseudo-elements, or give `#vitalsBar` `contain: layout paint style` so the animated layers are isolated.

Harness traps from this run: `page.evaluate` closures do not carry local variables (pass them as arguments);
`Combat.update` timing counts every frame (including the headless 200 ms ones), so compare within a run; `hold`-style
refills (health reset every tick) make DoT afflictions look like they damage every tick, which is what a real DoT does
anyway but inflates `hobunji-resource-change` traffic compared with a single hit.

## 15 Nov 2026 (follow-up): strike frames with weapon mastery effects and Mercy Spike equipped (headless; no cost found)

Same arena dummy harness (passive bandit grunt, 15% health so Mercy Spike's below-30% bonus applies, dummy 0.75 tile
ahead, stamina refilled each attack). Weapon: this world's starter (`hoe_nativeCopper`; the starter differs per new
world). Setup done in-page: `HobunjiMasteryPolicy._test.awardMastery(key, 300, ...)` (the `devBumpToolMasteryLevel`
export is wrapped by the mastery policy and silently does nothing for a headless caller; the policy's own `award` is the
supported hook) -> Mastery 5; `awardMotesOfProwess(200)`; `TechniqueScrolls.unlockAbility('mercySpike')` (the loadout
refuses a quick attack that is not unlocked, `setSlot` returns false) then `Combat.loadout.setSlot('tap2', 'mercySpike')`;
`CombatProgression.choose(...)` for levels 1-5 of both the weapon's combo and Mercy Spike (first option each).

From `CombatAttackEvents` `hit` events (not from dummy health: the dummy regenerates, so health deltas went negative
and are useless as a hit counter): left-click combo **10/10 attacks hit**, 3.6 damage, hit payload carried
`afflictionBonuses` `bruisedHealth 1.69, windedStamina 0.63, shatteredStamina 0.55`; right-click Mercy Spike **7/10
hit**, **37.8 damage, `quickConditionalBonus` and `quickBonusEffectProc` true**, payload `bruisedHealth 3.38,
windedStamina 1.26, shatteredStamina 1.1` (the misses are Mercy Spike's narrow 14-degree cone, not mastery).
**Not verified:** that those amounts actually landed on the dummy. The hit payload is what the attack hands to
`ResourceSystem.applyDamage`, which calls `addAffliction` per entry; my attempts to read the dummy's afflictions back
looked at the wrong ids (bleeding/wounded/infected/poisoned while this weapon's picks grant bruise/wind/shatter) and
the dummy's own affliction state was not otherwise inspected, so "affliction cost at the hit" is only measured up to
the payload, not the target-side `addAffliction`/`setAffliction`/`enforceCaps` work.

Frame time, medians over the hit cycles: combo neutral 193 -> windup 192 -> recover 193 -> post-hit 184 ms (post/pre
**0.95**); Mercy Spike 188 -> 172 -> 179 -> 181 ms (**0.96**; whiff cycles 0.92). With the unpicked baseline in the same
session post/pre was 1.00-1.20 and noise is +-0.1, so **the mastery payload, the bonus-proc path and the Mercy Spike
windup add nothing measurable at the moment of the hit** (target-side affliction application unverified, see above).

Two traps and one finding from the setup:
- A first attempt measured a "mastery" run that had no mastery (level stayed 0, every pick returned false): check
  `toolMasteryLevel` and the `choose` results before trusting a mastery A/B.
- Reading hits from `dummy.health` is wrong for anything that regenerates; use the hit event.
- **Right-click with an empty tap2 slot overflows the stack.** `useActiveAction` (game.js, weapon branch) routes slot 2 to
  `Combat.input.fireTap(2)`, which with no ability falls back to `legacyTapFallback` -> `fireLegacyWeaponAction` ->
  `useActiveAction` -> `fireTap` ... until `RangeError: Maximum call stack size exceeded` (seen as a page error with
  `isLockedIgnoringOwner` at the top). Every new weapon has tap2 empty until a quick attack is unlocked. It is harmless
  to state but burns a full stack's worth of calls per click; a guard in `fireLegacyWeaponAction` would also decide
  whether that click should perform the legacy swing it was written to fall back to, so it is left for a gameplay call.

## 15 Nov 2026 (follow-up): what is left after the strike afterimage fix (headless; nothing further worth changing)

Same arena dummy harness, run on `main` after the ghost decimation/cap merged (PR 1809). Questions: is the remaining
post-swing frame-time lift caused by the hit, and what else could it be?

- **Not the hit.** Interleaved hit vs whiff (dummy 14 tiles away, same weapon, 10 attacks each): post/pre frame ratio
  **1.15 hit, 1.22 whiff**. The lift follows the swing, not the damage, so hit reaction, knockback, hit-flash, camera
  shake (ruled out earlier) and `damageCreature` are not it.
- **Not session drift.** No-swing control, 30 consecutive neutral ticks repeated 8 times: 165 / 161 / 168 / 170 ms across
  ticks 2-8 / 9-16 / 17-24 / 25-30 (flat). A swing run in the same session: pre 164, post 182 (ticks 13-20), 174
  (ticks 21-28): about **+11% decaying to +6% over ~0.5 s of game time**.
- **Residual is near the noise floor.** Four interleaved modes, 8 attacks each (normal / afterimage ghosts hidden /
  "no trail" / both): post/pre per-run median 1.10 / 1.03 / 1.03 / 1.04, pooled medians post 175-178 vs pre 174-179 ms.
  The "no trail" mode never changed anything (`Combat.spawnMeleeTrail` was called 0 times: the player's weapon trail is
  not built through that export), and it still read 1.03 against 1.10 for the identical normal mode, so run-to-run
  noise is about +-0.05 and the ghost-hiding difference is not distinguishable from it.

Conclusion: after the decimated, capped ghosts, nothing on the strike path measures above the headless noise floor
(~5%); the earlier larger post-hit numbers were mostly the five full-density ghosts. Remaining unmeasured ground, if a
real device still shows a hitch: the first lunge after the 4 s pool idle (entry creation: geometry/material clones, canvas
copies, texture uploads, measured earlier at ~1 ms of JS but with real GPU upload costs headless cannot show), and
skipping a snapshot when the previous frame was already over budget. Reading a device `PerfProfiler` snapshot across a
fight would settle both.

## 15 Nov 2026: the moment a player strike lands on a non-fighting dummy (headless, measured; nothing fixed)

Setup: Testing Arena, a `bandit:grunt` with `aggroRangePx = 0` and its attack cooldown pinned (it never swings back),
placed 1.3 tiles ahead, player hitting with a real mouse click. 480x270 viewport, outlines on, software WebGL. The
tick hook wrapped `Combat.update` (called mid-`gameLoop`), tagged each frame with the staged-action phase and took the
wall time between ticks. Phases for the starter weapons seen (fishing spear, pick-shovel): `windupS` 0.23-0.32 s,
**`strikeS` 0** (the hit lands at the end of the windup, so there is no separate strike or lunge frame in the
staged action; a "lunge" shows up as player displacement only for abilities that move), `recoverS` 0.20-0.28 s.

Frame wall time by phase, medians over 8-16 attacks per run (runs differ by +-15% in absolute terms, so compare
within a run): neutral before **182-211 ms**, align 171-207, windup 202-226, strike/recover 208-254, neutral after
**199-246**. So the hit frame is **about 5-25% heavier than neutral and the heaviness lasts through the first ~12
ticks after the hit (~0.5 s of game time)**; there is no single-frame hitch. Per-phase `console.profile` switching
cannot be used for this: each switch costs ~750 ms of self time and drowns the signal (measurement trap, see below).

Where the extra time is, from per-function accumulators wrapped around ~620 module functions and the THREE/GL calls:

- **JS attributable to the attack is small, ~3-10 ms per tick in a ~200 ms frame:** `ProceduralHandFrameDriver.syncNow`
  (+1.7 ms on the first windup tick only), `ResourceSystem.applyDamage` (~1 ms, once), `AudioSystem.playWeaponSlashSfx`
  (~0.8 ms, once), `ResourceRings.updateRingHud` (0.4 -> 0.9-1.3 ms for a few ticks).
- **The largest repeating item is the portrait afterimage in `combat-blink-dodge.js`.** While the player lunges, every
  forced-move sample (`AFTERIMAGE_FORCED_MOVE_INTERVAL_S` 0.055 s) bakes the player's skinned portrait planes into a
  ghost: **12,096 `SkinnedMesh.boneTransform` calls = 2.5-7 ms per snapshot**, plus one `BufferGeometry.clone`
  (0.8-1.4 ms) whenever the pool has no matching entry, and a canvas copy + texture upload when an entry is created
  (the pool is dropped after `AFTERIMAGE_POOL_IDLE_S` 4 s, so the first attack after idle re-creates them). Scene diff
  before/after one swing: **+5 `combat_portrait_afterimage` meshes, +20,160 triangles per snapshot** (up to ~5
  snapshots are alive at once with the 0.28 s lifetime), i.e. renderer triangles 17k -> 24k and draws 18 -> 22.
  That native triangle work is where most of the post-hit +20% shows up in software GL, and the garbage collector
  (0.4 -> 7.7 ms/tick) follows the clones/disposals.
- **Ruled out:** camera shake / hit-stop (`GameFeel.setShakeEnabled(false)` alternating with on over 16 attacks:
  post/pre frame ratio 1.22 off vs 1.18 on, no difference); creature hit-flash tint (a `traverse` on the dummy rig
  only); `damageCreature` JS itself (~1 ms).
- **Tried and dropped:** replacing the per-vertex `boneTransform` call in `bakePortraitGeometry` with precomputed
  per-bone matrices and scalar math produced bit-compatible output (checked against three r128) but ran at **1.0x**:
  V8 already optimises stock `boneTransform`, the cost is the 12k-vertex walk, not the matrix products. Not shipped.

**Applied afterwards (same day):** two changes in `combat-blink-dodge.js`, both cosmetic-density only.
(1) *Decimated ghosts:* the portrait plane is a non-indexed grid (`buildSkinnedPlaneGeometry`, 28x36 cells, 6 vertices
per cell, front then back face). A ghost now merges 2x2 cells into one quad from the block's four corner vertices
(same UVs, same posed positions at the corners): 4,032 -> 1,008 triangles and 12,096 -> 3,024 `boneTransform` calls per
snapshot. Geometry that is not that grid (no `userData.segmentsX/Y`, indexed, other group counts) keeps the old full
clone. `AFTERIMAGE_DECIMATE_CELLS = 1` restores full density. (2) *Per-actor cap:* `AFTERIMAGE_MAX_PER_ROOT = 3` live
ghosts per actor (the global cap of 24 stays); with the 0.28 s fade the two oldest of five were nearly invisible.
Checked on the real game (same headless harness, 8 attacks): peak live ghosts 3 with 3,024 ghost triangles in total
(was 5 ghosts / ~20,160), `boneTransform` 3,024 per tick (was 12,096). **Headless frame time did not visibly move**
(neutral 180 ms, windup 215, recover 199, post-hit 224, against 182 / 226 / 208 / 232 before, inside the +-15% run
noise), so on software GL the post-hit +20% is mostly something else; the gain here is the removed JS/GC/triangle work,
which matters on a CPU-bound device, not a measured FPS change. Tests: `scripts/test-afterimage-decimated-ghost.js` (needs three r128; mutation-checked), and the pooling/blink tests
now pin the per-actor cap. Still open: skipping a snapshot when the previous frame was already over budget.

Measurement traps from this run: `console.profile`/`profileEnd` inside the loop (~750 ms each, appears as a function
named after the caller); `lastDurationMs`/EMA scheduler timers read mid-frame are the *previous* frame's smoothed
values and do not change at the hit; `renderer.info.render.calls` read after the frame only holds the last pass
(sum it inside a wrapped `render`); wrapping every function of ~70 namespaces plus a 400 MB heap crashed the tab
(Chromium OOM) after a few hundred attacks, so run those A/Bs with a fresh page and under ~10 cycles.

## 15 Nov 2026: the farm draws every tile separately, with its own cloned texture

Player readings on the farm (CPU-bound, GPU 10-17%): 10.6-14.5 FPS, game loop 45-52 ms, plus 20-42 ms "unattributed"
outside game JS. Draw census on the farm (headless, outlines on): **1,103 real draws per frame** (town 573, western
slope 183): about 500 per-tile ground slabs, about 270 shadow-map draws (`MeshDepthMaterial`; the farm sun is the only
shadow-casting light), and multi-mesh furniture (a compost bin is 56 meshes). 1,014 of the farm's objects are
top-level per-tile meshes. With outlines off the base replays were larger (540 vs 61 draws): the near-only depth copy
needs the offscreen target that only exists with outlines on, so turning outlines off does not help on the farm.

Three fixes:

- **Terrain jigsaw cloned a material and a texture per farm tile.** `TerrainJigsawUV.bakeMesh` treats every
  material-ID-layer mesh as terrain and gave each its own `mat.clone()` + `map.clone()`: 443 distinct materials and
  ~220 extra GPU textures of the same grass image on the farm. The clone is determined by its source material and the
  wall flag, so farm tiles (now tagged `userData.hobunjiFarmTile` by `vegetation-crop-rendering.js`) share one clone
  per (source, wall) while the source's `version` and `map` are unchanged. Other callers keep independent clones
  (wilderness chunk cleanup disposes the materials it owns; `test-chunk-jigsaw-texture-sharing.js` pins that).
  Farm GPU textures 353 -> 135; `TerrainJigsawUV.snapshot().sharedJigsawMaterialReuses` counts reuses.
- **`js/farm-tile-render-batches.js`:** for the world render only, farm tiles game.js marked as terrain are hidden
  and drawn as merged world-space meshes per 8x8-tile cell and identical render state (material, layers, shadow
  flags, render order, edge-ID colour, ground tags). Tiles stay the authority for edits and raycasts; a batch is
  rebuilt only when a member mesh, its geometry/attribute versions or world position change. game.js records the
  edge-ID colour (`userData.hobunjiTerrainEdgeIdColor`) so the batch can carry the same seam hook. Batches are tagged
  `terrainRenderChunk` so the held-object ground x-ray classifies them as terrain and the jigsaw/chunker skip them.
  Farm: 970 tiles in 53 batches; **draws per frame 1,357 -> 881** (base pass 1,103 -> 645). Batched vs unbatched
  synchronous frames differ by 652 px, the same as two identical unbatched frames (646) or batched frames (631): only
  the turning windmill blades differ. `FarmTileRenderBatches.setEnabled(false)` is the A/B switch; `snapshot()` has
  per-reason rejection counts.
- **`js/shadow-map-refresh-throttle.js`:** the farm sun and shadow camera never move, so the shadow map is refreshed
  every 250 ms or when the active scene or its direct child count changes, instead of every frame. Most farm ground
  is unlit `MeshBasicMaterial` and never shows these shadows. `ShadowMapRefreshThrottle.setEnabled(false)` restores
  per-frame updates. (Not visible in headless counts, where every frame is longer than 250 ms.)

Also from the same readings: `inventory-ui.js` re-ran its full `decorate()` (77-87 ms on the player's desktop) for
every inventory DOM change, including item pickups while the menu is closed; it now defers until the inventory pane is
on screen. `local-save-folder-core.js` re-read the whole browser save every second to detect changes; it now polls
every 5 s (syncs were already debounced 4 s and held to one per 20 s).

## 14 Nov 2026 (device data): CPU-bound on draw submission; most draws were hand/foot replays for NPCs

**First real-device reading** (player's desktop, Opera GX, outdoors, Performance Profiler overlay): GPU 8-14%
busy while frames took 44-76 ms, so the game is **CPU-bound**, not fill-bound. Outlines off: 21 FPS, game loop
34 ms, render passes 25 ms. Outlines on: 11 FPS, game loop 50 ms, render passes 39 ms (base 14.4, held-overlay
replays 11.4, shell outline 9.9) plus 24 ms "unattributed" (time outside game JS: the browser/GPU process working
through draw calls). The lever is draw calls per frame.

Draw census by pass in the headless harness (one frame each, `HeldObjectRenderOrder.replayingDepth` separating
replay draws):

| | Real base | Base replays | Real shell | Shell replays | Total |
| --- | --- | --- | --- | --- | --- |
| Town, before | 575 | 646 | 77 | 785 | 2,107 |
| Town, player-only participants | 607 | 217 | 110 | 150 | 1,108 |

Replays were 60-75% of all draws. Most of that was **NPC rigs**: every visible NPC's hands and feet joined the
ground x-ray (town: 4 elevation groups, 42 participating meshes; western slope: 2 groups, 13), each group
re-submitting nearby scenery and the union widening the scissor. The x-ray only matters where the floor can swallow a
part, and it only ever exempts the holder's own tile and its 8 neighbours (`XRAY_TILE_RADIUS = 1`). The participant
rule in `held-object-render-order.js` (agreed with the player) is now:

- weapons and other held items: every character;
- hands: the player and short species (`SHORT_XRAY_SPECIES`, default `['porakaneki']`);
- feet: the player and short species, only within 6 units of the camera;
- parts with no resolvable owner keep the old fail-safe x-ray.

Everything else draws with ordinary depth and is hidden from the replays' overlay passes so it is not drawn twice.
Same session, same frames, new rule vs old: town 1,411 -> 1,022 draws per frame, western slope 528 -> 301. Town
screenshots showed no visible difference. `HeldObjectRenderOrder.setReplayParticipants('all')` restores the old set;
`setShortXraySpecies([...])` and `setFeetXrayDistance(units)` tune the rule; `snapshot()` reports them and
`nonParticipantReplaySkips`. Tradeoff: a tall NPC's hands and feet, and any distant feet, can be clipped by uneven
ground the way the rest of the body already is. `scripts/test-held-replay-participants.js` runs the real ownership
code on a fake rig hierarchy.

**Floor punch (15 Nov 2026, base replay only).** Because only that 3x3-tile patch is ever x-rayed, an x-ray group in
the base held replay no longer clears depth and redraws every occluder in its scissor when `ScissorDepthSnapshot` can
copy the original back. It keeps the existing depth, stencil-marks (bit 0x80) pixels where the holder's nearby floor
is frontmost by drawing only ground that touches the patch through each ground material's own program with the x-ray
filter inverted (`enabled = 2`, depth LEQUAL, no depth/colour writes), resets those pixels to far depth with one quad
(clearing the mark), then redraws only non-ground objects in the patch column that reach below the floor (with the
camera above it, anything behind a frontmost floor pixel lies under the floor plane). Later groups restore the saved
depth first. Synchronous frames rendered into a depth-stencil target like the game's: **0 pixels differ** in town and
the western slope, the farm within its own frame-to-frame noise. Real frames: base-replay draws town 227 -> 204,
western slope 66 -> 58, i.e. about 2% of the whole frame. The gain is small because the near-only cull and the
participant rule had already made the rebuild local; much of what remains is the holders' own skinned rig parts,
whose bounds are unknown and are kept conservatively.

**Not applied to the shell outline replay:** by then the saved depth also contains the PNG-silhouette occluder pass,
which the old clear-and-redraw removed around the holder. Keeping it hid hand/foot outlines (caught by comparing
paused real frames; a foot lost its black shell). The shell replay keeps the clear-and-redraw.
`HeldObjectRenderOrder.setFloorPunchEnabled(false)` is the A/B switch; `snapshot().floorPunch` has counts.
`scripts/test-held-floor-punch.js` runs the real helpers; `test-held-near-replay-depth-snapshot.js` covers the
compositor integration (no clear, patch cull per group, depth reset before a second group, fallbacks).

Also: replay-inert detection now covers sprites with alpha cutoffs (sun/moon; only meshes get depth forced for
cutouts) and Points (campfire/bonfire particles), and, only when the replay restores depth by copy, objects whose
material pins depth to the far plane (cloud masks via `skyLayerDepthNdc`, Western Slope backdrops via
`backgroundMaxDepthNdc`). Replay path counters showed 682 of 686 wilderness replays scissored and culled, so the
full-screen fallback was left as it was.

## 14 Nov 2026 (later): outdoor JS, not just graphics; failed NPC path searches retried forever

After the sky/grass/replay pass the report was still ~17 FPS outdoors. Per-area CPU profiles (headless, same world):
the game loop's JavaScript was **45 ms/frame in the western slope vs 23 ms in a building interior** (scene objects:
4,033 vs 544; town 3,043). About half of that gap is render-side JS (25 vs 14 ms: more objects per traversal, more
replay work); the largest single non-render item in that window was NPC pathfinding, ~11 ms/frame, absent indoors.

Logging every grid-path start over 150 s in the wilderness found two walkers retrying impossible searches:

- `kaboku_kunji`, simulated in **town while the player was in the wilderness**, failed a path to the carpenter's exit
  (22,11) 48 times, **~33 ms per failed search** (a failed swept A* explores its whole bounded box).
- The Nohuknuk stood idle failing a search to a target 150 tiles away (180,104) 136 times, ~5 ms each.

`npc-pathfinding.js` cached a failure for 750 ms keyed on target + start tile, so a walker that is standing still
repeated the full failed search every 0.75 s forever. Now each further failure with the same key doubles the wait
(750 ms -> 1.5 s -> ... capped at 12 s); moving to another tile, a new target or any success resets it.
`debugSnapshot().pathFailureBackoffs` counts lengthened waits. `scripts/test-npc-collision-aware-pathing.js` steps a
fake clock: the old code re-ran the search 53 times in 40 s of standing still, the new code 8 or fewer.

## 14 Nov 2026: costs only outdoor maps pay (sky, grass, replays, cave entrances)

Report: never above ~16 FPS outdoors, fine inside caves and buildings. So the target was work that (1) only
exists or is large outside and (2) is shared by every outdoor map. Headless census, same build, 480x270:

| View | Draw calls / frame | Triangles / frame | Scene renders / frame |
| --- | --- | --- | --- |
| Town (quiet, player + a few NPCs) | 1,655 | 3.27 M | 4.4 |
| Western slope (player + one burrow NPC) | 299-598 | 0.37-0.71 M | 4.4-4.7 |

The wilderness frame is small in geometry (hundreds of draws, well under a million triangles), so a real GPU stuck
at 16 FPS there is most likely paying per *pixel* or per *draw call*, not per triangle. What every outdoor scene has
and no interior has:

- **Sky dome: 7 full-screen layers on every pixel.** The base sky, then three invisible cloud *depth masks*, each
  eroding the cloud atlas with **9 texture reads per pixel**, drawn *before* any world geometry (render order -850),
  so all 27 reads ran on every pixel, including pixels terrain was about to cover. Then three cloud shells.
- **Grass:** one alpha-tested `ShaderMaterial` shared by farm, town, town border and every zone (28 blades per grass
  tile in the wilderness), drawn at full density to the horizon.
- **Hand/foot depth replays:** in the wilderness the main + shell passes were 383 + 250 draws in one frame; per object
  the sun/moon/glow sprites were submitted 18 + 12 times and every campfire/bonfire flame and smoke emitter 6 + 4
  times, though none of them can write depth.
- **JS:** `PuzzleCaveEntrances.concealDenFacade` ran `scene.getObjectByName` over the whole zone every frame for
  any puzzle cave whose den has no facade mesh (about 2 ms/frame headless).

Changes:

- `sky-dome.js`: the cloud atlas is eroded once on the CPU when it is built and the mask shader reads it once:
  **27 -> 3 texture reads per sky pixel**. The bake (`HobunjiSkyDome.erodeCloudAlpha`) reproduces the old shader
  exactly at texel centres: a linear tap 1.5 texels off a centre is the average of the two texels it straddles, so the
  9-tap min is a min over three horizontal pair-averages, each at three vertical pair-averages
  (`scripts/test-sky-cloud-mask-erosion.js` checks it against an emulation of the shader's taps). Costs ~45 ms of JS
  per band when the weather bucket changes (the atlas rebuild that triggers it is already a hitch of that size) and a
  2 MB luminance texture per band.
  The masks now draw after the opaque world (render order 100000+band, still nearest band first and still before the
  transparent shells), so GPUs with hierarchical depth reject terrain-covered pixels. The star hash is skipped while
  `uStars` is 0 (daytime). `updateSkyColors` no longer allocates ten `Color`s per frame. If the atlas cannot be read
  back, the original 9-tap mask is kept. `HobunjiSkyDome.setErodedCloudMasks(false)` is the A/B switch;
  `getDebugState()` reports `erodedCloudMasks` and `cloudDepthMaskRenderOrder`.
- `vegetation-crop-rendering.js`: the grass material (only that material, via the `HOBUNJI_GRASS_DISTANCE_LOD`
  define) thins blades by distance in the vertex shader: full density within 12 units of the camera, tapering to 35%
  at 34+ units (fog already washes most of that out). Dropped blades, and blades the season hides (`uDensity`), are
  moved outside the clip volume so they are never rasterised or alpha-tested. Same per-blade random as the seasonal
  mask, so the kept set is stable while walking. `VegetationCropRendering.setGrassDistanceLod(false | {near, far,
  minKeep})` tunes or disables it for every outdoor map at once.
- `held-object-render-order.js`: `isDepthReplayInert` now also drops untagged leaves that provably cannot change a
  colorless depth replay: layer 0 only, every material `depthWrite:false` with no stencil write or alpha test, not a
  protected cover / PNG occluder / tint cover, no custom `onBeforeRender` (the pose-sync meshes need their hooks).
  Covers the celestial sprites and additive emitters above. `setAutoInertReplayEnabled(false)` is the A/B switch;
  `snapshot().autoInertReplaySkips` counts skips.
- `puzzle-cave-entrances.js`: the den-entrance group is cached per portal while it stays attached to the scene; a
  missing group is searched for at most every 0.75 s (the existing late-mesh cadence).
- Outline composite (now `js/outline-composite-material.js`, extracted from `game.js`): seam outlines are off by
  default, and the full-screen composite read 7 textures per pixel regardless. It now returns after one read when
  `uSeamOutlinesOn` is 0.

Measured (headless SwiftShader: relative only, same session, same frozen frame):

| Check | Result |
| --- | --- |
| Western slope 1280x720, sky alone, legacy vs eroded masks | 232 ms -> 160 ms (-31%) |
| Western slope 1280x720, whole frame, everything old vs new | ~728 ms -> ~648 ms (-11%, median of 2x3 renders per config) |
| Cloud masks old vs new, full frame (town and zone, first half-resolution bake) | 0 pixels differ |
| Cloud masks old vs new, sky alone at 800x450 in rain (cloud bucket 2) | 217 of 360,000 pixels differ (cutoff-edge texels); the first half-resolution bake differed in 2,144 |
| Replay auto-inert on vs off, base pass, three sessions | town 1,030 -> 987 and 1,366 -> 1,266 draws; western slope 559 -> 517; 0 pixels differ in each |
| Grass LOD on vs off, town 480x270 | 656 of 129,600 pixels differ (distant blades) |
| Grass LOD on vs off, western slope | 0 pixels differ in that view; no measurable time change |

Software rasterisation has no hierarchical depth, so the render-order half of the sky change cannot show here, and
480x270 hides fill cost behind geometry (town barely moved: 6.84 s -> 6.67 s). **Not measured:** real-device FPS.
On a phone-sized drawing buffer (2-3 M pixels) the sky masks alone were ~70 M texture reads per frame before this.

**Still the largest outdoor multipliers, not changed here:** the held/shell replays (in the wilderness the shell pass
is ~40% of all draws, nearly all of it the x-ray replay, not shells), and town's 3 M triangles. Two universal (not
outdoor-only) costs worth an A/B on a real device: the canvas is created with `antialias: true` although, with
outlines on (the default), only the full-screen composite quad is drawn to it, and `preserveDrawingBuffer: true`
(kept for Pixel Probe captures) forces a full-frame copy per frame on many mobile GPUs.

## 14 Nov 2026: Harlyao night-march planner and avatar churn

The commander beacon also called `CalendarSystem.timeDebugSnapshot()` through `civilDay()` every render frame. That diagnostics call formats dates and modal previews and scans UI state; `civilDay()` now reads the same live absolute `calendar.day` directly, retaining the diagnostics fallback only before the calendar is wired. The actual per-frame `commanderTarget()` beacon path now uses only the active-hour check and never resolves the daily route or full calendar snapshot.

The Harlyao army already simulates as twenty data-only agents outside its detailed bubble. A further unnecessary cost was found: while the active march zone was unloaded and no portraits were retained, the 0.2 s controller still replanned every soldier despite abstract positions only advancing every `offChunkTickSeconds` (1 s). The controller now skips those intermediate planning passes, retaining elapsed travel time, daily-route checks and the full 0.2 s wake/combat cadence when near.

On obstructed arrival tiles, `makeEntity` could repeatedly construct, ghostify and dispose a full portrait without a valid spawn. Each failed agent now backs off 1/2/4/8/16 seconds while it remains in the same eight-tile search neighborhood; arriving in a new neighborhood or re-entering the zone permits an immediate retry. While the player briefly leaves the same-zone 24-tile release boundary, detached dormant rigs are retained for twelve seconds instead of three to avoid rapid reallocation. Leaving the march zone still retires them after three seconds. The existing avatar/weapon materials are restored on real disposal, and dormant roots remain detached from the scene.

`HarlyaoNightMarch.debugSnapshot()` / `formatDebug()` report `abstractPlannerSkips`, `blockedPlacements` and `blockedBuildSkips` for mobile testing. The existing Pixel Probe report adapter now includes those counts and coarse ticks, so mobile users can verify the optimization without a console. The production-controller regression now covers travel, blocked retries and warm wakes. **Not measured:** GPU/browser frame time or peak memory on a physical device. Warm caching retains dormant JavaScript/Three resources longer in exchange for avoiding rebuilds; it does not add scene draw calls during dormancy.

## 14 Nov 2026: NPC-vs-NPC duels are staged when the player is not involved

Ecology fights (bandits vs tribe hunters vs predators) ran the same pipeline as a bandit fighting the player: slot/queue-ring spacing buckets, quick-attack condition builds, a per-frame 3D `meleeHit` probe through every lunge, a 3D strike cone and afflictions. `js/combat/npc-duel-staging.js` (`window.NpcDuelStaging`) now replaces the melee decision step for a fighter whose duel has no player involvement (player more than 6 tiles from both fighters, re-staging past 7.5; neither hit by the player/companion in the last 6 s). Swings are still real combo steps (pose, capped lunge, trail, audio), resolved with a 2D reach/cone test; defenders sometimes play a real `EnemyDodge` roll (`stageDodge`). When both rigs are offscreen-asleep, exchanges are resolved abstractly with no swing. `NpcDuelStaging.setEnabled(false)` is the A/B switch; `snapshot()` has the counters. Separately, `meleeHit` probes (`debug:false`: lunge halts, HUD reticle, targetable scans) no longer allocate solution vectors.

Ranged troops and Flaskers are staged too. A staged archer's sight check refreshes every 900 ms instead of whenever either fighter moves (in a duel both move, so the 80 ms movement-invalidated cache recomputed scene raycasts and a scan over every hostile almost every frame). Aim pitch comes from ground heights instead of two portrait hitboxes per frame, and its arrows (`stagedTarget`) test only their target and the player instead of every hostile on every flight frame. Offscreen, volleys and flask throws are abstract rolls: the same load/throw cadence and stamina, with damage (or the flask recipe) applied directly.

**Not measured:** frame time on a device during a camp fight. Witch, lich and headtaker AIs are not staged.

## 14 Nov 2026: failed cliff-entry searches have a retry delay

A failed climb-entry search can be requested every movement update. For the same entry and start tile, scheduled NPCs wait 750 ms and creatures wait 1.2 seconds before repeating the search. A different entry, different start tile, or rebuilt route can search immediately. Pixel Probe reports skipped retries, and the cliff-route test exercises recovery when an obstacle clears.

## 14 Nov 2026: hand pose callbacks without GPU draws

The direct hand sync and free-hand forearm alignment meshes use empty draw ranges. Three.js r128 calls their pose hooks in render order and skips the two invisible triangle draws per rig in each pass that processes both meshes. The dance render hook can reset wrist rotations on a later pass, so forearm alignment still runs after it on eligible passes.

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

## 17 Nov 2026: animal color fill — oversized sprites and per-pixel overhead

- **Cause found:** `grehlr` (3000×2250) and `voorg-ass` (2040×1200) art, including every pattern layer, was recolored at native size and only afterwards shrunk to the 512–1024 px display cap by `CreatureTextureCache.fitGeneratedCanvas`. A cold `grehlr` frame composed in ~900 ms and every new coat color cost ~190 ms (headless Chromium); the pixels beyond 1024 px never reached the screen.
- **Fix, assets:** those 23 PNGs and the `grehlr` masks in `config/creature-base-masks.json` are regenerated at 1024 px long edge by `scripts/downscale-oversized-creature-sprites.py` (idempotent). Cold compose is now ~80 ms and ~10 ms per new color; PNG bytes for those files dropped ~3×. Gar-wolf/dabinggi/puktuk (1375 px) and moot/tzatzul (1617 px) were left alone: they have pixel-coordinate rigs/masks and are within 1.6× of the cap.
- **Fix, code:** `ColorFill.shadeFillPixels` / `createShadeReference` accept typed-array `applyMask`/`sampleMask` (no closure call per pixel) and memoize per source color within a call; the keyed-coat matcher no longer allocates an HSV object per pixel. Output is byte-identical (`scripts/test-color-fill-fast-path-parity.js`).
- **Measurement trap:** resampling hard-edged art creates many faint semi-transparent edge pixels. `getImageData` returns them through a premultiplied round trip with inflated RGB (e.g. gray 64 at alpha 2 comes back as 128), and ColorFill's auto-peak anchors on the brightest eligible pixel, so one faint pixel darkened an entire pattern layer. The downscale script caps such pixels to the original layer's browser-measured peak. Always verify an asset change with `getImageData` in a browser, not by reading PNG bytes in PIL.
- Cached sprite and mask can disagree in resolution for returning players; `fitMaskToImage` resamples a same-aspect mask instead of silently skipping the recolor.

## 17 Nov 2026: review of the performance merges (#1874, #1883, #1907, #1908, #1912, #1928)

- **Not yet measured:** none of these merges recorded a before/after number. Distance cull (#1912) counts hidden meshes, not GPU draw-call savings; capture `WildernessChunks` debug panel `non-veg distance` + `Distance Cull: ON/OFF` frame times on a mobile device before claiming a speedup. Same for the 40% portrait density (#1928), the sense landmark cache (#1912), Pack batching (#1883), rain row pooling (#1874) and the locale cache (#1907).
- **Fixed in review:** `WildernessDistanceCull` rescanned the whole scene every 750 ms with one allocated record per node, and kept the candidate list (and so unloaded chunk meshes) after leaving the zone. It now rescans when `WildernessChunks.residencyVersion()` changes (min 250 ms apart, 5 s idle safety net), walks with parallel stacks, reuses its per-frame hidden list/release closure, and drops its record outside zones (`scripts/test-wilderness-distance-cull-rescan.js`).
- **Fixed in review:** `grehlr`'s saddle `sourcePixel` in `config/attachment-rig-profiles.js` was still in the pre-downscale 3000×2250 space; rescaled to the 1024×768 sprite. Metadata only (the saddle `position` is model-space and the rule is `authoredFixed`).
- **Fixed 18 Nov:** hidden-locale waypoints use the storage guard’s save-metadata revision to avoid polling unchanged metadata. See the compass entry below.
- **Needs eyes:** the 40% default shrinks the flying-animal perched plane from 32×20 to 13×8 segments, which is deformed by the 7-point shoulder spline; check it for faceting on a device.

## 17 Nov 2026: more consumers of PlayerTileEvents

- `WildernessMap.updateFogAroundPlayer` now skips all work (fog lookup, world/year lookups, discovery) unless a tile/area event arrived or 1 s passed (the idle recheck covers Tothal Shifts / world switches while standing still, and falls back to the old per-tick path if `PlayerTileEvents` is missing).
- Sense's ore-rock neighborhood sweep (~840 string-keyed map lookups per 150 ms refresh) is cached per tile in `game.js` (`_nearbyOreRocksForSense`), invalidated by the tile event, index identity/size changes and a 1 s TTL.
- **Not yet measured**, same caveat as the other perf merges. Remaining per-frame tile users: `checkTransitionSpots` (string key per frame; needs extra re-check triggers for key items/roof access), interior exit check (tiny).
- `checkTransitionSpots` (game.js) now skips its latch compare + `pool.find` on idle frames. It re-resolves on tile/area change (int compare + `PlayerTileEvents`), latch rewrites (`_spotResolveDirty`), `hobunji:key-item-granted` / `hobunjiPlayerReady`, every frame while a spot is pending (roof-access/key predicates stay live), and after a 250 ms TTL (cutscene gating, transitions added while standing still). `refreshActionBar()` keeps its exact old cadence (every frame, but not while latched). Worst case: a newly-available spot's arch appears up to 250 ms late when nothing was pending. Not yet measured.

## 18 Nov 2026: inventory navigation (controller) cost

- **Measured (headless, software GL, 118 items, ~4,900 menu DOM nodes, 33 nav targets):** a `ControllerUI.press` is ~7 ms synchronously but each press then caused 7-13 style recalcs (19-26 ms), a ~15 ms `controller-ui-nav` observer reconcile, ~2 ms `folder-save-quit-guard` labelling and ~1 ms menu readability; ~70% of script time was the 3D world still rendering behind the (world-pausing) menu. GPU cost incl. the menu's 24 px backdrop blur is not measurable under software GL.
- **Changed:** world render runs at ~10 Hz while the main menu is open (`mainMenuOpen && paused`; `HobunjiMenuWorldThrottle.setEnabled(false)` restores per-frame for A/B); the controller-nav structural observer no longer reconciles for rebuilds confined to `[data-ctrl-detail-panel]` while focus is outside it.
- **Not yet measured on a device.** Remaining leads: batch/reuse `getBoundingClientRect` reads in `isNavTarget`/`enteredGroups`, `scrollIntoView` on focus, `backdrop-filter` while the menu is open.

- **Controller-only controls at the bottom of Inventory (Pack/Gear):** `.inv-grid-area`, `.inv-pgscroll` and `.inv-equip-section` (and the Gear workspace in `inventory-gear-compact-effects.js`) used fixed row-model heights that run past `#mpInventory` (`overflow:hidden`) whenever the real pane is shorter than the 28-row model (measured 51 px at 568x320, 59 px at 800x600). Their own scroll range then ended below the clip edge: the wheel could not reach the last rows, but the controller's `scrollIntoView` scrolls the hidden pane itself. The designed heights are now caps (`height:auto; bottom:0; max-height:<design>`); headless pane overflow went 51/59 px -> 0 in both modes. The other 13 menu tabs showed no non-wheel-scrollable clipped controls at either size.

## 18 Nov 2026: controller nav visibility memo

- **Measured on unchanged main (headless, menu open on Pack, 118 items, 33 targets), per press:** 1,366 `getComputedStyle` + 288 `getBoundingClientRect` calls (`isVisible` ran ~288x: every candidate, every ancestor, again per group/target projection and in `enteredGroups`), ~4.5 ms synchronous. Style recalcs per press: ~3.6 in the press itself, ~4.8 more in the following frames (decorate / readability / labelling observers), vs 3.4 per frame with the menu open and no input.
- **Changed:** `isVisible` is memoised (final answer + per-node "hides its subtree") and the memo is dropped at every class write this module makes (`navClassAdd/Remove`), at each external entry point and at the end of the current microtask checkpoint. Tests that slice nav functions into isolated vm contexts got shim helpers.
- **Not done / not expected to help:** the remaining per-press recalcs come from other modules' observers reacting to the detail-panel rebuild, not from nav reads.

- **Quit-guard header relayout fired on every inventory selection:** `folder-save-quit-guard.js` observes the whole `#menuPanel` subtree and treated any element add/remove as "header controls changed", scheduling an 80 ms `labelMenuControls()` (button style/label writes + a `scrollWidth` layout read) after every controller press. Records whose target is inside `.mp-body` are now ignored (header/tab-strip changes and panel class changes still relayout). `scripts/test-folder-save-primary.js` covers it and fails on the old code. Not yet measured end to end.

## 18 Nov 2026: action prompt innerHTML write skip

- `ActionPromptUI.setPromptText` compared `element.innerHTML` to the source string. The getter re-serializes the subtree and returns browser-normalised markup, so any prompt containing an `<img>` (the touch icon) never matched and the button subtree was rewritten on every per-frame refresh (fishing, moving ruin puzzles), feeding the HUD MutationObservers. It now compares against the last string it wrote (`scripts/test-action-prompt-write-cache.js`, which fails on the old code). Not yet measured on a device.

## 18 Nov 2026: compass storage reads and wildlife visibility

- Secret locale waypoints reuse the parsed discoveries while the active world and save-metadata revision match. The existing storage quota guard advances the revision on native writes, quota retries, folder-staged writes, removal, clearing and browser storage events. Discovery operations and Map-panel reads still consult current metadata directly. Compass visibility still evaluates the current Tothal cycle each time. Live camp and den waypoints stop scanning at the first matching marker without copying the whole threat list.
- The executable waypoint fixture checks that 60 unchanged polls require zero metadata reads. It also covers immediate same-tab updates, cross-tab invalidation, unrelated writes, world changes and cycle changes. Pixel Probe reports cumulative compass storage reads and cache hits.
- Wildlife visibility checks active attack guards once per fighting animal per LOD update, down from twice. Wake and release decisions share the resolved calm radius, and the executable streaming test confirms the previous release and return thresholds. Real-device frame time has yet to be measured.

## 18 Nov 2026: dashed combat resource rings

- Exhausted Stamina and the orange Health-risk overlay each combine nine dashes into one indexed mesh. The batch preserves disconnected dash geometry, per-dash elevation, material and snow/slush projection. This saves eight meshes and eight world-pass submissions per visible dashed arc. Arc geometry writes its final height during construction.
- Affliction pulses update only the three possible resource groups instead of visiting the descendant meshes every frame. The ring fixture verifies projection binding, open gaps, pulse timing, and disposal. Pixel Probe shows dash batches and mesh allocations avoided. Real-device frame time has yet to be measured.
- A headless Three.js r128 WebGL comparison confirmed pixel-for-pixel parity in three workloads, including two overlapping actors and a simulated snow lift. World-pass submission counts for the ring fixture were 35 → 27 (one dashed arc), 44 → 28 (two), and 86 → 54 (four). Triangle counts matched.

## 23 Nov 2026: Kanthic engraving through-wall and performance regression

The separate 2D glyph darkness exemption could not sample the actual world depth and approximated it using per-wall raycasts, projected triangles and platform silhouettes. Replace it with the existing lighting canvas as a reusable GPU texture plus a depth-tested redraw of the occupied room or shaft's authored glyph meshes. The room system supplies distinct room/shaft IDs; unowned corridors are not one shared glow region. Cache discovery and proxies, hide inactive emissive meshes during world presentation, upload lighting only on a new paint, and restore visibility on frame exit. Pixel Probe exposes region, candidates, depth passes, texture uploads and errors. Real-device FPS and rendered visual parity are not yet measured.

### Kanthic audit follow-up

CI identified an obsolete exact-source assertion in the shaft firelight fixture. Bounds-based selection and local GPU clipping address wide panels across room boundaries and tall shaft walls. Lighting uploads are capped at 524,288 pixels (at most 2 MiB of RGBA per paint); this is a transfer bound, not measured FPS. Room bounds are cached at session creation and native room registration. The original DOM lighting placement is restored when the effect sleeps or during transition fades.

Further render-order audit: the lighting compositor's presentation-surface repair can reset the WebGL target. Paint before any world depth pass. Disable all three clear flags while replaying PNG silhouettes (a THREE.Color scene background can force a clear even when autoClear=false). Added real alpha-cutout sprite regression coverage for both direct and offscreen depth paths. Cache native room extents lazily; reject camera-offscreen glyphs before uploading the darkness texture; observe pending atlas promises and use a five-second fallback discovery interval rather than 1.6 seconds. These are correctness/operation-count changes, not a measured mobile speedup.

## 23 Nov 2026: companion combat and targeting audit

- Friendly target decisions retain the existing 140 ms cadence and validate roster membership immediately. Beastmaster pets now reuse their proximity decision for the same interval, with immediate invalidation on a lost, removed, or out-of-range target. Wild scent selection no longer creates roster arrays or writes diagnostic objects on every frame; shoulder passengers and mounts are excluded as independent marked targets. Sicced is resolved once per companion update, not separately for each follower.
- Attack geometry is evaluated only when a move could commit, with a short 100 ms per-target lease; the fallback bite validates current geometry on impact. Blocked pursuit reuses the existing delayed tile detour. Furious move-cost normalization is skipped when the animal has no Furious Stamina. Ambient scanning/idle checks are skipped while combat owns focus. Ground-follow diagnostics are reused. Owner-speed lookup skips redundant unmounted alchemy/global reads and no longer copies the tracked roster every update.
- These are source-level operation reductions; mobile FPS and real-world latency remain unmeasured. The short decision leases do not throttle movement or committed attack animations. Regression fixtures cover target and terrain-lease invalidation.

- Animal pounce/Guard Charge substep collision now selects `Combat.meleeHit`'s scratch probe mode, with one reused options object per committed lunge, rather than allocating diagnostic collider geometry for every candidate and substep. Rear Kick's approach also uses scratch probes; its actual strike still publishes the normal diagnostic. Drenkirra pellet candidates now distinguish Beastmaster pets from player companions and skip unavailable actors at contact. Enemy scent selection avoids copied rosters and redundant diagnostic writes. The cached Beastmaster fixture counts one roster enumeration across eight updates, then verifies immediate invalidation on removal.

## 23 Nov 2026: opaque furniture render proxies and projectile resource reuse

The wilderness prop batcher merges compatible authored leaf parts within one
placement even when their materials are separate. A shared texture must be
proven opaque at native resolution before a transparent source is eligible.
The proof is sliced over timer turns, cached by image and fails closed.
Sources keep independent materials; only proxies own clones. The settled
fast path revalidates live material keys, and liquids, unsupported materials
and partially transparent images stay on the original path. Existing
ZonePropRenderBatches A/B switch and draw counts apply.

Ranged projectiles retain up to 16 retired PNG materials, 16 exact-dimension
geometries and 16 trail meshes. Trail draw ranges reset on reuse; active
projectiles never share mutable materials. Per-shot textures remain separately
owned and disposed. Ranged debug snapshots report reuse and pool counts.
Actual device frame times and visual parity remain unmeasured.

### Review follow-up

CI caught the versioned enemy editor's transitive preview/app loader chain.
Both loader tokens are now bumped. Furniture settled reuse compares scalar
material state and leaf flags directly rather than rebuilding strings/owner
keys every frame; attribute identity changes invalidate cached geometry.
The existing Three.js integration fixture now exercises creation, restoration,
material changes and attribute replacement. Retired projectile texture
callbacks cannot mutate dead shots; trail buffers/materials are leased to
fresh mesh wrappers so scene-specific object metadata is never recycled.
Pixel Probe exposes resource-pool and prop-batch statistics on mobile.

## 24 Nov 2026: world popup and emoji allocation churn

The remaining icon-effect path created and disposed a separate shader material
for every coin/ray and a fresh GPU texture per completed reaction, although
Scratchbones already cached its immutable tinted canvases. WorldPopupText now
owns a per-Three-namespace, bounded LRU of 32 immutable artwork textures with
one live reference per event, plus 32 retired icon materials and eight retired
quad geometries. The PNG factory and cutoff remain canonical; mutable canvas
consumers opt out by default. Scene eviction cancels pending loads and returns
leases without destroying resources still used by other scenes. No new frame
loop; no active material or geometry is shared across events. Popup updates
skip the camera entirely when idle and sort each active row list once per
root/list kind until a removal invalidates it. Counters are exposed in the
existing WorldPopupText and emoji debug snapshots.

The earlier headless lunge-stamp result (15 Nov) found no meaningful frame
cost from ring geometry allocation. That optimization is not pursued here;
the large game.js owner also exceeds the connected file retrieval limit.
No measured FPS or shader-rebuild reduction is claimed until a device A/B.

Follow-up: lazy row-layout allocation leaves emoji-only and damage-only frames untouched; partial icon construction failures release already acquired leases. Added overlapping scene/cache eviction and row compaction coverage, and an on-demand pool-stat button in the existing emoji debug UI. Rebased onto latest main, preserving intervening changes.

## 24 Nov 2026: CPU trace follow-up — portrait readbacks, X-ray, AutoLOD, HUD and flails

Pre-#2142 trace (271b1fca, ~5.8 s, 46 game frames): ~818 ms sampled in getImageData, ~906 ms inclusive in held-overlay replay, ~722 ms inclusive in shell X-ray, ~212 ms AutoLOD self time. Browser style recalc includes ~50 ms spikes involving 5,209 nodes; the trace does not establish which mutation caused the whole-tree invalidation.

- Beard/hood scratch contexts request willReadFrequently on the first context acquisition. A bounded shared cache stores pristine unwarped beard readbacks, and a separate bounded cache reuses exact negotiated still layers (actual resolved art/tint identity, transform, static deformation, masks, stretch and cone policy). Animated hoods still negotiate their actual current pixels; emote-deformed beards, pixel dyes, mutable/custom art and custom composers are conservative fallbacks. No pose quantization or new redraw timer. Pristine input is read-only and refused edges write a separate ImageData.
- X-ray protected/tint cover queries now call the canonical surface composer's cover-only classifier rather than recomputing terrain/floor/path ancestry; ordinary scene groups bypass drawable-only scissor checks. Depth/material/visibility rules and all render passes remain.
- AutoLOD builds active-scene candidates once per world frame and memoizes effective ancestor visibility per native draw; live geometry signatures are still validated on each eligible draw. No visual LOD is applied to hidden or detached scene objects.
- Keyboard HUD skips unchanged HTML; Gear fit ignores only its own completed font-floor removal notifications, not external re-additions. These remove identifiable DOM writes, not proof of the trace's whole-tree CSS cost.
- Flail physics remains at 240 Hz substeps except exact zero-torque/zero-velocity equilibrium; share one inverse holder matrix between connector and head; repeated identical rendered camera/carrier poses reuse the rope facing. Pixel Probe reports the readback, LOD, HUD and flail counters. Real-device frame-time and rendered-pixel A/B measurement remains pending.

Audit follow-up: first full CI run passed 1,417/1,418 fast tests and all eight other workflows; the flail depth fixture lacked Quaternion support. Extended it to exercise actual cache hit/miss behavior and unconditional leaf matrix refresh. AutoLOD no longer snapshots candidate membership across native draws: a scene move during a render hook could make the list stale. It retains shared, per-draw ancestor visibility checks and live source validation, and avoids allocating a candidate list each frame. The HUD always rechecks the canonical deduplicated sprite request, including same-label item changes. A no-op hood stretch transfers its exact current readback to negotiation, avoiding a redundant read; a real warp deliberately rereads the canvas to preserve browser alpha-roundtrip behavior. Closed Gear observer batches now avoid filtering allocations and the real self-removal path has regression coverage.

Additional cache audit: logical portrait dimensions and layer size are mutable via the authoring config, and resolving multiple tint canvases can evict earlier entries. Keys now include logical dimensions and capture the exact resolved immutable tint and transform used for each layer, with noncanonical or invalid inputs falling back. The shared result key includes the cutout API identity. Added no-op versus warped hood readback parity and identical-label HUD item replacement coverage.

Final targeted audit: isolated executions of the real AutoLOD, Gear cadence, flail depth/facing, HUD dedup and beard matte/readback fixtures passed. Added an actual renderer-block cache integration fixture for separate portrait targets, exact still hits, dynamic bypass, immutable retained pixels, policy and dimension changes, tint changes, editor and pixel-dye bypass, context policy, and bounded eviction. Gear self-removal markers now last only through the next observer delivery and no filtering array is built unless such a release actually occurred. Mutable mask overrides and invalid/unserializable static deformation or policy values use the original uncached path.

## 24 Nov 2026: Cloud Forest dense wall distance LOD (triangles, not draws)

**Where the frame goes (headless, SwiftShader).** A CPU profile of town and the Southern Cloud
Forest put only 12–20% of frame time in JS; ~80% was native `(program)` time. Wrapping every
WebGL call showed tiny call overhead (no `readPixels`/`getError` stalls), so the cost is
rasterising and vertex work. The Cloud Forest main pass drew ~0.9–1.24 M triangles at 360×240,
and a per-mesh census put ~87% of the in-view triangles in the dense shadewood wall
(`AuthoredCloudForestDenseChunk_*`). Hiding the wall raised headless fps 5.07 → 7.13 (+40%). This
was the "dense-wall triangles / tree LOD" lead left open in the 20 Nov entry. (Town's equivalent
is `Roughbrick1.glb` instancing, ~570 k triangles, and HousePieceGen "Surface roots", ~200 k:
hiding them gave +23% / +30%. Not addressed here.)

**What a wall tree is.** A procedural shadewood is 4,218 triangles: bark (trunk + 9 roots + 15
canopy branches merged) 2,592, vines 1,500, climb branch 96, leaf cards 30. The baked
`shadewood_0N_lod-decimate-90.glb` LODs (661 triangles) are not used, because tree assets default
to procedural mode and their materials and shapes differ from the procedural trees.

**Change.**
- `FoliageGenerator.liteTreeGeometry(fullPartGeometry)` (foliage-generator.js) builds, once per
  shared variant, a far twin from the same seed and random sequence. The spines, branch tips,
  roots, vine wraps and leaf-card positions are therefore identical. Only tube emission changes:
  the trunk is unchanged; roots, canopy branches and the climb branch keep every other ring (5/4
  sides); vines keep their sides and every other ring, lifted by 1/cos(half the chord angle) so
  straight segments do not cut into the trunk. Full bark 2,592 → 864, vines 1,500 → 750, so a far
  tree is ~1,670 triangles. Bounds match within ~0.07 units. Leaf cards are reused as they are.
- `dense-forest-wall-batches.js` (the existing render-only scope) classifies each wall tree by
  its own base distance from the camera (default 12 tiles, 1.5-tile hysteresis). Near and far
  trees of a part go to separate batches, so far trees use the twin with the chunk's own instance
  matrices, live material and layers (shell outline). Fading chunks' transparent parts are never
  merged: an all-far part swaps its geometry in place for the render (no extra draw), and a
  straddling one splits into its own near/far batches. Chunk meshes keep full geometry for
  gameplay.
- `border-terrain.js` instanced every mesh of each wall tree, including the climb branch that
  the tree's own roll had hidden, and every level of a baked tree's `THREE.LOD`. It now
  instances only drawn meshes (level 0 of a LOD). It also builds the twins at zone build time.

**Visual checks (1280×720, same camera, LOD off vs 8 vs 12 tiles).**
- The first twin dropped roots and vines and used 3-sided vines. At 8 tiles that visibly removed
  root flares and the green vines.
- Coarse vines then showed as black zigzags: chords buried the green tube under the trunk's
  noisy surface, leaving only its shell outline. A 6-sided trunk did the same, because its noise
  is sampled at different angles.
- Both fixed (trunk unchanged, vines lifted). At 12 tiles, off and LOD frames are
  indistinguishable by eye; pixel differences (6.3–8.0% > 24 levels) are within the off-vs-off
  animation/rain noise (7.2–9.2%). 8 tiles still showed small differences, so 12 is the default.

**Measured (headless, same spawn view, 360×240, alternating 12 s windows):** main-pass triangles
895 k → 601 k (−33%; −40% from another spawn, 1.24 M → 748 k); all passes 1.09 M → 0.80 M; fps
6.72 → 7.30 average over three pairs (+8.6%; noisy); draws +12 to +18 (near/far splits); 0 batch
rebuilds while standing still. Walking the same 12 s route (south then back): frames 74/70 →
76/79; batch rebuilds ~0.4 → ~3 per frame (small matrix copies as trees cross the boundary);
instance-buffer allocations 23 → 35–45, mostly new per-chunk batches for corridor-edge fading
chunks. Tried and removed: keeping emptied LOD batches hidden for 30 frames and 1.5× capacity
headroom (allocations 35–49 with them, no measurable change). **Not yet measured on a device.** A/B: Settings → Render
optimizations → "Lighter far Cloud Forest wall trees", benchmark variant `denseWallLodOff`,
`DenseForestWallBatches.setLodEnabled(false)` / `setLodDistance(n)`; `snapshot()` reports
far/near trees, triangles avoided, in-place swaps and buffer allocations.

## 24 Nov 2026: surface-growth root/vine tubes drop redundant rings

**Found while profiling the Cloud Forest wall LOD.** A per-mesh triangle census of town put
~200 k in-view triangles in 18 "Surface roots" meshes (the temple's Corner Fill roots: radius
0.2, length 12, up to 48 strands per recognized surface; single meshes up to 43,820 triangles).
Hiding them raised headless town fps 2.93 → 3.80 (+30%). Strand tracing places a ring every
~3× radius (Corner Fill: every 0.14 units, up to 128 rings) so that paths hug walls, seams and
corners. On flat runs, most of those rings add no shape.

**Change.** `simplifySurfaceStrandRings` (foliage-generator.js) is a final pass on every
surface-growth tube (houses, temple, caves, furniture), after `varySurfaceStrandRadii` and the
shrinkwrap. Douglas–Peucker on ring centres drops a ring only when the straight tube between its
kept neighbours stays within 12% of the strand radius of its centre and its radius, with at most
12 ring gaps per segment. Kept rings keep their exact shrinkwrapped vertices and PNG stretch UVs,
so strands cannot sink further than the tolerance and their texture still runs 0..1. Ends and
corners are kept. Build stats report `strandRingsBefore/After`.

**Measured (headless, fresh world, town spawn, main vs branch in separate sessions):**
surface-growth triangles 217 k → 106 k (−51%; rings 22,281 → 11,157); all-pass triangles
1.62 M → 1.29 M; town fps 2.95 → 3.47 average over three 12 s windows (+18%). Screenshots of the
temple's roots and vines are indistinguishable at 1280×720. Generation-time only: no per-frame
cost, and the same savings apply to cave and furniture growth. **Not yet measured on a device.**

### Same pass: far brick walls and paths draw a 12-triangle brick

`Roughbrick1.glb` is a 70-triangle faceted rock (37 corners, flat-shaded) that WallBuilder
instances for house walls, gables and path chunks: ~8,000 bricks and ~570 k triangles in the town
view (hiding them: +23% headless fps). AutoLOD skips it (below its 96-triangle floor), and a
per-brick decimation does not pay for itself.

New render scope `instanced-brick-lod` (`js/instanced-brick-lod.js`, order 450). WallBuilder tags
its default-brick InstancedMeshes; logs, stacks and custom GLBs are untouched. The far brick is the
**octant hull** of the same geometry: for each of the 8 box-corner directions, the source corner
reaching furthest that way. These are joined as 12 outward-wound, flat-shaded triangles and
stretched per axis to the brick's exact bounding box (volume within ~5% of the source). uv, when a
tint added projected uvs, is copied from the matching source corner, and the hull is rebuilt if
the source's attributes change. Selection is per mesh, since WallBuilder groups bricks per wall or
path chunk. A mesh whose InstancedMeshBounds sphere edge is ≥ 14 tiles from the camera swaps
geometry for the world render only and is restored afterwards: no extra draws, no buffer copies.
Matrices, count, material, layers and raycasts are unchanged.

**Measured (headless town, same session, toggled, with the roots fix above):** 6,061 of ~6,700
in-view bricks drew the hull; main pass 697 k → 526 k triangles (−25%), all passes 1.29 M →
1.11 M; fps 3.45 → 3.58 (+4%, three alternating 12 s windows each, noisy). At 8 tiles: 499 k,
3.83 fps. At 1280×720, distant walls keep the same courses, sizes and outlines; far bricks shade
slightly more evenly (fewer facets), visible only at 2× zoom. Default 14. **Not yet measured on a
device.** A/B: Settings → Render optimizations → "Lighter far brick walls and paths", benchmark
variant `brickLodOff`, `InstancedBrickLod.setEnabled(false)` / `setDistance(n)`; Pixel Probe shows
far meshes, instances and triangles avoided.


## 24 Nov 2026: 18:55 trace — redundant CPU-side render and clock work

The uploaded trace sampled `isDepthReplayInert` (~88 ms self), registry visibility
collection (~74 ms self), `classifyObject` (~57 ms self), and repeated prop-owner
and batch validation. Calendar report generation also appeared under relationship,
rest/buff, movement and camp AI callers. These are sample totals, not a measured
speedup from the changes below.

- Ordinary actor-only transparency sorting uses the original comparator and
  live rank maps directly; manual layer and shoulder-pet sorting retain their
  existing caches. Before/after comparison of 6,400 pairs was identical.
- Full root-scene classification places known members directly in their scene
  registries in traversal order, skipping redundant pending/root walks. Dynamic
  registrations still use pending discovery. The replay-inert predicate rejects
  ordinary single-material depth writers early, while preserving explicitly
  pinned far-plane candidates, custom hooks and cutouts. 15,360 synthetic
  predicate combinations matched the previous implementation; scene
  classification and retirement fixture also passed.
- Prop batching shares nearest-owner lookups only within one collection and
  combines effective visibility and attachment checks. Tagged crop producers
  register new PNG anchors before drawing; initial adoption scans and legacy
  fallback remain available, with counters in the crop diagnostics.
- CalendarSystem exposes raw day/fraction accessors and a minimal clock
  snapshot. Romance/family, rest blessings, camp AI, cooking and relationship
  queries use them rather than constructing date/UI debug reports. Civil
  midnight still uses the existing bridge; rest and cooking timer origins are
  unchanged. Targeted startup, rollover and rapport tests passed; a full
  regression run and real-device A/B remain necessary.
- No new frame loop, geometry reduction, pass-order change or actor-update
  cadence reduction. Static world-matrix freezing and cross-native-render
  visibility sharing remain unproven: render hooks may change transforms or
  visibility, and relying on stale state can break occlusion.


## 24 Nov 2026: performance-first shadow and actor replay range

The user reported that the preceding CPU-hotpath changes did not deliver a
satisfactory FPS improvement and explicitly accepted sacrificing shadows and
distant X-ray. The earlier farm draw census counted about 270 shadow caster
submissions on a refresh; disabling shadow maps removes those submissions
instead of throttling them. This primarily benefits the farm (the existing
shadow throttle identifies the farm sun as the only shadow-casting light).
Ordinary lighting and authored shadow art remain.

- ShadowMapRefreshThrottle owns the gameplay renderer's shadow-map enable
  policy, defaults off, and preserves the previous 250 ms refresh mode when
  opted in again. It also applies the policy to a newly created renderer.
- HeldObjectRenderOrder filters participants by their owner's world-grid tile
  relative to the player: the occupied tile plus its eight neighbors. The
  same eligibility applies to color and shell replay, with distant parts
  retained in ordinary color/depth and normal shell draws. Unknown owners use
  the part's world position; previews without an active player and explicit
  legacy all-participants mode retain the old policy. Local actor category,
  weapon budget, and existing floor-circle/elevation rules still apply.
  Independent portrait water tint is similarly local. A near actor's own
  floor circle remains unchanged; this is a participant limit, not a new
  shader clip boundary. Leaving the ring restores any prior hand masking.
- Settings > Render optimizations exposes both policies; Pixel Probe reports
  the real shadow-map flag and excluded X-ray part counts. The on-device
  Render A/B benchmark includes fullXrayRange/localXrayRing and
  shadowsOn/shadowsOff, restoring the original settings after each window.
- Real ownership/partition fixtures and shadow toggle/renderer-replacement
  fixtures passed in an isolated JavaScript harness. Full CI and same-save
  device measurements remain required; no FPS improvement is claimed yet.


### Consolidation: one tile-distance authority

The local participant gate and the holder-centered floor circle now derive
their reach from the same `XRAY_TILE_RADIUS` constant. In a gameplay scene
with a valid player position, feet and pants use the player ring instead of
also being rejected by the legacy six-unit 3D camera sphere. The camera
distance setting is retained only for legacy range A/B and playerless
previews; explicit all-participants mode still bypasses both distance
restrictions. Species/category/weapon budgets, actual floor occlusion,
elevation, scissor and water ordering remain unchanged. The expanded
runtime fixture passes with a camera twenty units above the player and
checks that the old camera rejection returns when local mode is disabled.
No new frame loop or extra scene traversal is introduced. FPS remains
unmeasured on-device.


### Experimental generated outline modes (24 Nov 2026)

Settings → Render optimizations → Generated outlines (experiment) selects
`shell` (shipped default), `screen` or `none`. The ordinary Outlines
setting remains the master offscreen/composite switch. The A/B benchmark
compares `shellOutlines`, `screenDepthOutlines` and
`generatedOutlinesOff` while preserving painterly and the master setting.

Screen mode replaces the expanded-shell pass and its selective shell X-ray
replay with one unexpanded front-facing depth draw on the existing
SHELL_OUTLINE layer. The mask target is allocated only when used, resized
with the main target, and disposed when leaving screen mode. Existing
outline pass classification allows base-matrix reuse. The composite accepts
only pixels whose mask depth matches the world depth, then detects an inward
one-pixel silhouette or substantial depth discontinuity. Authored PNGs and
hard-faced textured meshes are excluded by the existing shell-layer policy;
an unrestricted world-depth Sobel filter would violate that policy. Standard
scene fog fades the generated ink, and the painterly patch signatures are
preserved. Reticle highlights, actor probes, PNG occlusion depth, water/color
X-ray and perception overlays remain independent.

This is deliberately a selective-mask experiment, NOT a zero-geometry-pass
implementation: sampling the current depth alone cannot identify authorized
outline surfaces, and the r128 world materials have no common eligibility
channel. Depthless transparent foreground effects, restored ground depth
over X-rayed limbs, and custom mist can differ from the original shell
appearance. The default remains shell until device and visual validation.
Recording-renderer fixtures exercise all three modes, resize, disposal,
error restoration and persistence; real WebGL visual parity and FPS are not
yet established.


## 25 Nov 2026: deep hotpath follow-up and depth outlines as default

Related investigation: draft PR #2164, branch perf/deep-trace-investigation-20261124, records trace 20261124T210514 on revision 6777fc8 and its corrected attribution. This implementation starts from current main rather than that older branch.

- Default generated-outline mode is now screen-space; reset and persistence share the pipeline's default. Inward stroke sample offset is 3 render-target texels instead of 1, with correspondingly scaled smooth-slope rejection thresholds. No additional neighbor reads. Shell/none remain available and master Outlines still owns compositing.
- Ranged archetypes: NPC registration requests only the required hunter/bandit key (cultural loadout path ensures registered definitions); unchanged definition/config pairs skip construction. Registration no longer calls player setLoaded; missing player state defaults according to weapon type, with existing player action state preserved. Explicit authored rebuilds still rebuild and sanitize loadouts. NPC calls never refresh player HUD. Runtime diagnostics count reused registrations. Test repeated NPC registration and replacement of a definition.
- Inventory wheel cache hit validates ownership and definitions in place instead of allocating a key array; direct same-frame inventory mutations and periodic eligibility refresh remain correct. Action-arch mutation fixes avoid identical visibility writes, throwaway potion icon creation and DOM rebuilding when only hold CSS changes.
- Expose existing portrait.waterTint rule in Render optimizations and as a benchmark variant; preserves ordinary water and gear tint. The three-stage water depth transaction itself is not removed: later depth consumers still require review.
- Terrain spatial bucket children have identity local matrices under the original source mesh. Disable their redundant local composition while retaining parent/world transform propagation. This is deliberately not global hidden-node freezing.
- User observed distant barbarian particles through cliffs. Shared combat VFX range is 24 tiles for non-player melee trails, death sprays and burning visuals (active area/scene required when known); normal depth testing and fog apply to swipes and sprays. Burning visual records outside the budget are released, gameplay afflictions and damage unchanged. Exact observed effect not identified; additional effect sources may need audit.
- Quick attack bonus cue and melee HUD now use the same reach profile, including actual horizontal lunge projection via meleeLungeProfile and pitched cone length; mounted stance excludes the normal player lunge. The preview remains a forward half-disc opportunity bound, not a terrain obstruction, swept collision or exact reticle prediction. Aim pitch and mounted state invalidate the short cue cache.

Validation: existing world pipeline recording-renderer fixtures, composite wiring, settings persistence and inventory wheel list fixtures passed in isolated JS harnesses. Extracted runtime fixtures passed for NPC definition identity reuse/replacement with zero player refresh/load writes, flat/pitched/mounted reach, and non-player VFX distance/area/scene bounds. New regression assertions are in the existing ranged and pipeline tests. Live WebGL/visual and FPS validation and full CI are not established at this point.

Remaining investigation: broader invisible scene hierarchy/matrix dirty-state lifecycle, actual scene census, per-group prop batch invalidation, water replay reduction (not merely A/B), scene-scoped brick registry, checkpoint serialization reuse, character creation/cache churn, hand solve deduplication, full inventory mutation revisions and event-driven action bar. Do not treat those items as implemented or use unsafe global visibility/matrix skipping or disable save safeguards.


### Follow-up audit

- Cultural bandit ranged loadout registration now targets only the relevant species/material's candidate keys, and a cached NPC registration exits before modifying the tool definition or calling the slot-aware animStyle accessor.
- The Quick Attack profile exposes both horizontal reach and the vector length consumed by the 3D HUD collider. The previous revision accidentally fed the horizontal radius back into a collider that applies its own pitch projection; corrected and covered with the real meleeLungeProfile (flat, upward, downward, vertical and mounted cases). HUD cardinal-direction zero-X aim also no longer defaults to +X. Cue pitch is sampled once per evaluation and the committed attack skips preview projection entirely.
- The NPC VFX range budget also covers fixed enchanted-weapon particle emitters on captains and Shadowknights; leaving and returning to the range disposes and recreates only the emitter. Burning visual range/reentry tests verify the actual combat range helper and preserve the affliction amount. The exact observed barbarian particle source and cliff occlusion still require in-game verification.
- Executed the modified opportunity reach fixture, extracted HUD cadence fixture, Burning Health fixture and extracted NPC weapon emitter lifecycle tests with isolated JavaScript test doubles; passed. Browser/GPU visual appearance, real-device FPS, and full CI on the newest revision are not yet verified. Broader deferred performance work remains outstanding.
