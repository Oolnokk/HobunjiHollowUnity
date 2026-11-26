# Multiplayer intent & architecture review

Status: **aspirational / not implemented.** No networking code exists anywhere in
this repo today (`docs/game.js` and `docs/js/combat/*.js` are single-process,
single-browser-tab, `localStorage`-only). This document exists so the intended
shape of multiplayer isn't lost, and to track what in the current codebase
already lines up with it versus what will actively fight it.

## Target: 4-player co-op, built single-player-first

Goal: up to 4 players (`ActorRegistry.MAX_PLAYERS`), host-authoritative, no
deterministic lockstep. Single-player is the same game with zero guests, not a
second code path. Order of work:

1. **Multiplayer-compatible single-player** (in progress — see below).
2. Dev-controlled dummy second player (walk, take damage, go down, change area) — logic done (`DevDummyPlayer`), avatar mesh/equipment pending.
3. Two connected clients: session, movement, appearance, equipment, animation state.
4. Shared simulation: NPCs, combat, farming, inventories, world mutations.
5. Independent exploration: simulation residency vs asset residency vs render visibility (`WildernessChunks`).
6. Reconnect, cutscenes/festivals/sleep consensus, permissions, latency, mobile.

### Foundations that exist now (step 1)

| Module | Replaces | Use it for |
| --- | --- | --- |
| `js/actor-registry.js` (`ActorRegistry`) | the `player` singleton / `[player]` | stable entity ids (kept off the entity, never saved), `getPlayers()`, `getLocalPlayer()`, `areaOf()`, area-aware `nearestPlayer()`, `ownerOf()` for companion `master` / projectile `owner` |
| `js/damage-authority.js` (`DamageAuthority.hit(target, …)`) | `damagePlayer(...)` having no target | one entry for attacker→target; local player → `damagePlayer`, remote player → registered handler (never the local player), else `damageCreature`; emits id-tagged hit events for a future host broadcast |
| `js/sim-clock.js` (`SimClock.now()`) | `performance.now()` in gameplay timers | host-synced time; offset is 0 today so it is identical |

| `js/remote-player-state.js` (`RemotePlayerState`) | `damagePlayer` + `PlayerDowned` being local-only | health, downed/bleed-out timer, Second Wind (`noteKillBy`) and respawn for every non-local player, no HUD; registered as `DamageAuthority`'s remote handler |
| `js/dev-dummy-player.js` (`DevDummyPlayer`) | — | dev stand-in second player: `spawn({x,y,areaId})`, `walkTo`, `follow`, `setArea`, `despawn`. Has a real body via `RemotePlayerAvatar` |

Migrated to `DamageAuthority.hit`: hostile bite, companion bite, enemy ranged
projectiles (test every player, nearest first), animal pounce/guard-charge/leap,
bandit swings, Voorg kick, swarm attach ticks/swats/rescues, Tzatzul dives,
knockback-collision impact; combo/charged-breaker/resource timers use `SimClock`;
hostile target acquisition is area-aware (non-strict).

Try it in the console: `DevDummyPlayer.spawn(); DevDummyPlayer.follow(true);
DamageAuthority.hit(DevDummyPlayer.get(), 40, 0, 0, 100, {}); RemotePlayerState.debugSnapshot()`.

The Rootledoot encounter is participant-aware (`rootledoot-encounter.js`): activation, bait/reward dormancy,
"player escaped locale", ambush start, spawn anchoring and victory use every player in the zone
(local always counts; a remote one only when `ActorRegistry.areaOf` says it is there), and a local defeat only resets
the fight when no other participant is still standing. Picking the root (`action`/`pick`) stays the local client's own
interaction.

### Time rules (`js/time-consensus.js`, `window.TimeConsensus`)

With 2+ registered players, nothing advances the world clock on one player's say-so:

- **Sleep / rest / Wait** needs every player resting. The first sleeper waits (bed pose holds; Wait/Sleep menu closes with a toast). Walking away withdraws the vote.
- **Forced skips** (alcohol blackout, fey/Rootledoot defeat, Ikthi later) knock the victim out for **60 s** (`REVIVE_WINDOW_MS`). Another standing player within ~2.5 tiles revives them (`TimeConsensus.revive(target, by)`), which cancels that player's skip. Otherwise the skip happens. Each knocked-out player has their own window; a second skip while out does not extend it.
- **Several queued skips**: the longest (in game minutes) wins and is applied **once**; every participant still gets their own side effects (wander travel, healing).
- **Resting while someone is knocked out** counts them as asleep: when everyone else is resting (or nobody is left awake to revive), the skip fires immediately.
- Single player (`shouldGate()` false) keeps the original immediate paths untouched.

