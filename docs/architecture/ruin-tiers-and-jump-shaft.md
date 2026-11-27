# Ruin tiers, the jump-platform and rope-swing shafts and tradition witch-bombs

## Tiers (`RuinLayerPlan.TIERS`)

`RuinSites` selects `hole` for cliff entrances and burrows and `lich` for named tombs. `CaveSiteSystem` selects `cave` when a passage inside a cave leads to a ruin.

| Tier | Where | Floors | Central chamber | Wings (total) | Rooms per wing | Braziers |
| --- | --- | --- | --- | --- | --- | --- |
| `cave` | ruins inside caves | 2 | 37.5 % (13 cells) | 3 | 2 (1 puzzle + brazier) | 3 |
| `hole` | cliff-entrance and burrow-hole ruins | 3 | 75 % (27) | 4 | 3 (2 puzzles + brazier) | 4 |
| `lich` | the named tomb of a tradition | 4 | 112.5 % (39) | 5 | 3 | 5 |

* Only the empty central chamber shrinks. `shaftSize = central + 2 * 5`: the 5-cell
  gallery ring (the "balcony thickness") never changes.
* `tierOptions(tier)` also fixes `floorHeight` (6 / 10 / 12), turns native V50 upper
  floors off (they would add unaccounted rooms and braziers) and selects the
  `ropeSwings` traversal (the `jumpPlatforms` staircase on request). `distributeWings` spreads the wings over the floors with the
  remainder on the upper ones; the ground floor is capped at 3 (the entrance wall).
