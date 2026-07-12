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