New skip sources call `TimeConsensus.knockOut(player, { kind, source, minutes, run, onResolved, onRevived })` (forced) or `requestRest` (voluntary) when `shouldGate()`; `run` applies the time change and is only called if that skip wins.
Dev: `DevDummyPlayer.sleep(min)`, `.knockOut(min)`, `.reviveLocal()`, `.reviveDummy()`, `.wake()`; `TimeConsensus.snapshot()`.

**Countdown HUD** (`js/time-consensus-hud.js`): "Out cold — a friend has 0:54 to revive you", "<name> is down — revive them within 0:54", and "Waiting for the others to sleep (n/m)"; verified live in the game.

While knocked out the local avatar is flagged `_downed` (enemies and `nearestPlayer({aliveOnly})` skip it) and `damagePlayer` ignores hits, so nobody dies mid-window.

**Not done yet:** a revive interaction prompt for the local player (only the API and dev hooks exist), live-testing the bed and Wait/Sleep menu paths with a second real player. Natural real-time clock progression is deliberately not gated; only skips are.

### Cutscenes (`js/shared-cutscene.js`, `window.SharedCutscene`)

Design decisions: a cutscene **pauses everyone** and **everyone can watch it, no matter where they are**.
If it is a **crowd scene** (a wedding, an announcement, the Five Blossoms crowning - anywhere the villagers
gather as an audience) the **other players are placed in the crowd** too.

- `runCutscenePreview` (the one runner every authored/live scene goes through) is wrapped: `SharedCutscene.begin()` first, `end()` in a `finally`. Scenes nest (depth-counted), so a scene owner can open the session earlier than the runner.
- Every registered player is a participant for the whole scene, in any area; a late joiner watches, a leaver is released. Remote participants are frozen, untargetable and invulnerable (`_inCutscene`; honoured by `ActorRegistry` alive checks, `EnemyPetTargeting.viable`, the hostile bite check, `RemotePlayerState.applyHit`, the dummy). `viewAreaFor(player)` is the scene's area for everyone (each client shows it).
- The player who triggered the scene (`controller`) makes the dialogue choices; the others watch.
- Time-skip revive windows and sleep votes are held for the length of the scene (`TimeConsensus.pause/resume`) and pick up where they left off.
- **Crowd scenes opt in**: the scene owner lays out its villagers, then asks `crowdMembers()` (everyone but the controller) and calls `joinCrowd({ area, slots })` with the next slots of the **same layout** (`{ c, r, rotY, pose: 'stand' | 'sit', seatTarget? }`). The player's entity is moved to the slot (area, position, facing) and put back exactly afterwards. `RemotePlayerAvatar` draws crowd members only during a scene (standing, or seated through the cutscene runner's own seated-pose solve); other watchers are not drawn.
- Opted in so far: **Five Blossoms crowning** (ranks, after the villagers) and the **wedding** (pews, after the villager guests). New crowd scenes: copy those two call sites.

**Not done yet / not verified:** the local host avatar when it is *not* the controller (the runner places only the controller; `joinCrowd` skips the local entity); a spectator camera for guests whose own client must switch to the scene's area (needs the network layer); who may skip a scene; verified live only for a standing crowd slot and the begin/end/pause behaviour (seated slots and both owners are covered by unit tests with real owner code, not yet seen in a browser).

### Residency: simulation vs assets vs what is drawn

Three things that used to be one ("the area the player is in") and now have different owners in co-op:

| Concept | Meaning | Keyed to | Owner |
| --- | --- | --- | --- |
| **Render visibility** | what this client draws | **this client's own player/camera** | `WildernessChunks` mesh streaming (16x16-tile chunks, load/unload radii), visual LODs (`WildlifeVisualLod`, tree/grass/brick LOD, outline budget), `RemotePlayerAvatar` bodies |
| **Asset residency** | which zone scenes/meshes/textures stay built in memory | **every player's area**, plus the recent-zones budget | `trimZoneCache` in `game.js` (+ `ZoneBanditRelease`, NPC parking) |
| **Simulation residency** | which areas' creatures, bandits, camps, NPCs are ticked | **every player's area** (and, for sleep/wake and ecology radii, the nearest player in that area) | `wilderness-simulation-lod.js`, `porakaneki-camps-runtime.js`, `offarea-npc-tick.js`, `updateHostiles` (see below) |

