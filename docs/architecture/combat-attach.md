# Attach attacks: "climb onto a target and take its place"

`js/combat/combat-attach.js` (`window.Combat.attach`) is a reusable mechanic for creature attacks where the attacker climbs onto one target and inherits its place for a while. The honeyfuzzle **Swarm** is the first; a leech, burr or rider attack is a config entry, not new code.

`Combat.attach.register(id, config)` registers a named attack with `Combat.animalAttacks`, so a creature lists it in `CREATURE_DB[...].attacks` like Pounce, and the existing AI loops (hostile, companion, territorial) treat the creature as busy until it ends. Authored overrides live in `config/combat/attack-values.json` under `creatureAttacks.<id>` (`Combat.animalAttacks.applyConfig` hands that block to `Combat.attach.applyConfig`).

## Lifecycle

1. **approach**: the attacker flies/hops to its single target (`approachSpeedPxS`, `contactPx`, `approachTimeoutS`).
2. **attached**: it takes the host's position and facing every frame. Ordinary riders hover above the host's top, but `verticalAnchor: 'upper-quarter'` positions Swarm at the center of the host's topmost 25% of body height, including the wing-cloud hover correction. It ticks an effect every `tickIntervalS` for `durationS`.
3. **detach**: on expiry, or when the host or attacker dies, the host leaves the area, or the attack is cancelled. It is set down beside the host (never inside it) and rests for `cooldownS`.

A host can carry `maxPerHost` riders (3 by default), and a rider cannot itself be a host.

## Config

| Key | Meaning |
| --- | --- |
| `durationS`, `cooldownS`, `tickIntervalS` | timing; `durationS` may be a function `(attacker, host)` |
| `tick` | default tick: `damageScale` (x the attacker's `attackDamage`), `playerScale` (extra scale when the host is the player), `tag`, `afflictionBonuses` |
| `onTick(attacker, host, state)` | replaces the default tick entirely |
| `immuneToHost` | the attacker ignores every hit that comes from its host (a named `attacker`, or an unnamed hit that starts on the host; any unnamed hit for a player host) |
| `staggerImmune` | no stagger, knockback or flee reaction from anyone while attached (other creatures can still damage it) |
| `verticalAnchor`, `heightAboveHost` | default riders sit above the host; `verticalAnchor: 'center'` follows its rendered body center, while `upper-quarter` targets the center of the uppermost 25%. `heightAboveHost` is an additional offset from whichever anchor was chosen. |
| `visualSpreadScale` | scales the swarm member radius around the local center; Swarm uses `0.42` while attached and returns to `1` when detached |
| `hostReaction` | a creature host swats at what is on it: `{ kind: 'flail', intervalS, radiusTiles, damageScale, hitsAllies, hitsOpponents }`. The swat is aimed at the rider, which ignores it, so it lands on whoever else is near: the host's allies by default |
| `onAttach`, `onDetach` | hooks |

Ticks are delivered with `noStagger` so a damage-over-time rider does not stun-lock its host or the player. `game.js`'s `damageCreature` and `damagePlayer` honour `noStagger`, and `damageCreature` calls `Combat.attach.blocksDamage` and `suppressesStagger`.

## Swarm

`def.attacks: ['swarm']`, `attackTag: 'poison'`, `realAttackEvery: 1` (a companion uses Swarm every time instead of the usual 1 in 4). Defaults: 6 s on the target, 5 s rest, a tick every 0.5 s of `0.3 x attackDamage` direct damage with a heavy Poisoned Health buildup (`poisonedHealth: 3`, i.e. 3x the direct damage), softened to 60% against the player; immune to the swarmed target; the swarmed creature flails at 50% of its own `attackDamage` every 1.1 s, which damages allies within 1.4 tiles.

Attached Honeyfuzzles contract to 71% of their free-flight spread (half the previous contraction from 100% down to 42%) and concentrate over the upper quarter of the host. Contraction is quick on impact; they relax back into a loose cloud on detach. Only presentation changes, not attack duration/damage.

Honeyfuzzles are also in the territorial species list (`creatureBehaviors.territorial.species`), so a swarm defends its hive: it warns first, then fights, using Swarm on whoever is attacking or too close.

## What enemies do and don't do

Enemies have no general friendly fire: Pounce and bites only consider the player's side. The friendly fire here comes from the host's own swat (`hostReaction`), not from enemies choosing to attack each other. Ordinary enemies also don't hunt companions on purpose, so nothing makes a third enemy go after the swarm; it can still be hurt by anything that hits it.

## Rescue attacks

A swarmed player is rescued by their active combat companion; swarmed NPCs can be rescued by nearby members of their own camp, tribe, den, herd, or faction, including a beastmaster's pet. A rescuer moves to melee reach and uses its ordinary attack damage and attack tag, including registered companion offensive modifiers. The swarm takes 100% damage, affliction buildup, Footing damage and knockback; its host takes 25% of each, and the swarm immediately detaches. Affliction multipliers are kept unchanged because ResourceSystem derives buildup from the quarter-strength damage payload. One rescue costs an ordinary attack cooldown and never turns on generic friendly fire.

`Combat.attach.rescueCount` and a rescuer's transient `_honeyfuzzleRescueTarget` offer mobile-friendly diagnostics. An existing committed special/weapon attack is not cancelled to perform a rescue.
