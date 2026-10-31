# Honeyfuzzle swarms, hive stumps and the Honeyfuzzle House

A honeyfuzzle is a hummingbird-like animal that behaves differently from every other species, so it has its own small set of modules instead of going through the barn/den/size-class paths.

| Piece | File | Owns |
| --- | --- | --- |
| Swarm renderer | `js/honeyfuzzle-swarm.js` (`window.HoneyfuzzleSwarm`) | One instanced draw call per swarm, continuously blended fly sprites, tail and spectacles pigmentation |
| Static portraits | `js/creature-genetics-render.js` (`SPECIES.honeyfuzzle`) | Crop/chathead composites: tail below fly body, optional spectacles above |
| Species entry | `CREATURE_DB.honeyfuzzle` in `game.js` | Stats, `swarm` render config, `fixedSizeClass: 'medium'` |
| Hive stumps | `js/honeyfuzzle-hives.js` (`window.HoneyfuzzleHives`) | Swarm spawn/return, long-hold harvest, collapse |
| Colors | `js/honeyfuzzle-colors.js` (`window.HoneyfuzzleColors`) | Region palettes, per-stump color, backward-compatible egg appearance/genotype FIFO |
| Honeyfuzzle House | `js/honeyfuzzle-house.js` (`window.HoneyfuzzleHouse`) | One-slot egg/swarm building on the farm |
| Spatial buzzing | `js/honeyfuzzle-audio.js` (`window.HoneyfuzzleAudio`) | Shared decoded seam-crossfaded recording, 24-tile hive and swarm emitters, live aggression/Doppler |

## Swarm = one entity, drawn as a flock

The gameplay entity is a single creature (`honeyfuzzle`, labelled "Honeyfuzzle Swarm") that flows through every normal creature path (spawn, LOD, companion AI, damage, death). Only its presentation differs: `createCreatureVisuals` calls `HoneyfuzzleSwarm.buildAvatar` when `def.swarm` is set. The returned `avatarRef` has the same shape as an animal plane avatar (`group`, `dispose`), and `frontPlane` is the yaw pivot that `updateCreatureMesh` already rotates toward the camera-relative facing.

- **No idle/run states.** Hummingbirds never perch. `updateCreatureAnimFrame` hands the swarm one `update(speed, now, dt, moveSpeed)` call per frame.
- **Hummingbird flutter.** `honeyfuzzle_fly1.png`, `fly2.png`, and `fly3.png` replace the old up/mid/down sprites. Every rendered bird samples all three poses at once, with weights oscillating smoothly around an equal blend. Each member's permanent `i % 3` phase offset prevents the swarm from pulsing in unison. A bounded 7 Hz opacity shimmer is chosen to remain smooth on 30 FPS mobile devices without trying to simulate individual hummingbird wingbeats. Bodies overlap into an essentially solid image while differently positioned wings show translucent ghosted positions, without spawning multiple billboard planes.
- **Motion (bees, not birds).** 24 small members per swarm (a multiple of 3 so the wing thirds stay even). `memberPose(seed, i, count, nowMs, speed01, spread, out)` is a pure function: each member hovers with a fast tiny buzz, zips to a new random point inside the cloud, hovers again, and mirrors itself to face the way it last darted. Dart periods and phases differ per member, so at any instant some are mid-zip and some hovering, and the cloud breathes. At speed the cloud tightens slightly and per-member `lead` values stretch it: `lead > 0` members run ahead of the heading and `lead < 0` members trail it.
- **Performance.** Three parallel `InstancedMesh` planes (central combat-linked 8 birds, plus two purely visual ±Z planes of 3 birds each by default) share one geometry/material and one 3×2 atlas (six populated cells): fly1/2/3, tailfeathers, spectacles, and the previously uploaded `honeyfuzzle_eyes.png`. Bird transforms refresh at 8 Hz while the wing shader continues its low-cost animation; no new combat entities or collision planes are created. The shader composites the five samples per pixel, using a single continuous time uniform and a fixed per-member phase attribute. Per-frame CPU work is only existing pose matrix updates plus one uniform; no atlas uploads or additional bird meshes. This trades modest pixel-shader cost for far fewer draw calls and allocations.

## Where they live, and what color

Honeyfuzzles live in every wilderness zone except the Western Slope (the generator places no hive stumps there, and `HoneyfuzzleColors.isExcludedZone` also makes any stump already in a saved Western Slope layout plain scenery). The Southern Cloud Forest asks the generator for extra stumps (`beehives: 30`) because its canopy leaves little clear ground.

