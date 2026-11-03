# Ruin capabilities, targetables and world events

Goal: build ruins (and anything else) from small modules that *combine*, instead of scripting each scenario. Two example combinations drive the design and are acceptance tests, not shipped content:

1. **Defend the key statue.** Put the key statue on the plinth; skeletons and demolitionists climb out of hidden pillar openings; demolitionists try to blow up the statue before the plinth finishes pressing, skeletons try to distract the player.
2. **Rope-launched bomb opens a bridge.** Hang a witch-bomb on a rope, melee it so the lunge distance becomes swing force, it drops right before the swing back and lands by a cracked pillar, the blast topples the pillar and the bridge tiles become walkable.

Neither is authored anywhere. The system's job is to make them *possible* as combinations of independent pieces.

## Why they were not possible

Each interaction between two systems was bespoke code: the lunge-stop test looped over hostiles only; melee only knew burdens (and only detonated them); blasts reached props through a private hook; mechanism inputs were a fixed list; the rope pendulum lived inside the ruin generator; nothing expressed "defend X until Y".

## The substrate

- **Capabilities, not types** (`js/targetables.js`). Things that can be hit register what they can *do*: `hostile`, `burden`, `explosive`, `hangable`, `breakable`, `lungeStop`. Askers query by capability. Systems that already own a collection (burdens, enemies) expose it through `addSource`, so nothing is tracked twice. Capabilities can be live (a burden is `hangable` only while hanging).
- **One melee geometry.** An entry's `toActor()` is a stand-in target for `Combat.meleeHit`; `RangedWeapons.actorHitbox` honours its `__targetableHitbox`. There is exactly one cone-vs-box test.
- **One event stream** (`js/world-events.js`). Typed, scoped, synchronous. `struck` (a melee strike hit something) and `blast` (every explosion; emitted from `Shattercasks.applyBlast`, the single choke point). Subscribers carry a scope and an optional filter, and cannot break emitters.
- **Lunge targeting** (`js/lunge-targeting.js`, extracted from `game.js`). A lunge halts when a live hostile *or any `lungeStop` targetable* is inside the attack cone. Nothing is `lungeStop` by default, so gameplay is unchanged until a system opts a thing in.

**Aim note.** For the player, `Combat.meleeHit` is wrapped (`ranged-camera-focus.js`) so the strike cone follows the camera reticle, overriding the yaw/pitch a caller passes. Targetables go through the same wrapper, so a `lungeStop` target is found where the player is *aiming*, exactly like an enemy. Probes that need a specific direction must pass an explicit `direction`.

## What this step changed (behaviour-preserving)

`isHostileInLungeCone` moved to `LungeTargeting` and gained the targetable path; burdens are exposed as a `shattercasks` source (`burden`; `explosive` for shattercask/witch-bomb; `hangable` while hanging; `lungeStop` only if `burden.lungeStop === true`); `sweepMelee` emits `struck` before detonating; `applyBlast` emits `blast`; the witch bomb passes its `y` and id into the blast. No listener exists yet, so nothing observable changes.

## How the example combinations decompose

| Combination | Pieces |
|---|---|
| Rope bomb opens bridge | dispenser (spawner) → bomb (`explosive`, carriable) → rope hook (`hangable`; sets `lungeStop`) → melee `struck` → impulse → release → `blast` → cracked pillar subscribed to `blast` → bridge toggle |
| Defend the statue | plinth (progress output) + statue (`breakable`, targeted) + pillar openings (spawners) + demolitionists (target explosive burdens) + skeletons (target the player), under a `Defend(statue, until plinth progress = 1)` goal |

## Roadmap

1. *(this step)* Targetables, WorldEvents, lunge targeting.
2. Mechanism inputs that subscribe to events (`struck`, `blast` as activator kinds, with conditions like "blast within 2.5"). The Furniture Author gets a capabilities/ports block, like the existing `puzzle`, `elevation` and `climbWall` blocks, so the vocabulary stays data-driven.
3. A general rope component: a `hangable` pendulum any burden can attach to, `struck` → impulse (from lunge distance spent), release into the existing throw arc.
4. Goals and encounters (`Defend`, spawners, objectives) plus a solver that chains capabilities from the player's verbs to a goal and validates the chain with the existing pendulum/flight simulations (a feasible-impulse window, so skill decides the exact throw).

This sits on the room-plan / 3D-grid work (see `vertical-grid.md`): a plan that knows a room's volumes, entrances and anchors is what lets a solver place these pieces coherently.

Known limit: `sweepMelee` still has its own cone test (kept to avoid changing burden melee behaviour here). Moving it onto the shared geometry is a later, separately tested step.

## Verification

Unit tests execute the registry, event stream, lunge targeting, and the real `shattercasks.js` (burden capabilities, blast event) in a sandbox. A headless run of the real game (see `headless-game-test`) placed a burden with a real hitbox along the player's actual aim and confirmed: no lunge stop by default; after opting in, a stop at 0.4, 1.0 and 1.8 tiles (range 2) but not too far, behind, to the side, far above, after opting out, or while carried; `blast` events arrive with the right payload; no page errors.