* Sized ruins have no local door seals: the Great Door opens when exactly the wing
  braziers are lit. (`context.tier` suppresses the sanctum's local braziers.)
* Without `opts.tier` (the dev Random Test Ruin) generation is unchanged.
* The wing portal offset follows ShaftHub's small-shaft formula, and the Great Door site
  search adapts to short shaft walls (`RuinShaftConnector.sanctumDoorSite`).

## Wing braziers

`DevRandomRuinSanctum.buildLichBrazier` is the sanctum seal's stone-bowl brazier, scaled
~2.6x, burning the campfire emitter in the lich's body colour (`ruin.lichColor`: the exact
named-lich wall-glow colour for a named tomb, the tradition's lich otherwise).

## Jump-platform shaft (`js/ruin-jump-shaft.js`)

`ShaftHub.compose({traversal:'jumpPlatforms', theme})` calls `RuinJumpShaft.compose`, a
square-loop staircase of slabs hugging the gallery drop, rising 0.55 per hop from the
ground (or one gallery) to the next gallery. Every hop is proven against PlayerJump's real
reach (`compose().checks`, also run by `scripts/test-ruin-tiers-jump-shaft.js`).

* The ground story is a gallery around a **death pit** (tradition hazard: lava, ice spikes, or the real sinking plasm); the DynamicSurfaces pit also stops jumps landing on the ruin's ground tile. Above the top gallery the shaft has **one extra story of open height with no balcony**: the bomber Skeeri nest (a basket balcony on the north wall) lives there.
* The runtime exposes the same surface the old obelisk runtime did, so the ruin's
  airborne/fall reconciler (`reconcileObeliskPlayer`) drives it. Landing on a lower platform or gallery after a fall is survivable (drops over 3 units cost non-lethal Health + Footing, `applyShaftFallDamage`); falling past the lowest one is the pit.
* Every jump slab now has a structural `pillar_square` stretching from the death-pit basin
  to the slab's **underside**. `RuinShaftSupportPillars` reads the original editable
  `assets/models/furniture/data/pillar_square.json`; its runtime-only recipe uses the
  same fixed-foot / stretchy-middle / fixed-cap `FurnitureTileSpan` solver as the
  IKMC ceiling ladder. An even rounded slab width gives a **1.5×1.5** footing and
  an odd width gives **2.25×2.25**. Bases are centered under their slabs and
  capitals fit within them. The slabs and supports share the same carved stone material.
  These are deliberately visual-only: they add no landing surface, climbing
  collision or safe floor inside the fatal pit. A temporary stone silhouette upgrades
  to authored parts on asset load. See `getState().supportPillars` for counts/failures;
  all instances, including late-loading ones, are removed on teardown.
* The death pit has four stone sides (`RuinWallFaces.pitWallQuads`, shared with the reaching-obelisk shaft) from below its bed up to the ground gallery; without them the drop was open to the black void.
* **tothal**: every platform is ice (`RuinJumpShaft.isIceAt`, consulted by
  `DevRandomRuinLichThemes.movementPhysicsAt` at the player's own height).
* **hronal**: some slabs are exactly the pillar blast radius wide and carry the existing
  exploding pillar (`DevRandomRuinLichThemes.addPlatformPillar`: same charge/pulse/blast,
  non-colliding, height-gated).
* **kanthic**: wide 3x5 / 3x7 slabs mostly covered in the existing plasm
  (`createPlasmPatch`), with clear entry/exit tiles and single stepping tiles in between.
  Hopping mid-air over plasm neither sinks nor pulls you.
* Large bomber Skeeri (`js/skeeri-ruins.js`) are created once the ruin is the active area (creating them during generation clamped them into the previous area's grid) and nest in the headroom story; the nest and attack
  range scale with the shaft, and they drop the ruin's own tradition of witch-bomb.

## Rope-swing shaft (`js/ruin-rope-shaft.js`) — the default central-shaft puzzle

Every tier ruin uses `RuinLayerPlan.DEFAULT_SHAFT_PUZZLE` (`ropeSwings`). The jump-platform staircase stays in
`SHAFT_PUZZLES` and is used when `shaftTraversal: 'jumpPlatforms'` is passed (developers: the "Random dungeon"
shaft selector in Settings, or `DevRandomRuin.generate(seed, {tier, theme, shaftTraversal})`). The untiered dev
ruin keeps `TRAVERSAL_METHODS` (reaching obelisks).

* The staircase loops the whole ring every story, so upper slabs sit over lower ones and their support pillars
  pass through them. The rope shaft gives each story its own stretch of the ring: no slab overlaps another in
  plan (`noOverlap`), so no pillar runs through a platform.
* A story is: a few jump steps -> launch pad -> **swing rope** -> landing -> jump steps -> next gallery (up to
  two ropes per story; the first slab may be a launch pad anywhere along the gallery). Step slabs are the widest
  of 2.6–1.6 that fit; landings are 3 wide (smaller in caves).
* The rope hangs from a carved stone bracket flush under the balcony above, over the launch pad's forward edge.
  It is the ruin's own rider rope (`DevRandomRuinSimplePuzzles.addFurnitureRope`, hung once the rope runtime is
  live): jump to catch the visible rope end from its launch pad, pump, and jump off on the forward upswing. Holding the brake immediately clears swing momentum and smoothly returns the rope to vertical, while preserving the shaft rope’s fixed length and swing plane.
* The swing runs along the climb direction, so the backswing passes over the lower steps just climbed; it must
  stay on one straight side of the ring. Every rope's whole arc, up to RopeCore's swing limit, misses every slab.
* Proof (`compose().checks`, re-checked independently by `scripts/test-ruin-rope-shaft.js`): jump hops against
  PlayerJump's reach as for the staircase; each rope against RopeCore's own swing and release flight
  (`ropeProof`, a stricter `reachAmplitude`): a swing of at most 1.1 rad must land from a whole 0.15 rad window
  of release moments.
* Runtime: `RuinJumpShaft.mount` (slabs, pillars, death pit, tradition hazards — Tothal ice, Hronal exploding
  pillar slabs when they fit, Kanthic plasm pit) plus brackets and ropes; `method` is `ropeSwings`, so
  checkpoint braziers (`RuinRopeShaft.assignFixture`), the Skeeri headroom nest and the hub's headroom story
  treat it like the staircase.

## Witch-bomb variants (`js/hronal-witch-bombs.js`, global `HronalWitchBombs`)

A bomb's variant follows the ruin it is in (`variantFor(mapId)`); every other area stays
Hronal. Sphere art is `config/furniture-authored/{hronal,tothal,kanthic}WitchBomb.json`.

| Variant | Blast | Special |
| --- | --- | --- |
| hronal | fire, burning Health | chains other burdens (unchanged) |
| tothal | icy shards, enormous knockback | the existing `frostbittenStamina` affliction; still sets off nearby explodeables |
| kanthic | violet burst | `DevRandomRuinLichThemes.createPlasmPuddle` (about 5 s, faint purple tint); explodeables (casks, breakable props) are covered in plasm via `SubstanceCoverShell`, shrunk to nothing, then removed through their normal break callback; the blast recording plays reversed |

Bombs now resolve their landing height through `DynamicSurfaces` inside ruins
(`fallGroundY` receives `y`), so a bomb dropped over the shaft lands on a platform or gallery.

## Wall coffins (`js/ruin-wall-coffins.js`, mounted from `ruin-multifloor-v50-style.js`)

A few of the V50 wall panels on the shaft/gallery walls (2 / 4 / 6 per cave / hole / lich ruin, spread over the stories) are disguised coffins. The real panel mesh (engraving included) is the lid. Standing within ~2.7 tiles on the same story makes it fall forward onto the floor, revealing a black plane on the wall; a Harlyao skeleton climbs out of it over the dark spawn tile (which fades). Only one coffin skeleton is alive at a time; the next coffin stays shut until it is beaten. Test: `scripts/test-ruin-wall-coffins.js`. Debug lighting switch: `RuinLightOcclusion.setEnabled(false)`.

## Themed dungeon skeletons

All Harlyao skeletons spawned on the generated ruin map inherit the ruin's tradition in `MinionCombat`. Ordinary ruin minions receive 1.5× baseline Health; the solitary wall-coffin guards receive 3× baseline Health, exactly one randomly rolled NPC-compatible Base enchantment, and a matching Harlyao bound weapon as corpse loot. Their weapon magic never consults the player's gear record. Sanctum resurrection retains the appearance seed and does not grant a coffin relic.

The char, frost and verdigris-style oil reveal are baked into the front, rear and combat expression canvases at construction time. Back stalagmites reuse furniture growth geometry; stone receives the shared faceted-rock surface treatment and bypasses PNG depth classification. Actual collision-accepted travel is the trigger: Hronal lunges leave 4-second ground-fire patches; Kanthic ordinary walks, lunges and dodges can leave individual 5-second plasm tiles on the actor's own support. Existing checkpoint and solid-tile protection remains in effect. The trail loop samples distance, not frame count. `MinionCombat.ruinDebugSnapshot()` exposes spawn/portrait/spike/hazard counters and the last visual error; `scripts/test-ruin-themed-skeletons.js` covers the core behavior.

## Emblem decals (`js/ruin-emblem.js`)

Inside a ruin the generic round rune/seal decals resolve to the tradition's motif PNG (`assets/patterns/motif_harlyao_glyph_*`).

## Closing the dungeon shell (no holes into the void)

Everything outside a ruin's geometry renders as black void, so any gap reads as a hole. Found by flying through
generated dungeons with a magenta scene background (see "Inspecting a ruin" below); each is fixed in its owner:

| Gap | Owner / fix |
| --- | --- |
| Death pit open on all four sides | `RuinWallFaces.pitWallQuads` in `ruin-jump-shaft.js` and `ruin-reaching-obelisks.js` |
| Ground-story wing doorway tunnels had no floor (cut through the shell outside the octagon) | `shaft-hub.js` floor mask includes level-0 portal tunnels |
| Tothal floor ice spread over the whole death pit, floating at gallery height | `dev-random-ruin-lich-themes.js` skips tiles inside a `DynamicSurfaces` pit |
| V50 vestibule: randomly omitted wall panels, walls 0.3–1.2 short of the ceiling, open space above the arch | `DevRandomRuinWallPlanes.closeUnderCeiling` (rebuilds omitted panels, stretches the rest, adds an arch header) |
| Entrance hall to the shaft had no ceiling; the 3-cell vestibule doorway opened onto pockets beside the 1-cell hall | `ruin-shaft-connector.js` corridor visual (down-facing ceiling, pocket walls) |
| Thin-wall ends (doorway jambs) were full-height slits | `RuinWallFaces.buildEdgeCapQuads`, used by `ruin-layer-playable.js` and `ruin-room-system.js` |
| Rope-chamber abyss plane sat 0.15 below the walls' foot | stone sides in `ruin-layer-challenges.js` |

Test: `scripts/test-ruin-shaft-visual-holes.js`.

## Inspecting a ruin (developer mode)

`js/dev-inspect-tools.js` (`window.DevInspectTools`; Settings → "Inspect: fly camera / enemies"): **F8** flies the
camera freely (WASD/arrows, Space/E up, Q/C down, Shift fast, drag to look, **G** drops the player under the
camera), **F9** freezes every enemy (hostile AI loop, ruin Skeeri, wall coffins, encounters), and "Random dungeon"
enters `DevRandomRuin.generate` with a random tier and tradition. Headless drivers use
`DevInspectTools.randomDungeon({tier, theme, seed})`, `lookFrom(x, y, z, lookX, lookY, lookZ, fov)` and
`setEnemiesFrozen(true)`. Upper wing stories are hidden while the player stands below them, so move the player to
the top story (`DevRandomRuin.setPlayerWorldPoint`) before judging upper floors. To find holes, render the ruin
scene into a render target with `scene.background` set to magenta (hide `hobunji_interior_unlit_black_void`) and
look for magenta pixels.
