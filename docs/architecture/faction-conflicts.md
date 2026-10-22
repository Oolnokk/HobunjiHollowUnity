# Wilderness faction conflicts

Who fights whom in the wilderness — and who runs away — is data in
[`docs/config/faction-conflicts.json`](../config/faction-conflicts.json), read by
[`docs/js/faction-conflicts.js`](../js/faction-conflicts.js) (`window.FactionConflicts`).
Adding a faction or changing a rule is a JSON edit; no game code changes.

## Scope: what this does and does not control

* **Only actor-vs-actor fights inside the player's streamed 16×16 wilderness chunk.**
  `porakaneki-camps-runtime.js` runs the pass at 5 Hz and hands in the living
  `hostileObjects` of that chunk. Nothing is simulated off-screen; when either
  fighter leaves the chunk the target it was given is dropped.
* **A running fight survives the chunk border.** An actor that already has a faction
  target (or is fleeing) stays in scope up to 3 tiles past the chunk edge
  (`FACTION_FIGHT_EDGE_PAD_TILES`), so brawls near a border don't stutter between
  `chase` and `return`. Actors that have not engaged are still ignored outside the chunk.
* **Not player combat.** Bandits/predators attacking the player, and Porakaneki
  reputation (Favor, "murder" vs "self-defense" kills) are separate systems
  (`porakaneki-faction-rules.js`). A flee condition never fires because of the player.
* Movement and attacks stay in the existing per-frame AI: humanoids (`isBandit`
  entities — bandits, Porakaneki, minions…) use `BanditCombat.updateCombatAI` on an
  assigned `_chunkCombatTarget`; wildlife uses `patrol-chase` + `targetCreature`.
  Fleeing reuses game.js's existing `fleeing-low-health` state for both.

## File layout

```jsonc
{
  "defaults": { "attack": { ... }, "flee": { ... } },   // inherited by every faction
  "factions": [ { "id": "...", "match": [...], "attacks": [...], "flee": {...} } ]
}
```

`factions` is an **array and its order matters**: an actor belongs to the first
faction whose `match` fits (unless it is assigned explicitly — see below).

### `match` — who is in this faction

A list of rules; the actor joins if **any** rule fits.

| rule | fits when |
| --- | --- |
| `{ "flag": "isBandit" }` | `entity.isBandit` is truthy |
| `{ "field": "role", "equals": "x" }` / `{ "field": "role", "in": ["x","y"] }` | `entity.role` equals / is one of |
| `{ "zoneSpecies": "packSpecies" }` (or a list) | species is listed in the current zone's `EXTERIOR_ZONES[...]` list(s) |
| `{ "diet": ["predator","carnivore"] }` | `entity.def.diet` is one of these |
| `{ "creatureKey": ["gar-wolf"] }` | creature key (alpha/den-mother/herd-mother suffixes ignored) |
| `{ "speciesId": ["harlyao"] }` | humanoid roster species (`rosterRecord.appearance.speciesId`) |

**Explicit assignment always wins:** set `entity.factionId = "my-faction"` (or the
older `entity.wildlifeRole`) at spawn and no `match` rule is consulted. This is the
easy way to make a one-off spawn group a faction. The player's companions
(`isCompanion`) and dead actors never take part.

### `attacks` — who this faction attacks

One entry per enemy faction:

| field | default | meaning |
| --- | --- | --- |
| `faction` | — | enemy faction id (required) |
| `priority` | 50 | higher is chosen first. Entries with the **same** priority form one tier: the nearest living member across the whole tier is picked. A lower tier is only considered when the higher one has no candidate |
| `pursueFleeing` | `false` | keep chasing members of that faction that are fleeing. `false` = let them go and pick someone else |
| `maxRangeTiles` | `null` | only notice enemies this close (`null` = anywhere in the chunk) |
| `forgivesCrossfire` | `false` | while a living member of that faction is in the chunk, this faction's casualties are not blamed on the player (used by Porakaneki Favor rules) |
| `lethal` | `null` | for wildlife attackers: `true` = hits can kill, `false` = non-lethal sparring (health floors at 12%), `null` = legacy rule (lethal against humanoids, sparring otherwise) |

Relations are **one-directional**: to make two factions fight each other, list each in
the other's `attacks`. A faction with `"attacks": []` never starts a fight (it can still flee).

### `flee` — when this faction runs

```jsonc
"flee": {
  "conditions": [ { "type": "healthBelow", "ratio": 0.25, "against": ["bandit"] } ],
  "destination": "home",     // "home" | "away"
  "awayTiles": 14,           // distance for "away"
  "maxSeconds": 20,          // give up fleeing after this long even if not arrived
  "cooldownSeconds": 10,     // after a flee: no re-engaging and no re-fleeing
  "radiusTiles": 8,          // default "enemy is close" radius for conditions
  "fleeOnHit": true          // see below
}
```

Any one matching condition starts a flee. Condition types:

| `type` | triggers when | extra fields |
| --- | --- | --- |
| `healthBelow` | health ratio ≤ `ratio` **and** an enemy is within `radiusTiles` | `ratio`, `against`, `radiusTiles`, `minCount` |
| `enemyNearby` | at least `minCount` (1) enemies are within `radiusTiles` | `factions`/`against`, `radiusTiles`, `minCount` |
| `outnumbered` | enemies ÷ allies (self included) ≥ `ratio` and at least `minEnemies` (2) enemies | `ratio`, `against`, `alliedFactions`, `radiusTiles`, `minEnemies` |