- `ActorRegistry.occupiedAreas()` is the one answer to "which areas have a player in them". `trimZoneCache` now keeps every occupied zone (they do not count against `zoneCache.maxInactiveZones`), so a zone a guest is standing in is never evicted: its scene, parked NPCs, bandits and camps survive instead of being torn down and re-seeded.
- **Verified live** (headless, three real wilderness zones built, `maxInactiveZones: 1`): with a guest registered in the oldest zone the trim kept all three and evicted none; once the guest left, exactly that zone was evicted. (Harness recipe: `.claude/skills/headless-game-test/SKILL.md`, "enterZoneDebug does nothing in a fresh world".)
- Chunk meshes are pure asset/render state (nothing in the simulation queries `WildernessChunks` for loaded chunks), so **each client streams the chunks around its own player** and the host does not load chunks around a guest.
- **Still single-area (the big remaining item):** `updateHostiles`, wildlife/den spawning, and most world updates only tick creatures whose `areaId === currentArea`, and `currentArea` is a global that also selects the active scene and grid. A zone only a guest occupies is therefore *kept* but not *ticked* by the host. Ticking several areas needs those updates to take an explicit area/scene/grid context instead of reading `currentArea`; do it one system at a time, starting with `updateHostiles`.

#### Ticking more than one area: measurements and plan (not started in code)

Measured on `updateHostiles` (794 lines): only **11** direct `currentArea` references (area filters and targeting arguments) and **1** direct audio call, so the function body is shallow. The risk is in its callees and in global state:

- `GridTileAccessors.getActiveGrid()` / `getActiveScene()` are **pure lookups on `currentArea`** (and `getZoneSceneInfo(areaId)` already gives per-area access), and creatures already carry `areaGrid`/`scene`, with many movement helpers using `c.areaGrid || active grid`. So a bracketed per-area tick (`currentArea = X; tick; restore`, the same swap `runCutscenePreview` already does) is **mechanically viable**.
- Hazards for that swap: `getActiveGrid()`/`getActiveScene()` **build a missing zone scene as a side effect** (never tick an unbuilt zone through them); per-frame caches keyed to the active area (`grazingPreyIndexArea`, `releasePreviousAreaCreatureTextures`, LOS and visibility caches) would thrash or release the wrong textures when areas alternate; sounds and effects triggered by creatures in a remote area would play at the local listener or draw into a scene nobody sees; `updateCreatureMesh` is interleaved with the AI so remote-area creatures would pay for visuals.
- Reach: `currentArea` has 545 references in `game.js`, 213 modules call `getCurrentArea`, 22 of them in `js/combat/` (LOS, projectiles, bandit combat, afflictions).

**Stage 1 is implemented (opt-in, off by default)** in `js/remote-area-tick.js` + `AreaScope` (`game.js`):

- With 2+ players and `?remoteAreaTick=1` (or `localStorage.hobunjiRemoteAreaTick='1'`, or `RemoteAreaTick.setEnabled(true)`), every other **occupied, already-built wilderness zone** gets a coarse creature tick (5 Hz, accumulated dt) inside `AreaScope.with(area, ...)`, which swaps `currentArea` for the call and restores it in a `finally`. An unbuilt zone is never scoped (the active-grid/scene lookups would build it as a side effect). Single-player and co-op with the flag off are untouched.
- While scoped: audio keeps the **listener's real area** (`AreaScope.listenerArea()`, wired into `AudioSystem.init`) so remote creatures are silent; the wildlife visual LOD treats everything as far away so no rigs are built; per-frame local bookkeeping (`beginFrame`, texture release) is skipped; the registry resolves the local player's area to the real one, so the local avatar is never "in" the guest's zone; `updateHostiles` and the food web see only `playersInArea(currentArea)`; `EnemyPetTargeting.viable` uses the registry area for players (the local avatar has no `areaId` and used to be viable everywhere).
- **Verified live** (headless, real zones): with the tick off, 0 of 23 creatures in the guest's built zone moved over 8 s; on, all moved, 0 errors, `currentArea` never left the local zone. Deterministic end-to-end run (spawned wolf in the dev arena, local player in another zone, guest in front of the wolf, 50 simulated seconds): the wolf chased and bit the guest (100 -> 40 health, five remote-hit events through `DamageAuthority` -> `RemotePlayerState`), the local player was never targeted and kept full health.
- **Not verified / not done:** audio silence was not measured (only wired); the wolf was already `chase`-ing when placed (its stale local target is dropped by the scoped targeting); NPC walkers, bandit camps, den spawning, projectiles in flight and a zone nobody has built on the host are NOT ticked yet; no performance measurement of the extra ticks.

**Stage 2 (bandit camps and NPCs) is implemented in the same opt-in tick:**