`HoneyfuzzleColors` builds one master palette from every body color an existing species can have (`SCRATCHBONES_CONFIG.game.creatureGenetics.palettes`) plus authored bird colors, and splits it by region:

| Zone | Palette |
| --- | --- |
| Northern Cliffs | temperate bird colors: muted earth tones, robin/bluebird/goldfinch/cardinal-style colors |
| Southern Cloud Forest | tropical bird colors: vivid parrot/macaw/toucan/quetzal colors (all of Drenkirra's palette) |
| Eastern Mire | ominous colors: blacks, greys, whites and the darkest greens through violets |
| any other zone | all three |

Existing species colors are sorted into a region by HSL (`classify`); authored colors name their region. A stump's swarm color is a hash of its key, so it never changes. Harvesting queues the source hive's **color and expressed tail/spectacles genotype** per egg (per world, persisted). Placing an egg in a house takes the oldest appearance record; hatching preserves the genes and primary `swarmColor` when the animal moves to the Stable. Legacy FIFO entries containing only a hex color are converted on read and receive newly rolled genes, so existing saved eggs still hatch.

The swarm renderer recolors the authored mint body in the fragment shader (`uBody`/`uUse` per material): dark pixels (outline, beak, feet) are untouched; the separately composited, untinted authored eye artwork stays above patterns and the body is remapped by brightness, which keeps the authored shading and pale wing highlights in any color. Every color shares one atlas texture and one shader program.

**Pattern order and colors:** `honeyfuzzle_tailfeathers.png` is drawn **below** the main body for every bird, even with a missing/old genotype. Normally it takes the primary coat (`swarmColor`/`genotype.base.color`, body color 1). An **expressed** `tailfeathers` allele switches just those feathers to the inherited secondary color (body color 2); unexpressed alleles retain the default primary tint. `honeyfuzzle_spectacles.png` draws **above** the body only when its `spectacles` allele is expressed. Both use the ordinary genetics' enabled/copies/color schema; the tail's visible default is an anatomical renderer property, not a compulsory allele.

All five new PNGs have identical **478×399** canvas coordinates; the retired 500×500 crop would clip the imagery. The shared atlas is packed into **1434×798** pixels so even a GPU limited to 2048 pixels per texture can hold it. Wild hive swarms receive stable per-hive pattern rolls and colors from their area's bird palette. Hatchlings inherit their source hive's optional alleles and retain the stored egg color as their primary (older color-only eggs roll new alleles). Their genotype persists in the farm record and survives transfer to the stable. The main game sprite factory currently forwards the primary color, so the swarm renderer resolves the actor's genotype from `Combat.deps` when it first appears in the active hostile/companion set (at most one retry per 500 ms until found). Houses pass their stored genotype directly. `HoneyfuzzleSwarm.debugSnapshot()` exposes atlas load errors, missing optional markings, exact asset paths and successful actor links for mobile debugging. Missing optional tail/spectacles images do not prevent flight sprites from rendering, but a missing essential fly frame correctly fails the atlas. The normal `CreatureGeneticsRender` additionally supports honeyfuzzle static portraits with tail/body/spectacles in the same order, so animal chatheads need not fall back to generic icons.

## Always Medium, always a "swarm"

`CreatureGenetics.creatureSizeClass` honours `CREATURE_DB[kind].fixedSizeClass`, so a honeyfuzzle is always `medium` (the Stable's companion role) with no Size gene or mutation. The species label is "Honeyfuzzle Swarm", which is what the Farm and Stable show.

## Hive stumps

The wilderness generator's `beehive` objects are hollow stump tiles (`floraKind === 'beehive'`, drawn by `FoliageGenerator.buildStumpMesh`). Each stump is three things:

1. **Home.** By day `ensureCurrentZone` (called from `WildlifeSpawn.updateHostileSpawning`) spawns one swarm per stump near the player. `updateHostiles` calls `HoneyfuzzleHives.control` before the generic AI: at night the swarm flies to the stump and tucks inside (hidden and frozen); at dawn it comes back out. A defeated swarm reforms 15 seconds after lethal damage, as long as its hive stump still stands, including at night if it was engaged.
2. **Nest.** One long hold (`HOLD_SECONDS`, via the same hold input as `js/corpse-hold-loot.js`) gives 1-3 `fertileHoneyfuzzleEgg`.
3. **Resource.** The same hold gives `honey`. The stump then collapses: the tile becomes grass and an entry with `regrowDays: HIVE_REGROW_DAYS` goes into `_zoneFelledTreePersist` (so it persists and regrows through the felled-tree machinery, just on a longer clock). Its swarm is left homeless until the stump regrows.

## Honeyfuzzle House (not a barn)

Honeyfuzzle swarms are never barn animals (`SCRATCHBONES_CONFIG.game.livestock.housing`), and there is no incubator for their eggs: `fertileHoneyfuzzleEgg` is deliberately **not** in `livestock.itemKinds`.

The house is a 1x1 `FarmProduction` building (`config/farm-specializations.js`, key `honeyfuzzleHouse`, authored model `config/furniture-authored/honeyfuzzleHouse.json`). It is bought as a plan from the carpenter, placed and moved on the Farm map like any production building, and managed from outside; there is no enter action. Its single slot lives on the production entry as `entry.house`:

- **empty** -> place a fertile egg from the bag.
- **egg** -> hatches after `hatchDays` of world time (`HoneyfuzzleHouse.tick`, driven by FarmProduction's existing one-second timer), or immediately with a Growth Tonic.
- **swarm** -> an ordinary world-livestock record (`kind: 'honeyfuzzle'`, `houseId`), shown hovering over the house by a scheduler subscriber (`honeyfuzzle-house-swarms`). It can be moved to the personal Stable from the Farm tab's Livestock list; the house is then empty again.

## Combat

Honeyfuzzles fight with **Swarm**, built on the reusable attach mechanic described in [combat-attach.md](combat-attach.md): one chosen target, the swarm sits on top of it for 6 s, deals little direct damage but stacks a lot of Poisoned Health, is immune to that target's attacks, and can still be hurt by anyone else. Its attached cluster contracts to 71% of free-flight spread and targets the upper quarter of the host. An ally or player's combat pet can rescue the host with a normal-strength strike against the swarm, at the cost of a quarter-strength friendly strike (Health, Footing, afflictions and knockback) on the host; the swarm immediately detaches. They are territorial (warning first, then a fight) around their hive, but make no semantic animal utterances—only the spatial honeyfuzzle buzz changes pitch with aggression. As companions they use Swarm on every attack. When swarmed, the host's same-team pet/NPC can strike the host for 25% normal Health, Footing, affliction buildup and knockback, while the attached swarm takes the full hit and disengages. Beginning to harvest honey at night immediately spawns or wakes the defender and provokes a fight instead of waiting until the harvest completes.

## Positional honeyfuzzle buzz

The audio runtime adds independent positional emitters for intact wilderness hive stumps, moving honeyfuzzle creatures (wild or companions registered in the live creature set), and occupied Honeyfuzzle Houses. It hears sources within **24 tiles**, capped at the nearest **8** simultaneous voices; sources fade naturally across that boundary. Hives continue to hum when their swarms are tucked away; collapsed stumps and dead swarms are silent. It deliberately leaves music, weather and biome BGS running concurrently.

Asset: the existing **AAC M4A** recording is in `docs/assets/audio/sfx/utterances/sfx_honeyfuzzle_buzz.m4a` on main. No additional audio upload is needed. The runtime folds its stereo channels to one mono buffer for positional rendering. See `HoneyfuzzleAudio.debugSnapshot()` if a browser fails to load/decode it. All emitters reuse one decoded buffer, whose last 650 ms are overlapped into its beginning to remove the seam. Each emitter runs exactly one looping BufferSource through an equal-power positional panner and distance/area crossfade gain, rather than two voices or new HTMLAudioElements on every restart.

At 10 Hz, only active voices update their location, distance attenuation and AudioParams. A 350 ms scan gathers hives, creatures and farm house visuals without per-frame world scans. Moving sources and the player supply radial velocity for capped physical Doppler; the species territorial warning/fight and attack states add a separate smooth aggression multiplier. AudioParam smoothing prevents clicks/jumps on abrupt AI state changes. The new sound routes through the shared Effects/Master mixer. The opening introduction explicitly silences and then resumes the buzz with the rest of the soundscape.

On mobile use `HoneyfuzzleAudio.debugSnapshot()` (or `window.HoneyfuzzleAudio.debugSnapshot()` in any in-game diagnostics) to inspect load errors, active voice count, pitches and distance source budget. `node scripts/test-honeyfuzzle-audio.js` runs the headless behavior regression.

**Respawn and nocturnal harvest diagnostics.** `HoneyfuzzleHives.census()` reports `respawnInSeconds` while a live stump is waiting for its defender to re-form; `HoneyfuzzleHives.debugSnapshot()` lists defeat timestamps. The hold-to-harvest system's optional one-shot `onHoldStart` hook provokes nighttime defenders before honey or eggs are granted. Collapsed hives never refill their defenders until the stump regrows.