`against`/`factions` list the enemy factions that count; omitted = every faction this one
attacks **or that attacks it**. Add `"reason": "text"` to label the flee in logs.

New trigger kinds are one function: `FactionConflicts.registerConditionType(name, (entity, cond, ctx) => boolean)`
where `ctx.enemiesWithin(entity, cond)` / `ctx.alliesWithin(entity, cond)` are available
(register before the config loads, or the config reports an unknown type).

**Destinations.** `home` runs to the actor's home point (Porakaneki: their camp centre;
everyone else: `homeX/homeY`, i.e. den/tent). `away` runs `awayTiles` directly away from the
threats (clamped to the map). Arrival ends the flee (game.js calls `FactionConflicts.noteFleeSettled`).

**`fleeOnHit`.** game.js makes any `def.hostile === false` creature bolt home the moment it
is hit (herbivores). Neutral Porakaneki hunters are also `hostile: false` (that only means
"not hostile to the player"), so they set `"fleeOnHit": false` and rely on `conditions`
instead. Leave it `true` for prey.

### Fleeing and pursuit together

A fleeing actor is released from its target and is not re-targeted until it settles and the
cooldown passes. Whether *others* chase it is decided by the **attacker's** relation:
`pursueFleeing: true` keeps the chase going (the hunter runs the wounded deer down), `false`
drops it (a predator lets a fleeing hunter go). A faction's flee state can therefore be
exploited by exactly the factions you choose.

## Recipes

**Add a faction** — append to `factions`, give it a `match` (or spawn with `factionId`), and
add it to the `attacks` of whoever should hit it:

```json
{ "id": "ravager", "match": [{ "speciesId": ["ravager"] }],
  "attacks": [{ "faction": "bandit", "priority": 80, "pursueFleeing": true }],
  "flee": { "destination": "away", "conditions": [
    { "type": "healthBelow", "ratio": 0.3 },
    { "type": "outnumbered", "ratio": 2 } ] } }
```
then add `{ "faction": "ravager" }` to the bandit's `attacks` if bandits should fight back.

**Make a faction pacifist but skittish** — `"attacks": []` plus an `enemyNearby` flee condition.

**Make two factions ignore each other** — remove the `attacks` entries between them.

**Stop a faction from chasing wounded enemies** — set `pursueFleeing` back to `false` on that relation.

## Debugging

`FactionConflicts.formatDebug()` (also `debugSnapshot()`) prints the compiled rules,
per-faction head-count of the last pass, targets/fleeing counts and recent events
(`config ready`, `<id> flees: <reason>`). `PorakanekiCamps.debugSnapshot().ecology` still
carries the legacy counters plus `fleeing`. Config mistakes (unknown faction ids, unknown
condition types, duplicate ids) are logged to the console as `[FactionConflicts] config: …`
and listed in `debugSnapshot().problems`. `scripts/test-faction-conflicts.js` loads the shipped
JSON and fails on any such problem.

## Engine fixes this depends on

Verified in the running game (Testing Arena, bandit vs. Porakaneki, wolf vs. bandit, with the
player ~15 tiles away). Before these, actor-vs-actor fights were assigned targets but never
landed a hit:

* `BanditCombat.init` was never given `damageCreature`, so `damageBanditCombatTarget` fell
  through to `damagePlayer` — a bandit "hitting" a Porakaneki hurt the player instead.
* `enemy-target-facing.js` turned every melee actor toward the *player* argument rather than
  its real target (`BanditCombat.resolveCombatTarget`), so the attack-cone gate never passed.
* `banditPersonalSpaceAdjust` pushed a bandit away from every other `isBandit` actor,
  including its own target, keeping it ~47 px out of melee range.
* The player leash / line-of-sight checks (`game.js` `factionEngaged`) and the predator home
  leash (`patrol-chase`) flipped fighters to `return`/`searching` whenever the fight was far
  from the player or their den.
* `damageCreature` applied the player's skill/perk/potion damage scaling, "landed hit" XP and
  riposte target to NPC-vs-NPC hits; hits tagged `factionCombat` now skip them.

## Where the engine seams are

* `faction-conflicts.js` — classification, tiers, flee, pursuit rules, `runPass`.
* `porakaneki-camps-runtime.js` — `updateChunkEcology` (chunk scope + applying targets),
  `updateDetailedHunter` (a fleeing hunter is exempt from planner/hostility redirection).
* `game.js` `updateHostiles` — `factionEngaged` (skip the player leash/line-of-sight checks for
  an actor with a faction target), `patrol-chase` (pursuit rule + no home leash mid-fight),
  the `fleeing-low-health` branch (`_fleeToX/Y` destination, settle callback), and
  `damageCreature` (`fleesWhenHit`).
* `wildlife-spawn.js` `applyWildlifeSkirmishDamage` — `lethal` override.
* `combat-bandit.js` / `enemy-target-facing.js` — `resolveCombatTarget`, personal-space exemption
  for the current target.