- `WildernessSimulationLOD.tick` (just the bandit sleep/wake pass, with a **per-area** cadence) runs before the scoped hostile tick, so a camp beside a guest wakes and one with every player in that zone far away sleeps. The base `BanditCamps.updateCampBanners` is deliberately **not** called in the scope: it shows the local player a camp banner from local coordinates, and the Harlyao march planner and Porakaneki clutter sync are wrapped onto it (the march would run twice per frame).
- **NPC walkers need nothing**: the main loop already updates every walker whatever its area; `OffAreaNpcTick` only coarsens, opt-in, and only when no player is in the walker's area.
- **Verified live** (headless, real zones; bandit spawned in the dev arena, local player in another zone): tick off, guest 30 tiles away -> the bandit stays awake (nothing runs for that zone); tick on -> it goes to sleep (parked under `__wilderness_lod_sleep__:<zone>`); guest moves 6 tiles away -> it wakes and chases the guest; 160 ticks, 0 errors, the local player untouched. (A bandit never sleeps while in combat, so it did not re-sleep during the final far-away step; that is by design.)
- **Not done:** the Porakaneki/Harlyao camp *planners* (abstract state for camps nobody local is near), random bandit encounters and den spawning near a guest, projectiles in flight, and zones nobody has built on the host.

**Stage 3 (host builds the guest's zone) is implemented in the same opt-in tick:**

- An occupied zone with no scene on the host is built by `AreaScope.ensureScene(area)` (`buildZoneScene` + reagents/berries/treasure, i.e. `enterZone` minus the player move, loading screen and `currentArea` change). At most **one zone per round**, and only when the host is calm (no cutscene preview, not paused), because a build is a multi-second synchronous cost.
- Then `WildlifeSpawn.populateZone()` runs scoped (den packs, roaming herds, nest trees, Tzatzul/Pingdort flocks) on the first scoped tick and every 5 s, followed by the normal bandit LOD + hostile tick.
- **Verified live** (headless): local player in town, guest in never-built `map_northern_cliffs`: built once (~5.3 s, one frame), `currentArea` and local position unchanged, 43 creatures present after 30 ticks, 34 ticks / 0 errors. The ~5 s synchronous build is a visible hitch for the host; spreading it is future work.
- **Not done:** bandit camps are not stamped for a remotely built zone (`ensureCurrentZoneCamps` keeps its release/re-stamp rules tied to the local entry), honeyfuzzle hives, random encounters, projectiles in flight.

**Measured (headless, software GL; 41-47 creatures in the guest's zone, 200 ticks):** a remote-zone tick costs a median ~1.7-3.3 ms (p95 4-8 ms, worst 5-28 ms), i.e. roughly 9-17 ms of CPU per second at 5 Hz (about 1-2% of one core) for one occupied remote zone. Audio: 100-197 `playAnimalVoiceUtterance` calls ran under the remote scope and **none** produced sound (the utterance path compares the creature's area to the listener's real area). One leak was found and fixed: den-pack / herd / nest toasts in `wildlife-spawn.js` were gated on `getCurrentArea()`, so populating a guest's zone toasted the local player and played the error sound; they now compare with `AreaScope.listenerArea()`. After the fix, 0 media/Web Audio starts under the scope (HTMLMediaElement.play + AudioBufferSourceNode.start counted).

Remaining stages:
1. Remove the swap by passing an explicit area/scene/grid into the tick (the clean form), system by system.

### Conversations and menus (`js/npc-conversations.js`, `window.NpcConversations`)

Design decision: an ordinary NPC conversation holds **only the person talking**. The world, the clock and
every other player keep running; the only other thing it freezes is the NPC being spoken to. (A cutscene is
different: it pauses everyone - see above.)

- One conversation per NPC: a second player gets `{ ok: false, by }` and a "<NPC> is already talking with someone else." toast instead of taking over. One NPC per player: starting another ends the previous.
- `openNpcDialogue` asks `NpcConversations.begin(player, walker)` and `closeNpcDialogue` reports `end(player)`. A remote player's conversation (host side) freezes only that NPC and that player (`_inDialogue`) and releases on end, disconnect, or leaving the session. The remote body's own NPC-kind walker is not in `npcWalkers`, so it can never be talked to.
- Dialogue never set `paused`, so the world already kept running; this change only adds the lock.
- **Every UI hold in co-op** (`TimeConsensus.shouldGate()`): the main menu and its panels (shops included), the appearance editor, the town-proposals dialog and the manual pause button all set `paused`, which now means **"the local player is held"**, not "the world is stopped". The local player's controller polling, movement, vitals and own interactions (nest/tent/loot holds, door-transition checks, so a menu can never walk you through a door) are held (`localPaused`); calendar, hostiles, NPCs, weather and other players continue. `worldPaused()` (= `paused` in single-player only) is what world-simulation readers use: the loop gate, the Harlyao army planner (`BanditCombat.isPaused`) and the festival wheel dance. Single-player is unchanged. The ⏸ button toasts that the world keeps running.
- Live-verified in the real game: the clock advances during both the dummy's and the local player's conversation; a second player is refused with the toast; the NPC returns to its schedule after each conversation; in co-op the main menu leaves the clock running and the local player still, while in single-player the same menu still pauses the world.

**Not done yet:** a guest's own client (its dialogue UI and camera) needs the network layer; being hit while talking does not yet end the conversation for a remote speaker; the town-proposals dialog and the appearance editor now leave the world running, so an NPC can wander off mid-dialog (the proposal flow has not been checked for that); `farmEditMode` was not part of this audit (it never set `paused`).

### Remote player avatar (`js/remote-player-avatar.js`, `window.RemotePlayerAvatar`)

Every non-local player gets an on-screen body while they are in the area this client shows. It is the
cutscene player stand-in pipeline, not a new renderer: `makeNpcWalker(syntheticRecord)` (authored PNG
portrait + pants, procedural 3D feet and hands with their generated outlines, per
`docs/architecture/visual-authoring.md`), kept out of `npcWalkers` (no schedule, dialogue or save state),
driven from the simulation entity (`x`, `y`, `angle`), disposed through `despawnNpcVisitor(walker, true)`,
and enumerated by `CharacterVisuals` as an NPC-kind character. A body is built on entry (~1-2 s) and
removed when the player leaves the area or the session. The network layer supplies the look via
`player.avatarProfile = { appearance, equippedCosmetics, appliedDyes }`; with none, the local player's look is used (the dummy).

Verified in the real game (headless): the body builds in town, faces the camera / faces away from the
entity's `angle`, gait follows real speed (feet animate at ~2.5 tiles/s while walking, 0 when stopped),
and despawn leaves no body behind. **Not yet done:** held tools/weapons and bag items for remote players
(needs their equipment ids), a shoulder pet / companion via `ActorRegistry.ownerOf`, a nameplate,
x-ray/outline parity with the local player (`held-xray` is player-only in `CharacterVisuals.CAPABILITIES`),
and close-up checking of feet and the pants seam.

Simulation LOD is player-set aware: bandit sleep/wake (`wilderness-simulation-lod.js`)
and Porakaneki ecology/aggro radii use `ActorRegistry.distanceToNearestPlayer` /
nearest-player tile position, so a camp beside a guest stays awake on the host and a
player in another zone does not hold it awake. **Purely visual LOD** (wildlife
avatar hiding, NPC leg suppression, tree/brick/grass LOD, outline budget) stays
keyed to the *local* player/camera on purpose — each client renders for itself.

### Still singleton-bound (next up)

- Deliberately local-only (they are the local avatar's own action): `skeeri-ruins.js` swoop, `combat-camera-alignment-bridge.js` aerial wall impact, ruin/cave-trap deps in `game.js`, `respawnPlayer`/`PlayerDowned`/`GameFeel.playerHurt`. Ruin hazards must become "every player in the ruin" before co-op ruins.
- Other `performance.now()` gameplay timers (`invulnUntil` on the local player, `combat-input.js`, stamina windows set from `game.js`) are still wall-clock.
- `nearestPlayer` callers should switch to `strict: true` once hostiles in other zones are simulated.
- `WildernessChunks` residency, sleep/time advance and cutscenes assume one player.

Rule for new code: **never assume the local player is the only player.** Take a
target/actor, ask the registry for players, and read time from `SimClock`.

## The intended model

- One player is the **world owner**. Their character save is the "main"
  character for that world/save file.
- Other players **join with their own character save** — bringing their own
  gear inventory, levels, and combat loadout/ability choices with them.
- Each joining player's **regular (non-gear) inventory** — resources, crafting
  materials, unequipped stackables, etc. — is scoped to the specific
  `(world save, player save)` pair, not to the player globally. Leave the
  world, and that inventory stays behind; join a different world with the same
  character, and you get that world's own stash.
- Gear/levels/combat loadout travel with the character across worlds; regular
  inventory does not.

## What already lines up with this (good news)

The save schema in `docs/onboarding.js` / `docs/game.js` was apparently already
designed with this split in mind, well before any networking existed:

- `hobunjiSaveMeta` (`docs/onboarding.js:454`) stores `characters[]` and
  `worlds[]` as separate arrays — not one flat blob per save slot.
- A character record carries exactly the "travels with you" data: appearance,
  cosmetics, `gearInventory` (tools/clothing/charms/whistles/toolMastery),
  `combatLoadout`, `abilityProgression`, skill levels, stats, and a hidden
  `playerId` UUID that's explicitly commented (`docs/onboarding.js:469-476`)
  as being there so "a real network identity can be layered in later without
  touching save-slot bookkeeping."
- A world record (`docs/onboarding.js:544-560`) has `ownerCharacterId`,
  `farmhands: [{characterId, permissions}]`, and — this is the important
  one — `members: { [characterId]: memberState }`, where `memberState`
  (`docs/onboarding.js:528-536`) holds `nonGearInventory`, `packClothing`,
  `npcRelationships`, and `questProgress`, explicitly commented as
  "world-scoped: stays behind when a character leaves the world, unlike
  gear/skills/stats which travel with the character." **This is already the
  exact (world, player) inventory scoping described above** — it just isn't
  driven by a network yet, only by switching which world/character the local
  single-player session has loaded.
- A farmhand permission model already exists (`isWorldOwner`,
  `getFarmhandPermissions`, `addFarmhand`/`removeFarmhand`,
  `docs/onboarding.js:563-604`, mirrored in `docs/game.js:3832-3902`), plus a
  content-gating helper `canAccessContent(visibility)` (`docs/game.js:3933+`)
  for owner-only vs. farmhand-only content. This is a reasonable seed for a
  future host/guest **authority** model, but today it only gates UI/content
  visibility — it has no bearing on who's allowed to mutate simulation state,
  because there's only ever one simulation.

So the hard problem isn't the data model — it's that **everything runs in one
browser tab as a pile of module-level singletons**, with no client/server or
host/guest split at all. `docs/game.js` is a single IIFE where `player`,
`inventory`, `gearInventory`, `hostileObjects`, `companionObjects`,
`equipmentSlots`, the active camera, etc. are all plain module-level
`let`/`const` — there is exactly one of everything. Every read/write of
`hobunjiSaveMeta` (`docs/game.js`'s `saveGearInventory`, `saveMemberWorldData`
at `docs/game.js:3911-3927`, `combat-loadout.js`'s `persist()`,
`combat-progression.js`'s `persist()`) is a local read-modify-write against
`localStorage`, not a call to any authority — comments like
`docs/game.js:3852` (`// real multiplayer: window.__hobunjiSetFarmRole(...)`)
and `docs/game.js:3829` ("until networking exists to push a live update")
confirm multiplayer has been anticipated but never started.

## Desync-risk inventory

This is a real-time action game (staged windup → strike → recover melee
combat, dt-driven creature AI), which is exactly the kind of simulation that's
hardest to keep in sync across independent clients. In rough order of risk:

### 1. Combat — highest risk
- All timing is **wall-clock** (`performance.now()`), not tick-counted:
  combo-reset windows (`docs/js/combat/combat-combo.js:91,101-102`), charged
  attack duration (`combat-charged-breaker.js:52-98`), stamina
  regen/exhaustion windows (`resource-system.js:157,218,244-251`), tap-vs-hold
  input disambiguation (`combat-input.js:22-24`). Two peers each running their
  own `performance.now()` will disagree about exactly when a window opens or
  closes. A future netcode layer needs an authoritative clock (host time, or
  a synchronized/interpolated logical clock) that all combat timers read from
  instead of the local wall clock. **Not fixed in this pass** — doing so
  needs an actual shared clock, which doesn't exist without networking.
- Hit detection is geometric cone tests (`inCone()`, `docs/game.js:3056`)
  against live `x/y` positions computed every frame from local input — this
  is classic client-side-prediction territory. Whoever is authoritative for a
  given entity's position needs to resolve the hit; the other side needs
  reconciliation/rollback or must simply defer to the authority's result.
- Each ability module (`combat-combo.js`, `combat-combo-streak.js`,
  `combat-charged-breaker.js`, `combat-blink-dodge.js`,
  `combat-counter-shield.js`) keeps its own module-level closure state
  (`comboIndex`, `streak`, charge `startedAt`, dodge `active`, etc.), and
  `combat-loadout.js`/`combat-progression.js` likewise keep single global
  maps keyed only by weapon. **This turns out not to need per-player
  instancing**, on reflection: the intended model has each player running
  their *own* full client (their own browser tab/process), not one process
  simulating several players at once — so each player's browser already has
  its own independent copy of all this state for free, the same way it
  already has its own independent `player`/`inventory`/`equipmentSlots`.
  Instancing these closures would only matter for a same-process local
  co-op/split-screen mode, which isn't the model described here. What
  genuinely needs multi-entity awareness *within* a single client is
  different: the world owner's client needs to know about every present
  player for NPC/creature AI purposes (aggro, targeting, companion
  ownership) — see the `players` list and companion `master` field below,
  both already generalized.
- `resource-system.js`'s afflict-proc chance/magnitude and every
  gameplay-affecting `Math.random()` call in creature AI (attack selection,
  wander targeting, evasive-orbit side, den-pack spawns, loot rolls) now go
  through a shared seedable RNG (`window.GameRandom`, defined in
  `resource-system.js`) instead of raw `Math.random()` — **done in this
  pass**. It's still seeded from `Math.random()` at session start (so
  single-player feel is unchanged), but every one of those rolls is now one
  seed away from being made deterministic/replicated once an authoritative
  host exists, or from being resolved once and broadcast instead of each
  peer re-rolling independently. Purely cosmetic randomness (particle FX,
  audio pitch variance, death-ragdoll tumble direction) deliberately stays on
  `Math.random()` — nothing downstream depends on peers agreeing on those.
- Enemy/companion targeting hardcoding the single local player as the only
  possible target is **now fixed**: `docs/game.js` has a `players` array
  (today just `[player]`) and a `nearestPlayer(x, y)` helper; `updateHostiles`
  acquires and sticks to a `c.targetPlayer` drawn from that list instead of
  reading the bare `player` singleton, and `combat-animal-attacks.js`'s
  `gatherTargets()` iterates `deps.players` (falling back to `[deps.player]`).
  A second connected player just needs to be pushed into `players` for
  hostiles to notice and chase them too — nothing in the AI itself needs to
  change further. Actually *landing* a hit on a non-local player is still out
  of scope: `damagePlayer`/`respawnPlayer` (`docs/game.js:3043-3067`) remain
  hardwired to the one local `player`, which is harmless today (there's only
  ever one entry in `players`) but is real follow-up work — likely as part of
  whatever remote-player representation a networked guest gets on the
  owner's client, not a standalone "instance combat" refactor.

### 2. NPC/creature transforms & AI — high risk
- Creatures are plain objects (`makeCreatureEntity`, `docs/game.js:2709+`)
  integrated every frame via manual Euler stepping
  (`moveCreatureToward`/`updateCreatureMesh`, `docs/game.js:3218-3312`), with
  render position separately lerped toward simulated `x/y`. NPCs
  (`makeNpcWalker`, `docs/game.js:6973+`) are similar but keyed off
  `resolveNpcScheduleTarget` (`docs/game.js:6839-6889`), which is deterministic
  given shared game time — a good sign, since it means NPC daily schedules
  *could* stay in sync across peers without any position traffic at all, as
  long as clocks and map state agree.
- Movement/collision math uses real `dt` (clamped to 0.04s,
  `docs/game.js:17149`), not a fixed simulation tick — different peers'
  frame timing will integrate slightly differently even given identical
  inputs, which rules out true deterministic lockstep without also fixing the
  tick rate.
- Gameplay-affecting `Math.random()` calls in creature AI (attack selection,
  wander target/timing, evasive-orbit side, pack spawn species/count/
  position) now go through the shared seedable `window.GameRandom` — see
  above; **done in this pass**.
- Animation state for creatures/NPCs has no skeletal
  `AnimationMixer`/clip-blending at all — it's sprite-plane swapping. The
  run-cycle frame index (`runFrame`, `updateCreatureAnimFrame` in
  `docs/game.js`) **used to be** a small persistent per-frame timer
  (`runFrameT += dt`, advance every 0.18s) — the kind of thing that drifts
  once replicated, since it depends on each peer's own tick history rather
  than on anything actually synced. **Fixed in this pass**: it's now driven
  by actual ground covered since the last call (`runFrameDistPx`, same
  accumulator pattern the existing `_footstepAdvance`/footstep-sound code
  already used), so the frame falls out of position — which *is* the thing
  that gets synced/reconciled — instead of needing its own state kept in
  lockstep. The separate mesh-morph "breathing" phase-cycle
  (`docs/config/animations/breathing-default.json`, driven by
  `docs/js/portrait-breathing.js`) turned out to already be fine on this
  specific axis — its phase is `(nowMs / 1000) % totalCycleDuration`, a pure
  function of the timestamp with no accumulated state, so it can't drift from
  missed ticks or differing frame timing. Its remaining gap is the one
  described above for combat timing generally: `nowMs` is each peer's own
  wall clock, not a shared one, so it needs the same future authoritative/
  synchronized clock, not a code fix on its own.
- There is today **no authoritative/client-predicted split whatsoever** —
  every creature/NPC/player is simulated locally, once, by the one browser
  tab running the game. The natural fit given the intended model (one world
  owner) is: the world owner's client is authoritative for all NPCs,
  creatures, and world state; guest clients send inputs and render
  interpolated/reconciled state for everything they don't own locally (their
  own player at least, possibly with owner-side reconciliation on hit
  results).

### 3. Save/inventory writes — medium risk, but the schema already helps
- Every save-affecting function does its own `localStorage`
  read-modify-write of the whole `hobunjiSaveMeta` blob (`docs/game.js`'s
  `saveGearInventory` at `1712-1719` and `saveMemberWorldData` at
  `3911-3927`, plus `combat-loadout.js` and `combat-progression.js`'s own
  `persist()`s). In multiplayer, only the entity that legitimately owns a
  slice of that data should be allowed to write it: a joining player's client
  is the authority for their own `characters[]` entry (gear/loadout/
  progression); the world owner's client is the authority for
  `worlds[].members[characterId]` (the per-world-per-player inventory) and
  for shared world state (farm layout, placed objects, livestock). None of
  today's persistence functions know or care who's allowed to write what —
  that's the gap to close, not the data shape.

### 4. Animal companion "master" reference — now addressed in this pass
Before this change, every companion behavior in `docs/game.js`'s
`updateCompanions()` and in `combat-animal-attacks.js`'s `guardChargeStart()`
hardcoded the single global `player` object as who a companion follows,
defends, and orients away from — explicitly called out in a comment as
"treating the player as its master." That's now been generalized:

- Companion entities carry a `master` field (`docs/game.js`, the object
  literal in `makeCreatureEntity`) — any object shaped like `{x, y, angle,
  climbing}` (the same shape as the real `player`) can be a master.
- `updateCompanions()` reads `c.master || player` instead of `player`
  directly, throughout (climbing-cling behavior, alert-range checks, chase/
  wander-toward-owner).
- `syncCompanionFromWhistle(master = player)` now takes an explicit master
  and looks up/despawns only *that* master's companion in `companionObjects`
  (instead of assuming exactly one companion exists globally), so two
  distinct masters can each have their own whistle-summoned companion
  side-by-side without clobbering each other.
- `combat-animal-attacks.js`'s `guardChargeStart()` reads `c.master` for its
  "shove away from whoever I'm guarding" angle instead of `deps.player`.
- The Cutscene Director's live-combat simulation (`docs/game.js`'s
  `runCombat`, ~line 20835+) now explicitly assigns `c.master = player` when
  registering an authored companion, and clears it back to `null` when the
  cutscene ends, instead of relying on an implicit global.

**What this does *not* yet do:** it doesn't wire up a second player's
companion or an NPC-owned companion — those features don't exist yet. It
removes the code-level obstacle (the hardcoded singleton) so that when either
feature is built, the companion AI itself doesn't need touching — only the
call site that decides who a given companion's master is. One caveat for a
future NPC master specifically: NPC entities (`makeNpcWalker`,
`docs/game.js:6973+`) store position as `root.position`/`rot`, not the flat
`x/y/angle/climbing` shape the companion AI reads — an NPC used as a master
will need a small adapter (or those fields exposed directly) rather than
being passed in as-is.

## Suggested rough shape for the eventual implementation

Not a committed plan, just the shape this points toward given the above.
**Each player runs their own full client** (their own browser tab/process,
own `player`/`inventory`/`equipmentSlots`/combat ability state — none of
that needs instancing within one process, since there's only ever one
process per player). What a client needs beyond simulating its own player:

1. **Authority**: the world owner's client is authoritative for the shared
   world simulation — NPCs, wild creatures, farm/world state, calendar/
   weather. Guest clients send their own inputs and locally predict their own
   player only; everything else (including other players) is
   received/interpolated from the owner.
2. **Multi-entity awareness on whichever client simulates the shared
   world** (the owner's): it needs to know about every present player for
   NPC/creature AI purposes. **Already generalized in this pass**: the
   `players` list + `nearestPlayer()` helper let hostile creatures aggro/
   chase/attack whichever player is nearest instead of a hardcoded singleton,
   and the companion `master` field lets a companion follow/defend any
   qualifying entity instead of hardcoding `player`. What's still missing is
   the remote-player representation itself — a guest's avatar, on the
   owner's client, needs *something* in the `players` array and *something*
   `damagePlayer`-shaped to actually take a hit; today `damagePlayer`/
   `respawnPlayer` are still hardwired to the one local `player` object.
3. **Save authority split**: character-portable data (gear, levels, loadout,
   progression) is written by its owning player's client; world+member data
   (`worlds[].members[characterId]`, farm layout, livestock) is written by the
   world owner's client and pushed to joined guests.
4. **Deterministic timing**: replace `performance.now()`-based combat/AI
   windows with a shared/authoritative clock once one exists to read from.
   Gameplay-affecting `Math.random()` calls are **already seeded** through
   `window.GameRandom` (this pass) so that part just needs the seed itself
   synced/broadcast, rather than each roll being converted individually.
5. **Companion master**: now trivially per-player thanks to the change in
   this pass — each connected player's client calls
   `syncCompanionFromWhistle(theirOwnPlayerObject)`; an NPC-owned companion
   just needs an NPC-shaped master adapter and a call site, whenever that
   feature is wanted.
