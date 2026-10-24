# Honeyfuzzle swarms, hive stumps and the Honeyfuzzle House

A honeyfuzzle is a hummingbird-like animal that behaves differently from every other species, so it has its own small set of modules instead of going through the barn/den/size-class paths.

| Piece | File | Owns |
| --- | --- | --- |
| Swarm renderer | `js/honeyfuzzle-swarm.js` (`window.HoneyfuzzleSwarm`) | One instanced draw call per swarm, the shared wing tick, deterministic member motion |
| Species entry | `CREATURE_DB.honeyfuzzle` in `game.js` | Stats, `swarm` render config, `fixedSizeClass: 'medium'` |
| Hive stumps | `js/honeyfuzzle-hives.js` (`window.HoneyfuzzleHives`) | Swarm spawn/return, long-hold harvest, collapse |
| Honeyfuzzle House | `js/honeyfuzzle-house.js` (`window.HoneyfuzzleHouse`) | One-slot egg/swarm building on the farm |

## Swarm = one entity, drawn as a flock

The gameplay entity is a single creature (`honeyfuzzle`, labelled "Honeyfuzzle Swarm") that flows through every normal creature path (spawn, LOD, companion AI, damage, death). Only its presentation differs: `createCreatureVisuals` calls `HoneyfuzzleSwarm.buildAvatar` when `def.swarm` is set. The returned `avatarRef` has the same shape as an animal plane avatar (`group`, `dispose`), and `frontPlane` is the yaw pivot that `updateCreatureMesh` already rotates toward the camera-relative facing.

- **No idle/run states.** Hummingbirds never perch. `updateCreatureAnimFrame` hands the swarm one `update(speed, now, dt, moveSpeed)` call per frame.
- **Wing cycle.** `up -> mid -> down -> mid -> repeat`, all members stepping on the same `WING_TICK_MS` tick. Member `i` sits `i % 3` steps into the 4-step cycle, so a third of the swarm is at each of three different points at any moment.
- **Motion.** `memberPose(seed, i, count, nowMs, speed01, spread, out)` is a pure function: a deterministic drift/roll per member plus a per-member `lead` value. At speed, `lead > 0` members run ahead of the heading and `lead < 0` members trail it, so the swarm stretches rather than moving as one block.
- **Performance.** One `InstancedMesh`, one atlas of the three frames shared by every swarm, the frame chosen per instance by an `aFrame` attribute (an `onBeforeCompile` UV shift on the shared PNG-plane material), and per-frame work that is only N matrix writes with no allocation. The `aFrame` buffer is uploaded only when the wing tick changes.

## Always Medium, always a "swarm"

`CreatureGenetics.creatureSizeClass` honours `CREATURE_DB[kind].fixedSizeClass`, so a honeyfuzzle is always `medium` (the Stable's companion role) with no Size gene or mutation. The species label is "Honeyfuzzle Swarm", which is what the Farm and Stable show.

## Hive stumps

The wilderness generator's `beehive` objects are hollow stump tiles (`floraKind === 'beehive'`, drawn by `FoliageGenerator.buildStumpMesh`). Each stump is three things:

1. **Home.** By day `ensureCurrentZone` (called from `WildlifeSpawn.updateHostileSpawning`) spawns one swarm per stump near the player. `updateHostiles` calls `HoneyfuzzleHives.control` before the generic AI: at night the swarm flies to the stump and tucks inside (hidden and frozen); at dawn it comes back out. A killed swarm is replaced after two days.
2. **Nest.** One long hold (`HOLD_SECONDS`, via the same hold input as `js/corpse-hold-loot.js`) gives 1-3 `fertileHoneyfuzzleEgg`.
3. **Resource.** The same hold gives `honey`. The stump then collapses: the tile becomes grass and an entry with `regrowDays: HIVE_REGROW_DAYS` goes into `_zoneFelledTreePersist` (so it persists and regrows through the felled-tree machinery, just on a longer clock). Its swarm is left homeless until the stump regrows.

## Honeyfuzzle House (not a barn)

Honeyfuzzle swarms are never barn animals (`SCRATCHBONES_CONFIG.game.livestock.housing`), and there is no incubator for their eggs: `fertileHoneyfuzzleEgg` is deliberately **not** in `livestock.itemKinds`.

The house is a 1x1 `FarmProduction` building (`config/farm-specializations.js`, key `honeyfuzzleHouse`, authored model `config/furniture-authored/honeyfuzzleHouse.json`). It is bought as a plan from the carpenter, placed and moved on the Farm map like any production building, and managed from outside; there is no enter action. Its single slot lives on the production entry as `entry.house`:

- **empty** -> place a fertile egg from the bag.
- **egg** -> hatches after `hatchDays` of world time (`HoneyfuzzleHouse.tick`, driven by FarmProduction's existing one-second timer), or immediately with a Growth Tonic.
- **swarm** -> an ordinary world-livestock record (`kind: 'honeyfuzzle'`, `houseId`), shown hovering over the house by a scheduler subscriber (`honeyfuzzle-house-swarms`). It can be moved to the personal Stable from the Farm tab's Livestock list; the house is then empty again.
