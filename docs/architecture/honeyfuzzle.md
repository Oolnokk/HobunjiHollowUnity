# Honeyfuzzle swarms, hive stumps and the Honeyfuzzle House

A honeyfuzzle is a hummingbird-like animal that behaves differently from every other species, so it has its own small set of modules instead of going through the barn/den/size-class paths.

| Piece | File | Owns |
| --- | --- | --- |
| Swarm renderer | `js/honeyfuzzle-swarm.js` (`window.HoneyfuzzleSwarm`) | One instanced draw call per swarm, the shared wing tick, deterministic member motion |
| Species entry | `CREATURE_DB.honeyfuzzle` in `game.js` | Stats, `swarm` render config, `fixedSizeClass: 'medium'` |
| Hive stumps | `js/honeyfuzzle-hives.js` (`window.HoneyfuzzleHives`) | Swarm spawn/return, long-hold harvest, collapse |
| Colors | `js/honeyfuzzle-colors.js` (`window.HoneyfuzzleColors`) | Region palettes, per-stump color, egg color queue |
| Honeyfuzzle House | `js/honeyfuzzle-house.js` (`window.HoneyfuzzleHouse`) | One-slot egg/swarm building on the farm |
| Spatial buzzing | `js/honeyfuzzle-audio.js` (`window.HoneyfuzzleAudio`) | Shared decoded seam-crossfaded recording, 24-tile hive and swarm emitters, live aggression/Doppler |

## Swarm = one entity, drawn as a flock

The gameplay entity is a single creature (`honeyfuzzle`, labelled "Honeyfuzzle Swarm") that flows through every normal creature path (spawn, LOD, companion AI, damage, death). Only its presentation differs: `createCreatureVisuals` calls `HoneyfuzzleSwarm.buildAvatar` when `def.swarm` is set. The returned `avatarRef` has the same shape as an animal plane avatar (`group`, `dispose`), and `frontPlane` is the yaw pivot that `updateCreatureMesh` already rotates toward the camera-relative facing.

- **No idle/run states.** Hummingbirds never perch. `updateCreatureAnimFrame` hands the swarm one `update(speed, now, dt, moveSpeed)` call per frame.
- **Wing cycle.** `up -> mid -> down -> mid -> repeat`, all members stepping on the same `WING_TICK_MS` tick. Member `i` sits `i % 3` steps into the 4-step cycle, so a third of the swarm is at each of three different points at any moment.
- **Motion (bees, not birds).** 24 small members per swarm (a multiple of 3 so the wing thirds stay even). `memberPose(seed, i, count, nowMs, speed01, spread, out)` is a pure function: each member hovers with a fast tiny buzz, zips to a new random point inside the cloud, hovers again, and mirrors itself to face the way it last darted. Dart periods and phases differ per member, so at any instant some are mid-zip and some hovering, and the cloud breathes. At speed the cloud tightens slightly and per-member `lead` values stretch it: `lead > 0` members run ahead of the heading and `lead < 0` members trail it.
- **Performance.** One `InstancedMesh`, one atlas of the three frames shared by every swarm, the frame chosen per instance by an `aFrame` attribute (an `onBeforeCompile` UV shift on the shared PNG-plane material), and per-frame work that is only N matrix writes with no allocation. The `aFrame` buffer is uploaded only when the wing tick changes.

## Where they live, and what color

Honeyfuzzles live in every wilderness zone except the Western Slope (the generator places no hive stumps there, and `HoneyfuzzleColors.isExcludedZone` also makes any stump already in a saved Western Slope layout plain scenery). The Southern Cloud Forest asks the generator for extra stumps (`beehives: 30`) because its canopy leaves little clear ground.

`HoneyfuzzleColors` builds one master palette from every body color an existing species can have (`SCRATCHBONES_CONFIG.game.creatureGenetics.palettes`) plus authored bird colors, and splits it by region:

| Zone | Palette |
| --- | --- |
| Northern Cliffs | temperate bird colors: muted earth tones, robin/bluebird/goldfinch/cardinal-style colors |
| Southern Cloud Forest | tropical bird colors: vivid parrot/macaw/toucan/quetzal colors (all of Drenkirra's palette) |
| Eastern Mire | ominous colors: blacks, greys, whites and the darkest greens through violets |
| any other zone | all three |

Existing species colors are sorted into a region by HSL (`classify`); authored colors name their region. A stump's swarm color is a hash of its key, so it never changes. Harvesting queues one color per egg (per world, persisted), placing an egg in a house takes the oldest, the hatched record keeps `swarmColor`, and moving it to the Stable copies it, so the companion matches its stump.

The swarm renderer recolors the authored mint body in the fragment shader (`uBody`/`uUse` per material): dark pixels (outline, beak, feet, pupil) are untouched and the body is remapped by brightness, which keeps the authored shading and pale wing highlights in any color. Every color shares one atlas texture and one shader program.

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

## Combat

Honeyfuzzles fight with **Swarm**, built on the reusable attach mechanic described in [combat-attach.md](combat-attach.md): one chosen target, the swarm sits on top of it for 6 s, deals little direct damage but stacks a lot of Poisoned Health, is immune to that target's attacks, and can still be hurt by anyone else. They are territorial (warning first, then a fight) around their hive, and as a companion they use Swarm on every attack.

## Positional honeyfuzzle buzz

The audio runtime adds independent positional emitters for intact wilderness hive stumps, moving honeyfuzzle creatures (wild or companions registered in the live creature set), and occupied Honeyfuzzle Houses. It hears sources within **24 tiles**, capped at the nearest **8** simultaneous voices; sources fade naturally across that boundary. Hives continue to hum when their swarms are tucked away; collapsed stumps and dead swarms are silent. It deliberately leaves music, weather and biome BGS running concurrently.

Asset: the existing **AAC M4A** recording is in `docs/assets/audio/sfx/utterances/sfx_honeyfuzzle_buzz.m4a` on main. No additional audio upload is needed. The runtime folds its stereo channels to one mono buffer for positional rendering. See `HoneyfuzzleAudio.debugSnapshot()` if a browser fails to load/decode it. All emitters reuse one decoded buffer, whose last 650 ms are overlapped into its beginning to remove the seam. Each emitter runs exactly one looping BufferSource through an equal-power positional panner and distance/area crossfade gain, rather than two voices or new HTMLAudioElements on every restart.

At 10 Hz, only active voices update their location, distance attenuation and AudioParams. A 350 ms scan gathers hives, creatures and farm house visuals without per-frame world scans. Moving sources and the player supply radial velocity for capped physical Doppler; the species territorial warning/fight and attack states add a separate smooth aggression multiplier. AudioParam smoothing prevents clicks/jumps on abrupt AI state changes. The new sound routes through the shared Effects/Master mixer. The opening introduction explicitly silences and then resumes the buzz with the rest of the soundscape.

On mobile use `HoneyfuzzleAudio.debugSnapshot()` (or `window.HoneyfuzzleAudio.debugSnapshot()` in any in-game diagnostics) to inspect load errors, active voice count, pitches and distance source budget. `node scripts/test-honeyfuzzle-audio.js` runs the headless behavior regression.
