# Ruin tiers, the jump-platform shaft and tradition witch-bombs

## Tiers (`RuinLayerPlan.TIERS`, passed as `opts.tier` by `js/ruin-sites.js`)

Cliff-entrance ruins and dug-hole ruins share the middle (`hole`) tier; the named lich tomb is `lich`; `cave` is reserved for ruins found inside caves (no such site kind yet).

| Tier | Where | Floors | Central chamber | Wings (total) | Rooms per wing | Braziers |
| --- | --- | --- | --- | --- | --- | --- |
| `cave` | (reserved: ruins inside caves) | 2 | 37.5 % (13 cells) | 3 | 2 (1 puzzle + brazier) | 3 |
| `hole` | cliff-entrance and burrow-hole ruins | 3 | 75 % (27) | 4 | 3 (2 puzzles + brazier) | 4 |
| `lich` | the named tomb of a tradition | 4 | 112.5 % (39) | 5 | 3 | 5 |

* Only the empty central chamber shrinks. `shaftSize = central + 2 * 5`: the 5-cell
  gallery ring (the "balcony thickness") never changes.
* `tierOptions(tier)` also fixes `floorHeight` (6 / 10 / 12), turns native V50 upper
  floors off (they would add unaccounted rooms and braziers) and selects the
  `jumpPlatforms` traversal. `distributeWings` spreads the wings over the floors with the
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

## Emblem decals (`js/ruin-emblem.js`)

Inside a ruin the generic round rune/seal decals resolve to the tradition's motif PNG (`assets/patterns/motif_harlyao_glyph_*`).
