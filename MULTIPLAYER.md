# Multiplayer intent & architecture review

Status: **aspirational / not implemented.** No networking code exists anywhere in
this repo today (`docs/game.js` and `docs/js/combat/*.js` are single-process,
single-browser-tab, `localStorage`-only). This document exists so the intended
shape of multiplayer isn't lost, and to track what in the current codebase
already lines up with it versus what will actively fight it.

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
  instead of the local wall clock.
- Hit detection is geometric cone tests (`inCone()`, `docs/game.js:3056`)
  against live `x/y` positions computed every frame from local input — this
  is classic client-side-prediction territory. Whoever is authoritative for a
  given entity's position needs to resolve the hit; the other side needs
  reconciliation/rollback or must simply defer to the authority's result.
- **Every ability module keeps its own module-level closure state**
  (`comboIndex`, `streak`, charge `startedAt`, dodge `active`, etc. — see
  `combat-combo.js`, `combat-combo-streak.js`, `combat-charged-breaker.js`,
  `combat-blink-dodge.js`, `combat-counter-shield.js`) rather than state
  scoped to a specific player. Two simultaneous players sharing this module
  as-is would corrupt each other's state. `combat-loadout.js`'s
  `loadoutsByWeapon` and `combat-progression.js`'s `meta` are likewise single
  global maps keyed only by weapon, never by player. All of this needs to
  become per-player-instanced state (and `window.Combat.deps`, currently one
  shared object built at `docs/game.js:19976-20005`, needs to become one
  instance per locally-rendered player) before two players' combat can
  coexist without stomping each other.
- `resource-system.js:323-324` uses unseeded `Math.random()` for a
  proc/afflict chance — anywhere randomness affects an outcome that both
  sides need to agree on, it must become seeded/deterministic or be resolved
  once by whichever side is authoritative and broadcast, not re-rolled locally
  by each peer.
- Enemy/companion targeting hardcodes the single local player as the only
  possible target (`combat-animal-attacks.js`'s `gatherTargets()`,
  `docs/game.js`'s `updateHostiles`/`findAutoTarget` reading `player.x/y`
  directly). This needs to generalize to "nearest of N present players," not
  just a different data source.

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
- `Math.random()` is used unseeded in creature AI decisions that would need
  to agree across peers: attack selection
  (`docs/game.js:3508,3525,3665` at time of writing), wander
  target/timing (`wanderTick`, `docs/game.js:3241-3244`), and pack
  spawn species/count/position (`spawnPackAtDen`, `docs/game.js:4197-4204`).
- Animation state for creatures/NPCs has no skeletal
  `AnimationMixer`/clip-blending at all — it's sprite-plane swapping driven by
  small **persistent timers** (`runFrame`/`runFrameT`,
  `updateCreatureAnimFrame` at `docs/game.js:3314-3332`) and a separate
  mesh-morph "breathing" phase-cycle
  (`docs/config/animations/breathing-default.json`). These timers are not
  purely derived from position, so if only positions are networked and each
  peer free-runs its own animation timers locally, visual sync will drift
  (a creature might look mid-stride on one peer and idle on another even
  while agreeing on where it is). Recommendation: either replicate the
  animation-phase timers explicitly, or derive them deterministically from a
  shared clock + entity state rather than free-running per peer.
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

Not a committed plan, just the shape this points toward given the above:

1. **Authority**: the world owner's client is authoritative for the shared
   world simulation — NPCs, wild creatures, farm/world state, calendar/
   weather. Guest clients send their own inputs and locally predict their own
   player only; everything else (including other players) is
   received/interpolated from the owner.
2. **Per-player instancing**: `player`, `equipmentSlots`, `gearInventory`,
   combat ability closure state, `Combat.deps`, and loadout/progression maps
   all need to go from "one module-level singleton" to "one instance per
   connected player," keyed by the existing hidden `playerId` (already
   present on character records for exactly this reason).
3. **Save authority split**: character-portable data (gear, levels, loadout,
   progression) is written by its owning player's client; world+member data
   (`worlds[].members[characterId]`, farm layout, livestock) is written by the
   world owner's client and pushed to joined guests.
4. **Deterministic timing**: replace `performance.now()`-based combat/AI
   windows with a shared/authoritative clock, and seed all gameplay-affecting
   `Math.random()` calls (or resolve them once on the authority and broadcast
   the result) so combat, creature attack choice, and animation-phase drift
   don't diverge between peers.
5. **Companion master**: now trivially per-player thanks to the change in
   this pass — each connected player's client calls
   `syncCompanionFromWhistle(theirOwnPlayerObject)`; an NPC-owned companion
   just needs an NPC-shaped master adapter and a call site, whenever that
   feature is wanted.
